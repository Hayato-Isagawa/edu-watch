# 0050. W-1 AI 要約パイプライン MVP(registry 駆動 + per-chunk raw retry + pattern hardening)

- 状態: 採用
- 日付: 2026-05-21
- 関連 ADR: 0036(tier 1 公的 PDF を運用範囲に含めた根拠)/ 0040(§C-6 編集者監修フロー、§C-7 採用判定固定)/ 0046(retry 入力 raw 化、Phase 2 正式採用)/ 0008(§3 例外条項、ADR 0040 で追記済)
- 関連 PR: TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

ADR 0040 §C-7「数値網羅性 — Phase 2 採用判定済」は次の 2 観測で固定されている:

- `experiments/poc-pdf-summary/observation-2026-05-17.md`: 中央教育審議会答申本体(73p)で 100%、概要版で 100%
- `experiments/poc-pdf-summary/observation-2026-05-19.md`: 文部科学省通知(中教審第 251 号答申を踏まえた取組の徹底等について、`tsuuchi.pdf` 全 97p)3 セクションで表面救出率 96.2%(25/26)、真の救出率(strict)84.6%(22/26)

採用判定の前提が 2 件揃ったため、PoC コード(`experiments/poc-pdf-summary/extract-tsuuchi.mjs` / `mapreduce-v4-tsuuchi.mjs` / `fact-check-grep.mjs`)を引数化リファクタで本番化し、`scripts/ai-summary/` 配下で運用に乗せる W-1 MVP に進む判断材料が固まった。

本 MVP の運用範囲は文部科学省発信文書(中教審答申クラス)とし、`scripts/ai-summary/registry.json` の 1 エントリ `tsuuchi-r6-08-27` を初期登録例として固定する。GHA workflow + PR テンプレ + 編集者監修フロー(ADR 0040 §C-6)への接続は本 ADR PR の scope 外とし、本 ADR は CLI 単体運用までを決定する。

### セッション 71→73 の経緯(本 ADR 起票の補足)

- セッション 71: `scripts/ai-summary/` 配下の 4 mjs を新規実装(`experiments/poc-pdf-summary/` の引数化)
- セッション 72: untracked のままセッション終了 → 消失リスク
- セッション 73: WIP commit `8a05337 feat(ai-summary): restore pipeline with pattern hardening` を採用し、コード保全と pattern hardening 3 種を同時導入

セッション 74(本日 2026-05-21)で 3 セクション全数再計測を完了し、本 ADR の判断根拠が揃った。

## 検討した選択肢

### A. PoC コードを `experiments/` に置いたまま、運用ごとにコピペで個別実行(却下)

引数化なしで毎回ハードコード(対象 PDF パス / chunk-ranges / required-facts)調整が必要。`experiments/poc-pdf-summary/` は試作領域として運用に耐えない。

### B. PoC コードを `experiments/` に置いたまま、PR レビューも `experiments/` 配下のままで運用(却下)

`experiments/` は試作領域として `.gitignore` allowlist で運用しており、本番運用のメンテナンス対象は scope 違い。本番化に伴い `scripts/` 配下に昇格すべき。

### C. registry 駆動 + per-CLI 引数化(`scripts/ai-summary/`) + GHA + PR テンプレ + 編集者監修(採用)

`registry.json` を SSOT に、4 mjs(`extract.mjs` / `mapreduce.mjs` / `fact-check-grep.mjs` / `run-pipeline.mjs`)で構成。per-chunk raw retry(セッション 71-72 既存、ADR 0046)+ pattern hardening 3 種(セッション 73 追加、`8a05337`)を組み合わせる。GHA + PR テンプレ + 編集者監修フローへの接続は本 ADR PR では決定のみとし、具体実装は後続 PR に分離する。

## 決定

C を採用。具体内容は以下のとおり。

### (1) registry SSOT

`scripts/ai-summary/registry.json` に対象 PDF のメタデータを集約する。各エントリのフィールド:

