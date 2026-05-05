# 0035. kyodo を Tier 1/2 自動収集から Tier 3 参考のみへ降格

- 状態: 採用
- 日付: 2026-05-05
- 関連 PR: 本 ADR と同一 PR で確定
- 起点 ADR: 0003(三層ソース運用方針)/ 0007(Tier 2 を大手紙から教育専門紙へ転換、共同通信を Tier 2 に追加)
- 撤回 / 再検討トリガー: ADR 0007 末尾「共同通信の `/culture/feed/` の教育記事比率が大きく低下した場合」の発動

## 背景

ADR 0007(2026-04-25 採択)で Tier 2 に共同通信(`/culture/feed/`)を採用した時点では、教育記事比率を約 30%(日 1〜2 本相当)と見積もっていた。Sprint 2 完了後の運用観察で、想定に対する乖離が継続的に観測されていた。

### 観測実績(2026-04-26 〜 2026-05-05、本番収集ログ)

直近 30 日のうち、`src/data/articles/YYYY-MM-DD.json` に kyodo 記事として保存されたのは **1 件のみ**(2026-04-27、通信制高校紹介)。直近 9 日(2026-04-28 〜 2026-05-05)は連続 0 件。フェッチ自体は成功しており(`[fetch-news] kyodo ok: 0 articles`)、エンドポイント・パーサ・フィルタの障害ではなく、配信元コンテンツが教育スコープに合致していない構造的事象である。

### 原因切り分け(2026-05-05 実施)

#### A. フィルタ単体テスト

`scripts/check-kyodo-filter.ts` を実行。`isEducationRelated()` の 14 ケース全 pass、ロジック異常なし。EDUCATION_PATTERNS(`教育` / `学校` / `児童` / `生徒` / `教員` / `教師` / `大学` / `入試` / `学習指導要領` / `いじめ` / `不登校` / `奨学金` / `文部科学`)は意図通りに機能している。

#### B. kyodo の他フィードエンドポイント網羅調査

`https://www.kyodo.co.jp/` 配下の主要カテゴリフィードを実調査した結果:

| エンドポイント | items | 教育キーワード hit | 中身 |
|---|---|---|---|
| `/feed/`(全社) | 10 | 2 | **両方とも誤検出**(TV 番組紹介・ドラマ評で「生徒」「不登校」が娯楽文脈で使用) |
| `/culture/feed/`(現在使用中) | 10 | 1 | **チャネル名タイトルのみ**、記事タイトル hit ゼロ |
| `/education/feed/` | 0 | 0 | 存在しない(空応答) |
| `/society/feed/` | 0 | 0 | 存在しない(空応答) |
| `/national/feed/` | 0 | 0 | 存在しない(空応答) |
| `/life/feed/` | 10 | 0 | くらし記事のみ |

ADR 0007 採択時の前提「`/culture/feed/` 教育比率約 30%」は実情と乖離しており、共同通信は機械可読 RSS で edu-watch のスコープ(学校教育・教育政策・教員働き方)に該当する記事を実質配信していない。

## 検討した選択肢

### A) Tier 3(参考のみ)へ降格(採用)

- `src/lib/sources/index.ts` の `sources` 配列から `kyodo` を除外し、自動収集対象から外す
- `src/lib/source-meta.ts` の `kyodo.layer` を `2` → `3` に変更
- `src/lib/sources/kyodo.ts`(parser 本体)/ `scripts/check-kyodo-filter.ts` / `scripts/smoke-fetch-kyodo.ts` は残置
- 週次ダイジェスト編集時に編集者が共同通信 web を手動参照する余地を残す(ADR 0003 が定める Tier 3 の運用に統合)
- 将来 kyodo が `/education/feed/` のような教育専用フィードを新設した場合、`sources` 配列への再追加と `layer: 2` への戻しのみで復活可能

### B) 完全削除

- `kyodo.ts` / 関連テスト / `source-meta.ts` のエントリを削除
- 復活時の実装コストが大きい
- ADR 0007 の歴史的経緯が辿れなくなる
- **不採用**

### C) 観察を 1 週間延長

- 直近 9 日連続 0 件で構造的問題が確定しているため、追加観察は判断を遅らせるだけ
- **不採用**

## 結論

選択肢 A を採用する。本 ADR と同一 PR で以下の最小実装を行う:

1. `src/lib/sources/index.ts` の `sources` 配列から `kyodo` を除外(import / re-export は残す)
2. `src/lib/source-meta.ts` の `kyodo.layer` を `2` → `3` に変更
3. parser 本体 / フィルタテスト / smoke スクリプトは残置
4. `src/lib/source-meta.ts` で `SourceTier = SourceLayer | 3` を導入し、`SourceMeta.layer` を `SourceTier` に切り替え。`Article.layer` / `SourceParser.layer` は `SourceLayer (1|2)` のままに保ち、「自動収集対象の Tier 1/2」と「媒体メタデータの 1/2/3」の責務を分離する
5. `src/pages/sources/[sourceId].astro` の `tierLabel` に Tier 3 ケース(`Tier 3 — 参考のみ`)を追加

過半数失敗 exit 1 ロジック(`scripts/fetch-news.ts`)は `sources.length` を基準にしているため、配列から外れば自動的に閾値が 7→6 媒体ベースで調整される。閾値ロジック自体の変更は不要。

## 影響と運用上の含意

### Tier 2 主軸の再確認

ADR 0007 で確立した Tier 2 のうち、以下が引き続き自動収集の主力となる:

- `resemom`(リセマム): 保護者向け一次情報のうち教員視点で関連するもの(NG パターン経由)
- `nikkyo`(日本教育新聞): 教員向け、全件採用
- `kkn`(教育家庭新聞): 教員 + 保護者向け、全件採用

### 編集者の運用

共同通信の教育系記事は週次ダイジェスト編集時に web を手動参照する。Tier 3 として `https://www.kyodo.co.jp/news/` を編集者の参考対象に明示する(ADR 0003 の Tier 3 定義に準拠)。

### 残置コードの位置づけ

`src/lib/sources/kyodo.ts` / `scripts/check-kyodo-filter.ts` / `scripts/smoke-fetch-kyodo.ts` は将来の復活余地として残置する。メンテコストは事実上ゼロ(自動収集パイプラインから外れているため失敗してもパイプライン全体に影響しない)。

## 撤回 / 再検討の条件

- 共同通信が `/education/feed/` のような教育専用 RSS を新設し、教育スコープの記事が継続的に流れるようになった場合
- `/culture/feed/` の編集方針が変わり、教育比率が ADR 0007 採択時の前提(約 30%)に近い水準まで回復した場合
- 別経路(API / NewsML 等)で共同通信の教育記事を機械的に取得する許諾が得られた場合

いずれの場合も、最低 14 日の観察期間で採用率を再評価した上で `sources` 配列に再追加し、`layer: 2` に戻す。
