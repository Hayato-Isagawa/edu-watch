/**
 * 共同通信(教育/文化カテゴリ)RSS parser
 *
 * RSS 2.0 — https://www.kyodo.co.jp/culture/feed/
 * 取得頻度目安: 日 1〜2 本(教育記事比率は約 30%、エンタメ・文化が多数)
 *
 * 全体フィード `/feed/` には教育記事が含まれないため、カテゴリ別の
 * `/culture/feed/` から取得する。文化カテゴリには教育以外(エンタメ・
 * 美術館・イベント等)が混在するので、`isEducationRelated()` で
 * タイトル + summary を教育キーワードフィルタにかける。
 *
 * 利用規約は「複写、複製、翻訳、翻案、改変、頒布」を禁止し「引用」のみ
 * 許可している。ADR 0008 の引用範囲遵守 5 要件を厳格に適用し、本文取得・
 * AI 書き換え・編集者によるタイトル編集は行わない。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.kyodo.co.jp/culture/feed/";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * タイトルまたは summary に教育関連キーワードを含むかを判定する純粋関数。
 *
 * 文化カテゴリは教育・エンタメ・芸術・展覧会等が混在するため、includeo
 * 方式(キーワードに合致したものだけ採用)で edu-watch の編集スコープに
 * 絞り込む。
 */
const EDUCATION_PATTERNS: readonly RegExp[] = [
  /教育/,
  /学校/,
  /児童/,
  /生徒/,
  /教員/,
  /教師/,
  /大学/,
  /入試/,
  /学習指導要領/,
  /いじめ/,
  /不登校/,
  /奨学金/,
  /文部科学/,
];

export function isEducationRelated(title: string, summary?: string): boolean {
  const haystack = summary ? `${title}\n${summary}` : title;
  return EDUCATION_PATTERNS.some((pattern) => pattern.test(haystack));
}

export const kyodo: SourceParser = {
  sourceId: "kyodo",
  sourceName: "共同通信",
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

      const summary = item.contentSnippet?.trim() || item.content?.trim() || undefined;
      if (!isEducationRelated(title, summary)) continue;

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
