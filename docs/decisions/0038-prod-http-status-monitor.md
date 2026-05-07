# ADR 0038: 本番 HTTP ステータス監視ワークフローの追加

## Status

採択 (2026-05-07)

## Context

Issue #107 で本番 `/` が持続的に HTTP 500 を返している事象を観測した。検出経路は週次 link-check 走行(`lychee` Run #25479461289)で `dist/index.html` の `<link rel="canonical" href="https://news.edu-evidence.org/">` 経由で偶発的に検出されたものであり、専用の監視は存在しなかった。

既存の `.github/workflows/health-check.yml` は `npm run check:excluded-ids`(denylist 整合性チェック)のみを実行しており、本番 HTTP ステータスは一切観測していない。すなわち以下のような事象を検出する手段がリポジトリ内に存在しなかった:

- Cloudflare Pages の deployment promotion 過程で特定エッジに古い asset cache が残る
- Pages Functions / `_middleware.ts` 等のランタイムエラーで `/` だけ 500 を返す
- DNS / Worker 競合等のインフラ要因で特定経路が落ちる

Issue #107 起票時(2026-05-07 08:06 UTC)の curl 結果は `cf-ray: 9f7eb94c1e7e787f-SJC` の San Jose エッジ単体での 500 観測であり、外部からユーザーが偶発的に観測するまで(約 1.5h)誰も検出できなかった。

## Decision

`.github/workflows/health-prod.yml` を新設し、本番の代表 5 URL に対して HTTP ステータスを毎時叩き、5xx を検出した場合のみ Issue を起票するワークフローを追加する。

### 監視対象 URL

| URL | 役割 |
|---|---|
| `/` | トップ。Issue #107 で 500 を観測した本丸 |
| `/about/` | サイト説明、テンプレ駆動 |
| `/categories/research/` | カテゴリ動的ルート、`getStaticPaths` 経由 |
| `/sources/` | ソース一覧、データ駆動 |
| `/digest/` | 週次ダイジェスト、コンテンツコレクション駆動 |

ルート構造の異なる 5 経路を選ぶことで、特定の生成パス(静的・動的・コレクション)固有の障害を切り分けられる。

### cron 頻度

`0 * * * *`(毎時 0 分、1 時間に 1 回)。フロー型の教育ニュース媒体としての SLA を考慮し、最大検出遅延 1h を許容ラインとする。

### 失敗判定

HTTP ステータス `>= 500` のみで fail とする。

- 2xx は当然 pass
- 3xx(308 等の trailing slash リダイレクト)は pass
- 4xx は別途 `link-check.yml`(weekly lychee)で網羅、本ワークフローでは pass
- 5xx を検出した URL を全て収集し、ログに出力した上で job を fail させる

### Issue 起票

既存 `health-check.yml` の `open-issue-on-cron` ジョブ構造を踏襲する。

- 起票はトリガーが `schedule` のときのみ(`workflow_dispatch` / PR では起票しない)
- ラベル `health-prod`(色 `#d73a4a`、新規)を job 内で `gh label create --force` で冪等作成
- 既に open な同種 Issue があれば新規作成せずコメント追加(`gh issue list --search 'in:title "production 5xx detected"'`)
- タイトル `health-prod: production 5xx detected`
- 本文に Run URL と検出ログを含める

## Consequences

### 利点

- 本番障害を最大 1h 以内に検出可能になり、Issue #107 のような「外部から偶発的に発見されるまで放置」が原則発生しない
- 既存 `health-check.yml`(denylist 整合性)とは責務分離されているため、片方の責務拡張で他方を巻き込まない
- Issue 起票が cron トリガー時のみのため、PR 単位や手動実行で発火しない
- public repo のため GitHub Actions 無料無制限の範囲内で完結

### コスト

- 1 ジョブ ≒ 30 秒未満、月 720 回 ≒ 6 時間程度の Actions リソース消費
- false positive 時の Issue ノイズ。5xx に絞ることで一時的な edge ノイズの影響を抑制

### 代替案

| 案 | 不採択理由 |
|---|---|
| 6h 1 回 cron | 夜間〜翌朝の長時間放置リスクが許容できない |
| 既存 `e2e.yml` 流用 | PR 単位で本番 URL を叩く設計ではないため流用不可 |
| 外部監視 SaaS(UptimeRobot 等) | リポジトリ内完結性を優先 |
| 5xx 以外も判定(レスポンス時間 / ボディ内容) | MVP として 5xx に絞る。後続必要なら別 ADR |

### 横展開

ADR 0037 の 5-site 体系(edu-evidence / edu-law / edu-research / portfolio / news)に同一構造のワークフローを段階的に追加する余地がある。本 ADR を踏み台として参照可能。

## 関連

- Issue #107: Production root '/' returns HTTP 500 despite successful deployment
- ADR 0020: 本番 HTTP ステータス監視は §残タスクの対象外で、denylist 整合性に限定されていた
- ADR 0037: 5-site 体系のミラー方針(将来の横展開に関連)
