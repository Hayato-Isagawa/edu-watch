/**
 * 既存 src/data/articles/*.json の categories を再計算するマイグレーション
 * (ADR 0014)
 *
 * 使い方: `npx tsx scripts/recategorize.ts [--dry-run]`
 *
 * categorize.ts の改善(キーワード網拡充 + sourceId デフォルト)を既存記事に
 * 反映するため、全 JSON を読み直して categories だけを書き換える。
 * collectedAt / publishedAt / id 等の他フィールドは触らない(ADR 0010 の
 * 「mergeDay は既存 id を上書きしない」は外部由来データの再保存を禁じる
 * 趣旨であり、内部派生データである categories の再計算は別概念)。
 *
 * --dry-run を付けると変更件数のみ報告し、ファイルは書き換えない。
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList, type Article } from "../src/lib/article-schema.ts";
import { categorize } from "../src/lib/categorize.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();

  let totalRead = 0;
  let totalChanged = 0;
  const before = new Map<string, number>();
  const after = new Map<string, number>();

  for (const name of entries) {
    const file = path.join(DATA_DIR, name);
    const buf = await readFile(file, "utf8");
    const list = ArticleList.parse(JSON.parse(buf));
    let fileChanged = false;
    const updated: Article[] = list.map((a) => {
      totalRead++;
      for (const c of a.categories) before.set(c, (before.get(c) ?? 0) + 1);
      const next = categorize({ title: a.title, summary: a.summary, sourceId: a.sourceId });
      for (const c of next) after.set(c, (after.get(c) ?? 0) + 1);
      const changed =
        next.length !== a.categories.length || next.some((c, i) => c !== a.categories[i]);
      if (changed) {
        totalChanged++;
        fileChanged = true;
        return { ...a, categories: next };
      }
      return a;
    });
    if (fileChanged && !dryRun) {
      const validated = ArticleList.parse(updated);
      await writeFile(file, JSON.stringify(validated, null, 2) + "\n", "utf8");
    }
  }

  const fmt = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}\t${k}`).join("\n");

  console.log(`[recategorize] files read: ${entries.length}`);
  console.log(`[recategorize] articles read: ${totalRead}`);
  console.log(`[recategorize] articles changed: ${totalChanged}${dryRun ? " (dry-run, NOT written)" : ""}`);
  console.log("\n=== before (counts include duplicates across categories[]) ===");
  console.log(fmt(before));
  console.log("\n=== after ===");
  console.log(fmt(after));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
