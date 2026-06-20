# ADR 0057: AI summary honesty gate（canonical 限定の公開可否ゲート・strict 降格・retry 循環回収遮断）

## Status

Accepted (2026-06-20)

## Context

ADR 0050(W-1 MVP)/ 0054(strict 判定)で整備した AI 補助要約パイプラインの初の実生成(`kinmu-jittai-r4-kakuteichi` / section `kekka-gaiyou`、active.md 追補4、約74分)で、全エントリ共通コードに起因する systemic 欠陥 2 件が顕在化した(証拠は observation-2026-06-20)。

- **欠陥A(嘘の緑 / 本体未統合)**: canonical `summary.md` は required-facts 3 件を全欠落(機械 grep `initial 0/3`)していたにもかかわらず、当時の strict は `summary.md` + retry 出力ファイル(`summary-checked-raw.chunk{N}.md`)を連結対象として `summaryHit` を判定していたため `strict 3/3` を報告した。3 件は retry 別ファイルにのみ存在し canonical 本体には未統合で、公開対象である本体は不完全なまま「緑」と表示された。
- **欠陥B(strict の幻覚見逃し)**: retry chunk2 出力 L29 は「小学校・中学校共に **30歳以下**の教員の減少幅が大きい」とした(原文 extracted L608/L646 は「特に **40歳以下**の減少幅が大きい」)。減少幅が最大の年齢帯の誤帰属だが、自動 report は「幻覚0」と判定し見逃した。

両欠陥は「fact-check report の緑は公開可否の根拠にならない」ことを示す。公開可否の唯一の正は **canonical `summary.md` が required-facts を本体に持つか** であり、retry 回収・LLM strict 判定はいずれも本体完全性の代理指標として信頼できない。

## Decision

### D1. canonical `summary.md` を完全性の唯一の正とする

公開対象は canonical `summary.md` 本体のみ。retry が別ファイル(`summary-checked-raw.chunk{N}.md`)に回収した数値は、本体に統合されない限り「存在する」と見なさない。`computeGate(present, missing, totalFacts)` は canonical 本体への required-facts grep 結果(`initial.present` / `initial.missing`)のみから公開可否を算出する。

### D2. HIGH 必須 fact 欠落で BLOCK(exit 1)

`computeGate` は 3 状態を返す:

- **BLOCK**: canonical に severity=HIGH の必須 fact が 1 件でも欠落 → `process.exitCode = 1`
- **WARN**: HIGH は揃うが他 severity が欠落 → exit 0(編集者確認)
- **PASS**: 全 required-facts が canonical に存在 → exit 0

`run-pipeline.mjs` は `runStepCapture` で各 section の fact-check exit code を捕捉し(reject しない)、全 section 処理後に1件でも BLOCK/異常があれば集約して exit 1 する。途中 section の BLOCK で後続を握りつぶさず、かつ BLOCK を緑で覆い隠さない。

### D3. strict を参考情報に降格し canonical 限定とする(ADR 0054 D1 supersede)

`judgeStrict()` の `summaryHit` 対象を canonical `summary.md` のみに限定する(ADR 0054 D1 が定めた「`summary.md` + retry 出力連結」スコープを本決定が supersede)。strict は公開可否の判定根拠から外し、`[strict/参考]` として「本体に無い数値が原文 chunk に在るか(LLM 脱落 `llm_dropped` か真の欠落 `missing` か、本体に在るが原文に無い `llm_hallucination` か)」を編集者が切り分けるための advisory に降格する。

### D4. retry を信用せず retryHint で循環回収を遮断する(ADR 0046 §撤回トリガー実行)

retry recovered は advisory として `report.retry`(`[retry/参考]`)に記録するのみで本体に統合しない。加えて `buildRetryPrompt()` の不足リストから答案数値を排除する: 各 required fact の数値を含む `description` を渡す代わりに、答案数値を含まない `retryHint`(required-facts JSON に人手で付与、設問の枠組みのみを述べる)を提示する。retryHint 欠落時のフォールバックも序数(「必須データ点 N」)のみで `description` 数値も `id` 内の数字も漏らさない。

これは ADR 0046 §撤回 / 再検討の条件 末尾「LLM 事前知識補完によるハルシネーション混入が…検出される → `buildRetryPrompt` から fact `description` 数値を除外する別 ADR を起票」トリガーの実行である。初回 run では循環回収が実際に発生していた(observation-2026-06-20 §2: chunk2 の raw のみを入力とした retry 出力に、chunk1 由来「約30分減少」・chunk4 由来「10:06/2:14」が混入)。

