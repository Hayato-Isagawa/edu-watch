# ADR 0054: W-2 strict recovery judgment for LLM hallucination detection (with rawChunkSources page-marker lookup fix)

## Status

Accepted (2026-05-24)

## Context

ADR 0050(W-1 AI 要約パイプライン MVP)の fact-check は LLM 出力 `summary.md` に対する required-facts pattern grep のみで判定しており、LLM が pre-training 知識から補完して出力した数値も「present」と誤判定するリスクがある(observation-2026-05-19 §4.2 で指摘)。

ADR 0050 §監視/リスク観測項目は「LLM 事前知識補完: 新規エントリ追加時に真の救出率(strict)を併測する運用とする」と記載しており、当初はチェックリスト的な手動運用を想定していた。本 ADR は同項目を pipeline 内で構造実装する決定を記録する。

加えて、本実装の検証過程で pre-existing バグ 2 件を発見した:

- バグ #1: PDF 抽出時の漢字間半角スペース(`月 45 時 間` 等)が required-facts pattern を貫通させ、honbun strict 0/8 を引き起こす
- バグ #2: `loadRawChunkSources` が extracted ファイル内の rawPages array index と PDF 通しページ番号を同視しており、betsutenpu-2/3 のように一部 page のみ抽出された extracted で `slice(86, 87)` のような範囲外 slice が空 array を返す

両者は strict 判定機構を介して初めて顕在化したため、本 ADR で同時修正する。

## Decision

### D1. judgeStrict 関数の追加(本機能の核)

`scripts/ai-summary/fact-check-grep.mjs` に `judgeStrict(facts, summary, chunkSources)` を追加。各 required fact について以下 2 軸で判定:

- `summaryHit`: LLM 出力 summary 全体(`summary.md` + 各 `summary-checked-raw.chunk{N}.md`)を NFKC 正規化したものに対する required-facts pattern grep
- `rawChunkHit`: fact.sourceChunks の各 chunk を `loadRawChunkSources` で抽出した raw text を NFKC + `squeezeJpSpaces` 正規化したものに対する同 pattern grep

判定 4 区分:

| summaryHit | rawChunkHit | 分類 | 意味 |
|---|---|---|---|
| T | T | `present` | 真の救出 |
| T | F | `llm_hallucination` | LLM 補完疑い(編集者要確認) |
| F | T | `llm_dropped` | LLM 脱落(retry でも救えなかった) |
| F | F | `missing` | 真の missing |

### D2. report.json `strict` セクション追加

既存 schema(`initial` / `retry` / `outOfScope`)は無変更。トップに `strict` セクションを追加:

```
"strict": {
  "totalFacts": N,
  "strictPresent": N,
  "llmHallucinated": N,
  "llmDropped": N,
  "stillMissingStrict": N,
  "details": [
    { "id": "...", "severity": "...", "summaryHit": bool, "rawChunkHit": bool, "judgment": "present|llm_hallucination|llm_dropped|missing" }
  ]
}
```

console 出力末尾に strict 集計 1 行を追加(`[strict] present 7/8, llm_hallucination 0, llm_dropped 0, missing 1`)。

### D3. --skip-mapreduce オプション追加

`run-pipeline.mjs` に `--skip-mapreduce` を追加。`--skip-extract` と組み合わせ、`tmp/ai-summary/<slug>/` の既存 summary / retry 中間ファイルから fact-check のみを 0.2-0.3s で再実行する経路を整備。将来の pattern hardening 反復にも有用。

### D4. loadRawChunkSources の page marker matchAll 化(バグ #2 修正)

`split(pageMarker)` → array slice の方式を破棄。page marker `--- page (\d+) / \d+ ---` を `matchAll` で抽出し、actual page number をキーとする `Map<number, string>` を構築 → `pageMap.get(p)` で lookup する方式に変更。

honbun(startPage=1, endPage=N)は互換動作。betsutenpu-2/3(startPage=87 等)も正しく該当 page を取得。

### D5. squeezeJpSpaces 適用(バグ #1 修正)

`judgeStrict` 内の rawChunk 正規化に `squeezeJpSpaces` を追加(漢字 U+3400-9FFF + ひらがな/カタカナ U+3040-30FF + ASCII 数字 + カンマ間の `\s+` を反復削除)。summary 側は LLM 出力で元々綺麗なため不適用。

## Consequences

### 良い影響

- LLM 補完疑いを構造的に検出可能(編集者監修工程 ADR 0040 §C-6 で要確認項目を明示)
- バグ #2 修正により retry path の rawChunk text も正しく LLM prompt に渡る(retry 質向上の副次効果)
- 既存 report.json schema 後方互換(initial/retry/outOfScope 無変更)
- observation-2026-05-19 §3.2 §4.2 数値の訂正が可能になった(詳細は observation-2026-05-24 参照)

### 注意点

- pattern hardening のフォールスポジティブ監視(ADR 0050 §監視 別タスク B 課題)とは独立した監視軸として扱う
- `--skip-mapreduce` は検証目的のみ。本番運用では使わない
- squeezeJpSpaces を rawChunk 側のみ適用する非対称運用は文書化のみ。将来 summary 側も同じ問題に直面した場合は再評価

## Alternatives considered

