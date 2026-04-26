/**
 * 共同通信(教育/文化)教育キーワードフィルタの判定検証スクリプト
 *
 * 使い方: `npm run check:filter:kyodo`(または `npx tsx scripts/check-kyodo-filter.ts`)
 *
 * `src/lib/sources/kyodo.ts` の `isEducationRelated()` に対して、
 * 文化カテゴリで実際に流れてきそうな「教育として採用すべきもの」「採用
 * すべきでない(エンタメ・芸術・展覧会)もの」の代表サンプルを assert する。
 */
import { isEducationRelated } from "../src/lib/sources/kyodo.ts";

interface Case {
  title: string;
  summary?: string;
  expected: boolean;
  reason: string;
}

const CASES: readonly Case[] = [
  // ==== 採用すべき(true) ====
  {
    title: "全国学力テスト、英語スピーキング正答率5割",
    expected: true,
    reason: "教育キーワード(学力テスト・英語) — `教`は含まれないが学校教育の話",
    summary: "文部科学省は全国学力・学習状況調査の結果を公表した。",
  },
  {
    title: "いじめ重大事態、過去最多の1306件",
    expected: true,
    reason: "いじめキーワード — 教育トピック",
  },
  {
    title: "不登校24万人超、9年連続増加",
    expected: true,
    reason: "不登校キーワード",
  },
  {
    title: "文部科学省、教員給与の改定案を提示",
    expected: true,
    reason: "文部科学・教員のダブルヒット",
  },
  {
    title: "東京大学、推薦入試枠を拡大へ",
    expected: true,
    reason: "大学・入試のダブルヒット",
  },
  {
    title: "新学習指導要領の改定スケジュール公表",
    expected: true,
    reason: "学習指導要領キーワード",
  },
  {
    title: "返済不要の奨学金、対象を拡大",
    expected: true,
    reason: "奨学金キーワード",
  },
  {
    title: "山形の小学校で全校児童が花植え",
    expected: true,
    reason: "小学校・児童ヒット(地方話題でも教育関連として採用)",
  },

  // ==== 採用すべきでない(false) ====
  {
    title: "国宝の絵画修復が完了、京都で公開",
    expected: false,
    reason: "美術・展覧会(教育キーワードなし)",
  },
  {
    title: "人気アニメ映画、興行収入100億円突破",
    expected: false,
    reason: "エンタメ(映画・興行)",
  },
  {
    title: "重要文化財の能面、初の海外公開へ",
    expected: false,
    reason: "文化財(教育要素なし)",
  },
  {
    title: "京都国立博物館で特別展、来月開幕",
    expected: false,
    reason: "博物館展覧会(教育要素なし)",
  },
  {
    title: "舞台俳優が映画で初主演",
    expected: false,
    reason: "エンタメ(俳優・映画)",
  },
  {
    title: "和菓子職人の人間国宝、伝統技を継承",
    expected: false,
    reason: "伝統工芸(教育要素なし)",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of CASES) {
  const actual = isEducationRelated(c.title, c.summary);
  if (actual === c.expected) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  expected=${c.expected} actual=${actual}\n` +
        `  title : ${c.title}\n` +
        `  reason: ${c.reason}`,
    );
  }
}

console.log(`[check:filter:kyodo] ${passed} passed, ${failed} failed (${CASES.length} cases)`);
if (failed > 0) {
  console.error("\n[check:filter:kyodo] FAILURES:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
