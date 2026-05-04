# 0032. 静的 default OG 画像を整備し、個別 OG を持たないページのフォールバックとする

- 状態: 採用
- 日付: 2026-05-04
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0031(ダイジェスト個別ページに動的 OG 画像生成を導入)

## 背景

ADR 0031 でダイジェスト個別ページ(`/digest/[slug]/`)の動的 OG 画像生成を導入したが、対象は **ダイジェスト個別** に限定している。トップ・カテゴリ別(`/categories/<slug>`)・媒体別(`/sources/<sourceId>`)・日次記事一覧・アーカイブ・`/about`・`/changelog` など、固有の動的データを持たない URL は `src/layouts/Layout.astro` の以下のフォールバックに依存する。

```ts
const ogImage = ogImagePath ? `${siteUrl}${ogImagePath}` : `${siteUrl}/og-image.png`;
```

実態は次のとおり。

- `public/og-image.png` が存在せず、SNS シェア時に画像が表示されない状態だった(ADR 0031 §スコープ外で「シェアでは OG 画像が出ない状態が一時的に続く」と明記、本 ADR で解消する)
- ダイジェスト以外のページは本サイトの全体的な性格(EduWatch JP / 一次情報からの教育ニュース)を伝える共通画像があれば SNS シェア体験として十分

## 検討した選択肢

### A) 静的 default PNG を 1 枚整備し、個別 OG を持たないページの共通フォールバックとする(採用)

- 利点:
  - 動的生成と違い build-time コストゼロ。GitHub Actions と Cloudflare Pages の build 時間を増やさない
  - SNS 露出の少ない URL(媒体ページ・カテゴリ等)に過剰投資しない
  - 1 枚の PNG をブランド改修の節目で再生成すれば良く、運用が単純
  - スクリプト構成は ADR 0031 の動的版と同じ Satori + Sharp + 同梱フォントで完結し、依存追加なし
- 欠点:
  - カテゴリ別 / 媒体別の見分けがシェア時にはつかない(URL とタイトルで識別する)

### B) 動的 OG をトップ・カテゴリ等にも拡張する

- 利点: ページごとの絵がリッチになる
- 欠点: トップ・カテゴリ・媒体の表示テキストは固定的で、動的化の利点が薄い。build-time の生成枚数が増えてビルド遅延のリスクが上がる(ダイジェスト + 8 カテゴリ + 7 媒体 + アーカイブ等で枚数倍増)

### C) 主要ハブだけ個別の静的 PNG を持つ(トップ・`/digest`・`/about` など 2〜3 枚)

- 利点: 主要ハブのシェア時の見栄えだけ強くできる
- 欠点: 静的 PNG が複数になり管理が増える割に、案 A との差分が小さい

## 決定

**選択肢 A** を採用。`scripts/generate-default-og.ts` を新規作成し、`npm run og:default` で `public/og-image.png` を再生成できるようにする。Layout のフォールバック実装は既に `/og-image.png` を指しているため変更不要。

### 変更内容

- `scripts/generate-default-og.ts` 新規。ADR 0031 と同じ Satori + Sharp + 同梱フォント(`scripts/fonts/noto-sans-jp-bold.bin`)で 1200×630 の PNG を生成
- `package.json` に `"og:default": "npx tsx scripts/generate-default-og.ts"` を追加
- `public/og-image.png` を新規生成

### レイアウト構成(本 ADR で確定)

| 要素 | 内容 |
|---|---|
| 背景 | `#faf9f5`(本サイトの surface トークン) |
| 左端アクセントバー | 8px、`#1e4a6e`(`--color-accent` 相当のディープネイビー) |
| kicker | `EduWatch JP`、ディープネイビー、letter-spacing `0.18em`、UPPERCASE |
| ヘッドライン | 「一次情報から、」「教育の今を追う。」(2 行)、84px、Black |
| サブ | 「文科省・教育専門紙の教育情報を日次で。」、26px、Bold、`#3a3a36` |
| ドメイン | `news.edu-evidence.org`、18px、`#6b6b66`、右下 |

ヘッドラインはトップ H1 と完全一致。「一次情報」の役割を SNS シェアでも先頭に立てる。

## 帰結

- ダイジェスト以外の URL でも SNS シェア時に EduWatch JP のブランドが伝わる画像が表示される
- `npm run og:default` 1 コマンドでブランド改修時に再生成できる
- 動的 OG(ADR 0031、ダイジェスト個別)+ 静的 default OG(本 ADR、それ以外)で OG 全体の責任分界が明確になる

## スコープ外

- 日次記事(`/articles/...`)の動的 OG 化(数が多く、ダイジェスト共有が主軸)
- カテゴリ別 / 媒体別 / 月別アーカイブ等の動的 OG 化(SNS シェア計測で必要と判明した時点で別 ADR で検討)
- `/about` `/changelog` 等のハブページの個別静的 OG 化

## 撤回 / 再検討の条件

- SNS シェア計測でカテゴリ別 OG の有意な効果が観測されたら、案 C(主要ハブのみ静的個別)へ拡張
- ダイジェスト以外の個別ページ(日次記事など)に動的 OG を入れる判断が出たら、ADR 0031 のスコープを拡大する形で別 ADR を起こす

## 関連参照

- ADR 0031(ダイジェスト個別ページに動的 OG 画像生成を導入)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
