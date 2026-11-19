# 0084. digest を Bash で書き換えたときは、事後に知らせて止めない

- 状態: 採用
- 日付: 2026-11-19(決定の実装は 2026-11-18 の #1028)
- 関連 PR: #1028(実装) / `docs/adr-0084-and-references`(本 ADR 起票)
- 関連 ADR: [`ADR 0071`](0071-jsonld-no-sister-relation-and-digest-updated-at.md)(`updatedAt` の規則と、公開済みの号への Edit で確認を出す hook) / [`ADR 0075`](0075-digest-structure-check.md)(frontmatter の壊れを CI で止める)
- 関連: 姉妹リポ edu-evidence・edu-law の同名ガード(どちらも事前確認を持つ)

## 背景

digest の frontmatter の保護値(`title`・`weekStart`・`weekEnd`・`publishedAt`・記事 id の並び・frontmatter の URL)と、公開済みの号の `updatedAt` の規則(ADR 0071)は、Edit / Write / MultiEdit の前に走る hook が見て、確認を出していた。数値・URL の変化は、Edit / MultiEdit の後に走る別の hook が Claude に知らせていた。

2026-11 に直近 30 日の会話の記録を調べると、digest への書き込みは Edit / Write が 0 回で、すべて Bash(`cp`・`sed > 新ファイル`・python)だった。2 本の hook は実質働いていなかった。

## 検討した選択肢

- **A. Bash の前後で同じ判定を当て、事後に知らせる(採用)**: Pre で全 worktree の digest の全文を控え、Post で変わった号に判定を当てる
- **B. A に加えて、コマンド文字列で書き換えの形を拾い、事前に確認を出す**: 姉妹リポ edu-evidence・edu-law の同名ガードはこの形。digest への書き込みはすべて Bash なので、書くたびに確認が出て止まる
- **C. Edit 側の 2 本を書き換えて Bash にも配線する**: 定義が 1 か所で済む。ただし Edit 側の 2 本はリポの外の設定がハッシュで固定しており、書き換えると固定し直すまで、このリポのファイルへの Edit / Write がすべて止まる
- **D. 何もしない**: 保護値と `updatedAt` の規則は、Bash の経路では確かめられないまま残る

## 決定

- A を採る。`.claude/hooks/bash-frontmatter-guard.cjs` を Bash の PreToolUse・PostToolUse・PostToolUseFailure に配線する
- **止めない。** 保護値の差と `updatedAt` の規則は Claude とユーザーの両方に、数値・URL の変化(roundtrip)は Claude にだけ、事後に知らせる。取り消しはしない
- **コマンド文字列での事前確認は持たない(B を採らない)。** 書くたびに止まる確認は、読まずに承認される確認になる
- **Edit 側の 2 本は変えず、定義を複製する(C を採らない)。** 複製がずれないよう、宣言の文字列・実データの digest 全件・同じ表の入力で、両方の出力が一致することをテストで固定する
- 公開済みかどうかと origin/main と同じ中身かどうかは、`git ls-tree origin/main` 1 回と blob の SHA-1 で決める。pull などで origin/main と同じ中身になった号には `updatedAt` と roundtrip を出さない
- **何が起きても exit 0。** リポの外の設定から呼ばれる経路では exit 2 がすべての Bash を止めるため。失敗は警告で知らせる

## 帰結

- Bash の経路でも、保護値の変化と `updatedAt` の書き忘れが見えるようになる。ただし止まらないので、気づいて直すのは書いた側に任される
- ADR 0071 の再検討条件の 2 つ目は「Edit / Write では確認を出して止める・Bash では事後に知らせる」の 2 段になる(0071 の `## 更新` に記録済み)
- **`run_in_background` と自動のバックグラウンド化では照合が空振りする。** Post が書き換えの完了前に走り、次の Bash の Pre が書き換え後を控えるので、その変化は以後どこにも出ない。事前確認を持たないので、この経路の守りは無い。#1028 の調査では、直近 30 日の digest への Bash 32 回のうち `run_in_background` は 0 回だった
- 並列の tool call・別のセッション・git の切り替えによる変化も、その Bash の変化として出る(安全側の誤報)。同じ Bash の中で作った worktree の号の書き換えは出ない
- 判定の定義が Edit 側と Bash 側の 2 か所になる。片側だけを直すとテストが赤になる。両方を直すときは、リポの外の固定も合わせて更新する(#1029 の正規表現の時間の問題はこの形で、両方を同じ PR で直す必要がある)
- 控えと印の仕組みは、edu-evidence・edu-law の版に続く 3 つ目の複製になる

## 反対意見

- **ADR 0071 の再検討条件を実装しただけで、新しい決定ではない。** 0071 の `## 更新` に 1 行で書いてあり、ADR を分けると記録が 2 か所になる。それでも分けるのは、0071 の行が `updatedAt` の規則しか扱わず、保護値・roundtrip・事前確認を持たない理由・複製の理由がどの ADR にも無いため
- **事前確認を持たないと、バックグラウンドの経路が無防備になる。** 姉妹リポ 2 つは事前確認を補助として残している。このリポは、確認が毎回出て止まる不便の方を重く見た。バックグラウンドで digest を書く使い方が出てきたら見直す

## 撤回 / 再検討の条件

- digest を `run_in_background` の Bash で書き換える使い方が出てきた場合(事前確認を足すか、別の守りを考える)
- digest への書き込みが Edit / Write に戻った場合(Bash の側を外せるか見る)
- Edit 側の 2 本の固定がリポの外から外れた場合(複製をやめて 1 か所にできる)
- 事後の知らせが読まれずに保護値の変更が main に入った例が出た場合(止める形を考える)
