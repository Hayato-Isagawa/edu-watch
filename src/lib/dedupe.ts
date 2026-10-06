/**
 * 重複除去
 *
 * 記事の同一性は `Article.id`(`<sourceId>-<yyyy-mm-dd>-<sha256(canonical_url)>` 先頭 16 桁)
 * で判定する。`normalize.ts` の `generateArticleId()` が URL 正規化済みハッシュを使うため、
 * id の一致 = 同一記事と扱える(Sprint 2 設計書 §4)。
 *
 * 以下 3 つの dedupe を提供する:
 *   1. dedupeWithin(articles)          — 同一バッチ内の同じ id(同じソースが同じ URL を 2 度吐いた場合)
 *   2. dropMextTwinsOfChukyo(articles) — 同一バッチ内で中教審と同じ URL の文科省記事(ADR 0077)
 *   3. dedupeAgainstHistory(...)       — 過去 N 日分の保存済み記事と突合し、新規分だけ返す
 *
 * id の頭にはソース名が入るので、ソースを跨いだ同じ URL は 1. では落ちない。
 *
 * Phase 2 で検討する Levenshtein 距離ベースのタイトル類似度判定は本ファイルでは扱わない。
 */
import type { Article } from "./article-schema.ts";
import { loadRange } from "./storage.ts";

/**
 * 同一バッチ内の重複を排除する。先勝ちで採用順序を維持する。
 */
export function dedupeWithin(articles: Article[]): Article[] {
  const seen = new Set<string>();
  const result: Article[] = [];
  for (const a of articles) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    result.push(a);
  }
  return result;
}

/**
 * 中教審(chukyo)と同じ URL の文科省(mext)記事を落とす(ADR 0077)。
 * chukyo は mext の RSS を中教審の語で絞った派生ソースなので、中教審の記事は常に同じバッチで
 * 文科省の記事と対になる。残すのは中教審側。同じソースの同じ URL(日付を変えた出し直し)には触れない。
 */
export function dropMextTwinsOfChukyo(articles: Article[]): Article[] {
  const chukyoUrls = new Set(
    articles.filter((a) => a.sourceId === "chukyo").map((a) => a.sourceUrl)
  );
  return articles.filter(
    (a) => !(a.sourceId === "mext" && chukyoUrls.has(a.sourceUrl))
  );
}

/**
 * 過去 lookbackDays 日分の保存済み記事と id を突合し、未収録のものだけ返す。
 * `today` は `YYYY-MM-DD` 形式の文字列。デフォルトは UTC の今日。
 */
export async function dedupeAgainstHistory(
  newArticles: Article[],
  options: {
    dataDir: string;
    lookbackDays: number;
    today?: string;
  }
): Promise<Article[]> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const fromDate = shiftDate(today, -options.lookbackDays);
  const history = await loadRange(options.dataDir, fromDate, today);
  const existingIds = new Set(history.map((a) => a.id));
  return newArticles.filter((a) => !existingIds.has(a.id));
}

function shiftDate(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