- `slug`(主キー、URL-safe、kebab-case)
- `sourceTitle` / `sourceUrl` / `pdfUrl` / `category` / `issuer` / `issueDate`
- `sectionDetectionPatterns`(キー → 正規表現、`\s*` 柔軟 pattern 使用可)
- `sections[]`: 各セクションの `section` / `label` / `desc` / `boundary` / `chunkRanges` / `requiredFacts`

### (2) boundary schema

セクション境界を以下 4 種で宣言する:

- `fromPage: N`(ページ番号で開始)
- `fromAtKey: <pattern-key>, fromOffset: N`(`sectionDetectionPatterns` のキーに一致するページ + N ページ後から開始)
- `toEnd: true`(PDF 末尾まで)
- `toBeforeKey: <pattern-key>`(指定キーに一致するページの直前まで)

組み合わせ例(`tsuuchi-r6-08-27`):

- 通知本文: `{ fromPage: 1, toBeforeKey: "betsutenpu1" }`
- 別添資料 2: `{ fromAtKey: "betsutenpu2", fromOffset: 1, toBeforeKey: "betsutenpu3" }`
- 別添資料 3: `{ fromAtKey: "betsutenpu3", toEnd: true }`

### (3) 4 mjs 構成

- `extract.mjs`: pdf-parse でテキスト抽出、`sectionDetectionPatterns` でセクション分割、各セクションテキスト + flat 配列形式の chunk-ranges を生成
- `mapreduce.mjs`: gemma3:12b による map-reduce 要約(`num_ctx=32768` / `temperature=0.2`、Ollama ローカル)
- `fact-check-grep.mjs`: 必須数値の grep + per-chunk raw retry(missing fact のみ当該 sourceChunks の raw text を LLM に再投入)
- `run-pipeline.mjs`: registry エントリ 1 件を全セクション直列実行(`--section` で個別実行可、`--skip-extract` で抽出スキップ可、`--skip-retry` で retry スキップ可)

### (4) per-chunk raw retry(既存、ADR 0046 で正式採用)

map-reduce 出力に対し必須数値を grep し、missing fact については当該 `sourceChunks` の raw text を LLM に再投入して missing fact のみ生成する。再投入入力を map summary ではなく raw chunk text にすることで、map 段階で脱落した数値の救出率が向上する(ADR 0046 採用根拠、observation-2026-05-17 / -19 で再現確認済)。

### (5) pattern hardening 3 種(セッション 73 `8a05337` で導入)

required-facts JSON の pattern 表現で以下を運用ルール化:

- **(i) NFKC 正規化**: `fact-check-grep.mjs` 内で `text.normalize('NFKC')` を適用し、PDF 抽出時に発生する全角/半角差を吸収する(例: `１ ２９ ３` ↔ `1293`)
- **(ii) `\s*` 柔軟 pattern**: 数値や語句の文字間に PDF 抽出由来の空白が挿入されるケースを吸収(例: `月\s*45\s*時\s*間`)
- **(iii) 概念非依存 pattern 併記**: 1 つの fact に対し複数 pattern を OR 連結で記述し、表現揺れを吸収(例: 「過労死ライン」「月 80 時間」「80 時間を超過」)

3 種の併用により observation-2026-05-19 §4.4 で残存していた honbun `notice-number-date`(全角数字 + LLM 抽出失敗の二重要因)が本セッションで救出された(後述 §影響と運用 計測値参照)。

### (6) sourceUrl 一次研究ドメイン限定(edu-evidence `docs/CONTENT_GUIDELINES.md` Rule 1.2b 準拠)

`registry.json` の `sourceUrl` は一次研究ドメイン(論文 PDF / 公式 abstract / 政府公式資料 / 公的研究機関の publication ページ)に限定する。二次まとめサイト・教育系ニュース・ブランド blog・個人ブログ・書籍紹介ページは `sourceUrl` にしない。

