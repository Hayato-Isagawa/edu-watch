# 0036. Tier 1 採用基準の緩和と OECD 公式ブログ feed の Tier 1 採用

- 状態: 採用
- 日付: 2026-05-06
- 関連 PR: 本 ADR と同一 PR で確定(実装は別 PR)
- 起点 ADR: 0003(三層ソース運用方針)/ 0007(Tier 2 を大手紙から教育専門紙へ転換)/ 0035(kyodo Tier 3 降格)
- 撤回 / 再検討トリガー: 本 ADR 末尾「撤回 / 再検討の条件」参照

## 背景

### Tier 1 が手薄である構造的事象

ADR 0035 で kyodo を Tier 3 へ降格したことを機に、Tier 1(一次研究 / 政府公式)媒体の採用実績を直近 30 日(2026-04-06 〜 2026-05-05)の保存ログ(`src/data/articles/*.json`、17 ファイル、計 186 件)で再点検した。

| 媒体 | 30 日 | 14 日 | 7 日 | 1 日平均(17 日中) | 役割 |
|---|---|---|---|---|---|
| mext | 32 | 32 | 14 | 1.88 | Tier 1 主力 |
| chukyo | 9 | 9 | 2 | 0.53 | Tier 1(会議依存・低頻度) |
| nier | 12 | 10 | 0 | 0.71 | Tier 1(発表依存・低頻度) |
| resemom | 16 | 16 | 3 | 0.94 | Tier 2(NG パターン経由) |
| nikkyo | 50 | 48 | 25 | 2.94 | Tier 2 主力 |
| kkn | 66 | 66 | 35 | 3.88 | Tier 2 主力 |
| ~~kyodo~~ | 1 | 1 | 0 | 0.06 | Tier 3 降格済(ADR 0035) |

構造的読み取り:

- **Tier 1 が 30 日で 53 件**、直近 7 日は mext + chukyo + nier 合計 16 件、うち nier は 0 件
- **Tier 2 屋台骨**: nikkyo + kkn で全記事の 62%(116 / 186)
- 記事総量は十分(1 日平均 11 件)で、過半数失敗閾値(`scripts/fetch-news.ts`)はクリア継続中

ADR 0003 が定める三層構造は「Tier 1 を一次情報の柱、Tier 2 を専門紙で補強、Tier 3 は手動参照」だが、現状の Tier 1 は数の上で Tier 2 に対し劣位にあり、週次ダイジェストの論点を一次研究側から組み立てる際の素材に乏しい。とりわけ mext の文書発表が落ち着く週は Tier 1 が事実上 chukyo と nier に依存し、両者とも会議・発表のサイクル次第では数日連続 0 件となる。

### ADR 0007 の宿題: OECD 教育 RSS

ADR 0007 採択時に「`https://search.oecd.org/rssfeeds/` の OECD 教育 RSS は将来 Tier 1 候補」として保留していたが、本セッション(2026-05-06)に general-purpose agent で実調査したところ:

| URL | 結果 |
|---|---|
| `https://search.oecd.org/rssfeeds/` | ECONNREFUSED(廃止確定) |
| `https://www.oecd.org/`(各教育トピック直下) | 403 Forbidden / bot 遮断、`<link rel="alternate">` 検出不可 |
| `https://www.oecd.org/education/` 系統 | 同上 |
| `https://oecdedutoday.com/feed/` | **稼働中**(WordPress 標準 `/feed/`、items 10 件、最新 2026-04 月分) |

`oecdedutoday.com` は OECD 教育・スキル局公式ブログで、主筆は Andreas Schleicher 局長(WebFetch で運営確認済)。OECD ドメイン直下ではなく公式運営の WordPress 別ドメインで、配信頻度は 2026-01〜04 月で月 2〜4 本(週 0.5〜1 件)。投稿内容は教育政策に関するオピニオン記事(PISA 結果分析、AI と学校教育、教員の専門性等)で、OECD 一次レポートそのものではないが、OECD の公式見解として一次性は高い。

### 国内 Tier 1 候補の機械可読フィード調査

OECD と並行して、国内 Tier 1 候補 10 媒体(教職員支援機構 NITS / ベネッセ教育総合研究所 / 国会文教委員会(衆参) / 国立教育政策研究所(nier 既収集分外)/ 経産省「未来の教室」/ 国立教育会館 ほか)を general-purpose agent でスクリーニングしたところ:

