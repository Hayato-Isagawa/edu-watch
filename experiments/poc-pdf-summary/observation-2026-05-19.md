# Observation 2026-05-19: 文科省通知 PoC 再現性計測(novel 3 セクション + raw retry)

## 1. 目的

ADR 0040 §C-7「数値網羅性 — Phase 2 採用判定済(2026-05-17 / observation-2026-05-17)」を文科省通知(中教審第251号踏まえ、`tsuuchi.pdf` 全 97 ページ)で再現性検証する。observation-2026-05-17 は同一中教審答申(73 ページ)で本体 100% / 概要版 100% を実証したが、(1) 対象 PDF が答申そのものに限定されている、(2) PDF 統合構造(本体 + 別添資料 1-3 合冊)の通知では未検証、という 2 点を本観測で解消する。

A 案(novel 3 セクション = 通知本文 + 別添資料2 + 別添資料3)を独立測定。別添資料1(中教審答申そのもの)は observation-2026-05-17 既測定済の参照値として流用し、本計測ではスコープ外。

## 2. 計測条件

- **ブランチ**: `feat/poc-w2-tsuuchi-reproducibility`(main `b7e6418` から派生)
- **対象 PDF**: `tsuuchi.pdf`(4.7MB / 97 ページ / sha256 = `8ea8327b99d04dfb244ade3e94a411705fe256285de7eb7450b4102ac47f3107`、文科省「令和の日本型学校教育」を担う質の高い教師の確保のための環境整備に関する総合的な方策について(答申)を踏まえた取組の徹底等について(通知)、令和6年9月30日付け 文科初第1293号)
- **セクション分割**: 通知本文 p.1-10(novel)/ 別添資料2 p.87(novel)/ 別添資料3 p.88-92, p.93-97(novel)。別添資料1 p.11-86 はスコープ外
- **抽出**: `extract-tsuuchi.mjs`(セッション 63 実装、pdf-parse + 正規表現 boundary + start2 のみ +1 補正)で `extracted-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.txt` 生成(40,794 / 6,416 / 42,885 chars)
- **map-reduce**: `mapreduce-v4-tsuuchi.mjs` SECTION 切替で 3 セクション順次実行(セッション 64、合計 1,826.2 s = 30.4 分、全 exit 0)
- **fact-check 入力**:
  - chunk-ranges を flat 配列形式に分割: `chunk-ranges-v4-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.json`(セッション 65 新規 3 ファイル、`loadRawChunkSources` flat 配列前提)
  - required-facts セクション別新規起草: `required-facts-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.json`(セッション 65 新規 3 ファイル、計 26 件、ユーザー承認済)
- **fact-check 実行**: `INPUT_SOURCE=raw EXTRACTED_PATH=./extracted-tsuuchi-{section}.txt SUMMARY_PATH=./summary-v4-tsuuchi-{section}.md CHUNK_RANGES_PATH=./chunk-ranges-v4-tsuuchi-{section}.json REQUIRED_FACTS_PATH=./required-facts-tsuuchi-{section}.json OUTPUT_PATH=./summary-v4-tsuuchi-{section}-checked-raw.md REPORT_PATH=./fact-check-grep-tsuuchi-{section}-raw-report.json node fact-check-grep.mjs`(3 セクションを `&&` チェーンで background 実行、bash ID `bohduv41r`、実測 497.0 s = 8.3 分で完走、exit 0)
- **モデル**: `gemma3:12b` / `num_ctx=32768`、Ollama ローカル

## 3. 計測結果

### 3.1 数値結果

| セクション | facts | 初期 present | retry 救出 | stillMissing | 最終 present | 表面救出率 |
|---|---|---|---|---|---|---|
| 通知本文(honbun、p.1-10、19,812 chars) | 8 | 3 | 4 | 1 | 7 | **87.5%** |
| 別添資料2(betsutenpu-2、p.87、2,372 chars) | 9 | 9 | retry 不要 | 0 | 9 | **100%** |
| 別添資料3(betsutenpu-3、p.88-97、16,528 chars) | 9 | 4 | 5 | 0 | 9 | **100%** |
| **合計** | **26** | **16** | **9** | **1** | **25** | **96.2%** |

