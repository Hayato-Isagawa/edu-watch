# Sprint 2 設計書 — RSS 収集パイプライン

**作成日**: 2026-04-24(2026-04-25 改訂 — ADR 0007 / 0008 反映)
**作成者**: Isagawa Hayato
**前提**: Sprint 1 完了(リポジトリ作成・Astro 基盤・Cloudflare Pages 公開)
**ゴール**: 文科省・国研・教育専門紙・共同通信から記事を日次自動収集し、Astro の SSG でページ出力する土台を作る

---

## 1. スコープ

本 Sprint で実装する範囲(MVP):

- [x] ソース別 RSS / HTML パーサー(第 1 層 + 第 2 層の **計 8 本** — 内訳: 文科省 / 中教審(派生) / NIER / OECD(暫定除外) / リセマム / 日本教育新聞 / 教育家庭新聞 / 共同通信。詳細は §3 と ADR 0007 を参照)
- [x] 記事データ正規化(統一スキーマ + Zod バリデーション)
- [x] 重複除去(URL ハッシュベース)
- [x] カテゴリ分類(キーワードマッチ)
- [x] `src/data/articles/` への JSON 保存
- [x] GitHub Actions cron(日次 3 回)
- [x] 失敗時のリトライ・通知

**スコープ外**(Sprint 3 以降):
- フロント画面(記事一覧・カテゴリ別ページ・検索)
- 1 行要約の AI 自動生成(Phase 2)
- 週次ダイジェストの PR 自動生成(Sprint 4)
- X API 投稿(Sprint 4)

---

## 2. データスキーマ

`src/data/articles/YYYY-MM-DD.json`(日付単位のファイル)

```jsonc
[
  {
    "id": "mext-2026-04-24-001",
    "title": "令和7年度 全国学力・学習状況調査の実施について",
    "sourceId": "mext",
    "sourceName": "文部科学省",
    "sourceUrl": "https://www.mext.go.jp/...",
    "publishedAt": "2026-04-24T09:00:00+09:00",
    "collectedAt": "2026-04-24T13:00:00+09:00",
    "summary": "令和7年度の実施要項が公表されました。...",
    "categories": ["政策", "調査"],
    "layer": 1,
    "language": "ja"
  }
]
```

### スキーマ定義(Zod)

`src/lib/article-schema.ts` に定義。

| フィールド | 型 | 必須 | 備考 |
|---|---|---|---|
| `id` | string | ✓ | `<sourceId>-<yyyy-mm-dd>-<seq>` 形式(URL 衝突回避) |
| `title` | string | ✓ | 元記事タイトル(改変禁止) |
| `sourceId` | string | ✓ | `mext` / `nier` / `chukyo` / `oecd` / `resemom` / `nikkyo` / `kkn` / `kyodo` |
| `sourceName` | string | ✓ | 表示用(例: 「文部科学省」) |
| `sourceUrl` | string (URL) | ✓ | 元記事への直リンク |
| `publishedAt` | ISO8601 string | ✓ | RSS の `pubDate` を ISO 8601 に正規化 |
| `collectedAt` | ISO8601 string | ✓ | パイプライン実行時刻(取得順のソート用) |
| `summary` | string | optional | RSS の description / 本文冒頭 200 文字 |
| `categories` | string[] | ✓ | キーワードマッチで割り当て(最低 1 つ、合致なしは `["その他"]`) |
| `layer` | `1` \| `2` | ✓ | PRD §5.1 の 3 層構成の第 1 / 第 2 層(第 3 層は編集時参照のみなので収集対象外) |
| `language` | `"ja"` \| `"en"` | ✓ | 国内媒体は ja、OECD は en(将来採用予定) |

---

## 3. ソース別パーサー仕様

### 3.0 RSS 存在調査結果(2026-04-25 改訂)

Sprint 2 着手前および Batch 2 着手直前に、サブエージェントで合計 14 ソースを WebFetch / WebSearch で再調査した結果、取得方式は以下の通り:

