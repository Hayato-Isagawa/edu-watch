# 0010. mergeDay は既存 id をスキップし collectedAt を初観測時刻で固定する

- 状態: 採用(PR #18 で導入された `mergeDay` の上書き挙動を是正)
- 日付: 2026-04-27
- 関連 PR: #18(初版実装)、TBD(本 ADR の実装)

## 背景

Sprint 2 完了後の初回 cron(2026-04-26 22:26 UTC = JST 04-27 07:26、PR #24)で `src/data/articles/` を観察したところ、`2026-01-30.json` などの古い日付ファイルにも記事が追記されていた。

調査の結果、挙動そのものは設計通り(NIER などの RSS が古い `publishedAt` の記事を最新フィードに含めて配信し、保存先ファイルが `publishedAt` の日付ベースのため、結果として古いファイルに追記される)。記事の id 重複は実測ゼロ件で、dedupe は機能していた。

ただし `src/lib/storage.ts:65` の `mergeDay` 実装が以下のように既存 id でも上書きする構造になっていた:

```ts
for (const a of newArticles) {
  if (!byId.has(a.id)) added++;
  byId.set(a.id, a);   // 既存 id でも上書き
}
```

`dedupeAgainstHistory` は過去 30 日窓でしか履歴突合しないため、30 日を超えた古い記事(例: 1月公開の記事を 4月末に再観測)は履歴突合をすり抜け、`mergeDay` で `collectedAt` を含めて上書きされる。結果として:

1. `collectedAt` が「初観測時刻」ではなく「最終再観測時刻」になり、初観測日の歴史情報が失われる
2. RSS が同じ古い記事を返し続ける限り cron が走るたびに当該ファイルが書き換わり、git commit がノイズで膨らむ
3. ファイル mtime が毎日更新され、運用者から「同じ記事が再取得されているように」見える

## 検討した選択肢

### A. 既存 id を mergeDay でスキップする(採用)

`if (byId.has(a.id)) continue;` で既存 id を弾き、`collectedAt` を初観測時刻で固定する。実装の差分は数行で、dedupe の意図(コメント記載の「同一記事は再保存しない」)と実装を一致させる。

副作用: 一度保存した記事の summary / title / categories などが後から修正されても、その変更は edu-watch には追従されない。

### B. dedupeAgainstHistory の lookback を無制限化

`loadRange` の窓を全期間に拡張し、history 突合の段階で全ての既出 id を除外する。

却下理由: ファイル数が増えると毎回の cron で全期間ロードが走り、I/O とメモリが線形に増える。MVP の JSON ファイル方式とは相性が悪く、Phase 2 で D1 / KV へ移行するまで延命する設計と矛盾する。

### C. `firstCollectedAt` フィールドを新設

`collectedAt`(最終観測時刻)と `firstCollectedAt`(初観測時刻)の両方を保持する。

却下理由: schema 変更が要り、初観測情報が要るのは現状の用途では未確認。MVP 段階の複雑化として時期尚早。

## 決定

A を採用する。`src/lib/storage.ts:65` の `mergeDay` を以下に置き換える:

```ts
for (const a of newArticles) {
  if (byId.has(a.id)) continue;
  byId.set(a.id, a);
  added++;
}
```

## 影響

- `collectedAt` は記事を初めて観測した時刻で固定される
- 古いファイルの `mtime` 更新が止まり、git commit のノイズが減る
- 共同通信のような速報→確定版の更新追従は失われる(MVP では許容、必要になれば将来 sourceId 単位の例外を検討)
- 既存のデータ(98 件の url:null 問題、初回 cron で書き込まれた `collectedAt`)はそのまま残置。本 ADR の修正以降に追加される記事から新ポリシーが効く

## 補足

本 ADR では url:null 問題(各 parser が canonical_url を抽出できないケースが 98 件存在)には踏み込まない。これは別 PR で parser ごとに調査・修正する。
