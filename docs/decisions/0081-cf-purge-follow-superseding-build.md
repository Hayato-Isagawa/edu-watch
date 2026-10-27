# 0081. cf-purge は、置き換えた新しいビルドを追い、確かめられないときは purge して赤で終わる

- 状態: 採用(0080 の「`cancelled` / `canceled` / `skipped` は exit 0」「ポーリングと `timeout-minutes`」と、帰結の「script tag を引けないときの経路は変えていない」を上書き) / 429 の扱いは [`ADR 0082`](0082-cf-purge-rate-limit-floor-and-deadline.md) で上書き
- 日付: 2026-10-26
- 関連 PR: `fix/cf-purge-follow-superseding`(本 ADR 起票)
- 関連 ADR: [`ADR 0080`](0080-cf-purge-terminal-build-outcomes.md)

## 背景

0080 は `skipped` / `cancelled` を見たら待たずに exit 0 にした。`skipped` は、同じトリガーの新しいビルドが queued になったときに古い方が飛ばされた印である(Workers Builds の changelog 2026-07-24)。新しいビルドの commit が `GITHUB_TOKEN` によるマージ(Dependabot の自動マージ)だと、push の workflow が起動しないので、誰も purge しない。

2026-10-26 に builds API で全 839 件を見た。main の `skipped` は 61 件で、cf-purge が起動していたのはそのうち 7 件だった。7 件のうち 3 件(2026-10-05・09-28・09-28)は、置き換えたビルドが Dependabot のマージで cf-purge が走っていない。人が出した変更が、Edge TTL の 10 分まで古いまま出ていた可能性がある(当時のログは見ていない)。`skipped` の後には 61 件すべてで新しい main のビルドが一覧に載っていた。`skipped` から置き換えたビルドの停止までは最長約 27 分だった。

ほかに、次の 3 点が残っていた(#936)。

- script tag を引けないと、固定で 3 分待って purge し、緑で終わる。トークンの権限が外れても気づけない
- builds API の失敗(認証エラー・5xx・通信の失敗)を、すべて「進行中」として待つ。期限切れの赤になるまで原因が出ない
- 同じ SHA のビルドを一覧の最初の 1 件で選ぶ。並び順は API が保証していない(sort のパラメータが無く、スキーマにも書かれていない)

## 決定

- 自分のビルドが `skipped` / `cancelled` なら、同じ `trigger_uuid` の main のビルドのうち `created_on` が自分より新しく、最も新しいものを追う。`success` なら purge、`fail` / `terminated` / 未知の値なら赤、それも `skipped` / `cancelled` なら purge せず exit 0。新しいビルドが一覧に無ければ(人の操作で止めた場合など)、0080 と同じく待たずに exit 0
- 同じ SHA のビルドは `created_on` を時刻として並べ、最も新しいものを見る
- ビルドを確かめられないとき(tag を引けない・API が 401 / 403 / 404 などを返す・一時的な失敗が 5 回続く)は、開始から 3 分待って purge し、exit 1 にする。キャッシュは消し、原因は赤で見せる
- 5xx・curl の失敗・`success` が true でない応答・読めない一覧は一時的な失敗として数え、読めた時点で数え直す。429 は `Retry-After` だけ待ち(上限 300 秒)、回数に数えない
- 待ちは回数でなく経過時間で打ち切る。自分のビルドに 25 分、追う分を含めて全体で 45 分。curl には `--max-time 20` を付け、`timeout-minutes` は 55 にする。値はステップの `env` に置き、テストはそこから読む

## 帰結

- 直前に `skipped` が無い `GITHUB_TOKEN` のマージは、変わらず purge されない(最大で Edge TTL の 10 分)。この ADR が塞いだのは「人の push のビルドが後のマージに置き換えられた」場合だけである
- 追う先のビルドが失敗すると、人の push の run が赤になる。失敗したのは Dependabot の commit のこともある
- トークンの権限が外れている間は、main への push のたびに cf-purge が赤になる。それが狙いである
- 人の操作で止めたビルドが `cancelled` と `terminated` のどちらになるかは、0080 と同じく確かめられていない
- Free プランでは同時ビルドが 1 つで、3 サイトで共有している。混んでいると 45 分に届かず赤になりうる

## 更新 (2026-10-27)

背景の「`skipped` から置き換えたビルドの停止までは最長約 27 分」は、`skipped` のビルドの `stopped_on` から置き換えたビルドの `stopped_on` までを測った値(1620 秒)である。起点を `skipped` のビルドの `created_on` にすると最長約 32 分(1927 秒)で、`cf-purge.yml` の `TOTAL_SECONDS` のコメントはこちらで書いている(#943 / #946)。2026-10-27 に builds API で両方を再現した。対象は main の `skipped` 61 件で、2026-10-26 までに区切っても同じ 61 件だった。

全体の期限は job の開始から数え、job の開始は push(≒ `skipped` のビルドの作成)より後なので、45 分と比べるのは作成時刻起点の約 32 分である。期限に収まるので、決定は変わらない。
