/**
 * `src/data/excluded-article-ids.json` の整合性検証スクリプト(ADR 0020)
 *
 * 使い方: `npx tsx scripts/check-excluded-ids.ts`(または `npm run check:excluded-ids`)
 *
 * 検証項目:
 *   1. JSON が `ExcludedIdsFile` スキーマ通り(loader が validate)
 *   2. denylist にある ID が article JSON に残っていない(残っていれば cron 復活の証跡)
 *   3. 各 ID に reason が登録されている(loader が validate)
 *
 * 失敗したら exit 1、CI で検知できるようにする。
 */
import path from "node:path";
import { loadDay } from "../src/lib/storage.ts";
import { loadExcludedIds } from "../src/lib/excluded-ids.ts";

const DATA_DIR = path.resolve("src/data/articles");

async function main(): Promise<number> {
  const denylist = await loadExcludedIds();
  console.log(
    `[check:excluded-ids] loaded ${denylist.ids.length} entries (schemaVersion ${denylist.schemaVersion})`,
  );

  const violations: { id: string; date: string; title: string }[] = [];
  const dateToIds = new Map<string, string[]>();
  for (const id of denylist.ids) {
    const date = id.split("-").slice(1, 4).join("-");
    const arr = dateToIds.get(date) ?? [];
    arr.push(id);
    dateToIds.set(date, arr);
  }

  for (const [date, ids] of dateToIds) {
    const articles = await loadDay(DATA_DIR, date);
    const present = new Map(articles.map((a) => [a.id, a.title]));
    for (const id of ids) {
      const title = present.get(id);
      if (title) {
        violations.push({ id, date, title });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[check:excluded-ids] FAIL: ${violations.length} denylisted ID(s) still present in article JSON`,
    );
    for (const v of violations) {
      console.error(`  - ${v.id} (${v.date}): ${v.title}`);
    }
    return 1;
  }

  console.log(`[check:excluded-ids] OK: no denylisted IDs present in article JSON`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[check:excluded-ids] uncaught error:", err);
    process.exit(1);
  });
