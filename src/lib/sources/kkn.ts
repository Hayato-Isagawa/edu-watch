/**
 * 教育家庭新聞 RSS parser
 *
 * RSS 2.0 — https://www.kknews.co.jp/feed
 * 取得頻度目安: 日 2〜5 本(EDIX 等の教育 ICT イベント・製品情報が中心)
 *
 * ICT・GIGA・教育 DX 領域の専門紙。Tier 2 の他媒体との差別化源として
 * 全件採用する(GIGA 関連の網羅性を担保)。
 *
 * 利用規約(`/chizai.html`)は記事・写真・図表の転載・複写・配布に事前
 * 許諾が必要としているが、機械収集の明示禁止はなし。ADR 0008 の引用範囲
 * 遵守 5 要件で運用し、Sprint 2 完了後に `kks@kknews.co.jp` へ運用方針の
 * 確認メールを送る予定(ADR 0007 の再検討条件参照)。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.kknews.co.jp/feed";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

export const kkn: SourceParser = {
  sourceId: "kkn",
  sourceName: "教育家庭新聞",
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