- **稼働 RSS は 0 件**(全候補で `<link rel="alternate">` 検出されず)
- 候補リストから除外: 経産省「未来の教室」(2026-03 運用終了)、国立教育会館(2001 年解散)
- 最有望 3 媒体(全てスクレイピング前提):
  1. **教職員支援機構 NITS** — 独法・一次性高・教員研修、静的 HTML で扱い容易
  2. **ベネッセ教育総合研究所** — 旧 RSS 廃止、自社一次調査(学力・保護者意識)発信
  3. **国会文教委員会(衆参)** — 一次情報性最高、Lotus Notes 由来 HTML で実装コスト高

国内側で Tier 1 を増やすには、現行の「RSS あり」前提を緩めない限り着手不能であることが確定した。

## 検討した選択肢

### A) Tier 1 採用基準を「RSS あり」から「RSS あり or 構造化スクレイピング可 + 一次情報性 High」へ拡張(採用)

- Tier 1 の採用基準を以下のいずれか満たすものに緩和する:
  - (a) 機械可読 RSS / Atom が公式に提供されている
  - (b) 静的 HTML で一覧ページが構造化されており、機械的に新着検出が可能
- いずれの場合も、**一次情報性 High**(後述の判定基準)を必須要件とする
- OECD `oecdedutoday.com/feed/` は (a) で適合、Tier 1 へ採用
- NITS / ベネッセ / 国会文教委員会は (b) の候補として後続 ADR で個別採否

### B) Tier 1.5 階層を新設し OECD を Tier 1.5 に置く(不採用)

- 一次研究そのもの(mext / chukyo / nier)と公式オピニオン(OECD 局長ブログ)の性格差を別階層で表現する案
- レイヤ構造が 1 / 1.5 / 2 / 3 と複雑化し、Tier 2 / 3 の意味が相対的に薄まる
- ADR 0003 の三層運用方針(Tier 1 一次情報 / Tier 2 専門紙 / Tier 3 参考のみ)に新階層を割り込ませることになり、サイト UI 側(`src/pages/sources/[sourceId].astro` の `tierLabel` 等)の改修範囲も広がる
- 性格差は階層ではなく媒体メタデータ側で表現すれば足りる(選択肢 A の `tier1Kind`)
- **不採用**

### C) Tier 1 を変更せず、OECD 政策レポートのみ Tier 3 手動キュレーション(不採用)

- Tier 1 採用基準は維持し、OECD 政策レポートを編集者が週次ダイジェスト編集時に手動参照する案(ADR 0003 の Tier 3 定義に準拠)
- 機械収集パイプラインに変更が入らないため実装コストはゼロ
- ただし、本 ADR の主動機である「Tier 1 媒体数の構造的不足」は解消されない
- 国内側の最有望 3 媒体(NITS / ベネッセ / 国会文教委員会)も RSS 未提供のため、(b) の道を開かない限り将来も Tier 1 拡充は不可能
- **不採用**

## 結論

選択肢 A を採用する。本 ADR と同一 PR では ADR ファイルの追加のみを行い、コード変更は別 PR(`feat(sources): adopt OECD edu today feed as Tier 1` 想定)で実装する。

### Tier 1 採用基準(改定後)

媒体が以下の **両方** を満たす場合に Tier 1 として自動収集対象に含める:

#### 1. 取得経路(いずれか満たす)

- **(a) 機械可読フィード**: 公式に提供される RSS / Atom / JSON Feed。`<link rel="alternate" type="application/rss+xml">` 等で検出可能、または公式ドキュメントに記載があるもの
- **(b) 構造化スクレイピング**: 静的 HTML の一覧ページが安定した DOM 構造を持ち、機械的に新着検出が可能。robots.txt が許可しており、配信元の利用規約に違反しないもの

#### 2. 一次情報性 High(必須)

以下を **すべて** 満たす:

- **発行主体**: 政府(省庁)/ 独立行政法人 / 国際機関 / 国公立研究機関 / 国会機関のいずれかであること
- **配信内容**: 一次データ(調査結果・統計・政策文書)、一次政策発信(審議会議事録・公式見解)、または当該主体が一次的責任を持つオピニオン(局長級以上の公式ブログ等)を主目的とすること
- **二次性の排除**: 他媒体の転載・要約・まとめを主軸にしないこと

二次媒体(教育専門紙 / 大手紙 / 出版社系メディア)は引き続き Tier 2 として扱う。

### Tier 1 内サブ分類: `tier1Kind`

`SourceMeta` に `tier1Kind?: 'primary' | 'official-opinion'` を新規追加し、Tier 1 媒体の性格を区別する:

- `'primary'`: 一次研究 / 一次政策文書を主目的とする媒体(mext / chukyo / nier)
- `'official-opinion'`: 公式機関の局長級以上が責任を負って発信するオピニオン(oecd)