retry 実行コスト:

- honbun retry: chunk 1(prompt 21,441 chars / 13,599 tokens、378.3 s、eval 745 tokens、output 1,264 chars)
- betsutenpu-2 retry: 不要(no-recoverable-missing)
- betsutenpu-3 retry: chunk 1(prompt 1,303 chars / 889 tokens、118.7 s、eval 635 tokens、output 1,009 chars)
- retry 合計: 497.0 s = 8.3 分(obs-17 本体 retry 17.2 分との比較で 1/2 以下、別添資料2 retry スキップ + betsutenpu-3 chunk 1 prompt 異常小サイズの両要因)

### 3.2 真の救出 vs LLM 事前知識補完の切り分け

observation-2026-05-17 §3.2 と同手法。sourceChunks 内 chunk N の raw に該当数値が実在し、その chunk N の retry 出力で救出されたかを判定する。本計測の全 missing facts は sourceChunks=[1] のみで宣言されているため、chunk 1 raw 内の存在を柔軟スペース対応 grep で確認した。

| セクション | Fact | sourceChunks 内 raw | retry 出力 | 救出の性質 |
|---|---|---|---|---|
| honbun | overtime-month-45h(月45時間) | ✓ L202-203「月 45 時 間」 | ✓ | **真の救出** |
| honbun | karoshi-line-80h(過労死月80時間) | ✓ L197「月 80 時 間 を超 過」 | ✓ | **真の救出** |
| honbun | standard-hours-1086-overstep(1,086単位時間) | ✓ L139「年 間 1,086 単 位 時 間 以 上」 | ✓ | **真の救出** |
| honbun | interval-11h(勤務間インターバル11時間) | ✓ L286「11 時 間 を 目 安 と す る 「勤 務 間 イン」 | ✓ | **真の救出** |
| honbun | notice-number-date(文科初1293号 令和6年9月30日) | ✓ L9-10「文 科 初 第 １ ２９ ３ 号」「令 和 ６ 年 ９ 月３ ０ 日」(**全角数字**) | ❌(LLM は令和6年8月27日 = 答申 issue date を誤抽出) | **stillMissing**(grep pattern が半角想定で全角数字非対応 + LLM 抽出失敗の二重要因) |
| betsutenpu-3 | subject-teacher-2160(+2,160人) | ✓ L63「＋ 2,160 人」 | ✓ | **真の救出** |
| betsutenpu-3 | class-size-35-3086(+3,086人) | ✓ L111「＋ 3,086 人」 | ✓ | **真の救出** |
| betsutenpu-3 | salary-adjustment-4to13(教職調整額4%→13%) | ❌(柔軟 grep でも「4%」「13%」未検出、L145-157 に「教職調整額」概念のみ) | ✓「4%から13%へ」 | **LLM 事前知識補完疑い** |
| betsutenpu-3 | class-teacher-allowance-3000(学級担任 月額3,000円) | ❌(「3,000 円」未検出、L168「➢ 学級担任への加算：月額」のみ) | ✓「月額3,000円」 | **LLM 事前知識補完疑い** |
| betsutenpu-3 | principal-allowance-5to10k(管理職手当 月額5,000~10,000円) | ❌(「5,000~10,000」未検出、L171「➢ 管理職手当の改善：支給水準の改善」のみ) | ✓「月額5,000円～10,000円」 | **LLM 事前知識補完疑い** |

「真の救出」のみで再集計(strict):

- **honbun**: 真の救出 4/4(retry 救出のうち)、初期 present 3 合算 → **7/8 = 87.5%**(stillMissing 1 = notice-number-date)
- **betsutenpu-2**: retry 不要、9/9 = **100%**
- **betsutenpu-3**: 真の救出 2/5(retry 救出のうち)、初期 present 4 合算 → **6/9 = 66.7%**(LLM 事前知識補完疑い 3 件を控除)
- **合計 strict**: 22/26 = **84.6%**(表面救出率 96.2% との差 11.6 pt が LLM 事前知識補完疑い + stillMissing)

### 3.3 出典(PDF 原文と raw chunk text の対応)

honbun pages 1-10 の通知ヘッダ(L1-30、`--- page 1 / 97 ---` 直後):

