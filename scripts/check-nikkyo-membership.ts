/**
 * 日本教育新聞 paywall 判別ロジックの判定検証スクリプト(ADR 0021)
 *
 * 使い方: `npm run check:membership:nikkyo`
 *
 * `src/lib/sources/nikkyo.ts` の `detectMembershipFromArticleScope()` に対し、
 * 「paywall を示す既知パターン」「paywall ではない既知パターン」の代表サンプルを
 * 入力し、判定が想定通りかを assert する。
 *
 * 4 マーカーいずれかで true 判定する OR ロジックの回帰防止。
 */
import { detectMembershipFromArticleScope } from "../src/lib/sources/nikkyo.ts";

interface Case {
  name: string;
  scope: string;
  expected: boolean;
  reason: string;
}

const CASES: readonly Case[] = [
  // ==== paywall: true ====
  {
    name: "lock icon class only",
    scope: '<div><i class="fas fa-lock"></i><p>続きを読みたい方は、…</p></div>',
    expected: true,
    reason: "ADR 0021 マーカー2: lock アイコン",
  },
  {
    name: "locked-article-login-button class only",
    scope: '<a class="locked-article-login-button--override">ログイン</a>',
    expected: true,
    reason: "ADR 0021 マーカー3: lock 専用ボタンクラス",
  },
  {
    name: "required-text only",
    scope: "<p>日本教育新聞電子版に会員登録する必要がございます。</p>",
    expected: true,
    reason: "ADR 0021 マーカー4: 確定文言",
  },
  {
    name: "ADR 0013 keyword co-occurrence",
    scope: "<p>会員登録してください</p><h2>ログインして続きを読む</h2>",
    expected: true,
    reason: "ADR 0013 マーカー1: 会員登録 + ログインして",
  },
  {
    name: "all four markers present (real sample-like)",
    scope:
      '<div><i class="fas fa-lock"></i><p>続きを読みたい方は、日本教育新聞電子版に会員登録する必要がございます。</p>' +
      '<h2>ログインして続きを読む</h2><a class="locked-article-login-button">ログイン</a></div>',
    expected: true,
    reason: "実サンプル相当(全マーカー揃い)",
  },

  // ==== paywall: false ====
  {
    name: "free article (none of markers)",
    scope: "<p>本文のみで終わる無料記事のスコープ。リンクなし。</p>",
    expected: false,
    reason: "無料記事(マーカーゼロ)",
  },
  {
    name: "「会員登録」word in body but no other marker",
    scope: "<p>本記事は団体の会員登録方針を取り上げる。</p>",
    expected: false,
    reason:
      "本文中の「会員登録」単独はサイト機能ではなく記事内容なので false に保つ(ログインしてとの AND が要件)",
  },
  {
    name: "「ログインして」word alone in unrelated context",
    scope: "<p>外部サービスの管理画面にログインして利用する手順を述べる。</p>",
    expected: false,
    reason: "「ログインして」単独は paywall マーカーではない",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of CASES) {
  const actual = detectMembershipFromArticleScope(c.scope);
  if (actual === c.expected) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  expected=${c.expected} actual=${actual}\n` +
        `  case  : ${c.name}\n` +
        `  reason: ${c.reason}`,
    );
  }
}

console.log(
  `[check:membership:nikkyo] ${passed} passed, ${failed} failed (${CASES.length} cases)`,
);
if (failed > 0) {
  console.error("\n[check:membership:nikkyo] FAILURES:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
