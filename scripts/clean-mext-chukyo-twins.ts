/**
 * 中教審(chukyo)と同じ URL の文科省(mext)記事を削除するマイグレーション(一度きり、ADR 0077)
 *
 * chukyo は mext の RSS を中教審の語で絞った派生ソースなので、同じ資料が 2 枚のカードで
 * 並んでいた。収集時は `dropMextTwinsOfChukyo` が同じバッチの mext 側を落とすようにしたので、
 * ここでは保存済みのデータに同じ判定を全期間で当てる。同じソースの出し直しには触れない。
 *
 * 落とす数を `--expect <N>` で渡し、実際の数と食い違えば何も書かずに止まる。
 *
 * 使い方: `npx tsx scripts/clean-mext-chukyo-twins.ts --expect 115 [--dry-run]`
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList, type Article } from "../src/lib/article-schema.ts";
import { dropMextTwinsOfChukyo } from "../src/lib/dedupe.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const expectArg = process.argv[process.argv.indexOf("--expect") + 1];
  const expected = Number(expectArg);
  if (!process.argv.includes("--expect") || !Number.isInteger(expected)) {
    throw new Error("--expect <落とす件数> を渡すこと");
  }

  const entries = (await readdir(DATA_DIR))
    .filter((n) => FILENAME_PATTERN.test(n))
    .sort();
  const files = new Map<string, Article[]>();
  for (const name of entries) {
    files.set(
      name,
      ArticleList.parse(
        JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8"))
      )
    );
  }

  const all = [...files.values()].flat();
  const kept = new Set(dropMextTwinsOfChukyo(all));
  const dropped = all.filter((a) => !kept.has(a));

  console.log(`[clean-mext-chukyo] files read: ${entries.length}`);
  console.log(`[clean-mext-chukyo] articles read: ${all.length}`);
  console.log(
    `[clean-mext-chukyo] articles to drop: ${dropped.length} (expected ${expected})`
  );
  for (const a of dropped) {
    console.log(
      `  ${a.publishedAt.slice(0, 10)}\t${a.id}\t${a.title.slice(0, 70)}`
    );
  }
  if (dropped.length !== expected) {
    throw new Error(
      `落とす数が ${dropped.length} で、--expect ${expected} と合わない。何も書いていない`
    );
  }
  if (dryRun) {
    console.log("[clean-mext-chukyo] dry-run, NOT written");
    return;
  }

  let rewritten = 0;
  for (const [name, list] of files) {
    const next = list.filter((a) => kept.has(a));
    if (next.length === list.length) continue;
    const validated = ArticleList.parse(next);
    await writeFile(
      path.join(DATA_DIR, name),
      JSON.stringify(validated, null, 2) + "\n",
      "utf8"
    );
    rewritten++;
  }
  console.log(`[clean-mext-chukyo] files rewritten: ${rewritten}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
