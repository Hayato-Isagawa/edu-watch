/**
 * 既存 src/data/articles/*.json から教育スコープ外の mext 記事を削除する
 * マイグレーション(一度きり)
 *
 * 使い方: `npx tsx scripts/clean-mext-off-scope.ts [--dry-run]`
 *
 * mext.ts の isMextEducationRelevant() を当てて、false になる mext 記事を
 * 削除して書き戻す。他 sourceId の記事は触らない。
 *
 * --dry-run: 削除対象の件数とリストを表示するのみ、ファイル書き換えなし
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList } from "../src/lib/article-schema.ts";
import { isMextEducationRelevant } from "../src/lib/sources/mext.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();

  let totalRead = 0;
  let totalDropped = 0;
  let filesRewritten = 0;
  const droppedRows: { date: string; id: string; title: string }[] = [];

  for (const name of entries) {
    const file = path.join(DATA_DIR, name);
    const list = ArticleList.parse(JSON.parse(await readFile(file, "utf8")));
    totalRead += list.length;

    const kept = list.filter((a) => {
      if (a.sourceId !== "mext") return true;
      const ok = isMextEducationRelevant(a.title, a.summary);
      if (!ok) {
        droppedRows.push({
          date: a.publishedAt.slice(0, 10),
          id: a.id,
          title: a.title,
        });
      }
      return ok;
    });

    if (kept.length !== list.length) {
      totalDropped += list.length - kept.length;
      if (!dryRun) {
        const validated = ArticleList.parse(kept);
        await writeFile(file, JSON.stringify(validated, null, 2) + "\n", "utf8");
        filesRewritten++;
      }
    }
  }

  console.log(`[clean-mext] files read: ${entries.length}`);
  console.log(`[clean-mext] articles read: ${totalRead}`);
  console.log(
    `[clean-mext] articles dropped: ${totalDropped}${dryRun ? " (dry-run, NOT written)" : ""}`,
  );
  if (!dryRun) {
    console.log(`[clean-mext] files rewritten: ${filesRewritten}`);
  }
  console.log("\n--- dropped ---");
  for (const r of droppedRows) {
    console.log(`  ${r.date}\t${r.id}\t${r.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
