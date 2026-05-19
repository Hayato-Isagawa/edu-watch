# 0049. recheck-nikkyo-membership の token を Fine-grained PAT に切り替えて再判定 PR の required CI を発火させる

- 状態: 採用
- 日付: 2026-05-19
- 関連 ADR: 0041(Dependabot auto-merge policy、required check 設定の前提)/ 0042(fetch-news token elevation、本 ADR のミラー元)/ 0022(recheck-nikkyo-membership、本 workflow の出自)/ 0044(AUTO_COLLECT_PAT 期限監視)
- 関連 PR: #167(本 ADR 採用判断のトリガーとなった BLOCKED PR、応急処置で 2026-05-19 merged)/ TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

ADR 0042 で `fetch-news.yml` の token を `secrets.GITHUB_TOKEN` から Fine-grained PAT(`secrets.AUTO_COLLECT_PAT`)に昇格し、auto-collect PR で required 2 check(`Playwright E2E` + `Persistent denylist consistency`)が発火するようにした。

しかし ADR 0022 由来の `recheck-nikkyo-membership.yml`(週次 `0 21 * * 1` = JST 火曜 06:00、過去 30 日の nikkyo 記事の paywall 後付け化を `requiresMembership: false → true` に片方向更新)は同種の問題を抱えながら未対応で残っていた。本 workflow も `secrets.GITHUB_TOKEN` で `git push` → `gh pr create` する経路のため、GitHub の recursive 防止仕様により `pull_request` 由来 workflow が発火せず、ADR 0041 採用後は required check が永久未到達で BLOCKED 化する。

2026-05-19 に表面化した実例:

- PR #167(`chore(data): recheck nikkyo membership 20260518-2204`、2026-05-18 22:04 UTC 生成)が BLOCKED で停止
- `app/github-actions` 由来 PR で workflow run = 0 件
- `mergeable=MERGEABLE` / `mergeStateStatus=BLOCKED` / `autoMerge=設定済(SQUASH)` の状態
- 応急処置: ローカルから空コミット(`e9e2630`)を push し `synchronize` event を発火、required workflow が triggered → check 完了 → auto-merge 通過(squash merge `3f839d1`、2026-05-19T06:35:30Z)

本 ADR は ADR 0042 の決定を本 workflow に厳密にミラーし、同種の事故が次の週次再判定(2026-05-26 火曜 06:00 JST、UTC では 2026-05-25 21:00)で再発しないよう恒久対応する。

## 検討した選択肢

### A. required check から recheck-nikkyo 由来 PR を除外する path-based 例外(却下)

GitHub Branch Protection には path-based の required check 除外がない。仮に CODEOWNERS 等で実現できても、ADR 0041 の保護目的(依存更新や bot 更新で内部スキーマ破壊検知)は recheck-nikkyo でも同様に必要(特に `Persistent denylist consistency` は記事メタデータ更新時にも担保したい gate)。ADR 0042 §A と同じ理由で却下。

### B. ADR 0041 の required check を全て解除する(却下)

ADR 0042 §B と同じ理由で却下。auto-collect / recheck-nikkyo の双方を救うために本来の保護を全て失う取引は釣り合わない。

### C. admin マージで毎回手動解消(却下)

recheck-nikkyo は週次なので運用負担は fetch-news の 1/14 程度。しかし「週末発生 → 月曜まで放置」のリスクと、ADR 0041 の主目的(手動マージ作業の削減)と矛盾する点は同じ。`gh pr merge --admin` を毎週叩く運用は ADR 採用前の状態に後退するため却下。

### D. 既存 `AUTO_COLLECT_PAT` を本 workflow にも適用(採用)

ADR 0042 で登録済の Fine-grained PAT(`AUTO_COLLECT_PAT`、permission = Contents write / Pull requests write / Issues write / Workflows write、有効期限 2027-05-14、ADR 0044 で期限監視済)を本 workflow にも流用する。新規 secret 登録は不要。

