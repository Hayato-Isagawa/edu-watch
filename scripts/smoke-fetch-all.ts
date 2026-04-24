/**
 * 全ソースの smoke test(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-all.ts`
 *
 * Promise.allSettled でパイプラインの本番挙動と同じく、一部ソースが失敗
 * しても他ソースは進める形で並列フェッチする。Sprint 2 完了前の開発用。
 */
import { sources } from "../src/lib/sources/index.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";
import type { RawArticle } from "../src/lib/article-schema.ts";

async function main() {
  const collectedAt = new Date().toISOString();
  console.log(`[smoke] starting ${sources.length} parsers at ${collectedAt}\n`);

  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const result = results[i];
    if (result.status === "rejected") {
      console.log(`[${source.sourceId}] FAIL: ${result.reason}\n`);
      continue;
    }
    const raw: RawArticle[] = result.value;
    console.log(`[${source.sourceId}] ok: ${raw.length} items`);
    for (const r of raw.slice(0, 3)) {
      const normalized = normalize(r, source, collectedAt, categorize);
      console.log(
        `  [${normalized.categories.join(",")}] ${normalized.title.slice(0, 50)}... (${normalized.publishedAt.slice(0, 10)})`,
      );
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
