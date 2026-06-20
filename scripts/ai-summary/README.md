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

# extract + mapreduce + retry をすべてスキップ(strict 判定の再検証用、~0.3s)
node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --skip-extract --skip-mapreduce --skip-retry
```

各ステップは個別実行も可能(`extract.mjs --slug ...` / `mapreduce.mjs --slug ... --section ...` / `fact-check-grep.mjs --slug ... --section ...`)。

OLLAMA endpoint は環境変数 `OLLAMA_BASE_URL`(default: `http://localhost:11434`)で切り替え可能。GHA self-hosted runner からは `OLLAMA_BASE_URL` を secret で注入。

## 公開可否ゲート(ADR 0057)

公開可否の唯一の判定根拠は **canonical `summary.md` への required-facts grep** である。`fact-check-grep.mjs` は `computeGate()` で 3 状態を算出し、`fact-check-report.json` の `gate` に出力する:

| canonical の HIGH 欠落 | その他 severity 欠落 | gate | exit | 意味 |
|---|---|---|---|---|
| あり | — | `BLOCK` | 1 | HIGH 必須数値が本体要約に無い。**公開不可** |
| なし | あり | `WARN` | 0 | HIGH は揃うが MEDIUM 等が欠落。編集者が確認 |
| なし | なし | `PASS` | 0 | 全 required-facts が本体に存在 |

console 末尾 `[gate] <status> — canonical present X/Y, missing HIGH H / MEDIUM M`。`BLOCK` 時のみ `process.exitCode = 1`。`run-pipeline.mjs` は各 section の exit code を `runStepCapture` で捕捉し、全 section 処理後に1件でも BLOCK/異常があれば集約して exit 1 する(途中の BLOCK で後続 section を握りつぶさない)。

**canonical = `summary.md` 本体のみ**。retry で別ファイル(`summary-checked-raw.chunk{N}.md`)に回収した数値は、本体に統合されない限り gate に算入しない(嘘の緑の防止、ADR 0057 D1/D2)。

## strict 判定(参考情報、ADR 0054 → ADR 0057 で降格)

> **strict は合否に算入しない参考情報**である。公開可否は上記 gate のみが決める(ADR 0057 D3)。strict は「本体に無い数値が原文 chunk には在るか(= LLM 脱落か真の欠落か)」を編集者が切り分けるための補助シグナル。

`judgeStrict()` は **canonical `summary.md` のみ**を `summaryHit` の対象とする(ADR 0054 の retry 連結スコープを ADR 0057 D3 が supersede)。各 required fact を 2 軸で判定:

- `summaryHit`: canonical `summary.md` への required-facts grep(retry 出力ファイルは含めない)
- `rawChunkHit`: fact.sourceChunks に対応する PDF 本文(extracted text)への同 pattern grep

4 区分:

| summaryHit | rawChunkHit | 分類 | 編集者対応 |
|---|---|---|---|
| T | T | `present` | 本体に在り原文にも在る |
| T | F | `llm_hallucination` | 本体に在るが原文 chunk に無い。**幻覚疑い、PDF 直接確認** |
| F | T | `llm_dropped` | 原文に在るが本体に無い。LLM 脱落(gate では missing 扱い) |
| F | F | `missing` | 本体にも原文 chunk にも無い |

console 出力末尾 `[strict/参考] present X/Y, llm_hallucination N, llm_dropped N, missing N`。

## retry は advisory(本体未統合、ADR 0057 D4)

missing fact のうち `sourceChunks` を持つものは per-chunk raw retry を試みるが、**回収結果は canonical `summary.md` に統合されない**。retry 出力は `summary-checked-raw.chunk{N}.md` に書かれ、`report.retry`(console `[retry/参考]`)に advisory として記録されるだけである。gate も strict も本体のみを見るため、retry が成功しても gate は BLOCK のまま — 本体への補完は編集者が行う。

retry プロンプト(`buildRetryPrompt()`)は **循環回収を遮断**する(ADR 0046 §撤回トリガーの実行、ADR 0057 D4)。不足リストには各 fact の答案数値を渡さず、答案数値を含まない `retryHint`(設問の枠組みのみを述べた人手記述、required-facts JSON に付与)のみを提示する。retryHint 欠落時のフォールバックも序数(「必須データ点 N」)のみで、`description` の数値も `id` 内の数字も漏らさない。これによりモデルが不足リストの数値をコピーするだけで「回収」と誤判定される事象を防ぐ。

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
- `docs/decisions/0050-w1-ai-summary-mvp.md`(本 MVP の決定記録、セッション 74 で起票)
- `~/.claude/plans/promoted-summarizing-otter.md`(W-1 MVP 計画)
- `experiments/poc-pdf-summary/observation-2026-05-17.md`(答申本体 100% / 概要版 100%)
- `experiments/poc-pdf-summary/observation-2026-05-19.md`(通知本文 87.5% / 別添資料2 100% / 別添資料3 100%)
