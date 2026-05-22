---
name: ai-summary-diagnose
description: W-1 AI 要約パイプライン(Ollama gemma3:12b + registry.json + 4 mjs)で生じた回帰・脱落・幻覚・boundary 不整合を、フィードバックループ確立 → 再現 → 仮説 → 計測 → 修正+回帰 → クリーンアップの 6 フェーズで根本原因まで追う。
origin: mattpocock/skills(/diagnose)を W-1 特化に書き換え
---

# ai-summary-diagnose — W-1 パイプライン障害の構造的診断

## いつ使うか

- `node scripts/ai-summary/run-pipeline.mjs --slug ...` の出力が期待と違う(数値脱落、boundary ずれ、retry ループ、fact-check false positive、文字化け)
- GHA workflow `ai-summary.yml` が成功しているのに編集者レビューで「数値が抜けている」「セクションが切れている」と指摘された
- observation-2026-05-17 / -19 の網羅率を再現できない
- ADR 0040 §C-7「真の救出率(strict)」が未計測の対象に対して計測したい

## いつ使わないか

- 単純な typo / lint エラー(直接修正)
- 新規 PDF の registry エントリ追加(`scripts/ai-summary/README.md` を参照)
- 編集者監修コスト計測(別 skill 候補、本 skill 範囲外)

## 設計思想

mattpocock/skills の `/diagnose`(再現 → 仮説 → 計測 → 修正 → 回帰)を W-1 ドメインに特化したもの。W-1 固有の性質:

- **LLM 経由のため非決定性が混じる**: gemma3:12b は同入力でもサンプリングで揺れる。seed / temperature 0 / num_ctx 固定で「ほぼ決定的」にできるが、完全決定的ではない
- **正規化のずれが false positive を生む**: NFKC 正規化前後で「答申」「答　申」「答  申」のように同一文字列でも grep miss する。grep ベースの fact-check は正規化境界が原因の差分を生む
- **boundary が誤ると下流全部ずれる**: extract.mjs の `sectionDetectionPatterns` 誤検出 → chunk-ranges 誤 → mapreduce が違うページを要約 → fact-check が当然 fail
- **回帰テストが「期待値ファイル」になる**: 出力テキストは LLM 揺れで完全一致しないため、observation-YYYY-MM-DD.md に救出率の数字を残し、それを baseline とする

このため Matt のオリジナルから次を変更している:

| Matt の元 phase | W-1 特化変更 |
|---|---|
| Feedback loop = テストコマンド 1 つ | Ollama + registry + 4 mjs の決定性確保まで含める |
| Reproduce = 1 度で再現できる失敗 | 「最低 3 回連続再現」を採用基準にする(LLM 揺れ吸収) |
| Instrument = console.log / debugger | Phase 4 中間ファイル(`tmp/ai-summary/<slug>/<section>/`)を全部保存する |
| Regression test = unit test | observation md ファイル + grep + diff(出力テキスト完全一致は使わない) |
| Cleanup = console.log 削除 | retry オプション / debug ログを `--debug` フラグ裏に残す(再発時の即時診断用) |

## Phase 1 — フィードバックループの確立

「同じ入力で同じ出力が出る」を最初に確保する。LLM が絡むと油断する箇所。

### 決定性チェックリスト

- [ ] `OLLAMA_BASE_URL` が固定(`http://localhost:11434` か GHA secret)
- [ ] `mapreduce.mjs` の `temperature` が 0.0-0.2(現状 0.2 固定、ADR 0040 §C-5)
- [ ] `num_ctx=32768` 固定(ADR 0040 §C-3)
- [ ] gemma3:12b の `ollama pull` 後の sha256 を `observation-*.md` に控えてある
- [ ] 入力 PDF を `pdfUrl` から再 fetch して sha256 一致を確認(キャッシュ汚染防止)
- [ ] NFKC 正規化を grep 直前で 1 回だけかけている(二重正規化を避ける)

### 再実行の単一コマンド

```bash
node scripts/ai-summary/run-pipeline.mjs --slug <slug> --section <section> --skip-extract
```

`--skip-extract` で extract 出力(中間 .txt)を固定し、mapreduce 以降だけ再実行する。これにより「mapreduce の揺れ」と「extract の境界ずれ」を切り分けられる。

### 期待: 同じコマンドを 3 回連続で実行し、3 回とも fact-check 結果が同じ missing fact リストになること

LLM 揺れで偶然救出される場合があるため、1 回成功 / 1 回失敗のような不安定パターンは「再現未確立」とみなす。

## Phase 2 — 再現する

「Phase 1 のループで失敗を 100% 再現できる」状態を作る。再現できない症状は仮説検証ができないため、Phase 1 に戻る。

### 観測項目 4 種(GHA / 編集者監修 連動)

