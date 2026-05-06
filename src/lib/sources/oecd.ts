/**
 * OECD Education and Skills Today RSS parser
 *
 * Feed: https://oecdedutoday.com/feed/(WordPress 標準 RSS 2.0)
 * 取得頻度目安: 週 0.5〜1 件(月 2〜4 本)
 *
 * ADR 0036 で Tier 1(`tier1Kind: 'official-opinion'`)として採用。
 * OECD 教育・スキル局公式ブログで主筆は Andreas Schleicher 局長。
 *
 * 運用条件(ADR 0036 補追セクションの 6 項目):
 *   1. タイトル原文維持(改変・機械翻訳禁止) → 英語のまま `title` に保存
 *   2. 出典 URL 必須 → `url` に oecdedutoday.com の原文 URL を保存
 *   3. 要約は RSS の `description` を 200 字以内で短く引用するに留める
 *      → HTML タグと末尾 "More" リンクを除去後、200 字で切り詰める
 *   4. 帰属表示 `[OECD (year), Title, URL]` → 表示テンプレ側(ArticleCard.astro)で生成
 *   5. 機械翻訳・本文改変禁止 → parser 内では一切翻訳しない
 *   6. 取得頻度 1 日 1 回以下 → fetch-news の cron(JST 07:00 / 18:00)で他媒体と共通
 *
 * ADR 0007 採択時に保留した `https://search.oecd.org/rssfeeds/` は ECONNREFUSED で
 * 廃止確定(ADR 0036)。本ファイル初版は雛形のみだったが、ADR 0036 の採択を受けて
 * 本実装に差し替えた。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://oecdedutoday.com/feed/";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 15_000;
const SUMMARY_MAX_CHARS = 200;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.1",
  },
});

/**
 * RSS の `description` から HTML タグと末尾の "More" 続きリンクを取り除き、
 * 200 字で切り詰めて短引用形式に整える。
 *
 * - WordPress RSS の description は `<p>...</p>` を含み、末尾に
 *   `<a class="more-link" href="...">More</a>` が付与される
 * - HTML エンティティ(&#8230; / &amp; など)も decode する
 * - 切り詰め時は語境界を考慮せず単純な文字数で切る(英語想定で十分)
 */
export function summarizeOecdDescription(rawDescription: string): string {
  const withoutMoreLink = rawDescription.replace(
    /\s*<a[^>]*class="more-link"[^>]*>.*?<\/a>\s*$/i,
    "",
  );
  const withoutTags = withoutMoreLink.replace(/<[^>]+>/g, "");
  const decoded = withoutTags
    .replace(/&#8230;/g, "…")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, SUMMARY_MAX_CHARS).trimEnd()}…`;
}

export const oecd: SourceParser = {
  sourceId: "oecd",
  sourceName: "OECD Education and Skills Today",
  layer: 1,
  language: "en",

  async fetch(): Promise<RawArticle[]> {
    const feed = await rss.parseURL(FEED_URL);
    const results: RawArticle[] = [];
    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();
      const pubRaw = item.isoDate ?? item.pubDate;
      if (!title || !url || !pubRaw) continue;

      const published = new Date(pubRaw);
      if (Number.isNaN(published.getTime())) continue;

      const rawDescription =
        (typeof item.content === "string" ? item.content : undefined) ??
        (typeof item.contentSnippet === "string" ? item.contentSnippet : undefined) ??
        "";
      const summary = rawDescription ? summarizeOecdDescription(rawDescription) : undefined;

      results.push({
        title,
        url,
        publishedAt: published.toISOString(),
        summary: summary && summary.length > 0 ? summary : undefined,
      });
    }
    return results;
  },
};
