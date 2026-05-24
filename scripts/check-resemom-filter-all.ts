/**
 * 全期間の resemom 既存記事に新フィルタ(ADR 0051 完成版)を後追い適用するレポートスクリプト
 *
 * 使い方: `npx tsx scripts/check-resemom-filter-all.ts`
 *
 * `src/data/articles/*.json` の全ファイルから resemom 記事を抽出し、
 * `isExcludedByTitle()` および `isEducationallyRelevant()` を適用して、
 * 削減対象(新フィルタで弾かれる既存記事)の一覧と統計を出力する。
 *
 * 過去 1 週間検証用の `check-resemom-filter-past-week.ts` は ADR 0051 採択時の
 * 検証履歴として温存し、本スクリプトは後追い仕分け用の独立した位置付け。
 */
import { readFileSync, readdirSync } from "node:fs";
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

interface Verdict {
  article: Article;
  date: string;
  ngExcluded: boolean;
  notRelevant: boolean;
}

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const ARTICLES_DIR = join(SCRIPT_DIR, "..", "src", "data", "articles");
const DIGESTS_DIR = join(SCRIPT_DIR, "..", "src", "content", "digests");

function load(filename: string): Article[] {
  const path = join(ARTICLES_DIR, filename);
  const text = readFileSync(path, "utf-8");
  return JSON.parse(text) as Article[];
}

function collectDigestReferencedIds(): Map<string, Set<string>> {
  const byDigest = new Map<string, Set<string>>();
  const files = readdirSync(DIGESTS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const text = readFileSync(join(DIGESTS_DIR, file), "utf-8");
    const ids = new Set<string>();
    for (const m of text.matchAll(/articleIds:\s*\[([^\]]+)\]/g)) {
      for (const raw of m[1].split(",")) {
        const id = raw.trim();
        if (id) ids.add(id);
      }
    }
    byDigest.set(file.replace(".md", ""), ids);
  }
  return byDigest;
}

function digestsCiting(articleId: string, byDigest: Map<string, Set<string>>): string[] {
  const hits: string[] = [];
  for (const [digest, ids] of byDigest) {
    if (ids.has(articleId)) hits.push(digest);
  }
  return hits;
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

const files = readdirSync(ARTICLES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const allResemom: Verdict[] = [];
for (const file of files) {
  const date = file.replace(".json", "");
  const articles = load(file);
  const resemom = articles.filter((a) => a.sourceId === "resemom");
  for (const a of resemom) {
    allResemom.push(classify(a, date));
  }
}

const ngOnly = allResemom.filter((v) => v.ngExcluded);
const notRelevantOnly = allResemom.filter((v) => !v.ngExcluded && v.notRelevant);
const excluded = allResemom.filter((v) => v.ngExcluded || v.notRelevant);
const kept = allResemom.filter((v) => !v.ngExcluded && !v.notRelevant);

const digestRefs = collectDigestReferencedIds();
const allDigestIds = new Set<string>();
for (const ids of digestRefs.values()) {
  for (const id of ids) allDigestIds.add(id);
}
const excludedButCited = excluded.filter((v) => allDigestIds.has(v.article.id));

const firstDate = files[0]?.replace(".json", "") ?? "n/a";
const lastDate = files[files.length - 1]?.replace(".json", "") ?? "n/a";

console.log("=== resemom 全期間フィルタ後追い適用レポート ===");
console.log(`期間: ${firstDate} 〜 ${lastDate}`);
console.log(`対象ファイル数: ${files.length}`);
console.log(`resemom 総記事数: ${allResemom.length}`);
console.log("");
console.log(`削減対象 (新フィルタで弾かれる既存記事): ${excluded.length} 件`);
console.log(`  - NG_PATTERNS 該当: ${ngOnly.length} 件`);
console.log(`  - 非教育 (EDUCATION_PATTERNS 不一致): ${notRelevantOnly.length} 件`);
console.log(`維持対象: ${kept.length} 件`);
const rate = allResemom.length > 0 ? ((excluded.length / allResemom.length) * 100).toFixed(1) : "n/a";
console.log(`削減率: ${rate}%`);
console.log("");
console.log(`【ダイジェスト引用チェック】`);
console.log(`  ダイジェスト数: ${digestRefs.size} 本`);
console.log(`  全引用 article ID 数: ${allDigestIds.size}`);
console.log(`  削減対象のうちダイジェスト引用済み: ${excludedButCited.length} 件 (>0 なら削除前に要協議)`);
console.log("");

console.log(`=== NG_PATTERNS 該当 (${ngOnly.length} 件) ===`);
for (const v of ngOnly) {
  const cited = digestsCiting(v.article.id, digestRefs);
  const flag = cited.length > 0 ? ` !! digest引用: ${cited.join(", ")}` : "";
  console.log(`  [${v.date}] ${v.article.id} ${v.article.title}${flag}`);
}
console.log("");

console.log(`=== 非教育判定 (${notRelevantOnly.length} 件) ===`);
for (const v of notRelevantOnly) {
  const cited = digestsCiting(v.article.id, digestRefs);
  const flag = cited.length > 0 ? ` !! digest引用: ${cited.join(", ")}` : "";
  console.log(`  [${v.date}] ${v.article.id} ${v.article.title}${flag}`);
}
console.log("");

const byDate = new Map<string, number>();
for (const v of excluded) {
  byDate.set(v.date, (byDate.get(v.date) ?? 0) + 1);
}
console.log("=== 日付別削減件数 ===");
for (const [date, count] of [...byDate.entries()].sort()) {
  console.log(`  ${date}: ${count} 件`);
}
console.log("");

if (excludedButCited.length > 0) {
  console.log(`=== !! 警告: ダイジェスト引用済みの削減対象 (${excludedButCited.length} 件) ===`);
  for (const v of excludedButCited) {
    const cited = digestsCiting(v.article.id, digestRefs);
    console.log(`  [${v.date}] ${v.article.id} ${v.article.title}`);
    console.log(`    引用元: ${cited.join(", ")}`);
    console.log(`    除外理由: ${v.ngExcluded ? "NG_PATTERNS" : "非教育"}`);
  }
} else {
  console.log("=== ダイジェスト引用チェック結果: クリア (削減対象は digest に引用されていない) ===");
}
