# 0022. nikkyo paywall 後付け化への追従(再判定 cron)

- 状態: 採用
- 日付: 2026-05-02
- 関連 ADR: 0010(mergeDay は既存 id をスキップし collectedAt を初観測時刻で固定する)、0013(日本教育新聞の会員限定記事を判別し、UI 上で予告する)、0021(nikkyo paywall 判別マーカーの OR 化と表現の正確化)
- 関連 PR: TBD(本 ADR の実装)

## 背景

ADR 0021 採用直前(2026-05-02)に、直近 nikkyo 30 件すべてを直接フェッチして再判定したところ、**15 件(50%)が現時点で paywall 化** されていることを実測した。一方で article JSON 上はすべて `requiresMembership=undefined` のまま。これは「公開直後は無料、後日 paywall 化される」運用が日教側にあり、cron 取り込み時点では paywall マーカーがないため、現行 parser では検出されないことを意味する。

ADR 0013 §影響「既存記事には適用されない」(= 取り込み後に paywall 化されても追従しない)は実害として顕在化した:

- 直近 30 件のうち 15 件は読者が「無料記事」と思って開くが、媒体側で paywall に当たる
- 「電子版会員のみ」バッジが付かないため事前予告ができない(ADR 0021 で文言は正確化したが、対象記事が広がらない)
- ADR 0021 の OR 化マーカーは新規取り込み時のみ効き、既存 JSON は救えない

ADR 0010 は「`mergeDay` は既存 id を上書きしない、後からの修正には追従しない」方針を採った。これは title / summary / categories / collectedAt などの一般フィールドに対しては妥当だが、`requiresMembership` は **「無料 → paywall への一方向遷移を時間遅れで反映したい」** という性質のフィールドで、ADR 0010 の包括的な禁止と合致しない。

## 検討した選択肢

### A. 専用スクリプト + 専用 cron + `applyMembershipUpdates` で限定例外(採用)

メリット:
- ADR 0010 の本体ロジック(`mergeDay`)を変更しない。一般フィールドの後付け更新は引き続き禁止
- `applyMembershipUpdates(date, Map<id, true>)` で「`requiresMembership: undefined/false → true` の片方向遷移のみ」を型で表現可能(`Map<string, true>` で false が入らない)
- `recheck-nikkyo-membership.ts` を `fetch-news.ts` と分離し、独立 cron(週次)でスケジュールできる
- 既存 fetch-news.yml の責務を膨張させない

デメリット / 緩和策:
- cron / workflow が 1 つ増える → 既存 fetch-news.yml の PR フローを踏襲することで運用慣れを再利用、bot コミット規約も同じに揃える
- 並列 fetch でレート制限のリスク → 並列度 5、タイムアウト 8s、5xx / abort はスキップ(false にダウングレードしない)で礼儀運用

### B. `mergeDay` を拡張して「許容フィールド一覧」をオプションで受け取る(却下)

却下理由:
- ADR 0010 の意図が薄まる(他フィールドへの後付け更新リクエストを「許容リスト追加で対応する」という拡張圧力が常に働く)
- 責務分離が崩れる(取り込み時の通常パスと再判定時の特殊パスを 1 関数で両立すると、テスト難度が上がる)

### C. fetch-news.ts に再判定ステップを統合(却下)

却下理由:
- fetch-news.yml の cron 頻度(JST 07:00 / 18:00 = 日 2 回)で再判定すると無駄に重い(最新 30 日 × 30 件超)
- 取り込み失敗と再判定失敗が同じジョブで巻き添えになる
- 独立スケジュールが組めない(週次 vs 日 2 回)

### D. 静的サイトのレンダリング時に毎回 fetch して動的判定(却下)

却下理由:
- Cloudflare Pages の SSG 構成と合わない、レイテンシ大
- 日教サイトに対する負荷が時間帯で偏る

### E. `firstCollectedAt` フィールドを追加して時系列を保つ(却下)

却下理由:
- ADR 0010 §C と同じく schema 変更コストが大きい
- 必要なのは「過去記事の paywall フラグ更新」であり、観測時系列を保つことではない

## 決定

A を採用。

### (1) `applyMembershipUpdates(dataDir, yyyyMmDd, updates: Map<id, true>)`

`src/lib/storage.ts` に追加。

