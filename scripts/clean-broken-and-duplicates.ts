/**
 * リンク切れ + タイトル更新版の重複記事を削除するマイグレーション(一度きり)
 *
 * scripts/check-broken-links.ts と scripts/check-duplicate-links.ts の
 * 結果を踏まえ、以下を削除する:
 *
 *   - リンク切れ(404)7 件
 *     * nier の旧 URL `/02_news/...` 系 3 件(新 URL の同テーマ記事が存在)
 *     * mext / chukyo の差し替え前 URL 4 件(`mext_00012/13.html`、最新は `mext_00014.html`)
 *   - タイトル更新版の重複 1 件
 *     * nikkyo-2026-04-22-ef7b01de812b5e0f(後発 4-27 に更新版タイトルあり)
 *
 * 計 8 件。
 *
 * 使い方: `npx tsx scripts/clean-broken-and-duplicates.ts [--dry-run]`
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList } from "../src/lib/article-schema.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

const TARGET_IDS = new Set<string>([
  // nier 旧 URL(/02_news/...) — 新 URL の同テーマ記事が別 id で存在
  "nier-2026-04-23-8574cd034aca16b1",
  "nier-2026-04-24-8ca9f3e9c9c81318",
  "nier-2026-04-24-2dedb76c25c67586",
  // mext / chukyo の差し替え前 URL(議事録 mext_00012 / mext_00013、最新は mext_00014)
  "mext-2026-04-28-ceb3dd07b5a0c765",
  "chukyo-2026-04-28-ceb3dd07b5a0c765",
  "mext-2026-04-28-0410d913e2c85686",
  "chukyo-2026-04-28-0410d913e2c85686",
  // nikkyo タイトル更新版の重複(後発 4-27 を残し、4-22 を削除)
  "nikkyo-2026-04-22-ef7b01de812b5e0f",
]);

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
      if (!TARGET_IDS.has(a.id)) return true;
      droppedRows.push({
        date: a.publishedAt.slice(0, 10),
        id: a.id,
        title: a.title,
      });
      return false;
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

  console.log(`[clean-broken] files read: ${entries.length}`);
  console.log(`[clean-broken] articles read: ${totalRead}`);
  console.log(
    `[clean-broken] articles dropped: ${totalDropped}${dryRun ? " (dry-run, NOT written)" : ""}`,
  );
  if (!dryRun) {
    console.log(`[clean-broken] files rewritten: ${filesRewritten}`);
  }
  console.log("\n--- dropped ---");
  for (const r of droppedRows) {
    console.log(`  ${r.date}\t${r.id}\t${r.title.slice(0, 70)}`);
  }

  const expected = TARGET_IDS.size;
  if (totalDropped !== expected) {
    console.warn(
      `\n⚠ expected ${expected} drops but processed ${totalDropped}. 一部 id が見つかっていない可能性があります。`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
