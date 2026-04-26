/**
 * nikkyo parser の動作確認スクリプト(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-nikkyo.ts`
 */
import { nikkyo } from "../src/lib/sources/nikkyo.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";

async function main() {
  console.log(`[smoke] fetching from ${nikkyo.sourceName}...`);
  const raw = await nikkyo.fetch();
  console.log(`[smoke] got ${raw.length} raw articles`);

  const collectedAt = new Date().toISOString();
  const normalized = raw.slice(0, 5).map((r) => normalize(r, nikkyo, collectedAt, categorize));

  console.log(`[smoke] normalized first ${normalized.length}:`);
  for (const a of normalized) {
    console.log(
      `  [${a.categories.join(",")}] ${a.title.slice(0, 50)}... (${a.publishedAt.slice(0, 10)})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
