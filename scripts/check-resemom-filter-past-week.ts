/**
 * 過去 1 週間の resemom 記事に新フィルタを適用して削減件数を検証するスクリプト
 *
 * 使い方: `npx tsx scripts/check-resemom-filter-past-week.ts`
 *
 * 既存の `src/data/articles/*.json` (2026-05-15 〜 2026-05-21) から
 * resemom 記事を抽出し、`isExcludedByTitle()` および
 * `isEducationallyRelevant()` を適用して、削減件数 + 除外理由別の件数 +
 * 除外タイトル一覧を出力する。
 *
 * これにより、ADR 0051 の include keyword filter が
 * 教員視点で価値ある記事を誤って弾いていないか(過剰除外)、
 * および新 NG_PATTERNS が想定通り機能するかを user と検証できる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExcludedByTitle,
  isEducationallyRelevant,
} from "../src/lib/sources/resemom.ts";

interface Article {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  collectedAt: string;
  summary?: string;
  categories: string[];
  layer: number;
  language: string;
}

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const ARTICLES_DIR = join(SCRIPT_DIR, "..", "src", "data", "articles");
const TARGET_DATES: readonly string[] = [
  "2026-05-15",
  "2026-05-16",
  "2026-05-17",
  "2026-05-18",
  "2026-05-19",
  "2026-05-20",
  "2026-05-21",
];

interface Verdict {
  article: Article;
  date: string;
  ngExcluded: boolean;
  notRelevant: boolean;
}

function load(date: string): Article[] {
  const path = join(ARTICLES_DIR, `${date}.json`);
  const text = readFileSync(path, "utf-8");
  return JSON.parse(text) as Article[];
}

function classify(article: Article, date: string): Verdict {
  const ngExcluded = isExcludedByTitle(article.title);
  const relevant = isEducationallyRelevant(article.title, article.summary);
  return {
    article,
    date,
    ngExcluded,
    notRelevant: !relevant,
  };
}

const allResemom: Verdict[] = [];
for (const date of TARGET_DATES) {
  const articles = load(date);
  const resemom = articles.filter((a) => a.sourceId === "resemom");
  for (const a of resemom) {
    allResemom.push(classify(a, date));
  }
}

const total = allResemom.length;
const passed = allResemom.filter((v) => !v.ngExcluded && !v.notRelevant);
const ngOnly = allResemom.filter((v) => v.ngExcluded);
const notRelevantOnly = allResemom.filter(
  (v) => !v.ngExcluded && v.notRelevant,
);
const excludedCount = ngOnly.length + notRelevantOnly.length;

console.log(
  `\n=== resemom 記事 新フィルタ検証 (${TARGET_DATES[0]} 〜 ${TARGET_DATES[TARGET_DATES.length - 1]}) ===\n`,
);
console.log(`総件数             : ${total}`);
console.log(`通過               : ${passed.length}`);
console.log(`NG 除外            : ${ngOnly.length}`);
console.log(`非教育キーワード除外: ${notRelevantOnly.length}`);
console.log(
  `合計除外           : ${excludedCount} (${total > 0 ? ((excludedCount / total) * 100).toFixed(1) : "0.0"}%)\n`,
);

console.log(`--- NG 除外詳細 (NG_PATTERNS + ADR 0051 追加分) ---`);
if (ngOnly.length === 0) {
  console.log("(該当なし)");
}
for (const v of ngOnly) {
  console.log(`[${v.date}] ${v.article.title}`);
}

console.log(
  `\n--- 非教育キーワード除外詳細 (EDUCATION_PATTERNS 不一致、過剰除外チェック対象) ---`,
);
if (notRelevantOnly.length === 0) {
  console.log("(該当なし)");
}
for (const v of notRelevantOnly) {
  console.log(`[${v.date}] ${v.article.title}`);
  if (v.article.summary) {
    const snippet = v.article.summary.slice(0, 140).replace(/\s+/g, " ");
    console.log(`  summary: ${snippet}${v.article.summary.length > 140 ? "..." : ""}`);
  }
}

console.log(`\n--- 通過する記事 (参考、教員視点での妥当性確認用) ---`);
if (passed.length === 0) {
  console.log("(該当なし)");
}
for (const v of passed) {
  console.log(`[${v.date}] ${v.article.title}`);
}
