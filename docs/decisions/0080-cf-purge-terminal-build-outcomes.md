# 0080. cf-purge は、ビルドが本番に出なかったときに赤で終わる

- 状態: 採用(0065 D6 の `cf-purge` の行を上書き) / `cancelled`・`skipped` の扱い、ポーリングと `timeout-minutes`、script tag を引けないときの経路は [`ADR 0081`](0081-cf-purge-follow-superseding-build.md) で上書き
- 日付: 2026-10-26
- 関連 PR: `fix/cf-purge-terminal-outcomes`(本 ADR 起票)
- 関連 ADR: [`ADR 0065`](0065-bot-pr-stall-detection.md)(全 job の `timeout-minutes` と D4「壊れたときに緑で終わらせない」)

## 背景

`cf-purge.yml` は main への push ごとに Workers Builds の該当ビルドの完了を待ち、ゾーンのキャッシュを purge する。case 文は `success` と `fail|failure|cancelled|canceled` しか知らず、それ以外は「待つ」に落ちていた。失敗と timeout はどちらも exit 0 だった。

2026-10-23、main の 53c22bf のビルドが `terminated` で終わった。job は 10 分待って warning を出し、緑で終わった。purge はしておらず、terminated のビルドには commit の check-run も付かない。気づいたのはマージ後の確認スクリプトだけだった。

`build_outcome` は進行中は null で、終わると `success / fail / skipped / cancelled / terminated` のどれかになる(Cloudflare の OpenAPI スキーマ `builds_BuildOutcome`)。直近 100 run では、`skipped` で 10 分待った run が 3 本、成功までに約 12.5 分・約 20.7 分かかって 10 分の待ちでは purge に届かなかった run が 2 本あった。

## 決定

- `fail` / `failure` / `terminated`、未知の終端値、timeout は exit 1 にする。本番は直前のデプロイのままなので、0065 D4 と同じく緑で終わらせない
- `cancelled` / `canceled` / `skipped` は待たずに exit 0 にし、purge しない
- ポーリングを 10 分から 25 分(`seq 1 100` × `sleep 15`)に延ばし、`timeout-minutes` を 20 から 35 にする。35 はポーリング上限に 10 分足した値

## 帰結

- 正常に遅いだけのビルドでも 25 分を超えると赤になる。実測の最長は約 20.7 分
- `skipped` のビルドを置き換えた新しいビルドは見ていない。その commit が `GITHUB_TOKEN` によるマージ(Dependabot の自動マージなど)だと push の workflow が起動しないので、新しいデプロイが Edge TTL の 10 分まで purge されないことがある。変更前も同じだった
- script tag を引けないときに固定時間待って purge する経路は変えていない
- 人の操作で止めたビルドが `cancelled` と `terminated` のどちらになるかは、資料で確かめられなかった。`terminated` になるなら赤になる
