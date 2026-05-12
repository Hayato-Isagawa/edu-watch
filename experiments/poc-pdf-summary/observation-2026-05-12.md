# 観測レポート: ADR 0040 §C-7 retry 救出率(2026-05-12)

## 目的

ADR 0040 §C-7「post-process 数値 grep + 不足時 retry」運用機構の retry プロンプト戦略が、本体 PDF 固有の振る舞いか、概要版 PDF でも常態化するかを判定する。常態化が確認できた場合、retry プロンプト戦略変更を扱う次フェーズ ADR の起票判断を行う。

判定基準(セッション 19 計画書 `~/.claude/plans/zazzy-weaving-snowglobe.md` 既定):

- 常態化: retry 救出率 < 30%(retry 試行に対する recovered 数)
- 改善: ≥ 70%
- 中間: 30-70%

## 観測対象

| 区分 | PDF | URL | サイズ | ページ数 | テキスト長 |
|---|---|---|---|---|---|
| 本体 | 中教審第251号答申(本体) | <https://www.mext.go.jp/content/20240827-mxt_zaimu-000037727_01.pdf> | 1.0MB | 73p | 91,987 chars |
| 概要版 | 中教審第251号答申(概要版) | <https://www.mext.go.jp/content/20240827-mxt_zaimu-000037727_02.pdf> | 685KB | 4p | 6,542 chars |

両 PDF は同一答申の本体・概要版ペア。

実行環境: `gemma3:12b` / `num_ctx=32768` / Ollama ローカル(M1 MacBook Air 16GB)。

## 実行結果(mapreduce)

| 指標 | 本体 | 概要版 |
|---|---|---|
| chunk 構成 | 5 (16,371 / 18,417 / 16,802 / ... chars) | 1 (6,532 chars) |
| map 計時間 | ~2,100s(5 calls) | 299.8s(1 call) |
| reduce 時間 | ~360s(1 call) | 115.1s(1 call) |
| 総時間 | 計 2,460.9s / 6 LLM calls | 計 414.9s / 2 LLM calls |
| 最終 summary 出力 | 970 chars | 861 chars |

概要版は本体の 1/6 の時間で完了し、出力サイズは同程度に集約された(C-8 出力長制約の固定的な振る舞いと整合)。

## fact-check 結果(grep + retry)

| 指標 | 本体 | 概要版 |
|---|---|---|
| REQUIRED_FACTS 総数 | 9 | 5(本体 9 件のうち概要版に存在する 5 件) |
| initial present | 5/9 | 2/5 |
| initial missing | 4 | 3 |
| retry 試行(sourceChunks 指定あり) | 1(mental-illness-6539) | 3(work-survey-41-58 / karoshi-line-80h / class-size-35-r7) |
| out-of-scope(chunk から脱落、retry 試行外) | 3 | 0 |
| retry 後 recovered | 0 | 0 |
| retry 後 stillMissing | 1 | 3 |
| retry 経過時間 | 193.1s | 179.4s |
| retry prompt chars | 5,533 | 3,575 |
| retry 出力 chars | 1,180(元 970 → +21%) | 1,125(元 861 → +31%) |

**retry 救出率: 本体 0/1 + 概要版 0/3 = 計 0/4(0%)**。判定基準「< 30% で常態化」を満たす。

## retry 後出力の手検証(重要発見)

retry 0/3 救出は grep 結果上「retry が機能していない」ように見えるが、**`summary-gaiyouban-checked.md` 実機を確認すると、概要版で missing と判定された 3 件の数値はすべて出力に保持されている**。

| missing 判定 fact | 実機出力の該当箇所(`summary-gaiyouban-checked.md`) |
|---|---|
| `work-survey-41-58` | L17「小学校教員の月当たりの時間外在校等時間は、平成28年度の約59時間から令和4年度には約41時間に、中学校教員の月当たりの時間外在校等時間は、平成28年度の約81時間から令和4年度には約58時間に減少しています。」 |
| `karoshi-line-80h` | L3 / L19「時間外在校等時間が月80時間超の教師をゼロにし、...」 |
| `class-size-35-r7` | L14「義務標準法の改正に伴い、少人数指導等のための教師の基礎定数化や小学校の学級編制の標準の35人への引下げ」 |

つまり LLM は retry を経て(retry プロンプトに含まれた)該当数値を summary に保持しているが、grep パターン側の精度が不足して偽陰性が出ている。

### 偽陰性の原因分析

各 fact の現行パターンと実機出力の不一致は次の通り。

