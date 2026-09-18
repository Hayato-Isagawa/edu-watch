import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

// @type が Organization か、Organization で終わるサブタイプか。配列 ["Organization"] も見る。
// 見ていない @type は下の knownTypes が先に赤にするので、ここは防御の二重化(#691)
function isOrganizationType(type: unknown) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && t.endsWith("Organization"));
}

// @type が Organization(サブタイプ・配列含む)のオブジェクトを、JSON-LD の入れ子
// (Article.publisher など)まで含めて集める
function collectOrganizations(
  value: unknown,
  found: Record<string, unknown>[] = []
) {
  if (Array.isArray(value)) {
    for (const v of value) collectOrganizations(v, found);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (isOrganizationType(obj["@type"])) found.push(obj);
    for (const v of Object.values(obj)) collectOrganizations(v, found);
  }
  return found;
}

// JSON-LD に現れる全ノードの @type を集める(入れ子含む)
function collectTypes(value: unknown, found: unknown[] = []) {
  if (Array.isArray(value)) {
    for (const v of value) collectTypes(v, found);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("@type" in obj) found.push(obj["@type"]);
    for (const v of Object.values(obj)) collectTypes(v, found);
  }
  return found;
}

const siteHost = "news.edu-evidence.org";
// サイトが JSON-LD に書く @type の全部(dist の全 HTML を走査して決めた)。schema.org の
// Organization の下位クラスは 187 あり名前が Organization で終わるのは 8 つだけ(Corporation /
// NGO / OnlineBusiness 等は終わらない)なので、Organization を拾う側の網では姉妹ノードを別の型で
// 書く形が抜ける。閉じた集合で見ることで、見ていない型は何であれ赤にする(#691)
const knownTypes = ["Article", "Organization", "Person", "WebSite"];

// 型ごとに許すキーの集合。値がオブジェクトのノードは全部 @type を持ち、この表のどれかに当たる。
// 集合の外のキー(isPartOf / affiliation / sourceOrganization 等の関係語)は何であれ赤にし、
// @type の無いノード・@id だけの参照も赤にする(#700)。Organization の行は test 内の allowedKeys がそのまま使う
const nodeShapes: Record<string, string[]> = {
  Article: [
    "@context",
    "@type",
    "author",
    "datePublished",
    "dateModified",
    "description",
    "headline",
    "inLanguage",
    "keywords",
    "mainEntityOfPage",
    "publisher",
    "url",
  ],
  Organization: [
    "@context",
    "@type",
    "alternateName",
    "logo",
    "name",
    "sameAs",
    "url",
  ],
  Person: ["@type", "name", "sameAs", "url"],
  WebSite: ["@context", "@type", "description", "inLanguage", "name", "url"],
};

// JSON-LD の全ノードを形で検査する。URL 値(sameAs と @context 以外)は自サイトを指すこと —
// 姉妹サイトを WebSite ノードや文字列値で書く形を止める(#700)
function checkNodeShapes(value: unknown, where = "$") {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkNodeShapes(v, `${where}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const type = obj["@type"];
  expect(typeof type, `${where}: @type の無いノード`).toBe("string");
  const shape = nodeShapes[type as string];
  expect(
    shape,
    `${where}: 形を決めていない @type ${JSON.stringify(type)}`
  ).toBeTruthy();
  for (const [key, v] of Object.entries(obj)) {
    expect(shape, `${where}.${key}: ${type} に許していないキー`).toContain(key);
    if (key === "@context") {
      // @context をオブジェクトにすると型名やキーを別名化できる(#704)。文字列 1 形に固定し、
      // トップレベルのブロックにしか置かない
      expect(v, `${where}.@context`).toBe("https://schema.org");
      expect(where, "@context は入れ子のノードに置かない").toMatch(
        /^\$\[\d+\]$/
      );
      continue;
    }
    if (key === "sameAs") {
      // sameAs は URL 文字列の配列。Organization のファミリードメイン不在は呼び出し側が見る。
      // Person(著者)のファミリードメインは許す — 同一人物のページなので定義どおり(ADR 0071)
      expect(Array.isArray(v), `${where}.sameAs は配列`).toBe(true);
      for (const u of v as unknown[]) {
        expect(typeof u, `${where}.sameAs の要素は文字列`).toBe("string");
        expect(
          URL.canParse(u as string),
          `${where}.sameAs が URL でない: ${u}`
        ).toBe(true);
      }
      continue;
    }
    if (typeof v === "string") {
      // 前方一致 /^https?:\/\// だと `//host` や大文字スキーム・先頭空白が抜ける(#704)
      const trimmed = v.trim();
      if (/^(?:https?:)?\/\//i.test(trimmed)) {
        const url = new URL(
          trimmed.startsWith("//") ? `https:${trimmed}` : trimmed
        );
        expect(url.host, `${where}.${key} が自サイトを指していない: ${v}`).toBe(
          siteHost
        );
      }
    }
    checkNodeShapes(v, `${where}.${key}`);
  }
}

