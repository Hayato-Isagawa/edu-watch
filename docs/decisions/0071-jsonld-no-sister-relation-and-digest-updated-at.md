# 0071. Organization JSON-LD に姉妹サイトの関係を書かず、digest の更新日を `updatedAt` で持つ

- 状態: 採用(0067 の「digest には読者向けの意味を持つ更新日フィールドが無い」前提を上書き。OG の版元は 0067 のまま)
- 日付: 2026-09-16
- 関連 PR: `feat/jsonld-relations-and-date-modified`
- 関連 ADR: [`ADR 0064`](0064-post-publication-correction-policy.md)(公開後の訂正) / [`ADR 0067`](0067-og-cache-version-source.md)(OG の版元) / edu-law 0030(姉妹サイト側のミラー)
- 関連: [`docs/digest-workflow.md`](../digest-workflow.md)「執筆上の約束(要点)」の `title` 箇条

## 背景

全ページの `Organization` と digest 詳細の `Article` の JSON-LD を足したとき(#670)、2 点が範囲外として残った(#671)。

### 1. 姉妹サイトの関係の表現が 3 リポで 3 通りだった

- edu-evidence: `Organization` に関係の表現なし
- edu-law: `sameAs` に `https://edu-evidence.org` と `https://news.edu-evidence.org`(edu-law ADR 0008)
- 本サイト: `parentOrganization` = EduEvidence JP(#670)

schema.org の定義(2026-09-16 に `https://schema.org/<property>` を取得して照合):

- `sameAs` — 「item の identity を一義に示す参照 Web ページの URL。例: Wikipedia のページ、Wikidata の項目、公式サイト」。姉妹サイトは別の実体なので、この定義に当たらない
- `subOrganization` — 「第 1 の組織が第 2 を包含する関係。例: 子会社」(`parentOrganization` はその逆で「この組織が subOrganization として属する、より大きな組織」)。3 サイトの about ページは「それぞれが独立したサイトとして、1 本の木を形づくります」と対等な関係を公言しており、包含関係の主張は公開文と食い違う
- `memberOf` — 「この Person / Organization が所属する Organization(または ProgramMembership)」。所属先となる上位組織は公開されていない

Google の Organization 構造化データの文書(同日取得)は、`sameAs` を「組織の追加情報がある他サイトのページ。例: SNS やレビューサイトのプロフィール」と説明し、`parentOrganization` / `subOrganization` / `memberOf` のいずれも列挙していない。

### 2. digest の更新日を出せていなかった

公開後に title を直す運用([`docs/digest-workflow.md`](../digest-workflow.md))と、誤りの訂正([`ADR 0064`](0064-post-publication-correction-policy.md))があるが、frontmatter に更新日のフィールドが無く、`Article.dateModified` を出せていなかった。edu-evidence のコラムは `lastVerified ?? date` で出している。

[`ADR 0067`](0067-og-cache-version-source.md) は「digest には `lastVerified` のように読者向けの意味を持つ既存フィールドが無い」ことを、号ごとの専用フィールド(同 ADR の選択肢 B)を採らず単一定数 `OG_DIGEST_VERSION` を採る根拠の 1 つにしていた。

## 検討した選択肢

### 姉妹サイトの関係

- **A. 関係を書かない**(採用)。誤った主張をゼロにし、公開文の「独立したサイト」と一致する。関係は about ページの本文と相互リンクが担う
- B. `parentOrganization` / `subOrganization` の対(EduEvidence JP を親)。ドメイン階層(`*.edu-evidence.org`)には合うが、公開文と食い違い、Google の文書に消費対象として載っていない
- C. 共通の Person(`founder`)で束ねる。運営者が同一という事実は正確だが、姉妹関係そのものは表現されず、3 リポとも変更が要る

### digest の更新日

- **A. 任意フィールド `updatedAt` を足し、`dateModified: updatedAt ?? publishedAt`**(採用)。edu-evidence のコラムと同じ形。無い号は公開日が出る
- B. git の最終コミット日時をビルド時に引く。書式統一だけの変更も「更新」として露出するので不正確
- C. 過去に title を書き換えた号へ遡って埋める。git のコミット日時は読者に見える変更と一致しないので、正確に埋められない

## 決定

1. **`Organization` に他の組織との関係を書かない。** 本サイトは `parentOrganization` を外す。`sameAs` は自組織の SNS(`https://x.com/edu_evidence_jp`)のみとし、ファミリーのドメインは置かない。edu-law は `sameAs` の姉妹 URL を外す(edu-law ADR 0030)。edu-evidence は現状のまま一致する
2. **e2e(`e2e/digest-jsonld.spec.ts`)が `Organization` のキー集合を固定する。** 関係プロパティを名前で禁止すると `department` / `member` / `brand` など別の関係語が抜けるので、許すキーの集合そのものを比べる。`sameAs` の各 URL のホストが `edu-evidence.org` 配下でないことも見る
3. **digest の frontmatter に `updatedAt`(ISO8601、オフセット付き、任意)を足し、`Article.dateModified` に `updatedAt ?? publishedAt` を出す。** `content.config.ts` が `updatedAt >= publishedAt` をビルドで検査する。既存の号には遡って書かない
4. **`updatedAt` は `Article.dateModified` 専用で、OG の版元には使わない。** `OG_DIGEST_VERSION`(ADR 0067)はそのまま。公開後に title を変える手順は「`updatedAt` を書く + 定数を上げる」の 2 手になる(`docs/digest-workflow.md`)
5. **この決定は [`docs/edu-evidence-parity.md`](../edu-evidence-parity.md) には載せない。** 同書の射程は UI/UX で、構造化データは対象外。ファミリーの正典は本 ADR と edu-law ADR 0030 の相互参照

## 結果

- 本サイトの `Organization` から `parentOrganization` が消える。`WebSite` / `Article` は変わらない
- digest 詳細の `Article` に `dateModified` が載る。`updatedAt` の無い号では `datePublished` と同じ値
- ADR 0067 が選択肢 B を却下した根拠のうち「読者向けの意味を持つフィールドが無い」は成り立たなくなる。OG の版元を単一定数に置く決定自体は、もう 1 つの根拠(全号ぶんの再取得が実害になっていない)で保たれる
- どの表現が検索や AI アシスタントに効くかは未検証。本 ADR は「誤った主張を出さない」ことだけを根拠にしている

## 撤回 / 再検討の条件

- `updatedAt` を書いたのに `OG_DIGEST_VERSION` を上げ忘れる事故が起きた場合、`updatedAt` を OG の版元に統合する(ADR 0067 の選択肢 B へ切り替える)かを再検討する
- title の書き換えや ADR 0064 の訂正で `updatedAt` を書き忘れたことが判明した場合、frontmatter の保護 hook か CI で同時更新を要求するかを再検討する(現状、機械検査は無い)
- schema.org が姉妹サイト(対等な関連組織)を表すプロパティを持つようになった場合、または Google / 主要な AI アシスタントの文書が組織間の関係プロパティを消費対象として列挙した場合、関係を書く選択肢を再検討する

## 更新

- 2026-09-17(#686): 決定 2 の e2e は、トップレベルの `Organization` ブロック 1 本目だけでなく、全ブロックと入れ子(`Article.publisher`)の `Organization` を走査する。入れ子には許すキーの部分集合を、トップレベルには集合の一致を要求する。`dateModified` の順序と、frontmatter を読んだ `updatedAt ?? publishedAt` との一致も e2e で見る(検査するのは一覧の先頭 = 最新号だけなので、`updatedAt` を持つ号が最新号になるまで `updatedAt` 側の分岐は実行されない)
- 2026-09-17(#688): 「現状、機械検査は無い」は成り立たなくなった。`.claude/hooks/pre-edit-frontmatter-immutable.cjs` が、`origin/main` にある号(= 配信済み)を Edit / Write / MultiEdit するときに `updatedAt` が新しい値になっていなければ確認を出す(ディスクの `updatedAt` が今日の JST 日付なら続く編集は通る)。再検討条件の 2 つ目はこの hook で実装済みとして扱う
- 2026-09-17(#691): `@type` は `Organization` で終わるサブタイプと配列も `Organization` として拾い、集めた全 `Organization` の `url` のホストが自サイトであることを見る(許すキーだけで書いた姉妹組織のノードを別スロットに置く形を止める)。加えて JSON-LD に現れる全ノードの `@type` をサイトが書く型の閉じた集合(`Article` / `Organization` / `Person` / `WebSite`。集合は dist の全 HTML を走査して決めたが、検査するのは最新号の詳細 1 ページ。digest 詳細以外のテンプレートに JSON-LD を足すときは集合も更新する)に固定する — schema.org の `Organization` の下位クラス 187 のうち名前が `Organization` で終わるのは 8 つだけで、`Corporation` / `NGO` 等で書いた姉妹ノードは前者の網では抜けるため(edu-law #255 と同型)
- 2026-09-17(#695): hook の `updatedAt` 要求は、公開済みの号への**すべての**編集に当てる(`topics` や書式だけの変更も)。読者に見える変更だけに絞る案は、判断を挟むぶん素通りの穴が増えるので採らない — 書式だけの変更で `dateModified` が動く不正確さは受け入れる(本 ADR が git の日時案を却下した理由と同じ不正確さだが、こちらは編集者が意図して書く値で、頻度も低い)。新しく書かれた `updatedAt` の値は hook がオフセット付き ISO8601・`publishedAt` 以降・今日(JST)以前であることを見る(zod は `publishedAt` 以降しか見ない)。受け入れた限界: `publishedAt` を regex が読めない形は未公開扱い / `origin/main` は最終 fetch 時点の知識(マージ直後は `git fetch` してから編集) / MultiEdit は最初の `updatedAt` 行だけ見る(過剰に確認する側)
- 2026-09-17(#700): JSON-LD の全ノードを型ごとのキー集合で検査し(`@type` の無いノード・`@id` だけの参照・集合外のキーで書いた関係は赤)、`sameAs` 以外の URL 値が自サイトを指すことと、トップレベルの `WebSite` が 1 本であることを見る。姉妹サイトを `WebSite` ノードや文字列値で書く形を止める(edu-law #257 と同型)
- 2026-09-17(#704): `@context` は文字列 `https://schema.org` 1 形に固定し、トップレベルのブロックにしか置かない(オブジェクトにすると型名やキーを別名化できるため)。URL 値の判定は前方一致でなく trim + 大文字小文字無視 + `//host` も拾う。`sameAs` は URL 文字列の配列に固定する。**`Person`(著者)の `sameAs` にはファミリーのドメインを置いてよい** — 同一人物のページなので schema.org の定義どおりで、Google の Article 文書も `author.url` / `sameAs` を「著者を一意に識別するページ(SNS・about me・bio)」と説明し両方を著者の同定に使うとしている(2026-09-17 取得)。実務でも `Person.sameAs` は Wikipedia や SNS のプロフィールに使われている(Yoast は自社サイトの `Person` に Wikipedia / GitHub / 個人サイトを置くと公式文書に書く。BBC の記事は `Person` に `sameAs` を置かない。NYT は `NewsMediaOrganization.sameAs` に Wikipedia を文字列で置いており、`Person` の例ではない)。決定 1 の「関係を書かない」は `Organization` 同士の話で、著者の identity 参照には及ばない
- 2026-09-18(#709): `sameAs` 以外の配列はオブジェクトの並びに限り、文字列の配列で URL を書く形を止める。http(s) スキームか `//` で始まる文字列は URL として構文解析してホストを見る(`https:host` など WHATWG だけがホストに解釈する形も拾う)。`sameAs` の要素は `https?://` に限る(edu-law #263 と同型)
- 2026-09-19(#716): 決定 2 の `sameAs` 検査は「家族ドメインの不在」から「自組織の SNS の値との完全一致」に置き換えた。不在検査は `x.com/edu_law_jp` のように SNS 側で姉妹を指す形と、末尾ドット付きの `edu-evidence.org.`(hostname にドットが残って終端一致しない)を通していた。`Article.publisher` は `sameAs` を持たないので、持つ場合だけ値を見る(edu-evidence #634 / #636 と同型)
