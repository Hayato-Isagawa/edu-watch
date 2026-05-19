# 0048. digest 本文(`<Content />`)を撤回し summary 単一化する

- 状態: 採用
- 日付: 2026-05-19
- 関連 ADR: [0027](0027-posts-meta-layout-unified.md)(投稿系ページのメタ配置統一)、[0047](0047-digest-sections-multi-article.md)(N 記事 1 セクション 1 統合コメント既定構造)
- 関連 PR: 本 ADR 起票 PR

## 背景

週次ダイジェストの個別ページ(`src/pages/digest/[slug].astro`)は、当初設計で 3 層構成だった:

1. **header** に frontmatter の `summary` を `<p class="mt-6 ...">{entry.data.summary}</p>` で表示
2. **body** に digest md の本文段落(closing `---` 以降)を `<section class="prose-digest"><Content /></section>` で描画
3. **sections** に各 section の記事カード + 統合コメント(ADR 0047)

これにより header の `summary` と body の `<Content />` は、いずれも「週全体を要約する位置づけ」を抱え **論点近接** が生じていた。実際の 4 digest(2026-04-25 / 2026-05-02 / 2026-05-11 / 2026-05-16)の運用でも、body は summary の言い換え + 補強段落として書かれており、編集者は同じ論旨を 2 度書く負担と、読者は同じ内容を 2 度読む冗長性に直面していた。

さらに ADR 0047 で sections が「N 記事 1 統合コメント」を既定としたことで、各 section 内に論点整理が十分に書ける構造が確立した。結果として、digest 全体の summary は header の 1 段落で完結させ、各論は sections の統合コメントで深掘る情報設計に揃える方が整合する。

## 検討した選択肢

### A. `<Content />` を削除し summary に役割を単一化(採用)

- 内容: `[slug].astro` から `import { render }` と `<Content />` セクションを削除し、`.prose-digest` CSS は sections 内 `commentHtml` の描画用に引き続き残す。既存 4 digest の body(closing `---` 以降の段落)は物理削除し、frontmatter のみの md とする。`docs/digest-template.md` も本文プレースホルダ段落を撤回し、編集者は frontmatter のみで digest を成立させる設計へ
- 採用理由: summary と `<Content />` の役割重複を解消し、digest の情報設計を「header(summary)→ sections(N 記事 + 統合コメント)→ related evidence」の 3 層に整理。編集者は summary を 1 文で書き、各論は sections の統合コメントで深掘る構造に揃う。読者にも同じ論旨を 2 度提示する冗長性がなくなる

### B. `<Content />` の役割を再定義して残す(却下)

- 内容: body を「週の振り返りクロージング段落」「編集後記」「読了後の余韻」など別の役割で残す
- 却下理由: summary と sections で論点整理が完結する以上、追加の役割を新規に作る合理性が薄い。本 ADR の主目的は **重複の解消** であり、新たな役割定義は別途必要性が顕在化してから検討する方が、ADR 1 本の射程として明確

### C. 編集者プロフィール / 著者ブロックなど別役割で再設計(本 ADR スコープ外)

- 内容: body 領域を「執筆者の視点」「定点観測の継続的コメント」「読者からの反応」など別の役割に転用
- スコープ外: 価値の高い拡張ではあるが、本 ADR は重複解消が主目的のため、別 ADR で起票して設計する余地として残す

## 決定

A を採用。具体内容:

### (1) `src/pages/digest/[slug].astro` の `<Content />` 削除

- `import { getCollection, render } from "astro:content"` を `import { getCollection } from "astro:content"` に変更
- `const { Content } = await render(entry);` を削除
- `<section class="prose-digest"><Content /></section>` ブロックを削除
- `.prose-digest` CSS は sections 内 `commentHtml` の描画用に残置

### (2) 既存 4 digest の body 物理削除

`src/content/digests/2026-04-25.md` / `2026-05-02.md` / `2026-05-11.md` / `2026-05-16.md` の closing `---` 以降の段落をすべて削除し、frontmatter で終わる形に揃える。

### (3) `docs/digest-template.md` の body セクション撤回

closing `---` から `## このダイジェストの執筆について` までの本文プレースホルダ段落(「ここに編集者まえがきを書く…」「この本文は ADR 0008 の引用範囲遵守 5 要件を厳守する…」)を削除し、closing `---` を `## このダイジェストの執筆について` セクションに直接連結する。あわせて、ADR 0047 の PR #165 で漏れていた sample sections の `articleId` 単数表記を `articleIds: [<id>]` 配列表記に修正する。

## 影響と運用

### 効果

- digest の情報設計が「header(summary)→ sections(N 記事 + 統合コメント)→ related evidence」の 3 層に単純化
- 編集者は summary を 1 文で書き、各論は sections の統合コメントで深掘る構造に揃う
- 読者にとっても、同じ論旨を header と body で 2 度読む冗長性がなくなる

### 監視 / リスク観測項目

- summary を 1 段落で書き切る制約が、複雑なテーマの digest で過度な圧縮を強いる可能性 → 運用継続で観測
- body 撤回により「digest 全体としての編集者視点」を入れる場が失われる → 必要性が顕在化したら C 案の方向で別 ADR を起票

## 撤回 / 再検討の条件

- summary 単段落で digest の論点を要約しきれないケースが常態化 → header の summary を複数段落化、または body の役割を別 ADR で再設計
- 編集者視点ブロック / 著者プロフィールなど別役割の必要性が顕在化 → 本 ADR は撤回せず、別 ADR で body 領域に新規役割を定義(C 案)

## 参考

- ADR 0027(投稿系ページのメタ配置統一)
- ADR 0047(N 記事 1 統合コメント既定構造)
- `src/pages/digest/[slug].astro`(本 ADR の renderer 対象)
- `docs/digest-template.md`(本 ADR の template 撤回対象)
