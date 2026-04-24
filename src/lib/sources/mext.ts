/**
 * 文部科学省 新着情報 RSS parser
 *
 * RSS 1.0 (RDF) — https://www.mext.go.jp/b_menu/news/index.rdf
 * 取得頻度目安: 毎日 3〜5 本、週 15〜25 本
 *
 * 文科省本体からの発信なので、教育実務に関わる全件を採用するのが基本方針。
 * 重大事態等の個別被害者特定に繋がるタイトルの除外は、上位層(掲載しない基準)で
 * ハンドリングする。
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

      const published = new Date(pubRaw);
      if (Number.isNaN(published.getTime())) continue;

      results.push({
        title,
        url,
        publishedAt: published.toISOString(),
        summary: item.contentSnippet?.trim() || item.content?.trim() || undefined,
      });
    }
    return results;
  },
};
