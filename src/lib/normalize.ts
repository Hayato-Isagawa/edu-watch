/**
 * Raw -> Article 変換ユーティリティ
 *
 * - URL 正規化(クエリパラメータ除去、末尾スラッシュ統一)
 * - id 生成(sourceId + 日付 + SHA-256(url) の先頭 16 桁)
 * - publishedAt の ISO8601 正規化
 */
import { createHash } from "node:crypto";
import type { Article, RawArticle, SourceParser } from "./article-schema.ts";
import { Article as ArticleSchema } from "./article-schema.ts";

/** UTM 系と Yahoo ニュース由来のトラッキングパラメータを除去する */
const TRACKING_PARAMS_PATTERN =
  /^(utm_[^=]+|fbclid|gclid|yahoo_[^=]+|_.+source|ref|from)$/i;

/**
 * URL 正規化。
 * - トラッキングパラメータ除去
 * - 末尾スラッシュ統一(付ける or 付けないは元 URL に追従、ただし `//` の連続は削除)
 */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS_PATTERN.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  // `?utm=..` を消した結果 search が空になった場合、`?` を落とす
  if (url.search === "?") url.search = "";
  return url.toString();
}

/**
 * 記事 id の生成。`<sourceId>-<yyyy-mm-dd>-<16-hex-hash>` 形式。
 * ハッシュは canonicalizeUrl 済みの URL を SHA-256 して先頭 16 桁を採る。
 */
export function generateArticleId(sourceId: string, publishedAt: string, url: string): string {
  const date = publishedAt.slice(0, 10);
  const hash = createHash("sha256").update(canonicalizeUrl(url)).digest("hex").slice(0, 16);
  return `${sourceId}-${date}-${hash}`;
}

/**
 * RawArticle(parser 出力)から正規化済み Article に変換する。
 * 変換後は必ず Zod スキーマで validate する。
 */
export function normalize(
  raw: RawArticle,
  parser: Pick<SourceParser, "sourceId" | "sourceName" | "layer" | "language">,
  collectedAt: string = new Date().toISOString(),
  categoriesFor: (raw: RawArticle & { sourceId: string }) => Article["categories"],
): Article {
  const canonicalUrl = canonicalizeUrl(raw.url);
  const article: Article = {
    id: generateArticleId(parser.sourceId, raw.publishedAt, canonicalUrl),
    title: raw.title.trim(),
    sourceId: parser.sourceId,
    sourceName: parser.sourceName,
    sourceUrl: canonicalUrl,
    publishedAt: raw.publishedAt,
    collectedAt,
    summary: raw.summary?.trim() || undefined,
    categories: categoriesFor({ ...raw, sourceId: parser.sourceId }),
    layer: parser.layer,
    language: parser.language,
    requiresMembership: raw.requiresMembership === true ? true : undefined,
  };
  return ArticleSchema.parse(article);
}
