/**
 * 全記事の sourceUrl をスキャンしてリンク切れを抽出する(削除はしない)。
 *
 * 実装: HEAD リクエストでステータスを確認、HEAD を許可しないサーバには
 * GET にフォールバック。リダイレクトは追跡する。並列実行で短時間化。
 *
 * 4xx / 5xx は「リンク切れ候補」として出力。
 *
 * 使い方: `npx tsx scripts/check-broken-links.ts [--concurrency 15]`
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ArticleList, type Article } from "../src/lib/article-schema.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "../src/data/articles");
const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 15;

interface CheckResult {
  article: Article;
  status: number | "timeout" | "error";
  finalUrl?: string;
}

async function probe(url: string): Promise<{ status: number | "timeout" | "error"; finalUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
    }
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { status: "timeout" };
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

async function main() {
  const concurrencyArg = process.argv.indexOf("--concurrency");
  const concurrency =
    concurrencyArg >= 0 && process.argv[concurrencyArg + 1]
      ? parseInt(process.argv[concurrencyArg + 1], 10)
      : DEFAULT_CONCURRENCY;

  const entries = (await readdir(DATA_DIR)).filter((n) => FILENAME_PATTERN.test(n)).sort();
  const all: Article[] = [];
  for (const name of entries) {
    const list = ArticleList.parse(JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")));
    all.push(...list);
  }

  console.log(`[broken-links] checking ${all.length} articles (concurrency=${concurrency})...`);
  const startedAt = Date.now();

  const results = await pool<Article, CheckResult>(all, concurrency, async (a) => {
    const r = await probe(a.sourceUrl);
    return { article: a, status: r.status, finalUrl: r.finalUrl };
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const broken: CheckResult[] = [];
  const errors: CheckResult[] = [];
  for (const r of results) {
    if (typeof r.status === "number") {
      if (r.status >= 400) broken.push(r);
    } else {
      errors.push(r);
    }
  }

  console.log(`[broken-links] done in ${elapsed}s`);
  console.log(`[broken-links] OK:     ${all.length - broken.length - errors.length}`);
  console.log(`[broken-links] broken: ${broken.length} (4xx/5xx)`);
  console.log(`[broken-links] errors: ${errors.length} (timeout/network)`);

  if (broken.length > 0) {
    console.log("\n--- broken links (4xx/5xx) ---");
    for (const r of broken) {
      console.log(
        `  ${r.status}  ${r.article.publishedAt.slice(0, 10)}  ${r.article.id}\n        ${r.article.sourceUrl}\n        ${r.article.title.slice(0, 80)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.log("\n--- errors (timeout/network) ---");
    for (const r of errors) {
      console.log(
        `  ${r.status}  ${r.article.publishedAt.slice(0, 10)}  ${r.article.id}\n        ${r.article.sourceUrl}\n        ${r.article.title.slice(0, 80)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
