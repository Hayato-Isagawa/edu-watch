# Sprint 4 設計書 — 週次ダイジェスト

**作成日**: 2026-04-29
**作成者**: Isagawa Hayato
**前提**: Sprint 3 完了(トップ / カテゴリ / 媒体 / 日付別アーカイブ / 検索 / `/about` / モバイルメニュー / back-to-top)
**ゴール**: 1 週間の教育ニュースから編集者が「論点」を整理して公開する週次ダイジェスト機能を実装する。日次記事の意見なし運用(ADR 0008)を補完する位置付け

---

## 1. スコープ

本 Sprint で実装する範囲(MVP):

- [ ] Astro Content Collection `digests` の schema 設計
- [ ] `src/pages/digest/[slug].astro` 個別ダイジェストページ
- [ ] `src/pages/digest/index.astro` アーカイブ一覧
- [ ] トップページに「最新ダイジェスト」ブロックを統合
- [ ] ヘッダー / フッター / モバイルメニューに `/digest/` 導線
- [ ] 初回ダイジェスト草稿(編集サンプル 1 本)
- [ ] RSS フィード(`/rss.xml`)に `digest` を含める

**スコープ外**(Phase 2 以降):
- メールマガジン配信(Cloudflare Workers + 外部メール API、PRD §5.2)
- X(Twitter)連動の自動投稿(運用は手動で開始、PRD §9.3)
- AI による論点整理の自動下書き(Phase 2)
- 編集 UI(GUI、CMS など。MVP は VS Code + git ベース)

---

## 2. 目的(PRD §6 / §11 から)

| PRD 該当箇所 | 本設計書での実現 |
|---|---|
| §6: 編集者の意見は週次ダイジェストに限定 | 日次記事の `ArticleCard` には意見を付加せず、ダイジェスト個別ページの本文 markdown でのみ「編集者より」を提示 |
| §6: タイトル原文ママ / 公式 URL 直リンク / 引用範囲遵守 5 要件 | ダイジェスト本文中で言及する記事は ArticleCard と同じ流儀で、タイトル原文 + 公式 URL に直リンク |
| §6: 1 週間のニュースから「これは覚えておくべき」を人手で選別 | frontmatter `referencedArticleIds` で記事 id を参照、本文で論点整理 |
| §7: `/digest/` `/digest/[yyyy-mm-dd]` | URL 設計のとおり実装 |
| §11 KPI: 30 分以内編集 / 100% 公開率 | テンプレート化された frontmatter + Content Collection の型補完で編集を高速化 |

---

## 3. データモデル

### 3.1 Content Collection

```ts
// src/content.config.ts
import { defineCollection, z } from "astro:content";

const digests = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(1),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    publishedAt: z.string().datetime({ offset: true }),
    summary: z.string().min(1),
    topics: z.array(z.string()).min(1),
    referencedArticleIds: z.array(z.string()).default([]),
    relatedEvidenceUrls: z.array(z.string().url()).default([]),
  }),
});

export const collections = { digests };
```

### 3.2 ファイル配置と slug 規則

- 配置: `src/content/digests/YYYY-MM-DD.md`
- slug = ファイル名(拡張子除く)= 公開日(金曜の JST 日付)
- URL: `/digest/<slug>/`

### 3.3 frontmatter 仕様

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `title` | string | ◯ | 「2026 年 5 月第 1 週の論点」など、編集者が決める見出し |
| `weekStart` | `YYYY-MM-DD` | ◯ | 集計対象週の月曜(JST) |
| `weekEnd` | `YYYY-MM-DD` | ◯ | 集計対象週の日曜(JST) |
| `publishedAt` | ISO8601 | ◯ | 公開タイムスタンプ(通常 weekEnd の翌金曜) |
| `summary` | string | ◯ | 1〜2 文の要約。OG 画像 / RSS 記述 / 一覧で使用 |
| `topics` | string[] | ◯ | 編集者が選んだ主要トピック(自由記述、3〜5 個推奨) |
| `referencedArticleIds` | string[] | × | 本文で言及した日次記事の id。個別ページで `ArticleCard` を再描画 |
| `relatedEvidenceUrls` | URL[] | × | edu-evidence 側の戦略 / コラム URL。本文末尾の関連リンクとして表示 |

### 3.4 本文 markdown

- 「編集者より」「今週の動き」「補助線(関連エビデンス)」の節構成を推奨。テンプレート化してリポジトリに置く
- 引用範囲遵守 5 要件(ADR 0008)に従い、媒体記事の本文転載は禁止。要約・論点整理に限る

---

## 4. URL 設計とページ構成

### 4.1 ルート

| URL | 役割 |
|---|---|
| `/digest/` | 全ダイジェストの一覧(降順、件数表示) |
| `/digest/<YYYY-MM-DD>/` | 個別ダイジェスト(編集者の本文 + 言及記事リスト + 関連エビデンスリンク) |

### 4.2 個別ページ(`/digest/[slug].astro`)

セクション順:
1. ヒーロー: `Weekly digest · YYYY 年 N 月 第 N 週` ラベル / `title` / `weekStart`〜`weekEnd` / `summary`
2. トピックバッジ群(`topics` を `CategoryBadge` 風の枠で表示。CategoryBadge は再利用しない、`topics` は自由記述のため)
3. 本文 markdown(`<Content />`)
4. 「今週言及した記事」: `referencedArticleIds` に該当する記事を `ArticleCard` で表示
5. 「関連エビデンス」: `relatedEvidenceUrls` を `link-underline` でリスト
6. 前後ナビ: 前週 / 次週へのリンク(getStaticPaths で配列を作りインデックス参照)
7. パンくず: `← ダイジェスト一覧` / `トップ`

