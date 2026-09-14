import { test, expect } from "@playwright/test";

test.describe("ダイジェストの構造化データ", () => {
  test("digest 詳細に Article の JSON-LD があり、見出し・日付・発行者が本文と一致する", async ({
    page,
  }) => {
    await page.goto("/digest/");
    const href = await page
      .locator('main a[href^="/digest/20"]')
      .first()
      .getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    const scripts = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) =>
        els.map((el) => JSON.parse(el.textContent ?? "null"))
      );
    const types = scripts.map((s) => s?.["@type"]);
    expect(types).toContain("Organization");
    const article = scripts.find((s) => s?.["@type"] === "Article");
    expect(article, "Article の JSON-LD が無い").toBeTruthy();
    // h1 は主題と週を 2 つの span に分けて描くので、空白を畳んで比べる
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(norm(article.headline)).toBe(
      norm(await page.locator("h1").first().innerText())
    );
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(article.author["@type"]).toBe("Person");
    expect(article.publisher.name).toBe("EduWatch JP");
    // url は本番ドメイン固定なので、パスだけを現在地と比べる
    expect(new URL(article.url).pathname).toBe(new URL(page.url()).pathname);
    expect(article.mainEntityOfPage).toBe(article.url);
  });
});