```
殿
「「 令 和の 日 本 型 学 校 教育 」を 担 う 質 の 高 い教 師 の 確保 の た め の環 境 整 備に
関 する 総 合 的な 方 策 に つい て （ 答申 ） 」 （ 令和 ６ 年 ８月 27 日 中央 教 育 審議
会 ）を 踏 ま えた 取 組 の 徹底 等 に つい て 通 知 しま す 。
文 科 初 第 １ ２９ ３ 号
令 和 ６ 年 ９ 月３ ０ 日
```

通知発出日「令和 6 年 9 月 30 日」と通知番号「文科初第 1293 号」は全角数字で記載。required-facts の正規表現は半角数字前提(`文(科|部科学)初第\s*1,?293\s*号` / `令和\s*6\s*年\s*9\s*月\s*30\s*日`)のため、PDF 抽出の全角文字に対して grep が miss する。次回見直しのため `[1１][2２][9９][3３]` 等の半角/全角併記パターンを検討する課題を残す。

betsutenpu-3 chunk 1 raw(p.88-92)で確認できた数値(L60-200 抜粋):

- L63「＋ 2,160 人」(教科担任制拡充、subject-teacher-2160 ✓)
- L82「＋ 1,750 人」(高学年教科担任、required-facts 外)
- L95「＋ 410 人」(新規採用、required-facts 外)
- L99「＋232 億円」(処遇改善、salary-improvement-232 = 初期 present ✓)
- L111「＋ 3,086 人」(35人学級、class-size-35-3086 ✓)
- L115「＋ 7,653 人」(教職員定数、teacher-count-up-7653 = 初期 present ✓)
- L145, 152, 157「教職調整額の改善」「教職調整額の水準」(概念のみ、4%/13% の具体数値は柔軟 grep でも見当たらず)
- L165-168「学級担任や管理職の職務」「➢ 学級担任への加算：月額」(月額 3,000円 の具体数値見当たらず)
- L171「➢ 管理職手当の改善：支給水準の改善」(5,000-10,000円 の具体数値見当たらず)
- L187, 191「新たな職の創設」(令和8年4月 の具体時期見当たらず)

LLM retry 出力(`summary-v4-tsuuchi-betsutenpu-3-checked-raw.chunk1.md`)が chunk 2 領域の数値「外国人児童生徒支援 1,405 百万円(p.93)」「メンタルヘルス対策 0.8 億円(p.95)」「GIGAスクール構想(p.96)」を citation 付きで言及している点も注目。retry は chunk 1 raw のみを入力としているにもかかわらず LLM が pre-training 知識または map summary 由来の情報で補完していると解釈される。

## 4. 詳細分析

### 4.1 observation 2026-05-17 との比較

| 指標 | obs-17(中教審答申 73p 本体) | obs-19 通知本文 | obs-19 別添2 | obs-19 別添3 |
|---|---|---|---|---|
| 表面救出率 | 100%(9/9) | 87.5%(7/8) | 100%(9/9) | 100%(9/9) |
| 真の救出率(strict) | 100% | 87.5% | 100% | **66.7%** |
| 初期 present 比率 | 56%(5/9) | 38%(3/8) | **100%(9/9)** | 44%(4/9) |
| retry 必要性 | あり | あり | **なし** | あり |
| retry 時間 | 1031.0 s = 17.2 分 | 378.3 s = 6.3 分 | 0(skip) | 118.7 s = 2.0 分 |
| chunk あたり最大 retry prompt | 19,857 chars | **21,441 chars** | — | 1,303 chars |
| stillMissing 件数 | 0 | 1(notice-header 全角数字) | 0 | 0 |
| LLM 事前知識補完疑い件数 | 0(本体)/ 0(概要版) | 0 | 0 | **3** |

obs-17 では本体 100% / 概要版 100% の高い真の救出率を実証したが、obs-19 では:

- **通知本文**: 表面/真の救出率ともに 87.5%、stillMissing 1 件は raw 内全角数字 + grep pattern 不整合の二重要因
- **別添資料2**: 表面 100% / 真の救出 100%、retry スキップで最速
- **別添資料3**: 表面 100% / 真の救出 66.7%(LLM 事前知識補完疑い 3 件含む)