W-1 では症状が次の 4 レイヤーに現れる。どこで失敗しているかを最初に切り分ける。

1. **workflow success**: GHA `ai-summary.yml` の Job 失敗(self-hosted runner の Ollama 接続 / pdf-parse のメモリ等、コード以外の原因が混じる)
2. **Issue 本文 registry entries**: PR 本文に `slug` / `section` / `pdfUrl` / `pdf sha256` が含まれているか(ADR 0050 §(5)PR テンプレ運用、トレーサビリティ確保)
3. **ADR 0040 §C-6 + ADR 0050 監修**: 編集者が原文 PDF と突合した結果のメモが PR コメントにあるか(完全幻覚は出力単体では検出不能、ADR 0040 §C-6)
4. **PR テンプレ link**: `.github/PULL_REQUEST_TEMPLATE/ai-summary.md` が正しく適用されているか(template が反映されていないと監修チェックリストが欠落)

このうち 1〜4 のどこで信号が落ちているかを `gh pr view <#>` / GHA log / 中間ファイル の 3 点で先に判定する。コード仮説に進むのはその後。

### 失敗判定の固定

`observation-YYYY-MM-DD.md` テンプレに以下を必ず書く(Phase 5 の回帰テストの baseline になる):

- 入力: `pdfUrl` + sha256 + page count
- 表面救出率(全 missing fact / 必須数値) と 真の救出率(strict: 数値 + 文脈一致)
- 失敗箇所の引用(missing fact の文字列 + 期待ページ + 実際の chunk-range)
- 試行回数(最低 3 回、ばらつきがあれば全試行の数値を残す)

## Phase 3 — 仮説を立てる

複数の仮説を並べる。1 個だけ立てて飛びつくと「修正したつもりで再発」が起きる。

W-1 で頻出する仮説スロット:

1. **境界ずれ**: `sectionDetectionPatterns` の正規表現が「別\\s*添\\s*資\\s*料\\s*[１1]」のように全角数字 / 半角 / 全角空白の組合せに失敗している
2. **chunk-range zero-base / one-base 取り違え**: pdf-parse は 1-base、chunk-ranges JSON は 0-base か 1-base か(現状の取り決めを README で再確認)
3. **page marker 欠落**: extract.mjs が「\f」(form feed)で分けるか「Page N」テキストで分けるか、PDF によってどちらかが落ちる
4. **NFKC false positive**: 必須数値 fact が `１,０００円` / `1,000円` / `1000円` のいずれかで grep miss する
5. **map 段階で数値脱落**: per-chunk raw retry(ADR 0046)が走っていないか、retry プロンプトに必須数値が含まれていない
6. **LLM 揺れ**: temperature 0.2 で偶発的に脱落(observation で 1/3 試行で再現する場合これを疑う)
7. **registry エントリの requiredFacts 自体が間違い**: 原文 PDF を読み直すと「9,400 億円」ではなく「9,400 万円」だった等

仮説ごとに「これが正しいなら Phase 4 で何を計測すれば真偽が分かるか」をペアで書く。検証可能でない仮説は外す。

## Phase 4 — 計測する(instrument)

Phase 3 の各仮説に対し、確実に真偽判定できる中間出力を残す。W-1 では `tmp/ai-summary/<slug>/<section>/` 配下に全段階の生データが出るので、これを保存 + grep する。

### 仮説別の計測ハンドル

| 仮説 | 計測対象ファイル | grep / 検査内容 |
|---|---|---|
| 境界ずれ | `tmp/ai-summary/<slug>/<section>/extract.json` | `sectionStart` / `sectionEnd` の page 番号、`detectedKeys` のリスト |
| chunk-range 取り違え | 同 `chunk-ranges.json` | chunk[0] の text 先頭 200 文字を PDF の 1 ページ目 vs 2 ページ目と目視比較 |
| page marker 欠落 | extract.json の `pageMarkers` フィールド | PDF ページ数と一致するか |
| NFKC false positive | `fact-check-debug.json`(`--debug` で出力) | missing fact の正規化前 / 後の両形を出して grep 再実行 |
| map 段階で数値脱落 | `mapreduce-map-output.json` | per-chunk summary に必須数値が含まれているかを grep |
| LLM 揺れ | observation 3 試行の missing fact diff | set 差分で揺れの幅を確認 |
| requiredFacts 自体の誤り | `required-facts/<slug>-<section>.json` を原文 PDF と再突合 | 編集者監修必須(ADR 0040 §C-6) |

### `--debug` モードの追加が必要なら Phase 4 で導入

現状 `fact-check-debug.json` は出力されない。仮説 4 / 5 を検証するために必要なら、`--debug` フラグで raw grep 入力 / retry プロンプト / retry 入力 raw を保存する追加 PR を立てる(Phase 6 で removable な形にする)。