// /digest/<slug>/ の frontmatter から updatedAt を読む(無ければ null)。fallback を見るため
function readUpdatedAt(href: string): string | null {
  const slug = href.replace(/^\/digest\//, "").replace(/\/$/, "");
  const md = fs.readFileSync(
    path.resolve(process.cwd(), "src/content/digests", `${slug}.md`),
    "utf8"
  );
  const frontmatter = md.split(/^---$/m)[1] ?? "";
  const m = frontmatter.match(/^updatedAt:\s*"?([^"\n]+)"?\s*$/m);
  return m ? m[1] : null;
}

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
    // 姉妹サイトとの関係は Organization に書かない(ADR 0071)。名前で禁止すると別の関係語が
    // 抜けるので、キー集合そのものを固定する。sameAs は自組織の SNS だけで、姉妹ドメインは置かない。
    // トップレベルの 1 本目だけ見ると、2 本目のブロックや Article.publisher に書いた関係が
    // 素通りするので(#686)、ブロックを全部・入れ子も含めて集める
    for (const type of collectTypes(scripts)) {
      expect(
        knownTypes,
        `JSON-LD に見ていない @type: ${JSON.stringify(type)}`
      ).toContain(type);
    }
    checkNodeShapes(scripts);
    // トップレベルの WebSite は Layout の 1 本だけ(姉妹サイトを WebSite で足す形を止める)
    expect(scripts.filter((s) => s?.["@type"] === "WebSite")).toHaveLength(1);
    const organizations = collectOrganizations(scripts);
    expect(organizations.length).toBeGreaterThan(0);
    const allowedKeys = nodeShapes.Organization;
    for (const organization of organizations) {
      for (const key of Object.keys(organization)) {
        expect(
          allowedKeys,
          `Organization に許していないキー: ${key}`
        ).toContain(key);
      }
      // 許すキーだけで書いた姉妹組織のノードを publisher 以外のスロットに置く形は、キー検査を
      // 通る。値で見る — 集めた Organization はすべて自サイトを指す(#691)
      expect(
        new URL(String(organization.url)).host,
        `Organization の url が自サイトでない: ${organization.url}`
      ).toBe(siteHost);
      for (const url of (organization.sameAs ?? []) as string[]) {
        const host = new URL(url).hostname;
        expect(
          host === "edu-evidence.org" || host.endsWith(".edu-evidence.org")
        ).toBe(false);
      }
    }
    const topLevel = scripts.filter((s) => isOrganizationType(s?.["@type"]));
    expect(topLevel).toHaveLength(1);
    expect(Object.keys(topLevel[0]).sort()).toEqual(allowedKeys);
    const article = scripts.find((s) => s?.["@type"] === "Article");
    expect(article, "Article の JSON-LD が無い").toBeTruthy();
    // h1 は主題と週を 2 つの span に分けて描くので、空白を畳んで比べる
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(norm(article.headline)).toBe(
      norm(await page.locator("h1").first().innerText())
    );
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 更新日は frontmatter の updatedAt、無ければ publishedAt。順序(公開以降)は content.config.ts も見る
    expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(article.dateModified)).toBeGreaterThanOrEqual(
      Date.parse(article.datePublished)
    );
    const updatedAt = readUpdatedAt(href!);
    expect(article.dateModified).toBe(updatedAt ?? article.datePublished);
    expect(article.author["@type"]).toBe("Person");
    expect(article.publisher.name).toBe("EduWatch JP");
    // url は本番ドメイン固定なので、パスだけを現在地と比べる
    expect(new URL(article.url).pathname).toBe(new URL(page.url()).pathname);
    expect(article.mainEntityOfPage).toBe(article.url);
  });
});
