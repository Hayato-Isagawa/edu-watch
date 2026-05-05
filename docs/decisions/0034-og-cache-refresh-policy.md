# 0034. OG 画像キャッシュ更新ポリシー(姉妹サイト ADR の edu-watch 適用)

- 状態: 採用
- 日付: 2026-05-05
- 関連 PR: 本 ADR と同一 PR で確定
- 起点 ADR: ISAGAWA HAYATO Portfolio ADR 0003(共通フレーム + SNS runbook の元、PR #44 マージ済)
- 姉妹サイト ADR: edu-evidence ADR 0019(動的 73 + 静的 default 1 への適用、PR #162 マージ済)
- 関連 ADR: 0031(ダイジェスト個別ページに動的 OG 画像生成を導入)/ 0032(静的 default OG 画像)

## 背景

姉妹リポジトリ ISAGAWA HAYATO Portfolio で ADR 0003 として OG 画像キャッシュ更新ポリシーを確定し、続いて edu-evidence で ADR 0019 として「動的 OG 73 枚 + 静的 default OG 1 枚」へ適用した。共通の判断フレーム(更新が必要 / 不要のケース、選択肢 C = URL クエリ + Facebook/LinkedIn Debugger 併用)と SNS 別 runbook(Facebook / LinkedIn / Slack / X)は portfolio ADR 0003 に同梱されている。本 ADR は edu-watch 固有の OG 構成への適用を扱う。

edu-watch の OG は 2 系統で構成されている:

- **動的 OG(digest 個別)**: `/og/digest/<slug>.png`(ADR 0031、`src/pages/og/digest/[slug].png.ts` が build 時生成、フォント同梱)
- **静的 default OG**: `/og-image.png`(ADR 0032、digest 以外のすべてのページの fallback)

両者で更新トリガーと頻度が異なるため、portfolio とは別レイヤの判断が必要(portfolio は静的 1 枚のみ、ブランド改修時のみの更新)。本 ADR で edu-evidence 側の構造をミラーし、姉妹 3 リポジトリで OG キャッシュ更新ポリシーを揃える。

## 共通フレームの再掲(portfolio ADR 0003 より)

- **採用方針**: URL クエリ `?v=` で別 URL 化(主軸) + Facebook / LinkedIn の公式 Debugger で念押し(併用)
- **X(旧 Twitter)** には公式リフェッチ手段が 2022 年 8 月以降存在しない → URL クエリ方式が事実上唯一の確実策
- **判断基準**: OG 画像の見た目に差分が出るか。出るなら `?v=` を更新、出ないなら据え置き
- **SNS 別 runbook**(Facebook / LinkedIn / Slack / X の操作手順): portfolio ADR 0003 §runbook を参照(本 ADR では再掲しない)

## 検討した選択肢

### A) 動的 OG と静的 default OG で異なる `?v=` 戦略を取る(採用)

- 動的 OG(digest 個別): frontmatter `publishedAt` の date 部分(YYYYMMDD)を `?v=` に流用
- 静的 default OG: ブランド改修時の `?v=YYYYMMDD`(portfolio / edu-evidence と同方針)

**利点**:

- 動的 OG は digest が再公開・修正されるとき `publishedAt` を更新する運用と整合し、`?v=` 更新が **frontmatter 編集だけで自動化** される
- 静的 default はブランド改修時のみ手動更新、頻度低
- 既存スキーマを再利用、新しい frontmatter フィールド追加が不要(`publishedAt` は `src/content.config.ts` の zod スキーマで required)
- edu-evidence ADR 0019 の構造(動的 = frontmatter 由来、静的 = 定数)を完全にミラー

**欠点**:

- digest を一度公開した後に修正したいケースでは、`publishedAt` を編集日時に書き換える運用ルールを徹底する必要がある(現状そうした修正運用は未確立だが、視覚差分が出る修正は稀)

### B) 新フィールド `lastUpdated` を digest スキーマに追加

- 利点: edu-evidence の `lastVerified` と意味的に最も近く、修正運用が明示的に分離される
- 欠点: スキーマ変更が必要、現状 digest 修正頻度が低いため過剰投資。混乱が生じた時点で本 ADR §撤回・再検討条件の経路で導入する

### C) 全 OG で `?v=YYYYMMDD` を共通の単一定数で管理

- 利点: 単一規則
- 欠点: digest 個別の内容変更が `?v=` に伝搬されないため、digest 修正が反映できない(全 digest が一括バージョン更新されるのは不自然)

## 決定

**選択肢 A を採用。**

### 1. 動的 OG (digest 個別) の `?v=` — frontmatter `publishedAt` 流用

`Layout.astro` の `ogImagePath` 経由で渡される URL に対して、`ogVersion` プロパティで `?v=` を付与する。digest ページからは `entry.data.publishedAt` の date 部分(`YYYY-MM-DD`)から `-` を除いた `YYYYMMDD` を渡す:

```diff
 // src/layouts/Layout.astro(該当部分、本 ADR 採択時点ではまだ実装しない)
 interface Props {
   title?: string;
   description?: string;
   ogImagePath?: string;
+  ogVersion?: string;  // YYYYMMDD 形式、digest 個別ページのみ渡す
 }

- const ogImage = ogImagePath ? `${siteUrl}${ogImagePath}` : `${siteUrl}/og-image.png`;
+ const versionQuery = ogVersion ? `?v=${ogVersion}` : "";
+ const ogImage = ogImagePath
+   ? `${siteUrl}${ogImagePath}${versionQuery}`
+   : `${siteUrl}/og-image.png?v=${OG_DEFAULT_VERSION}`;
```

```diff
 // src/pages/digest/[slug].astro(該当部分)
   ogImagePath={`/og/digest/${entry.id}.png`}
+  ogVersion={entry.data.publishedAt.slice(0, 10).replaceAll("-", "")}
```

`publishedAt` は `src/content.config.ts` の zod スキーマで `z.string().datetime({ offset: true })` として required、ISO datetime 形式で必ず存在する。`slice(0, 10)` で `YYYY-MM-DD` 部分を切り出してから `-` を除く。

### 2. 静的 default OG の `?v=` — ブランド改修時の手動更新

`OG_DEFAULT_VERSION` 定数を導入する。配置先は `src/data/og-version.ts`(新規、edu-evidence ADR 0019 と同一構成)。

```typescript
// src/data/og-version.ts
export const OG_DEFAULT_VERSION = "20260504"; // ADR 0032 で /og-image.png を整備した日
```

ブランド改修時(ディープネイビートークン変更 / wordmark 変更 / `scripts/generate-default-og.ts` のレイアウト変更等で `public/og-image.png` の見た目が変わる場合)に、`OG_DEFAULT_VERSION` を生成日に揃えて更新する。

### 3. 本 ADR 採択時点での実装範囲

portfolio ADR 0003 / edu-evidence ADR 0019 と揃えて、**本 ADR を採択する PR では `Layout.astro` 等のコード変更を行わない**。理由:

- ADR は方針の固定が役割、実装は別 PR で動作確認しながら進める
- 実装は `Layout.astro` + `src/data/og-version.ts`(新規)+ `src/pages/digest/[slug].astro` の 3 箇所が連動するため、レビュー粒度を分けたい

実装 PR の構成は次のとおり(別 PR で起こす):

1. `src/data/og-version.ts` を新規作成、`OG_DEFAULT_VERSION = "20260504"` を export
2. `Layout.astro` の `Props` に `ogVersion` を追加、`ogImage` 構築を `?v=` 付き URL に変更(`twitter:image` も同じ `ogImage` を参照しているので同時に反映される)
3. `src/pages/digest/[slug].astro` で `ogVersion={entry.data.publishedAt.slice(0, 10).replaceAll("-", "")}` を渡す
4. ビルド後に `dist/digest/<slug>/index.html` を grep して `og:image` の URL に `?v=` が含まれていることを確認

## 判断フレーム — edu-watch 固有の更新トリガー

### 動的 OG(`/og/digest/<slug>.png`)

| 操作 | OG 更新が必要か | 仕組み |
|---|---|---|
| 新しい digest を新規公開 | 必要 | `publishedAt` が新規日時なので `?v=` も新規 |
| 既存 digest の `title` 変更 | 必要 | 修正時に `publishedAt` を編集日時に書き換える運用 |
| 既存 digest の `topics` 配列変更 | 必要 | 同上(OG 画像下段にチップ表示) |
| 既存 digest の `weekStart` / `weekEnd` 変更 | 必要 | 同上(OG 画像上段に期間表示)。ただし通常変更しない |
| 既存 digest の `summary` 変更 | OG 観点では不要 | OG 画像に summary は出ない、`publishedAt` 据え置きでよい |
| 既存 digest の `sections` / 本文 markdown のみ変更 | OG 観点では不要 | OG 画像に出ない領域の編集は `publishedAt` 据え置きでよい |
| `src/lib/og-image.ts` のレイアウト変更 | **全 digest で必要** | この場合は別 ADR or 全 digest の `publishedAt` 一括更新コミットが要る(後述) |

`og-image.ts` のレイアウト自体を変える場合は、digest 全件の `publishedAt` を更新するか、別の `?v=` ハンドリングを検討する必要がある(本 ADR のスコープ外、その時点で別 ADR を起こす)。

### 静的 default OG(`/og-image.png`)

| 操作 | OG 更新が必要か | 仕組み |
|---|---|---|
| ブランド改修(色トークン / wordmark / tagline) | 必要 | `OG_DEFAULT_VERSION` を生成日に手動更新 |
| `scripts/generate-default-og.ts` のレイアウト変更 | 必要 | 同上 |
| ハブページ(トップ / カテゴリ / 媒体 / アーカイブ等)の本文・カードレイアウト変更 | 不要 | OG 画像自体は変わらない |

## edu-watch 固有の運用ワークフロー

### digest を新規公開するとき(編集者向け)

1. `src/content/digests/YYYY-MM-DD.md` を作成、`publishedAt` を公開時刻 ISO datetime で記述(現行運用と同じ)
2. ビルド時に `/og/digest/<slug>.png` が生成される
3. デプロイ後、必要に応じて Facebook Sharing Debugger / LinkedIn Post Inspector で `https://news.edu-evidence.org/digest/<slug>/` を再スクレイプ
4. X 側は新規 URL なのでカード反映、過去シェアは概念上発生しない(初公開のため)

### 既存 digest を修正するとき(視覚差分あり、編集者向け)

1. frontmatter の `publishedAt` を編集日時の ISO datetime に書き換える(`?v=` 更新トリガー)
2. ビルド時に `/og/digest/<slug>.png` が再生成される
3. デプロイ後、portfolio ADR 0003 §runbook §2 に従って Facebook / LinkedIn Debugger で念押し
4. X 側は `?v=` が変わっているので新規シェアに新 OG が反映、過去シェアは最大 7 日待ち

### 既存 digest を修正するとき(視覚差分なし、編集者向け)

1. frontmatter の `publishedAt` は据え置きで、本文 markdown / `sections` / `summary` のみ編集
2. OG 画像は再生成されないため、SNS キャッシュ操作は不要

### ブランド改修するとき(設計者 / 開発者向け)

1. `scripts/generate-default-og.ts` のレイアウトまたはトークンを変更
2. `npm run og:default` で `public/og-image.png` を再生成
3. `src/data/og-version.ts` の `OG_DEFAULT_VERSION` を改修日(YYYYMMDD)に更新
4. 同一コミットで `public/og-image.png` と `og-version.ts` を含める
5. デプロイ後、portfolio ADR 0003 §runbook §2 に従って Facebook / LinkedIn Debugger で念押し

### 動的 OG レイアウト全体改修(設計者 / 開発者向け、まれ)

1. `src/lib/og-image.ts` または `src/pages/og/digest/[slug].png.ts` のレイアウト変更
2. 全 digest の `publishedAt` を一括更新するコミット(or 別 ADR で個別ハンドリングを設計)
3. 通常デプロイ

## 影響

- 次回の digest 新規公開コミットで初めて `?v=` 付きの OG URL が出力される(実装 PR マージ後)
- 過去にシェアされた digest URL の OG キャッシュは、各 SNS の自然失効(約 7 日)を待つ + 必要なら Debugger で念押し
- 既存 digest の修正運用フローに「視覚差分が出る修正は `publishedAt` を編集日時に書き換える」が組み込まれる(`?v=` 更新と画像再生成のため)
- ブランド改修ワークフローに「`OG_DEFAULT_VERSION` を更新する」を追加

## スコープ外

- `og:title` / `og:description` のキャッシュ更新(SNS が `?v=` なしでも検出するケースが多く、本 ADR では画像に絞る)
- `og-image.ts` のレイアウト全体改修時の digest 一括 `publishedAt` 更新 — 必要になった時点で別 ADR
- 日次記事ページ(`/articles/...`)の動的 OG 化 — ADR 0031 のスコープ外決定と整合
- カテゴリ別 / 媒体別 / 月別アーカイブ等の動的 OG 化 — ADR 0032 と同じくスコープ外
- Bluesky / Threads / Mastodon 等の他 SNS — 同様に `?v=` 方式が有効。運用ターゲットになった時点で portfolio ADR 0003 の表に追記する

## 撤回 / 再検討の条件

- X が公式の Card Validator 相当を再提供した場合、portfolio ADR 0003 / edu-evidence ADR 0019 とともに選択肢 B(URL クエリなし + Debugger 単独)へ戻すか再検討
- Cloudflare Pages 等で `og:image` にクエリを付けた際の HTTP/CDN キャッシュ挙動に不具合が出た場合、画像ファイル名自体に日付を入れる方式(`og/digest/<slug>-20260505.png`)に切り替え
- digest 修正運用が頻発し、`publishedAt` を「初公開日時」と「OG キャッシュ更新日」の二重で扱うことに混乱が生じた場合、本 ADR §検討した選択肢 B(専用の `lastUpdated` フィールドを digest スキーマに追加して分離)へ切替

## 関連参照

- 起点 ADR: ISAGAWA HAYATO Portfolio ADR 0003(共通フレーム + SNS runbook、`docs/decisions/0003-og-cache-refresh-policy.md`)
- 姉妹サイト ADR: edu-evidence ADR 0019(動的 73 + 静的 default 1 への適用、`docs/decisions/0019-og-cache-refresh-policy.md`)
- ADR 0031(ダイジェスト個別ページに動的 OG 画像生成を導入)
- ADR 0032(静的 default OG 画像を整備し、個別 OG を持たないページのフォールバックとする)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
- [Twitter card validator is gone — X Developers](https://devcommunity.x.com/t/twitter-card-validator-is-gone-and-it-does-not-work/218740)
- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
- [LinkedIn Post Inspector ヘルプ](https://www.linkedin.com/help/linkedin/answer/a6233775)
