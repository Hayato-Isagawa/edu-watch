import { test, expect, type Page } from "@playwright/test";

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const saved = (page: Page) =>
  page.evaluate(() => localStorage.getItem("theme"));

test.describe("テーマの切替", () => {
  for (const [name, width, button] of [
    ["ヘッダー", 1280, "#theme-toggle"],
    ["モバイルメニュー", 390, "#theme-toggle-mobile"],
  ] as const) {
    test(`OS と同じテーマへ戻すと保存が消え、OS の設定に従う(${name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/");
      if (width < 1024) await page.locator("#menu-toggle").click();
      const toggle = page.locator(button);

      await toggle.click();
      expect(await theme(page)).toBe("dark");
      expect(await saved(page)).toBe("dark");

      await toggle.click();
      expect(await theme(page)).toBe("light");
      expect(await saved(page)).toBeNull();

      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.reload();
      expect(await theme(page)).toBe("dark");
    });
  }

  test("OS と違うテーマを選んだら、OS の設定が後から変わっても保つ", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.locator("#theme-toggle").click();
    expect(await saved(page)).toBe("light");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.waitForTimeout(100);
      expect(await theme(page)).toBe("light");
      expect(await saved(page)).toBe("light");
    }
    await page.reload();
    expect(await theme(page)).toBe("light");
  });
});

test.describe("フォーカス", () => {
  test("強制カラーで、検索欄のフォーカスの輪郭が消えない", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ forcedColors: "active" });
    const outline = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.outlineStyle, parseFloat(style.outlineWidth)] as const;
      });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    const menuInput = page.locator("#mobile-menu-search-input");
    await menuInput.focus();
    await expect(menuInput).toBeFocused();
    const [menuStyle, menuWidth] = await outline("#mobile-menu-search-input");
    expect(menuStyle).toBe("solid");
    expect(menuWidth).toBeGreaterThanOrEqual(2);

    await page.goto("/search/");
    await page.locator(".pagefind-ui__search-input").focus();
    const [style, width] = await outline(".pagefind-ui__search-input");
    expect(style).toBe("solid");
    expect(width).toBeGreaterThanOrEqual(2);
  });

  test("戻るボタンを押した後、見えなくなったボタンにフォーカスが残らない", async ({
    page,
  }) => {
    await page.goto("/digest/2026-11-23/");
    const button = page.locator("#back-to-top");
    await page.evaluate(() =>
      window.scrollTo({ top: 1500, behavior: "instant" })
    );
    await expect(button).toHaveAttribute("data-state", "visible");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#main-content")).toBeFocused();
    // フォーカスを移しても、上までのスクロールは途切れない
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("戻るボタンにフォーカスが無ければ、フォーカスを動かさない", async ({
    page,
  }) => {
    await page.goto("/digest/2026-11-23/");
    await page.evaluate(() =>
      window.scrollTo({ top: 1500, behavior: "instant" })
    );
    await expect(page.locator("#back-to-top")).toHaveAttribute(
      "data-state",
      "visible"
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(page.locator("#back-to-top")).toHaveAttribute(
      "data-state",
      "hidden"
    );
    await expect(page.locator("#main-content")).not.toBeFocused();
  });
});

test("読了バーは飾りで、支援技術に値を流さない", async ({ page }) => {
  await page.goto("/digest/2026-11-23/");
  const bar = page.locator("#reading-progress");
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    })
  );
  await expect
    .poll(async () => Number(await bar.getAttribute("data-progress")))
    .toBeGreaterThanOrEqual(90);
  expect(
    await bar.evaluate((el) =>
      el
        .getAttributeNames()
        .filter((name) => name === "role" || name.startsWith("aria-value"))
    )
  ).toEqual([]);
});

test("検索を読み込めないとき、読者に向けた文が出る", async ({ page }) => {
  await page.route("**/pagefind/pagefind-ui.js", (route) => route.abort());
  await page.goto("/search/");
  const fallback = page.locator("#search-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("検索を読み込めませんでした");
  await expect(fallback).not.toContainText("npm");
});

test.describe("ナビの現在地", () => {
  const current = (page: Page, nav: string) =>
    page
      .locator(`nav[aria-label="${nav}"] [aria-current]`)
      .evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute("href"),
          el.getAttribute("aria-current"),
        ])
      );

  for (const [path, href, value] of [
    ["/", null, null],
    ["/archive/", "/archive/", "page"],
    ["/digest/", "/digest/", "page"],
    ["/digest/2026-11-23/", "/digest/", "true"],
    ["/changelog/", "/changelog/", "page"],
  ] as const) {
    test(`${path} では ${href ?? "どの項目も"} ${value ?? "印を付けない"}`, async ({
      page,
    }) => {
      await page.goto(path);
      let found = 0;
      for (const nav of ["メインナビゲーション", "サイトナビゲーション"]) {
        const expected =
          href === null ||
          !(await page
            .locator(`nav[aria-label="${nav}"] a[href="${href}"]`)
            .count())
            ? []
            : [[href, value]];
        found += expected.length;
        expect(await current(page, nav)).toEqual(expected);
      }
      if (href !== null) expect(found).toBeGreaterThan(0);
    });
  }
});

test("本文の文字が、ブラウザの文字サイズの設定に従い、印刷では 11pt になる", async ({
  page,
}) => {
  const size = () =>
    page
      .locator(".prose-digest > p")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.goto("/digest/2026-11-23/");
  expect(await size()).toBe(17);
  await page.emulateMedia({ media: "print" });
  expect(await size()).toBeCloseTo((11 * 96) / 72, 1);
  await page.emulateMedia({ media: "screen" });

  const client = await page.context().newCDPSession(page);
  await client.send("Page.setFontSizes", {
    fontSizes: { standard: 20, fixed: 16 },
  });
  await page.reload();
  expect(await size()).toBe(21.25);
});

test("フッターの列見出しが見出しになっている", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator("body > footer").getByRole("heading", { level: 2 })
  ).toHaveText(["探す", "サイト"]);
});
