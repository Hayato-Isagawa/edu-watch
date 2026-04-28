/**
 * 記事データのロード層(Astro SSG 用)
 *
 * `src/data/articles/YYYY-MM-DD.json` を Vite の `import.meta.glob` で
 * 静的に集約し、表示層から扱いやすい形に整える。
 *
 * dataset の信頼境界はパイプラインの Zod バリデーション(storage.ts)で
 * 既に確認済みのため、ここでは型キャストのみとし再 parse はしない。
 */
import { ArticleList, type Article } from "./article-schema.ts";

const articleModules = import.meta.glob<Article[]>("../data/articles/*.json", {
  eager: true,
  import: "default",
});

let cachedAll: Article[] | undefined;

function loadAllSorted(): Article[] {
  if (cachedAll) return cachedAll;
  const all = Object.values(articleModules).flat();
  const validated = ArticleList.parse(all);
  validated.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  cachedAll = validated;
  return cachedAll;
}

export function getAllArticles(): Article[] {
  return loadAllSorted();
}

/**
 * 指定基準日(JST)から `days` 日前までに publishedAt がある記事を返す。
 * 並びは publishedAt 降順。
 */
export function getRecentArticles(days: number, today: Date = new Date()): Article[] {
  const all = loadAllSorted();
  const cutoffMs = today.getTime() - days * 24 * 60 * 60 * 1000;
  return all.filter((a) => new Date(a.publishedAt).getTime() >= cutoffMs);
}

export interface ArticleGroup {
  date: string;
  articles: Article[];
}

/**
 * publishedAt の年月日(JST)で記事をグループ化する。
 * 結果は新しい日付が先頭。
 */
export function groupByDate(articles: Article[]): ArticleGroup[] {
  const buckets = new Map<string, Article[]>();
  for (const a of articles) {
    const date = formatDateJst(a.publishedAt);
    const list = buckets.get(date);
    if (list) {
      list.push(a);
    } else {
      buckets.set(date, [a]);
    }
  }
  return [...buckets.entries()]
    .map(([date, list]) => ({ date, articles: list }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * UTC ISO8601 文字列を JST の `YYYY-MM-DD` に変換する。
 * publishedAt はパイプラインで UTC `T00:00:00.000Z` も含まれるため、
 * 表示単位を JST に合わせる。
 */
export function formatDateJst(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
