import { test, expect } from "@playwright/test";

/**
 * 印刷(研修資料としての持ち出し)。global.css の @media print ブロックが効いていることを見る。
 * ダークで印刷した場合を見る — 配色の戻し忘れはライトでは検出できない。
 * 最新のダイジェスト詳細(本文リンク・記事カード・シェアボタン)と about(静的な外部リンク)で
 * 代表する。トップは直近 7 日の記事データに依存し、収集が止まると外部リンクが 0 件になるので
 * URL 併記の断定には使わない。
 */

async function latestDigestPath(page: import("@playwright/test").Page) {
  await page.goto("/digest/");
  const href = await page
    .locator('main a[href^="/digest/20"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

test.describe("印刷スタイル", () => {
  test.use({ colorScheme: "dark" });

  for (const target of [
    { name: "最新ダイジェスト", path: latestDigestPath },
    { name: "/about/", path: async () => "/about/" },
  ]) {
    test(`${target.name} はナビを省き、配布用の体裁になる`, async ({ page }) => {
      const path = await target.path(page);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.emulateMedia({ media: "print" });

      // 画面用の chrome は消える
      await expect(page.locator("#back-to-top")).toBeHidden();
      await expect(page.getByLabel("メインナビゲーション")).toBeHidden();
      await expect(page.locator("#menu-toggle")).toBeHidden();
      await expect(page.locator(".mobile-menu")).toBeHidden();
      // フッターは「探す」「サイト」の列と説明文・購読を落とす
      await expect(
        page.locator("body > footer > div:first-child > div:nth-child(2)")
      ).toBeHidden();
      await expect(
        page.locator("body > footer > div:first-child > div:nth-child(3)")
      ).toBeHidden();
      // 出所・連絡先・ライセンス表示は残る。toContainText は textContent を読むので
      // display:none でも通ってしまう — 描画されていることを見る
      await expect(
        page.locator(".site-header").getByText("EduWatch")
      ).toBeVisible();
      const footer = page.locator("body > footer");
      await expect(footer.getByText("news@edu-evidence.org")).toBeVisible();
      await expect(footer.getByText("CC BY-SA 4.0")).toBeVisible();
      await expect(footer.getByText("©")).toBeVisible();

      // sticky を解き、配色をライトへ戻す(data-theme は dark のまま)
      const computed = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          headerPosition: getComputedStyle(
            document.querySelector(".site-header")!
          ).position,
          htmlBackground: root.backgroundColor,
          accent: root.getPropertyValue("--color-accent").trim(),
        };
      });
      expect(computed.headerPosition).toBe("static");
      expect(computed.htmlBackground).toBe("rgb(255, 255, 255)");
      expect(computed.accent).toBe("#1e4a6e");

      // 外部リンクは URL を併記する
      const external = page.locator('main a[target="_blank"]').first();
      const href = await external.getAttribute("href");
      expect(href).toMatch(/^https?:\/\//);
      const after = await external.evaluate(
        (el) => getComputedStyle(el, "::after").content
      );
      expect(after).toContain(href!);
    });
  }

  test("最新ダイジェストは本文リンクを黒の下線にし、シェアボタンと媒体バッジの塗りを消す", async ({
    page,
  }) => {
    await page.goto(await latestDigestPath(page));
    await page.emulateMedia({ media: "print" });

    await expect(page.locator(".share-link-button")).toBeHidden();
    await expect(page.locator("#reading-progress")).toBeHidden();

    // 本文リンクはページ内 <style is:global> がアクセント色を塗るので、print 側が勝って
    // いることを見る。toHaveCSS は色の transition(150ms)が終わるまで待つ
    const bodyLink = page.locator("main .prose-digest a").first();
    await expect(bodyLink).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(bodyLink).toHaveCSS("text-decoration-line", "underline");

    // 媒体バッジは色地に白文字の inline style。印刷の既定は背景を刷らないので輪郭型に落とす
    const badge = page.locator("[data-source]").first();
    await expect(badge).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(badge).toHaveCSS("color", "rgb(0, 0, 0)");
  });

  for (const target of [
    { name: "最新ダイジェスト", path: latestDigestPath },
    { name: "/about/", path: async () => "/about/" },
  ]) {
    test(`${target.name} は 320px でも横に溢れない`, async ({ page }) => {
      const path = await target.path(page);
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(path);
      await page.emulateMedia({ media: "print" });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});
