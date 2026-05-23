# サプライチェーン攻撃影響調査結果 (2026-05)

調査実施日: 2026-05-22
調査対象プロジェクト: edu-watch (/Users/Hayato/edu-watch)
調査範囲: 2026-05-18〜21 の Mini Shai-Hulud / TeamPCP / UNC6780 系インシデント (#1〜#6)

## サマリー

- 判定: **影響なし**
- 検出インシデント: なし (0/6)
- 結論: 依存・CI/CD・開発環境のいずれにも侵害アーティファクトは検出されず。残課題は CI/CD の軽微な堅牢化(タグ参照 2 件の SHA pin 化)のみ

## A. npm 依存

### A-1. ロックファイル
- 使用中のロックファイル: `package-lock.json`
- 他形式(`pnpm-lock.yaml` / `yarn.lock` / `bun.lockb` / `bun.lock`)は不在

### A-2. 影響パッケージ検索結果
| パッケージ | 検出 | バージョン | 検出箇所 |
|---|---|---|---|
| echarts-for-react | なし | — | — |
| size-sensor | なし | — | — |
| timeago.js | なし | — | — |
| canvas-nest.js | なし | — | — |
| @antv/g | なし | — | — |
| @antv/g2 | なし | — | — |
| @antv/g6 | なし | — | — |
| @antv/x6 | なし | — | — |
| @antv/l7 | なし | — | — |
| @antv/s2 | なし | — | — |
| @antv/f2 | なし | — | — |
| @antv/g2plot | なし | — | — |
| @antv/graphin | なし | — | — |
| @antv/data-set | なし | — | — |
| @antv/scale | なし | — | — |
| @antv/setup | なし | — | — |
| node-ipc (9.1.6 / 9.2.3 / 12.0.1) | なし | — | — |
| @tanstack/react-router | なし | — | — |
| @tanstack/react-query | なし | — | — |
| @tanstack/router-core | なし | — | — |
| @tanstack/start | なし | — | — |
| @tanstack/setup | なし | — | — |
| better-auth | なし | — | — |

### A-3. node_modules 異常ファイル
- 異常ファイル(`router_init.js` / `setup.mjs`): なし
- 異常 `preinstall` フック(`bun run` 含む): なし
- 異常 `optionalDependencies`(`@antv/setup` / `@tanstack/setup`): なし

## B. PyPI 依存
- 依存ファイル(`requirements*.txt` / `pyproject.toml` / `poetry.lock` / `uv.lock` / `Pipfile.lock`): 存在しない
- `durabletask` の検索対象なし(該当なし)

## C. CI/CD

### C-1. 侵害 Action 参照
- `actions-cool/issues-helper`: 該当なし
- `actions-cool/maintain-one-comment`: 該当なし

### C-2. SHA pin 移行推奨リスト
全 8 ワークフロー・全 18 `uses:` 行のうち 16 件は 40 桁 SHA pin 済み。残るタグ参照は以下のみ。

| ファイル | 行 | Action | 現状参照 | 推奨対応 |
|---|---|---|---|---|
| `.github/workflows/ai-summary-reminder.yml` | 21 | `actions/checkout` | `@v4` | コミット SHA に置換 |
| `.github/workflows/ai-summary-reminder.yml` | 26 | `actions/github-script` | `@v7` | コミット SHA に置換 |

備考: GitHub 公式 `actions/*` リポジトリは現時点で侵害事例の報告はないが、`actions-cool/*` と同種の imposter commit 攻撃に対する一律の防御として SHA pin が推奨される。

### C-3. pull_request_target 利用箇所
- 検出: なし

### C-4. 手動確認が必要な項目
- [ ] 2026-05-11 19:20 UTC 以降の Actions 実行ログで `filev2.getsession.org` / `api.masscan.cloud` / `t.m-kosche.com` / `check.git-service.com` / `*.getsession.org` への外向き接続有無
- [ ] 2026-05-19 以降の Actions 実行履歴で `actions-cool/*` の実行履歴(本レポート時点で参照なし、念のため履歴確認)
- [ ] 不審な npm publish イベント(本プロジェクトは publish しない想定だが念のため)

## D. 開発者各自の手動確認 (横断調査で既に確認済み)
- [x] Cursor で `nrwl.angular-console` v18.95.0 未インストール (確認済 2026-05-22)
- [x] `~/Library/LaunchAgents/` 正常 (Canva / Google / CleanMyMac / ollama のみ、確認済)
- [x] `~/.claude/setup.mjs` / `~/.vscode/setup.mjs` / `~/.cursor/setup.mjs` 不在 (確認済)
- [x] `/tmp/managed.pyz` / `/tmp/rope-*.pyz` / `/tmp/tmp.*.lock` 不在 (確認済)
- [x] `~/.cache/.sys-update-check` 不在 (確認済)
- [x] `python3 /tmp/managed.pyz` 等の不審プロセスなし (確認済)
- [x] `~/.claude/settings.json` 等の C2 ドメイン痕跡なし (確認済)

## E. 即時対応リスト (認証情報ローテーション)

現時点で必須なローテーションはありません。

定期保守として推奨(本攻撃と無関係):
- npm tokens(本プロジェクトは publish しない想定なので低優先)
- GitHub Personal Access Tokens(数か月単位の定期更新)
- Cloudflare API tokens(Pages デプロイで利用していれば定期更新)

## F. インフラ管理者への申し送り

DNS / プロキシ / FW でブロック推奨ドメイン:
- `t.m-kosche.com`
- `check.git-service.com`
- `git-tanstack.com`
- `*.getsession.org` / `filev2.getsession.org`
- `api.masscan.cloud`

## 結論と次のアクション

- **即時対応が必要な項目**: なし
- **推奨**: `ai-summary-reminder.yml` の 2 件のタグ参照を SHA pin 化(任意・低優先)
- **手動確認**: C-4 の Actions 実行ログ確認(GitHub UI から)
- 完了したら担当者は本ファイルにチェックを記入してください
