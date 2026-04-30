import { test, expect } from "@playwright/test";

test.describe("検索", () => {
  test("検索ページが表示される", async ({ page }) => {
    await page.goto("/search/");
    await expect(page.locator("h1")).toContainText("検索");
    await expect(page.locator("#search")).toBeVisible();
  });
});

test.describe("404", () => {
  test("存在しないページで 404 が表示される", async ({ page }) => {
    await page.goto("/this-page-does-not-exist/");
    await expect(page.locator("h1")).toContainText("404");
  });
});
