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

// ライト / ダークの双方を検査する。ダークだけで落ちる配色を取り逃がさないため
const themes = ["light", "dark"] as const;

// 既定の幅のほかに、スマートフォンの幅でも検査する。押せる大きさ(target-size)の違反は
// 狭い幅でだけ出ることがある
const widths = [undefined, 375] as const;

test.describe("a11y: axe-core 自動監査", () => {
  for (const theme of themes) {
    for (const { name, path } of targets) {
      for (const width of widths) {
        test(`[${theme}${width ? ` ${width}px` : ""}] ${name} (${path}) — 既知違反以外に critical/serious の違反がない`, async ({
          page,
        }) => {
          if (width) await page.setViewportSize({ width, height: 812 });
          // 読み込み後に data-theme を差し替えると色の遷移の途中を axe が拾うので、先に保存しておく
          await page.addInitScript(
            (t) => localStorage.setItem("theme", t),
            theme
          );
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme
          );
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
            console.warn(
              `\n[a11y] [${theme}] ${name} (${path}):\n${summary}\n`
            );
          }

          expect(
            newViolations,
            `新規 critical/serious 違反: ${newViolations.map((v) => v.id).join(", ")}`
          ).toEqual([]);
        });
      }
    }
  }
});
