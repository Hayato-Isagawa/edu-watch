/**
 * 国立教育政策研究所(NIER)新着情報 HTML scraper
 *
 * 当初は RSS フィード(https://www.nier.go.jp/02_news/rss.xml)を採用していたが、
 * RSS の `<link>` 要素が個別記事ページではなく `/02_news/` トップや
 * カテゴリページに揃ってしまうケースが多発していた(ADR 0012)。
 * 例: 「『データ駆動型教育』の課題と実現可能性に関する調査研究」報告書 の
 *     `<link>` が `https://www.nier.go.jp/02_news/`(トップ)になる。
 *
 * ADR 0008 の「一次情報リンク必須」を実質的に満たすため、トップページ
 * `https://www.nier.go.jp/02_news/` の `<ul class="c-newslist">` を直接
 * パースする方式に切り替えた。HTML の `<a class="c-newslist__link">` の
 * href には個別記事 URL(または PDF 直リンク)が確実に入っている。
 *
 * 新着は研究報告・調査結果・シンポジウム告知・採用情報などが中心で、
 * 文科省本体と同様に全件採用する(編集の掲載基準は上位層で運用)。
 */
import * as cheerio from "cheerio";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const INDEX_URL = "https://www.nier.go.jp/02_news/";
const ORIGIN = "https://www.nier.go.jp";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * 教員・保護者の関心領域から外れる事務系採用情報(非常勤職員・期間業務職員・
 * 時間雇用職員の募集や、募集終了の通知)を弾く。
 *
 * 「教員養成」「教員研修」など教育系の記事は別パターンなので
 * 誤って弾かれない。
 */
const EXPLICIT_EXCLUDE_PATTERNS: readonly RegExp[] = [
  /期間業務職員/,
  /時間雇用職員/,
  /募集は終了/,
];

export function isNierEducationRelevant(title: string): boolean {
  return !EXPLICIT_EXCLUDE_PATTERNS.some((re) => re.test(title));
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`NIER index fetch failed: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseIsoDate(datetimeAttr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datetimeAttr)) return null;
  const d = new Date(`${datetimeAttr}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export const nier: SourceParser = {
  sourceId: "nier",
  sourceName: "国立教育政策研究所",
  layer: 1,
  language: "ja",

  async fetch(): Promise<RawArticle[]> {
    const html = await fetchHtml(INDEX_URL);
    const $ = cheerio.load(html);
    const seenUrls = new Set<string>();
    const seenTitleKeys = new Set<string>();
    const results: RawArticle[] = [];

    $("ul.c-newslist > li.c-newslist__item").each((_, li) => {
      const $li = $(li);
      const title = $li.find("a.c-newslist__link").first().text().trim();
      const href = $li.find("a.c-newslist__link").first().attr("href")?.trim();
      const datetimeAttr = $li.find("time.c-newslist__date").first().attr("datetime")?.trim();
      const category = $li.find(".c-newslist__category").first().attr("data-category")?.trim();
      if (!title || !href || !datetimeAttr) return;

      // NIER のトップページは複数の <ul class="c-newslist"> セクションに同じ記事を
      // 異なる href で再掲することがあるため、URL に加えて (title + 日付) でも
      // dedupe する
      const url = href.startsWith("http") ? href : new URL(href, ORIGIN).toString();
      const titleKey = `${title}|${datetimeAttr}`;
      if (seenUrls.has(url) || seenTitleKeys.has(titleKey)) return;
      seenUrls.add(url);
      seenTitleKeys.add(titleKey);

      // 採用情報など edu-watch のスコープから外れるタイトルを除外
      if (!isNierEducationRelevant(title)) return;

      const publishedAt = parseIsoDate(datetimeAttr);
      if (!publishedAt) return;

      results.push({
        title,
        url,
        publishedAt,
        summary: category || undefined,
      });
    });

    return results;
  },
};