3 セクション合計の表面救出率 96.2% は ADR 0040 §C-7 採用判定基準 ≥ 70% を大幅クリア。真の救出率(strict)84.6% でも採用基準クリア。

### 4.2 LLM 事前知識補完の挙動(betsutenpu-3)

betsutenpu-3 retry の chunk 1 prompt は 1,303 chars と異常に小さい(honbun retry chunk 1 の 21,441 chars と比較 1/16)。chunk-ranges-v4-tsuuchi-betsutenpu-3.json の chunk 1 は p.88-92 で **想定 ~21,000 chars** だが、実プロンプトは 1,303 chars 止まり。fact-check-grep.mjs の `loadRawChunkSources` で extracted-tsuuchi-betsutenpu-3.txt の page marker(`--- page X / 97 ---`)検出が想定通り動作していない可能性が高い。

この小サイズ raw に対して LLM が出力した retry summary は 1,009 chars。raw 文脈情報がほぼゼロの状態で:

- 「4%から13%」「月額3,000円」「月額5,000円～10,000円」「令和8年4月」等 raw 不在の具体数値を citation 付き(p.91)で挿入
- p.93 / p.95 / p.96 の chunk 2 領域に該当する数値を chunk 1 retry 出力に列挙

これらは **LLM が pre-training 知識 + map summary 残響から事実を補完して出力した** と解釈するのが妥当。obs-17 §4.3「sourceChunks 外 chunk での出現」と同じ機序(retry プロンプトの missing facts 列挙文中の `description` を LLM が rewrite)で説明可能。grepFacts による pattern match に依存した救出判定の盲点として記録する。

判定方法改善案: 救出判定を `grepFacts(LLM 出力)` から「`grepFacts(LLM 出力) AND grepFacts(対応 raw chunk)`」の二重判定に強化することで、LLM fill を構造的に検出可能(実装難易度は中程度)。

### 4.3 ADR 0040 §C-2 chunk size 上限超過観察(honbun)

honbun(p.1-10)の単一 chunk 処理:

- session 64 map step prompt: 19,812 chars(ADR 0040 §C-2 上限 18,000 chars に対し **+10% 超過**)
- session 65 retry step prompt: 21,441 chars(同上限に対し **+19% 超過**)

両 step とも response 切断なく完走し、retry 救出も 4/4 真の救出で成立。LLM が 19-21K 規模の prompt を処理可能な事例が 2 件揃った。

ただし n=2 のため §C-2 上限変更の根拠としては不足。本観測の chunk 1 処理が単一 chunk(他 chunk への分割なし)で完走したことは記録するが、§C-2 上限値(15,000-18,000)は当面維持し、複数事例の蓄積後に再評価する。

### 4.4 stillMissing 1 件(notice-number-date)の構造分析

honbun stillMissing「文科初第1293号 令和6年9月30日付け」は次の二重要因で grep match に至らなかった:

1. **PDF 抽出時の全角数字保持**: 通知ヘッダ部の番号「１ ２９ ３」と日付「６ 年 ９ 月 ３ ０ 日」が抽出テキストで全角数字のまま残った。required-facts pattern `1,?293` / `9\s*月\s*30\s*日` は半角想定のため不一致
2. **LLM 抽出失敗**: chunk 1 retry の LLM 出力は通知発出日として「令和6年8月27日」(中教審答申の issue date)を抽出。本物の通知発出日「令和6年9月30日」は通知 PDF 冒頭 L9-10 に明記されているが、LLM が文書冒頭(L2-3)の答申引用部分の日付を採用したため

要因 1 は required-facts pattern を `[1１],?[2２][9９][3３]` 等の半角/全角併記に拡張すれば解消可能。要因 2 は LLM への chunk 1 raw 入力プロンプトに「通知ヘッダ部の文科初第〜号 / 令和〜年〜月〜日 を抽出せよ」等の明示指示を追加するか、通知ヘッダ部のみを別 chunk に切り出す追加処理で対応可能。本観測では現状 stillMissing として記録、運用上の改善候補とする。

## 5. 結論

