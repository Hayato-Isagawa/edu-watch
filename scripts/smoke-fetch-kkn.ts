/**
 * kkn parser の動作確認スクリプト(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-kkn.ts`
 */
import { kkn } from "../src/lib/sources/kkn.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";

async function main() {
  console.log(`[smoke] fetching from ${kkn.sourceName}...`);
  const raw = await kkn.fetch();
  console.log(`[smoke] got ${raw.length} raw articles`);

  const collectedAt = new Date().toISOString();
  const normalized = raw.slice(0, 5).map((r) => normalize(r, kkn, collectedAt, categorize));

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
