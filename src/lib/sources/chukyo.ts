/**
 * 中央教育審議会(中教審)— mext RSS からの派生収集
 *
 * 中教審は独立 RSS を持たないため、文科省の新着情報 RSS から
 * 「中央教育審議会」「中教審」「答申」いずれかを含む項目を抽出し、
 * sourceName を「中央教育審議会」で上書きする派生パーサーとして扱う。
 *
 * PRD §5.1 / sprint-2-design.md §3.1.3 に基づく実装。
 */
import type { RawArticle, SourceParser } from "../article-schema.ts";
import { mext } from "./mext.ts";

const KEYWORD_PATTERN = /(中央教育審議会|中教審|答申)/;

export const chukyo: SourceParser = {
  sourceId: "chukyo",
  sourceName: "中央教育審議会",
  layer: 1,
  language: "ja",

  async fetch(): Promise<RawArticle[]> {
    const mextArticles = await mext.fetch();
    return mextArticles.filter(
      (a) => KEYWORD_PATTERN.test(a.title) || KEYWORD_PATTERN.test(a.summary ?? ""),
    );
  },
};
