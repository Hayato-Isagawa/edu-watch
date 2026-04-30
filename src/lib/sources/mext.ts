/**
 * 文部科学省 新着情報 RSS parser
 *
 * RSS 1.0 (RDF) — https://www.mext.go.jp/b_menu/news/index.rdf
 * 取得頻度目安: 毎日 3〜5 本、週 15〜25 本
 *
 * 文科省本体からの発信は教育以外(科学技術 / 宇宙 / 文化 / スポーツ庁 /
 * 大学経営研究 / 統計業務など)も含むため、教育スコープに限定する
 * フィルタを通す:
 *   1. 明示的な除外パターン(EXPLICIT_EXCLUDE_PATTERNS)に当たれば除外
 *   2. 教育インクルードパターン(EDUCATION_INCLUDE_PATTERNS)に当たれば採用
 *   3. どちらにも当たらない場合はデフォルトで除外(allowlist 寄り、安全側)
 *
 * 重大事態等の個別被害者特定に繋がるタイトルの除外は、上位層
 * (掲載しない基準)で別途ハンドリングする。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.mext.go.jp/b_menu/news/index.rdf";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * 明示除外: 教育以外のスコープ(科学技術 / 宇宙 / 大学経営 / 文化 /
 * 統計業務 / 大臣会見など)を弾く。インクルードに先んじて適用される。
 */
const EXPLICIT_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /H3\s*ロケット/,
  /JAXA/,
  /打上げ/,
  /量子ビーム/,
  /原子力/,
  /加速器/,
  /NISTEP/,
  /科学技術・学術審議会/,
  /AI for Science/,
  /創発的研究/,
  /研究基盤/,
  /研究振興局/,
  /ライフサイエンス課/,
  /産業・科学革新/,
  /\bINSIGHT\b/,
  /大学経営のあり方/,
  /ジオパーク/,
  /みどりの式典/,
  /統計業務の質/,
  /大臣記者会見録/,
];

/**
 * 教育インクルード: 教育実務・政策・制度・養成・社会教育などのキーワード。
 * いずれかに当たれば採用する。
 */
const EDUCATION_INCLUDE_PATTERNS: readonly RegExp[] = [
  /教育/,
  /学校/,
  /学習/,
  /教員/,
  /教師/,
  /教職/,
  /教科/,
  /指導/,
  /カリキュラム/,
  /学習指導要領/,
  /中央教育審議会/,
  /中教審/,
  /生徒/,
  /児童/,
  /学生/,
  /学年/,
  /保護者/,
  /家庭/,
  /いじめ/,
  /不登校/,
  /特別支援/,
  /給食/,
  /部活動/,
  /働き方改革/,
  /養護教諭/,
  /栄養教諭/,
  /道徳/,
  /社会教育/,
  /生涯学習/,
  /教員養成/,
  /教職課程/,
  /大学院課程/,
  /学部等/,
  /国際競争力けん引学部/,
  /幼児/,
  /幼稚園/,
  /保育/,
  /高等教育/,
  /初等中等教育/,
  /進路/,
  /奨学金/,
  /留学/,
  /外国人児童生徒/,
  /日本語教育/,
  /帰国生/,
  /多文化共生/,
];

export function isMextEducationRelevant(title: string, summary?: string): boolean {
  const haystack = summary ? `${title}\n${summary}` : title;
  if (EXPLICIT_EXCLUDE_PATTERNS.some((re) => re.test(haystack))) return false;
  return EDUCATION_INCLUDE_PATTERNS.some((re) => re.test(haystack));
}

export const mext: SourceParser = {
  sourceId: "mext",
  sourceName: "文部科学省",
  layer: 1,
  language: "ja",

  async fetch(): Promise<RawArticle[]> {
    const feed = await rss.parseURL(FEED_URL);
    const results: RawArticle[] = [];
    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();
      const pubRaw = item.isoDate ?? item.pubDate;
      if (!title || !url || !pubRaw) continue;

      const summary = item.contentSnippet?.trim() || item.content?.trim() || undefined;
      if (!isMextEducationRelevant(title, summary)) continue;

      const published = new Date(pubRaw);
      if (Number.isNaN(published.getTime())) continue;

      results.push({
        title,
        url,
        publishedAt: published.toISOString(),
        summary,
      });
    }
    return results;
  },
};
