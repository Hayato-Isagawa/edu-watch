/**
 * 教育家庭新聞 RSS parser
 *
 * RSS 2.0 — https://www.kknews.co.jp/feed
 * 取得頻度目安: 日 2〜5 本(EDIX 等の教育 ICT イベント・製品情報が中心)
 *
 * ICT・GIGA・教育 DX 領域の専門紙。Tier 2 の他媒体との差別化源として
 * 当初は全件採用していた(GIGA 関連の網羅性を担保)が、2026-05-11 の
 * 観測(直近 14 日 約 75 本)で、コンテスト/イベント告知/塾・財団告知/
 * 製品発売/食品・医薬品キャンペーンなど edu-watch の対象読者(学校教員・
 * 教育関係者)から外れる記事が約 40% を占めることが判明した。
 *
 * このため ADR 0039 で「中間強度のノイズフィルター」を導入する。
 * POSITIVE_OVERRIDE は厳格に絞り(「教員向け」「教職員向け」「学校教員」
 * のみ)、複合表記(「教員・教委向け」「中高教員向け」など)は意図的に
 * 弾く方針(過剰通過よりも過剰除外で運用を始め、取りこぼしは後続 ADR で
 * 個別救済する)。
 *
 * 利用規約(`/chizai.html`)は記事・写真・図表の転載・複写・配布に事前
 * 許諾が必要としているが、機械収集の明示禁止はなし。ADR 0008 の引用範囲
 * 遵守 5 要件で運用し、Sprint 2 完了後に `kks@kknews.co.jp` へ運用方針の
 * 確認メールを送る予定(ADR 0007 の再検討条件参照)。
 */
import Parser from "rss-parser";
import type { RawArticle, SourceParser } from "../article-schema.ts";

const FEED_URL = "https://www.kknews.co.jp/feed";
const USER_AGENT = "edu-watch/1.0 (+https://news.edu-evidence.org)";
const FETCH_TIMEOUT_MS = 10_000;

const rss = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
});

/**
 * ADR 0039 で導入。NG_PATTERNS にマッチしても、POSITIVE_OVERRIDE に
 * マッチした場合は採用する(教員向けセミナーなどは残す)。
 *
 * 厳格版: ユーザー方針(2026-05-11 セッション6)で「教員向け / 教職員向け /
 * 学校教員」のみを override 対象とする。「中高教員向け」「教員・教委向け」
 * のような複合表記は意図的に override から外し、過剰除外側でスタートする。
 */
const POSITIVE_OVERRIDE = /(教員向け|教職員向け|学校教員)/;

/**
 * ADR 0039 NG パターン群。直近 14 日の実観測から 7 カテゴリで設計:
 *
 * - コンテスト/アワード系: コンクール・オリンピック・甲子園・表現の祭典
 * - 講座/出前授業系: ワークショップ・公開講座・出前/出張授業・キックオフ講座
 * - イベント告知系: ウェビナー・シンポジウム・フォーラム・サミット・勉強会・説明会・セミナー
 * - 募集系: 応募受付・参加申込・希望校/生徒/受講生募集・エントリー・実施校募集
 * - 商業告知系: 販売開始・発売・発行・キャンペーン
 * - 塾/財団/協会主催系: 「(財団|塾|予備校|協会) + 募集/開催/主催」
 * - 食品・医薬品など教員業務外: 冷凍食品・お弁当・点鼻液・栄養ドリンク・スピジア
 *
 * 「セミナー」を NG に含める代わりに POSITIVE_OVERRIDE で「教員向けセミナー」
 * 等を救う構造。汎用語(イベント・連携・導入)は誤検出を避けるため含めない。
 */
const NG_PATTERNS: readonly RegExp[] = [
  // コンテスト/アワード系
  /(アワード|コンクール|コンテスト|コンペ|オリンピック|甲子園|表現の祭典)/,
  // 講座/出前授業系
  /(ワークショップ|公開講座|出前授業|出張授業|キックオフ講座|特別授業)/,
  // イベント告知系(「セミナー」は POSITIVE_OVERRIDE で救う)
  /(ウェビナー|シンポジウム|フォーラム|サミット|オンラインイベント|勉強会|説明会|セミナー)/,
  // 募集系
  /(応募受付|参加申込|希望校.{0,5}募集|生徒募集|受講生募集|エントリー受付|参加.{0,10}募集中|実施校.{0,5}募集)/,
  // 商業告知系
  /(?:を販売|販売(?:を?開始|中)|発売|を発行|キャンペーン)/,
  // 塾/財団/協会主催系(タイトル中の修飾文が長いため文字数幅を 50 まで許容)
  /(財団|塾|予備校|協会).{0,50}(募集|開催|主催)/,
  // 食品・医薬品など教員業務外
  /(冷凍食品|お弁当|点鼻液|栄養ドリンク|スピジア)/,
];

export function isExcludedByTitle(title: string): boolean {
  if (POSITIVE_OVERRIDE.test(title)) return false;
  return NG_PATTERNS.some((pattern) => pattern.test(title));
}

export const kkn: SourceParser = {
  sourceId: "kkn",
  sourceName: "教育家庭新聞",
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