| 方式 | 件数 | ソース |
|---|---|---|
| **RSS 直接取得** | 5 | 文科省 / 日本教育新聞 / リセマム / 教育家庭新聞 / 共同通信(教育/文化) |
| **派生収集**(他 RSS からフィルタ) | 1 | 中教審(文科省 RSS から抽出) |
| **HTML スクレイピング** | 1 | NIER |
| **暫定除外**(RSS URL 再調査中) | 1 | OECD(`search.oecd.org` の DNS が解決できず) |
| **完全除外**(規約 / 有料壁) | 5 | 教育新聞 / 朝日 EduA / 毎日 教育面 / 読売 こどもと教育 / 日経 教育 / EEF |

読売は 2014 年に RSS 廃止、朝日 EduA・毎日・教育新聞は利用規約で機械収集を明示禁止、日経は有料壁、EEF は英語かつ Cloudflare ブロック対象のため、Batch 2 v2 では教育専門紙 + 共同通信の RSS 5 本に集約された。詳細は ADR 0007(第 2 層方針転換)を参照。

第 2 層を大手紙の教育面から教育専門紙へ転換した経緯と、引用範囲遵守のための運用 5 要件は、それぞれ ADR 0007 / 0008 にまとまっている。本書 §3.2 はそれを技術仕様面から具体化したもの。

### 3.1 第 1 層(一次情報、日次)

#### 3.1.1 文部科学省 — `mext`

- **RSS: `https://www.mext.go.jp/b_menu/news/index.rdf`**(RSS 1.0 / RDF、200 OK 確認済み)
- 更新頻度: 毎日 3〜5 本、週 15〜25 本
- フィルタ: 教育行政・学校関連全般(文科省本体のため全件を基本採用)

#### 3.1.2 国立教育政策研究所 — `nier`

- **HTML スクレイピング**: `https://www.nier.go.jp/` トップページの「新着情報」セクション
- セレクタ見込み: `.whatsnew a` 等(実装時に DOM を確定)
- 更新頻度: 週 5〜10 本、研究報告書が主体

#### 3.1.3 中央教育審議会 — `chukyo`

- **独立 RSS なし** → 文科省 RSS(`mext`)の収集結果からキーワード「中央教育審議会」「中教審」「答申」で抽出する **派生収集方式**
- 独立パーサーは作らず、`categorize.ts` の後処理で該当記事に `sourceName: "中央教育審議会"` のサブラベルを付与

#### 3.1.4 OECD Education and Skills — `oecd`

- **RSS: `https://search.oecd.org/rssfeeds/`(教育 topic-specific)**
- **課題**: 直接 fetch は 403 Forbidden → `User-Agent: edu-watch/1.0 (+https://news.edu-evidence.org)` + `Accept: application/rss+xml` を試し、なお失敗する場合は Cloudflare Workers 経由で取得
- 更新頻度: 週 2〜3 本、英語(Phase 2 で AI 翻訳予定)

#### 3.1.5 Education Endowment Foundation — `eef`

- **HTML スクレイピング**: `https://educationendowmentfoundation.org.uk/news` の記事一覧
- Podcast RSS(`feed.podbean.com/evidenceintoaction/feed.xml`)は存在するが、ニュース記事は HTML スクレイピング必須
- 403 対策(User-Agent 設定)が Sprint 2 初期で必要になる場合あり
- 更新頻度: 月 4〜8 本、英語

### 3.2 第 2 層(教育専門紙 + 共同通信、日次)

ADR 0007 で大手紙の教育面から教育専門紙への転換を決定。各媒体の取得仕様は以下:

#### 3.2.1 リセマム — `resemom`

