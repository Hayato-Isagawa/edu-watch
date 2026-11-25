import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * 配信ヘッダーの CSP。手元の配信(serve)は `_headers` を適用しないので、応答ではなく
 * 配るファイルを読む。
 */
const headers = fs.readFileSync(
  path.resolve(process.cwd(), "dist/_headers"),
  "utf8"
);

function directives(line: string): Map<string, string> {
  return new Map(
    line.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")];
    })
  );
}

test("CSP が、ページの埋め込みとフォームの送信先を限る", () => {
  const policies = [
    ...headers.matchAll(/^\s+Content-Security-Policy:\s*(.+)$/gm),
  ].map((match) => directives(match[1]));
  expect(policies.length, "dist/_headers に CSP が無い").toBeGreaterThan(0);
  for (const policy of policies) {
    expect(policy.get("frame-ancestors")).toBe("'none'");
    expect(policy.get("form-action")).toBe("'self'");
  }
});
