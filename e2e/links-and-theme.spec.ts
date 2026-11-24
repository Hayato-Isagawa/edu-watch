import { test, expect, type Page } from "@playwright/test";

/** 地の文の中にあるリンク(前後に 8 字以上の本文がある)の見え方 */
async function inlineLinks(page: Page) {
  return page.locator("main").evaluate((main) =>
    [...main.querySelectorAll("a[href]")]
      .filter((a) => {
        const parent = a.parentElement!;
        return (
          !a.classList.contains("glossary-tip") &&
          !a.closest("nav, h1, h2, h3, h4") &&
          getComputedStyle(a).display === "inline" &&
          parent.textContent!.trim().length - a.textContent!.trim().length >= 8
        );
      })
      .map((a) => ({
        text: a.textContent!.trim().slice(0, 20),
        color: getComputedStyle(a).color,
        around: getComputedStyle(a.parentElement!).color,
        underlined:
          getComputedStyle(a).borderBottomStyle === "solid" &&
          parseFloat(getComputedStyle(a).borderBottomWidth) >= 1,
      }))
  );
}

test.describe("本文のリンク", () => {
  for (const path of ["/", "/digest/2026-05-16/", "/digest/2026-11-23/"]) {
    test(`地の文と見分けられる(色と下線): ${path}`, async ({ page }) => {
      await page.goto(path);
      const links = await inlineLinks(page);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.underlined, link.text).toBe(true);
        expect(link.color, link.text).not.toBe(link.around);
      }
    });
  }

  test("リンクの class に書いた色が効く(レイヤ外の a に負けない)", async ({
    page,
  }) => {
    await page.goto("/");
    const sub = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--color-sub)";
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    await expect(page.locator("main a[data-category]").first()).toHaveCSS(
      "color",
      sub
    );
  });

  test("ナビとフッターのリンクには平常時の下線を付けない", async ({ page }) => {
    await page.goto("/");
    for (const selector of [
      "header nav .link-underline",
      "footer ul .link-underline",
    ]) {
      const lines = await page.locator(selector).evaluateAll((els) =>
        els.map((el) => {
          const c = getComputedStyle(el);
          return `${c.textDecorationLine} ${c.borderBottomWidth}`;
        })
      );
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines)).toEqual(new Set(["none 0px"]));
    }
  });
});

test.describe("テーマとブラウザの部品", () => {
  for (const [os, theme] of [
    ["light", "dark"],
    ["dark", "light"],
  ] as const) {
    test(`OS が ${os} でもサイトが ${theme} なら部品も ${theme}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: os });
      await context.addInitScript(
        (t) => localStorage.setItem("theme", t),
        theme
      );
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
      await context.close();
    });
  }

  test("ダークの検索結果の線とボタンがテーマの色になる", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/search/");
    // 変数を効かせたとき、検索だけが 1.25 倍に大きくならないように
    await expect(page.locator(".pagefind-ui__search-input")).toHaveCSS(
      "font-size",
      "16.8px"
    );
    await page.locator(".pagefind-ui__search-input").fill("教育");
    await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
    await page.addStyleTag({ content: "*{transition:none!important}" });
    const line = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--color-line)";
      document.body.append(probe);
      return getComputedStyle(probe).color;
    });
    await expect(page.locator(".pagefind-ui__result").first()).toHaveCSS(
      "border-top-color",
      line
    );
    const button = page.locator(".pagefind-ui__button").first();
    await expect(button).toBeVisible();
    expect(
      await button.evaluate((el) => getComputedStyle(el).backgroundColor)
    ).not.toBe("rgb(255, 255, 255)");
    await context.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`選択した文字が読める(${theme})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      await page.goto("/about/");
      const ratio = await page
        .locator("main p")
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el, "::selection");
          const lum = (c: string) => {
            const [r, g, b] = c.match(/[\d.]+/g)!.map((v) => {
              const x = Number(v) / 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const [hi, lo] = [lum(s.color), lum(s.backgroundColor)].sort(
            (a, b) => b - a
          );
          return (hi + 0.05) / (lo + 0.05);
        });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      await context.close();
    });
  }
});

test("見出し・ナビ・ヘッダーの中のリンクは本文の規則を受けない", async ({
  page,
}) => {
  await page.goto("/about/");
  const result = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const accent = document.createElement("i");
    accent.style.color = "var(--color-accent)";
    main.append(accent);
    const read = (html: string) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      main.append(box);
      const s = getComputedStyle(box.querySelector("a")!);
      return {
        color: s.color,
        line: s.borderBottomWidth,
      };
    };
    const link = '<a href="/" class="link-underline">x</a>';
    return {
      accent: getComputedStyle(accent).color,
      body: read(`<p>${link}</p>`),
      excluded: [
        ...["h1", "h2", "h3", "h4"].map((t) => read(`<${t}>${link}</${t}>`)),
        read(`<nav><p>${link}</p></nav>`),
        read(`<header><p>${link}</p></header>`),
        read(
          `<div class="font-bold"><a href="/" class="link-underline text-accent">x</a></div>`
        ),
      ],
    };
  });
  expect(result.body.color).toBe(result.accent);
  expect(result.body.line).toBe("1px");
  for (const r of result.excluded) expect(r.line).toBe("0px");
});

