/**
 * nier parser の動作確認スクリプト(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-nier.ts`
 */
import { nier } from "../src/lib/sources/nier.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";

async function main() {
  console.log(`[smoke] fetching from ${nier.sourceName}...`);
  const raw = await nier.fetch();
  console.log(`[smoke] got ${raw.length} raw articles`);

  const collectedAt = new Date().toISOString();
  const normalized = raw.slice(0, 5).map((r) => normalize(r, nier, collectedAt, categorize));

  console.log(`[smoke] normalized first ${normalized.length}:`);
  for (const a of normalized) {
    console.log(
      `  [${a.categories.join(",")}] ${a.title.slice(0, 40)}... (${a.publishedAt.slice(0, 10)})`,
    );
    console.log(`    url: ${a.sourceUrl}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
