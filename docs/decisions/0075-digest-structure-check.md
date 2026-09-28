# 0075. digest の frontmatter の壊れを、スキーマと CI の中身検査で止める

- 状態: 採用(`docs/sprint-4-design.md` §3 のスキーマを締める。ADR 0047 の記録は書き換えない)
- 日付: 2026-09-29
- 関連 PR: 本 ADR 起票 PR
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
   - `articleIds` の全 id が記事データにある。**無くてよいのは denylist(ADR 0020)に載っている id だけ**。削除依頼(ADR 0008 §5)は記事を消して denylist に載せる手順なので、公開済みの digest を書き換えずに 24 時間以内に対応できる。表示では従来どおりスキップする
   - 本文が空(digest は本文を使わない)
   - frontmatter に行区切りに似た文字(U+2028 / U+2029 / U+0085 / 単独の CR)・0 桁目の `#` 行・キーをコメントアウトした行が無い
   - 値(title / summary / topics / heading / comment / 関連リンク)の中にキーの形をした行が無い(字下げがずれて後ろの塊が前の値に吸い込まれた形)
3. 検査スクリプトの回帰テストを `test:workflows` に置く(`scripts/__tests__/check-digest-articles.test.mjs`)

## 帰結

- 締めたスキーマに違反すると、dev サーバーは起動しない。起動中の編集で違反すると、ログに出るだけで古い内容を配信し続ける(`docs/digest-workflow.md` に記載)
- 記事データから記事を消す変更(掃除スクリプトなど)は、digest から参照されていて denylist に載せていなければ赤になる。digest の PR と記事を消す PR がそれぞれ緑のまま並行してマージされると main が赤になり、以後の自動収集 PR が滞留する(bot-pr-watchdog が 2 時間超で通知)。直すのは main 側の PR(denylist に載せるか、digest を直す)
- 関連リンクの意図しない消失は、意図した削除と区別できないので捕まえない
- スキーマを緩める変更(`.strict()` を外す等)は、テストでは捕まえない。`src/content.config.ts` の冒頭コメントに本 ADR を書いてある