test("既定の文字が小さいブラウザで、メニューを開いたまま幅を広げても本文が触れる", async ({
  page,
}) => {
  // メニューを隠す lg は 64rem。既定の文字を 12px にすると 768px で切り替わる
  const client = await page.context().newCDPSession(page);
  await client.send("Page.setFontSizes", {
    fontSizes: { standard: 12, fixed: 12 },
  });
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/");
  await page.locator("#menu-toggle").click();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator("#menu-toggle")).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("inert");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`ホバーとフォーカスで、下線が消えて左端から線が引かれる(reduced-motion: ${reducedMotion})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await page.goto("/digest/2026-11-23/");
    const link = page.locator(".prose-digest a").first();
    await link.scrollIntoViewIfNeeded();
    const read = () =>
      link.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          size: s.backgroundSize,
          line: s.borderBottomWidth,
          color: s.borderBottomColor,
          origin: s.backgroundOrigin,
          position: s.backgroundPosition,
          duration: Math.max(
            ...s.transitionDuration.split(",").map(parseFloat)
          ),
          property: s.transitionProperty,
        };
      });
    const rest = await read();
    expect(rest.size).toMatch(/^0%/);
    expect(rest.line).toBe("1px");
    // 左端から引く。border の箱の下端に置くので、平常時の線と位置がそろう
    expect(rest.position).toMatch(/^0(px|%) 100%$/);
    expect(rest.origin).toBe("border-box");
    expect(rest.color).not.toBe("rgba(0, 0, 0, 0)");
    if (reducedMotion === "reduce") expect(rest.duration).toBe(0);
    else {
      expect(rest.duration).toBeGreaterThan(0);
      expect(rest.property).toContain("background-size");
    }

    await link.hover();
    if (reducedMotion === "reduce") expect((await read()).duration).toBe(0);
    await expect.poll(async () => (await read()).size).toBe("100% 2px");
    await expect
      .poll(async () => (await read()).color)
      .toBe("rgba(0, 0, 0, 0)");

    await page.mouse.move(0, 0);
    await expect.poll(async () => (await read()).size).toMatch(/^0%/);
    await page.keyboard.press("Tab");
    await link.focus();
    await expect.poll(async () => (await read()).size).toBe("100% 2px");
    await context.close();
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`ホバーとフォーカスで、.link-underline の下線も消えて左端から線が引かれる(reduced-motion: ${reducedMotion})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await page.goto("/digest/");
    const link = page.locator("main p .link-underline").first();
    await link.scrollIntoViewIfNeeded();
    const read = () =>
      link.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          size: s.backgroundSize,
          line: s.borderBottomWidth,
          color: s.borderBottomColor,
          origin: s.backgroundOrigin,
          position: s.backgroundPosition,
          duration: Math.max(
            ...s.transitionDuration.split(",").map(parseFloat)
          ),
          property: s.transitionProperty,
        };
      });
    const rest = await read();
    expect(rest.size).toMatch(/^0%/);
    expect(rest.line).toBe("1px");
    // 左端から引く。border の箱の下端に置くので、平常時の線と位置がそろう
    expect(rest.position).toMatch(/^0(px|%) 100%$/);
    expect(rest.origin).toBe("border-box");
    expect(rest.color).not.toBe("rgba(0, 0, 0, 0)");
    if (reducedMotion === "reduce") expect(rest.duration).toBe(0);
    else {
      expect(rest.duration).toBeGreaterThan(0);
      expect(rest.property).toContain("background-size");
    }

    await link.hover();
    if (reducedMotion === "reduce") expect((await read()).duration).toBe(0);
    await expect.poll(async () => (await read()).size).toBe("100% 2px");
    await expect
      .poll(async () => (await read()).color)
      .toBe("rgba(0, 0, 0, 0)");

    await page.mouse.move(0, 0);
    await expect.poll(async () => (await read()).size).toMatch(/^0%/);
    await page.keyboard.press("Tab");
    await link.focus();
    await expect.poll(async () => (await read()).size).toBe("100% 2px");
    await context.close();
  });
}

/** 下線(半透明を含む)と背景の比。色の形式と半透明は canvas で重ねて読む */
const underlineRatios = (root: Element) => {
  const canvas = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true })!;
  const pixel = (layers: string[]) => {
    canvas.clearRect(0, 0, 1, 1);
    for (const layer of layers) {
      canvas.fillStyle = layer;
      canvas.fillRect(0, 0, 1, 1);
    }
    return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return [...root.querySelectorAll("a[href]")]
    .filter(
      (a) =>
        getComputedStyle(a).display.startsWith("inline") &&
        parseFloat(getComputedStyle(a).borderBottomWidth) >= 1 &&
        getComputedStyle(a).backgroundImage.includes("gradient") &&
        !a.closest("nav, h1, h2, h3, h4, header")
    )
    .map((a) => {
      const layers: string[] = [];
      for (let e: Element | null = a; e; e = e.parentElement) {
        layers.unshift(getComputedStyle(e).backgroundColor);
      }
      const line = getComputedStyle(a).borderBottomColor;
      const [hi, lo] = [lum(pixel(layers)), lum(pixel([...layers, line]))].sort(
        (x, y) => y - x
      );
      const [hi2, lo2] = [
        lum(pixel(layers)),
        lum(pixel([...layers, getComputedStyle(a).color])),
      ].sort((x, y) => y - x);
      return {
        text: a.textContent!.trim().slice(0, 20),
        ratio: (hi + 0.05) / (lo + 0.05),
        full: (hi2 + 0.05) / (lo2 + 0.05),
      };
    });
};

for (const theme of ["light", "dark"] as const) {
  for (const path of ["/", "/about/", "/digest/2026-11-23/"]) {
    test(`平常時の下線は文字より薄く、背景と 3:1 以上(${theme}): ${path}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      await page.goto(path);
      const lines = await page.locator("main").evaluate(underlineRatios);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.ratio, line.text).toBeGreaterThanOrEqual(3);
        expect(line.ratio, line.text).toBeLessThan(line.full);
      }
      await context.close();
    });
  }
}
