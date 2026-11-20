# 0085. PR の Actions が全部成功したときだけ、PR に 1 回だけ通知する(ci-summary・追認記録。edu-law ADR 0036 ミラー)

- 状態: 採用
- 日付: 2026-11-19
- 関連 PR: #714(導入・2026-09-19)・#918(重複防止の印を bot のコメントからだけ拾う) / `docs/adr-0085-ci-summary-mirror`(本 ADR 起票)。本 ADR はその決定を後から記録する
- 関連 ADR: edu-law 0036(原本) / [`ADR 0041`](0041-dependabot-auto-merge-policy.md)(E2E を required にした) / [`ADR 0042`](0042-fetch-news-token-elevation.md)・[`ADR 0049`](0049-recheck-nikkyo-token-elevation.md)(自動 PR を PAT で作る) / [`ADR 0065`](0065-bot-pr-stall-detection.md)(bot PR の滞留を検知する) / [`ADR 0078`](0078-hold-zero-major-production-deps-and-og-render-check.md)(保留した Dependabot の PR へのコメント) / [`ADR 0083`](0083-test-workflows-exact-bound.md)(Dependabot の赤の PR は通知されない)

## 背景

GitHub Mobile の「ワークフロー実行」の通知は workflow run 1 本ごとに届き、PR 1 本で何度も鳴る。2026-09-19 に #714 で `.github/workflows/ci-summary.yml` を足し、通知を 1 回にまとめた。同じ日に姉妹リポ edu-law が先に入れた形(edu-law #266 / #268 の実測)を写したもの。

方針の一部は `ci-summary.yml` の冒頭のコメント・`CLAUDE.md`・`CONTRIBUTING.md` に書かれているが、決定として記録した ADR は無かった。原本は edu-law ADR 0036 で、本 ADR はそのミラーとして、決定を同じにし、このリポに固有の点を差分として書く。

## 検討した選択肢

原本と同じ(通知をそのまま受ける / 何も受けない / 失敗も集約 workflow から知らせる / 全部成功したときだけ 1 件コメントする)。当時このリポで別の検討をした記録は無い。

## 決定

原本の決定をそのまま採る。

- PR の commit に付いた **GitHub Actions の check-run が全部完了し、全部成功**したときだけ、その PR に管理者への @メンション付きのコメントを 1 件付ける。`skipped` と `neutral` は成功として扱う
- **失敗したときは何もしない**
- **見るのは GitHub Actions の check-run だけ**(Cloudflare Workers Builds の check-run は `workflow_run` を起こさない)
- **起動元の workflow の `conclusion` では絞らない**。成否は check-run の走査が全件で見る
- **同じ commit には 1 回だけ**。印を github-actions[bot] のコメントにだけ探す
- **Dependabot が起動した run は対象外**

このリポに固有の決定:

- **PAT で自動 PR を作る bot workflow の PR も対象外にし、ブランチ名の接頭辞で外す。** PAT で作った PR では run の actor が PAT の持ち主になり、actor では見分けられない(PAT にした理由は ADR 0042 / 0049)。外す接頭辞の正典は `ci-summary.yml` の `if:`

起動する workflow の列挙・外すブランチの接頭辞・権限・判定の本体の正典は `ci-summary.yml` で、`scripts/__tests__/ci-summary-workflow.test.mjs` が workflow 全体を固定している。本 ADR には列挙を写さない。

## 原本との差分

- **経緯**: 起動元の `conclusion` で絞らない形は、edu-law #269 と同じ変更を #714 に最初から入れた(2 本は 2026-09-19 に数十秒差でマージされた)。重複防止の印を bot のコメントからだけ拾う形は、このリポの #918(2026-10-23。#914 で Dependabot の保留コメントに入れた照合を写した)が先で、edu-law #359 がそれを写した
- **対象外の PR が多い**: 上の自動 PR を外している
- **死角を前提にした決定が違う**: edu-law では ADR 0032 が「失敗が通知されない」ことと「Dependabot の PR を対象外にしている」ことを理由に挙げて E2E を required にした。このリポの E2E の required は ADR 0041(2026-05、ci-summary より前)が自動マージの gate として決めたもので、失敗が通知されないことを前提にした決定は無い。Dependabot の PR を対象外にしていることは、ADR 0078 が前提にしている — 保留した PR へのコメント(D2)にも @メンションを付け、そのコメントで通知が届くようにした。ADR 0083 の帰結にも、Dependabot の赤の PR が通知されないことが書かれている

## 帰結

原本の帰結(成功時の 1 回の通知・失敗は通知されない・壊れても静かに壊れるのでテストで固定・`workflow_run` が書き込みトークンで走る・列挙の足し忘れ・Workers Builds を待たない)はこのリポにもそのまま当たる。加えて:

- **自動 PR は成功も失敗も通知しない。** 自動 PR が止まったことは、bot-pr-watchdog(ADR 0065)が一定時間を超えたものを Issue にして知らせる。ci-summary はその経路に関わらない
- **Dependabot の PR のうち、保留したものだけは ADR 0078 のコメントで @メンションが届く。** 自動マージを有効にしたまま赤で残ったものは、どこからも通知されない(ADR 0083 の帰結と同じ)

### 反対意見

原本と同じ(通知の受け方は管理者個人の作業嗜好で、ADR の対象外ではないか)。このリポでも、対象の PR(人の PR)の成功ごとにコメントが付き、書き込みトークンで走る `workflow_run` を抱える点は同じなので ADR にする。ミラーを置かず原本だけを引く案もあるが、このリポは対象外の PR が多く、差分を書く場所が要る。

## 撤回 / 再検討の条件

原本と同じ。加えて:

- 自動 PR の作り方が変わり、ブランチ名での除外が当たらなくなった場合(通知が自動 PR ごとに届くようになる)
- 原本が撤回・上書きされた場合(このリポでも見直す)
- Dependabot の PR も通知の対象にする場合(ADR 0078 の保留コメントの @メンションと重なるので、合わせて見直す)
