# 0073. AI 補助 PDF 要約を撤去する

- 状態: 採用(0008 §3 の例外のうち AI 補助要約としての利用を上書き。0040 / 0045 / 0046 / 0050 / 0054 / 0057 / 0061 / 0072 を撤回)
- 日付: 2026-09-27
- 関連 PR: #749(本 ADR 起票 PR)
- 関連 ADR: [`ADR 0072`](0072-pause-ai-summary.md)(運用の休止)/ [`ADR 0040`](0040-ai-assisted-summary-with-editor-supervision.md)(AI 補助要約と編集者監修)/ [`ADR 0050`](0050-w1-ai-summary-mvp.md)(W-1 パイプライン MVP)/ [`ADR 0008`](0008-citation-scope-policy.md)(§3 の例外)

## 背景

ADR 0072 は運用を休止し、コードと記録を残すと決めた。その 2 日後、編集者は AI 補助 PDF 要約の取り組みそのものをやめると判断した。推論ホストの Ollama と gemma3:12b も運営者の環境から削除したので、パイプラインは手元でも動かせない。

公開済みの要約は 0 件で(ADR 0072 §背景)、読者から見える機能は無い。残っていたのは、動かせないパイプラインと、それを検査する CI のテストである。

## 検討した選択肢

- **休止を続ける**: 推論ホストが無いので、残したコードは誰も動かさないまま CI の保守対象になる。却下
- **撤去する(採用)**: コードと検証記録を main から外す。記録は git の履歴で辿れる

## 決定

1. 次を削除する: `scripts/ai-summary/`・`experiments/poc-pdf-summary/`・`.claude/skills/ai-summary-diagnose/`・`.github/PULL_REQUEST_TEMPLATE/ai-summary.md`・`.github/workflows/ai-summary-reminder.yml`
2. `test:ai-summary`(`package.json`・`check:all`・`checks.yml` のステップ)を削除する。直接の利用者がいなくなる依存 `pdf-parse` と `undici` を `dependencies` から外す
3. `.gitignore` から PoC の例外と `tmp/ai-summary/` を外す。`experiments/` を git 管理外にする汎用行と、lint / format の対象外にする設定(ADR 0069)は残す
4. ADR 0008 §3 の例外(公的一次ソースを自前で要約する場合。0040 の PR #129 が 0008 に追記し、具体運用を 0040 に委ねていた)のうち、0040 が定めた AI 補助要約としての利用はやめる。AI を使わない要約の扱いはここでは決めない。0008 の本文は変えない
5. 関連 ADR の本文は変えない。本文が指すファイルは、撤去前のコミット `7b110be` で辿れる

## 帰結

- ADR 0040 / 0045 / 0046 / 0050 / 0054 / 0057 / 0061 / 0072 は撤回になる
- ADR 0008 §3 の例外は残るが、具体運用を委ねていた 0040 は無くなる
- 再開するときは、新しい ADR で設計からやり直す

## 撤回 / 再検討の条件

- 編集者が AI 補助要約の再導入を決めたとき(本 ADR を上書きする新しい ADR で決める)
