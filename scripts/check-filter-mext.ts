/**
 * mext フィルタ(isMextEducationRelevant)の挙動確認スクリプト
 *
 * 既存の src/data/articles/*.json から mext 記事を読み出し、
 * 新フィルタを通すと何件が除外されるかを表示する(削除はしない、dry-run のみ)。
 *
 * 使い方: npx tsx scripts/check-filter-mext.ts
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList } from "../src/lib/article-schema.ts";
import { isMextEducationRelevant } from "../src/lib/sources/mext.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

async function main() {
  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();
  const kept: { id: string; title: string; date: string }[] = [];
  const dropped: { id: string; title: string; date: string }[] = [];

  for (const name of entries) {
    const list = ArticleList.parse(JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")));
    for (const a of list) {
      if (a.sourceId !== "mext") continue;
      const ok = isMextEducationRelevant(a.title, a.summary);
      const row = { id: a.id, title: a.title, date: a.publishedAt.slice(0, 10) };
      if (ok) kept.push(row);
      else dropped.push(row);
    }
  }

  console.log(`[mext filter] total mext articles: ${kept.length + dropped.length}`);
  console.log(`[mext filter] kept:    ${kept.length}`);
  console.log(`[mext filter] dropped: ${dropped.length}`);
  console.log("\n--- dropped (would be removed) ---");
  for (const r of dropped) {
    console.log(`  ${r.date}\t${r.id}\t${r.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
