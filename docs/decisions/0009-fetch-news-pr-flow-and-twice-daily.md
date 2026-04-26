# 0009. fetch-news ワークフローを PR フロー化、cron を日次 2 回へ削減

- 状態: 採用(0003 §6.1 と PR #18 / #19 の運用方針を上書き)
- 日付: 2026-04-26
- 関連 PR: #18(初版実装)、#19(短期回避策、本 ADR で撤回)、TBD(本 ADR の実装)

## 背景

PR #18 で Sprint 2 のパイプラインを完成させ、設計書 §6.1 通りに「日次 3 回 cron + ボットが main に直接 commit + push」する `.github/workflows/fetch-news.yml` を投入した。初回手動実行で 2 段階の障害が発生し、設計の前提が崩れていることが判明した。

### 段階 1: ローカル `pre-commit` hook によるブロック

`.githooks/pre-commit`(別 PR で導入された人間の main 直接コミット防止 hook)が、CI ランナー上のボットの `git commit` も弾いた。PR #19 で `GITHUB_ACTIONS=true` + ボットの `user.email` を allowlist 化する短期回避策を入れて通した。

### 段階 2: GitHub Repository Rules によるブロック

サーバー側の Repository Rules で `Changes must be made through a pull request` ルールが有効化されていたため、ボットの `git push origin main` が `GH013` で拒否された。

調査の結果、bypass list で `github-actions[bot]` を指定することは GitHub の仕様上不可能(compromise された workflow からの bypass を防ぐ意図的制約)。残る現実的選択肢は `Repository admin role` を bypass にする一択で、これは「**人間の admin も main 直接 push できる**」という重大な副作用を伴う。

### 業界事例の確認

- 2024 年の axios マルウェア事件で、自動更新ツールの直接 commit 設定リポジトリが瞬時に汚染、PR フロー設定リポジトリは検知できた
- Simon Willison 提唱の Git Scraping パターンは直接 commit を採用するが、「データソースが信頼できる」という暗黙前提に依存
- GitHub 公式ドキュメントは「bypass を最小化、PR 経由を推奨」を一貫して打ち出している

### cron 頻度の再検討

設計書 §6.1 で「日次 3 回」を確定したのは Tier 2 が大手紙(朝日 EduA / 毎日 / 読売 / 共同)の HTML スクレイピング想定だった時代の決定。ADR 0007 で Tier 2 が教育専門紙 + 共同通信 RSS に転換されたあと、各ソースの実測更新頻度を踏まえて再検討すると、合計 30〜45 本/日の発信ペースに対して 3 回 cron は過剰で、PR フロー化で発生する PR 件数も合わせると年 1095 PR と肥大化する。

## 検討した選択肢

### 直 push を維持する案

- **A1**: bypass list に `Repository admin role` を追加し、設計書通り main 直 push を続ける
  - 副作用: 人間の admin も main 直接 push 可能になる、運用文化の劣化リスク
- **A2**: bypass list に `Deploy keys` を追加し、ボット専用 deploy key で push
  - コミッター ID が失われやすい、Deploy key の管理が別途必要

### PR フロー化する案

- **B1**: ボットが feature ブランチに commit → PR 作成 → `gh pr merge --auto --squash --delete-branch`
- **B2**: 設計書通り日次 3 回(年 1095 PR)
- **B3**: 日次 2 回 JST 07:00 / 18:00(年 730 PR)
- **B4**: 日次 1 回 JST 07:00(年 365 PR)

### スコープ外置きする案

- **C1**: 記事データを別リポジトリ / Cloudflare KV / D1 に保存して main を汚さない
  - 設計書 §7.1 のリポジトリ内 JSON 方針からの大規模転換、Phase 2 の前倒し

## 決定

**B1(PR フロー化)+ B3(日次 2 回 JST 07:00 / 18:00)** を採用する。

### PR フロー化の詳細

`.github/workflows/fetch-news.yml` を以下の流れに変更:

1. ボットが `chore/auto-collect-<YYYYMMDD-HHMM>` の feature ブランチに commit
2. ブランチを push
3. `gh pr create --label auto-collect ... --base main --head $branch` で PR 作成
4. `gh pr merge --auto --squash --delete-branch` で auto-merge を有効化
5. 必須チェック(現状なし、Cloudflare Pages のプレビュービルドのみ)が通り次第、GitHub が自動 squash マージ

`permissions:` ブロックを `contents: write, pull-requests: write` に拡張する。

### cron を日次 2 回に削減

| 時刻 | 想定読者シーン | UTC 換算 |
|---|---|---|
| JST 07:00 | 朝刊感覚、出勤前・通学準備 | UTC 22:00(前日) |
| JST 18:00 | 夕刊感覚、退勤後・帰宅後 | UTC 09:00 |

cron 式: `0 22,9 * * *`。

行政発表は午前〜午後に集中するため、夕方 cron で同日中に拾えるという読者価値が大きい。日次 1 回(B4)も検討したが、夕方発表のニュースが翌朝まで載らない遅延が教員の週明け会議準備等に影響しうるため不採用。

### `pre-commit` hook の allowlist 撤回(PR #19 撤回)

PR フロー化により、ボットは feature ブランチに commit するため main 直接 commit の例外は不要になる。`.githooks/pre-commit` を PR #19 マージ前の状態(allowlist なし)に戻す。

### Cloudflare Email Routing と `takedown@`

ADR 0008 で予定していた `takedown@edu-evidence.org` のエイリアス追加(Sprint 3 の `/about` ページ実装と同時)は本 ADR の影響を受けない。`notify@edu-evidence.org`(コミットボット用)も既存通り維持する。

## 帰結

### 良い帰結

- bypass list に何も追加しない運用にできる(人間の main 直接 push は完全ブロックを維持)
- 各 commit が PR 単位で audit trail として残る、不正なデータ混入時に PR 番号で特定・revert できる
- 日次 2 回への削減で、年間 PR 件数が 1095 → 730 に減少、ソース側への礼儀的にも良い
- 朝刊・夕刊の読者リズムに合致した自然な更新頻度
- Renovate / Dependabot 系で実証された PR フロー型自動化のベストプラクティスに合流

### トレードオフ

- 速報性が日次 3 回時代より低下(最大遅延 8 時間 → 13 時間)
- PR タイムラインが auto-collect ラベル付きの自動 PR で埋まる(GitHub UI のフィルタで人間 PR と分離する運用が必要)
- workflow が `git commit + push + gh pr create + gh pr merge --auto` の 4 ステップになり、初版より複雑化
- `Allow auto-merge` を Repository 設定で有効化する初回手動操作が必要

## 撤回 / 再検討の条件

- PR 件数による通知の煩雑さが運用負荷として顕在化した場合(日次 1 回への削減 or 通知設定の調整)
- 速報性の不足が読者から指摘される場合(日次 3 回への戻し or 緊急発表用の臨時 cron 追加)
- データ量が設計書 §7.2 の Phase 2 移行閾値(累積 10,000 記事 or 1 年分)に達した場合(Cloudflare D1 / KV へ移行、その時点で本 ADR の影響範囲を再評価)
- GitHub が `github-actions[bot]` を bypass actor として登録可能にした場合(直 push 復活の可能性)
