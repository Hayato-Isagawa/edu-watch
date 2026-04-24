# Sprint 2 設計書 — RSS 収集パイプライン

**作成日**: 2026-04-24
**作成者**: 伊差川隼人
**前提**: Sprint 1 完了(リポジトリ作成・Astro 基盤・Cloudflare Pages 公開)
**ゴール**: 文科省・国研・OECD・EEF・主要新聞から記事を日次自動収集し、Astro の SSG でページ出力する土台を作る

---

## 1. スコープ

本 Sprint で実装する範囲(MVP):

- [x] ソース別 RSS / HTML パーサー(第 1 層 + 第 2 層の **計 9 本** — 日経 教育は有料壁のためスコープ外)
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
| `sourceId` | string | ✓ | `mext` / `nier` / `oecd` / `eef` / `asahi-edua` 等 |
| `sourceName` | string | ✓ | 表示用(例: 「文部科学省」) |
| `sourceUrl` | string (URL) | ✓ | 元記事への直リンク |
| `publishedAt` | ISO8601 string | ✓ | RSS の `pubDate` を ISO 8601 に正規化 |
| `collectedAt` | ISO8601 string | ✓ | パイプライン実行時刻(取得順のソート用) |
| `summary` | string | optional | RSS の description / 本文冒頭 200 文字 |
| `categories` | string[] | ✓ | キーワードマッチで割り当て(最低 1 つ、合致なしは `["その他"]`) |
| `layer` | `1` \| `2` | ✓ | PRD §5.1 の 3 層構成の第 1 / 第 2 層(第 3 層は編集時参照のみなので収集対象外) |
| `language` | `"ja"` \| `"en"` | ✓ | 主要メディアは ja、OECD / EEF は en |

---

## 3. ソース別パーサー仕様

### 3.1 第 1 層(一次情報、日次)

#### 3.1.1 文部科学省 — `mext`

- RSS 候補: 新着情報ページ(RSS 提供があるか要確認、無ければ HTML スクレイピング)
- URL: `https://www.mext.go.jp/new.xml`(存在確認要)
- 代替: `https://www.mext.go.jp/whatsnew.html` を Cheerio でパース
- フィルタ: 記事タイトルに「学校」「教育」「児童」「学習指導」「教員」「生徒指導」等の教育キーワードを含むもの

#### 3.1.2 国立教育政策研究所 — `nier`

- RSS: `https://www.nier.go.jp/whatsnew.rss`(推定、要確認)
- 代替: 新着情報ページの HTML スクレイピング

#### 3.1.3 中央教育審議会 — `chukyo`

- 文科省サイト内の特定カテゴリ(審議会)を抽出する形
- 文科省の収集結果からキーワード「中央教育審議会」「中教審」「答申」でフィルタするアプローチが実用的

#### 3.1.4 OECD Education and Skills — `oecd`

- RSS: `https://www.oecd.org/education/rss.xml`(要確認)
- 言語: en(Summary フィールドは英語のまま。Phase 2 で AI 翻訳予定)

#### 3.1.5 Education Endowment Foundation — `eef`

- RSS: `https://educationendowmentfoundation.org.uk/news/rss`(要確認)
- Blog + Publications の両ストリーム

### 3.2 第 2 層(主要メディア、日次)

#### 3.2.1 朝日新聞 EduA — `asahi-edua`

- RSS: `https://www.asahi.com/rss/edua.rdf`(要確認)
- ブランド: 「朝日新聞 EduA」

#### 3.2.2 毎日新聞 教育面 — `mainichi-edu`

- RSS: `https://mainichi.jp/rss/etc/education.rss`(要確認)

#### 3.2.3 読売新聞 こどもと教育 — `yomiuri-kodomo`

- RSS 有無要確認

#### 3.2.4 共同通信 教育 — `kyodo-edu`

- RSS 有無要確認。カテゴリ RSS が無ければ全国面を教育キーワードでフィルタ

#### 3.2.5 日経 教育 — スコープ外(2026-04-24 確定)