**`work-survey-41-58`**: パターン `(小学校|小)[^。\n]{0,20}41\s*時間[\s\S]{0,200}(中学校|中)[^。\n]{0,20}58\s*時間`。「小学校」と「41 時間」の距離は最大 20 文字を要求するが、実機は「小学校教員の月当たりの時間外在校等時間は、平成28年度の約59時間から令和4年度には約41時間」と約 50 文字。距離制約超過でマッチせず。

**`karoshi-line-80h`**: パターン `過労死[^。\n]{0,30}(月|1か月)?\s*80\s*時間` 系。「過労死」という語が必須だが、実機の概要版は「月80時間超の教師をゼロ」と書き、「過労死ライン」を使わない。同義の数値があってもキーワード不一致で偽陰性。

**`class-size-35-r7`**: パターン `35\s*人[^。\n]{0,10}学級`。実機は「学級編制の標準の35人」で順序が逆。順序不問パターンが無いため偽陰性。

加えて NFKC 正規化(半角全角・記号の差異)は両側で行っていないが、本観測の 3 件は半角全角ではなく上記の構造的不一致が主因。

## ADR 0041 起票判断

retry 救出率 0% は判定基準上「常態化」だが、上記の手検証から **0% の支配的要因は「retry プロンプト戦略の限界」ではなく「grep パターン精度不足による偽陰性」** である。retry プロンプトを変更しても、grep パターンを直さない限り計測上の救出率は改善しない。

このため ADR 0041 の起票判断は本観測の時点では**保留**とし、次フェーズで以下の二択(または両軸)を比較してから判断する。

### 軸 A: grep パターン精度向上

- 文字距離制約の緩和(20 → 100 文字、200 → 500 文字)
- 順序不問パターン化(`35人...学級` と `学級...35人` の両方を許容)
- 同義表現の許容(`過労死(ライン)?` を必須から外し、`月80時間` のみで一致を取る案 / または severity を CRITICAL → HIGH に緩めるとともに別 fact `karoshi-line-equivalent-80h` を追加)
- NFKC 正規化を grep 前段に挟む

これだけで本観測の 3 件は全て present 判定に変わる可能性が高い。検証可能性と保守性の点で安価。

### 軸 B: retry プロンプト戦略変更

- 現行: summary 全体再生成型(C-8 出力長制約が効きにくい)
- 候補: 不足数値だけを該当セクションに追記する「diff 形式 retry」/ JSON 構造化 retry(`{ "missing_facts_to_add": [...] }` 形式)/ 不足 fact ごとの個別段落生成型

軸 A だけで観測が常態的に改善できれば軸 B は不要、軸 A を当てた後でも救出率が低いままなら軸 B を起票する、という二段階の意思決定が現実的。

### 推奨

次セッション以降の運用観測フェーズで以下を行う:

1. 軸 A の grep パターン改善を別 PR で実装し、本観測と同じ 2 サンプル(本体 + 概要版)に対して再計測
2. 改善後の救出率が 70% を超えるなら軸 B は不要(現状の retry 戦略で十分)
3. 改善後も 30% を下回るなら軸 B を ADR 0041 として起票

## 既知の限界・別タスク

- 観測サンプル数 2(本体 / 概要版)は最小限。3 件目以降の PDF(他答申・他省庁公文書)で追加検証が望ましい
- gemma3:12b 固定の前提(ADR 0040 §C-2)、他モデルでの retry 振る舞いは未観測
- ADR 0040 §C-6 編集者最終監修は本観測の対象外(grep 偽陰性は最終的に編集者が補正する設計)
- 2026-11-06 までの OECD メール照会、yaml-language-server upstream watch、kkn / resemom 採用件数推移観測は本観測と独立

## 参考

- ADR 0040: `docs/decisions/0040-ai-assisted-summary-with-editor-supervision.md`
- セッション 19 計画書: `~/.claude/plans/zazzy-weaving-snowglobe.md`
- 本観測の生成物(`.gitignore` 配下、git 管理外): `summary-gaiyouban.md` / `summary-gaiyouban-checked.md` / `chunk-1-gaiyouban.md` / `metrics-gaiyouban.json` / `fact-check-gaiyouban-report.json` / `mapreduce-gaiyouban.log` / `fact-check-gaiyouban.log`
- 本体観測の生成物(`.gitignore` 配下、git 管理外): `summary-v3.md` / `summary-v3-checked.md` / `chunk-{1..5}-v3.md` / `metrics-v3.json` / `fact-check-grep-report.json`
- 本観測で git 管理化するファイル: `mapreduce-v3.mjs`(env 拡張) / `fact-check-grep.mjs`(env 拡張) / `required-facts-gaiyouban.json` / `chunk-ranges-gaiyouban.json` / 本ファイル
