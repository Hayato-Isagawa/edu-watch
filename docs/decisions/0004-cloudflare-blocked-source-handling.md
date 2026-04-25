# 0004. Cloudflare ブロック対象ソース(OECD / EEF)の運用

- 状態: 採用
- 日付: 2026-04-25
- 関連 PR: #6, #10

## 背景

第 1 層(一次情報)の OECD と EEF は、当初 RSS / HTML 取得で自動収集する計画だった。Sprint 2 Batch 1 の実装中に以下が判明した:

### OECD

- `search.oecd.org/rssfeeds/` は **DNS 解決失敗**(ENOTFOUND)
- 代替候補(OECD iLibrary RSS / topic-page 埋め込み RSS / `.atom` バリアント)も **403 / 301** リダイレクト
- 一般ブラウザ UA(Chrome 系)を装っても 403

### EEF

- Cloudflare Bot Management が **厳格にブロック**
- `edu-watch/1.0` UA でも `Mozilla/5.0` UA でも **403 + Sec-CH-UA challenge**
- 多くの教育研究系 CMS が EEF と同等のブロックポリシーを採用しているため、回避策が長続きしない

両者とも、強引な回避(UA 偽装の高度化、JS 実行ブラウザ + ヘッドレス、API キー取得交渉)はコストが高く、本来の目的(週 1〜2 件の重要記事を編集者がダイジェストで紹介する)に対して過剰投資となる。

## 検討した選択肢

- **A) Cloudflare Workers をプロキシにして、Workers 経由で取得**(別 Cloudflare アカウントから Cloudflare Bot Management を回避できる可能性)
- **B) 自動取得を諦め、編集者が週次ダイジェスト作成時に手動で OECD / EEF を参照する**
- **C) headless Chromium(Playwright)で完全なブラウザ環境を装う**
- **D) 公式 API を交渉する**

## 決定

**B) 編集者の手動拾い運用** を採用。

### 運用ルール

- 本番 pipeline(`scripts/fetch-news.ts` の `sources` 配列)から **OECD と EEF を除外**
- パーサ雛形は `src/lib/sources/oecd.ts` に保持(将来の再開ルートを残すため)
- EEF はパーサ自体を作らず、編集者が `eef.org.uk` を週次で確認
- 週次ダイジェスト編集時に、OECD / EEF から重要記事 1〜2 件を **編集者が手動で抜粋**

### 再開判断のタイミング

Sprint 3 以降に、必要が出てきたら **A)** の Workers プロキシ方式を検討する。MVP 段階では実装しない。

## 帰結

### 良い帰結

- 不安定な自動収集を本番から外したことで、cron job の失敗率が下がる
- パーサ雛形を残したため、再開時のリスタートが容易
- 編集者の手動運用を週次ダイジェスト時に集約することで、日次の運用負荷は変わらない
- 「自動化できないものは無理に自動化しない」という MVP 原則の維持

### トレードオフ

- OECD / EEF の重要記事を **取りこぼすリスク**(編集者の確認頻度に依存)
- 一次情報層から 2 ソースが抜けるため、第 1 層の記事数が当初想定より少ない
- ダイジェスト編集時の運営者工数が増える(週 5〜10 分の追加作業を見込む)

## 撤回 / 再検討の条件

- OECD / EEF が公式 API を提供した場合
- Cloudflare Workers プロキシで安定取得できる目処が立った場合(Sprint 3 以降に検討)
- 編集者の手動拾いで取りこぼしが目立つ実績が出た場合
