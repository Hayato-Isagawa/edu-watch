# 貢献ガイド

EduWatch JP への貢献に興味を持っていただきありがとうございます。

## 貢献の方法

### Issue を立てる

- **バグ報告** — サイトの表示・機能の不具合
- **コンテンツの誤り報告** — カテゴリ分類の誤り・元リンクの切れ・記事の一次情報との乖離
- **機能・改善提案** — UI / UX / アクセシビリティ / 新機能のアイデア

各種テンプレートが `.github/ISSUE_TEMPLATE/` に用意されています。

### Pull Request を送る

1. このリポジトリを fork
2. ブランチを作成(`git checkout -b <type>/<short-description>` 形式)
3. 変更をコミット
4. push して PR を作成

## コミットメッセージ / PR タイトル規約

[Conventional Commits](https://www.conventionalcommits.org/) 形式の **英語** で書く。

```
feat: add mext RSS parser
fix: correct utm parameter stripping in canonicalizeUrl
docs: publish Sprint 2 design document
chore: bump zod from 4.3.6 to 4.3.7
ci: schedule fetch-news cron at 07:00/13:00/19:00 JST
```

使用する type:

| type | 用途 |
|---|---|
| `feat` | 新機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `chore` | ビルド設定 / 依存更新 / 非機能的変更 |
| `refactor` | 挙動を変えないリファクタ |
| `perf` | パフォーマンス改善 |
| `ci` | GitHub Actions / 自動化関連 |

## 編集ポリシー(コンテンツ / RSS 収集)

edu-watch の編集ポリシーは `docs/PRD.md` §6 に集約されています。主要点のみ再掲:

- 一次情報リンクを冒頭に必須配置
- タイトルの編集は行わない(配信元のタイトルをそのまま掲載)
- 日次記事に編集者の意見は加えない(週次ダイジェストのみ論点整理を付加)
- 誹謗中傷・デマ・重大事件の被害者特定につながる情報は掲載しない

## ブランチ保護

`main` ブランチには以下のルールが適用されています:

- 直接 push 禁止、PR 経由でのみ変更可能
- Squash マージのみ
- Review thread の解決が必須
- マージ後のブランチは自動削除

### ローカル側の二段ガード

GitHub 側のブランチ保護に加え、ローカルでも `main` への直接編集・直接コミットをツールレベルで拒否します。

- **Claude Code 経由の編集**: `.claude/hooks/branch-guard.sh` が `Edit` / `Write` / `MultiEdit` の前に発動し、現ブランチが `main` / `master` のときに編集を拒否
- **任意のツール経由のコミット**: `.githooks/pre-commit` が `main` / `master` への直接コミットを拒否

`.githooks/` は `npm install` 時に `package.json` の `prepare` スクリプトで自動的に有効化されるため、特別なセットアップは不要です。手動確認:

```bash
git config core.hooksPath        # .githooks と表示されれば有効
```

新規作業はフィーチャーブランチを切ってから始めてください。

```bash
git checkout -b <type>/<short-description>
# 例: feat/sprint-2-batch-2, fix/parser-edge-case, chore/deps-bump
```

## ライセンス

- コード: MIT License(`LICENSE` 参照)
- コンテンツ: CC BY-SA 4.0

## ブランド

姉妹サイト EduEvidence JP と共通の「植物モチーフ」体系を採用。詳細は `docs/BRAND.md` を参照してください。
