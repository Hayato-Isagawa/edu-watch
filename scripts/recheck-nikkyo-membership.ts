/**
 * 日本教育新聞 paywall 再判定スクリプト(ADR 0022)
 *
 * GitHub Actions(weekly cron + workflow_dispatch)から呼ばれる本番エントリ。
 *
 * 目的: 公開直後は無料 → 後日 paywall 化される運用を追跡し、`requiresMembership`
 * を片方向(false / undefined → true)で後付け更新する。
 *
 * 処理の流れ:
 *   1. 直近 LOOKBACK_DAYS 日分の article JSON を `loadRange` で読み込む
 *   2. `sourceId === "nikkyo"` かつ `requiresMembership !== true` の記事を抽出
 *   3. 各 URL を並列(度数 PARALLELISM)で fetch、`<article>` スコープを抽出して
 *      `detectMembershipFromArticleScope()` で判定
 *   4. true になった記事を日付ごとにグループ化し、`applyMembershipUpdates` で書き戻す
 *   5. CI 側で `git diff` を見て変更があれば bot PR を作成する
 *
 * 設計方針:
 *   - 既に `requiresMembership === true` の記事は再判定しない(片方向 / 無駄な fetch 削減)
 *   - 5xx / タイムアウト / ネットワーク障害は当該記事をスキップ(false にダウングレードしない)
 *   - `mergeDay` は触らない。`applyMembershipUpdates` で `requiresMembership` のみ更新
 *   - parser とは別タイミングの取り込みなので、`detectMembershipFromArticleScope` は
 *     nikkyo.ts から re-export して論理一貫性を保つ
 *
 * 終了コード:
 *   - 0: 正常終了(変更件数は stdout に出力)
 *   - 1: 致命的エラー(JSON 読み込み失敗 / 全 URL fetch 失敗など)
 */
import path from "node:path";
import { loadRange } from "../src/lib/storage.ts";
import { applyMembershipUpdates } from "../src/lib/storage.ts";
import { detectMembershipFromArticleScope } from "../src/lib/sources/nikkyo.ts";
import type { Article } from "../src/lib/article-schema.ts";

const DATA_DIR = path.resolve("src/data/articles");
const LOOKBACK_DAYS = 30;
const PARALLELISM = 5;
const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";

interface ProbeResult {
  id: string;
  date: string;
  url: string;
  outcome: "paywalled" | "free" | "skipped";
  reason?: string;
}

async function probe(article: Article): Promise<ProbeResult> {
  const date = article.publishedAt.slice(0, 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(article.sourceUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { id: article.id, date, url: article.sourceUrl, outcome: "skipped", reason: `http ${res.status}` };
    }
    const html = await res.text();
    const aStart = html.indexOf("<article");
    const aEnd = aStart >= 0 ? html.indexOf("</article>", aStart) : -1;
    const scope =
      aStart >= 0 && aEnd > aStart ? html.slice(aStart, aEnd) : html;
    return {
      id: article.id,
      date,
      url: article.sourceUrl,
      outcome: detectMembershipFromArticleScope(scope) ? "paywalled" : "free",
    };
  } catch (err) {
    return {
      id: article.id,
      date,
      url: article.sourceUrl,
      outcome: "skipped",
      reason: err instanceof Error ? err.message : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeWithLimit(
  articles: readonly Article[],
  parallelism: number,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= articles.length) return;
      const r = await probe(articles[i]);
      results.push(r);
    }
  }
  const workers = Array.from({ length: Math.min(parallelism, articles.length) }, worker);
  await Promise.all(workers);
  return results;
}

function shiftDate(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = shiftDate(today, -LOOKBACK_DAYS);
  console.log(
    `[recheck-nikkyo] start range ${fromDate} → ${today} (lookback ${LOOKBACK_DAYS} days)`,
  );

  const all = await loadRange(DATA_DIR, fromDate, today);
  const candidates = all.filter(
    (a) => a.sourceId === "nikkyo" && a.requiresMembership !== true,
  );
  const alreadyTrue = all.filter(
    (a) => a.sourceId === "nikkyo" && a.requiresMembership === true,
  ).length;
  console.log(
    `[recheck-nikkyo] candidates=${candidates.length} alreadyTrue=${alreadyTrue} (out of ${
      all.filter((a) => a.sourceId === "nikkyo").length
    } nikkyo articles in range)`,
  );

  if (candidates.length === 0) {
    console.log("[recheck-nikkyo] no candidates, done");
    return 0;
  }

  const results = await probeWithLimit(candidates, PARALLELISM);
  const paywalled = results.filter((r) => r.outcome === "paywalled");
  const skipped = results.filter((r) => r.outcome === "skipped");

  console.log(
    `[recheck-nikkyo] probe done: paywalled=${paywalled.length} free=${
      results.length - paywalled.length - skipped.length
    } skipped=${skipped.length}`,
  );
  for (const s of skipped) {
    console.warn(`[recheck-nikkyo] skipped ${s.id}: ${s.reason ?? "unknown"}`);
  }

  if (paywalled.length === 0) {
    console.log("[recheck-nikkyo] no new paywall transitions, done");
    return 0;
  }

  const byDate = new Map<string, Map<string, true>>();
  for (const p of paywalled) {
    const m = byDate.get(p.date) ?? new Map<string, true>();
    m.set(p.id, true);
    byDate.set(p.date, m);
  }

  let totalChanged = 0;
  for (const [date, updates] of byDate) {
    const { changed, total } = await applyMembershipUpdates(DATA_DIR, date, updates);
    totalChanged += changed;
    console.log(
      `[recheck-nikkyo] ${date}: changed ${changed} (file total ${total})`,
    );
  }

  console.log(
    `[recheck-nikkyo] done: ${totalChanged} article(s) flipped to requiresMembership=true across ${byDate.size} day file(s)`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[recheck-nikkyo] uncaught error:", err);
    process.exit(1);
  });
