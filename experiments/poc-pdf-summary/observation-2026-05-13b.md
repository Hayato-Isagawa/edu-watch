# Observation 2026-05-13b: 軸 A + 既存 retry の組み合わせ計測

## 1. 目的

ADR 0040 §C-7「Phase 2 改修(精度向上)」採用判断の根拠取得。軸 A(grep パターン精度向上、PR #134 でマージ済)と既存 retry プロンプト戦略を組み合わせた状態で本体 + 概要版の present 率を計測し、retry 入力ソースを LLM map summary に固定したままの現行設計の限界を切り分ける。あわせて ADR 0041(retry input source 切替)の起票判断材料を得る。

## 2. 計測条件

- **ブランチ**: `feat/poc-axisA-retry-measurement`(main `46eea7a` から派生)
- **軸 A 改修**: PR #134 マージ済(`fact-check-grep.mjs` の `grepFacts()` 前段 NFKC 正規化、`work-survey-41-58-6years` / `karoshi-line-80h` / `class-size-35-r7` の 3 件パターン改修、`required-facts-gaiyouban.json` 概要版 3 件パターン改修)
- **sourceChunks 再マッピング**: 本体 `fact-check-grep.mjs` の 3 件
  - `work-survey-41-58-6years`: `[]` → `[2]`(L57)
  - `subject-teacher-9400`: `[]` → `[3]`(L64)
  - `karoshi-line-80h`: `[]` → `[1, 2, 3]`(L75)
- **入力 summary**: 既存 LLM 出力を再利用(本体 `summary-v3.md`、概要版 `summary-gaiyouban.md`)、mapreduce 再実行なし(軸 A 単独計測と同条件)
- **retry プロンプト戦略**: 既存(`buildRetryPrompt(summary, recoverable, chunkSources)`、chunkSources は LLM map summary 経由)、変更なし
- **モデル**: `gemma3:12b` / `num_ctx=32768`、Ollama ローカル

## 3. 計測結果

### 3.1 数値結果

| サマリ | 初期 present | retry 救出 | 最終 present | 表面救出率 |
|---|---|---|---|---|
| 本体(9 facts) | 5/9(56%) | +2 | 7/9 | **78%** |
| 概要版(5 facts) | 4/5(80%) | +1 | 5/5 | **100%** |

実行時間: 本体 retry 188.2 s / 概要版 retry 148.3 s。

### 3.2 真の救出 vs LLM 事前知識補完の切り分け

| Fact | sourceChunks | chunk summary 存在 | retry | 救出の性質 |
|---|---|---|---|---|
| 本体 `mental-illness-6539` | [1, 3] | ✓ chunk-1 L52 / chunk-3 L21 | ✓救出 | **真の救出** |
| 本体 `work-survey-41-58-6years` | [2] | ❌ chunk-2 grep 0 件 | ✓救出 | **LLM 事前知識補完(結果偶然正解)** |
| 本体 `subject-teacher-9400` | [3] | ❌ chunk-3 grep 0 件 | ✗未救出 | 妥当(LLM 補完不発) |
| 本体 `karoshi-line-80h` | [1, 2, 3] | ❌ いずれも 0 件 | ✗未救出 | 妥当 |
| 概要版 `work-survey-41-58` | [1] | ✓ chunk-1-gaiyouban L23 | ✓救出 | **真の救出** |

「真の救出」のみで再計算: 本体 **6/9 = 67%**(判定基準 ≥ 70% **未満**)。

### 3.3 出典(PDF 原文と LLM map summary の対照)

PDF 原文(`extracted.txt`、本体)では全数値が存在:

| 数値 / 表現 | 行 | ページ | 該当 chunk |
|---|---|---|---|
| 「約 41 時間」 | L650-651 | p.19 | chunk 2 |
| 「約 58 時間」 | L651 | p.19 | chunk 2 |
| 「６年間で約３割減少」 | L653 | p.19 | chunk 2 |
| 「6,539 人」 | L361 / L1106 | p.10 / p.31 | chunk 1, 3 |
| 「過労死」 | L327, L341 / L864 | p.9-10 / p.24 | chunk 1, 2 |
| 「過労死ライン(月 80 時間)」 | L672 | p.19 | chunk 2 |
| 「過労死等の防止」 | L1189 | p.32 | chunk 3 |
| 「合計 9,400 人の定数措置」 | L1356 | p.37 | chunk 3 |

LLM map summary(`chunk-1-v3.md` 〜 `chunk-5-v3.md`)では大半が脱落:

- 「6,539」のみ chunk-1 L52(`**精神疾患による病気休職教師:** 6,539人 (令和4年度) (p.10)`)/ chunk-3 L21(`令和4年度に精神疾患により病気休職が発令された教育職員は6,539人`)に出現
- 「41 時間」「58 時間」「3 割減」「9,400」「過労死」「月 80 時間」は chunk-1〜5 で grep 0 件

概要版(`extracted-gaiyouban.txt` + `chunk-1-gaiyouban.md`):

- 原文 L53: 「約41時間 約58時間」
- LLM map summary chunk-1-gaiyouban L23: 「小学校教員の月当たりの時間外在校等時間は、平成28年度の約59時間から令和4年度には約41時間に、中学校教員の月当たりの時間外在校等時間は、平成28年度の約81時間から令和4年度には約58時間に減少」

つまり概要版では chunk 段階で数値が保持されており retry が真に救出。本体の chunk-2 では脱落しており、retry 出力に登場した数値は LLM の事前知識(教員勤務実態調査は文科省公表値で著名)による補完。

## 4. 詳細分析

### 4.1 本体の真の救出(`mental-illness-6539`)

chunk-1 L52 と chunk-3 L21 の両方に「6,539 人」が保持されていた。retry プロンプトは sourceChunks=[1, 3] に従い両 chunk summary を投入。LLM はそれを参照して reduce 出力に「精神疾患による病気休職教師は令和4年度で6,539人に達している。(p.10)」(`summary-v3-axisA-retry-checked.md` L20)を含めた。chunk summary に元情報が残っていれば retry は確実に救出できる。

### 4.2 本体の LLM 補完(`work-survey-41-58-6years`)

chunk-2 grep で「41 時間」「58 時間」「3 割減」が 0 件にもかかわらず、retry 出力(同 L3 末尾)に「教員勤務実態調査によると、教員の月平均勤務時間は小41時間、中58時間であり、6年間で3割減を目指す。(p.3)」が出現。retry プロンプトに投入される情報源は ① `summary` 本体(セッション 22 で grep 確認済、該当数値なし)/ ② `recoverable` リスト(fact の `description` に「月41h(小)・月58h(中)・6 年で 3 割減」を含む)/ ③ `chunkSources` = chunk-2-v3.md(該当数値なし)。

LLM が出力に含めた数値は ② の `description` に直接書かれた情報を rewrite した可能性が高い。**fact 定義文の中に正解の数値表現が含まれていると、retry プロンプトが事実上の答え合わせシートとして機能する**。結果として PDF 原文と一致しているが、これは「chunk text に基づく救出」ではなく「fact description の rewrite」であり、別 PDF で同じ仕組みを使うとハルシネーションが正解と一致しない事態が起きうる。

### 4.3 本体の未救出(`subject-teacher-9400` / `karoshi-line-80h`)

両者とも chunk summary に該当数値なし、かつ fact `description` に具体数値(9,400 / 月 80 時間)を含むのに retry 出力に登場せず。`subject-teacher-9400` は `summary-v3-axisA-retry-checked.md` L9 で「小学校高学年の教科担任制：令和6年度までに推進。(p.19)」と教科担任制への言及はあるが「9,400 人」の数値は欠落。`karoshi-line-80h` は「過労死」「80 時間」のいずれも reduce 出力に登場せず。

LLM 補完が `work-survey-41-58-6years` では発動し、これら 2 件では発動しなかった非対称性の原因は不明。可能性としては教員勤務実態調査の数値が学術文献・報道で頻出する一方、9,400 人定数措置は文科省内部文書寄り、過労死ライン月 80 時間は文脈次第で複数解釈があるため LLM の自信度が低い、等が考えられる。**LLM 補完は再現性が保証されない**点で本観測の中核的な発見。

### 4.4 概要版の真の救出(`work-survey-41-58`)

概要版は本文 6 ページのため map summary が短く、原文の数値が脱落せずに残った。chunk-1-gaiyouban.md L23 を retry プロンプトが拾い、reduce 出力 `summary-gaiyouban-axisA-retry-checked.md` L17 に「小学校教員の月当たりの時間外在校等時間は、平成28年度の約59時間から令和4年度には約41時間に、中学校教員の月当たりの時間外在校等時間は、平成28年度の約81時間から令和4年度には約58時間に減少しています。(p.1)」と転記。これは ADR 0040 §C-7 が想定する「軸 A + retry」の本来の動作。

## 5. 結論

- **概要版**: 軸 A + retry で 5/5(100%)達成、全件真の救出。ADR 0040 §C-7 採用可
- **本体**: 表面 7/9(78%)、真の救出ベース 6/9(67%)で判定基準未満。表面値で採用すると LLM 事前知識補完への依存が残り、PDF が変わると再現性が崩れるリスク
- 本体の未救出 2 件(`subject-teacher-9400` / `karoshi-line-80h`)は PDF 原文に確実に存在(`extracted.txt` L1356 / L327, L672, L1189)するが、LLM map 段階で脱落して chunk summary に保持されないため、現行 retry 設計では救出不能

## 6. 次フェーズ判断

### 6.1 推奨: ADR 0041 起票(retry input source 切替)

retry プロンプトに投入する情報を **LLM map summary → raw chunk text(`extracted.txt` の page 範囲切り出し)** に切り替える。

- **期待効果**: 本体の未救出 2 件は原文に確実に存在するため真の救出可能性が高い。LLM 事前知識補完への依存も低減
- **追加コスト**: prompt size 増大(chunk summary ~3,000 字 → raw text ~16,000-18,000 字/chunk)、retry 実行時間延長見込み(本体 188 s → 推定 300-500 s)
- **実装**: `fact-check-grep.mjs` の `chunkSources` ロード処理を変更、`extracted.txt` の page boundary を `chunk-ranges-v3.json` から取得して切り出し

### 6.2 代替案: 軸 B(map prompt 改善)

map 段階で LLM が数値を脱落させない指示・例示を強化。

- **期待効果**: 上流で数値が残るため retry に依存せず純粋に initial grep で救出
- **追加コスト**: 本体 mapreduce 全再実行(~41 分)、概念的には「reduce で数値を保持しろ」と書いても LLM が要約圧縮を優先するため改善の天井が低い可能性

### 6.3 採用判断

ADR 0041 候補(retry input source 切替)を先行 PoC 化する。コスト増は許容範囲、本体の未救出 2 件が PDF 原文に確実に存在する以上、まず raw chunk text 投入で真の救出率を引き上げてから、それでも残る課題に対して軸 B を検討するのが投資対効果が高い。

## 7. Next Action

1. ADR 0041(retry input source 切替)起票
2. `fact-check-grep.mjs` の `chunkSources` を raw chunk text にする PoC 実装(`feat/poc-retry-raw-chunk-source` 等の新ブランチ)
3. 本体 + 概要版で再計測し本 observation と比較
4. 真の救出率が ≥ 70% に到達すれば ADR 0040 §C-7 採用、未到達なら軸 B(map prompt 改善)へ移行

## 関連

- ADR 0040 §C-7「Phase 2 改修(精度向上)」
- PR #134(軸 A: grep パターン精度向上、2026-05-12 マージ)
- observation-2026-05-12.md(軸 A 実装前のベースライン)
- observation-2026-05-13.md(軸 A 単独計測、本体 5/9 / 概要版 4/5)
- `extracted.txt`(本体 PDF 原文)
- `chunk-1-v3.md` 〜 `chunk-5-v3.md`(本体 LLM map summary)
- `summary-v3-axisA-retry-checked.md` / `summary-gaiyouban-axisA-retry-checked.md`(本観測の retry 後 reduce 出力)
- `fact-check-grep-axisA-retry-report.json` / `fact-check-gaiyouban-axisA-retry-report.json`(本観測の機械可読レポート)
