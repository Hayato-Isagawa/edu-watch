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
          getComputedStyle(a).textDecorationLine.includes("underline"),
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
      const lines = await page
        .locator(selector)
        .evaluateAll((els) =>
          els.map((el) => getComputedStyle(el).textDecorationLine)
        );
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines)).toEqual(new Set(["none"]));
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
