# 0020. 削除した記事 ID の永続追跡 + 再取り込み防止

- 状態: 採用
- 日付: 2026-05-02
- 関連 ADR: 0007(第 2 層を教育専門紙へ転換)、0018(対象読者を学校教員・教育関係者に統一)、0019(対象読者の遡及適用とリセマム NG ワード再設計)
- 関連 PR: TBD(本 ADR の実装)

## 背景

ADR 0019(2026-05-01)で対象読者を「学校教員・教育関係者」に統一する遡及削除と NG ワード再設計を実施した(PR #67、resemom 38 件削除)。しかし採用後の運用で構造的な穴が判明した:

- PR #67 マージ後の cron 実行 #68(2026-05-01 22:39)/ #70(2026-05-02 09:52)で、**削除済みの記事 6 件が main に復活した**
- 復活した ID:
  - `resemom-2026-04-27-64b4863bff8a7c76`(ちばみんフェス、芸術や体験イベント)
  - `resemom-2026-04-30-78d03ddef4d65273`(東京経済大シンポ、参加無料)
  - `resemom-2026-05-01-0e6a98e8578cb3af`(重田教育財団「海外留学奨学金」5 名募集)
  - `resemom-2026-05-01-58eb6c5f6f62252c`(大学生への仕送り、家賃抜き平均 3.3 万円)
  - `resemom-2026-05-01-a07114858c201c20`(朝日新聞「学びテスト」7/12 小 3 対象)
  - `resemom-2026-05-01-f901acc035e2fe23`(立命館大、地域交流イベント、万博体験)
- 原因は dedupe ロジック(`src/lib/dedupe.ts` の `dedupeAgainstHistory`)が **「現状の article JSON + 過去 30 日履歴」しか参照しない** こと。一度 main から削除した記事の ID は履歴照合の対象外になり、RSS が再配信した瞬間に新規記事として取り込まれる
- ADR 0019 の NG ワード再設計は ADR 0019 §「検証結果」で 27/34(79%)の自動捕捉を確認したが、**残り 7 件は「汎用イベント語彙で正規化困難 → editor review に委ねる」とされた**。今回復活したのはまさにその 6 件で、editor review が cron に追従できないという運用ギャップが顕在化した

これは ADR 0019 の不備というより、「将来の RSS 再配信に対する永続防御層が dedupe レイヤーに存在しない」というアーキテクチャ上の構造的バグ。今後 NG ワードを増やしても、新たな「取りこぼし」が出るたびに同じ復活が起きる。

## 検討した選択肢

### A. 永続 denylist(`src/data/excluded-article-ids.json`)+ narrow NG パターン追加(採用)

メリット:
- **構造的解決**: NG ワードの取りこぼしと無関係に、「過去に削除した ID」は cron 保存前に確実に弾ける
- **監査ログ**: `reasons` フィールドで「なぜ除外したか」が JSON 上に永続化され、git 履歴で追跡できる
- **NG ワードの育成と独立**: NG ワードは「将来の同種記事」を弾く役割、denylist は「過去に削除した特定記事の復活」を防ぐ役割と責務分離できる
- **検証容易**: `npm run check:excluded-ids` で「denylist の ID が article JSON に残っていないか」を CI で検知可能

デメリット / 緩和策:
- denylist が単調増加する → 数千件規模になっても JSON ファイルの読み込みコストは無視可能、半年運用後に D1/KV 移行と同タイミングで形式見直し
- ADR 0019 と責務が二重化する → 本 ADR で「NG ワード = 将来の同種記事抑止」「denylist = 過去 ID の復活防止」と明確化

### B. 過去履歴の lookback を 30 日 → 365 日に拡張(却下)

却下理由:
- ストレージ層で削除した記事は履歴 JSON にも残らないため、lookback 拡張では復活を防げない
- そもそも「削除済み」の真実を追跡する仕組みが存在しない問題は解決しない

### C. soft delete(Article schema に `excluded: true` フラグを追加)(却下)

却下理由:
- ADR 0019 §B と同じ理由(schema 変更の影響範囲、D1 移行への足枷)
- 削除記事を JSON 上に残し続けるとサイト一覧の検索 / SSG ビルドにも保持され、ノイズになる

### D. NG ワード追加のみで対応(却下)

却下理由:
- ADR 0019 で「7 件は汎用語彙で正規化困難」と判断済み。同じ手段を強化しても同じギャップが残る
- 将来の取りこぼしには対応できないため、構造的解決にならない

## 決定

A を採用。

### (1) `src/data/excluded-article-ids.json`(永続 denylist)

```json
{
  "schemaVersion": 1,
  "ids": [
    "resemom-2026-04-27-64b4863bff8a7c76",
    "resemom-2026-04-30-78d03ddef4d65273",
    "resemom-2026-05-01-0e6a98e8578cb3af",
    "resemom-2026-05-01-58eb6c5f6f62252c",
    "resemom-2026-05-01-a07114858c201c20",
    "resemom-2026-05-01-f901acc035e2fe23"
  ],
  "reasons": {
    "resemom-2026-04-27-64b4863bff8a7c76": "ADR 0019 §A 親子・体験イベント...",
    ...
  }
}
```

スキーマ:
- `schemaVersion: 1`(将来の D1 移行 / 形式変更の互換管理)
- `ids: string[]`(`Article.id` と同形式の正規表現で validate)
- `reasons: Record<id, string>`(全 ID に必須、監査用)

ローダー: `src/lib/excluded-ids.ts` で Zod validate + 重複検出 + 全 ID への reason 紐付け検証。

### (2) `scripts/fetch-news.ts` に denylist フィルタ層を追加

処理順:
```
1. fetch
2. normalize + categorize
3. dedupeWithin
4. dedupeAgainstHistory
5. ★ filterByDenylist(denylist) ← 新規追加
6. mergeDay(保存)
```

dedupe の後・保存の前にフィルタすることで、denylist にある ID は永続的に弾ける。ログで「なぜ弾いたか」(reasons)を表示し、運用観測性を確保する。

### (3) `src/lib/sources/resemom.ts` の NG_PATTERNS に narrow パターン追加

復活 6 件を parser 段階でも弾けるように narrow パターンを追加:

| パターン | 捕捉対象 |
|---|---|
| `/海外留学.{0,10}奨学金/` | 「海外留学奨学金」「海外留学・奨学金」 |
| `/小[1-6](?:対象\|向け)/` | 「小 3 対象」「小 5 向け」(個別学年向け参加募集) |
| `/\d+名募集/` | 「5 名募集」「10 名募集」(個別参加者募集) |
| `/地域交流イベント/` | 立命館大型の地域交流イベント |
| `/シンポ.{0,5}参加無料/` | 一般公開シンポ + 参加無料の組合せ(教員向け学術シンポは弾かない) |

これらは ADR 0019 で「汎用語彙で困難」と判断した語彙だが、復活 6 件のタイトルに対して二語の組み合わせで正規化可能と再判断した。

### (4) `scripts/check-excluded-ids.ts`(検証スクリプト)

`npm run check:excluded-ids` で以下を検証し、CI で常時監視できる:
- denylist JSON が `ExcludedIdsFile` スキーマ通り
- denylist にある ID が article JSON に残っていない
- 全 ID に reason が登録されている

### (5) `scripts/check-resemom-filter.ts` にケース追加

復活 6 件のタイトルが新パターンで弾かれることを assertion で固定。NG パターンの回帰防止。

### (6) 既存 article JSON から 6 件を物理削除

`2026-04-27.json`(-1)/ `2026-04-30.json`(-1)/ `2026-05-01.json`(-4)。ADR 0019 と同じくハード削除(git 履歴で監査可能)。

## 影響と運用

### Denylist 運用フロー(今後の再発時)

「対象読者外と判明した記事」が cron で取り込まれた場合:

1. 該当 ID を `src/data/excluded-article-ids.json` の `ids` に追加
2. 同 ID の `reasons` に削除根拠(ADR 0019 のカテゴリ + 該当パターン or 編集判断)を記録
3. article JSON からも物理削除
4. 必要なら `resemom.ts` の NG_PATTERNS に narrow パターンを追加し `check:filter:resemom` にケースを追加
5. `npm run check:excluded-ids` でグリーンを確認

### 責務分離(NG ワード vs denylist)

| レイヤー | 役割 | 失敗時の影響 |
|---|---|---|
| `resemom.ts` NG_PATTERNS | 「将来流入する同種記事」を parser 段階で弾く | 取りこぼしがあれば denylist で最終ガード |
| `excluded-article-ids.json` denylist | 「過去に削除した特定 ID の復活」を保存前に弾く | 既存削除済み記事の永続防衛、追加コストほぼゼロ |

### 残タスク(別 PR で対応)

- ~~復活防止の e2e 監視を `weekly-health-check.yml`(設計書 §6.4 で予定)に組み込む(denylist の ID が article JSON に出現したら GitHub Issue を起こす)~~ → `.github/workflows/health-check.yml` を新設(`pull_request` / `push: main` / 週次 cron で `npm run check:excluded-ids` を実行、cron 失敗時のみ Issue 起票・既存 Issue へのコメント集約)
- NG ワード再設計の継続(ADR 0019 §「残り 7 件」のうち denylist で塞いだ 6 件を除く 1 件は次回観測時に追加判断)

## 参考

- 復活確認の証跡: `2026-05-02` セッションで `src/data/articles/2026-04-27.json` / `2026-04-30.json` / `2026-05-01.json` を grep し、PR #67 で削除した 6 ID が main に存在することを確認
- 該当 cron: PR #68(2026-05-01 22:39 JST)/ PR #70(2026-05-02 09:52 JST)
