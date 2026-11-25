import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * 配信ヘッダーの CSP。手元の配信(serve)は `_headers` を適用しないので、応答ではなく
 * 配るファイルを読む。
 */
const readHeaders = () =>
  fs.readFileSync(path.resolve(process.cwd(), "dist/_headers"), "utf8");

function directives(line: string): Map<string, string> {
  return new Map(
    // 同じ指定が 2 つあると、先に書いた方が効く(Map は後勝ちなので逆順に入れる)
    line
      .split(";")
      .reverse()
      .map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(" ")];
      })
  );
}

test("CSP が、ページの埋め込みとフォームの送信先を限る", () => {
  const headers = readHeaders();
  // 全ページに効く `/*` の中にあること。ほかの経路で外したり弱めたりしていないこと
  const everywhere = headers.match(/^\/\*\n((?:[ \t].*\n?)+)/m)?.[1] ?? "";
  expect(everywhere).toMatch(/^\s+Content-Security-Policy:/m);
  expect(headers.match(/^\s+!.*$/gm) ?? []).toEqual([]);
  const policies = [
    ...headers.matchAll(/^\s+Content-Security-Policy:\s*(.+)$/gim),
  ].map((match) => directives(match[1]));
  expect(policies).toHaveLength(1);
  for (const policy of policies) {
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("form-action")).toBe("'self'");
  }
});
