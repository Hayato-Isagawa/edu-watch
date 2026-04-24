/**
 * 全ソースを束ねる配列。
 * `scripts/fetch-news.ts` から `sources.map((s) => s.fetch())` で並列取得する。
 *
 * Sprint 2 進捗:
 *   Batch 1(本ファイル対象): mext / chukyo(派生)/ nier
 *   Batch 2(予定): oecd / eef / asahi-edua / mainichi / yomiuri-kodomo / kyodo-edu
 *
 * OECD は事前調査で挙げた `https://search.oecd.org/rssfeeds/` の DNS が解決
 * できず、稼働する公式 topic-RSS の URL を再調査中。`oecd.ts` は雛形として
 * 残すが、本番パイプラインの `sources` 配列からは暫定的に除外する。
 */
import type { SourceParser } from "../article-schema.ts";
import { mext } from "./mext.ts";
import { chukyo } from "./chukyo.ts";
import { nier } from "./nier.ts";

export const sources: SourceParser[] = [mext, chukyo, nier];

export { mext, chukyo, nier };