姉妹リポジトリ edu-evidence の `docs/CONTENT_GUIDELINES.md` Rule 1.2b で明文化されている規約と整合させる(edu-watch リポジトリには同等ファイルが未配置のため、当面は姉妹リポジトリの規約を参照する運用とする)。

本 MVP の `tsuuchi-r6-08-27` は `mext.go.jp/b_menu/shingi/chukyo/...` で準拠する。

### (7) ADR 0040 §C-6 編集者監修フローとの連携(本 ADR PR では決定のみ)

本 MVP は CLI 単体運用までを決定する。GHA workflow(`.github/workflows/ai-summary.yml` 週次 cron + workflow_dispatch)+ PR テンプレ(`.github/PULL_REQUEST_TEMPLATE/ai-summary.md` 編集者監修チェックリスト)の具体実装は後続 PR で着手する。

編集者最終監修フロー(初回 3 件は教育長レベル監修、ADR 0040 §C-6)は本 ADR の運用範囲に組み込む。CLI 実行で生成された `tmp/ai-summary/<slug>/<section>/summary.md` + `fact-check-report.json` を編集者が原文 PDF と突合して核心数値 / 出典ページ / 幻覚有無の 3 点を確認することを運用前提とする。

## 影響と運用

### 計測(本 ADR の判断根拠)

セッション 74 = 2026-05-21、`tsuuchi-r6-08-27` 3 セクションの本番パイプライン実走測定。

| section | facts | 初期 present | retry 救出 | still-missing | 最終 | 実時間 |
|---|---|---|---|---|---|---|
| 通知本文(honbun、p.1-10) | 8 | 1 | 7 | 0 | **8/8 = 100%** | 1,026.9 s(セッション 73 計測) |
| 別添資料 2(betsutenpu-2、p.87) | 9 | 9 | retry 不要 | 0 | **9/9 = 100%** | 346.8 s |
| 別添資料 3(betsutenpu-3、p.88-97) | 9 | 4 | 5 | 0 | **9/9 = 100%** | 1,245.9 s |
| **合計** | **26** | **14** | **12** | **0** | **26/26 = 100%(表面)** | **2,619.6 s = 43.7 分** |

PoC observation-2026-05-19 との比較(同 PDF):

- honbun: 表面 87.5%(7/8) → 本番 100%(8/8)、+12.5pt。`notice-number-date` の stillMissing を pattern hardening (i) NFKC 正規化 + (iii) 概念非依存 pattern 併記で救出
- betsutenpu-2: 表面 100% 維持(9/9)、retry 不要も維持
- betsutenpu-3: 表面 100% 維持(9/9)、retry chunk 1 prompt サイズが PoC 1,303 chars → 本番 1,950 chars に拡大(`extract.mjs` の page marker 抽出改善示唆。root cause は別観測課題)

本 ADR の「表面救出率」は LLM 出力に対する grep 一致率を指す。observation-2026-05-19 §3.2 / §4.2 で観察された「真の救出率(strict)」(`grepFacts(LLM 出力) AND grepFacts(対応 raw chunk)` の二重判定)は本セッションでは別計測しておらず、§撤回 / 再検討の条件 で扱う。

### 効果

- 中教審答申クラスの公的 PDF に対し、編集者が論点抽出する前段の AI ダイジェスト + fact-check を CLI 1 行(`node scripts/ai-summary/run-pipeline.mjs --slug <slug>`)で実行可能
- 出典 page 明示(`(p.NN)` 多用)+ 必須数値網羅で、編集者 fact-check 工程に高い signal を残す
- ローカル Ollama 推論(gemma3:12b)のためコンテンツ・利用ログが外部 API に流出しない

### 監視 / リスク観測項目

