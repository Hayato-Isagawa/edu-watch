# Architecture Decision Records (ADR)

本ディレクトリは EduWatch JP の主要な意思決定の不変記録を集めたものです。なぜその決定に至ったか、どの選択肢が却下されたか、何が起きたら見直すかを時系列で残し、半年後・1 年後の自分や新しい貢献者が意思決定の背景を辿れるようにします。

## 運用方針

- 決定が確定したら新規 ADR を追加(連番 4 桁)
- **原則として改変しない**(誤植修正は例外)
- 決定を覆す場合は新規 ADR を起こし、旧 ADR の「状態」を `撤回(####で上書き)` に変える
- 対象: ブランド体系、技術選定、ソース選定、運用ポリシー、ガバナンス

## 対象外

- コードの実装方針 → コードコメント / PR 本文 / `docs/sprint-2-design.md`
- セッション中の作業状態 → `.claude/state/active.md`
- 日々のソース追加判断 → 当該 PR
- 個人の作業嗜好 → メモリ(リポジトリ外)

## 姉妹サイトとの整合

EduEvidence JP と共通の運営方針(植物モチーフブランド体系 / Node 24 LTS / 公開氏名 / 本体非営利 + SaaS 分離)は、edu-evidence の `docs/decisions/0001` `0002` `0004` `0005` を参照し、本リポジトリには edu-watch 固有の判断のみを置く。

## テンプレート

```markdown
# NNNN. タイトル

- 状態: 採用 / 撤回(####で上書き)
- 日付: YYYY-MM-DD
- 関連 PR: #N, #M

## 背景
## 検討した選択肢
## 決定
## 帰結
## 撤回 / 再検討の条件
```

詳細な運用方針は [`../context-management.md`](../context-management.md) を参照。

## 索引

