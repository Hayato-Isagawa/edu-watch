# 0041. Dependabot patch/minor 自動マージ運用と main ブランチ保護

- 状態: 採用
- 日付: 2026-05-14
- 関連 ADR: 0006(vite major pin の運用、本 ADR の major 手動レビュー方針と整合)
- 関連 PR: #136(`dependabot-auto-merge.yml` 導入、2026-05-13 マージ)/ TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

EduWatch JP は 1 人開発で、`.github/dependabot.yml` により毎週月曜 09:00 JST に Dependabot が PR を生成する。依存数は edu-evidence より多く(RSS 取得・ニュース解析の Node 依存が追加されている)、毎週の patch / minor PR が手動マージ対象になっていた。

CI は 2 種類が PR トリガーで走る:

- `e2e.yml` — Playwright E2E(ビルド + テスト、job 名 `Playwright E2E`)
- `health-check.yml` — 永続 denylist 整合性検査(job 名 `Persistent denylist consistency`)

後者は ADR 0020(persistent article denylist)で導入した、`data/denylist.json` の構造整合性を main マージ前に保証する gate で、Dependabot PR がライブラリ更新で内部スキーマを壊した場合に検知する役割を持つ。required にしないと auto-merge で素通りしてしまう。

major 更新については ADR 0006 で `vite` major を `ignore` 済。Astro / Vite の major は本サイトのビルドパイプラインを直撃するため手動レビューが妥当。

## 検討した選択肢

### A. 全自動マージ(却下)

major も含めて auto-merge。1 人開発で「壊れたら直す」発想だが、`vite` major で Astro ビルドが落ちると本番デプロイも止まるため、ADR 0006 の判断と矛盾する。

### B. 手動マージ継続(却下)

現状維持。毎週 5〜10 件の patch / minor PR が編集作業の合間に割り込む。週次 digest 編集 + 日次収集監視がメイン作業の本サイトでは、依存更新で集中が途切れるコストが顕在化していた。

### C. patch / minor 自動マージ + major 手動(採用)

- patch / minor は CI 2 種類(Playwright E2E + Persistent denylist consistency)が green なら自動マージ
- major は手動レビュー(`dependabot.yml` の `ignore` で長期除外する場合あり)
- main ブランチ保護で required CI を登録、Cloudflare Pages は含めない(CF 側のデプロイ仕様変更リスクを回避)

## 決定

C を採用。

### 自動マージ機構

`.github/workflows/dependabot-auto-merge.yml`(2026-05-13 PR #136 で導入済)が `pull_request` で起動、`github.actor == 'dependabot[bot]'` の場合のみ `dependabot/fetch-metadata@v2` で update-type を取得、`semver-major` 以外で `gh pr merge --auto --squash --delete-branch` を発火。

### main ブランチ保護

`gh api PUT /repos/Hayato-Isagawa/edu-watch/branches/main/protection` で以下を設定(2026-05-14 適用):

- `required_status_checks.contexts = ["Playwright E2E", "Persistent denylist consistency"]`
- `required_status_checks.strict = false`(strict にすると Dependabot PR が main 更新ごとに rebase を要求され詰まる)
- `required_pull_request_reviews = null`(1 人開発)
- `enforce_admins = false`(初期値、hotfix 経路を残す)
- `restrictions = null` / `allow_force_pushes = false` / `allow_deletions = false`

### 前提条件 3 点

1. `allow_auto_merge = true`(Settings > General、本リポジトリは元から有効)
2. main ブランチ保護で required CI が登録済(本 ADR で設定)
3. Settings > Actions > General の「Allow GitHub Actions to create and approve pull requests」が有効(2026-05-14 ユーザー確認済)

### `Persistent denylist consistency` を required に含める理由

ADR 0020 で導入した `data/denylist.json` の整合性検査は、依存更新で内部スキーマや JSON parser 挙動が変わった際に main を壊さないための gate。これを required に入れないと、Dependabot による依存更新で denylist が破壊されても auto-merge で素通りしてしまう。本サイトの「永続 denylist」は再収集時の信頼性の根幹であり、required から外せない。

## 影響と運用

### 効果

- 毎週 5〜10 件の patch / minor PR の手動マージ作業がなくなり、週次 digest 編集 + 日次収集監視に集中できる
- CI green が required になり、テスト破壊コミットが main に直接届かなくなる
- 永続 denylist の構造整合性が依存更新に対しても担保される

### 監視 / リスク観測項目

- Cloudflare Pages のデプロイ失敗が required check 外なので、main マージ後にデプロイで詰まる可能性。これは CF の dashboard と本番 health-check で観測する(ADR 0038 prod http status monitor)
- `vite` 以外の依存で major 更新が破壊的になった場合、`dependabot.yml` の `ignore` を追加する運用判断が個別に発生
- Dependabot による依存更新が頻繁に main に入るため、`git log --grep=Dependabot --since="last month"` で月次レビューする運用を維持

## 撤回 / 再検討の条件

- patch / minor auto-merge で 3 件以上の本番デプロイ事故が発生した場合(required CI が不足している可能性を再評価)
- `Persistent denylist consistency` の検査が長期的にメンテ不能になった場合(required check の構成変更が必要)
- 編集体制が変わり 2 人以上の運用になった場合(`required_pull_request_reviews` 導入の再検討)
- Cloudflare Pages のデプロイ仕様が安定し、required check に組み込めると判断できた場合

## 参考

- `.github/workflows/dependabot-auto-merge.yml`(PR #136 で導入、2026-05-13 マージ)
- `.github/workflows/e2e.yml`(`Playwright E2E`)
- `.github/workflows/health-check.yml`(`Persistent denylist consistency`、ADR 0020 で導入)
- `.github/dependabot.yml`(`vite` major ignore あり、ADR 0006)
- `~/.claude/templates/dependabot/`(本運用の標準形を雛形化)
- 姉妹サイト: edu-evidence ADR 0022、edu-law ADR 0004(同じ運用方針を 3 リポジトリ横断で採用)