| 案 | 採用しなかった理由 |
|---|---|
| (a) 編集者が手動で raw chunk vs summary を突合 | ADR 0050 §C-6 当初想定。9-26 facts 規模では見落としリスク大、定量集計困難 |
| (b) LLM に二次判定させる(別 prompt で hallucination check) | 信頼性が二重 LLM になり余計に不確実。検出機構自体が不透明化 |
| (c) loadRawChunkSources 内で `startPage - chunkRanges[0].startPage + 1` のように相対化 | extracted ファイルが必ず連続 page を含むという仮定に依存。将来 page 飛ばしや並び替えに脆弱 |

## Related

- ADR 0050(W-1 MVP)§監視「LLM 事前知識補完」: 本機構の実装契機
- observation-2026-05-19 §3.2 §4.2: 訂正対象(observation-2026-05-24 参照)
- observation-2026-05-24: 本 PR 計測結果と訂正報告

## Files changed

- `scripts/ai-summary/fact-check-grep.mjs`(judgeStrict + loadRawChunkSources + squeezeJpSpaces + report 拡張)
- `scripts/ai-summary/run-pipeline.mjs`(--skip-mapreduce)
- `scripts/ai-summary/README.md`(strict セクション + --skip-mapreduce 説明)
- `docs/decisions/0050-w1-ai-summary-mvp.md`(§監視に 1 行追記)
- `experiments/poc-pdf-summary/observation-2026-05-24.md`(新規)
- `experiments/poc-pdf-summary/verify-hypothesis-b.mjs`(新規、本補足、loadRawChunkSources pre/post `single` 引数の同値検証)

## Supplement (2026-05-24, session 97)

本 ADR(2026-05-24 Accepted、PR #195 / commit `8eecfd8`)の merge 直後の同日中に、`--skip-retry` を解除して honbun retry を 1 回再実行したところ、strict 8/8 → 6/8 に回帰し合計 24/26(92.3%)への変動を観測した。仮説判定の結果、本 ADR の strict 26/26 = 100% は「単一スナップショット値」であり、retry path 再実行時の stochastic 変動を許容する運用として扱う。

### 観測事実(セッション 96、n=1)

- honbun strict 8/8 → 6/8(`notice-number-date` / `interval-11h` が llm_dropped)
- betsutenpu-{2,3} は 9/9 維持
- 合計 strict 24/26(92.3%)、retry chunk サイズ pre 3018 / post 2909 bytes(-3.6%、ほぼ同等)

### 仮説判定(セッション 97)

- **仮説 B(prompt 入力構造変化)否定**: `experiments/poc-pdf-summary/verify-hypothesis-b.mjs` で `loadRawChunkSources` の pre(PR #177 / `6acd761`)/ post(PR #195 / `8eecfd8`)両実装を同一 `extracted-honbun.txt` に対して呼び、`single = { 1: allChunkSources[1] }` を比較 → 40794 bytes / 404 lines / 内容完全一致。honbun は空ページなく `rawPages.length === pageMap.size === 10` で D4 修正は厳密に互換動作
- **仮説 A(LLM stochastic)構造的根拠**: `callOllama` 設定 `{ temperature: 0.2, num_ctx: NUM_CTX }`(seed 指定なし)、`gemma3:12b` は 12 days ago から model 差なし → 同 prompt + 同 context_window でも実行ごとに確率的変動

### 含意

- strict 26/26 は単一スナップショット値、retry path 再実行による strict 変動を許容する運用とする
- 許容変動幅: 観測幅 **23-26/26**(n=1,3 = 26/26 / n=2 = 23/26、平均 25/26 = 96.2%、session 98-99)。n=2 の劣化内訳は honbun llm_dropped 2(`notice-number-date` / `interval-11h`)+ betsutenpu-3 llm_dropped 1。stochastic 変動の上限が偶然 pre baseline と一致するため、26/26 の再現可能性は保証されない
- retry スキップ条件(grep missing=0)を満たす **betsutenpu-2 は 3 試行とも 9/9 で不変**。retry path に入らないため stochastic 変動対象外で、観測対象セクションは honbun + betsutenpu-3 のみ(計 max 17、実測 14-17)
- 将来 stochastic 変動への能動的対応(`temperature=0` / seed 固定 / retry 回数増)を意思決定する際は別 ADR(0055 以降)で起票

### 関連

- observation-2026-05-24 §7.6-7.8: 本仮説判定の計測詳細
- observation-2026-05-24 §7.9: n=2,3 反復計測の生データと観測幅分析
- experiments/poc-pdf-summary/verify-hypothesis-b.mjs: 仮説 B 検証スクリプト本体

## 更新 (2026-06-20)

D1 の `summaryHit` スコープ(`summary.md` + 各 `summary-checked-raw.chunk{N}.md` の連結)は ADR 0057 D3 が supersede し、canonical `summary.md` のみに限定した。strict 自体も公開可否の判定根拠から外れ参考情報(advisory)に降格。公開可否は ADR 0057 の gate(canonical の HIGH 欠落で BLOCK、exit 1)が決定する。初回実 run では旧スコープが嘘の緑(strict 3/3 / 機械 grep 0/3)を生んでいた(observation-2026-06-20 §1)。