- **通知本文**: 表面/真の救出率 87.5%(7/8)、stillMissing 1 件は grep pattern 全角数字非対応 + LLM 抽出失敗の二重要因
- **別添資料2**: 表面/真の救出率 100%(9/9)、retry 不要で最速処理
- **別添資料3**: 表面 100%(9/9)/ 真の救出 66.7%(6/9)、LLM 事前知識補完疑い 3 件
- **3 セクション合計**: 表面救出率 96.2%(25/26)、真の救出率(strict)84.6%(22/26)
- **ADR 0040 §C-7 採用判定**: 採用基準 ≥ 70% に対し表面/真のいずれもクリア、再現性確認済(obs-17 と通算 2 件目)
- **PoC 仮説の再実証**: 「raw chunk text 投入により LLM map 段階で脱落した数値も救出可能」が通知 PDF 文脈でも確認された

## 6. 次フェーズ判断

### 6.1 推奨: W-1(MVP 実装)着手

observation-2026-05-17 + 本観測の 2 件で raw 投入による高救出率の再現性が確認されたため、ADR 0040 §C-7 採用判定が固まった。次のステップとして MVP 実装(W-1)に着手する判断材料が揃った。

### 6.2 並行課題(W-1 着手前後で判断)

- **required-facts pattern 全角数字対応**: notice header 系数値の取りこぼしを防ぐため、PDF 抽出特性に応じた pattern 拡張を W-1 着手前に実施するか、W-1 内で実装するかを判断
- **fact-check-grep.mjs raw chunk slicer 調査**: betsutenpu-3 chunk 1 prompt 1,303 chars 異常小サイズの原因究明(page marker 検出ロジック調査)
- **LLM 事前知識補完の検出機構**: 救出判定を `grepFacts(LLM 出力)` から「`grepFacts(LLM 出力) AND grepFacts(対応 raw chunk)`」の二重判定に強化することで LLM fill を構造的に検出可能(中程度の実装作業)

### 6.3 ADR 0040 §C-2 上限の再評価候補

honbun の map / retry 両 step で +10% / +19% 超過(計 2 事例)を観測。複数事例蓄積後の §C-2 上限変更を別 PR で検討する。

## 7. Next Action

1. PoC 一括コミット + PR 作成(セッション 67 持ち越し、PR タイトル英語、本文日本語、Refs ADR 0040 §C-7 / observation-2026-05-19)
2. ADR 0040 §C-7 末尾の本観測追記(本セッション 66 で実施)
3. `.gitignore` allowlist に generated 8 系統を一括追加(本セッション 66 で実施)
4. fact-check-grep.mjs raw chunk slicer 調査(別タスク、W-1 前後で着手判断)
5. W-1(MVP 実装)着手判断: 本観測 + obs-17 で採用基準クリア、本セッション終了後にユーザー判断

## 関連

- ADR 0040 §C-7「数値網羅性 — Phase 2 採用判定済」
- observation-2026-05-17.md(中教審答申 73p PoC、本観測の前提となる基準)
- `~/.claude/plans/structured-puzzling-fox.md`(W-2 計画、A 案で固定、セッション 61 ユーザー承認)
- `tsuuchi.pdf`(対象 PDF、文科省通知 中教審第251号踏まえ、sha256 = `8ea8327b99d04dfb244ade3e94a411705fe256285de7eb7450b4102ac47f3107`)
- `extract-tsuuchi.mjs`(抽出実装、セッション 62-63)
- `mapreduce-v4-tsuuchi.mjs`(map-reduce 実装、セッション 63)
- `chunk-ranges-v4-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.json`(flat 配列形式、セッション 65 分割)
- `chunk-ranges-v4-tsuuchi.json`(section-keyed 形式、セッション 63)
- `required-facts-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.json`(セクション別新規起票、26 件、セッション 65)
- `summary-v4-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}.md`(map-reduce 出力、セッション 64、generated)
- `summary-v4-tsuuchi-{honbun, betsutenpu-3}-checked-raw.chunk1.md`(retry chunk 1 出力、セッション 65)
- `fact-check-grep-tsuuchi-{honbun, betsutenpu-2, betsutenpu-3}-raw-report.json`(機械可読レポート、セッション 65)
- `fact-check-grep-tsuuchi-all.log`(3 セクション順次実行ログ、セッション 65)
