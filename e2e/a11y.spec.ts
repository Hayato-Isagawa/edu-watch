import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import knownIssues from "./a11y-known-issues.json" with { type: "json" };

interface AuditTarget {
  name: string;
  path: string;
}

const targets: AuditTarget[] = [
  { name: "トップページ", path: "/" },
  { name: "アーカイブ", path: "/archive/" },
  { name: "ダイジェスト一覧", path: "/digest/" },
  { name: "サイトについて", path: "/about/" },
  { name: "更新履歴", path: "/changelog/" },
];

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface KnownIssues {
  [path: string]: string[];
}
const known = knownIssues as KnownIssues;

test.describe("a11y: axe-core 自動監査", () => {
  for (const { name, path } of targets) {
    test(`${name} (${path}) — 既知違反以外に critical/serious の違反がない`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );
      const allowed = new Set(known[path] ?? []);
      const newViolations = blocking.filter((v) => !allowed.has(v.id));

      if (blocking.length > 0) {
        const summary = blocking
          .map((v) => {
            const tag = allowed.has(v.id) ? "[known]" : "[NEW]";
            return `  ${tag} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)\n    → ${v.helpUrl}`;
          })
          .join("\n");
        console.warn(`\n[a11y] ${name} (${path}):\n${summary}\n`);
      }

      expect(
        newViolations,
        `新規 critical/serious 違反: ${newViolations.map((v) => v.id).join(", ")}`
      ).toEqual([]);
    });
  }
});