- 日経 教育は **有料記事が中心** で、登録読者以外は本文にアクセスできない
- edu-watch の読者(現場教員・保護者)の大半が非購読者想定のため、タイトルだけ載せても「読めないリンク」で終わる
- よって **MVP では収集対象から除外**。Phase 2 以降で、定期購読者向けの別セクションを設ける場合に再検討

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

### 6.1 ファイル: `.github/workflows/fetch-news.yml`

```yaml
name: Fetch news

on:
  schedule:
    - cron: "0 22,4,10 * * *"  # UTC = JST 07:00 / 13:00 / 19:00
  workflow_dispatch:

jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24.15.0"
          cache: npm
      - run: npm ci
      - run: npx tsx scripts/fetch-news.ts
      - name: Commit new articles
        run: |
          git config user.name "edu-watch-bot"
          git config user.email "notify@edu-evidence.org"
          git add src/data/articles/
          if ! git diff --cached --quiet; then
            git commit -m "chore(data): auto-collect articles $(date -u +%Y-%m-%d_%H%M)"
            git push
          fi
```

**コミットボットの表示(2026-04-24 確定)**:

- name: `edu-watch-bot`
- email: `notify@edu-evidence.org`(Cloudflare Email Routing で `eduevidence.jp@gmail.com` に転送)
- GitHub 上の commit author としても `edu-watch-bot` で一貫

### 6.2 スクリプト: `scripts/fetch-news.ts`

```ts
import { sources } from "../src/lib/sources";  // 10 個の Parser を束ねた配列
import { dedupeAgainstHistory } from "../src/lib/dedupe";
import { categorize } from "../src/lib/categorize";
import { normalize } from "../src/lib/normalize";
import { saveDaily } from "../src/lib/storage";

const results = await Promise.allSettled(sources.map((s) => s.fetch()));
const rawArticles = results
  .filter((r): r is PromiseFulfilledResult<RawArticle[]> => r.status === "fulfilled")
  .flatMap((r) => r.value);
const normalized = rawArticles.map(normalize);
const fresh = await dedupeAgainstHistory(normalized);
const categorized = fresh.map((a) => ({ ...a, categories: categorize(a) }));
await saveDaily(categorized);

const failures = results.filter((r) => r.status === "rejected");
if (failures.length > 0) {
  console.error(`[fetch-news] ${failures.length} source(s) failed:`);
  failures.forEach((f) => console.error(f.reason));
  process.exit(1);  // Actions で赤バッジに
}
```

### 6.3 失敗時の挙動

- ソースの一部失敗 → **残りのソースは進める**(Promise.allSettled)
- 全ソース失敗 → Actions 赤バッジで通知
- 記事 0 件の日でも commit はしない(`git diff --cached --quiet` でチェック)

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
| 5 | 残り 8 ソースの parser(並列で実装) | 6h | 4 |
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

- [ ] 9 ソース全てで parser が動作(日経除く)
- [ ] GitHub Actions cron が 7:00 / 13:00 / 19:00 JST に稼働
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
| 著作権リスク(タイトル+要約の利用) | 中 | タイトル原文まま + 短い要約 + 元リンクで引用の要件を満たす。本文全文は保存しない |
| 英語記事の言語問題 | 低 | MVP は英語のまま表示、Phase 2 で AI 翻訳導入 |
| カテゴリ誤分類 | 中 | `その他` フォールバック + 週次レビューで分類改善 |

---

## 12. 着手前の確定事項(2026-04-24)

| 項目 | 決定 |
|---|---|
| RSS ソースの URL 確定 | サブエージェント調査の結果を §3 に反映予定(本 Sprint 開始時点で差分 commit) |
| 日経 教育の有料記事扱い | **スコープ外**(§3.2.5 参照)。MVP 9 ソースで開始 |
| コミットボットの表示名 | **`edu-watch-bot <notify@edu-evidence.org>`** で確定(§6.1 参照) |

---

## 13. 承認

- [ ] 本設計書 v0.1 提出(2026-04-24)
- [ ] レビュー後、修正事項を反映
- [ ] Sprint 2 着手承認
