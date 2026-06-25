import { test, expect } from "@playwright/test";

const pages = [
  { name: "home", path: "/" },
  { name: "digest-index", path: "/digest" },
  { name: "digest-detail", path: "/digest/2026-06-20" },
  { name: "archive-index", path: "/archive" },
  { name: "archive-detail", path: "/archive/2026-06-20" },
  { name: "categories-index", path: "/categories" },
  { name: "category-detail", path: "/categories/ijime" },
  { name: "sources-index", path: "/sources" },
  { name: "source-detail", path: "/sources/mext" },
  { name: "about", path: "/about" },
  { name: "search", path: "/search" },
  { name: "changelog", path: "/changelog" },
  { name: "not-found", path: "/404" },
];

for (const p of pages) {
  test(p.name, async ({ page }) => {
    await page.goto(p.path, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true });
  });
}
