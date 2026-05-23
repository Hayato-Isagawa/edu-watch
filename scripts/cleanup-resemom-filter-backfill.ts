/**
 * ADR 0051 完成版 resemom フィルタ(NG_PATTERNS + EDUCATION_PATTERNS)を既存
 * 記事 JSON に後追い適用するワンショットスクリプト。
 *
 * 使い方: `npx tsx scripts/cleanup-resemom-filter-backfill.ts`
 *
 * `check-resemom-filter-all.ts` のレポート結果(2026-05-23 取得)に基づき、
 * 50 件の article ID を `src/data/articles/*.json` から除去する。
 * digest で引用済みの 3 件(2026-04-25 digest #1 × 2 / 2026-05-11 digest #3 × 1)は
 * 一貫性のため削除対象から除外しているため、user 協議結果がそのまま反映される。
 *
 * 冪等: 既に削除済みの場合は no-op、再実行しても安全。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface Article {
  id: string;
  title: string;
  sourceId: string;
  [key: string]: unknown;
}

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const ARTICLES_DIR = join(SCRIPT_DIR, "..", "src", "data", "articles");

const REMOVE_IDS: ReadonlySet<string> = new Set([
  // NG_PATTERNS 該当 (6 件) - ADR 0051 NG_PATTERNS に新規追加されたパターンで除外
  "resemom-2026-05-11-7d7f1bce54f0a612",
  "resemom-2026-05-18-4cad112cf1f43a79",
  "resemom-2026-05-21-27b3673109d0d59f",
  "resemom-2026-05-21-a62693ad23006f73",
  "resemom-2026-05-21-c248008498e9f54f",
  "resemom-2026-05-21-66675b0872eb5cb8",
  // 非教育判定 (44 件) - EDUCATION_PATTERNS 不一致
  "resemom-2026-04-23-fb1ef83425a6cbca",
  "resemom-2026-04-24-6122ec8297d2518d",
  "resemom-2026-04-27-e0c339e5764c58d3",
  "resemom-2026-05-07-e33e15ef47f61608",
  "resemom-2026-05-07-1114ae9577a7e836",
  "resemom-2026-05-08-5c21075229483084",
  "resemom-2026-05-11-e6ab312df54fd1cb",
  "resemom-2026-05-11-40a4e7f92402d0cf",
  "resemom-2026-05-11-9f08b0abaadfcf8f",
  "resemom-2026-05-11-c4536bdc5c49909c",
  "resemom-2026-05-12-406cd924198107e9",
  "resemom-2026-05-12-fc95adf5d9408ec5",
  "resemom-2026-05-12-0175a324fd38c95e",
  "resemom-2026-05-12-6865d274776ec0b2",
  "resemom-2026-05-12-db63d4a6732a966d",
  "resemom-2026-05-12-087a61f5908c0df8",
  "resemom-2026-05-13-1d3e19bb1a792062",
  "resemom-2026-05-13-ca50f06b33c52fe5",
  "resemom-2026-05-14-5fe4b06ac875abfa",
  "resemom-2026-05-14-b5a4bc373e5a6c38",
  "resemom-2026-05-14-830da7a1f9c56a0b",
  "resemom-2026-05-14-11f2ede4fa193004",
  "resemom-2026-05-15-fd143c74c55ccb73",
  "resemom-2026-05-15-96d60293f1995644",
  "resemom-2026-05-15-e8ee57c1c57a8072",
  "resemom-2026-05-15-403b9246b6792161",
  "resemom-2026-05-18-2922a5915ca4f155",
  "resemom-2026-05-18-b00b1e31997ebed7",
  "resemom-2026-05-18-6c04051b659ceca6",
  "resemom-2026-05-18-73eb92b98354038e",
  "resemom-2026-05-18-b591a55ca9b76822",
  "resemom-2026-05-19-f2e839df6eb21f88",
  "resemom-2026-05-19-8f379a43103a6997",
  "resemom-2026-05-19-b0d4c4ab3fecb89e",
  "resemom-2026-05-19-5bf071401623936c",
  "resemom-2026-05-19-971e19d0c67cca86",
  "resemom-2026-05-20-3c2a0e347b86ee21",
  "resemom-2026-05-20-47702f58bc168711",
  "resemom-2026-05-20-2e0956a38c968e0c",
  "resemom-2026-05-20-6e23d1e93066a0c6",
  "resemom-2026-05-20-5a471e63439269c3",
  "resemom-2026-05-22-0147006b2b499d7a",
]);

const files = readdirSync(ARTICLES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let totalRemoved = 0;
let touchedFiles = 0;
const removedByDate = new Map<string, number>();

for (const file of files) {
  const path = join(ARTICLES_DIR, file);
  const text = readFileSync(path, "utf-8");
  const articles = JSON.parse(text) as Article[];
  const before = articles.length;
  const kept = articles.filter((a) => !REMOVE_IDS.has(a.id));
  const removed = before - kept.length;
  if (removed > 0) {
    writeFileSync(path, JSON.stringify(kept, null, 2) + "\n", "utf-8");
    totalRemoved += removed;
    touchedFiles += 1;
    removedByDate.set(file.replace(".json", ""), removed);
    console.log(`  ${file}: ${removed} 件削除 (${before} → ${kept.length})`);
  }
}

console.log("");
console.log(`=== 結果 ===`);
console.log(`対象 ID 数: ${REMOVE_IDS.size}`);
console.log(`実削除件数: ${totalRemoved}`);
console.log(`変更ファイル数: ${touchedFiles}`);
if (totalRemoved !== REMOVE_IDS.size) {
  console.warn(`!! 警告: 対象 ID 数 (${REMOVE_IDS.size}) と実削除件数 (${totalRemoved}) が一致しません`);
  console.warn(`!! 既に削除済みの場合 (冪等性で no-op) か、ID 誤記の可能性があります`);
}
