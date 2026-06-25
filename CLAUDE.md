# EduWatch JP

学校教員・教育関係者向けに、教育ニュースを一次情報から追う姉妹サイト(news.edu-evidence.org)。Astro 6 + React 19 + Tailwind 4 + TypeScript。

対象読者は ADR 0018 で「学校教員・教育関係者」に統一済み。保護者向けの私的関心(中学受験・習い事ランキング・幼児教育のおすすめ等)は対象外、保護者向け一次情報でも教員視点で関連するもの(家庭との連携・情報モラル指導・経済格差と学習機会など)は採用する。

- **サイト名・ブランド名**: EduWatch JP
- **リポジトリ / 技術名**: edu-watch

## ブランド

- **モチーフ**: 双葉(cotyledon、**左右非対称**)。右葉が先行して広がり、左葉がやや遅れて開く構図で「成長の瞬間・動き」を表現する。姉妹サイト EduEvidence JP の「成熟した葉(左右対称)」と対になり、ストック型 vs フロー型の性格を視覚的に区別
- **アクセント色**: ディープネイビー `#1e4a6e`(`--color-accent`)
- **wordmark**: `EduWatch <accent>JP</accent>`(末尾の `JP` のみアクセント色。edu-evidence と統一パターン)
- **ロゴ実装**: `src/components/Logo.astro` が inline SVG + `currentColor` 継承。色を変えたい時は呼び出し側の `color:` / Tailwind の `text-` クラスを変えるだけで済み、SVG を直接編集する必要なし

## 環境

Node.js は `.tool-versions` で固定(`nodejs 24.17.0`)。[mise](https://mise.jdx.dev/) 前提。

```bash
mise install               # Node 24 を導入
npm ci                     # 依存復元
npm run dev                # 開発サーバー(localhost:4321)
npm run build              # 本番ビルド
npm run check              # Astro 型チェック
npm run vrt                # ビジュアルリグレッションテスト(現 dist を撮影・比較。権威ある比較は CI、後述)
```

`package.json` の `engines.node` は `>=24.0.0`。

## プロジェクト構造(Sprint 1 時点)

- `src/pages/index.astro` — トップ(Coming Soon)
- `src/layouts/Layout.astro` — 共通レイアウト(edu-evidence と統一のデザイントークン)
- `src/styles/global.css` — デザインシステム(edu-evidence から持ち込み、将来共通化候補)
- `public/_headers` — セキュリティヘッダー
- `docs/PRD.md` — v1.0 承認済みのプロダクト要件

## 姉妹サイトとの関係

- **edu-evidence.org**(本家): 戦略 73 本・コラム 20 本のストック型エビデンスポータル
- **news.edu-evidence.org**(本サイト): 日次の教育ニュース + 週次ダイジェスト(フロー型)

Layout / styles / glossary / OG 画像ユーティリティは edu-evidence からコピー持ち込み。半年運用後に共通化(npm package 化など)を検討する。

## ロードマップ

- **Sprint 1**(進行中): 基盤構築(本リポジトリ作成・Cloudflare Pages デプロイ・CNAME)
- **Sprint 2**: RSS パイプライン(日次自動収集、GitHub Actions cron)
- **Sprint 3**: フロント実装(記事一覧・カテゴリ・検索)
- **Sprint 4**: 週次ダイジェスト

PRD 参照: `docs/PRD.md`。

## 編集ポリシー(PRD §6 抜粋)

- 一次情報リンクを冒頭に必須配置
- タイトル改変なし(引用は原文のまま)
- 日次記事に編集者の意見は加えない
- 週次ダイジェストに限り論点整理を付与

## ビジュアルリグレッションテスト(VRT)

共有レイアウト・コンポーネント・`global.css` の改修による視覚回帰を、目視に頼らず差分画像で検出する仕組み(ADR 0060、edu-evidence ADR 0024 のミラー)。機能テスト(`e2e/`)とは別系統で併走する:

- **設定**: `playwright.vrt.config.ts`(`testDir: vrt/`、desktop 1280 / mobile 390 の 2 projects、`maxDiffPixelRatio: 0.01`、アニメーション無効、port 4174)
- **対象**: `vrt/pages.spec.ts` がテンプレート代表 13 URL(トップ / ダイジェスト一覧・詳細 / アーカイブ一覧・詳細 / カテゴリ一覧・詳細 / ソース一覧・詳細 / about / 検索 / changelog / 404)をフルページ撮影。テンプレートを追加したら代表 URL を 1 行追記する
- **ゲート**: `.github/workflows/vrt.yml` が `pull_request` の `paths` で `src/layouts/**`・`src/components/**`・`src/styles/**`・`astro.config.*`・`vrt/**`・`playwright.vrt.config.ts` に限定起動。記事データ・ダイジェストだけの PR では走らない(`workflow_dispatch` で手動実行可)
- **比較方式(案A)**: CI 内で main と PR を両方ビルドし、同一 Linux 環境で撮影・比較する。ベースライン PNG はコミットしない(`vrt/__screenshots__/` は gitignore)。システムフォント描画の macOS↔Linux 差を回避するため
- **ローカル**: `npm run vrt` で現在の `dist` を撮影・比較できる。権威ある 2 ビルド差分は CI 側
- **required check 非対象**: 視覚変更 PR でしか起動しないため required には含めない。マージ可否は編集者判断(rule 13)

## ホスティング

Cloudflare Pages(GitHub main ブランチ連携で自動デプロイ)。
ドメイン: **news.edu-evidence.org**(edu-evidence.org のサブドメイン、CNAME)。
メール: Cloudflare Email Routing で `news@edu-evidence.org` を個人 Gmail に転送。

## コンテキスト管理

Claude Code とのセッションは context 圧縮 / `/clear` / セッション終了を跨ぐことがある。重要な決定と進行状態は会話ではなくファイルに残す方針:

- **主要な意思決定** → [`docs/decisions/`](docs/decisions/)(ADR、不変)
- **現在のセッションの作業状態** → `.claude/state/active.md`(生きたチェックポイント、git 追跡外)
- **運用方針の全体** → [`docs/context-management.md`](docs/context-management.md)

`.claude/hooks/pre-compact.sh` と `post-compact.sh` が圧縮時に active.md を dump / 再読込リマインダーを出すよう登録されている(`.claude/settings.json`)。