- **RSS**: `https://resemom.jp/rss20/index.rdf`(RSS 1.0 / RDF、200 OK 確認済み)
- 運営: 株式会社イード(東証グロース 6038)、創刊 2010 年、月間 1.4 億 PV
- 更新頻度: 平日 13〜15 本/日、土日 1〜3 本(週 47 本ペース)
- 読者層: 保護者中心(未就学児〜高校生の保護者、世帯年収 1,000 万円以上が約 30%)
- 記事の質: タイトル + RSS 配信の `<description>` 要約(150-200 字)あり、`<category>` タグはなし
- フィルタ方針: **緩めの NG ワードフィルタ + PR 表記除外**(2026-04-25 ユーザー判断)
  - 除外キーワード(タイトル): `おでかけ`、`GW2026`、`夏休み2026`、`【中学受験`、`偏差値`、`ランキング`、`PR`、`スポンサード`、`タイアップ`
  - 除外しないものの教育専門紙との重複時は dedupe で吸収
  - ホワイトリスト方式は採らず、運用しながら NG リストを育てる
- robots.txt: `User-agent: *` 制限なし、ClaudeBot に Crawl-delay 5 秒指定 → edu-watch も 5 秒間隔遵守
- 利用規約: 機械収集の明示禁止なし(IID の ToS が見当たらず)、RSS 自体に著作権表記あり(© 2026 IID, Inc.)
- **将来検討**: 姉妹サイト ReseEd(`reseed.resemom.jp`、教員向け)の RSS / ToS 調査と追加採用(ADR 0007「再検討の条件」参照)

#### 3.2.2 日本教育新聞 — `nikkyo`

- **RSS**: `https://www.kyoiku-press.com/rss`(RSS 2.0、`<sy:updatePeriod>hourly</sy:updatePeriod>`)
- 運営: 日本教育新聞社、創刊 1953 年、教員 / 教育行政向け週刊専門紙
- 更新頻度: 日 3〜5 本
- 記事の質: タイトル + 詳細 description(要約)あり、`<category>` タグ充実(「Topics」「特別支援教育」「教育委員会」等)
- フィルタ方針: **全件採用**(教員向け専門紙のため、edu-watch のターゲット読者と完全合致)
- robots.txt: `User-agent: *` で `/wp-admin/` のみ Disallow、RSS パス制限なし
- 利用規約: 著作権ページが現時点で 404、フッターに「無断転載禁止」のみ。引用範囲(ADR 0008 の 5 要件)で運用、媒体側からの照会があれば一時停止のうえ協議

#### 3.2.3 教育家庭新聞 — `kkn`

- **RSS**: `https://www.kknews.co.jp/feed`(RSS 2.0)
- 運営: 教育家庭新聞社、ICT / GIGA / 教育 DX 領域の専門紙
- 更新頻度: 日 2〜5 本(EDIX 等の教育 ICT イベント・製品情報が中心)
- 記事の質: タイトル + description あり、`<category>` タグなし
- フィルタ方針: **全件採用**(他媒体と差別化される ICT × 教育の専門領域)
- robots.txt: `/wp-admin/` のみ Disallow、RSS パス制限なし
- 利用規約: 「記事・写真・図表の転載・複写・配布には事前許諾が必要」(`/chizai.html`)。**機械収集の明示禁止はなし**。引用範囲(ADR 0008 の 5 要件)で運用、媒体側からの照会があれば一時停止のうえ協議
- **将来検討**: `kks@kknews.co.jp` 宛に「RSS 経由の引用範囲利用が許容されるか」を確認する書面問い合わせ(Sprint 2 完了後の運用安定後に実施)

#### 3.2.4 共同通信(教育/文化カテゴリ) — `kyodo`

- **RSS**: `https://www.kyodo.co.jp/culture/feed/`(RSS 2.0)
- 全体 RSS(`/feed/`)には教育記事が含まれないため、**カテゴリ別フィードを採用**(2026-04-25 再調査で判明)
- 運営: 共同通信社
- 更新頻度: 日 1〜2 本(エンタメ・文化イベント優先で配信されるため、教育記事比率は約 30%)
- 記事の質: タイトル + description + `<category>` タグ(「教育/文化」「くらし」「経済」等)
- フィルタ方針: **教育キーワードフィルタ**(タイトル + description に `教育 | 学校 | 児童 | 生徒 | 教員 | 大学 | 入試 | 学習指導要領` のいずれかを含む記事のみ採用、想定採用率 30〜40%)
- robots.txt: `User-agent: *` で `/kyodopress_cms/wp-admin/` のみ Disallow
- 利用規約: 「複写、複製、翻訳、翻案、改変、頒布、公表、表示、送信などを禁止」、「引用」のみ許可。引用範囲(ADR 0008 の 5 要件)で厳格に運用

