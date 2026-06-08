# observation-2026-06-07: gemma3→gemma4 乗り換え検証 — 不可視 thinking トークン暴走により gemma3:12b 維持

## 1. 目的

gemma4:12b(Ollama 配布、Apache 2.0、ctx 262144、capabilities に thinking 追加)が W-1 AI 要約パイプラインの gemma3:12b を置き換えられるかを、同一入力(tsuuchi-r6-08-27、`--skip-extract`)の再実行で検証する。

比較基準: ADR 0054 L127 = gemma3 strict 観測幅 **23-26/26**(n=3、平均 96.2%。26 = honbun 8 + betsutenpu-2 9 + betsutenpu-3 9)。

## 2. 検証環境

- M1 MacBook Air 16GB / Ollama **0.30.6**
  - brew formula は llama-server 欠落バグ(Homebrew/homebrew-core #285917、0.30 以降 bottle に Ollama パッチ版 llama-server が未同梱)のため本検証冒頭で削除し、brew cask **`ollama-app`**(公式ビルド)に切替。モデルは `~/.ollama` 共有で再 pull 不要
- gemma4:12b(ID `4eb23ef187e2`、Q4_K_M、`requires 0.30.5`)
- パイプライン: `scripts/ai-summary/run-pipeline.mjs`(`MODEL` env が子プロセスへ伝播)
- LLM オプション: `num_ctx=32768` / `temperature: 0.2` のみ(mapreduce.mjs:97)。**`think` / `num_predict` は未設定**
- コマンド:
  ```
  MODEL=gemma4:12b node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --skip-extract
  MODEL=gemma4:12b node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --section betsutenpu-2 --skip-extract  # 再現確認
  ```
- ログ: `tmp/ai-summary/tsuuchi-r6-08-27/run-gemma4-validation-20260607.log` / `run-gemma4-betsutenpu2-rerun-20260607.log`
- gemma3 既存出力は `tmp/ai-summary/tsuuchi-r6-08-27.gemma3-backup-20260607/` に保全済み(本検証で tmp/ の honbun・betsutenpu-2 出力は gemma4 版に上書きされている)

## 3. 計測結果

### 3.1 honbun(strict 8/8)

| 項目 | gemma4:12b |
|---|---|
| map | eval 2654t / 711.9s(prompt 12788t) |
| reduce | eval 2764t / 501.6s(prompt 1471t) |
| mapreduce 計 | 1213.5s |
| grep 初回 | 4/8 → retry 1414.6s で全回復 |
| **strict** | **8/8**(hallucination 0, dropped 0) |

### 3.2 betsutenpu-2(2 回実行、いずれも map で eval 暴走)

- **1 回目**(全 section 実行): map が入力 2372 chars に対し **eval 5700t 超**を生成し続けた時点で中断(ユーザー承認)。n=1 部分観測
- **2 回目**(単体再現確認): 完走。事前判定基準「eval 4000t 超で再現確定」に対し **eval=10311t → 再現確定**

| 項目 | gemma3:12b(baseline) | gemma4:12b(2 回目) | 比 |
|---|---|---|---|
| map | eval **941t** / 191.3s(prompt 1744t) | eval **10311t** / 2096.4s(prompt 1746t) | **11.0x** |
| reduce | eval 815t / 155.3s | eval 2403t / 496.2s | 2.9x |
| mapreduce 計 | 346.5s | 2592.5s | 7.5x |
| grep 初回 | **9/9**(3 試行とも、retry 不要)※ | 7/9(HIGH 2 件 missing)→ retry **2262.7s** | retry 新規発生 |
| section 合計 | **約 5.8 分** | **約 81 分**(wall: 14:59:47→16:20:42) | **約 14x** |
| **最終 strict** | 9/9 | **9/9**(hallucination 0, dropped 0) | 同等 |

※ gemma3 の betsutenpu-2 は observation-2026-05-24 §7.9 の 3 試行すべてで grep 初回 9/9(retry path 非突入)。

### 3.3 betsutenpu-3

未実行。betsutenpu-2 の再現確定で gemma3 維持が決まったため検証不要と判断。

## 4. メカニズム分析: 「生成ループ」ではなく不可視 thinking トークン

セッション 120 の当初解釈は「生成ループ」だったが、以下の証拠により **デフォルト ON の thinking トークン暴走**と確定:

1. **可視出力は正常**: 2 回目の map 出力(`betsutenpu-2/chunk-1.md`)は 63 項目の整然とした抽出リスト(6.6KB)で、退行的な繰り返しは存在しない
2. **トークン収支が合わない**: 可視出力 ≈3-4 千 t に対し eval=10311t → **約 6-7 千 t が不可視**
3. **最小再現**(Ollama 0.30.6、think 未指定):
   ```
   curl /api/generate -d '{"model":"gemma4:12b","prompt":"日本の都道府県の数は?1文で答えて。","stream":false}'
   → response: 「日本の都道府県の数は47です。」(15 chars)
   → eval_count: 192 / response JSON に thinking フィールドなし
   ```
   思考トークンは生成・課金(eval 計上)されるが応答からは完全に不可視
4. `ollama show gemma4:12b`: capabilities に **thinking**(gemma3 にはない)
5. **系統的に再現**(betsutenpu-2 で 2/2)— temperature 0.2 の確率的ループではなくモデルの一貫挙動
6. **思考量は入力サイズ非比例**: honbun(入力 19812 chars)→ eval 2654t に対し、betsutenpu-2(入力 2372 chars、1 ページ物の工程表)→ eval 10311t。小さく構造的に密な入力で激化
7. 無限ループではなく**自己終了する**(~10.3k t)。ただし map 1 call が 35 分級になる

## 5. 判定: gemma3:12b 維持(gemma4 不採用)

> **2026-06-07 追記**: 本判定は `think` 未設定構成に対するもの。同日ユーザー指示により §6 の前提条件 1(think:false)を実装して再検証した結果、**品質は同等圏(strict 25/26)を確認** — §9 参照。最終的な採否判断は §9.5。

- 事前合意基準(eval 4000t 超で再現確定 → gemma4 不適)を満たした
- **品質は同等圏に到達**(honbun strict 8/8 + betsutenpu-2 strict 9/9、hallucination 0)。不採用理由は品質ではなく**実行特性**:
  - betsutenpu-2 1 section で約 81 分(gemma3 比 14 倍)。thinking が grep 初回劣化(9/9→7/9)も誘発し retry 38 分が追加発生
  - `num_predict` 未設定のため暴走時の上限保険がなく、無人 cron 運用に不適
  - 生成速度自体も 4.92-5.91 t/s と gemma3(6.0 t/s)よりやや遅い
- **default MODEL は gemma3:12b のまま**。リポジトリのコード変更ゼロで本検証をクローズ

## 6. gemma4 再挑戦の前提条件(将来案、未検証)

1. `callOllama`(mapreduce.mjs / fact-check-grep.mjs)のリクエスト直下に **`think: false`** を追加して思考を無効化 → 検証 1 周を再実施(eval 10311t → 1-2 千 t 級、section 81 分 → 数分に収まる見込み)
2. 保険として **num_predict ガード**を併設(thinking 有効のままでは回答前に切れるリスクがあるため think:false が前提)
3. ライセンス面の利点(Apache 2.0 化、ctx 256K)は確認済みで、再挑戦の動機は残る

## 7. 運用上の教訓

- **kill の成否を pgrep の空表示で判定しない**: 本検証で `pkill -f` + `pgrep -fl` 空表示 + バックグラウンドタスク終了通知(exit 144)が揃った後も、パイプラインは実際には生存しており完走していた(kill 操作 15:25 → [strict] のログ書き込み 16:20)。原因は未確定(sandbox shell からのシグナル不達 / pgrep -f の引数照合失敗の可能性)。停止確認は `ps aux` での PID 直接確認 + 対象ログ mtime の進行停止 + `ollama ps` の 3 点で行う
- `ollama ps` の「Stopping...」は in-flight リクエスト完了待ちのペンディング表示(セッション 120 知見の再確認)。リクエストが終わるとモデルは自動アンロードされ llama-server も終了する

## 8. 関連(§9 追記前の時点)

- ADR 0054(strict 基準値 23-26/26)/ ADR 0040(W-1 パイプライン・モデル採用)
- observation-2026-05-24(strict 判定自動化、§7.9 で gemma3 の grep 初回 9/9 安定性)
- Homebrew/homebrew-core #285917(brew formula の llama-server 欠落。cask `ollama-app` 切替で解決、W-1 Step 3 ブロッカーも解消)

## 9. 追加検証(同日セッション 121 続き): think:false 適用後の全 section 再検証

§5 の報告後、ユーザー指示(「もう一度検証しませんか?」)により §6 前提条件 1 を実装して再検証した。

### 9.1 変更内容

- ブランチ `feat/ai-summary-think-false`(main `0c560f5` から派生)
- `mapreduce.mjs` / `fact-check-grep.mjs` の `callOllama` リクエストボディに `think: false,` を各 1 行追加(計 2 行)
- 事前の最小再現(curl、47 都道府県プロンプト):
  - gemma4 + think:false → **eval_count 192 → 9**(思考完全抑制)
  - gemma3 + think:false → **エラーなし・no-op**(eval_count 8)→ thinking 非対応モデルにも無条件で追加可能と確認

### 9.2 計測結果(3 section、n=1)

| section | map eval(think なし → think:false) | grep 初回 | retry | **strict** | section 合計 |
|---|---|---|---|---|---|
| honbun | 2654t → **1181t** / 453.3s | 3/8(missing 5) | 482.8s → 7/8 | **7/8**(llm_dropped 1) | 1083.4s(18.1 分) |
| betsutenpu-2 | 10311t → **1687t** / 286.3s | 7/9(missing 2) | 214.9s → 9/9 | **9/9** | 677.3s(11.3 分) |
| betsutenpu-3 | (未計測)→ **1312t + 888t**(2 chunks) | **9/9**(retry 不要) | — | **9/9** | 2335.3s(38.9 分)※ |
| **合計** | | | | **25/26(96.2%)** | 4096.0s(68.3 分) |

※ betsutenpu-3 の reduce が **1625.4s**(prompt 2616t / eval 1517t = **0.93 t/s**)と異常に遅い。eval トークン量は正常(暴走なし)で生成速度のみ劣化 — 原因未特定(3 section 連続実行によるメモリプレッシャー / prompt cache 蓄積を疑うが未検証)。他の call は 4.9-5.9 t/s で健全であり、これを除く実効時間は約 46 分。

- hallucination は 3 section とも 0
- betsutenpu-2 の grep 初回 missing は school-problem-support-r6 + class-hours-check-r6(§3.2 の think なし時は school-problem-support-r6 + giga-dx-checklist-r5)— 欠落項目は試行間で変動する stochastic 性質。ただし gemma4 の betsutenpu-2 grep 初回は n=2 とも 7/9 で、gemma3(3 試行 9/9)より初回到達率が低い傾向
- honbun の grep 初回 3/8 → retry 7/8(still-missing 1)。gemma3 の honbun も n=3 で 8/8, 6/8, 8/8 と変動しており、7/8 は確率変動圏内

### 9.3 ADR 0054 基準との比較

- gemma4 think:false 合計 **25/26 = 96.2%** は、gemma3 の n=3 **平均(25/26 = 96.2%)と同値**、観測幅 23-26/26 の内側
- → **品質は同等圏**(n=1)。§5 の不採用理由だった実行特性の破綻(81 分/section)も解消(11-18 分/section ※ betsutenpu-3 の異常 reduce を除く)

### 9.4 think:false 適用後も残る gemma3 との差

1. 実行時間: eval トークン量が gemma3 比 1.5-1.8 倍 + 生成速度 4.9-5.9 t/s(gemma3 6.0)で、全体として 2-3 倍遅い
2. 連続実行後半での速度劣化(0.93 t/s、原因未特定)という不確実性
3. grep 初回到達率がやや低い(retry 突入頻度が上がる)

### 9.5 採否(ユーザー判断待ち)

- **品質面**: 同等圏確認済み(n=1)。乗り換えの動機 = Apache 2.0 ライセンス / ctx 256K(gemma3 の 2 倍)/ tools 等 capability
- **慎重材料**: §9.4 の速度面、特に劣化原因が未特定のまま無人 cron に載せるリスク
- 選択肢: (A) gemma4 採用(default MODEL 変更 + think:false、要 ADR)/ (B) gemma3 維持 + think:false のみ取り込み(将来の thinking モデル事故防止、gemma3 に無害)/ (C) 全て破棄して記録のみ

## 10. 3 つ巴比較(同日セッション 122): gemma4:e4b 追加検証

§9 の gemma4:12b に加え、ユーザー指示により小型の **gemma4:e4b**(実効 8.0B / Q4_K_M / Apache 2.0 / thinking 対応 / 3.3GB)を同一構成(`think:false`、`num_ctx=32768`、tsuuchi-r6-08-27、`--skip-extract`)で検証した。

ログ: `tmp/ai-summary/tsuuchi-r6-08-27/run-gemma4e4b-validation-20260607.log`

### 10.1 e4b 計測結果(3 section、n=1)

| section | map eval | grep 初回 | retry | **strict** | section 時間 |
|---|---|---|---|---|---|
| honbun | 2064t / 247.1s | 4/8(missing 4) | 149.6s → **still-missing 4** | **4/8**(llm_dropped 4) | 451.3s(7.5 分) |
| betsutenpu-2 | 456t / 41.0s | 6/9(missing 3) | 74.8s → 9/9 | **9/9** | 169.0s(2.8 分) |
| betsutenpu-3 | 1873t + 1359t / 335.3s | 7/9(missing 2、うち CRITICAL 1) | 162.7s → 9/9 | **9/9** | 606.6s(10.1 分) |
| **合計** | | | | **22/26(84.6%)** | 1226.9s(**20.4 分**) |

- hallucination は 3 section とも 0
- 生成速度 6.5-13.1 t/s(健全)。§9 の gemma4:12b で観測された betsutenpu-3 reduce の **0.93 t/s 劣化は再現せず**(e4b の同 reduce = 6.5 t/s)
- **honbun で HIGH 4 件(標準授業時数 1015 / 1086 超過 / 教員勤務実態 3 割減 / 勤務間インターバル 11h)を retry でも回復できず恒久脱落**(still-missing 4 = 回復 0/4)。これが 22/26 の主因。12B 勢は同種の初回 missing を retry で回復しており、e4b の retry 失敗は容量限界を示唆
- betsutenpu-3 の CRITICAL「教職調整額 4%→13%」は grep 初回 missing → retry で回復(9/9)

### 10.2 3 モデル比較

| | gemma3:12b | gemma4:12b +tf | gemma4:e4b +tf |
|---|---|---|---|
| 実効パラメータ | 12B | 12B | **8.0B** |
| strict(本検証) | 23-26/26(n=3 平均 25) | 25/26(n=1) | **22/26(n=1)** |
| honbun strict | 8/8・6/8・8/8 | 7/8 | **4/8(恒久脱落 4)** |
| 総時間 | 約 12-17 分 | 68.3 分(劣化除き ~46 分) | **20.4 分** |
| 生成速度 | 6.0 t/s | 4.9-5.9 t/s(末尾 0.93 劣化) | **6.5-13.1 t/s(劣化なし)** |
| ctx(max) | 128K | 256K | 128K |
| ライセンス | Gemma | **Apache 2.0** | **Apache 2.0** |

※ ctx は各モデルの最大能力。本ベンチは 3 機種とも `num_ctx=32768` で実行(最大チャンク 19812 chars=12786t に十分)。256K / 128K の差はより大きな文書を 1 チャンク化する将来用途でのみ効き、本ベンチの優劣には無関係。

### 10.3 評価

- **e4b の強み**: 最速(20 分 = gemma4:12b の約 1/3、gemma3 より速い)/ 速度が最も安定(末尾劣化なし)/ 最小(3.3GB)/ Apache 2.0
- **e4b の致命点**: honbun で HIGH 4 件を **retry でも回復不能な恒久脱落**。strict 22/26 は gemma3 の観測下限(23)を下回る。本パイプラインは required-facts の CRITICAL/HIGH 忠実抽出が目的であり、主要 section での HIGH 恒久脱落は速度利得で相殺できない
- → **e4b は主用途に不適**(D2 非推奨)。残る現実的選択は §9.5 の A(gemma4:12b)か B(gemma3 維持 + think:false)

### 10.4 採否(ユーザー判断待ち、§9.5 を 3 つ巴確定版に更新)

- **(A) gemma4:12b 採用** — 品質同等(25/26)+ Apache 2.0 + ctx256K。代償は 2-3 倍遅 + 末尾速度劣化の未特定リスク(無人 cron 懸念)。要 ADR + default MODEL 変更
- **(B) gemma3 維持 + think:false のみ取り込み** — 品質・速度の実績を保持(23-26/26、12-17 分)。think:false は gemma3 に無害な no-op だが、将来の thinking 対応モデル誤投入に対する保険。最小リスク
- **(D2) e4b 採用** — **非推奨**(10.3 の HIGH 恒久脱落)
- **(C) 全破棄** — think:false の保険も捨てる

→ 推奨は **B**(無人 cron の安定性 + n=3 実績重視)。Apache 2.0 / ctx256K を強く重視するなら A も妥当。
