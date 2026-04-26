/**
 * リセマム NG ワード/PR 表記フィルタの判定検証スクリプト
 *
 * 使い方: `npm run check:filter`(または `npx tsx scripts/check-resemom-filter.ts`)
 *
 * `src/lib/sources/resemom.ts` の `isExcludedByTitle()` に対して、
 * 「除外したい既知パターン」「除外してはいけない既知パターン」の代表サンプルを
 * 入力し、判定が想定通りかを assert する。
 *
 * フィルタを更新したら本スクリプトのケースも追加し、過剰除外 / 漏れの両方を
 * 回帰防止する。
 */
import { isExcludedByTitle } from "../src/lib/sources/resemom.ts";

interface Case {
  title: string;
  expected: boolean;
  reason: string;
}

const CASES: readonly Case[] = [
  // ==== 除外すべき(true) ====
  {
    title: "【中学受験2027】サピックス小学部上位校偏差値",
    expected: true,
    reason: "受験産業色(中学受験 + 偏差値)",
  },
  {
    title: "【高校受験2026】首都圏私立高 倍率速報",
    expected: true,
    reason: "受験産業色(高校受験特集)",
  },
  {
    title: "【大学受験2027】共通テスト科目別ランキング",
    expected: true,
    reason: "受験産業色(大学受験 + ランキング)",
  },
  {
    title: "中学校選び 偏差値だけで決めない 5 つの視点",
    expected: true,
    reason: "偏差値を含むランキング系",
  },
  {
    title: "【GW2026】東京都の子供向けイベント 300 件 Web 公開",
    expected: true,
    reason: "GW 特集タイトル形式",
  },
  {
    title: "【夏休み2026】無料学習教材ランキング",
    expected: true,
    reason: "夏休み特集 + ランキング",
  },
  {
    title: "親子で行きたい 春のおでかけスポット 10 選",
    expected: true,
    reason: "おでかけ系レジャー記事",
  },
  {
    title: "PR 教育系サブスク新サービス開始",
    expected: true,
    reason: "PR 表記",
  },
  {
    title: "話題の英語学習アプリをスポンサード提供",
    expected: true,
    reason: "スポンサード表記",
  },
  {
    title: "[タイアップ] プログラミング教室の体験会",
    expected: true,
    reason: "タイアップ表記",
  },
  {
    title: "【提供】教材メーカー新製品の紹介",
    expected: true,
    reason: "【提供】表記",
  },

  // ==== 除外してはいけない(false) ====
  {
    title: "山梨県 教員採用奨学金返還補助制度を新設",
    expected: false,
    reason: "教員政策(採用 / 奨学金)— Tier 2 の中核",
  },
  {
    title: "小学校低学年スマホ所有率 初の 3 割超",
    expected: false,
    reason: "統計記事 — 教員 / 保護者双方に価値",
  },
  {
    title: "子供の勉強への AI 利用 55% の親が認める",
    expected: false,
    reason: "ICT × 教育の調査記事",
  },
  {
    title: "新宿区小学校はしか集団発生 18 人感染",
    expected: false,
    reason: "学校衛生ニュース",
  },
  {
    title: "国際天文学オリンピック 2026 日本代表 5 人決定",
    expected: false,
    reason: "STEM ニュース",
  },
  {
    title: "GIGA スクール構想 第 2 期 文科省が方針案",
    expected: false,
    reason: "GIGA は政策キーワード(NG パターンに含めない)",
  },
  {
    title: "学校改革 PRA モデルの導入事例",
    expected: false,
    reason: "PRA は単語の一部 — `\\bPR\\b` 境界で誤判定しないこと",
  },
  {
    title: "高校受験志望校選び 8 割が教育方針重視",
    expected: false,
    reason: "受験テーマだが【高校受験】特集タイトル形式ではない調査記事",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of CASES) {
  const actual = isExcludedByTitle(c.title);
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

console.log(`[check:filter:resemom] ${passed} passed, ${failed} failed (${CASES.length} cases)`);
if (failed > 0) {
  console.error("\n[check:filter:resemom] FAILURES:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