#### 3.2.5 除外媒体

ADR 0007 で除外を確定した媒体は以下のとおり:

| 媒体 | 除外理由 |
|---|---|
| 教育新聞(`kyobun.co.jp`) | RSS なし、robots.txt で AI 系クローラー 60+ を Disallow、ToS で「キュレーション・クリッピングサービス禁止」「営利目的の利用またはその準備行為を禁止」 |
| 朝日新聞 EduA(`edua.asahi.com`) | ToS で「ロボット、スパイダー、スクレーパー等」「AI 開発・学習・利用目的のデータ収集」を明示禁止。EduA 紙媒体は 2024-08 で休刊、Web 版は継続中 |
| 毎日新聞 教育面 | ToS で「ロボット、スパイダー、スクレーパー等」を明示禁止、生成 AI 学習も禁止 |
| 読売新聞 こどもと教育 | robots.txt で wget / curl / Scrapy / Nutch を個別 Disallow、ToS で「クローリング、スクレイピング等の自動化された手段」「生成 AI 学習」を明示禁止 |
| 日経 教育 | 有料壁(2026-04-24 確定、§3.2.5 旧版から継続) |

### 3.3 実装方針

各ソースは以下のインターフェイスを満たす `Parser` を `src/lib/sources/<sourceId>.ts` で実装:

```ts
export interface RawArticle {
  title: string;
  url: string;
  publishedAt: string; // ISO8601
  summary?: string;
}

export interface SourceParser {
  sourceId: string;
  sourceName: string;
  layer: 1 | 2;
  language: "ja" | "en";
  fetch(): Promise<RawArticle[]>;
}
```

`fetch()` は RSS XML の取得 → パース → 正規化(`publishedAt` を ISO8601 に) → 教育キーワードフィルタ(ソース横断で文科省・中教審・朝日などは全件、カテゴリが教育に特化していないソースは `教育 | 学校 | 児童 | 生徒 | 教員` フィルタ)を担当。

---

## 4. 重複除去

`src/lib/dedupe.ts` で以下の方法で重複を排除:

1. **URL 正規化** — クエリパラメータ除去(`?utm_source=` 等)、末尾スラッシュの統一
2. **URL ハッシュ** — SHA-256 の頭 16 桁を `id` のサフィックスに使う
3. **既存データと突合** — 過去 30 日分の JSON を読み、同じ正規化 URL が既存なら新規追加をスキップ
4. **タイトル類似度**(オプション、Phase 2) — 同一記事が Yahoo 経由と朝日直送で別 URL 来るケース対策。levenshtein 距離 > 0.9 で同一判定

---

## 5. カテゴリ分類

`src/lib/categorize.ts` で、タイトル + summary を正規表現でスキャンして `categories` を付与。

### カテゴリ体系(MVP、PRD §7.3 と同一)

| カテゴリ | 判定キーワード(例) |
|---|---|
| いじめ | いじめ、重大事態、いじめ防止対策推進法 |
| 不登校 | 不登校、登校拒否、COCOLO、教育支援センター |
| ICT / GIGA | GIGA、ICT、タブレット、デジタル教科書、1 人 1 台端末 |
| 政策・制度 | 答申、中教審、学習指導要領、法改正、通知、告示 |
| 研究・エビデンス | 研究、調査結果、メタ分析、エビデンス、RCT |
| 国際・海外 | OECD、PISA、EEF、国際比較、海外 |
| 教員・働き方 | 教員、働き方、給特法、残業、志望者、採用 |
| その他 | (上記に合致しない場合のフォールバック) |

**複数カテゴリ付与可**(いじめ + 政策 など)。最大 3 カテゴリまで。
判定ロジックは単純正規表現 → 将来 LLM 分類に置き換え可能な抽象化(`Categorizer` interface)。

---

## 6. GitHub Actions パイプライン

