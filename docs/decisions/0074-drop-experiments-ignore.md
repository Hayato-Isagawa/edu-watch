# 0074. 使われなくなった `experiments/` の除外設定を撤去する

- 状態: 採用(0069 の `ignorePatterns` の `experiments/**` と、0073 §決定 3 のうち `experiments/` の汎用行と lint / format の除外設定を残す部分を上書き)
- 日付: 2026-09-27
- 関連 PR: TBD(本 ADR 起票 PR)
- 関連 ADR: [`ADR 0069`](0069-oxlint-and-oxfmt.md)(oxlint / oxfmt)/ [`ADR 0073`](0073-remove-ai-summary.md)(AI 補助 PDF 要約の撤去)/ [`ADR 0040`](0040-ai-assisted-summary-with-editor-supervision.md)(撤回済み)

## 背景

ADR 0073 は AI 補助 PDF 要約を撤去し、`experiments/` については汎用の置き場として 2 つの設定を残すと決めた。`.gitignore` の `experiments/*` と、oxlint / oxfmt の `ignorePatterns` の `experiments/**`(ADR 0069)である。

同じ日の最終チェックで、`experiments/` を使っていたのは PoC だけだったと分かった。履歴上の追跡ファイルは、すべて `experiments/poc-pdf-summary/` の下にある。`.gitignore` の行も PoC のためのもので、ADR 0040 の PR #129 で `experiments/` として入り、#130 で現在の `experiments/*` の形になった。0040 は 0073 で撤回済みである。

設定を残すと、今後 `experiments/` に置いたファイルは git に載らず、lint と format の検査からも黙って外れる。

## 検討した選択肢

- **残す(0073 の決定のまま)**: 使う予定の無いディレクトリのために、検査から外れる経路を残すことになる。却下
- **撤去する(採用)**: 編集者が撤去を選んだ

## 決定

1. `.oxlintrc.json` と `.oxfmtrc.json` の `ignorePatterns` から `experiments/**` を外す
2. `.gitignore` から `experiments/*` とそのコメントを外す
3. `CLAUDE.md` と `.github/workflows/checks.yml` のコメントから `experiments` を外す

## 帰結

- `experiments/` にファイルを置くと、git の追跡対象になり、lint と format の検査も受ける
- 実験用の置き場が要るときは、新しい ADR で場所と扱いを決める

## 撤回 / 再検討の条件

- 実験用の置き場を改めて設けるとき
