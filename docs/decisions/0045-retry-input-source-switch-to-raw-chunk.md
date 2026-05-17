# 0045. fact-check retry の入力ソースを LLM map summary から raw chunk text へ切替

- 状態: 採用
- 日付: 2026-05-17
- 関連 ADR: 0040(AI 補助 PDF 要約と編集者最終監修の運用、本 ADR は §C-7 Phase 2 改修の続編)/ 0036(tier 1 公的 PDF を運用範囲に含めた根拠)
- 関連 PR: #149(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

ADR 0040 §C-7「Phase 2 改修(精度向上)」採用判断のため、2026-05-12 〜 13 に PoC 観測 3 件(`observation-2026-05-12.md` / `observation-2026-05-13.md` / `observation-2026-05-13b.md`)を実施した。最新観測 §5 結論:

| サマリ | 真の救出ベース | ADR 0040 §C-7 採用可否 |
|---|---|---|
| 概要版 PDF(6p) | 5/5(100%) | 採用可 |
| 本体 PDF(73p) | 6/9(67%) | **判定基準 ≥ 70% 未満** |

### 本体未救出の構造

本体 PDF の未救出 2 件は PDF 原文に確実に存在する:

| Fact | 原文行 / ページ |
|---|---|
| `subject-teacher-9400` | `extracted.txt` L1356(p.37) |
| `karoshi-line-80h` | `extracted.txt` L327, L672, L1189(p.9-10, 19, 32) |

しかし LLM map 段階(`chunk-1-v3.md` 〜 `chunk-5-v3.md`)で該当数値が脱落しており、現行 retry プロンプトは LLM map summary を `chunkSources` として参照するため、retry でも救出できない。

### LLM 事前知識補完のリスク

本体 `work-survey-41-58-6years` は表面救出(7/9)に含まれるが、retry 出力の出所を切り分けた結果、chunk-2 grep で当該数値が 0 件にもかかわらず出力に登場。retry プロンプトの fact `description` 内数値(「月41h(小)・月58h(中)・6 年で 3 割減」)を LLM が rewrite した「事前知識補完」と判定。教員勤務実態調査の数値は学術文献・報道で頻出するため LLM が自信を持って補完したが、別 PDF で同様の仕組みを使うとハルシネーションが正解と一致しない事態が起こりうる(`observation-2026-05-13b.md` §4.2)。

### observation-2026-05-13b §6.1 推奨

retry プロンプトに投入する情報を **LLM map summary → raw chunk text(`extracted.txt` の page 範囲切り出し)** に切り替える。本体未救出 2 件は原文に確実に存在するため真の救出可能性が高く、LLM 事前知識補完への依存も低減できる。

## 検討した選択肢

### A. retry input source を raw chunk text に切替(採用)

- 内容: `fact-check-grep.mjs` の `chunkSources` ロード処理を変更し、`extracted.txt` の page boundary を `chunk-ranges-v3.json` / `chunk-ranges-gaiyouban.json` から取得して切り出し、retry プロンプトに raw chunk text を投入
- 期待効果: 本体未救出 2 件は原文に存在するため真の救出可能性が高い。fact description rewrite による LLM 事前知識補完への依存も低減
- 追加コスト: prompt size 増(chunk summary ~3,000 字 → raw text ~16,000-18,000 字 / chunk)、retry 実行時間延長見込み(本体 188s → 推定 300-500s)
- 投資対効果: 追加コストは個別 PDF を背景処理する想定で許容範囲。情報量の最大化が ADR 0040 §C-7 採用条件達成への最短経路と判断

### B. 軸 B(map prompt 改善、却下時の代替)

- 内容: map 段階で LLM が数値を脱落させない指示・例示を強化(reduce ではなく map で対処)
- 期待効果: 上流で数値が残るため retry に依存せず純粋に initial grep で救出
- 追加コスト: 本体 mapreduce 全再実行(~41 分 / 回)
- 却下理由: 「数値を保持しろ」と書いても LLM が要約圧縮を優先するため改善天井が低い可能性。A で raw chunk text を直接投入する方が情報損失がなく、retry 段階で確実に検証できる

### C. PoC 中止 + クラウド API / RAG 化(却下)

- 内容: ローカル推論を諦めクラウド API(GPT-4o / Claude 等)に切替、または RAG パイプライン化
- 却下理由: A の追加コストが許容範囲のため、まず最も情報量の多い retry 入力(raw chunk text)を試す。それでも未達なら C を別 ADR で検討

