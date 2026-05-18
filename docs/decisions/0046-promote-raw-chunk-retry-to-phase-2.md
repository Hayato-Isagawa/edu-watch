# 0046. retry input source のデフォルトを raw chunk text 化(ADR 0040 §C-7 Phase 2 正式採用)

- 状態: 採用
- 日付: 2026-05-17
- 関連 ADR: 0040(AI 補助 PDF 要約と編集者最終監修の運用、本 ADR で §C-7 Phase 2 採用判定済とする)/ 0045(fact-check retry の入力ソースを LLM map summary から raw chunk text へ切替、PoC 戦略文書、本 ADR は採用結論)
- 関連 PR: #153(本 ADR 起票 PR)/ #155(本 ADR §決定 (1)(2) 実装、INPUT_SOURCE デフォルト raw 化 + ADR 0040 §C-7 ステータス更新)/ #152(PoC 実装、commit 67faa61、本 ADR の実証根拠)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

ADR 0045 §決定 (1) で定めた PoC 戦略「retry プロンプトの `chunkSources` ロード処理を LLM map summary から `extracted.txt` の raw chunk text に切替」を PR #152 で実装し、`experiments/poc-pdf-summary/observation-2026-05-17.md` で効果計測した。

| サイト | 真の救出率(observation-2026-05-13b) | 真の救出率(observation-2026-05-17) | 変化 |
|---|---|---|---|
| 本体 PDF(73p、9 facts) | 6/9(67%、判定基準未達) | 9/9(**100%**) | +33pt |
| 概要版 PDF(6p、5 facts) | 5/5(100%) | 5/5(**100%**) | 不変 |

本体・概要版ともに ADR 0045 §決定 (1) 判定基準「真の救出率 ≥ 70%」を大幅クリア。ADR 0045 §決定 (1)「達成時: ADR 0040 §C-7 Phase 2 改修を本体 PDF も含めて正式採用する別 ADR を起票」のアクションとして本 ADR を起票する。

### observation-2026-05-17 で確認された救出メカニズム

本体 PDF で observation-2026-05-13b 時点に未救出だった 2 件が raw chunk text 投入で救出された(observation-2026-05-17 §4.2):

- `subject-teacher-9400`: chunk 3 raw L1356「合計 9,400 人の定数措置」を LLM が直接参照 → retry 出力で「9,400」を保持
- `karoshi-line-80h`: chunk 2 raw L672「過労死ライン(月 80 時間)」を LLM が直接参照 → retry 出力で「80 時間」を保持

ADR 0045 §背景の仮説「LLM map 段階での数値脱落は raw retry で代替できる」が両件で実証された。

### LLM 事前知識補完への構造的依存

observation-2026-05-17 §3.2 / §4.3 で確認したとおり、`buildRetryPrompt` の missing facts リストに fact `description`(具体数値を含む)を直接含めているため、LLM が raw を読まずに description を rewrite する「事前知識補完」が引き続き発生する。本観測では sourceChunks 内 chunk での grep 結果に基づく真の救出判定により判定品質は維持されているが、構造的依存自体は別 PDF への汎化時にハルシネーション混入リスクとして残る。本 ADR では `truth source = PDF 原文 + 編集者最終監修`(ADR 0040 §C-6)を継続前提とする。

## 検討した選択肢

### A. INPUT_SOURCE デフォルトを raw に変更(採用)

- 内容: `fact-check-grep.mjs` の `INPUT_SOURCE` 環境変数デフォルト値を `summary` から `raw` に変更。`INPUT_SOURCE=summary` の明示指定で従来動作を opt-in 復元可能とし後方互換を維持。`chunk-ranges-*.json` を依存ファイルとして必須化
- 期待効果: 真の救出率 100% を実運用で標準保証。運用者が手動で `INPUT_SOURCE=raw` を指定し忘れることによる救出率劣化を構造的に防ぐ
- 追加コスト: retry 実行時間 5.5 倍(本体 188s → 1031s)、prompt size 5-6 倍(~3,000 → 17,000-20,000 字 / chunk)。observation-2026-05-17 で実測済み、ADR 0045 §設計制約 (2) で許容範囲と判定済み

### B. INPUT_SOURCE=raw を opt-in 維持(却下)

- 内容: 現状の opt-in 動作を維持し、運用ドキュメントで raw 使用を推奨明記
- 却下理由: 「いつ raw に切り替えるか」のガバナンスが運用者依存となり、運用者の入れ替わりや手順失念によって真の救出率劣化が再発するリスク。Phase 2「正式採用」を意味するなら明示的にデフォルト挙動を変更すべき

### C. 用途別自動判定(却下)

- 内容: 短文書(概要版相当)= summary、長文書(本体相当)= raw を自動切替、または初期 grep の missing 件数で自動判定
- 却下理由: 判定閾値の決定が新たな ADR 議論を要し、observation-2026-05-17 で raw の追加コストが全 PDF で許容範囲と確認できているため自動判定の複雑度に見合うメリットがない。短文書でも真の救出率を保証する観点で常時 raw が一貫性高い

## 決定

A を採用。具体内容:

### (1) `fact-check-grep.mjs` デフォルト変更

