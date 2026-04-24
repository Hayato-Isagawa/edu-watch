/**
 * Article schema for edu-watch
 *
 * 収集パイプラインから SSG までの全工程で使用する記事データ型。
 * Sprint 2 設計書 §2(docs/sprint-2-design.md)と同期する。
 *
 * - `layer: 1` — 一次情報(文科省 / 国研 / 中教審 / OECD / EEF)
 * - `layer: 2` — 主要メディア教育面(朝日 EduA / 毎日 / 読売 / 共同)
 */
import { z } from "zod";

export const SourceLayer = z.union([z.literal(1), z.literal(2)]);
export type SourceLayer = z.infer<typeof SourceLayer>;

export const Language = z.union([z.literal("ja"), z.literal("en")]);
export type Language = z.infer<typeof Language>;

export const ArticleCategory = z.enum([
  "いじめ",
  "不登校",
  "ICT / GIGA",
  "政策・制度",
  "研究・エビデンス",
  "国際・海外",
  "教員・働き方",
  "その他",
]);
export type ArticleCategory = z.infer<typeof ArticleCategory>;

/**
 * Parser 層が返す「正規化前の RSS 取得結果」。
 * HTML スクレイピングと RSS の両方から、この共通形に吐き出す。
 */
export const RawArticle = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }),
  summary: z.string().optional(),
});
export type RawArticle = z.infer<typeof RawArticle>;

/**
 * 正規化後・保存直前の記事データ。`src/data/articles/YYYY-MM-DD.json` に
 * シリアライズされる最終形。
 */
export const Article = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/, {
      message: "id must be <sourceId>-<yyyy-mm-dd>-<16-hex-hash>",
    }),
  title: z.string().min(1),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceUrl: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }),
  collectedAt: z.string().datetime({ offset: true }),
  summary: z.string().optional(),
  categories: z.array(ArticleCategory).min(1),
  layer: SourceLayer,
  language: Language,
});
export type Article = z.infer<typeof Article>;

export const ArticleList = z.array(Article);
export type ArticleList = z.infer<typeof ArticleList>;

/**
 * Parser の共通インターフェイス。
 * 各ソース(mext / nier / oecd / eef / asahi-edua / mainichi / yomiuri-kodomo / kyodo-edu)は
 * このインターフェイスを実装して `src/lib/sources/<sourceId>.ts` に置く。
 */
export interface SourceParser {
  sourceId: string;
  sourceName: string;
  layer: SourceLayer;
  language: Language;
  fetch(): Promise<RawArticle[]>;
}