`recheck-nikkyo-membership.yml` の改修内容は ADR 0042 §D とほぼ同じ 2 箇所(`actions/checkout` の `token` / step env の `GH_TOKEN`)に、`fetch-news.yml` の現実装に既に含まれる `gh pr merge --auto` の 5 秒間隔 3 回リトライ(2026-05-11 22:44 UTC run #25701724642 で表面化した unstable status 過渡期エラー対策)の移植を加える 3 点に絞る。

### E. GitHub App + installation token(却下、将来候補)

ADR 0042 §E と同じ理由で却下。fetch-news が PAT で運用継続している間は本 workflow も同じ方針で揃える方が、運用面の認知負荷が低い。

## 決定

D を採用。

### 前提条件

`AUTO_COLLECT_PAT` secret は ADR 0042 採用時にユーザーが登録済(updatedAt 2026-05-16T13:15:44Z、確認済)。本 ADR PR では追加の secrets 登録は不要、マージするだけで有効化される。

### workflow 改修(本 ADR PR で実装)

`.github/workflows/recheck-nikkyo-membership.yml` の 3 箇所を改修:

1. `actions/checkout@v6` の `with:` に `token: ${{ secrets.AUTO_COLLECT_PAT }}` を追加(`persist-credentials: true` と並ぶ)
2. 「Commit, push branch, and open auto-merge PR」step の `env.GH_TOKEN` を `${{ secrets.GITHUB_TOKEN }}` → `${{ secrets.AUTO_COLLECT_PAT }}` に差し替え
3. 末尾の `gh pr merge --auto --squash --delete-branch "$branch"` を 5 秒間隔 3 回リトライループに置換(`fetch-news.yml` L66-81 と等価、コメント文言は本 workflow 名でローカライズ)

## 影響と運用

### 効果

- 週次 paywall 再判定 PR でも required 2 check(`Playwright E2E` + `Persistent denylist consistency`)が発火し、ADR 0041 の auto-merge ゲートに乗る
- bot 由来データ更新(auto-collect / recheck-nikkyo)で同じ保護(テスト破壊検知 + denylist 整合性)が担保される
- 応急処置(空コミット push)が不要になり、ユーザーの手動介入から再判定経路が独立する

### 監視 / リスク観測項目

- **PAT 期限切れ**: 2027-05-14。ADR 0044 の月次運用レビューで併せて確認、期限切れ 1 ヶ月前にローテーション(fetch-news / recheck-nikkyo 双方が同 PAT に依存するため、漏れると 2 経路同時停止)
- **Actions minutes 消費**: 週次 1 回 × `e2e.yml`(~3 分)+ `health-check.yml`(~1 分)= 月 ~16 分の増加。public repo は無料 tier 無制限なので無視可
- **PAT actor 認識**: PR の `github.actor` が `Hayato-Isagawa`(PAT 所有者)になる。`dependabot-auto-merge.yml` の `if: github.actor == 'dependabot[bot]'` 条件には引っかからないため、本 workflow 内の `gh pr merge --auto` で別途設定する(現状実装維持)
- **next 観測**: 2026-05-26 火曜 06:00 JST の週次再判定で本改修が発火し、required check が triggered → auto-merge 通過する経路を確認

### 副次効果(注意)

- ADR 0042 と同じく PAT は個人(`Hayato-Isagawa`)に紐付くため、退役・アカウント変更時に切替作業が発生
- `recheck-nikkyo-membership.yml` 内の `git config user.name "edu-watch-bot"` / `user.email "notify@edu-evidence.org"` は変更しない(コミット作者表記維持)

## 撤回 / 再検討の条件

- PAT 期限切れ運用が破綻した場合(ADR 0042 と同条件 — 双方の workflow を同時に GitHub App 化に再切替)
- Fine-grained PAT の権限モデルが GitHub 側で変更された場合
- 複数開発者体制になり PAT 個人紐付けが運用上の制約になった場合
- ADR 0022(recheck-nikkyo-membership)自体が撤回された場合(paywall 判別の基盤変更で本 workflow が不要化)
- ADR 0041 の required check 構成が変わり、本問題が自然解消した場合

## 参考

- ADR 0042(fetch-news token elevation、本 ADR のミラー元)
- ADR 0041(Dependabot auto-merge policy、required check 設定の前提)
- ADR 0022(recheck-nikkyo-membership、本 workflow の出自)
- ADR 0044(AUTO_COLLECT_PAT 期限監視)
- [GitHub Docs — Triggering a workflow from a workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow)(recursive 防止仕様の根拠)
- `.github/workflows/recheck-nikkyo-membership.yml`(本 ADR で改修)
- `.github/workflows/fetch-news.yml`(本 ADR のミラー元、ADR 0042 改修済)
- PR #167 / merge commit `3f839d1`(本 ADR 採用判断のトリガー、応急処置で 2026-05-19 merged)
