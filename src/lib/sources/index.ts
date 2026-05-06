/**
 * 全ソースを束ねる配列。
 * `scripts/fetch-news.ts` から `sources.map((s) => s.fetch())` で並列取得する。
 *
 * Sprint 2 進捗:
 *   Batch 1: mext / chukyo(派生)/ nier
 *   Batch 2 v2-α: resemom
 *   Batch 2 v2-β: nikkyo / kkn
 *
 * ADR 0007 で第 2 層を大手紙から教育専門紙へ転換。除外確定: 教育新聞 /
 * 朝日 EduA / 毎日 / 読売 / 日経。
 *
 * ADR 0035(2026-05-05)で kyodo を Tier 1/2 自動収集から Tier 3(参考のみ)
 * へ降格。直近 30 日で 1 件のみ、9 日連続 0 件、`/culture/feed/` の教育比率
 * 想定(約 30%)が実情と乖離していたため。parser / フィルタテスト / smoke
 * スクリプトは残置(将来の復活余地)。`sources` 配列からのみ除外する。
 *
 * ADR 0036(2026-05-06)で OECD `oecdedutoday.com/feed/` を Tier 1
 * (`tier1Kind: 'official-opinion'`)として採用。事前調査で挙げた
 * `https://search.oecd.org/rssfeeds/` は ECONNREFUSED で廃止確定。
 * 採用後は 7 媒体構成、過半数失敗閾値は 4(変更不要)。
 */
import type { SourceParser } from "../article-schema.ts";
import { mext } from "./mext.ts";
import { chukyo } from "./chukyo.ts";
import { nier } from "./nier.ts";
import { oecd } from "./oecd.ts";
import { resemom } from "./resemom.ts";
import { nikkyo } from "./nikkyo.ts";
import { kkn } from "./kkn.ts";
import { kyodo } from "./kyodo.ts";

export const sources: SourceParser[] = [mext, chukyo, nier, oecd, resemom, nikkyo, kkn];

export { mext, chukyo, nier, oecd, resemom, nikkyo, kkn, kyodo };