- [0001. 双葉(cotyledon)非対称ロゴで芽吹きを表現](0001-cotyledon-asymmetric-logo.md)
- [0002. モノレポ化せず別リポジトリで運用](0002-separate-repository.md)
- [0003. 3 層ソース構成と日経除外](0003-three-tier-source-policy.md)
- [0004. Cloudflare ブロック対象ソース(OECD / EEF)の運用](0004-cloudflare-blocked-source-handling.md)
- [0005. X 統一運用と Email Routing 3 エイリアス](0005-x-unified-and-email-routing.md)
- [0006. vite major アップデートを Dependabot で ignore](0006-vite-major-pin.md)
- [0007. 第 2 層を大手紙の教育面から教育専門紙へ転換](0007-tier2-shift-to-specialty-press.md)
- [0008. 引用範囲遵守ポリシーと削除依頼窓口](0008-citation-scope-policy.md)
- [0009. fetch-news ワークフローを PR フロー化、cron を日次 2 回へ削減](0009-fetch-news-pr-flow-and-twice-daily.md)
- [0010. mergeDay は既存 id をスキップし collectedAt を初観測時刻で固定する](0010-dedupe-skip-existing-id.md)
- [0011. UI 状態はセマンティック属性(aria-* / data-*)で管理する](0011-semantic-attribute-state-management.md)
- [0012. NIER ソースを RSS から HTML スクレイピングへ切り替え](0012-nier-html-scraping.md)
- [0013. 日本教育新聞の会員限定記事を判別し、UI 上で予告する](0013-nikkyo-membership-detection.md)
- [0014. categorize ロジックの改善と既存記事の再カテゴライズ](0014-categorize-overhaul-and-recategorization.md)
- [0015. mext 教育スコープフィルタ導入と既存データのリンク切れ・重複クリーンアップ](0015-mext-education-scope-filter-and-data-cleanup.md)
- [0016. 直線 3px アクセントバーは角張ったリスト要素のみに適用する](0016-linear-accent-bar-scope.md)
- [0017. 週次ダイジェストに事実検証サブエージェント digest-fact-checker を導入する](0017-digest-fact-checker-agent.md)
- [0018. 対象読者を学校教員・教育関係者に統一する](0018-teacher-focused-audience.md)
- [0019. 対象読者の遡及適用とリセマム NG ワード再設計](0019-retroactive-audience-cleanup-and-resemom-filter.md)
- [0020. 削除した記事 ID の永続追跡 + 再取り込み防止](0020-persistent-article-denylist.md)
- [0021. nikkyo paywall 判別マーカーの OR 化と表現の正確化](0021-nikkyo-membership-detection-robustness.md)
- [0022. nikkyo paywall 後付け化への追従(再判定 cron)](0022-recheck-nikkyo-membership.md)
- [0023. ヒーロー領域を縦積みレイアウトに統一(edu-evidence ADR 0009 ミラー)](0023-stacked-hero-with-large-h1.md)
- [0024. ADR 0019 取りこぼしの予防的封じ込め](0024-residual-resemom-cleanup.md)
- [0025. 本文フォントはシステムフォントスタックに統一し Web フォントを廃止する](0025-system-font-stack-no-webfont.md)
- [0026. ダークモードはシステム追従デフォルト + 手動切替トグル(`data-theme` 属性)で提供する](0026-dark-mode-data-theme-with-system-default.md)
- [0027. 投稿系ページ(ダイジェスト)のメタ配置を姉妹サイトで統一する](0027-posts-meta-layout-unified.md)
- [0028. ダークモードのトークン値を可読性重視に再調整する](0028-dark-mode-readability-tuning.md)
- [0029. 本文タイポグラフィを可読性重視にチューニングする](0029-prose-typography-readability-tuning.md)
- [0030. ダーク本文 ink を react.dev の gray-15(`#D0D3DC`)に再微調整する](0030-ink-token-react-dev-gray-15.md)
- [0031. ダイジェスト個別ページに動的 OG 画像生成を導入(フォントは同梱)](0031-og-image-dynamic-with-bundled-font.md)
- [0032. 静的 default OG 画像を整備し、個別 OG を持たないページのフォールバックとする](0032-static-default-og-image.md)
- [0033. ダイジェスト markdown に textlint 日本語校正を導入する(姉妹サイト構成のミラー)](0033-textlint-japanese-linting.md)
- [0034. OG 画像キャッシュ更新ポリシー(姉妹サイト ADR の edu-watch 適用)](0034-og-cache-refresh-policy.md)
- [0035. kyodo を Tier 1/2 自動収集から Tier 3 参考のみへ降格](0035-kyodo-tier3-demotion.md)
- [0036. Tier 1 採用基準の緩和と OECD 公式ブログ feed の Tier 1 採用](0036-tier1-source-criteria-expansion.md)
- [0037. 木の部位体系 5 サイト拡張を edu-watch にミラーする](0037-mirror-tree-system-5-sites.md)
- [0038. 本番 HTTP ステータス監視ワークフローの追加](0038-prod-http-status-monitor.md)(撤回)
- [0047. digest sections に articleIds: string[] を採用し、N 記事 1 統合コメントを既定構造とする](0047-digest-sections-multi-article.md)
- [0048. digest 本文(`<Content />`)を撤回し summary 単一化する](0048-digest-drop-content-body.md)
- [0049. recheck-nikkyo-membership の token を Fine-grained PAT に切り替えて再判定 PR の required CI を発火させる](0049-recheck-nikkyo-token-elevation.md)
- [0050. W-1 AI 要約パイプライン MVP(registry 駆動 + per-chunk raw retry + pattern hardening)](0050-w1-ai-summary-mvp.md)
- [0051. リセマム include 方式 教員視点キーワードフィルター(NG_PATTERNS との AND ゲート)](0051-resemom-include-keyword-filter.md)
- [0052. e2e workflow に Playwright ブラウザキャッシュを導入](0052-e2e-playwright-browser-cache.md)
- [0053. EDUCATION_PATTERNS 拡充: 情報モラル / ネットパトロール / キャリア教育](0053-edu-patterns-info-moral-career.md)
- [0054. W-2 strict recovery judgment for LLM hallucination detection (with rawChunkSources page-marker lookup fix)](0054-w2-strict-recovery-judgment.md)
- [0055. リンクチェックから kknews.co.jp を除外する](0055-exclude-kknews-from-link-check.md)
- [0056. リンクチェックから MEXT 採用公告（非常勤職員）を除外する](0056-exclude-mext-recruitment-from-link-check.md)