### 4.3 一覧ページ(`/digest/index.astro`)

- ヒーロー: `Weekly digest` ラベル / 「週次ダイジェスト」見出し / 全件数
- リスト: 各ダイジェストの `title` / 公開日 / `summary` / `topics` バッジ
- archive と同じ流儀(リンクリスト型、降順)

### 4.4 トップ統合

- 凡例セクション(SourcesIntro)直下、または overflow 直前に「今週のダイジェスト」ブロックを差し込む
- 内容: 最新 1 件の `title` / `summary` / 「読む →」リンク
- 該当ダイジェストがない週(初週など)はブロック自体を非表示

### 4.5 ヘッダー / フッター / モバイルメニュー

- ヘッダー nav: `カテゴリ / 媒体 / アーカイブ / **ダイジェスト** / サイトについて + 姉妹サイト + 検索アイコン`
- フッター 「探す」列: カテゴリ / 媒体 / アーカイブ / **ダイジェスト**
- モバイルメニュー Explore セクション: カテゴリ / 媒体 / アーカイブ / ダイジェスト

---

## 5. 編集ワークフロー

### 5.1 編集者の手順(30 分以内目標)

1. 金曜朝(JST)に GitHub で `feat/digest-YYYY-MM-DD` ブランチを切る
2. `src/content/digests/YYYY-MM-DD.md` を新規作成
3. テンプレート(`src/content/digests/_template.md`)から frontmatter / 節構成をコピー
4. 過去 1 週間の記事一覧(`/archive/` から JST `weekStart`〜`weekEnd`)を眺めて、論点を 3〜5 個に絞る
5. `referencedArticleIds` を `src/data/articles/*.json` から拾って配列に入れる
6. 本文(編集者より / 今週の動き / 補助線)を書く
7. PR 作成 → preview deploy で確認 → セルフレビュー後にマージ

### 5.2 編集の補助

- VS Code(Astro 拡張)で frontmatter の型補完が効く(`content.config.ts` の Zod schema 由来)
- preview deploy で表示確認
- 既存の archive ページや Pagefind 検索で記事 id を引きやすい

---

## 6. 既存実装との連携

| 既存実装 | Sprint 4 での扱い |
|---|---|
| `src/data/articles/*.json` | `referencedArticleIds` から記事を引いて表示。同じ id ベース |
| `ArticleCard` | 個別ダイジェストページの「言及した記事」セクションでそのまま再利用 |
| `groupByDate` / `formatDayShort` | `weekStart`〜`weekEnd` の日付フォーマットに流用 |
| `link-underline` | 関連エビデンスリンクなどに統一適用 |
| `SourcesIntro` | トップ統合時に「今週のダイジェスト」ブロックの下に維持(凡例とのバランスを後で調整) |
| edu-evidence の戦略 / コラム | `relatedEvidenceUrls` で外部リンク。`target="_blank" rel="noopener noreferrer"` |

---

## 7. 公開頻度・運用 KPI

PRD §11 と整合:

| 指標 | 目標 |
|---|---|
| 公開頻度 | 毎週金曜 JST 朝(初回は実運用に合わせて柔軟に) |
| 公開率 | 100%(毎週) |
| 編集所要時間 | 30 分以内 / 1 本 |
| 公開遅延の許容 | 翌週月曜まで(それ以降は公開を見送り、次週ダイジェストに統合) |

---

## 8. RSS フィード(任意拡張)

- `/rss.xml` を新規作成し、`digests` コレクションを RSS 2.0 で配信
- title / link / pubDate / description(`summary`) を含める
- 日次記事は対象外(数が多くノイズになる)
- フィード URL を `/about` の「お問い合わせ」周辺に追加

---

## 9. ロードマップ(段階 PR)

| # | PR の射程 | 主な変更 |
|---|---|---|
| (a) | **本設計書のみ** | `docs/sprint-4-design.md` を追加(本 PR、合意の起点) |
| (b) | Content Collection + 個別ページ | `src/content.config.ts` / `src/content/digests/_template.md` / `src/pages/digest/[slug].astro` |
| (c) | アーカイブ一覧 | `src/pages/digest/index.astro` |
| (d) | トップ統合 + ヘッダー / フッター動線 | `src/pages/index.astro` 更新 + `src/layouts/Layout.astro` 更新 |
| (e) | 初回ダイジェスト草稿 | `src/content/digests/2026-05-02.md`(初運用、編集サンプル) |
| (f) | RSS フィード(任意) | `src/pages/rss.xml.ts` |

各 PR は edu-evidence と整合する範囲で `docs/edu-evidence-parity.md` を追記。

---

## 10. リスク・既知の制約

| リスク | 対策 |
|---|---|
| 30 分以内で書けない週がある(取り上げる素材を絞れない) | テンプレート化、`topics` を 3〜5 個に強制制限、PRD §11 リスク対応(自動化比率最大化)に従う |
| 記事 id が collectedAt 修正(ADR 0010)以前のものと不整合 | 既存記事の id は不変なので影響なし。新規取り込みでも id は collectedAt と独立 |
| `referencedArticleIds` の記事が後日削除依頼で消える(ADR 0008) | id ベースの参照解決時に未存在ならスキップ + 注記 |
| 編集者の負荷集中(運営 1 人) | PRD §11 リスク表通り、自動化比率を上げる方針を維持。Phase 2 で AI 下書き支援を検討 |

---

## 11. 撤回 / 再検討の条件

- 公開率が 3 週連続で 50% を下回る → 配信頻度を隔週に変更検討
- 30 分以内の編集が 4 週連続で達成不能 → AI 下書き(Phase 2)前倒し
- 読者からの反応がほぼない(GA / Cloudflare Analytics で観測) → コンテンツ性質を見直し
