/**
 * OECD Education and Skills RSS parser(TODO: 稼働 URL 再調査)
 *
 * 事前調査で候補とした `https://search.oecd.org/rssfeeds/?t=education` は
 * 実行時に `getaddrinfo ENOTFOUND` となり、ホスト自体が解決できなかった。
 * 現状、稼働する公式 topic-RSS の URL を特定できていないため、本ファイルは
 * 雛形として残しつつ、`sources/index.ts` の `sources` 配列からは暫定的に
 * 除外している。再調査候補:
 *   - `https://www.oecd-ilibrary.org/rss/*`(iLibrary 系)
 *   - `https://www.oecd.org/en/topics/education-and-skills.html` の RSS 埋め込み
 *   - Atom フィード(拡張子 .atom)の有無確認
 * 英語のまま保存し、要約・カテゴリ分類時に AI 翻訳を挟むのは Phase 2 で検討。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://search.oecd.org/rssfeeds/?t=education";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 15_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.1",
  },
});

export const oecd: SourceParser = {
  sourceId: "oecd",
  sourceName: "OECD Education and Skills",
  layer: 1,
  language: "en",

  async fetch(): Promise<RawArticle[]> {
    let feed;
    try {
      feed = await rss.parseURL(FEED_URL);
    } catch (err) {
      // 403 / 構造変更時は上位パイプラインの Promise.allSettled がキャッチする。
      // 本関数内ではログを出しつつ空配列を返す運用も選べるが、設計書では
      // "ソースの一部失敗 → 残りのソースは進める" と明示しているため例外を throw する。
      throw new Error(
        `[oecd] failed to fetch ${FEED_URL}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
