# 0083. test:workflows は pass が下限とちょうど一致しないと落とす

- 状態: 採用
- 日付: 2026-10-27
- 関連 PR: `test/workflows-exact-bound`(本 ADR 起票)

## 背景

`test:workflows` の下限は「実測ちょうど」と決めていたが、判定器 `assert-test-results.mjs` は pass が下限以上なら通すので、守っているのは慣習だけだった。

#944 と #946 はどちらもテストを 3 件足し、`package.json` の下限を同じ 1 行で 258 → 261 に上げていた。同じ書き換えは衝突しないので、後からマージした側の squash では差分が消え、main は 264 件のテストを下限 261 で走らせていた(#948 で直した。#949)。

姉妹リポ edu-law と edu-evidence は、下限を別の口のテストに定数で書き、行頭の `test(` の数と照合して一致を強制している。このリポのテストは `for` ループで登録しているものがあり、変更前の main で行頭の数(230)と実行数(265)が合わない。

## 検討した選択肢

- **判定器に完全一致のモードを足す(採用)**: ループはそのままでよく、変更は判定器と npm script だけで済む
- **姉妹リポと同じ形にする**: ファミリーの形はそろうが、ループで登録している 35 件を 1 行ずつに展開する必要があり、差分が大きい
- **仕組みは入れない**: 並行 PR が重なったとき、下限が実測より低いまま残る穴が残る
- **完全一致に加えて、main に追いついていない PR をマージさせない(branch protection の strict)**: 重なりを PR の段階で止められるが、自動マージの bot の PR(記事収集・Dependabot)は main に追いつかないので、main が進むたびに止まる

## 決定

- `assert-test-results.mjs` に `--exact` を足す。付けると、pass が下限より多くても落とす
- `test:workflows` は `--exact` で通す。`test:hooks` は下限を「1 ファイルを空にしても割る」境界値で持つので付けない
- 判定器のこの分岐と npm script の配線は `scripts/__tests__/assert-test-results.test.mjs` が固定する。判定器を一時ディレクトリのテストに対して直接走らせ、exit を見る

## 帰結

- テストを足す PR が並んでも、PR の CI はそれぞれ緑のまま通る(後からマージする側が push し直さない限り)。後からマージした側で下限の書き換えが消えると、マージ後の main の `checks.yml` が赤になる。防ぐのではなく、事後に見えるようにする
- **その後に CI が走る PR も止まる。** PR の CI は main とのマージ結果で走り、`test:workflows` を含む「Type and text checks」は必須チェックなので、main が赤の間に CI が走った PR は、package.json の下限を直さない限りどれも同じ理由で赤になる。記事収集(fetch-news)・recheck-nikkyo・Dependabot の自動マージもここで止まる
- **下限を直しても、止まった PR は自動では戻らない。** `checks.yml` は PR の作成・push・reopen でしか走らず、required checks は `strict: false` なので、main が直っても赤くなった PR の CI は走り直さない。Actions の re-run は元のイベントと同じ `GITHUB_SHA`(古いマージ結果)で走るので効かない。push し直す・close して reopen する・Dependabot に recreate させる・close して次の収集に任せる、のどれかを手で行う
- 止まった記事収集と recheck-nikkyo の PR は bot-pr-watchdog(6 時間ごと、2 時間を超えたもの)が Issue にするが、Dependabot の PR は対象外で、赤のまま残っても通知されない
- これまでは、重なりの害は「ガードが緩む」だけだった。止まる PR を手で片付ける手間と引き換えに、ずれが放置されない方を選んだ。姉妹リポの「定数 + 行頭の数」も、重なれば main で赤になる点は同じ
- 赤になったら、main の実測に合わせて下限を直す PR を 1 本出し、マージ後に、その間に赤くなった PR を上のどれかで走らせ直す
- テストを足した PR で下限を上げ忘れると、その PR の CI が赤になる(これまでは緑で通った)
