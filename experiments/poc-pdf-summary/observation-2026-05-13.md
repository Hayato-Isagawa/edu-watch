# 観測レポート: 軸 A(grep パターン精度向上)実装後の present 改善計測(2026-05-13)

## 目的

セッション 21 の観測レポート(`observation-2026-05-12.md`)で「retry 救出率 0% の支配的要因は grep パターン精度不足による偽陰性」と結論した仮説を検証するため、軸 A(grep パターン精度向上)を実装し、改修前後で initial present 数を比較する。

これにより以下を切り分ける:

1. grep パターン精度由来の偽陰性 → 軸 A 改修で present 化するはず
2. LLM reduce 出力に該当数値が含まれていない欠落 → 軸 A 改修でも依然 missing(retry または編集者最終監修で補完)

## 改修内容

### `fact-check-grep.mjs`(本体ハードコード REQUIRED_FACTS)

- `grepFacts()` 前段で `text.normalize('NFKC')` を実行(全角数字・全角記号を半角に正規化)
- `work-survey-41-58-6years`: 文字距離制約を緩和(20 → 100、200 → 500)
- `karoshi-line-80h`: 既存 2 パターン(過労死必須)に加え、`(月|1か月)\s*80\s*時間(超|以上|を超)` の単独パターンを追加(過労死キーワード非必須)
- `class-size-35-r7`: 既存 `35人...学級` に加え、逆順 `学級[^。\n]{0,30}35\s*人` パターンを追加

### `required-facts-gaiyouban.json`(概要版)

- `work-survey-41-58`: 距離制約 20 → 100、200 → 500、両順序許容
- `karoshi-line-80h`: `(月|1か月)\s*80\s*時間(超|以上|を超)` 単独パターン追加
- `class-size-35-r7`: 逆順パターン追加

その他の fact(`salary-adjustment-10pct` / `overtime-month-45h` / `overtime-year-360h` / `subject-teacher-9400` / `teacher-cert-info-r6` / `mental-illness-6539`)は改修なし。

## 計測条件

- 既存の `summary-v3.md`(本体 reduce 直後)/ `summary-gaiyouban.md`(概要版 reduce 直後)を再利用
- `SKIP_RETRY=true` で initial grep のみ実行、retry プロンプト戦略は本観測では触らない
- mapreduce 再実行は不要(LLM 出力は同一)
- 出力先: `fact-check-grep-axisA-report.json` / `fact-check-gaiyouban-axisA-report.json`

## 結果

| サンプル | total | 改修前 initial.present | 改修後 initial.present | 差分 | 改修後 missing |
|---|---|---|---|---|---|
| 本体 | 9 | 5(`salary` / `overtime-month` / `overtime-year` / `class-size` / `teacher-cert`) | 5(同上) | 0 | 4(`work-survey-41-58-6years` / `subject-teacher-9400` / `karoshi-line-80h` / `mental-illness-6539`) |
| 概要版 | 5 | 2(`salary` / `overtime-month`) | 4(+`karoshi-line-80h` / +`class-size-35-r7`) | +2 | 1(`work-survey-41-58`) |

**概要版の改修後 present 率: 80%(判定基準 ≥ 70% を満たす)**。本体の改修後 present 率: 56%(改修前と変化なし)。

## 詳細分析

### 概要版で改善した 2 件は grep 精度問題

- `karoshi-line-80h`: 概要版 `summary-gaiyouban.md` L3 に「時間外在校等時間が月80時間超の教師をゼロにし」あり。改修前は「過労死」必須で偽陰性、改修後の単独パターンでマッチ
- `class-size-35-r7`: 概要版 L14「小学校の学級編制の標準の35人への引下げ」あり。改修前は「35人 学級」順序固定で偽陰性、改修後の逆順パターンでマッチ

→ いずれも **LLM の reduce 出力には数値が記述されており、grep パターン精度のみが偽陰性を生んでいた**。仮説検証成功。

### 概要版の残 1 件は LLM reduce 出力の脱落

- `work-survey-41-58`: 概要版 `summary-gaiyouban.md` には「41時間」「58時間」記述が**無い**。改修後 grep パターンを当てても source text に無いものは検出不可
- セッション 20 で計測した retry 後 `summary-gaiyouban-checked.md` には L17 に「平成28年度の約59時間から令和4年度には約41時間 ... 約58時間に減少」と数値が復活している
- つまり reduce 段階で脱落 → retry で復活する可能性が高い数値。軸 A の grep 改修と既存 retry プロンプトの組み合わせで救出できる見込み(本観測スコープ外)

### 本体の 4 件全て LLM reduce 出力の問題

- `summary-v3.md` を実機確認した結果、「41時間」「58時間」「9,400 人」「6,539 人」「過労死」「月80時間」のいずれも記述なし
- → 改修後 grep でも検出不可。これらは LLM reduce 段階の脱落(本体は chunk が 5 個ありそれぞれ独立した summary を reduce、概要版より圧縮率が高い)
- セッション 18 / 19 で計測した本体 retry 後 `summary-v3-checked.md` でも `mental-illness-6539` は stillMissing、他の 3 件は out-of-scope(sourceChunks=[] のため retry 試行外)で残っている

## 結論

軸 A は grep パターン精度問題を確実に解消した。概要版で改修によって明確に 2 件が present 化したことが直接的な証拠。

ただし、軸 A だけでは LLM reduce 出力の数値脱落は救出できない。次の課題は以下の 2 つに分解される:

1. **chunk → reduce で脱落する数値の救出**: retry プロンプト戦略(軸 B、ADR 0041 候補)/ reduce プロンプト改善 / chunk 段階での fact 抽出強化
2. **`sourceChunks=[]` 設定の見直し**: 本体の `work-survey-41-58-6years` / `subject-teacher-9400` / `karoshi-line-80h` は現状 `sourceChunks=[]` で retry 試行外。実際の出典 chunk を特定して `sourceChunks` を設定すれば、軸 A 改修後の grep が retry で復活した数値を捉えられる

## 次フェーズ判断

- 軸 A 実装の効果は概要版で実証(present 40% → 80%)
- ADR 0041 起票判断は引き続き保留。次の観測候補:
  - (i) 軸 A + 既存 retry の組み合わせで、本体・概要版で実際に救出率がどう変化するか計測(mapreduce 再実行が必要、本体 41 分 + 概要版 7 分)
  - (ii) 本体 REQUIRED_FACTS の `sourceChunks` を実 chunk に再マッピング(L57 / L65 / L74 の `sourceChunks: []` を修正)
- (i) と (ii) を組み合わせれば、軸 B(retry プロンプト戦略変更)の追加効果を切り分けて評価できる

## 参考

- 前回観測: `observation-2026-05-12.md`
- 改修コード: `fact-check-grep.mjs` L42-95(REQUIRED_FACTS) / L111-117(grepFacts NFKC 正規化) / `required-facts-gaiyouban.json`
- 計測結果生成物(`.gitignore` 配下、git 管理外): `fact-check-grep-axisA-report.json` / `fact-check-gaiyouban-axisA-report.json`
- 既存 summary(`.gitignore` 配下、git 管理外): `summary-v3.md` / `summary-gaiyouban.md`
