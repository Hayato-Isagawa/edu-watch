# EduEvidence JP との UI/UX 同期マップ

EduWatch JP の UI/UX 判断は姉妹サイト EduEvidence JP を起点として揃える。本書はその同期履歴と未適用判断をまとめ、新規実装時の参照マップとする。

運用ルール: edu-watch の UI/UX は edu-evidence に揃え、差分は意図的なものに限る。

## 1. 揃えた機能

| 機能 | edu-watch の PR | edu-evidence の元実装 |
|---|---|---|
| `.link-underline` の挙動(平常時は親の継承色 → ホバーで accent + アンダーライン伸長) | #40 | `src/styles/global.css` |
| ヘッダー main nav(主要動線をヘッダーに集約) | #40 | `src/layouts/Layout.astro`(`<nav class="...lg:flex hidden">`) |
| フッターをリンクリスト型に再編 | #40 | `src/layouts/Layout.astro` 末尾(edu-evidence は 4 列、edu-watch は 3 列に縮約) |
| `<header>` の sticky 化 + 半透明 bg + `backdrop-filter: blur(8px)` | #42 | `.site-header` |
| モバイルハンバーガーメニュー(`role="dialog"` + フルスクリーンオーバーレイ + 3 本バー × アニメ) | #42 | `src/layouts/Layout.astro`(menu-toggle / mobile-menu) + `.mobile-menu*` CSS |
| Pagefind ベースの全文検索(`/search/` ページ + 結果 UI スタイル) | #43 | `src/pages/search.astro`、build script に `npx pagefind --site dist` |
| ヘッダー検索アイコン + モバイルメニュー先頭の検索フォーム(`/search?q=...`) | #43 | edu-evidence と同じ |
| `back-to-top` ボタン(スクロール 600px 超で出現、smooth scroll、reduced-motion 対応) | #45 | `<button id="back-to-top">` + `#back-to-top` CSS + ScrollY 監視スクリプト |
| `/changelog` ページ(種別ラベル + 日付グループ + 該当ページへのリンク) | #57 | `src/pages/changelog.astro` |
| ハンバーガー breakpoint を `lg`(1024px)に統一 | #80 | 同左(#80 以前は `md` にしていた。項目数が増えて `md` に収まらなくなった) |
| 動的 OG 画像(Satori + Sharp で build 時生成、フォント同梱) | #88(ADR 0031) | `src/pages/og/` 一式。**edu-watch は digest 個別のみ**で、日次記事・ハブページは静的 default(ADR 0032) |
| reading-progress バー(longForm ページ上端に 0 → 100%) | #402 | `<div id="reading-progress">` |

## 2. 意図的差(揃えない判断)

| 項目 | edu-evidence | edu-watch | 理由 |
|---|---|---|---|
| glossary tooltip | 用語に hover/click で `<aside class="glossary-bubble">` を浮かべる、`remark-glossary` で markdown 中の用語自動リンク | 未実装 | edu-watch は用語集を持たない(教育エビデンス用語は edu-evidence の責務) |
| **日次記事の** OG 画像の動的生成 | Satori + Sharp で戦略分のサムネを build 時生成 | 未実装 | 日次記事に中間ページが無い(タイトルクリックは公式 URL に直飛び、ADR 0008)ので記事単位の OG が要らない。**digest 個別の動的 OG は実装済み**(§1・ADR 0031)、ハブページは静的 default(ADR 0032) |
| StrategyRow 風カード(左 3px の accent バー、見出し大、紙面カラム風) | 戦略一覧で多用 | ArticleCard で代替 | edu-watch のカードは新聞風(媒体バッジ + カテゴリバッジ + タイトル + 要約 3 行)が中心 |
| フッター 4 列 | ブランド + Explore — 探す / Learn — 学ぶ・読む / About — サイトについて の 4 列 | **3 列**(ブランド+連絡先 / 探す / サイト) | edu-watch のページ数では 4 列だと余白が目立つ |
| ヘッダー検索アイコンと並ぶ「カラム単位の主要動線」項目 | ホーム / 悩み / 指導法 / コラム / ガイド / サイトについて | カテゴリ / 媒体 / アーカイブ / ダイジェスト / サイトについて + 姉妹サイト | サイト構造が違う(エビデンスポータル vs ニュースアグリゲータ) |
| カテゴリ自動分類のキーワード網 | 戦略カードに紐付くタグセット | 教育ニュース用に拡充(政策・制度 / 研究・エビデンス / 教員・働き方 / ICT/GIGA…) | コンテンツ性質が違う、ADR 0014 で edu-watch 専用に最適化 |

## 3. 将来検討候補(条件次第で 1 へ昇格)

実装を見送ったが、edu-watch のスコープが広がれば再検討する候補:

- **glossary tooltip**: edu-watch が用語ノート(政策キーワード辞典 / 制度用語の解説)を持つ場合。`global.css` に `.glossary-tip` と `.glossary-bubble` のスタイルが持ち込みのまま残っているが、それを出す JS も `remark-glossary` 依存も無い
- **日次記事の OG 画像の動的生成**: ADR 0008 を見直し、記事単位ページを設ける方針に転換した場合(現時点では計画なし)
- **StrategyRow 風カード**: 「特集」「シリーズ」「Pick of the week」のような中間概念を導入する場合

## 4. 新規実装時の進め方

新規 UI / UX を edu-watch で書く前のチェックリスト:

1. **edu-evidence を先に grep**: 姉妹リポジトリの `src/layouts/` / `src/pages/` / `src/components/` / `src/styles/global.css`
2. 該当実装があれば、本書「1. 揃えた機能」表の流儀でポート。edu-watch 固有の調整(項目数差・breakpoint・サイト構造差)は「2. 意図的差」表に沿って判断
3. 該当実装がなければ edu-watch 単独で設計。必要なら edu-evidence にも逆輸入を提案
4. 揃えるべきだが見送る判断をした場合は **本書「2. 意図的差」または「3. 将来検討」に必ず追記** してから次に進む

新たな同期 / 差分が発生したら、本書を PR と同じコミットで更新する。