- `requiresMembership: undefined/false → true` の片方向遷移のみ許容
- 既に `true` の記事は no-op
- 該当 id が当該日付ファイルに存在しない場合は黙ってスキップ
- 並び順 / 整形(publishedAt 降順 / 2-space JSON / trailing newline)は `mergeDay` と統一
- 戻り値: `{ changed: number, total: number }`

`Map<string, true>` 型で「true 以外は受け付けない」ことを型で固定。

### (2) `scripts/recheck-nikkyo-membership.ts`

- 直近 `LOOKBACK_DAYS=30` 日の article JSON を `loadRange` で読み込む
- `sourceId === "nikkyo"` かつ `requiresMembership !== true` の記事を抽出
- 並列度 `PARALLELISM=5` で URL を fetch、`<article>` スコープを抽出
- `detectMembershipFromArticleScope()`(ADR 0021 で nikkyo.ts から export 済)で判定
- true になった id を日付ごとにグループ化し、`applyMembershipUpdates` で書き戻す
- 5xx / タイムアウト / ネットワーク障害は当該記事をスキップ(false にダウングレードしない)

### (3) `.github/workflows/recheck-nikkyo-membership.yml`

- cron: 週次(火曜 JST 06:00 = UTC 月曜 21:00)+ `workflow_dispatch`
- bot ブランチ `chore/recheck-nikkyo-<timestamp>` に commit → PR 作成 → `gh pr merge --auto --squash --delete-branch`
- ラベル `recheck-membership`(色 `ededed`)を冪等に作成
- 既存 fetch-news.yml と同じパターンを踏襲

### (4) ADR 0010 との整合

ADR 0010 §A の「mergeDay は既存 id を上書きしない」は維持。本 ADR は **`mergeDay` 経路ではなく `applyMembershipUpdates` という別の限定的な経路で `requiresMembership` のみ更新する** という形で例外を作る。

ADR 0010 が禁じた一般フィールド更新(title / summary / categories / collectedAt 等)は引き続き禁止。本 ADR の例外は以下に限定:

| フィールド | 遷移 | 許容 |
|---|---|---|
| `requiresMembership` | undefined / false → true | ✅(本 ADR) |
| `requiresMembership` | true → false / undefined | ❌(paywall 解除は通常起きない、起きた場合は別 ADR で再検討) |
| 他フィールド | 任意の更新 | ❌(ADR 0010) |

## 影響と運用

### 初回ロールアウト

マージ後の最初の cron(火曜 JST 06:00)で、過去 30 日分の nikkyo 候補(現時点で約 15 件と推定)が `requiresMembership=true` に更新される。これにより:

- トップページ / 媒体別 / カテゴリ別ページ / 検索結果に **「電子版会員のみ」バッジが約 15 件追加** される
- 読者が壁にぶつかる事故が減る
- 過去 30 日を超える古い記事は対象外(今後の運用で重要なら lookback 拡張を別 PR で検討)

### 監視と運用

- `recheck` cron の失敗は GitHub Actions の通常通知で観測
- 並列フェッチで日教サーバが 429 / Cloudflare ブロックを返した場合は `skipped` ログで検出可能。連続発生時は並列度の引き下げや間隔導入を検討
- skipped 件数が極端に多い時は `workflow_dispatch` で手動再実行

### 別媒体への波及

ADR 0013 と同様、kkn / kyodo 等で paywall 後付け化が観測されれば、`detectMembershipFromArticleScope` を `src/lib/membership.ts` に共通化し、`recheck` 対象を `sourceId in ["nikkyo", ...]` に拡張する。本 ADR の実装は nikkyo 専用に閉じる。

## 撤回 / 再検討の条件

- 日教が paywall を撤廃 or 全記事 paywall に倒す → 本 cron は実質無意味になり停止候補
- `recheck` 走行が日教サーバへの負荷源になる兆候(429 連発・ブロック)→ 並列度を下げる、頻度を週次から隔週に下げる、間隔導入
- `applyMembershipUpdates` を他フィールドにも展開したい要件が複数発生 → 共通化と「許容遷移リスト」の明文化を別 ADR で検討

## 残タスク(別 PR / 観測タスク)

- 初回ロールアウト後 1 週間で更新件数の実測値を観測し、推定値(~15 件)とのズレを把握
- lookback days 30 → 60 / 90 への拡張が有効かどうかは、初回後の運用観測で判断
- `firstPaywalledAt` フィールド(初観測 paywall 時刻)の追加が分析価値を持つかは、運用一定期間後に判断(現状は schema 変更コストに見合う必要性なし)
