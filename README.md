# EduWatch JP

教員・保護者向けに教育ニュースを一次情報から追うサイト。**news.edu-evidence.org**

EduEvidence JP(edu-evidence.org)の姉妹サイト。文部科学省・国立教育政策研究所・OECD・EEF・主要新聞の教育面から、一次情報を日次で自動収集し、エビデンスの視点で整理します。

> **命名について**: サイト名・ブランド名は **EduWatch JP**、リポジトリ名・技術的呼称は `edu-watch`。本 README 以降の技術ドキュメントでは文脈により使い分けています。

## ステータス

Sprint 1(基盤構築)進行中。本番公開はまだ準備段階です。

## 技術スタック

| 項目 | 値 |
|---|---|
| フレームワーク | Astro 6 |
| UI | React 19 / Tailwind 4 |
| 言語 | TypeScript |
| バージョン管理 | mise(`.tool-versions` で Node 24.15.0 固定) |
| ホスティング | Cloudflare Pages |
| ドメイン | news.edu-evidence.org |

## セットアップ

```bash
mise install
npm ci
npm run dev
```

## PRD

詳細は [docs/PRD.md](docs/PRD.md) を参照(v1.0 承認済み、2026-04-24)。

## ライセンス

CC BY-SA 4.0.
