/**
 * 国立教育政策研究所(NIER)新着情報 RSS parser
 *
 * 事前調査では NIER は「RSS なし、HTML スクレイピング必要」と報告された
 * が、実際にはトップページの `<link rel="alternate" type="application/rss+xml">`
 * で https://www.nier.go.jp/02_news/rss.xml が提供されており、
 * `User-Agent` 指定で 200 OK でフェッチできる。
 *
 * 新着は研究報告・調査結果・シンポジウム告知などが中心で、文科省本体と
 * 同様に全件採用する(編集の掲載基準は上位層で運用)。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.nier.go.jp/02_news/rss.xml";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

export const nier: SourceParser = {
  sourceId: "nier",
  sourceName: "国立教育政策研究所",
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
