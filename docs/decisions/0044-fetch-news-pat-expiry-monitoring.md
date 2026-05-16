# 0044. fetch-news の PAT 失効を週次 cron で事前検知(silent fail 構造への防御)

- 状態: 採用
- 日付: 2026-05-16
- 関連 ADR: 0009(fetch-news ワークフロー PR フロー化)/ 0042(fetch-news token 切替)
- 関連 PR: TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

2026-05-15 12:16 UTC 〜 2026-05-16 13:16 UTC の間、fetch-news が 3 連続失敗した:

| 時刻 (UTC) | run id | エラー |
|---|---|---|
| 2026-05-15 12:16 | 25917282212 | `Input required and not supplied: token` |
| 2026-05-15 22:49 | 25945103106 | 同上 |
| 2026-05-16 11:30 | 25960812797 | 同上 |

`gh api /repos/Hayato-Isagawa/edu-watch/actions/secrets` の `total_count: 0` から **`AUTO_COLLECT_PAT` シークレット消失** を特定。原因は紐付け PAT の失効と推定される(fine-grained PAT 失効時、シークレット値が実質的に無効化される挙動)。手動 trigger による復旧は別途実施し、5/15 + 5/16 早朝分の取りこぼしは PR #147 で一括回収済。

### silent fail 構造

GitHub Actions のスケジュールジョブ失敗は、

- GitHub からの通知メール: workflow ファイルを編集した最終 committer 宛に届くがチーム全員には届かない
- リポジトリ通知設定の workflow failure: 個別有効化が必要
- Slack / 他チャネルへの自動通知: 別途連携が必要

の構成であり、本リポジトリ運用では失敗通知が編集者の手元に届かないことが多い。本件も 1.5 日(3 cron 実行分)気付かなかった。これより長期(数日〜数週間)の失効を想定すると、ニュース取りこぼしと週次 digest 品質低下が拡大する。

### 業務上の影響

- fetch-news 自体: 1.5 日(3 cron 実行分)のニュース収集停止。本件は手動 trigger で 5/15 + 5/16 早朝分を一括回収(PR #147)し空白を回避
- PAT 失効を 1 週間以上見落とした場合: digest 対象記事が大幅欠落し、digest 品質が劣化

## 検討した選択肢

### A. PAT expiry monitoring cron(採用)

週次 cron で `gh api -i /user` のレスポンスヘッダー `github-authentication-token-expiration` を取得し、残日数が 14 日以下になったタイミングで Issue 起票する。

利点:

- 既存 PAT 構造を維持しつつ silent fail 構造に 1 層の防御を追加
- 実装量が少ない(1 ワークフローのみ)
- `AUTO_COLLECT_PAT` 自身を使った自己参照のため追加シークレット不要

欠点:

- PAT を使う構造自体は残り、人手での更新作業が継続
- 警告メッセージの到達は GitHub Issue 通知に依存(通知未設定だと届かない)

### B. GitHub App 認証への切替

GitHub App を作成し installation token(自動更新で 1 時間 expiry)で認証することで、PAT 失効の問題自体を消す。

利点:

- expiry 問題が構造的に解消
- Bot identity が明示される

欠点:

- 実装量が多い(GitHub App 作成 + workflow 全面書き換え + `APP_PRIVATE_KEY` 管理)
- 失効問題は消えるが `APP_PRIVATE_KEY` 漏洩時の影響が大きい

### C. 現状維持

却下: silent fail 構造が継続し、再発リスクが残る。

## 決定

**A(PAT expiry monitoring cron)** を採用する。

`.github/workflows/pat-expiry-check.yml` を新規作成し、以下を行う:

- cron: `0 0 * * 0`(毎週日曜 UTC 00:00 = 月曜 JST 09:00)
- ステップ 1: `gh api -i /user` のレスポンスヘッダー `github-authentication-token-expiration` を取得
- ステップ 2: 残日数を計算
- ステップ 3: 残日数 14 日以下、かつ既存の open `pat-expiry` Issue が無ければ Issue 起票

label `pat-expiry` を冪等作成、Issue 重複起票は label + 既存 open 件数チェックで抑止する。

### 採用理由

- silent fail 構造への防御として最小実装で必要十分
- GitHub App 切替は将来検討の余地があるが、本件再発防止には過剰
- 警告タイミング 14 日は PAT 再発行 + シークレット再登録の作業時間(数分〜30 分)に対して十分なリードタイム

### 警告タイミング 14 日の根拠

- PAT 再発行: GitHub Settings 上で数分
- シークレット再登録: `gh secret set` で 1 分
- 再発行〜登録までの作業着手猶予: 数日(休日・多忙時を考慮)
- 14 日あれば、2 回の週次警告で必ず気付ける

## 帰結

### 良い帰結

- PAT 失効による silent fail を週次で検知できる
- 既存構造への追加実装のみで影響範囲が狭い
- 本対策ワークフロー自身が PAT を使うため、PAT が完全失効すれば本ワークフローも失敗する(meta な失敗が次に届く)

### トレードオフ

- PAT 自体は残るため、根本解(GitHub App)に比べて防御層を 1 つ増やすに留まる
- Issue 通知が編集者に届かない場合、警告も silent fail する余地がある(本対策は通知設定整備とセットで運用)
- `github-authentication-token-expiration` ヘッダーは fine-grained PAT 前提で、classic PAT(無期限)の場合は警告が出ない設計。本リポジトリは fine-grained 運用前提

## 撤回 / 再検討の条件

- 本対策後も PAT 失効による fetch-news 連続失敗が再発した場合 → 通知設定の整備 + B(GitHub App 切替)を再検討
- PAT 自身の管理コストが許容範囲を超えた場合 → B への移行
- GitHub が PAT 失効を取得する公式 API を提供開始した場合 → 自己参照ヘッダーから公式 API への切替
