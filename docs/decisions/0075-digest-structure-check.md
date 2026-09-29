# 0075. digest の frontmatter の壊れを、スキーマと CI の中身検査で止める

- 状態: 採用(`docs/sprint-4-design.md` §3 のスキーマを締める。ADR 0047 の記録は書き換えない)
- 日付: 2026-09-29
- 関連 PR: #783(本 ADR 起票 PR)
- 関連 ADR: [`ADR 0008`](0008-citation-scope-policy.md) §5(削除依頼への 24 時間以内対応)/ [`ADR 0020`](0020-persistent-article-denylist.md)(削除済み記事の denylist)/ [`ADR 0047`](0047-digest-sections-multi-article.md)
- 関連 issue: #781

## 背景

digest の frontmatter が壊れても、ビルドが通って節や記事カードが黙って消える形があった(#781 の実測)。

- スキーマは `sections` / `relatedEvidenceUrls` を `default([])` にしていて、未知のキーを捨てる。`sections:` のキー名が壊れる・コメントアウトされると、節が全部消えたままビルドが通る
- 表示(`getArticlesByIds`)は記事データに無い id を黙って飛ばす。複数行の `[ ]` で区切りの `,` が消えると 2 つの id が 1 つの文字列につながり、記事カードが消える
- Astro は行頭の `---` / `+++`(`----`・`---x` も)で frontmatter を閉じる。途中にそういう行が入ると、残りが本文として扱われる。digest の本文はどこにも描画されないので、画面にも痕跡が残らない

編集時のガード(`.claude/hooks/pre-edit-frontmatter-immutable.cjs`)で YAML の構造を正規表現で追う案は、独立レビューで塞ぐたびに別の素通りの形が見つかったので採らなかった。

## 決定

1. **スキーマ(ビルドで止める)**: 最上位・`sections[]`・`relatedEvidenceUrls[]` を `.strict()` にし、`articleIds` の各要素を記事 id の形(`src/lib/article-schema.ts` の `ARTICLE_ID_RE`)に限る
2. **中身の検査(CI で止める)**: `scripts/check-digest-articles.ts`(`npm run check:digest-articles`)を required の「Type and text checks」で走らせる。ローダーと同じ切り出し(`astro/markdown` の `parseFrontmatter`)で読み、次を見る
   - 各号に節が 1 つ以上ある(スキーマに入れないのは、下書きの途中で節が空のことがありうるため)
   - `articleIds` の全 id が記事データにある。**無くてよいのは denylist(ADR 0020)に載っている id だけ**。本 ADR で、削除依頼(ADR 0008 §5)で記事を消すときは denylist に理由つきで載せる、と定める(ADR 0020 の運用フローに合わせる)。こうすると公開済みの digest を書き換えずに 24 時間以内に対応でき、表示では従来どおりスキップされる
   - frontmatter に書かれた記事 id の形の語と、読めた `articleIds` が個数まで一致する(字下げした `# <id>` や行末の `# <id>` は YAML のコメントになり、その id だけが消える)
   - 本文が空(digest は本文を使わない)
   - frontmatter に行区切りに似た文字(U+2028 / U+2029 / U+0085 / 単独の CR)・0 桁目の `#` 行・キーをコメントアウトした行が無い
   - 値(title / summary / topics / heading / comment / 関連リンク)の中にキーの形をした行が無い(字下げがずれて後ろの塊が前の値に吸い込まれた形)
3. 検査スクリプトの回帰テストを `test:workflows` に置く(`scripts/__tests__/check-digest-articles.test.mjs`)

## 帰結

- 締めたスキーマに違反すると、dev サーバーは起動しない。起動中の編集で違反すると、ログに出るだけで古い内容を配信し続ける(`docs/digest-workflow.md` に記載)
- 記事データから記事を消す変更(掃除スクリプトなど)は、digest から参照されていて denylist に載せていなければ赤になる。digest の PR と記事を消す PR がそれぞれ緑のまま並行してマージされると main が赤になり、以後の自動収集 PR が滞留する(bot-pr-watchdog は 2 時間を超えた滞留を 6 時間ごとに見て Issue にするので、気づくまで最悪 14 時間程度)。直すのは main 側の PR(denylist に載せるか、digest を直す)
- 関連リンクの意図しない消失は、意図した削除と区別できないので捕まえない
- スキーマを緩める変更(`.strict()` を外す等)は、テストでは捕まえない。`src/content.config.ts` の冒頭コメントに本 ADR を書いてある

## 更新 (2026-09-29)

決定は変えず、帰結を補う(#785)。

- 「関連リンクの意図しない消失は捕まえない」は広すぎた。字下げがずれて関連リンクが前の値に吸い込まれる形は、§決定 2 の「値の中にキーの形をした行」で捕まえる。捕まえないのは、項目を消した・書き換えたなど、意図した編集と区別できない形
- 書かれた id と読めた id の突き合わせは、生の frontmatter から id の形の語を拾うので、値(title / summary / topics / heading / comment / 関連リンク)の中に id の形の語を書いても赤になる。現在の digest にこの書き方は無く、赤になる向きなので受け入れる。メッセージは合わない語(「読めない」「書かれていない」)と、原因の候補にこの形を挙げる
- YAML のアンカーとエイリアスでは突き合わせが食い違う。`&x [<id>]` と `*x` を並べると、エイリアス側の id が書かれていないので赤になる。アンカーを付けた id と同じ id がどこかでコメントになると(別の節の `- <別の id> # <アンカーの id>` でも)、コメントで消えた分とエイリアスで増えた分が打ち消し合って緑になる。現在の digest はアンカーを使っていない
