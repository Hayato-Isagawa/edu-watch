/**
 * resemom parser の動作確認スクリプト(開発用)
 *
 * 使い方: `npx tsx scripts/smoke-fetch-resemom.ts`
 *
 * Sprint 2 完了前の開発用。本番パイプライン(GitHub Actions)からは
 * `scripts/fetch-news.ts`(未作成)を呼ぶ。
 */
import { resemom } from "../src/lib/sources/resemom.ts";
import { normalize } from "../src/lib/normalize.ts";
import { categorize } from "../src/lib/categorize.ts";

async function main() {
  console.log(`[smoke] fetching from ${resemom.sourceName}...`);
  const raw = await resemom.fetch();
  console.log(`[smoke] got ${raw.length} raw articles (after NG/PR filter)`);

  const collectedAt = new Date().toISOString();
  const normalized = raw.slice(0, 5).map((r) => normalize(r, resemom, collectedAt, categorize));

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
