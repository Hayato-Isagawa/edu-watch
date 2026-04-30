/**
 * sourceUrl の重複を調査する(削除はしない)。
 *
 * 同一 sourceId 内で sourceUrl が完全一致する記事を「重複」として検出する。
 * 異なる sourceId 間で sourceUrl が偶然一致する場合(例: mext と chukyo で
 * 同じ URL を共有する派生記事)は、別媒体扱いなのでこのスクリプトでは除外しない。
 *
 * 出力:
 *   1. 同日(publishedAt 日)+ 同 sourceId 内の重複 — 最優先で消す候補
 *   2. 異なる publishedAt + 同 sourceId 内の重複 — 後発再観測の可能性
 *
 * 使い方: `npx tsx scripts/check-duplicate-links.ts`
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList, type Article } from "../src/lib/article-schema.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

async function main() {
  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();
  const all: Article[] = [];
  for (const name of entries) {
    const list = ArticleList.parse(JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")));
    all.push(...list);
  }
  console.log(`[duplicate-links] total articles: ${all.length}`);

  // sourceUrl + sourceId でグループ化
  const groups = new Map<string, Article[]>();
  for (const a of all) {
    const key = `${a.sourceId}|${a.sourceUrl}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }

  const sameDayDups: Article[][] = [];
  const crossDayDups: Article[][] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const dates = new Set(list.map((a) => a.publishedAt.slice(0, 10)));
    if (dates.size === 1) sameDayDups.push(list);
    else crossDayDups.push(list);
  }

  console.log(
    `[duplicate-links] same-day duplicate groups: ${sameDayDups.length}(計 ${sameDayDups.reduce((acc, g) => acc + g.length - 1, 0)} 件削除候補)`,
  );
  console.log(
    `[duplicate-links] cross-day duplicate groups: ${crossDayDups.length}(計 ${crossDayDups.reduce((acc, g) => acc + g.length - 1, 0)} 件削除候補)`,
  );

  console.log("\n--- same-day duplicates(同日内、即削除推奨) ---");
  for (const g of sameDayDups) {
    console.log(`\n  [${g[0].sourceId}] ${g[0].sourceUrl}`);
    for (const a of g) {
      console.log(`    ${a.publishedAt.slice(0, 10)}  ${a.id}  ${a.title.slice(0, 60)}`);
    }
  }

  console.log("\n--- cross-day duplicates(別日、後発再観測) ---");
  for (const g of crossDayDups) {
    console.log(`\n  [${g[0].sourceId}] ${g[0].sourceUrl}`);
    for (const a of g) {
      console.log(`    ${a.publishedAt.slice(0, 10)}  ${a.id}  ${a.title.slice(0, 60)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
