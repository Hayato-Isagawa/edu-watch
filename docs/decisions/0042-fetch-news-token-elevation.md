# 0042. fetch-news の token を Fine-grained PAT に切り替えて auto-collect PR の required CI を発火させる

- 状態: 採用
- 日付: 2026-05-14
- 関連 ADR: 0041(Dependabot auto-merge policy、required check 設定の前提)/ 0009(cron schedule)/ 0020(persistent denylist、required check 対象)
- 関連 PR: #138(本 ADR 採用判断のトリガーとなった 14h+ BLOCKED の auto-collect PR、2026-05-14 admin マージで解消)/ TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

ADR 0041 で main ブランチ保護を導入し、required status checks に `Playwright E2E`(`e2e.yml`)と `Persistent denylist consistency`(`health-check.yml`)を登録した。Dependabot PR は GitHub の特別扱いで `GITHUB_TOKEN` 経由でも上記 2 つの check が発火し、ADR 0041 の保護下で正常に auto-merge ゲートを通る。

一方、`fetch-news.yml` は cron(JST 07:00 / 18:00)で起動し、`secrets.GITHUB_TOKEN` で `git push` → `gh pr create` する経路。これは GitHub の recursive 防止仕様により、`GITHUB_TOKEN` で作成された push / PR からは `pull_request` 由来 workflow がトリガーされない([Triggering a workflow from a workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow))。Dependabot は本仕様の例外として特別扱いされているが、一般的な workflow からの派生 PR は対象外。

結果として auto-collect PR は Cloudflare Pages の check のみ発火し、required 2 check が永久に到達せず BLOCKED 化する。実例:

- PR #138(`chore(data): auto-collect articles 20260513-2255`、2026-05-13 22:55 UTC 作成)が 14h+ BLOCKED
- ブランチで起動した workflow run = 0 件
- `mergeable=MERGEABLE` / `mergeStateStatus=BLOCKED` / `autoMerge=設定済(SQUASH)` のまま停止
- 2026-05-14 admin マージで解消(`gh pr merge 138 --squash --admin`)

ADR 0041 採用前は required check 制約がなかったため、過去 PR #126 / #127 / #131 / #133 / #137 も同様に run 0 件・Cloudflare Pages のみで成功マージされていた。ADR 0041 で保護を導入した瞬間に本問題が顕在化した形。

## 検討した選択肢

### A. required check から fetch-news 由来 PR を除外する path-based 例外(却下)

GitHub Branch Protection には path-based の required check 除外がなく、ブランチに対する全 PR に同じ required check が適用される。仮に CODEOWNERS や別の仕組みで実現できても、ADR 0041 の保護目的(依存更新で内部スキーマ破壊検知)は auto-collect でも同様に必要。特に `Persistent denylist consistency`(ADR 0020)は新着記事追加時にも担保したい gate であり、除外する合理性がない。

### B. ADR 0041 の required check を全て解除する(却下)

Dependabot PR と auto-collect PR で同じ問題を一度に解消するが、ADR 0041 が達成した保護(patch / minor 依存更新でテスト破壊コミットが main に直接届かなくする gate)を完全に失う。ADR 0041 の動機と矛盾するため却下。

### C. admin マージで毎回手動解消(却下)

毎日 2 回(JST 07:00 / 18:00)の cron で auto-collect PR が生成されるため、運用負担が大きい。ADR 0041 採用の主目的が「毎週 5〜10 件の patch / minor PR の手動マージ作業の削減」であった点と矛盾する。

### D. Fine-grained PAT で push(採用)

リポジトリ secrets に `AUTO_COLLECT_PAT` として Fine-grained PAT を登録し、`fetch-news.yml` の `actions/checkout` の `token` と `gh` コマンドの `GH_TOKEN` を差し替える。PAT 経由で push されたブランチは GitHub の actor が `GITHUB_TOKEN` ではなくなり、recursive 防止の対象外となるため、`pull_request` workflow(`e2e.yml` / `health-check.yml`)が発火する。

実装差分は最小(`fetch-news.yml` の 2 箇所のみ)。期限管理は Fine-grained PAT の最大 1 年期限を採用し、月次の Dependabot レビュー時に併せて確認する運用とする。

### E. GitHub App + installation token(却下、将来候補)

`tibdex/github-app-token@v2` 等で App installation token を払い出す。期限切れリスクが低く(installation token は 1 時間で自動更新)、複数開発者体制でも個人紐付けが発生しない利点はあるが、初期セットアップ(App 作成、private key 管理、permissions 設計、workflow secret 登録)が重い。本サイトは 1 人開発の個人サイトであり、Fine-grained PAT で十分。将来 App 化が必要になれば再評価する。

## 決定