- **LLM 事前知識補完**: observation-2026-05-19 §4.2 で betsutenpu-3 retry に 3 件(`salary-adjustment-4to13` / `class-teacher-allowance-3000` / `principal-allowance-5to10k`)観測。本 ADR の表面救出率は LLM 補完を含む値であり、新規エントリ追加時に真の救出率(strict)を併測する運用とする(構造実装は ADR 0054 参照。なお当該 3 件は pre-existing バグ由来の誤検出だったことが ADR 0054 検証過程で判明、詳細は observation-2026-05-24)
- **pattern hardening の副作用**: NFKC 正規化で半角 / 全角が一致するため、本来別の文字列を取り違える可能性。各 PDF 追加時に initial.present の False positive を編集者が原文突合で確認する
- **`extract.mjs` page marker 検出**: セッション 74 で raw chunk prompt サイズが PoC 1,303 → 本番 1,950 chars に拡大した症状緩和を観測したが、root cause は未解明。別エントリ追加時に同症状が出ないか観測する
- **実行コスト**: 1 エントリ 3 セクション = 計 43.7 分(M1 16GB)。エントリ追加で線形増加、月次運用上限の合意は GHA 化時に別途決定する

### 副次効果(注意)

- README.md(`scripts/ai-summary/README.md`)の line 68「`0050-ai-summary-pipeline-promotion.md`」予告表記を本 PR で実ファイル名 `0050-w1-ai-summary-mvp.md` に修正する
- `experiments/poc-pdf-summary/` は **削除せず保持**(ADR 0040 §C-7 / ADR 0046 / observation-2026-05-17 / observation-2026-05-19 のトレーサビリティ確保)

## 撤回 / 再検討の条件

- 別エントリ追加時に真の救出率(strict)が ADR 0040 §C-7 採用基準 70% を下回った場合
- LLM 事前知識補完が常態化し編集者監修工程で重大な訂正が連続した場合(`grepFacts(LLM 出力) AND grepFacts(対応 raw chunk)` 二重判定強化を別 ADR で検討)
- 編集者監修コストが運用継続不能水準に達した場合(ADR 0040 §撤回条件と整合)
- ADR 0040 / 0046 自体が撤回された場合(本 ADR の前提が消失)
- Ollama / gemma3:12b の挙動が大きく変動し、本セッションの表面 100% 計測が再現不能になった場合(四半期ごとの再評価で判定)

## 参考

- ADR 0036(tier 1 公的 PDF を運用範囲に含めた根拠)
- ADR 0040 §C-6(編集者最終監修フロー)/ §C-7(数値網羅性 Phase 2 採用判定固定)
- ADR 0046(retry 入力 raw 化、Phase 2 正式採用)
- ADR 0008 §3(例外条項、ADR 0040 で追記済)
- `experiments/poc-pdf-summary/observation-2026-05-17.md`(本体 100% / 概要版 100%)
- `experiments/poc-pdf-summary/observation-2026-05-19.md`(通知 3 セクション 表面 96.2% / strict 84.6%)
- `scripts/ai-summary/README.md`(本 PR で line 68 修正)
- `scripts/ai-summary/registry.json`(本 MVP 対象 PDF レジストリ、boundary schema 仕様)
- `tmp/ai-summary/tsuuchi-r6-08-27/run-honbun-session73.log`(honbun セッション 73 実測 1,026.9 s)
- `tmp/ai-summary/tsuuchi-r6-08-27/run-betsutenpu-2-session74.log`(betsutenpu-2 セッション 74 実測 346.8 s)
- `tmp/ai-summary/tsuuchi-r6-08-27/run-betsutenpu-3-session74.log`(betsutenpu-3 セッション 74 実測 1,245.9 s)
- `tmp/ai-summary/tsuuchi-r6-08-27/betsutenpu-{2,3}/fact-check-report.json`(機械可読 fact-check レポート)
- セッション 73 commit `8a05337 feat(ai-summary): restore pipeline with pattern hardening`(pattern hardening 3 種の出自)
- 姉妹リポジトリ edu-evidence の `docs/CONTENT_GUIDELINES.md` Rule 1.2b(sourceUrl 一次研究ドメイン限定)
