import { test, expect } from "@playwright/test";

import { targets as pages, shotOptions } from "./targets.mjs";

// 撮影対象は `vrt/targets.mjs` にある(spec と、required check から走るガードが
// 同じ配列を読むため)。撮影が静かに減る経路 — 対象を消す / ループを絞る /
// `grepInvert` で外す / projects を減らす / skip に差し替える / テンプレートを
// 足して対象に載せ忘れる — は `scripts/__tests__/vrt-targets.test.mjs` が
// `playwright test --list` の実出力と突き合わせて見ている。**この spec の中には
// 置けない** — VRT は required check ではなく、`vrt.yml` の paths に載る PR でしか
// 起動しないので、ここに置いたガードは VRT が走ったときしか働かない。
//
// **`toHaveScreenshot` の引数がガードの死角。** 第 2 引数は config の
// `expect.toHaveScreenshot` を上書きするので、`{ ...shotOptions, threshold: 0.2 }` と
// 書けば `shotOptions` を使ったまま比較を骨抜きにできる(edu-law の実測: 1/255 の
// 色差を注入した dist が passed になる)。**ここに値を書き足さないこと。** 撮り方を
// 変えるなら `vrt/targets.mjs` の `shotOptions` を直す(そちらは required check が
// 固定している)。
//
// 実行時 skip(`test.skip(条件, …)`)も同じ死角にある。`--list` には出ないので、
// CI でだけ全件 skip する形が緑のまま通る。**import 元の差し替え**も同じ —
// `shotOptions` を widen して再エクスポートするファイルを挟めば、撮影件数を
// 保ったまま値だけがずれる。

for (const p of pages) {
  test(p.name, async ({ page }) => {
    await page.goto(p.path, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(`${p.name}.png`, shotOptions);
  });
}
