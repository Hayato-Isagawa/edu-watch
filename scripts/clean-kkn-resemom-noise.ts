/**
 * 既存 src/data/articles/*.json から kkn / resemom のノイズ記事を削除する
 * マイグレーション(一度きり、ADR 0039 の遡及適用)
 *
 * 使い方: `npx tsx scripts/clean-kkn-resemom-noise.ts [--dry-run]`
 *
 * kkn.ts / resemom.ts の isExcludedByTitle() を当てて、true になる記事を
 * 削除して書き戻す。両 source 以外の記事は触らない。
 *
 * --dry-run: 削除対象の件数と内訳を表示するのみ、ファイル書き換えなし
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList } from "../src/lib/article-schema.ts";
import { isExcludedByTitle as isKknExcluded } from "../src/lib/sources/kkn.ts";
import { isExcludedByTitle as isResemomExcluded } from "../src/lib/sources/resemom.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const DENYLIST_PATH = path.resolve(
  import.meta.dirname,
  "../src/data/excluded-article-ids.json",
);
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

interface DroppedRow {
  source: "kkn" | "resemom";
  date: string;
  id: string;
  title: string;
  inDenylist: boolean;
}

interface Denylist {
  schemaVersion: number;
  ids: string[];
  reasons: Record<string, string>;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = (await readdir(DATA_DIR))
    .filter((n) => FILENAME_PATTERN.test(n))
    .sort();

  const denylist: Denylist = JSON.parse(await readFile(DENYLIST_PATH, "utf8"));
  const denylistSet = new Set(denylist.ids);

  let totalRead = 0;
  let kknDropped = 0;
  let resemomDropped = 0;
  let alreadyInDenylist = 0;
  let filesRewritten = 0;
  const droppedRows: DroppedRow[] = [];

  for (const name of entries) {
    const file = path.join(DATA_DIR, name);
    const list = ArticleList.parse(JSON.parse(await readFile(file, "utf8")));
    totalRead += list.length;

    const kept = list.filter((a) => {
      let source: "kkn" | "resemom" | null = null;
      if (a.sourceId === "kkn" && isKknExcluded(a.title)) source = "kkn";
      else if (a.sourceId === "resemom" && isResemomExcluded(a.title))
        source = "resemom";

      if (source) {
        const inDenylist = denylistSet.has(a.id);
        if (inDenylist) alreadyInDenylist++;
        else if (source === "kkn") kknDropped++;
        else resemomDropped++;

        droppedRows.push({
          source,
          date: a.publishedAt.slice(0, 10),
          id: a.id,
          title: a.title,
          inDenylist,
        });
        return false;
      }
      return true;
    });

    if (kept.length !== list.length) {
      if (!dryRun) {
        const validated = ArticleList.parse(kept);
        await writeFile(file, JSON.stringify(validated, null, 2) + "\n", "utf8");
        filesRewritten++;
      }
    }
  }

  const totalDropped = kknDropped + resemomDropped + alreadyInDenylist;

  let denylistAdded = 0;
  if (!dryRun) {
    const newIds = droppedRows
      .filter((r) => !r.inDenylist)
      .map((r) => r.id);
    const updatedIds = [...new Set([...denylist.ids, ...newIds])].sort();
    const updatedReasons = { ...denylist.reasons };
    for (const r of droppedRows) {
      if (r.inDenylist) continue;
      updatedReasons[r.id] =
        r.source === "kkn"
          ? "ADR 0039 §kkn NG_PATTERNS (PR #124)。parser 強化前の取り込み残を遡及削除。"
          : "ADR 0039 §resemom NG_PATTERNS (PR #124)。parser 強化前の取り込み残を遡及削除。";
    }
    const updated: Denylist = {
      schemaVersion: denylist.schemaVersion,
      ids: updatedIds,
      reasons: updatedReasons,
    };
    await writeFile(
      DENYLIST_PATH,
      JSON.stringify(updated, null, 2) + "\n",
      "utf8",
    );
    denylistAdded = newIds.length;
  }

  console.log(`[clean-kkn-resemom] files read: ${entries.length}`);
  console.log(`[clean-kkn-resemom] articles read: ${totalRead}`);
  console.log(`[clean-kkn-resemom] dropped (kkn, new):       ${kknDropped}`);
  console.log(`[clean-kkn-resemom] dropped (resemom, new):   ${resemomDropped}`);
  console.log(
    `[clean-kkn-resemom] dropped (already in denylist): ${alreadyInDenylist}`,
  );
  console.log(
    `[clean-kkn-resemom] articles dropped total: ${totalDropped}${dryRun ? " (dry-run, NOT written)" : ""}`,
  );
  if (!dryRun) {
    console.log(`[clean-kkn-resemom] files rewritten: ${filesRewritten}`);
    console.log(`[clean-kkn-resemom] denylist ids added: ${denylistAdded}`);
  }

  console.log("\n--- dropped (kkn) ---");
  for (const r of droppedRows.filter((x) => x.source === "kkn")) {
    const tag = r.inDenylist ? " [denylist]" : "";
    console.log(`  ${r.date}\t${r.id}\t${r.title}${tag}`);
  }
  console.log("\n--- dropped (resemom) ---");
  for (const r of droppedRows.filter((x) => x.source === "resemom")) {
    const tag = r.inDenylist ? " [denylist]" : "";
    console.log(`  ${r.date}\t${r.id}\t${r.title}${tag}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