### 6.1 ファイル: `.github/workflows/fetch-news.yml`(2026-04-26 改訂、ADR 0009)

`main` ブランチには Repository Rules で「Changes must be made through a pull request」が有効化されており、ボットも例外なく PR フローに従う。日次 cron は当初 3 回(JST 07/13/19)で確定したが、ADR 0007 で Tier 2 を再構成したあとの実測更新頻度(合計 30〜45 本/日)を踏まえて **日次 2 回(JST 07:00 / 18:00)** に削減した。

```yaml
name: Fetch news

on:
  schedule:
    - cron: "0 22,9 * * *"  # UTC = JST 07:00 / 18:00
  workflow_dispatch:

concurrency:
  group: fetch-news
  cancel-in-progress: false

jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write       # bot 用 feature ブランチへの push に必要
      pull-requests: write  # PR 作成 + auto-merge enable に必要
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: true
      - uses: actions/setup-node@v5
        with:
          node-version: "24.15.0"
          cache: npm
      - run: npm ci
      - name: Run fetch-news
        run: npx tsx scripts/fetch-news.ts
      - name: Commit, push branch, and open auto-merge PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config user.name "edu-watch-bot"
          git config user.email "notify@edu-evidence.org"
          git add src/data/articles/
          if git diff --cached --quiet; then
            echo "[fetch-news] no new articles, skipping PR"
            exit 0
          fi
          timestamp=$(date -u +%Y%m%d-%H%M)
          branch="chore/auto-collect-${timestamp}"
          git checkout -b "$branch"
          git commit -m "chore(data): auto-collect articles ${timestamp}"
          git push -u origin "$branch"
          gh pr create \
            --title "chore(data): auto-collect articles ${timestamp}" \
            --body "edu-watch-bot による定時自動収集。" \
            --label "auto-collect" \
            --base main --head "$branch"
          gh pr merge --auto --squash --delete-branch "$branch"
```

**コミットボットの表示(2026-04-24 確定、PR フロー化後も維持)**:

- name: `edu-watch-bot`
- email: `notify@edu-evidence.org`(Cloudflare Email Routing で運営者へ転送)
- GitHub 上の commit author としても `edu-watch-bot` で一貫
- 全自動 PR には `auto-collect` ラベルを付与し、GitHub UI のフィルタで人間 PR と分離

### 6.2 スクリプト: `scripts/fetch-news.ts`

実装は本リポジトリの `scripts/fetch-news.ts` を参照。流れは:

1. `sources` の全 parser を `Promise.allSettled` で並列フェッチ
2. 失敗ソースはログに記録して継続(他ソースの取得は止めない)
3. `RawArticle` を `normalize` + `categorize` して `Article` へ
4. `dedupeWithin` で同一バッチ内の重複を排除
5. `dedupeAgainstHistory`(過去 30 日)で履歴との重複を排除
6. `publishedAt` の日付ごとにグループ化し、`storage.mergeDay` で書き戻す

### 6.3 失敗時の挙動

