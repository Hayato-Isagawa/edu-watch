/**
 * mext parser の動作確認スクリプト(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-mext.ts`
 *
 * Sprint 2 完了前の開発用。本番パイプライン(GitHub Actions)からは
 * `scripts/fetch-news.ts`(未作成)を呼ぶ。
 */
import { mext } from "../src/lib/sources/mext.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";

async function main() {
  console.log(`[smoke] fetching from ${mext.sourceName}...`);
  const raw = await mext.fetch();
  console.log(`[smoke] got ${raw.length} raw articles`);

  const collectedAt = new Date().toISOString();
  const normalized = raw.slice(0, 5).map((r) => normalize(r, mext, collectedAt, categorize));

  console.log(`[smoke] normalized first ${normalized.length}:`);
  for (const a of normalized) {
    console.log(
      `  [${a.categories.join(",")}] ${a.title.slice(0, 40)}... (${a.publishedAt.slice(0, 10)})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
