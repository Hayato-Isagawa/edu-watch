# 0015. mext 教育スコープフィルタ導入と既存データのリンク切れ・重複クリーンアップ

- 状態: 採用
- 日付: 2026-04-30
- 関連 PR: TBD(本 ADR の実装)

## 背景

Sprint 4 の運用観察(初回ダイジェスト編集時)で、`src/data/articles/` の品質に 3 種類の問題が見つかった:

1. **mext の教育スコープ外混入**: 文部科学省は教育以外(科学技術 / 宇宙 / 文化 / 大学経営研究 / 統計業務 / 産業 / 大臣会見など)も発信する省庁で、現状の `mext.ts` parser は全件採用方針(コメント記載)。結果、H3 ロケット失敗、AI for Science 推進委員会、ジオパーク認定、量子ビーム施設、NISTEP 統計、創発的研究支援事業、研究振興局採用情報など、edu-watch のスコープ(教員・保護者向け教育)から外れる記事が 45 件中 26 件(58%)を占めていた
2. **リンク切れ(404)**: nier の URL 構造変更(`/02_news/...` → `/...`)で旧 URL 記事が 3 件 404 化、文科省が同じ議事録を URL 変更で再公開し古い URL を 404 化したケースが 4 件、計 7 件
3. **タイトル更新版の重複**: nikkyo が同じ URL の記事タイトルを更新したケースが 1 件(初観測 4-22 と更新版 4-27 が両方残存)

これらは Sprint 2 設計書 §6(編集ポリシー)の「正確な情報を読者に届ける」観点から看過できない。

## 検討した選択肢

### A. mext フィルタを allowlist 中心に導入(採用)

`isMextEducationRelevant(title, summary)` を `mext.ts` に追加し、

1. 明示除外(`EXPLICIT_EXCLUDE_PATTERNS`)に当たれば即除外
2. 教育インクルード(`EDUCATION_INCLUDE_PATTERNS`)に当たれば採用
3. どちらにも当たらない場合はデフォルト除外(allowlist 寄り、安全側)

文科省は文部科学省全体の発信を集約する RSS でサブカテゴリ別 RSS が公開されていないため、parser 層で絞るのが現実的。allowlist 寄りにすることで、新しい教育外トピック(例: 新規の科学技術委員会など)が将来追加されても自動的に除外される。

加えて、ユーザー指示(2026-04-30)を踏まえ、少子化・国際的人口移動の文脈を取り込むため `留学 / 外国人児童生徒 / 日本語教育 / 帰国生 / 多文化共生` をインクルードに追加。

### B. 全媒体に共通の教育キーワードフィルタを適用(却下)

resemom の `isExcludedByTitle()`、kyodo の `isEducationRelated()` と同じ流儀で全媒体に共通フィルタを適用する案。

却下理由: nikkyo / kkn / chukyo / nier は媒体自体が教育専門で、フィルタは不要(過剰除外で重要記事を弾くリスク)。問題は mext のみに局所化されている。

### C. mext のサブカテゴリ別 HTML スクレイピング(却下)

mext の `/a_menu/shotou/` などサブカテゴリ別 HTML を直接スクレイピング。

却下理由: 実装コスト中で、HTML 構造変更時のメンテナンスコスト増。フィルタ方式で十分な精度が出るので過剰実装。

## 決定

A を採用。`mext.ts` に教育スコープフィルタを追加し、加えて既存データに以下のマイグレーションを一度きり実施する:

1. `scripts/clean-mext-off-scope.ts`: `isMextEducationRelevant()` を当てて mext 記事 26 件を削除(全 45 件 → 19 件)
2. `scripts/clean-broken-and-duplicates.ts`: リンク切れ 7 件 + nikkyo タイトル更新版重複 1 件 = 計 8 件を削除

合わせて、運用上の定期点検用に検証スクリプト 3 種を残す:

- `scripts/check-filter-mext.ts`: mext 記事を新フィルタに通したときの kept / dropped を表示
- `scripts/check-duplicate-links.ts`: `(sourceId, sourceUrl)` キーでの重複(same-day / cross-day)を検出
- `scripts/check-broken-links.ts`: 全記事の sourceUrl を並列 HEAD でステータス確認、4xx/5xx を抽出

## 影響

実測の数値変化:

| 指標 | クリーンアップ前 | 後 |
|---|---|---|
| 全記事 | 210 | **176** (-34) |
| mext | 45 | 17 |
| nier | (旧 URL 含む) | 旧 URL 削除済 |
| 重複・リンク切れ | 7 + 1 = 8 件 | 0 |

新規取り込み: cron が次回回ったとき、mext のスコープ外記事はフィルタで弾かれて取り込まれない(`isMextEducationRelevant()` で false 時にスキップ)。

副作用なし: ADR 0010(`mergeDay` は既存 id を上書きしない)と本マイグレーションは別概念(本マイグレーションは「公開ページに表示すべきでない記事を削除」、外部由来 collectedAt は触らない)。

## 撤回 / 再検討の条件

- 教育インクルードキーワードに **「これも教育トピックだ」と判断される語が増えた** 場合 → `EDUCATION_INCLUDE_PATTERNS` を追加
- 明示除外に false positive(教育記事を誤除外)が観察された場合 → `EXPLICIT_EXCLUDE_PATTERNS` を緩和
- 文科省が **教育サブカテゴリ別 RSS** を公開した場合 → C(サブカテゴリ別スクレイピング)に切り替えてフィルタ自体を撤廃
- リンク切れ・重複が運用上頻発する場合 → cron 終端に `check-broken-links` を組み込んで自動 Issue 化

## 補足

nikkyo / nier の重複は **媒体側のサイト構造に起因** する性質のもの:

- nikkyo: 同 URL でタイトルだけ更新するケース → 後発の取り込みで `mergeDay` がスキップする(ADR 0010)が、初観測のレコードはタイトルが古いまま残る
- nier: セクションページ URL を別記事に流用するケース(`26chousa/26chousa.html` に学力調査の科目別ページが入れ替わる)→ 別 id で別記事として正しく取り込まれる(削除しない)
- mext: 同記事を URL 変更で再公開するケース(議事録 mext_00012 → 13 → 14)→ URL ハッシュが変わるので別 id、古い URL は 404 になる

これらは parser 層では完全には防げないため、**運用上の定期点検**(`check-broken-links` / `check-duplicate-links`)で検出する方針とする。
