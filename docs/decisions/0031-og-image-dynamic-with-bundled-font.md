# 0031. ダイジェスト個別ページに動的 OG 画像生成を導入(フォントは同梱)

- 状態: 採用
- 日付: 2026-05-04
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0023(stacked hero with large H1)/ 0025(system font stack — クライアント配信フォント)/ 0027(投稿系メタ配置統一)
- 姉妹サイト ADR: edu-evidence ADR 0017(同方針 + og-image の元実装)

## 背景

姉妹サイト edu-evidence は `src/lib/og-image.ts` で各戦略個別ページの動的 OG 画像を build 時に生成し、SNS シェア時の見栄えを担保している。本サイト edu-watch には **動的 OG 画像生成が未実装** で、`Layout.astro` の `ogImage` プロパティはデフォルトで `/og-image.png` を指していたが、**`public/og-image.png` も存在しない** 状態だった(SNS シェア時に画像が出ない)。

memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」の精神で、edu-evidence と同じパターンの動的 OG 画像生成を edu-watch にも導入する。スコープは **ダイジェスト個別ページ**(`/digest/[slug]/`)に限定。日次記事ページや一覧系は対象外(後段で別 ADR)。

同時に、edu-evidence ADR 0017 と同方針で **フォントを `scripts/fonts/noto-sans-jp-bold.bin` としてリポジトリに同梱**(Google Fonts / jsDelivr 等への build-time 依存を最初から作らない)。

## 検討した選択肢

### A) ダイジェスト個別ページに動的 OG 画像生成、フォントは同梱(採用)

- 利点:
  - 姉妹サイト edu-evidence と完全に同じパターン(memory rule 7)
  - SNS シェア時にダイジェスト固有の情報(週、タイトル、トピック)が見える
  - フォント同梱で build-time 依存ゼロ(ネットワーク不要)
- 欠点:
  - 5.1 MB のフォント binary がリポジトリに増える
  - ダイジェスト本数 × 1 PNG が dist に増える(現状少数、将来週次なので緩やかに増加)

### B) 静的 OG 画像 1 枚で済ませる

- 利点: 実装最小
- 欠点: ダイジェスト固有情報が出ず、姉妹サイトと体験が分裂

### C) 動的生成だが Google Fonts の build-time fetch

- 利点: フォント binary を git に置かなくてよい
- 欠点: 第三者依存・ネットワーク不安定時の build 失敗リスク(edu-evidence で実体験あり、ADR 0017 で解消)

## 決定

**選択肢 A** を採用。次の構造で実装する:

### 1. 同梱フォント

- `scripts/fonts/noto-sans-jp-bold.bin`(約 5.1 MB、Noto Sans JP Bold woff2、SIL OFL 1.1)
- edu-evidence ADR 0017 と同一ファイルを edu-watch にもコピー
- `.gitignore` で `*.bin` を除外しつつ `!noto-sans-jp-bold.bin` で例外指定

### 2. og-image.ts(`src/lib/og-image.ts`)

`generateOgImage(params)` を export。パラメータ:

```ts
interface OgParams {
  title: string;
  weekStart: string;  // ISO YYYY-MM-DD
  weekEnd: string;    // ISO YYYY-MM-DD
  topics?: string[];  // 表示は最大 4 件
}
```

レイアウト(1200×630px、edu-evidence の構造をミラー):

| 領域 | 内容 |
|---|---|
| 上段 kicker | `EduWatch JP — Weekly Digest`(uppercase、ディープネイビー `#1e4a6e`) |
| 上段 H1 | ダイジェスト title(font-size はタイトル長で 60px / 52px / 44px に切替) |
| 上段 sub | `期間: 2026年5月1日 〜 2026年5月8日`(Intl 整形、グレー) |
| 下段左 | topic チップ(最大 4 件、ディープネイビー枠線) |
| 下段右 | `news.edu-evidence.org` |

### 3. 動的生成エンドポイント(`src/pages/og/digest/[slug].png.ts`)

Astro の APIRoute として、`getStaticPaths` で digests collection を列挙し、各 slug に対応する PNG を build 時に生成。`Cache-Control: public, max-age=31536000, immutable`。

### 4. `src/pages/digest/[slug].astro` への統合

`<Layout ogImagePath={`/og/digest/${entry.id}.png`}>` で各ダイジェスト個別ページに OG 画像を紐付ける。Layout.astro 側は既に `ogImagePath` プロパティを受けて siteUrl と結合する処理(変更不要)。

### スコープ外

- 日次記事(`/articles/...`)の動的 OG(数が多い、ダイジェスト共有が主軸)
- カテゴリ・ソース・アーカイブ等の動的 OG(本 ADR では静的 fallback も用意しない、別 ADR で検討)
- `public/og-image.png`(全体デフォルト)— ダイジェスト以外のシェアでは OG 画像が出ない状態が一時的に続く

## アクセシビリティ / 配信影響

- 生成された PNG は build artefact、クライアント配信に追加で動的処理は不要(静的ホスティング適合)
- フォント binary は `scripts/fonts/` 配下、bundle には含まれない(クライアント配信に影響なし、ADR 0025 system-font-stack と矛盾しない)
- 1 ダイジェストあたり PNG 1 枚追加(数十 KB 程度)、現状本数は限定的

## 観測

- build ログで `dist/og/digest/*.png` が各ダイジェスト分生成されること
- ネットワーク切断状態でも `npm run build` が成功すること
- 本番デプロイ後に `news.edu-evidence.org/og/digest/<slug>.png` が 200 で返ること
- ダイジェスト個別ページの HTML に `<meta property="og:image">` が個別 URL を指していること
- Twitter Card Validator / OGP 確認サイトでダイジェスト固有の画像が表示されること

## ライセンス

- フォント: SIL Open Font License 1.1(Noto Sans JP)
- リポジトリ同梱 OK(再配布可)

## 関連参照

- edu-evidence ADR 0017(本 ADR の起点 / フォント同梱方針)
- ADR 0023(stacked hero、本サイトの hero 規約)
- ADR 0025(system font stack、クライアント配信フォント方針)
- ADR 0027(投稿系メタ配置統一、ダイジェスト個別の表示要素)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
- [SIL Open Font License 1.1](https://scripts.sil.org/OFL)