サイト UI 側では当面この区別を表示しない(運用観察してから可視化を検討)。週次ダイジェスト編集時の参照優先度付け、および将来の Tier 1 拡充判断の材料として保持する。

### 採用する媒体: OECD `oecdedutoday.com/feed/`

- ID: `oecd`
- 名称: `OECD Education and Skills Today`
- Tier: 1(`tier1Kind: 'official-opinion'`)
- 言語: 英語
- 取得経路: (a) WordPress 標準 `/feed/`
- 一次情報性: High(国際機関 OECD 教育・スキル局公式ブログ、主筆 Andreas Schleicher 局長)
- 想定配信頻度: 週 0.5〜1 件

実装(parser / source-meta / sources index 登録 / 過半数閾値ロジック影響検証 / フロント言語ラベル検討)は本 ADR を起点とした別 PR で行う。

## 影響と運用上の含意

### Tier 1 媒体構成の変化

採用後の自動収集対象は **7 媒体**(mext / chukyo / nier / oecd / resemom / nikkyo / kkn)に戻る。kyodo Tier 3 降格(ADR 0035)で 6 媒体に減ったが、本 ADR 採択 + 実装で 7 媒体ベースとなる。

### 過半数失敗閾値ロジック

`scripts/fetch-news.ts` の過半数閾値は `sources.length` を基準にしているため、6 → 7 媒体で自動的に閾値が `4` のまま据え置かれる(7 媒体の過半数は 4)。閾値ロジック自体の変更は不要。実装 PR では媒体追加に伴う過半数判定の挙動を smoke スクリプトで再確認する。

### 英語コンテンツの混在

OECD は英語配信のため、サイト上で英語記事と日本語記事が混在する。実装 PR で以下を検討事項として持ち越す:

- 言語ラベルの UI 表示(`Article` 型に `lang?: 'ja' | 'en'` 追加検討)
- 記事カードでの英語コンテンツ識別子(バッジ等)
- 週次ダイジェスト編集時の英語要約方針

これらは本 ADR の射程外で、実装 PR または別 ADR で確定する。

### 国内 Tier 1 候補の後続 ADR

NITS / ベネッセ / 国会文教委員会の (b) ルートでの採用は、媒体ごとに以下を ADR 化したうえで個別実装する:

- robots.txt 確認結果と利用規約適合性
- 一覧ページの DOM 構造解析(2 週間以上の安定性観察)
- スクレイピング頻度と再試行戦略

最優先は NITS(独法・静的 HTML 扱い容易)、次点でベネッセ、中期計画として国会文教委員会(Lotus Notes 由来 HTML で実装コスト高)。

### `tier1Kind` の運用

本 ADR で `tier1Kind` を導入するが、当面は内部分類のみで UI には露出させない。3 ヶ月運用後に以下を再評価する:

- 編集者が週次ダイジェストで `tier1Kind: 'official-opinion'` 媒体をどの頻度で参照するか
- 読者にとって「一次研究」と「公式オピニオン」を区別する価値があるか
- 露出する場合の表現(バッジ / セクション分割 / 並び順制御)

## 撤回 / 再検討の条件

### OECD 採用の撤回トリガー

- `oecdedutoday.com/feed/` が 6 ヶ月以上 0 投稿になった場合 → Tier 3(参考のみ)への降格を検討
- WordPress 構成変更で feed エンドポイントが廃止 / URL 変更された場合 → 新エンドポイントへの追従、または採用取り下げ
- OECD ドメイン統合などで `https://search.oecd.org/rssfeeds/` 相当の正規 RSS が復活した場合 → そちらへ切り替え + `oecdedutoday.com` 採用継続の是非を再評価

### Tier 1 採用基準緩和の再検討トリガー

- (b) ルートで採用した媒体のスクレイピングが不安定で、運用負荷がメンテ可能ラインを越えた場合 → 基準を (a) のみへ戻すか、(b) の安定性要件を厳格化
- 一次情報性 High の判定で曖昧な事例が頻発した場合 → 判定基準の細目を追補 ADR で定義

### `tier1Kind` の再検討トリガー

- 3 ヶ月運用後の再評価で UI 露出の必要性が確認できなかった場合 → メタデータ自体の保持是非を判断(削除 / 継続 / 露出の三択)

## 補追(2026-05-06): 規約確認結果