## 決定

A を採用。具体内容:

### (1) 採用条件

- **対象**: ADR 0040 §C-7 Phase 2 PoC の延長として、retry input source を raw chunk text に切替
- **実装ブランチ**: `feat/poc-retry-raw-chunk-source`(本 ADR とは別 PR で着手)
- **実装範囲**: `fact-check-grep.mjs` の `chunkSources` ロード処理を改修。`extracted.txt` から `chunk-ranges-*.json` で定義された page boundary を切り出して retry プロンプトに渡す
- **計測手順**: 本体 + 概要版で再計測し、`observation-2026-05-13b.md` と同条件(軸 A grep パターン + 既存 retry プロンプト戦略)で比較。新規 observation ドキュメントに記録
- **判定基準**: 真の救出率 ≥ 70%(初期 grep + retry 後)
- **達成時**: ADR 0040 §C-7 Phase 2 改修を本体 PDF も含めて正式採用する別 ADR を起票
- **未達時**: 本 ADR を撤回し、軸 B(map prompt 改善)へ移行する別 ADR を起票

### (2) 設計制約

- **prompt size**: raw chunk text 投入で 5-6 倍増(~3,000 → ~16,000-18,000 字 / chunk)。Ollama の `num_ctx=32768` を維持する場合、複数 chunk を同時投入する設計は context overflow リスクあり。**1 retry につき 1 chunk 単位の処理に制限**する(ADR 0040 §C-1 chunk size 上限と整合)
- **実行時間**: 本体 retry 188s → 推定 300-500s。個別 PDF を背景処理する想定で許容範囲
- **truth source**: raw chunk text 投入後も fact `description` 内数値を LLM が rewrite する「事前知識補完」リスクは原理的に残る。truth source は引き続き PDF 原文 + 編集者最終監修(ADR 0040 §C-6)
- **依存ファイル**: `extracted.txt`(本体・概要版)、`chunk-ranges-v3.json`(本体)、`chunk-ranges-gaiyouban.json`(概要版)

## 影響と運用

### 効果

- 本体 PDF の未救出 2 件(`subject-teacher-9400` / `karoshi-line-80h`)を真の救出で拾える可能性
- LLM 事前知識補完への依存低減で別 PDF への汎化性向上
- ADR 0040 §C-7 Phase 2 採用判断が本体 PDF を含めて可能になる

### 監視 / リスク観測項目

- prompt size 増大による Ollama 応答時間(本体 1 retry 300-500s の見込み、超過時は chunk 切り出し粒度を調整)
- raw chunk text 投入による幻覚混入の有無(`fact-check-v3.md` 品質基準: 幻覚 0 / CRITICAL 欠落 2 件以下を維持)
- LLM 事前知識補完の残存(fact description rewrite の検出は別途運用上の課題、本 ADR では対象外)

## 撤回 / 再検討の条件

- PoC 再計測で本体 PDF の真の救出率が ≥ 70% 未達 → 本 ADR 撤回、軸 B(map prompt 改善)を別 ADR で検討
- prompt size 増大により Ollama / M1 16GB 環境で context overflow が頻発する場合 → chunk 切り出し粒度を再設計、または別アプローチ
- retry 実行時間が個別 PDF の現実的な処理時間を超える(本体 1 PDF 1h+ 等)→ 運用継続困難として撤回
- raw chunk text 投入後も CRITICAL 欠落が常態化、または幻覚混入が発生 → 本 ADR 撤回、別アプローチを検討

## 参考

- `experiments/poc-pdf-summary/observation-2026-05-13b.md`(本 ADR 起票根拠、§5 結論 / §6.1 推奨 / §7 Next Action #1)
- `experiments/poc-pdf-summary/observation-2026-05-13.md`(軸 A 単独計測、本体 5/9 / 概要版 4/5)
- `experiments/poc-pdf-summary/observation-2026-05-12.md`(軸 A 実装前のベースライン)
- `experiments/poc-pdf-summary/fact-check-grep.mjs`(本 PoC 改修対象、本 ADR では参照のみ)
- ADR 0040 §C-7(本 ADR は Phase 2 採用判断のための追加 PoC 戦略)
- ADR 0040 §C-1(chunk size 上限、本 ADR の 1 retry = 1 chunk 制約と整合)
- 後続 PR(別ブランチ): `feat/poc-retry-raw-chunk-source` で `chunkSources` 改修、再計測 observation 起票