`INPUT_SOURCE` 環境変数のデフォルト値を `summary` から `raw` に変更する。実装は本 ADR とは別 PR で行う(本 ADR は採用方針のみ決定)。

### (2) ADR 0040 §C-7 ステータス更新

ADR 0040 §決定 (2) C-7 末尾に「Phase 2 採用判定済(2026-05-17 / ADR 0046、observation-2026-05-17 で真の救出率 本体 100% / 概要版 100% を実証)」を 1-2 行追記する。実装は別 PR で実施可。

### (3) summary モードの後方互換

`INPUT_SOURCE=summary` の明示指定で従来の LLM map summary retry を復元可能とする。用途:

- 開発者の比較計測(新規 fact 追加時の summary vs raw 振る舞い比較)
- トラブルシュート時の chunk-ranges 整備前計測
- ハードウェア制約下(Ollama context overflow 発生時等)の緊急回避

## 設計制約

ADR 0045 §決定 (2) 設計制約を継承する:

- **1 retry = 1 chunk**: prompt size 増(~17,000-20,000 字 / chunk)に対応するため、chunk ごとに `callOllama` を別呼び出しし、grep 結果の union で救出判定(ADR 0045 §設計制約 (2)、ADR 0040 §C-1 chunk size 上限と整合)
- **依存ファイル**: `extracted.txt`(本体・概要版)、`chunk-ranges-v3.json`(本体)、`chunk-ranges-gaiyouban.json`(概要版)。新規 PDF を対象に追加する場合は対応する `chunk-ranges-{slug}.json` を整備
- **実行時間**: 本体 retry 17.2 分(3 chunk × ~340 s)、概要版 retry 3.5 分(1 chunk × 212 s)。observation-2026-05-17 §3 実測
- **truth source**: PDF 原文 + 編集者最終監修(ADR 0040 §C-6)を継続。LLM 事前知識補完への構造的依存は本 ADR では解消対象外

## 影響と運用

### 効果

- 本体 PDF を含む真の救出率 100% を実運用で標準保証(運用者依存のガバナンスを排除)
- ADR 0040 §C-7 Phase 2 採用判定基準 ≥ 70% を構造的に充足
- 別 PDF への汎化時、`chunk-ranges-*.json` 整備のみで raw retry が即時利用可能

### 監視 / リスク観測項目

- retry 実行時間(本体 17.2 分が運用継続可能水準か、新規 PDF サイズ拡大時の retry 時間)
- raw chunk text 投入後の幻覚混入(`fact-check-v3.md` 品質基準: 幻覚 0 / CRITICAL 欠落 2 件以下を維持)
- LLM 事前知識補完の残存(fact `description` rewrite の検出は別途運用上の課題、本 ADR では対象外)
- `chunk-ranges-*.json` 整備工数(新規 PDF を対象に追加する場合の page boundary 算出 + JSON 化コスト)

### ADR 0040 §C-7 ステータス

本 ADR をもって ADR 0040 §C-7「Phase 2 改修(精度向上)」は **採用判定済**。今後の post-process 数値 grep + retry 運用は本 ADR を前提とする。

## 撤回 / 再検討の条件

- 本体 retry 時間が個別 PDF の現実的な処理時間を超える(本体 1 PDF 1h+ 等)→ 本 ADR 撤回、別アプローチ(chunk 粒度再設計、別モデル、クラウド API 移行)を別 ADR で検討
- raw chunk text 投入後も CRITICAL 欠落が常態化、または幻覚混入が発生 → 本 ADR 撤回、ADR 0045 §代替案 B(map prompt 改善)等を別 ADR で検討
- Ollama / M1 16GB 環境で context overflow が頻発(prompt size 17,000-20,000 字 / chunk が context 上限を圧迫)→ chunk 切り出し粒度を再設計
- 新規 PDF の `chunk-ranges-*.json` 整備コストが採算割れ(編集者の手動 page boundary 算出工数が運用利益を超える)→ pdf-parse から自動算出するスクリプト追加、または対象 PDF を絞る
- LLM 事前知識補完によるハルシネーション混入が編集者監修で繰り返し検出される → 本 ADR で truth source 継続前提とした方針を再検討、`buildRetryPrompt` から fact `description` 数値を除外する別 ADR を起票

## 参考

- ADR 0040 §C-7「数値網羅性」/ §C-6「fact-check は人手 grep 突合が必須」/ §C-1「chunk size」(本 ADR で参照)
- ADR 0045「retry input source 切替戦略(PoC)」(PR #149、本 ADR の前提)
- `experiments/poc-pdf-summary/observation-2026-05-17.md`(本 ADR 起票根拠、本体 100% / 概要版 100% を実証)
- `experiments/poc-pdf-summary/observation-2026-05-13b.md`(本観測前段、本体 真の救出率 67% で判定未達)
- PR #152(PoC 実装、commit 67faa61、`INPUT_SOURCE=summary|raw` 分岐 + `chunk-ranges-v3.json` 新規)
- `experiments/poc-pdf-summary/fact-check-grep.mjs`(PR #155 でデフォルト値を `raw` に変更済)
