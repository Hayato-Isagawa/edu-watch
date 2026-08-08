import { test, expect } from "@playwright/test";

/**
 * `/changelog` は対象に含めない。
 *
 * 更新履歴は PR ごとに先頭へ 1 件増える(rule 8)。ページ全体を撮ると内容の
 * 追加だけで必ず差分が出て、本当の崩れが埋もれる。
 *
 * edu-evidence が #428 で同じ問題を踏み、安定させる方法を 2 つ試して
 * どちらも採らなかった(最古のエントリだけを撮る / 最下部のビューポートを
 * 撮る)。経緯は edu-evidence の `vrt/pages.spec.ts` 冒頭に残っている。
 * こちらも同じ結論を採る。
 *
 * 共通のヘッダー・フッター・FV は他の 12 ページが押さえている。トップは
 * 更新履歴を描画しないので、外れるのはこのページだけ。
 */
const pages = [
  { name: "home", path: "/" },
  { name: "digest-index", path: "/digest" },
  { name: "digest-detail", path: "/digest/2026-06-20" },
  { name: "archive-index", path: "/archive" },
  { name: "archive-detail", path: "/archive/2026-06-20" },
  { name: "categories-index", path: "/categories" },
  { name: "category-detail", path: "/categories/ijime" },
  { name: "sources-index", path: "/sources" },
  { name: "source-detail", path: "/sources/mext" },
  { name: "about", path: "/about" },
  { name: "search", path: "/search" },
  { name: "not-found", path: "/404" },
];

for (const p of pages) {
  test(p.name, async ({ page }) => {
    await page.goto(p.path, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true });
  });
}
