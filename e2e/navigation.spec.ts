import { test, expect } from "@playwright/test";

test.describe("ナビゲーション", () => {
  test("モバイルメニューが開閉する", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const toggle = page.locator("#menu-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    const menu = page.locator("#mobile-menu");
    await expect(menu).not.toHaveAttribute("inert");
    await expect(menu).toHaveAttribute("data-state", "open");
    await expect(menu).toHaveAttribute("role", "dialog");
    await expect(menu).toHaveAttribute("aria-modal", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("body")).toHaveAttribute("data-menu", "open");
    await toggle.click();
    await expect(menu).toHaveAttribute("inert", "");
    await expect(menu).toHaveAttribute("data-state", "closed");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("body")).toHaveAttribute("data-menu", "closed");
  });

  test("モバイルメニューに 3 つのセクション(Explore / About / Sister site)が表示される", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    const titles = page.locator(".mobile-menu-section-title");
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toContainText("Explore");
    await expect(titles.nth(1)).toContainText("About");
    await expect(titles.nth(2)).toContainText("Sister site");
  });

  test("モバイルメニューを開くと検索 input にフォーカスが移る", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    await page.waitForTimeout(120);
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("mobile-menu-search-input");
  });

  test("検索 input から submit すると /search?q= に遷移する", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    const input = page.locator("#mobile-menu-search-input");
    await input.fill("文科省");
    await input.press("Enter");
    await page.waitForURL(/\/search\/?\?q=/);
    expect(page.url()).toContain("/search");
    expect(page.url()).toContain("q=");
  });

  test("ヘッダーが sticky で表示される", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header.site-header");
    await expect(header).toBeVisible();
    const position = await header.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe("sticky");
  });

  test("ページ上部へ戻るボタンが 600px スクロール後に表示される", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("#back-to-top");
    await expect(btn).toHaveAttribute("data-state", "hidden");
    await expect(btn).toHaveAttribute("aria-hidden", "true");
    await page.evaluate(() => window.scrollTo(0, 800));
    await expect(btn).toHaveAttribute("data-state", "visible");
    await expect(btn).toHaveAttribute("aria-hidden", "false");
    await btn.click();
    await page.waitForFunction(() => window.scrollY < 10);
    await expect(btn).toHaveAttribute("data-state", "hidden");
  });

  test("ヘッダーから主要ページへ遷移できる", async ({ page }) => {
    await page.goto("/");
    await page.locator('header a[href="/categories/"]').click();
    await page.waitForURL(/\/categories\/$/);
    await expect(page.locator("h1")).toBeVisible();
  });
});
