import { defineConfig } from "@playwright/test";

const dist = process.env.VRT_DIST ?? "dist";

export default defineConfig({
  testDir: "./vrt",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // リトライしない。同一ビルド同士の撮り比べで差分が 0 になることを実測して
  // いる(閾値 0 で 24 件全通過 × 2 回)ので、落ちたのは基本的に本物である。
  // リトライを入れると、間欠的に出る問題を握り潰す。
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  snapshotPathTemplate: "vrt/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    timeout: 30000,
    toHaveScreenshot: {
      // 比率(maxDiffPixelRatio)はやめた(ADR 0068)。許容量 = 総ピクセル数 × 比率
      // なのでページの長さに比例し、長いページほど甘い(edu-law の実測では
      // 0.001 の許容が短いページと長いページで約 15 倍開いた)。0.01 → 0.001 に
      // 下げた経緯と実測値は CLAUDE.md の VRT 節が正典。
      //
      // 色差: Playwright が pixelmatch に渡す threshold(既定 0.2)未満の色差は
      // 差分として数えられないので、比率をいくら下げても色だけの変更は捕まらない
      // (edu-law #160 で省庁バッジの色変更を取り逃がした実例)。
      //
      // threshold と maxDiffPixels は最終判定だけでなく、撮影の安定化ループ
      // (連続 2 枚が一致するまで撮り直す)の収束条件でもある。収束しないと
      // expect.timeout に達して "Failed to take two consecutive stable
      // screenshots" で落ちる。CI(Linux)のノイズは PR 自身の run を 3 回まわして
      // 測った(ADR 0068)。
      threshold: 0,
      // threshold: 0 はバイト完全一致ではない。pixelmatch の includeAA(既定
      // false・Playwright は上書きしない)により、アンチエイリアスと判定された
      // 画素は差分に数えない。エッジだけが変わる変更は残る盲点。
      //
      // maxDiffPixels は未指定でも 0 になるが、型定義は "unset by default" と
      // しか書いておらず契約ではない。threshold の既定 0.2 がガードを黙って
      // 殺していたのと同じ形に戻さないため、明示する。
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: "http://localhost:4174",
  },
  // 断面は viewport × テーマ の 4 つ。**テーマは `data-theme` を直接立てず
  // `colorScheme` で与える** — `Layout.astro` の起動スクリプトが
  // localStorage → `prefers-color-scheme` の順に見て `data-theme` を決めるので、
  // エミュレーションを使えばその経路ごと撮れる。localStorage が空なら
  // `prefers-color-scheme` に落ちる — **だから `storageState` をここに置かない**。
  // `localStorage.theme = "light"` を注入した state を渡すと、`colorScheme: "dark"` の
  // project がそのまま light を描く(実測)。未設定であることは
  // `scripts/__tests__/vrt-targets.test.mjs` が固定している。
  //
  // ダークを撮るまで **1 枚も写っていなかった**。ダーク側は `[data-theme="dark"]` で
  // 色トークンを 11 宣言まとめて差し替える形(テンプレートに `dark:` 変種は無く、
  // `@variant dark` は定義だけ)なので、**全ページの見た目が変わるのにピクセル検査は
  // 1 度も通っていない**状態だった。`e2e/` もテーマを切り替えていないので、ダークの
  // コントラストも崩れも、どのゲートにも写っていなかった。
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 }, colorScheme: "light" },
    },
    {
      name: "desktop-dark",
      use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, colorScheme: "light" },
    },
    {
      name: "mobile-dark",
      use: { viewport: { width: 390, height: 844 }, colorScheme: "dark" },
    },
  ],
  webServer: {
    // serve は devDependencies に入れてある。入れずに npx で呼ぶと CI が
    // 実行のたびに npm から最新版を取ってきて走らせることになる。
    command: `npx serve ${dist} -l 4174`,
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});
