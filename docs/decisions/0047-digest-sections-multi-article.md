# 0047. digest sections に articleIds: string[] を採用し、N 記事 1 統合コメントを既定構造とする

- 状態: 採用
- 日付: 2026-05-18
- 関連 PR: 本 ADR 起票 PR / PR #164(supersede 済、`fix/digest-04-split-tamagawa-hokkaido`、クローズ)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

週次ダイジェスト #4(`src/content/digests/2026-05-16.md`、2026-05-16 公開済)で、当初公開された構造は「玉川大・佛教大の通信提携」と「北海道みらいの教員プロジェクト」を **同一セクション内**(玉川大の見出し下、コメント中で北海道みらいへ言及)に置く形だった。同テーマ・同日 2 件の動きを 1 セクションのコメント内で扱う構造は、北海道みらいの位置付けが副次的に見え、論点の連続性が読みづらかった。

最初の修正として PR #164(`fix/digest-04-split-tamagawa-hokkaido`)で **2 セクションに分離する形**(玉川大の記事 → コメント → 北海道みらいの記事 → コメント)を実装した。しかし、ユーザーの本来の意図は **「2 つの記事は同じ『教員確保』テーマで連続する 1 つの内容のため、記事カードを 2 枚並べてから 1 つの統合コメントを書く構造(記事 → 記事 → 文)」** であり、PR #164 の構造(記事 → 文 → 記事 → 文)は不適切と判断した。

当時の content schema は `sections[].articleId: string`(1 セクション = 1 記事)に縛られており、「記事 → 記事 → 文」を表現できなかった。schema とレンダリングを **N 記事 1 統合コメント** に対応させる構造変更が必要となった。

## 検討した選択肢

### A. `articleIds: z.array(z.string().min(1)).min(1)` に置換(採用)

- 内容: schema を `articleId: string`(1 件)から `articleIds: string[]`(1 件以上)に置換。renderer は `flatMap` で id を収集し、複数 ArticleCard を縦並び(`space-y-3`)で描画、ラベルを単複切替(`articles.length > 1 ? "Referenced articles" : "Referenced article"`)。既存 4 digest を `articleIds: [<id>]` 形式へ一括移行
- 採用理由: 同テーマで連続する複数記事を「記事カードを並べてから 1 つの統合コメント」構造で扱えるようになり、論点の連続性が記事カード並びによって視覚的に表現される。1 セクション 1 記事の場合も `articleIds: [<id>]` の単一要素配列で同一スキーマに収まる
- 設計制約: 配列要素 1 件以上(空配列禁止)。全記事が `getArticlesByIds` で見つからない場合のみ「該当記事は現在表示できません」フォールバックを出す

### B. union 型(`string | string[]`)で後方互換(却下)

- 内容: schema を `z.union([z.string(), z.array(z.string())])` とし、既存 4 digest の文字列形式を維持しつつ複数記事のみ配列形式を採用
- 却下理由: schema の二重化により renderer が分岐を持ち、digest 編集者が「いつ string、いつ array」を判断する規約のブレを生む。Zod の union を schema として残すと将来の保守者にとって意図が読み取りづらく、規約として 1 本化する方が望ましい

### C. heading 階層化で 1 セクションに複数記事(却下)

- 内容: sections の構造を変えず、heading 内に複数記事を含意させ、コメント文中に複数 ArticleCard を埋め込む拡張(MDX 化等)を検討
- 却下理由: schema の表現力が落ち、digest の構造を Astro Content Collections の型で保証できなくなる。`src/lib/articles.ts` の `getArticlesByIds` を再利用できず、レンダリング層の責務が分散する

## 決定

A を採用。具体内容:

### (1) `src/content.config.ts` schema 変更

`digests` collection の `sections[]` schema を以下に置換する。

```diff
- articleId: z.string().min(1),
+ articleIds: z.array(z.string().min(1)).min(1),
```

### (2) `src/pages/digest/[slug].astro` renderer 更新

- `flatMap` で全 sections の `articleIds` を収集して `getArticlesByIds` に渡す
- 各 section に `articles: Article[]` を持たせ、複数 ArticleCard を `space-y-3` で縦並び描画
- ラベルを `articles.length > 1 ? "Referenced articles" : "Referenced article"` で単複切替
- 全記事が現在表示不可の場合のみ「該当記事は現在表示できません(削除依頼などにより非掲載)」フォールバックを表示

### (3) 既存 digest の一括移行

既存 4 digest(`2026-04-25.md` / `2026-05-02.md` / `2026-05-11.md` / `2026-05-16.md`)の全 sections を `articleIds: [<id>]` 形式へ機械変換する。`2026-05-16.md` のみ digest #4 の section 2/3 を 1 セクションに統合(`articleIds` 2 要素 + 1 統合コメント、heading 差し替え)。

### (4) digest 編集の既定構造

今後の digest 編集において、**同テーマで連続する複数記事は「記事カードを並べてから 1 つの統合コメント」構造(N 記事 1 セクション 1 統合コメント)を既定形** とする。1 記事 1 セクションは適用外で従来通り `articleIds: [<id>]` で記述する。

## 影響と運用

### 効果

- 同テーマで連続する複数記事の論点を、記事カードの並びと統合コメントで視覚的に表現可能
- digest #4 で「教員確保」テーマの玉川大・佛教大 + 北海道みらいを 1 セクションに統合し、横(私大ネットワーク)vs 縦(高校生→定着)の対比論点を 1 本の文で示せる
- schema 上は配列形式に一本化されるため、digest 編集者は記事 1 件・複数件いずれも `articleIds: [<id>, ...]` で記述する規約に揃う

### 監視 / リスク観測項目

- `getArticlesByIds` で id が解決されないケース(削除依頼で記事 deny される、id の typo)→ 該当記事が空配列となり、フォールバック表示。記事カード並びを期待する読者には影響あり
- 1 セクション内の記事数が増えすぎた場合(3 件以上)の縦並び表示の可読性。本 ADR 時点では 2 件までを想定、3 件以上は別途観測
- 統合コメントの長さ。複数記事を 1 文で扱うため、コメントが長文化する傾向。digest #4 の統合コメントは 3 段落構成で収まったが、運用継続で観測

### PR #164 の扱い

PR #164(`fix/digest-04-split-tamagawa-hokkaido`、`記事 → 文 → 記事 → 文` 構造での分離修正)は方針変更により本 ADR を起点とする PR で **supersede** し、クローズ済。

## 撤回 / 再検討の条件

- 1 セクション 3 記事以上が常態化し、縦並び ArticleCard + 1 統合コメント構造が可読性を損なう → 別 ADR で「N 記事の上限」または「グループ化サブセクション」を再設計
- digest 編集者が「いつ複数記事 1 セクション、いつ 1 記事 1 セクション」を判断する規約が運用上ブレる → 編集ガイドラインを `docs/context-management.md` または別 ADR で明文化
- N 記事構造で SEO / OG 画像生成 / 検索フィードに不整合が発生 → 影響箇所(`og/digest/[slug].png.ts`、`digest/index.astro`、RSS フィード)の design を再検討

## 参考

- `~/.claude/plans/crispy-dreaming-stardust.md`(本 ADR の plan、ユーザー承認済)
- PR #164(supersede 済、`fix/digest-04-split-tamagawa-hokkaido`、commit `c0cba4e`)
- `src/lib/articles.ts:104` `getArticlesByIds(ids: readonly string[])`(本 ADR 採用前から複数 id 対応済、再利用)
