import { test, expect } from "@playwright/test";

interface PageTarget {
  name: string;
  path: string;
  expectInH1: RegExp | string;
}

const targets: PageTarget[] = [
  { name: "アーカイブ", path: "/archive/", expectInH1: /アーカイブ|日付/ },
  { name: "カテゴリ一覧", path: "/categories/", expectInH1: /カテゴリ/ },
  { name: "媒体一覧", path: "/sources/", expectInH1: /媒体/ },
  { name: "ダイジェスト一覧", path: "/digest/", expectInH1: /ダイジェスト/ },
  { name: "サイトについて", path: "/about/", expectInH1: /サイト/ },
  { name: "更新履歴", path: "/changelog/", expectInH1: /更新履歴/ },
];

test.describe("主要ページのスモーク", () => {
  for (const { name, path, expectInH1 } of targets) {
    test(`${name} (${path}) — 200 + 主要見出しが描画される`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1").first()).toContainText(expectInH1);
    });
  }
});
