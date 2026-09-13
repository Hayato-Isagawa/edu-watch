/**
 * VRT の撮影対象。`vrt/pages.spec.ts` と `scripts/__tests__/vrt-targets.test.mjs` が
 * この 1 つの配列を共有する。
 *
 * **spec のソースを正規表現で読む形は採らない。** それだと引用符をシングルに変えた
 * だけで検査が落ち、逆にコメント行に `path: "…"` と書けば件数を水増しできる
 * (edu-law の実測)。データとして持てば、読む側は書き方に依存しない。
 *
 * テンプレート(`src/pages/` の `.astro`)1 本につき代表 URL を 1 件。動的ルート
 * (`[slug]` / `[date]` / `[sourceId]`)は実在する値を 1 つ代表にする。
 * テンプレートを足したら 1 行足す — 対応が崩れると `vrt-targets.test.mjs` が
 * required check で赤にする。
 *
 * `/changelog` は対象に含めない。
 *
 * 更新履歴は PR ごとに先頭へ 1 件増える。ページ全体を撮ると内容の
 * 追加だけで必ず差分が出て、本当の崩れが埋もれる。
 *
 * edu-evidence が #428 で同じ問題を踏み、安定させる方法を 2 つ試して
 * どちらも採らなかった(最古のエントリだけを撮る / 最下部のビューポートを
 * 撮る)。経緯は edu-evidence の `vrt/targets.mjs` 冒頭に残っている。
 * こちらも同じ結論を採る。
 *
 * 共通のヘッダー・フッター・FV は他の 12 ページが押さえている。トップは
 * 更新履歴を描画しないので、外れるのはこのページだけ。
 *
 * @typedef {object} Target
 * @property {string} name テスト名。`vrt/__screenshots__/<project>/<name>.png` になる
 * @property {string} path 撮影する URL
 *
 * @type {Target[]}
 */
export const targets = [
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

/**
 * 撮影オプション。`vrt/pages.spec.ts` が全件に渡し、
 * `scripts/__tests__/vrt-targets.test.mjs` が値を固定する。
 *
 * **spec の引数に直接書くと、値を弱めたことが required check から見えない。**
 * `fullPage` を落とすとビューポート内(desktop 1280x800 / mobile 390x844)しか
 * 撮らなくなるが、テストは全件走り続けて緑のまま通る — `threshold` の
 * 既定 0.2 がガードを黙って殺していた edu-law #160 と同じ形。config の
 * `expect.toHaveScreenshot` には `fullPage` を置けない(Playwright が
 * 受け付けるのはメソッド側だけ)ので、データとして持つ。
 *
 * **残る穴**: 呼び出し側の書き方は見ていない。渡すのをやめる / 渡したうえで
 * `{ ...shotOptions, threshold: 0.2 }` と上書きする(メソッド側の引数は config の
 * `expect.toHaveScreenshot` に優先する)/ widen した再エクスポートを挟む、の
 * いずれも素通りする。固定できるのは値であって、呼び出し側の書き方ではない。
 *
 * @type {{ fullPage: boolean }}
 */
export const shotOptions = { fullPage: true };
