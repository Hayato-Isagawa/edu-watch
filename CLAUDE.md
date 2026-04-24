# EduWatch JP

教員・保護者向けに、教育ニュースを一次情報から追う姉妹サイト(news.edu-evidence.org)。Astro 6 + React 19 + Tailwind 4 + TypeScript。

- **サイト名・ブランド名**: EduWatch JP
- **リポジトリ / 技術名**: edu-watch

## ブランド

- **モチーフ**: 双葉(cotyledon)。姉妹サイト EduEvidence JP の「成熟した葉」と対になり、「日々の新しい芽吹き = 日次ニュース」を象徴
- **アクセント色**: ディープネイビー `#1e4a6e`(`--color-accent`)
- **ロゴ実装**: `src/components/Logo.astro` が inline SVG + `currentColor` 継承。色を変えたい時は呼び出し側の `color:` / Tailwind の `text-` クラスを変えるだけで済み、SVG を直接編集する必要なし

## 環境

Node.js は `.tool-versions` で固定(`nodejs 24.15.0`)。[mise](https://mise.jdx.dev/) 前提。

```bash
mise install               # Node 24 を導入
npm ci                     # 依存復元
npm run dev                # 開発サーバー(localhost:4321)
npm run build              # 本番ビルド
npm run check              # Astro 型チェック
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

## ホスティング

Cloudflare Pages(GitHub main ブランチ連携で自動デプロイ)。
ドメイン: **news.edu-evidence.org**(edu-evidence.org のサブドメイン、CNAME)。
メール: Cloudflare Email Routing で `news@edu-evidence.org` を個人 Gmail に転送。