### D5. 逆方向の幻覚検査・LLM ページ引用検証は follow-up とする

欠陥B(本体内の幻覚)への能動対応 = 逆方向検査(本体の数値が原文 chunk に在るかを全数チェックし `llm_hallucination` を BLOCK 化)、および LLM 生成のページ引用(p.X)の検証は本 ADR のスコープ外とし follow-up issue で扱う。本 ADR は「嘘の緑を消し、HIGH 欠落で確実に止める」最小修正に絞る。

## Consequences

### 良い影響

- 不完全な本体が「緑」で公開候補になる事故(欠陥A)を構造的に遮断。HIGH 欠落は必ず exit 1 で止まる
- gate が canonical 本体のみを見るため、retry / strict の stochastic 変動(ADR 0054 Supplement)が公開可否を揺らさない
- 循環回収遮断により retry の「回収」が答案コピーでないことが担保される(汎化時のハルシネーション混入リスク低減)
- LLM 非依存の決定的テスト(`gate.test.mjs`、`npm run test:ai-summary`)で gate / strict / retryHint の回帰を検出可能(8 ケース)

### 注意点 / トレードオフ

- 本体補完(retry で回収した数値の本体反映)は引き続き編集者の手作業(ADR 0040 §C-6)。gate は「止める」だけで「直す」ことはしない
- 欠陥B(幻覚)は strict の advisory 表示に留まり自動 BLOCK しない(D5 で follow-up)。当面は編集者が `llm_hallucination` 行を原文突合する運用
- `kinmu-jittai-r4-kakuteichi` / `kekka-gaiyou` は本修正後も gate BLOCK(canonical 0/3)。公開には編集者が欠落 3 値を原文から本体補完して再判定する必要がある

## Alternatives considered

active.md 追補4 で列挙した 5 方向のうち本 ADR は ①+ retry 遮断 を採用、②③④を follow-up / 不採用とした:

| 案 | 扱い |
|---|---|
| ① grep を合否の真実とし strict を降格 | **採用**(D1/D2/D3) |
| ② recovered facts の本体統合(merge-back) | 不採用。自動 merge は本体構造を壊すリスク。当面は gate で止め編集者が本体補完(D1 で本体未統合を明示) |
| ③ verbatim 包含 BLOCK ゲート(原文逐語の本体包含を必須化) | follow-up。pattern 設計コストが大きく本 ADR スコープ外 |
| ④ 逆方向の幻覚検査(本体→原文の全数照合で hallucination BLOCK) | follow-up(D5) |
| ⑤ 当面フル監修(自動 gate を入れず全数人手) | 不採用。HIGH 欠落の機械検出は低コストで確実、人手のみは見落としリスク大 |

## Related

- ADR 0050(W-1 MVP)/ ADR 0054(strict 判定、本 ADR D3 が D1 を supersede)/ ADR 0046(raw chunk retry、本 ADR D4 が §撤回トリガーを実行)/ ADR 0040 §C-6(編集者最終監修)
- `experiments/poc-pdf-summary/observation-2026-06-20.md`(初の実生成での欠陥A/B 観測と修正後の gate BLOCK / EXIT=1 実証)
- issue #284(AI summary 週次実行リマインダー、本修正の契機)

## Files changed

- `scripts/ai-summary/fact-check-lib.mjs`(新規、純粋関数 grepFacts / judgeStrict / computeGate / buildRetryPrompt / squeezeJpSpaces / summarizeFact を抽出)
- `scripts/ai-summary/fact-check-grep.mjs`(lib import、computeGate 配線、strict canonical 限定、`process.exitCode`、console 改訂)
- `scripts/ai-summary/run-pipeline.mjs`(runStepCapture で BLOCK 捕捉、gate 主体サマリ、集約 exit)
- `scripts/ai-summary/required-facts/kinmu-jittai-r4-kakuteichi-kekka-gaiyou.json`(答案数値を含まない retryHint × 3 追加)
- `scripts/ai-summary/gate.test.mjs`(新規、LLM 非依存テスト)+ `package.json`(`test:ai-summary`)
- `scripts/ai-summary/README.md`(gate / strict 降格 / retry advisory / retryHint 節)
- `docs/decisions/0046-*.md` / `0054-*.md`(status 相互参照 1 行)
