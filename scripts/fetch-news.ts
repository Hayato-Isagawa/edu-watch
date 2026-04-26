/**
 * 統合フェッチスクリプト(GitHub Actions から呼ばれる本番エントリポイント)
 *
 * 処理の流れ:
 *   1. `sources` 配列の全 parser を Promise.allSettled で並列フェッチ
 *   2. 失敗ソースはログに記録して継続(他ソースの取得は止めない)
 *   3. RawArticle を normalize + categorize して Article へ
 *   4. dedupeWithin で同一バッチ内の重複を排除
 *   5. dedupeAgainstHistory で過去 30 日分との重複を排除
 *   6. publishedAt の日付ごとにグループ化し、storage.mergeDay で書き戻す
 *
 * 終了コード:
 *   - 0: 全ソース成功 or 1 ソース以下失敗(警告ログのみ)
 *   - 1: 過半数のソースが失敗(GitHub Actions が異常検知できるように非ゼロ)
 *
 * Sprint 2 設計書 §6.2 / §6.3 準拠。
 */
import path from "node:path";
import { sources } from "../src/lib/sources/index.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";
import { dedupeAgainstHistory, dedupeWithin } from "../src/lib/dedupe.ts";
import { mergeDay } from "../src/lib/storage.ts";
import type { Article } from "../src/lib/article-schema.ts";

const DATA_DIR = path.resolve("src/data/articles");
const HISTORY_LOOKBACK_DAYS = 30;

async function main(): Promise<number> {
  const collectedAt = new Date().toISOString();
  console.log(`[fetch-news] start ${collectedAt} (${sources.length} sources)`);

  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  let failedCount = 0;
  const collected: Article[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const result = results[i];
    if (result.status === "rejected") {
      failedCount++;
      console.error(`[fetch-news] ${source.sourceId} FAILED: ${result.reason}`);
      continue;
    }
    let normalizedCount = 0;
    for (const raw of result.value) {
      try {
        collected.push(normalize(raw, source, collectedAt, categorize));
        normalizedCount++;
      } catch (err) {
        console.error(
          `[fetch-news] ${source.sourceId} schema validation failed for ${raw.url}: ${err}`,
        );
      }
    }
    console.log(`[fetch-news] ${source.sourceId} ok: ${normalizedCount} articles`);
  }

  const withinDeduped = dedupeWithin(collected);
  const today = collectedAt.slice(0, 10);
  const newOnly = await dedupeAgainstHistory(withinDeduped, {
    dataDir: DATA_DIR,
    lookbackDays: HISTORY_LOOKBACK_DAYS,
    today,
  });

  console.log(
    `[fetch-news] collected=${collected.length} within-dedupe=${withinDeduped.length} ` +
      `vs-history=${newOnly.length} (history lookback ${HISTORY_LOOKBACK_DAYS} days)`,
  );

  const byDate = groupByPublishedDate(newOnly);
  let totalAdded = 0;
  for (const [date, items] of byDate) {
    const { added, total } = await mergeDay(DATA_DIR, date, items);
    totalAdded += added;
    console.log(`[fetch-news] ${date}: +${added} (file total ${total})`);
  }

  console.log(
    `[fetch-news] done: added ${totalAdded} new articles across ${byDate.size} day file(s)`,
  );

  // 過半数失敗で終了コード 1
  if (failedCount * 2 > sources.length) {
    console.error(
      `[fetch-news] FAIL: ${failedCount}/${sources.length} sources failed (>= 50%)`,
    );
    return 1;
  }
  if (failedCount > 0) {
    console.warn(
      `[fetch-news] WARN: ${failedCount}/${sources.length} sources failed (< 50%, exit 0)`,
    );
  }
  return 0;
}

function groupByPublishedDate(articles: Article[]): Map<string, Article[]> {
  const map = new Map<string, Article[]>();
  for (const a of articles) {
    const date = a.publishedAt.slice(0, 10);
    const arr = map.get(date) ?? [];
    arr.push(a);
    map.set(date, arr);
  }
  return map;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[fetch-news] uncaught error:", err);
    process.exit(1);
  });
