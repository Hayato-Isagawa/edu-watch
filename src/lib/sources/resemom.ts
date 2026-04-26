/**
 * リセマム RSS parser
 *
 * RSS 2.0 (RDF) — https://resemom.jp/rss20/index.rdf
 * 取得頻度目安: 平日 13〜15 本/日、土日 1〜3 本(週 47 本ペース)
 *
 * リセマムは保護者向けの教育情報サイトのため、edu-watch の編集方針に
 * 合わない記事(受験産業色の強いもの・季節レジャー特集・PR / タイアップ
 * 表記のあるもの)はパーサー段階で除外する。フィルタは過剰除外を避ける
 * 「緩めの NG ワード方式」で運用しながら NG リストを育てる方針(ADR 0007)。
 *
 * 利用規約上は機械収集の明示禁止なし、robots.txt で ClaudeBot への
 * Crawl-delay: 5 が指定されているため、本パーサーも 5 秒間隔の運用を遵守する
 * (連続呼び出しが必要な場面では呼び出し側で間隔調整)。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://resemom.jp/rss20/index.rdf";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * タイトルが除外対象かどうかを判定する純粋関数。
 *
 * - 受験産業色: `偏差値`、`ランキング`、`【中学受験`、`【高校受験`、`【大学受験`
 * - 季節レジャー: `おでかけ`、`GW`、`夏休み`、`冬休み`、`春休み` の特集タイトル
 * - 広告表記: `PR`、`スポンサード`、`タイアップ`、`【提供】`
 *
 * 教育政策・教員支援・統計調査・ICT 系の記事はここで弾かないように、
 * 季節キーワードは「特集タイトル形式」(例: `【GW2026】`)を狙って
 * 単語境界を意識した形で照合する。
 */
const NG_PATTERNS: readonly RegExp[] = [
  /偏差値/,
  /ランキング/,
  /【中学受験/,
  /【高校受験/,
  /【大学受験/,
  /おでかけ/,
  /【GW\d{0,4}】/,
  /【夏休み\d{0,4}】/,
  /【冬休み\d{0,4}】/,
  /【春休み\d{0,4}】/,
  /\bPR\b/,
  /スポンサード/,
  /タイアップ/,
  /【提供】/,
];

export function isExcludedByTitle(title: string): boolean {
  return NG_PATTERNS.some((pattern) => pattern.test(title));
}

export const resemom: SourceParser = {
  sourceId: "resemom",
  sourceName: "リセマム",
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
      if (isExcludedByTitle(title)) continue;

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