本 ADR の初版は採用方針の確定に主眼を置き、OECD `oecdedutoday.com/feed/` および (b) ルート候補媒体の規約確認結果を未収録のままマージした(PR #97)。本セクションは PR #97 マージ直後のフォローアップとして、規約確認の事実関係と運用条件を追補する。

### OECD `oecdedutoday.com/feed/` 確認内容(2026-05-06 実施)

#### 1. `robots.txt`(全文、確認日 2026-05-06)

```
Sitemap: https://oecdedutoday.com/sitemap.xml
Sitemap: https://oecdedutoday.com/news-sitemap.xml
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

`User-agent: *` で `/feed/` への明示的な制限はなし。機械的取得は許可されている。

#### 2. RSS フィード本体の rights 表記

`https://oecdedutoday.com/feed/` の channel / item を確認した結果、`<copyright>` `<rights>` `<dc:rights>` `<atom:rights>` のいずれの権利表示要素も**未設定**。channel description は "Global perspectives on education and skills" のみ。

#### 3. ブログ自身の disclaimer(`https://oecdedutoday.com/disclaimer/`)

原文引用:

> The written material and information published on this blog do not necessarily represent the official views of the Organisation or of the governments of its member countries.

コメント運用ルールと個人情報の非開示方針のみで、**コンテンツ再利用 / 引用条件 / 帰属表示 / RSS 取得に関する記載はなし**。フッターには Terms / Privacy 専用ページなく、`/about/` `/terms/` `/privacy/` は未検証(存在を確認できていない)。

#### 4. OECD 本体規約

OECD 本体 `https://www.oecd.org/en/about/terms-conditions.html` は 403 で直接実取得不可。WebSearch 経由の二次情報では以下の整理:

- 2024-07-01 以降の OECD 単独所有コンテンツは **CC BY 4.0**
- それ以前は商用・非商用問わず引用形式 `[OECD (year), Title, URL]` で再利用可
- 改変時は OECD ロゴ・ビジュアル不使用 + 改変免責文言の追加が要求される

ただし、**この本体規約が `oecdedutoday.com` ブログ記事に直接適用される旨の明文記載は確認できていない**。

### 採用条件(本 ADR の運用ルール)

OECD `oecdedutoday.com/feed/` を Tier 1(`tier1Kind: 'official-opinion'`)として採用するにあたり、以下の運用条件を必須とする:

1. **タイトル原文維持**: 原文タイトルを改変せず表示(PRD §6 既定の踏襲)
2. **出典 URL 必須**: 各記事の冒頭に oecdedutoday.com の原文 URL を必須配置(同上)
3. **要約の生成方針**: edu-watch 編集者が独自に要約を生成、または RSS の `description` を 200 字以内で短く引用するに留める。原文記事の翻案・段落単位転載は行わない
4. **帰属表示**: 記事表示に `[OECD (year), Title, URL]` 形式の帰属表示を付与(`Article` 表示テンプレートで media が `oecd` の場合に自動挿入する実装を、後続の実装 PR で行う)
5. **改変・翻訳**: 機械翻訳によるタイトル翻訳や本文改変は行わない。日本語による要約は edu-watch 編集者が一次解釈として明記する
6. **取得頻度**: 1 日 1 回以下(他媒体と共通)

### 残された不確実性と対応計画

- `oecdedutoday.com` ブログ自身に再利用ライセンスの明文がなく、OECD 本体規約の適用関係も未確認
- **2026-11-06 までに OECD 教育・スキル局(Andreas Schleicher 局長部門)へメール照会**を行い、`oecdedutoday.com` のコンテンツ引用条件と本 ADR の運用条件の妥当性について確認する
- 照会結果次第で、採用条件の追加・緩和・取り下げを決定する。問題が指摘された場合は本 ADR の撤回 / 再検討トリガーとして扱う
- 照会できない場合(返信なし等)、6 ヶ月時点で再評価し、運用条件を保守的な側に維持したまま継続するか採用取り下げを判断

### (b) ルート候補媒体の規約確認状況

本 ADR の「影響と運用上の含意 / 国内 Tier 1 候補の後続 ADR」で言及した 3 媒体について、本 ADR 起票時点での規約確認状況を明記する:

| 媒体 | robots.txt 確認 | 利用規約確認 | 採用判断 |
|---|---|---|---|
| 教職員支援機構 NITS | **未確認** | **未確認** | 後続 ADR で確認後判断 |
| ベネッセ教育総合研究所 | **未確認** | **未確認** | 後続 ADR で確認後判断 |
| 国会文教委員会(衆参) | **未確認** | **未確認** | 後続 ADR で確認後判断 |

3 媒体とも、本 ADR では採用優先度の整理のみを行っており、規約適合性は確認していない。後続 ADR で各媒体ごとに `robots.txt` 全文確認 + 利用規約レビュー + 必要に応じてベンダー / 機関への問い合わせを経たうえで採否を確定する。本 ADR 0036 中の「最優先は NITS」「中期計画として国会文教委員会」という記述は、**規約確認前の作業優先度の整理であって、採用適合性のお墨付きではない**。
