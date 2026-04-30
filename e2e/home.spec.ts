import { test, expect } from "@playwright/test";

test.describe("トップページ", () => {
  test("タイトルが正しい", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/EduWatch JP/);
  });

  test("FV の見出しが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("一次情報");
  });

  test("3 層ソース説明セクションが存在する", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("文部科学省・国立教育政策研究所", { exact: false }).first()).toBeVisible();
  });

  test("これより古い記事セクションから主要ページに導線がある", async ({ page }) => {
    await page.goto("/");
    const archiveLinks = page.locator('a[href="/archive/"]');
    expect(await archiveLinks.count()).toBeGreaterThanOrEqual(1);
    const categoriesLinks = page.locator('a[href="/categories/"]');
    expect(await categoriesLinks.count()).toBeGreaterThanOrEqual(1);
    const sourcesLinks = page.locator('a[href="/sources/"]');
    expect(await sourcesLinks.count()).toBeGreaterThanOrEqual(1);
  });
});
