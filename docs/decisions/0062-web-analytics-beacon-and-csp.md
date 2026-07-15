# 0062. Cloudflare Web Analytics を手動スニペット方式で導入し CSP を最小限緩和する(edu-evidence ADR 0026 ミラー)

- 状態: 採用
- 日付: 2026-07-12(決定・実施)。本 ADR は 2026-07-15 の追認記録(実施時に起票漏れ)
- 関連 PR: #384
- 関連 ADR: edu-evidence 0026(原本。無音故障の経緯と検討した選択肢の詳細)/ okinawa-in-data `docs/decisions/0002`(初出)

## 背景

edu-evidence ファミリーで Web Analytics の無音故障(WA サイトのセットアップモード不整合により rum POST が 503、約 3 ヶ月イベント 0 件)が判明・修復されたのに伴い、本リポも同じ「手動スニペット方式」へ揃える。経緯・選択肢(自動注入の廃止、SRI 不付与の理由)は原本 ADR 0026 を参照。

## 決定(edu-watch 固有)

1. news.edu-evidence.org 用の WA サイトを手動モードで**新規作成**し、Cloudflare Pages 統合の自動注入は無効化する
2. ビーコンを `src/layouts/Layout.astro` に静的に記載する(トークンはリポジトリ管理)
3. `public/_headers` の CSP は **connect-src へ `https://cloudflareinsights.com` を追加するのみ**(`https://static.cloudflareinsights.com` は script-src / connect-src とも既許可で変更なし)

## 帰結

- rum POST 204 の直接実測は未実施(記録時点。ブラウザ自動化のドメイン権限制約による)。ユーザー訪問+WA ダッシュボードのイベント記録で確認する運用
- 機構は evi / law と同一。全ページに外部スクリプト 1 本(cookie なし・ドメイン単位)

## 撤回 / 再検討の条件

原本(edu-evidence ADR 0026)に同じ。
