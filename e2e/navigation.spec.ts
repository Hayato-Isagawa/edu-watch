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
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("body")).toHaveAttribute("data-menu", "open");
    await toggle.click();
    await expect(menu).toHaveAttribute("inert", "");
    await expect(menu).toHaveAttribute("data-state", "closed");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("body")).toHaveAttribute("data-menu", "closed");
  });

  test("モバイルメニューに 4 つのセクション(Explore / About / Sister Sites / Display)が表示される", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    const titles = page.locator(".mobile-menu-section-title");
    await expect(titles).toHaveCount(4);
    await expect(titles.nth(0)).toContainText("Explore");
    await expect(titles.nth(1)).toContainText("About");
    await expect(titles.nth(2)).toContainText("Sister Sites");
    await expect(titles.nth(3)).toContainText("Display");
  });

  test("モバイルメニューを開くと検索 input にフォーカスが移る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    await page.waitForTimeout(120);
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("mobile-menu-search-input");
  });

  test("検索 input から submit すると /search?q= に遷移する", async ({
    page,
  }) => {
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
    const position = await header.evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(position).toBe("sticky");
  });

  test("ページ上部へ戻るボタンが 600px スクロール後に表示される", async ({
    page,
  }) => {
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

test.describe("モバイルメニュー", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const behind = ["main", "body > footer", "#back-to-top", ".skip-link"];

  test("開いている間だけ、裏の本文・フッターを inert にする", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.locator("#menu-toggle");
    await toggle.click();
    for (const selector of behind) {
      await expect(page.locator(selector)).toHaveAttribute("inert", "");
    }
    await toggle.click();
    for (const selector of behind) {
      await expect(page.locator(selector)).not.toHaveAttribute("inert");
    }
  });

  test("開いている間、Tab が裏の本文に入らず、閉じるボタンへは届く", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#menu-toggle").click();
    // 開いて 50ms 後にメニューの中へ焦点が移るのを待つ(待たないと、下で動かした位置が上書きされる)
    await expect(page.locator("#mobile-menu :focus")).toHaveCount(1);
    await page.locator("#mobile-menu :is(a, button)").last().focus();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      seen.add(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return "body";
          if (el.closest("#mobile-menu")) return "menu";
          if (el.closest("header")) return "header";
          return el.closest("main") ? "main" : "other";
        })
      );
    }
    expect(seen).not.toContain("main");
    expect(seen).not.toContain("other");
    expect(seen).toContain("header");
  });

  test("リンクを押すとメニューが閉じる", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      document.addEventListener("click", (e) => e.preventDefault())
    );
    await page.locator("#menu-toggle").click();
    await page.locator("#mobile-menu nav a").first().click();
    await expect(page.locator("#mobile-menu")).toHaveAttribute(
      "data-state",
      "closed"
    );
    await expect(page.locator("main")).not.toHaveAttribute("inert");
  });
});
