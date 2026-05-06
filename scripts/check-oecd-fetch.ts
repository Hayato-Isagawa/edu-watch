/**
 * OECD parser smoke + summary normalization unit assert
 *
 * 使い方: `npm run check:fetch:oecd`(または `npx tsx scripts/check-oecd-fetch.ts`)
 *
 * 二段構成:
 *   1. `summarizeOecdDescription` の単体 assert(ネットワーク依存なし)
 *      HTML タグ除去 / 末尾 More リンク除去 / HTML エンティティ decode /
 *      200 字切り詰めの境界ケースを回帰防止
 *   2. 本物の `https://oecdedutoday.com/feed/` を 1 回だけ取得し、
 *      件数 / 各記事のタイトル・publishedAt・summary 長さを表示(smoke)
 *
 * ADR 0036 採用条件 6 項目のうち実装可観測な部分(タイトル原文維持 /
 * URL 必須 / summary 200 字以内 / 機械翻訳禁止)を CI でなく手動確認できるよう
 * 整える。本スクリプトは CI には組み込まず、リリース前 / 構造変更検知時の
 * 手動 smoke 用途。
 */
import { oecd, summarizeOecdDescription } from "../src/lib/sources/oecd.ts";

interface SummaryCase {
  label: string;
  input: string;
  assert: (actual: string) => string | null; // null なら pass、文字列なら fail 理由
}

const SUMMARY_CASES: readonly SummaryCase[] = [
  {
    label: "末尾 More リンクと <p> タグを除去",
    input:
      '<p class="wp-block-paragraph">By Andreas Schleicher, OECD Director for Education and Skills Early childhood education and care.</p> <a class="more-link" href="https://oecdedutoday.com/x/">More</a>',
    assert: (actual) => {
      if (actual.includes("<")) return `< が残っている: ${actual}`;
      if (actual.includes("More")) return `末尾 More が残っている: ${actual}`;
      if (!actual.startsWith("By Andreas Schleicher")) return `本文が削れている: ${actual}`;
      return null;
    },
  },
  {
    label: "HTML エンティティ decode",
    input: "Education &#8211; the great equaliser &#8230;",
    assert: (actual) => {
      if (actual.includes("&#")) return `エンティティが残っている: ${actual}`;
      if (!actual.includes("–")) return `– が decode されていない: ${actual}`;
      if (!actual.includes("…")) return `… が decode されていない: ${actual}`;
      return null;
    },
  },
  {
    label: "200 字超は切り詰めて末尾 … を付与",
    input: `<p>${"a".repeat(300)}</p>`,
    assert: (actual) => {
      if (actual.length !== 201) return `長さ ${actual.length}(期待: 201 = 200 + …)`;
      if (!actual.endsWith("…")) return `末尾が … でない: ${actual.slice(-3)}`;
      return null;
    },
  },
  {
    label: "200 字未満は素通り(切り詰めなし)",
    input: "<p>Short summary under the limit.</p>",
    assert: (actual) => {
      if (actual.endsWith("…")) return `不要な … が付与された: ${actual}`;
      if (actual !== "Short summary under the limit.") return `想定外: ${actual}`;
      return null;
    },
  },
  {
    label: "空白の正規化(改行・連続スペース → 単一スペース)",
    input: "<p>Line one.</p>\n\n<p>Line   two.</p>",
    assert: (actual) => {
      if (actual.includes("\n")) return `改行が残っている`;
      if (/\s{2,}/.test(actual)) return `連続スペースが残っている: ${actual}`;
      if (actual !== "Line one. Line two.") return `想定外: ${actual}`;
      return null;
    },
  },
];

let unitPassed = 0;
let unitFailed = 0;
const unitFailures: string[] = [];

for (const c of SUMMARY_CASES) {
  const actual = summarizeOecdDescription(c.input);
  const failure = c.assert(actual);
  if (failure === null) {
    unitPassed++;
  } else {
    unitFailed++;
    unitFailures.push(`  [${c.label}] ${failure}`);
  }
}

console.log(
  `[check:fetch:oecd] unit: ${unitPassed} passed, ${unitFailed} failed (${SUMMARY_CASES.length} cases)`,
);
if (unitFailed > 0) {
  console.error("\n[check:fetch:oecd] UNIT FAILURES:");
  for (const f of unitFailures) console.error(f);
  process.exit(1);
}

console.log(`\n[check:fetch:oecd] fetching ${oecd.sourceId} live feed (smoke) ...`);
let articles;
try {
  articles = await oecd.fetch();
} catch (err) {
  console.error(
    `[check:fetch:oecd] FETCH FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

console.log(`[check:fetch:oecd] fetched ${articles.length} articles`);
if (articles.length === 0) {
  console.error("[check:fetch:oecd] FAIL: 0 articles returned (feed empty or parser broken)");
  process.exit(1);
}

let smokePassed = 0;
let smokeFailed = 0;
const smokeFailures: string[] = [];

for (const a of articles) {
  const issues: string[] = [];
  if (!a.title || a.title.length === 0) issues.push("title empty");
  if (!a.url || !a.url.startsWith("https://oecdedutoday.com/")) {
    issues.push(`url not under oecdedutoday.com: ${a.url}`);
  }
  if (Number.isNaN(new Date(a.publishedAt).getTime())) {
    issues.push(`publishedAt invalid: ${a.publishedAt}`);
  }
  if (a.summary && a.summary.length > 201) {
    issues.push(`summary over 201 chars: ${a.summary.length}`);
  }
  if (issues.length === 0) {
    smokePassed++;
  } else {
    smokeFailed++;
    smokeFailures.push(`  - "${a.title}" :: ${issues.join(" / ")}`);
  }
}

for (const a of articles.slice(0, 5)) {
  console.log(
    `\n  title : ${a.title}\n  url   : ${a.url}\n  pub   : ${a.publishedAt}\n  sumLen: ${a.summary?.length ?? 0}`,
  );
}

console.log(
  `\n[check:fetch:oecd] smoke: ${smokePassed} passed, ${smokeFailed} failed (${articles.length} articles)`,
);

if (smokeFailed > 0) {
  console.error("\n[check:fetch:oecd] SMOKE FAILURES:");
  for (const f of smokeFailures) console.error(f);
  process.exit(1);
}
