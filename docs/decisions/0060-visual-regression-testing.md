# 0060. ビジュアルリグレッションテスト(VRT)を視覚変更 PR に限定して導入する(edu-evidence ADR 0024 ミラー)

- 状態: 採用
- 日付: 2026-06-25
- 関連 PR: test/visual-regression-testing
- 関連 ADR: edu-evidence 0024(原本・本 ADR のミラー元) / edu-watch 0052(e2e の Playwright ブラウザキャッシュ)

## 背景

EduWatch JP は共有レイアウト(`src/layouts/Layout.astro`)・共有コンポーネント(`src/components/`)・単一のグローバル CSS(`src/styles/global.css`、Tailwind v4)で全ページの見た目を統一している。これらは edu-evidence から持ち込んだデザイントークンを土台にしており(rule 7「edu-watch の UI を edu-evidence に揃える」)、手を入れるとダイジェスト・アーカイブ・カテゴリ・ソース各ハブへ視覚的影響が波及する。現状その回帰は手動の目視でしか検出できていない。

既存の e2e(`playwright.config.ts` / `e2e/` / ADR 0052)は DOM 構造・テキスト・属性の機能テストであり、レイアウト崩れ・余白・配色といったピクセルレベルの回帰は対象外である。一方で記事データ(`src/data/articles/*.json`)・ダイジェスト(`src/content/digests/*.md`)の更新は日々テキスト差分を生むため、全 PR に VRT をかけると差分がノイズだらけになる。

edu-evidence は ADR 0024 で、視覚面に触れる PR だけに走るゲート付き VRT を案 A(CI 内で main と PR を両方ビルドし同一 Linux 環境で撮影・比較)で導入済みである。ファミリー横展開方針(ADR 0024 末尾)と rule 7 に従い、UI 一致度が最も高い edu-watch へ最初にミラーする。

## 決定

edu-evidence ADR 0024 の構成を **機械的にミラー** して導入する。

- スペック: `vrt/`(機能テストの `e2e/` とは別ディレクトリ)。テンプレートごとに代表 1 ページ(計 13): トップ / ダイジェスト一覧・詳細 / アーカイブ一覧・詳細 / カテゴリ一覧・詳細 / ソース一覧・詳細 / about / 検索 / changelog / 404。同一テンプレートの複数ページは 1 枚で代表する。
- 設定: `playwright.vrt.config.ts`(`testDir: ./vrt`、desktop 1280 / mobile 390 の 2 projects、`maxDiffPixelRatio 0.01`、アニメーション無効化、`expect.timeout 30000`)。
- ベースラインはコミットしない。`vrt/__screenshots__/` は `.gitignore` で除外する。
- ゲート: `.github/workflows/vrt.yml` を `pull_request` の `paths` フィルタで `src/layouts/**`・`src/components/**`・`src/styles/**`・`astro.config.*`・`vrt/**`・`playwright.vrt.config.ts`・`.github/workflows/vrt.yml` に限定する。`src/data/**`・`src/content/**` だけの PR では起動しない。`workflow_dispatch` で手動実行も可能。
- 2 ビルド差分(案 A): CI ジョブ内で PR ブランチをビルド(`dist-pr`)、`git worktree` で main をビルド(`dist-main`)し、main を `--update-snapshots` で撮影してベースライン化、続けて PR を同一環境で撮影・比較する。
- required check には含めない。VRT は視覚変更 PR でしか起動せず、結果は情報提供でマージ可否は編集者が判断する(rule 13)。

### edu-watch 固有の差分

- **ポートは既存 e2e と同じ 4174。** edu-watch には既に e2e(ADR 0052、port 4174)があり、VRT も同ポートを使う。VRT と e2e は別プロセス・別 CI ジョブで動くため衝突しない。
- **node は 24 で一貫。** `engines.node >=24.0.0` / `.tool-versions` / 既存ワークフローと一致し、e2e との不一致はない。`@playwright/test ^1.61.0` は導入済みで追加依存はない。
- **worktree パスは `/tmp/edu-watch-main`**(原本は `/tmp/evi-main`)。

## なぜこの判断にしたか

- rule 7 で UI を edu-evidence に揃えているため、共有レイアウト・`global.css` 改修時の視覚回帰検出の恩恵が 3 姉妹サイト中で最も大きい。だからファミリー横展開の最初の移植先に選んだ。
- 案 A はベースライン PNG をコミットしないため、リポジトリが肥大化せず、ローカル(macOS)と CI(Linux)でのフォント描画差も同一 Linux ジョブ内の 2 ビルド比較でキャンセルされ、検出される差分は実変更のみとなる。
- 原本(ADR 0024)と同一構成にすることで、ファミリー横断のメンテナンスコストを最小化できる(aria/data 属性・アクセントバー・changelog 文体を 3 リポで揃えてきた方針と一貫)。

## 帰結

- 共有レイアウト・コンポーネント・`global.css` 改修時の視覚回帰を、目視に頼らず差分画像で確認できる。
- 記事・ダイジェストのデータ更新 PR は `paths` ゲート対象外のため、日常の更新を妨げない。
- 既存 e2e(`e2e.yml`)は変更しない。VRT は別ワークフロー・別ディレクトリで併走する。
- ローカルでは `npm run vrt`(現在の `dist` に対する撮影・比較)で確認できる。権威ある 2 ビルド差分は CI で行う。
- 後続として edu-law へミラーする(edu-law は Playwright 未導入のため `@playwright/test` の追加から)。

## トレードオフ / 既知のリスク

- 視覚変更 PR では main と PR を 2 回ビルドするため、1 回の VRT 実行に追加のビルド時間がかかる。
- 対象 URL・差分閾値は手動メンテナンスが必要。テンプレートを追加したら `vrt/pages.spec.ts` に代表 URL を 1 行追記する。
- `fullPage` 撮影は最長ページで 1px 単位の揺れが出ることがある。撮影前に末尾→先頭へスクロールして遅延読み込みを settle させる安定化を原本から継承済みだが、CI で揺れが残る場合は該当ページを viewport clip / mask にフォールバックする。

## 撤回 / 再検討の条件

- フォント描画が環境非依存になる方針(Web フォントの自前ホスト等)へ変える場合は、ベースラインの持ち方(案 A / 案 B)を再検討する。
- 共通レイアウトを npm package 化してファミリーで共有する場合は、VRT の置き場所(各リポか共通パッケージか)を再定義する。
