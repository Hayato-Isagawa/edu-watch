# observation-2026-06-20: AI 要約パイプライン初の実生成での systemic 欠陥検出と正直化ゲート修正の実証

## 対象

- entry `kinmu-jittai-r4-kakuteichi` / section `kekka-gaiyou`(教員勤務実態調査〔令和4年度〕確定値 結果概要、required-facts 3 件)
- 初の実生成(active.md 追補4、約74分)で公開不可と判定 → 本修正(ADR 0057)で正直化ゲートを実装
- 修正後の検証は `--skip-retry`(Ollama 不要、~0.3s)で既存 canonical `summary.md` を対象に再実行

## 1. 修正前に観測された嘘の緑(欠陥A)

初回実 run の自動 report は **strict 3/3** を報告したが、canonical `summary.md` への機械 grep は **initial 0/3**(全 required-facts が本体に欠落)だった。原因は当時の strict が `summary.md` に加えて retry 出力ファイル(`summary-checked-raw.chunk{N}.md`)を連結して `summaryHit` を判定していたこと。3 件は retry 別ファイルにのみ存在し、公開対象の canonical 本体には未統合のまま「緑」と表示されていた。

## 2. 循環回収(retry を信用できない根拠、欠陥A の機序)

retry 別ファイル `summary-checked-raw.chunk2.md`(chunk 2 の raw のみを入力に再生成)L27 に、chunk 2 に属さない他 chunk 由来の答案数値が出現していた:

- 「平成28年度と比較して約30分減少」= fact `kyouyu-zaikoutou-30min-genshou`(sourceChunks=[1])
- 「10:06、土日は2:14」= fact `kotogakkou-zaikoutou-1006`(sourceChunks=[4])

chunk 2 の raw 入力にこれらは含まれない。出所は当時の `buildRetryPrompt` が不足リストに各 fact の `description`(答案数値を含む)を verbatim で渡していたこと = モデルが raw を読まず description をコピーするだけで grep 上「回収」と判定される循環回収。ADR 0046 §撤回トリガーが想定した事象であり、ADR 0057 D4(retryHint 化)で遮断した。

## 3. 幻覚(欠陥B、本セッションで原文照合・rule 26b 適用)

`summary-checked-raw.chunk2.md` L29:「小学校・中学校共に **30歳以下**の教員の減少幅が大きくなっています」

原文(extracted L608 / L646):「全ての年齢階層で在校等時間が減少している。特に **40歳以下**の減少幅が大きい」(平日・土日とも)

= 減少幅が最大の年齢帯を **40歳以下 → 30歳以下** と誤った帰属の幻覚。原文 L879「男女共に、30歳以下の『教諭』の平日の在校等時間が長い」(在校等時間の長さ、別論点)との取り違えと推測。

注意: 「30歳以下」自体は原文に多数存在(年齢階層ラベル L469/491/511、在校等時間の長さ L879 等)するため、単純な presence grep では幻覚と判定できない。文の主語(何についての 30歳以下 か)まで読んで初めて確定する。初回 run の自動 report は「幻覚0」と判定し本件を見逃した(strict の限界。ADR 0057 D5 逆方向検査が follow-up)。

## 4. 修正後の実測(正直化ゲート発火)

`node scripts/ai-summary/fact-check-grep.mjs --slug kinmu-jittai-r4-kakuteichi --section kekka-gaiyou --skip-retry`:

```
[grep] present 0/3, missing 3
  [missing] HIGH kyouyu-zaikoutou-30min-genshou: 教諭の平日在校等時間 平成28年度比 約30分減少(小・中) (sourceChunks=[1])
  [missing] HIGH shuu-55-60-jikan-warai-takai: 1週間の総在校等時間で...50〜55時間未満・55〜60時間未満帯の割合が高い(令和4年度) (sourceChunks=[2])
  [missing] MEDIUM kotogakkou-zaikoutou-1006: 高等学校教諭 10・11月の平日在校等時間 10:06 / 土日 2:14 (sourceChunks=[4])
[gate] BLOCK — canonical present 0/3, missing HIGH 2 / MEDIUM 1
[retry/参考] recovered 0, still-missing 0, out-of-scope 0(advisory・本体未統合)
[strict/参考] present 0/3, llm_hallucination 0, llm_dropped 3, missing 0
EXIT=1
```

- canonical 0/3 → `gate BLOCK`(HIGH 2 / MEDIUM 1)→ `process.exitCode = 1`。嘘の緑(旧 strict 3/3)は消滅。
- strict は canonical 限定となり 3 件を `llm_dropped`(本体に無いが raw chunk には在る)と正直に報告。公開可否には算入しない参考表示。
- `npm run test:ai-summary`: 8/8 pass(computeGate BLOCK/PASS/WARN、judgeStrict llm_dropped、buildRetryPrompt の答案数値・id 非漏洩、実 exit code 1/0)。

## 5. 含意

- 本修正は「嘘の緑を消し、HIGH 欠落で確実に止める」最小修正。kinmu-jittai/kekka-gaiyou は本修正後も BLOCK のままで、公開には編集者が欠落 3 値を原文(p.12/13、p.15)から canonical 本体に補完して再判定する必要がある。
- 逆方向の幻覚検査(本体→原文)と LLM ページ引用検証は ADR 0057 D5 で follow-up。
- 関連: ADR 0057 / 0054(strict)/ 0046(retry)/ 0040 §C-6(編集者監修)、active.md 追補4(初回実 run の生記録)。