D を採用。

### 前提条件(マージ前にユーザーが手作業で設定)

1. **Fine-grained PAT 作成**: GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token
   - Resource owner: `Hayato-Isagawa`
   - Repository access: `Only select repositories` → `Hayato-Isagawa/edu-watch`
   - Permissions(Repository permissions):
     - `Contents`: Read and write(branch push に必要)
     - `Pull requests`: Read and write(`gh pr create` / `gh pr merge --auto` に必要)
     - `Issues`: Read and write(`gh label create` に必要)
     - `Workflows`: Read and write(workflow ファイル変更を含む push がある場合に必要 — 通常の auto-collect ではデータ JSON 追加のみなので Read only でも動くが、将来のメンテ運用余地として write を付与)
   - 期限: 1 年(2027-05-14)
2. **secrets 登録**: Settings > Secrets and variables > Actions > New repository secret
   - Name: `AUTO_COLLECT_PAT`
   - Value: 上記 PAT
3. 上記 2 つが完了した時点で本 ADR PR をマージ可能

### workflow 改修(本 ADR PR で実装)

`.github/workflows/fetch-news.yml` の 2 箇所を差し替える:

1. `actions/checkout@v6` の `token` を `${{ secrets.AUTO_COLLECT_PAT }}` に
2. 「Commit, push branch, and open auto-merge PR」step の `GH_TOKEN` を `${{ secrets.AUTO_COLLECT_PAT }}` に

これにより、PAT 経由で push されたブランチへの `pull_request` workflow が `e2e.yml` と `health-check.yml` をトリガーし、required 2 check が発火する。

## 影響と運用

### 効果

- auto-collect PR でも required 2 check(`Playwright E2E` + `Persistent denylist consistency`)が発火し、ADR 0041 の auto-merge ゲートに乗る
- 依存更新と新着記事追加で同じ保護(テスト破壊検知 + denylist 整合性)が担保される
- admin マージによる手動運用が不要になる

### 監視 / リスク観測項目

- **PAT 期限切れ**: 2027-05-14 に再発行が必要。月次運用レビュー(`git log --grep=Dependabot --since="last month"`、ADR 0041 §「監視 / リスク観測項目」)時に Settings > Personal access tokens の残期間を併せて確認する。期限切れ 1 ヶ月前にローテーション
- **PAT 漏洩リスク**: Fine-grained PAT で repo 限定 + permission 最小化により、漏洩時の爆発半径を本リポジトリの上記権限内に限定
- **Actions minutes 消費**: auto-collect PR ごとに `e2e.yml`(~3 分)+ `health-check.yml`(~1 分)が追加で走るため、月間 ~240 分(日 2 回 × 30 日 × 4 分)程度の増加。public repo は無料 tier 無制限なので問題なし
- **PAT actor 認識**: PAT 経由で作成された PR の `github.actor` は PAT 所有者(`Hayato-Isagawa`)になる。`dependabot-auto-merge.yml` の `if: github.actor == 'dependabot[bot]'` 条件には引っかからないため、auto-collect PR の auto-merge は `fetch-news.yml` 内の `gh pr merge --auto` で別途設定する(現状の実装維持)

### 副次効果(注意)

- PAT は個人アカウントに紐付くため、`Hayato-Isagawa` 個人の退役・アカウント変更時に切替作業が発生。複数人体制になった場合は GitHub App 化(選択肢 E)に再切替を検討
- `fetch-news.yml` 内の `git config user.name "edu-watch-bot"` / `user.email "notify@edu-evidence.org"` は変更しない(コミット作者表記は維持)

## 撤回 / 再検討の条件

- PAT 期限切れ運用が破綻した場合(自動 PR が止まる事故が複数回発生)→ GitHub App 化に再切替
- Fine-grained PAT の権限モデルが GitHub 側で変更された場合
- 複数開発者体制になり PAT 個人紐付けが運用上の制約になった場合
- auto-collect 経路の架構変更で、別の発火経路(reusable workflow / `repository_dispatch` 等)に置換した場合
- ADR 0041 の required check 構成が変わり、本問題が自然解消した場合

## 参考

- ADR 0041(Dependabot auto-merge policy、required check 設定の前提)
- ADR 0009(cron schedule、本 workflow のスケジュール根拠)
- ADR 0020(persistent denylist、required check `Persistent denylist consistency` の出自)
- [GitHub Docs — Triggering a workflow from a workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow)(recursive 防止仕様の根拠)
- `.github/workflows/fetch-news.yml`(本 ADR で改修)
- PR #138 / merge commit `6fe5ba4`(本 ADR 採用判断のトリガーとなった 14h+ BLOCKED の auto-collect PR、2026-05-14 admin マージで解消)
