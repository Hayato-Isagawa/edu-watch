# scripts/ai-summary/

文部科学省発信文書(中教審答申クラス)を対象とした、AI 補助要約 + 編集者監修パイプライン。ADR 0040 §C-7 採用判定固定(observation-2026-05-17 / observation-2026-05-19、obs-17 + obs-19 通算 2 件で本体 ≥ 70% 採用基準クリア)を受けて、`experiments/poc-pdf-summary/` の PoC コードを本番化したもの。

## ディレクトリ構造

```
scripts/ai-summary/
├── README.md              # 本ファイル
├── registry.json          # 対象 PDF レジストリ
├── extract.mjs            # PDF → text + セクション分割(セッション 71 で実装)
├── mapreduce.mjs          # gemma3:12b による map-reduce 要約(セッション 71)
├── fact-check-grep.mjs    # 必須数値 grep + retry(セッション 71)
├── run-pipeline.mjs       # registry エントリ 1 件を直列実行(セッション 71)
├── required-facts/        # PDF 別 required-facts JSON
└── chunk-ranges/          # PDF 別 chunk-ranges JSON
```

generated 出力先: `tmp/ai-summary/<slug>/<section>/`(`.gitignore` で除外)。

## registry.json

対象 PDF の一覧 + メタデータを集約する SSOT。各エントリは:

- `slug`(主キー、URL-safe、kebab-case)
- `sourceTitle` / `sourceUrl` / `pdfUrl` / `category` / `issuer` / `issueDate`
- `sectionDetectionPatterns`(セクション境界の正規表現)
- `sections[]`(各セクションの label / desc / chunkRanges パス / requiredFacts パス)

新規 PDF を追加するときは registry.json にエントリを追加し、対応する required-facts JSON と chunk-ranges JSON を所定パスに置く。

## 利用方法(セッション 71 実装後)

```bash
# registry エントリ 1 件を全 section 直列実行
node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27

# 個別 section だけ
node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --section honbun

# retry スキップ(デバッグ用)
node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --skip-retry
```

各ステップは個別実行も可能(`extract.mjs --slug ...` / `mapreduce.mjs --slug ... --section ...` / `fact-check-grep.mjs --slug ... --section ...`)。

OLLAMA endpoint は環境変数 `OLLAMA_BASE_URL`(default: `http://localhost:11434`)で切り替え可能。GHA self-hosted runner からは `OLLAMA_BASE_URL` を secret で注入。

## 編集者監修フロー

1. GHA workflow `.github/workflows/ai-summary.yml` が週次 cron + workflow_dispatch で起動(セッション 72 実装予定)
2. registry の対象 entry を順次 `run-pipeline.mjs` で処理
3. 出力をブランチ `ai-summary/<slug>` に commit し、PR 起票
4. PR 本文(`.github/PULL_REQUEST_TEMPLATE/ai-summary.md`)に: ソース URL / 抽出メタ / 要約 / fact-check 結果 / 監修チェックリスト
5. 編集者は PR レビュー + 必要に応じて commit 追加(要約 md 修正)
6. ユーザーマージで公開(memory rule 13: GHA からの自動マージは禁止)

## experiments/poc-pdf-summary/ との関係

PoC コード(extract-tsuuchi.mjs / mapreduce-v4-tsuuchi.mjs / fact-check-grep.mjs)を引数化リファクタしたもの。experiments/poc-pdf-summary/ は **削除せず保持**(ADR 0040 §C-7 / ADR 0046 / observation-2026-05-17 / observation-2026-05-19 から参照、トレーサビリティ確保)。

新規 PoC は `experiments/` 配下に置き、本番化したものを `scripts/` 配下に昇格する運用。

## 関連

- `docs/decisions/0040-ai-assisted-summary-with-editor-supervision.md` §C-7(採用判定固定)
- `docs/decisions/0046-promote-raw-chunk-retry-to-phase-2.md`(retry 入力 raw 化の正式採用)
- `docs/decisions/0050-ai-summary-pipeline-promotion.md`(本 MVP の決定記録、セッション 71 で起票予定)
- `~/.claude/plans/promoted-summarizing-otter.md`(W-1 MVP 計画)
- `experiments/poc-pdf-summary/observation-2026-05-17.md`(答申本体 100% / 概要版 100%)
- `experiments/poc-pdf-summary/observation-2026-05-19.md`(通知本文 87.5% / 別添資料2 100% / 別添資料3 100%)
