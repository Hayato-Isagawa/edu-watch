/**
 * 日本教育新聞 RSS parser
 *
 * RSS 2.0 — https://www.kyoiku-press.com/rss
 * 取得頻度目安: 日 3〜5 本
 *
 * 教員・教育行政向けの専門紙(1953 年創刊、週刊紙面)。読者像が edu-watch の
 * Tier 2 ターゲットそのものなので、フィルタは設けず全件採用する。
 *
 * 利用規約は現時点で `/copyright` ページが 404、フッターに「無断転載禁止」
 * とのみ記載がある。ADR 0008 の引用範囲遵守 5 要件で運用し、媒体側からの
 * 照会があれば一時停止のうえ協議する。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.kyoiku-press.com/rss";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

export const nikkyo: SourceParser = {
  sourceId: "nikkyo",
  sourceName: "日本教育新聞",
  layer: 2,
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
