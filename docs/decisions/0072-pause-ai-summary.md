# 0072. AI 補助 PDF 要約の運用を休止する

- 状態: 採用(0050 §決定(7) の週次 cron を上書き。それ以外の 0040 / 0050 の決定は有効のまま運用を休止)
- 日付: 2026-09-25
- 関連 PR: TBD(本 ADR 起票 PR)
- 関連 ADR: [`ADR 0040`](0040-ai-assisted-summary-with-editor-supervision.md)(AI 補助要約と編集者監修)/ [`ADR 0050`](0050-w1-ai-summary-mvp.md)(W-1 パイプライン MVP)/ [`ADR 0057`](0057-ai-summary-honest-gate.md)(公開可否ゲート)

## 背景

ADR 0050 §決定(7) に基づく週次リマインダー(`.github/workflows/ai-summary-reminder.yml`、#180)は、2026-05-25 から 18 件の issue を起票した(#205〜#730)。#730 以外の 17 件は完了扱いにならずに閉じている。

その間に新規エントリの実生成まで走ったのは #284 を契機とした 1 回だけである(`kinmu-jittai-r4-kakuteichi` / section `kekka-gaiyou`、約 74 分。ADR 0057 Context)。自動レポートは strict 3/3 を示したが、本体 `summary.md` には必須数値が 1 件も無く(canonical 0/3)、嘘の緑だった。ADR 0057 のゲートで同じ要約を判定し直すと `BLOCK — canonical present 0/3` で、公開には編集者が欠落 3 値を原文から補う必要が残った(`experiments/poc-pdf-summary/observation-2026-06-20.md`)。モデル比較などの検証目的の実行は、これとは別にある(`experiments/poc-pdf-summary/observation-2026-06-07.md`)。

リマインダーが案内するブランチ(`feat/ai-summary-<slug>-<section>`)と PR テンプレート `ai-summary.md` を使った公開 PR は 0 件で、要約はサイトに 1 本も載っていない。

実行時間の記録は、別々のエントリに対するパイプライン全体の 2 回だけで、どちらも Flash Attention を有効にする前([`ADR 0061`](0061-w1-ollama-flash-attention.md)、2026-06-27)のものである。ADR 0050 の `tsuuchi-r6-08-27` は 3 セクションで計 43.7 分、上の `kinmu-jittai-r4-kakuteichi` は 1 セクションで約 74 分。有効化後のパイプライン全体の時間と、編集者監修の工数は計測していない。

ADR 0040 の撤回条件は「編集者監修コストが運用継続不能水準に達した場合(初回 3 件評価後に判断)」である。評価に至った件数は 0 件で、このトリガーには到達していない。

## 検討した選択肢

- **続ける**: 毎週の issue が処理されないまま閉じる状態が続く。却下
- **休止する(採用)**: 定期起動だけを止め、コードと記録は残す
- **撤去する**: `scripts/ai-summary/` と関連 ADR を消す。再開時に経緯と計測を辿れなくなるので却下
- **`gh workflow disable` で止める**: リポジトリに痕跡が残らず、ADR から見えないので却下

## 決定

1. `ai-summary-reminder.yml` の `schedule` を外し、`workflow_dispatch` だけを残す
2. `scripts/ai-summary/`・PR テンプレート・`ai-summary-diagnose` skill・CI のゲートテストは残す
3. 休止は編集者の判断による。ADR 0040 の撤回条件に基づくものではない。0050 §決定(7) の週次 cron を除き、0040 / 0050 / 0057 の決定は有効のまま
4. 再開は編集者が決める。そのときは新しい ADR で運用を決め直し、先に ADR 0050 の「四半期ごとの再評価」(モデル挙動の測り直し)を行う

## 帰結

- 週次のリマインダー issue が止まる
- ダイジェスト作成に AI 補助は入らない。公開実績が 0 件なので、読者から見える変化は無い
- ゲートテストは CI で走り続け、コードが壊れていないことだけは保たれる

## 撤回 / 再検討の条件

- 編集者が再開を決めたとき
