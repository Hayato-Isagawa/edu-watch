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