- ソースの一部失敗 → **残りのソースは進める**(Promise.allSettled)
- **過半数のソースが失敗 → Actions 赤バッジで通知(exit 1)**(設計書初版の「1 件でも失敗で exit 1」から実装時に緩和、共同通信の取得不安定性を考慮した運用判断、PR #18 のコミットメッセージ参照)
- 記事 0 件の場合は PR を作らない(`git diff --cached --quiet` でチェック → exit 0)
- 持続的にソースが silent な状況は §6.4 の週次ヘルスチェックで検知

### 6.4 監視

- 週次の自動レポート(`.github/workflows/weekly-health-check.yml`)で **ソース別記事数** を集計し、Issue として作成
- あるソースが 1 週間記事 0 件 → そのソースの構造変更の可能性 → Issue でアラート

---

## 7. ストレージ設計

### 7.1 MVP: リポジトリ内 JSON

- `src/data/articles/YYYY-MM-DD.json`(日次ファイル)
- Astro の content collection でもよいが、更新頻度(日次 3 回)と記事件数(1 日 20〜50 件)を考えると **ファイル数が急増** するため、日付単位集約が最適
- ビルド時に Astro が全ファイルを読み込み、記事一覧・カテゴリ別ページを SSG 生成

### 7.2 Phase 2 移行判断

以下の条件のいずれかが発生したら Cloudflare D1 / KV への移行を検討:

- 累積記事数 > 10,000(ビルド時間 > 3 分になった段階)
- 検索機能を SSG インデックス(Pagefind)から DB クエリに切り替えたい場合
- 記事単位の編集履歴(dateModified のログ)を管理したくなった場合

### 7.3 バックアップ

- リポジトリ自体が履歴(git log)なのでバックアップは不要
- GitHub が消失した場合のみ Cloudflare Pages の成果物を参照する非常手段

---

## 8. セキュリティ考慮

### 8.1 RSS 取得時

- fetch には User-Agent に `edu-watch/1.0 (+https://news.edu-evidence.org)` を設定(ロボットとしての礼儀、ブロック回避)
- 10 秒タイムアウト
- HTTPS のみ許可(http:// は拒否)
- サイト側に過度な負荷をかけない(1 ソース毎に 1 秒の sleep で全 10 ソースを逐次処理)

### 8.2 コミットボット

- `user.email: notify@edu-evidence.org`(Cloudflare Email Routing で運営 Gmail へ転送)
- GitHub Actions の `GITHUB_TOKEN` を使用(プッシュ用 PAT は不要)
- Protected branch main でも、GITHUB_TOKEN の workflow 権限で push 可(`permissions: contents: write`)

### 8.3 パース時

- HTML スクレイピングは Cheerio(JSDOM より軽量)
- XSS リスクは低い(出力はサーバーサイドのみ、JSON 化時に正規化)、ただし JSON に HTML タグが混ざらないよう `striptags` で除去

---

## 9. 開発手順(本 Sprint のサブタスク)

| # | タスク | 所要 | 依存 |
|---|---|---|---|
| 1 | Zod スキーマ定義(`article-schema.ts`) | 1h | — |
| 2 | 正規化ロジック(`normalize.ts`) | 1h | 1 |
| 3 | Parser インターフェイス + 共通ユーティリティ | 1h | 1 |
| 4 | 文科省 parser の実装 | 2h | 3(最初の 1 本で知見を得る) |
| 5a | Batch 1 完了済み: chukyo / nier(2026-04-24、PR #10) | — | — |
| 5b | Batch 2 v2-α: リセマム parser(NG ワード + PR 表記除外フィルタ含む) | 3h | 4 |
| 5c | Batch 2 v2-β: 日本教育新聞 / 教育家庭新聞 / 共同通信 parser | 6h | 5b |
| 6 | 重複除去(`dedupe.ts`) | 2h | 2 |
| 7 | カテゴリ分類(`categorize.ts`) | 2h | 2 |
| 8 | ストレージ(`storage.ts`) + 日次集約 | 1h | 2 |
| 9 | 統合スクリプト(`scripts/fetch-news.ts`) | 1h | 3〜8 |
| 10 | GitHub Actions cron | 1h | 9 |
| 11 | ローカルでの手動実行検証 | 2h | 10 |
| 12 | 本番 cron 起動 + 1 週間の動作確認 | ( 1 週間) | 11 |

合計実装: 約 20 時間(2 週間の Sprint 相当)。

---

## 10. Sprint 2 完了条件

- [ ] 8 ソース全てで parser が動作(OECD は暫定除外、日経 / 朝日 EduA / 毎日 / 読売 / 教育新聞は ADR 0007 で完全除外)
- [ ] GitHub Actions cron が 7:00 / 18:00 JST に稼働(ADR 0009 で 3 回 → 2 回に削減)
- [ ] 1 週間の自動収集後、`src/data/articles/` に 7 日分の JSON が蓄積
- [ ] Zod バリデーション違反ゼロ
- [ ] 重複除去が機能(同じ URL が複数回収集されない)
- [ ] カテゴリ分類が機能(記事が正しくタグ付けされる)
- [ ] Actions 失敗時の通知フローを確認済み

**Sprint 2 完了後、Sprint 3(フロント実装)に進む**。それまでは Coming Soon ページのままで、収集データは `src/data/` に蓄積されていく状態。

---

## 11. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| RSS 未提供のソースが多い | 中 | HTML スクレイピング + 対象サイトの robots.txt を尊重 |
| ソース側の構造変更 | 中 | 週次ヘルスチェックで早期検知、Issue で人間対応 |
| 中国/米国からの IP ブロック | 低 | User-Agent を適切に、必要なら Cloudflare Workers 経由でホワイトリスト IP から fetch |
| 著作権リスク(タイトル + 要約の利用) | 中 | ADR 0008 の引用範囲遵守 5 要件(出典明示 / 公式 URL 直リンク / RSS の `<description>` をそのまま / タイトル改変禁止 / 削除依頼窓口 24 時間対応)で運用 |
| 媒体側からの是正依頼 | 中 | `takedown@edu-evidence.org` で受付、該当媒体の掲載を一時停止して協議。協議結果は新規 ADR にする |
| リセマムの受験 / PR 記事混入 | 低 | NG ワードフィルタ + PR 表記除外。運用しながら NG リストを育てる(ADR 0007 で確定) |
| 英語記事の言語問題 | 低 | MVP は英語のまま表示、Phase 2 で AI 翻訳導入 |
| カテゴリ誤分類 | 中 | `その他` フォールバック + 週次レビューで分類改善 |

---

## 12. 着手前の確定事項

### 2026-04-24 時点

| 項目 | 決定 |
|---|---|
| RSS ソースの URL 確定 | サブエージェント調査の結果を §3 に反映済み |
| 日経 教育の有料記事扱い | **スコープ外**(§3.2.5 参照) |
| コミットボットの表示名 | **`edu-watch-bot <notify@edu-evidence.org>`** で確定(§6.1 参照) |

### 2026-04-25 改訂(Batch 2 着手直前)

| 項目 | 決定 |
|---|---|
| 第 2 層の媒体構成 | 大手紙 4 紙 → 教育専門紙 3 紙 + 共同通信(ADR 0007) |
| 大手紙の扱い | 朝日 EduA / 毎日 / 読売 / 教育新聞は ToS で機械収集を明示禁止 → 完全除外。リンク掲載が必要な記事は編集者が手動で個別追加する余地のみ残す |
| 引用範囲の運用 | ADR 0008 の 5 要件を全媒体共通で適用 |
| 削除依頼窓口 | `takedown@edu-evidence.org`(Cloudflare Email Routing で運営者へ転送)、24 時間以内に削除を宣言 |
| Batch 2 v2 の着手順 | (α) リセマム → (β) 日本教育新聞 / 教育家庭新聞 / 共同通信 |
| リセマムのフィルタ方針 | 緩めの NG ワードフィルタ + PR 表記除外、ホワイトリストは採らず運用しながら育てる |

### 2026-04-26 改訂(初回 cron 実行直後)

| 項目 | 決定 |
|---|---|
| ボットの commit 経路 | main 直 push → **PR フロー + auto-merge**(ADR 0009) |
| `pre-commit` hook の CI 例外 | 不要化(PR #19 を撤回、main 直接コミット禁止を全 actor に適用) |
| cron 頻度 | 日次 3 回 → **日次 2 回(JST 07:00 / 18:00)**(ADR 0009、年間 PR 件数を 1095 → 730 に削減) |
| 自動 PR のラベル | `auto-collect`(GitHub UI のフィルタで人間 PR と分離) |
| Repository Rules への bypass 追加 | **しない**(`Repository admin role` を bypass 化すると人間 admin の main 直 push が可能になる副作用あり、ADR 0009) |
| `Allow auto-merge` 設定 | Sprint 3 の運用開始前に Repository Settings で初回有効化(運用者の手作業 1 回) |

---

## 13. 承認

- [ ] 本設計書 v0.1 提出(2026-04-24)
- [ ] レビュー後、修正事項を反映
- [ ] Sprint 2 着手承認
