/**
 * リセマム RSS parser
 *
 * RSS 2.0 (RDF) — https://resemom.jp/rss20/index.rdf
 * 取得頻度目安: 平日 13〜15 本/日、土日 1〜3 本(週 47 本ペース)
 *
 * リセマムは保護者向けの教育情報サイトのため、edu-watch の編集方針(対象読者を
 * 学校教員・教育関係者に統一、ADR 0018)に合わない記事(受験産業色の強いもの・
 * 季節レジャー特集・PR / タイアップ表記のあるもの・親子向け体験イベント・児童
 * 生徒個別の参加募集・スクール開校 PR・キャリア意識調査など)はパーサー段階で
 * 除外する。フィルタは過剰除外を避ける「緩めの NG ワード方式」で運用しながら
 * NG リストを育てる方針(ADR 0007 / 0019)。教員視点で関連する政策・調査
 * (家庭との連携・情報モラル指導・進路指導・経済格差と学習機会など)は引き続き採用する。
 *
 * 利用規約上は機械収集の明示禁止なし、robots.txt で ClaudeBot への
 * Crawl-delay: 5 が指定されているため、本パーサーも 5 秒間隔の運用を遵守する
 * (連続呼び出しが必要な場面では呼び出し側で間隔調整)。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://resemom.jp/rss20/index.rdf";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * タイトルが除外対象かどうかを判定する純粋関数。
 *
 * 既存(ADR 0007 ベース):
 * - 受験産業色: `偏差値`、`ランキング`、`【中学受験`、`【高校受験`、`【大学受験`
 * - 季節レジャー: `おでかけ`、`GW`、`夏休み`、`冬休み`、`春休み` の特集タイトル
 * - 広告表記: `PR`、`スポンサード`、`タイアップ`、`【提供】`
 *
 * ADR 0019 で追加:
 * - 親子向け / 商業施設の体験イベント: `キッザニア`、`ディズニー(で|×|の|...)`、
 *   `サンシャイン水族館`、`ハリ(ーポッター|ポタ)`、`スタディツアー`、`謎解き`、
 *   `親子(フェア|フェス|見学|...)` ほか
 * - 児童生徒個別の参加募集 / コンクール / 講座: `(小学生|中高生|...)` + 募集語
 * - スクール紹介: `教育フェア`、`プリスクール`、`インターナショナルスクール`
 * - 個別奨学金 / 個別給付: `奨学金.{募集}` パターン、`最大\d+万円.{給付}`
 * - キャリア意識調査(児童生徒主観): `なりたい職業`、`つきたい職業`
 * - 家庭ライフスタイル: `読み聞かせ`
 *
 * 教育政策・教員支援・統計調査・ICT 系の記事はここで弾かないように、
 * 各パターンは語の組み合わせで誤検出を抑える(例: `奨学金` だけでは弾かず
 * 「学生 → 奨学金 → 募集」の順を要求し、`教員採用で奨学金返還補助` は通す)。
 */
const NG_PATTERNS: readonly RegExp[] = [
  // 受験産業色
  /偏差値/,
  /ランキング/,
  /【中学受験/,
  /【高校受験/,
  /【大学受験/,
  // 季節レジャー特集
  /おでかけ/,
  /【GW\d{0,4}】/,
  /【夏休み\d{0,4}】/,
  /【冬休み\d{0,4}】/,
  /【春休み\d{0,4}】/,
  // 広告表記
  /\bPR\b/,
  /スポンサード/,
  /タイアップ/,
  /【提供】/,
  // 親子・商業施設の体験イベント(ADR 0019)
  /キッザニア/,
  /ディズニー(?:で|×|の|ランド|シー|リゾート)/,
  /サンシャイン水族館/,
  /ハリ(?:ーポッター|ポタ)/,
  /スタディツアー/,
  /謎解き/,
  /親子(?:フェア|フェス|見学|遠足|招待|防災|で学ぶ|向け)/,
  // 児童生徒個別の参加募集 / コンクール / 講座(ADR 0019)
  /(?:小学生|中学生|高校生|中高生|10代|U\d+|児童|生徒|未就学児).{0,15}(?:募集|コンクール|コンテスト|大会|発表会|無料.{0,5}講座|向け.{0,10}(?:講座|プログラム|プロジェクト))/,
  /メンバー募集/,
  // スクール紹介(ADR 0019)
  /(?:国際)?教育フェア/,
  /プリスクール/,
  /インターナショナルスクール/,
  // 個別奨学金 / 個別給付(ADR 0019)
  /(?:学生|中高生|高校生).{0,10}奨学金.{0,10}募集/,
  /(?:中高生|高校生|生徒|児童).{0,10}最大\d+万円.{0,5}給付/,
  // キャリア意識調査(児童生徒主観、ADR 0019)
  /(?:なりたい|つきたい|憧れの).{0,3}職業/,
  /子供[・･]孫/,
  /\d{4}年卒.{0,5}就職/,
  // 家庭ライフスタイル(ADR 0019)
  /読み聞かせ/,
  /テーマパーク/,
  /ショッピングモール/,
  /住宅補助/,
  /熱中症.{0,5}(?:住居|発生場所|住宅|家庭)/,
];

export function isExcludedByTitle(title: string): boolean {
  return NG_PATTERNS.some((pattern) => pattern.test(title));
}

export const resemom: SourceParser = {
  sourceId: "resemom",
  sourceName: "リセマム",
  layer: 2,
  language: "ja",

  async fetch(): Promise<RawArticle[]> {
    const feed = await rss.parseURL(FEED_URL);
    const results: RawArticle[] = [];
    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();
      const pubRaw = item.isoDate ?? item.pubDate;
      if (!title || !url || !pubRaw) continue;
      if (isExcludedByTitle(title)) continue;

      const published = new Date(pubRaw);
      if (Number.isNaN(published.getTime())) continue;

      results.push({
        title,
        url,
        publishedAt: published.toISOString(),
        summary: item.contentSnippet?.trim() || item.content?.trim() || undefined,
      });
    }
    return results;
  },
};
