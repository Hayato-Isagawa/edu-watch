# 0033. ダイジェスト markdown に textlint 日本語校正を導入する(姉妹サイト構成のミラー)

- 状態: 採用
- 日付: 2026-05-04
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0017(週次ダイジェストに事実検証サブエージェント digest-fact-checker を導入する)
- 姉妹サイト構成: edu-evidence(`.textlintrc.json` + `prh.yml` + textlint 4 ルール)を memory rule 7 でミラー

## 背景

edu-watch のコンテンツのうち、**週次ダイジェスト(`src/content/digests/*.md`)は編集者が論点整理を加える editorial 日本語**(PRD §6)。日次記事は外部記事のメタデータ(JSON、タイトル原文ママ)で対象外だが、ダイジェストは長文・敬体ですます調・強調表現を多用し、日本語校正の効果が大きい。

姉妹サイト edu-evidence ではコラム / 戦略 markdown に textlint(preset-ja-technical-writing + preset-ja-spacing + no-mix-dearu-desumasu + prh)を導入済で、`.textlintrc.json` と表記辞書 `prh.yml` を整備している。両サイトの editorial コンテンツの校正観点を揃えることで、姉妹サイト全体の言語一貫性を保ちやすい。

これまで edu-watch では textlint 未導入で、digest-fact-checker(ADR 0017)による事実検証はあるが、日本語校正(文長 / 表記揺れ / 重複表現等)は人手のみだった。

## 検討した選択肢

### A) 姉妹サイトと完全同一の textlint 構成を取り込む(採用)

- 利点:
  - `.textlintrc.json` / `prh.yml` を edu-evidence からそのまま転用でき、両サイトの editorial 観点が揃う
  - prh.yml に既に「メタ分析」「ランダム化比較試験」「効果量」等の研究系語彙が整備されており、ダイジェスト本文中の表記揺れにも有効
  - 将来 prh.yml を共通化(npm package 化)する選択肢を残せる
- 欠点:
  - 教育ニュース固有の語彙(例: 「文部科学省」/「文科省」など)は本辞書には未収録。必要に応じて後続 PR で edu-watch 固有語彙を追加していく

### B) edu-watch 固有の構成を新規設計する

- 利点: 教育ニュース文脈に最適化できる
- 欠点: 姉妹サイト整合(memory rule 7)から外れる。両サイトの editorial 表現が乖離するリスク

### C) textlint を導入しない

- 欠点: ダイジェストの日本語品質が編集者の人手依存となり、表記揺れや文長の管理が継続的にコストになる

## 決定

**選択肢 A** を採用。`.textlintrc.json` と `prh.yml` を edu-evidence からそのままコピーする(完全同一)。対象パスは `src/content/digests/**/*.md` に絞り、日次記事 JSON や source / config 系 markdown は対象外とする。

### 変更内容

- `.textlintrc.json` 新規(57 行、edu-evidence と完全同一)
- `prh.yml` 新規(37 行、edu-evidence と完全同一の表記辞書)
- `package.json`:
  - `devDependencies` に `textlint` + 4 ルール追加(`textlint-rule-no-mix-dearu-desumasu` / `textlint-rule-preset-ja-spacing` / `textlint-rule-preset-ja-technical-writing` / `textlint-rule-prh`)
  - `scripts` に `check:text` / `check:text:fix` / `check:all` を追加(対象は `src/content/digests/**/*.md` に限定)
- `check:all` は本サイトで未整備だったため新規で `check + check:text + check:filter + check:excluded-ids` を統合(本 ADR で定義)

### 既存ダイジェストへの適用結果

本 PR 採択時点で 2026-04-25 / 2026-05-02 の 2 本がリポジトリに存在。本 ADR 採択前提で `npm run check:text` を実行した結果、**違反 0 件**(`--fix` でも差分なし)。既存編集が textlint 規約をクリアしている状態を確認した。

## 帰結

- ダイジェスト執筆時に `npm run check:text` で機械的な日本語校正が走る
- 表記揺れ管理が `prh.yml` に集約され、追加ルールはここに追記すれば両サイトに同期しやすい
- `npm run check:all` で astro check + textlint + フィルタ整合 + denylist 整合を 1 コマンドで通せる(姉妹サイトの `check:all` パターン整合)

## スコープ外

- 教育ニュース固有語彙の `prh.yml` への追加(後続 PR で必要に応じて)
- 日次記事 JSON への校正(タイトル原文ママの編集ポリシー上、対象外)
- pre-commit hook での textlint 自動実行(現状は手動 + CI 任せ)

## 撤回 / 再検討の条件

- 教育ニュース文脈に対して preset-ja-technical-writing が過剰に厳しいと判明した場合、`.textlintrc.json` のルール調整(`max-ten` / `sentence-length` の緩和等)を検討
- prh.yml の語彙差分が 30 件以上に成長したら、両サイト共通辞書として npm package 化を検討

## 関連参照

- ADR 0017(digest-fact-checker による事実検証、本 ADR は日本語校正で並列に補完)
- edu-evidence の `.textlintrc.json` / `prh.yml`(本 ADR の取り込み元)
- memory rule 7(edu-watch の UI/UX は edu-evidence に揃える)