## Phase 5 — 修正 + 回帰テスト

Phase 4 で真と分かった仮説だけを修正する。修正前に Phase 5 の回帰 baseline を確定する。

### 回帰テストの形

W-1 では unit test では救えない。次の二段で回帰を担保する:

1. **observation-YYYY-MM-DD.md の更新**: 修正後の表面救出率 / 真の救出率(strict)を `experiments/poc-pdf-summary/observation-*.md` パターンに準拠して残す。3 試行の数値を全部書く
2. **registry サイドカー: `required-facts/<slug>-<section>.json` を変更したなら git diff を PR に貼る**: required-facts 自体を変更した場合は ADR 0040 §C-6 の編集者監修必須

### 修正の境界

- `extract.mjs` の `sectionDetectionPatterns` 変更 → 当該 slug のすべての section が影響、全 section 再実行
- `mapreduce.mjs` のプロンプト変更 → 全 slug 影響、observation を全 slug で再採取(コスト高、慎重に)
- `fact-check-grep.mjs` の正規化変更 → 過去の observation の救出率が変わるため、ADR 0046 §採用判定 の数値再確認

### 採用判定との接続

ADR 0040 §C-7「Phase 2 採用判定固定」は obs-17 + obs-19 の 2 件で本体 ≥ 70% を満たして固定された。本 skill での修正がこの数値を下回らせる可能性があるなら、ADR 0040 / 0050 の改訂 PR を併走させる。

## Phase 6 — クリーンアップ

修正が安定したら計測コードを撤去するが、**完全には消さない**。

### 残すもの

- `--debug` フラグ裏の中間出力(再発時に即計測できる)
- observation md(履歴として価値)
- 仮説検証で書いた grep one-liner を README の「再現コマンド」セクションに昇格

### 消すもの

- `console.log` の dump
- 仮説検証で書いた捨てスクリプト(`tmp/` 配下にあるはず、`.gitignore` 対象)
- Phase 3 で外した仮説に対応するコメント(残すと将来のノイズになる)

### active.md / ADR への記録

- 本 skill を回した結果が ADR レベルの決定(C-7 数値 / 採用判定 / boundary schema 変更)に到達した場合は ADR 0040 / 0050 を改訂 PR で更新
- 単発の修正(typo / 正規表現 1 箇所)なら active.md の「実装ノート」に Deviation として 1 行残す(memory rule 15)

## 典型対象(2026-05-22 時点の未解決)

このセクションは未解決問題のテンプレ。解決したら observation に移し、解決過程は ADR に昇格。

1. **真の救出率(strict)未計測の slug**: `tsuuchi-r6-08-27` 以外の slug を registry に追加した場合、observation-YYYY-MM-DD.md に strict 計測を残すまで Phase 5 を閉じない
2. **extract.mjs page marker root cause**: ADR 0050 ADR §「撤回 / 再検討の条件」で言及されている境界ずれ系の根因がまだ単一仮説に絞れていない。Phase 3 仮説 1 / 3 を併走して計測する案件
3. **NFKC false positive**: 必須数値が「9,400 億円」と「９，４００億円」で grep miss する事象。Phase 4 の `--debug` モード追加が前提条件

## 連動する Memory rules

- rule 2(正確性の徹底): observation の数値は推測禁止、3 試行の生データを残す
- rule 3(エビデンス執筆の鉄則): 救出率の数値は一次研究(原文 PDF)で裏付け
- rule 13(PR は作成までで止め、マージはユーザー): GHA からの自動マージ禁止(ai-summary.yml も同じ)
- rule 17(マージ後の後処理): observation 採取後の branch 削除 + main pull は本 skill 実行後も必須
- rule 19(コンテンツ編集はプランモード既定): observation md 編集前に Plan Mode 推奨
- rule 22(セッション終了時の未 commit ファイルは WIP commit を提案): `tmp/ai-summary/<slug>/<section>/` は `.gitignore` だが、observation md は追跡対象

## 関連

- `docs/decisions/0040-ai-assisted-summary-with-editor-supervision.md` §C-6(編集者監修) / §C-7(採用判定固定)
- `docs/decisions/0046-promote-raw-chunk-retry-to-phase-2.md`(retry 入力 raw 化)
- `docs/decisions/0050-w1-ai-summary-mvp.md`(registry + 4 mjs 構成、境界スキーマ)
- `scripts/ai-summary/README.md`(運用手順)
- `experiments/poc-pdf-summary/observation-2026-05-17.md`(本体 100% / 概要版 100%)
- `experiments/poc-pdf-summary/observation-2026-05-19.md`(通知本文 87.5% / 別添 100% / 別添 100%、obs-17 と通算で採用判定固定)
- mattpocock/skills の `/diagnose`(本 skill の元、構造を借用)
