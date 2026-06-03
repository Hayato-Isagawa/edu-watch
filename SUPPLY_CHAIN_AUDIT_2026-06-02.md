# サプライチェーン攻撃影響調査結果（2026-06-02〜03分）

調査実施日: 2026-06-03
調査対象プロジェクト: edu-watch（`/Users/Hayato/edu-watch`）
main commit: `6bba05630575dc4fff3213a3beb49273afbeaca6`（2026-06-01, "docs: codify digest tone, fact verification, and brevity conventions (#228)"）
working tree: clean（tracked 変更 0 件）
remote: `https://github.com/Hayato-Isagawa/edu-watch.git`
前回調査: `SUPPLY_CHAIN_AUDIT_2026-05-27.md`（TrapDoor / Megalodon / AI設定隠しUnicode、全 PASS）
実施範囲: A（npm Miasma）/ B（GitHub Actions 自己伝播）/ D（Chrome 149 ブラウザ）。C / E / F は手動・申し送り項目として記載。

## サマリー

- **影響なし（SAFE）**
- A: **PASS** — `@redhat-cloud-services` スコープ不在、既知悪性パッケージ 0、Miasma/C2 シグネチャ 0
- B: **PASS** — 攻撃ウィンドウ内の workflow 変更なし、Actions 実行履歴は既知ジョブのみ（自動ニュース収集系含む）
- D: **要対応（低）** — Playwright 同梱 Chromium が 148 系（E2E 専用ブラウザ、曝露リスク低）
- 検出事案番号: なし

## A. npm 依存（Miasma / @redhat-cloud-services）

### A-1. ロックファイル
- `package-lock.json`（lockfileVersion 3, 542,148 bytes）。pnpm/yarn/bun のロックファイルなし。

### A-2. @redhat-cloud-services スコープ依存
| 検査対象 | 結果 |
|---|---|
| package-lock.json grep（推移依存含む全列挙） | **0 件** |
| package.json grep（直接依存） | **0 件** |
| node_modules/@redhat-cloud-services ディレクトリ | **不在** |

判定: **該当なし**。Miasma の悪性 96 バージョンは全て `@redhat-cloud-services` スコープ内であり、当該スコープが依存ツリーに一切存在しないため、悪性バージョンの混入は論理的に発生し得ない。

### A-3. インストール済み痕跡
- node_modules ディレクトリ名に既知悪性パッケージ: **0 件**
- node_modules 内容の Miasma/C2 シグネチャ（`createCommitOnBranch` / `Spreading Blight` / `Shai-Hulud` / 既知C2）: **検出なし**

### A-4. ライフサイクルフック棚卸し
install 系フック総数: **2**。要精査（network / `node -e` / base64 / 外部URL取得）: **0 件**。

| パッケージ | フック | コマンド | 判定 |
|---|---|---|---|
| esbuild@0.27.7 | postinstall | `node install.js` | 正規（既知ビルドツール） |
| sharp@0.34.5 | install | `node install/check.js \|\| npm run build` | 正規（画像処理） |

## B. GitHub Actions（Miasma 自己伝播）

### B-1. ワークフロー変更
- workflow 8 本: `ai-summary-reminder.yml` / `dependabot-auto-merge.yml` / `e2e.yml` / `fetch-news.yml` / `health-check.yml` / `link-check.yml` / `pat-expiry-check.yml` / `recheck-nikkyo-membership.yml`
- 2026-05-29 以降の `.github/workflows/` 変更コミット（author≠committer 偽装含む）: **なし**
- 不審パターン grep（`createCommitOnBranch` / `node -e` / `bun run` / `base64 -d` / `curl … | sh` / `webhook.site`）: **該当なし**

### B-2. composite action
- `action.yml` / `action.yaml`: **なし**

### B-3. Actions 実行履歴（2026-05-29〜2026-06-03, `gh run list`）
確認したランは全て既知ジョブに対応:
- Fetch news（schedule）/ Health check / E2E Tests
- auto-collect articles（自動記事収集）/ recheck nikkyo membership（既知の自動データ更新）
- Dependabot auto-merge

不審な author・未知ワークフロー・予期しない OIDC トークン発行・想定外の publish: **確認されず**。

> 注: edu-watch は自動ニュース収集ワークフロー（fetch-news / auto-collect / recheck-nikkyo）が schedule で多数稼働するため Actions ラン数が多いが、いずれも既知の運用ジョブであり、PAT を使う `pat-expiry-check.yml` も含め想定内。

## C. 開発者端末インフォスティーラー対策（手動確認）

本リポからは検証不可。開発者各自が以下を確認すること:

```
□ 開発者端末で EDR / アンチマルウェアが稼働し最新定義か
□ GitHub / npm / クラウド認証情報をブラウザに平文保存していないか
□ GitHub セッションクッキー・PAT の有効期限と最終利用箇所を確認
  （特に fetch-news / recheck-nikkyo 用の PAT は pat-expiry-check の結果も併せて確認）
□ GitHub の OAuth/連携アプリ一覧に身に覚えのない連携がないか
□ 自社ドメイン認証情報がインフォスティーラーログに出ていないか
□ 重要アカウントはセッション全失効 → 再ログイン → 2FA 再確認
```

## D. ブラウザ更新状況（Chrome 149）

- Playwright: `@playwright/test@1.60.0` / `playwright@1.60.0` / `playwright-core@1.60.0`
- 同梱 Chromium（stable channel）: **148.0.7778.96**（chromium-tip-of-tree は 149.0.7827.0）
- Puppeteer: 不使用

判定: **要対応（低優先）**。Playwright の Chromium は自サイト E2E 専用で曝露リスクは低いが、Chrome 149 セキュリティリリース（CVE-2026-9872〜9893）の 1 メジャー前のため更新推奨。

```
□ 開発者端末・CI ランナーの Chrome / Chromium / Edge を 149 系へ更新
□ Playwright を Chromium 149+ 同梱バージョンへ更新（次回 E2E 更新時に対応）
□ Electron / CEF 組み込みアプリ: 本リポでは不使用（該当なし）
```

## E. 即時対応リスト（認証情報ローテーション）

該当なし。A〜B の技術軸が全て PASS のため、隔離・永続化除去・ローテーションは不要。

## F. インフラ管理者への申し送り

```
□ 既知C2・偽装ドメインを DNS / プロキシ / FW でブロック（最新 IOC は Wiz / Snyk / Aikido / Socket / RHSB-2026-006 を参照）
  既知C2（継続ブロック推奨）:
  - 216.126.225.129（Megalodon C2）
  - flipboxstudio.info（Laravel-Lang C2）
  - ddjidd564.github.io（TrapDoor C2）
  - t.m-kosche.com（@antv / actions-cool C2）
□ GitHub Gists / webhook.site / GitHub Pages への業務外 egress を監視
□ CI ランナーからの想定外の Bun ランタイムダウンロードを検知
```
- Cloudflare Pages: 影響なし（リポ依存）
- 公開ドメイン: 影響なし

## 結論と次のアクション

**SAFE。** 2026-06-01 公開の Miasma および GitHub Actions 自己伝播に対し edu-watch は影響なし。A / B 全 PASS。自動収集ワークフロー群も全て既知運用ジョブで異常なし。

次のアクション:
1. （低）次回 E2E メンテ時に Playwright を Chromium 149+ 同梱版へ更新
2. （手動）C の開発者端末チェックリストを各自実施（特に自動化用 PAT）
3. 継続注視: TrapDoor / Megalodon / Laravel-Lang / vpmdhaj タイポスクワット
