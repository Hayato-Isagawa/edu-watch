/**
 * 日本教育新聞 RSS parser
 *
 * RSS 2.0 — https://www.kyoiku-press.com/rss
 * 取得頻度目安: 日 3〜5 本
 *
 * 教員・教育行政向けの専門紙(1953 年創刊、週刊紙面)。読者像が edu-watch の
 * Tier 2 ターゲットそのものなので、フィルタは設けず全件採用する。
 *
 * 利用規約は現時点で `/copyright` ページが 404、フッターに「無断転載禁止」
 * とのみ記載がある。ADR 0008 の引用範囲遵守 5 要件で運用し、媒体側からの
 * 照会があれば一時停止のうえ協議する。
 *
 * 一部記事は電子版会員(有料)登録が必要。RSS には判別マーカーがないため、
 * 個別記事 HTML を取得して以下 4 マーカーの OR 判定で paywall を検出する
 * (ADR 0013 採用、ADR 0021 で OR 化):
 *   - キーワード共起: `<article>` 内に「会員登録」+「ログインして」(ADR 0013 由来)
 *   - lock アイコンクラス: `fas fa-lock`(paywall ブロック装飾)
 *   - lock 専用ボタンクラス: `locked-article-login-button`
 *   - 確定文言: 「日本教育新聞電子版に会員登録する必要」
 *
 * 4 マーカーは 2026-05-02 実測で 30 件中 15 件で完全一致(全マーカーが揃う / 全
 * マーカーが揃わないの二択)。OR 化はテンプレ変更で 1 つのマーカーが消えても
 * 残りで検出可能にするためのフェイルセーフ。
 *
 * 判別失敗時は undefined のまま進める(取り込み自体はブロックしない)。
 * 公開直後は無料・後から paywall 化される運用が観測されており、過去記事の
 * 再判定は別仕組み(ADR 0021 §残タスク)で扱う。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.kyoiku-press.com/rss";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;
const ARTICLE_FETCH_TIMEOUT_MS = 8_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * `<article>` 領域の HTML テキストに対し、paywall を示す 4 マーカーいずれかが
 * あれば true を返す純粋関数。テスト容易性のために fetch から分離。
 */
export function detectMembershipFromArticleScope(scope: string): boolean {
  if (scope.includes("locked-article-login-button")) return true;
  if (scope.includes("fas fa-lock")) return true;
  if (scope.includes("日本教育新聞電子版に会員登録する必要")) return true;
  if (scope.includes("会員登録") && scope.includes("ログインして")) return true;
  return false;
}

async function detectMembershipRequired(url: string): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const articleStart = html.indexOf("<article");
    const articleEnd = articleStart >= 0 ? html.indexOf("</article>", articleStart) : -1;
    const scope = articleStart >= 0 && articleEnd > articleStart
      ? html.slice(articleStart, articleEnd)
      : html;
    return detectMembershipFromArticleScope(scope);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export const nikkyo: SourceParser = {
  sourceId: "nikkyo",
  sourceName: "日本教育新聞",
  layer: 2,
  language: "ja",

  async fetch(): Promise<RawArticle[]> {
    const feed = await rss.parseURL(FEED_URL);
    const drafts: { title: string; url: string; publishedAt: string; summary?: string }[] = [];
    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();
      const pubRaw = item.isoDate ?? item.pubDate;
      if (!title || !url || !pubRaw) continue;

      const published = new Date(pubRaw);
      if (Number.isNaN(published.getTime())) continue;

      drafts.push({
        title,
        url,
        publishedAt: published.toISOString(),
        summary: item.contentSnippet?.trim() || item.content?.trim() || undefined,
      });
    }

    const memberships = await Promise.all(drafts.map((d) => detectMembershipRequired(d.url)));
    return drafts.map((d, i) => {
      const requiresMembership = memberships[i];
      return requiresMembership === true
        ? { ...d, requiresMembership: true }
        : d;
    });
  },
};
