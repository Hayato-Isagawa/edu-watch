/**
 * 既存 src/data/articles/*.json から nier のノイズを削除するマイグレーション
 * (一度きり)
 *
 *   1. 採用情報(期間業務職員 / 時間雇用職員 / 募集は終了)を一掃
 *      — isNierEducationRelevant() を当てて false なら削除
 *   2. 同 publishedAt 日 + 同 title の重複は 1 件残して残りを削除
 *      — collectedAt 早 → id 辞書順 で 1 件選ぶ
 *
 * 使い方: `npx tsx scripts/clean-nier-noise.ts [--dry-run]`
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList, type Article } from "../src/lib/article-schema.ts";
import { isNierEducationRelevant } from "../src/lib/sources/nier.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

interface FileBuf {
  name: string;
  list: Article[];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();

  const files: FileBuf[] = [];
  let totalRead = 0;
  for (const name of entries) {
    const list = ArticleList.parse(JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")));
    files.push({ name, list });
    totalRead += list.length;
  }

  // (1) 採用情報の削除
  const droppedJob: Article[] = [];
  for (const f of files) {
    f.list = f.list.filter((a) => {
      if (a.sourceId === "nier" && !isNierEducationRelevant(a.title)) {
        droppedJob.push(a);
        return false;
      }
      return true;
    });
  }

  // (2) 同 publishedAt 日 + 同 title の nier 重複を 1 件残し
  const allNier = files.flatMap((f) => f.list.filter((a) => a.sourceId === "nier"));
  const groups = new Map<string, Article[]>();
  for (const a of allNier) {
    const key = `${a.publishedAt.slice(0, 10)}|${a.title}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const dropIds = new Set<string>();
  const droppedDup: Article[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => a.collectedAt.localeCompare(b.collectedAt) || a.id.localeCompare(b.id),
    );
    for (const a of sorted.slice(1)) {
      dropIds.add(a.id);
      droppedDup.push(a);
    }
  }
  for (const f of files) {
    f.list = f.list.filter((a) => !dropIds.has(a.id));
  }

  const totalDropped = droppedJob.length + droppedDup.length;
  let filesRewritten = 0;
  if (!dryRun) {
    for (const f of files) {
      const original = ArticleList.parse(
        JSON.parse(await readFile(path.join(DATA_DIR, f.name), "utf8")),
      );
      if (original.length === f.list.length) continue;
      const validated = ArticleList.parse(f.list);
      await writeFile(
        path.join(DATA_DIR, f.name),
        JSON.stringify(validated, null, 2) + "\n",
        "utf8",
      );
      filesRewritten++;
    }
  }

  console.log(`[clean-nier] files read: ${entries.length}`);
  console.log(`[clean-nier] articles read: ${totalRead}`);
  console.log(
    `[clean-nier] dropped (job postings):       ${droppedJob.length}`,
  );
  console.log(
    `[clean-nier] dropped (same-day duplicates): ${droppedDup.length}`,
  );
  console.log(
    `[clean-nier] articles dropped total: ${totalDropped}${dryRun ? " (dry-run, NOT written)" : ""}`,
  );
  if (!dryRun) console.log(`[clean-nier] files rewritten: ${filesRewritten}`);

  console.log("\n--- dropped (job postings) ---");
  for (const a of droppedJob) {
    console.log(`  ${a.publishedAt.slice(0, 10)}\t${a.id}\t${a.title.slice(0, 70)}`);
  }
  console.log("\n--- dropped (same-day duplicates) ---");
  for (const a of droppedDup) {
    console.log(`  ${a.publishedAt.slice(0, 10)}\t${a.id}\t${a.title.slice(0, 70)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
