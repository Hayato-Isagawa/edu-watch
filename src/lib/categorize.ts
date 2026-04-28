/**
 * カテゴリ分類(MVP: キーワードマッチ + sourceId デフォルト)
 *
 * title + summary をキーワードで走査し、該当するカテゴリを最大 3 つ付与する。
 * 該当なしのとき、sourceId に応じたデフォルトカテゴリ(政府機関 → 政策・制度、
 * 国研 → 研究・エビデンス)にフォールバックし、それでも該当しなければ「その他」。
 *
 * 過去の初版は title + summary だけで判定していたため、mext / chukyo の
 * summary 欠損 + 事務的タイトル(「配付資料」「審議会(第N回)」)で
 * ほぼ全件「その他」に流れていた(ADR 0014)。
 *
 * 将来 LLM 分類に置き換える際は、本ファイルを差し替えて同じ `categorize(input)` の
 * 署名を維持する。
 */
import type { Article, ArticleCategory, RawArticle } from "./article-schema.ts";

interface CategoryRule {
  category: Article["categories"][number];
  patterns: RegExp[];
}

const RULES: CategoryRule[] = [
  {
    category: "いじめ",
    patterns: [/いじめ/, /重大事態/, /いじめ防止対策推進法/],
  },
  {
    category: "不登校",
    patterns: [
      /不登校/,
      /登校拒否/,
      /COCOLO/,
      /教育支援センター/,
      /別室登校/,
      /教育機会確保法/,
      /フリースクール/,
    ],
  },
  {
    category: "ICT / GIGA",
    patterns: [
      /GIGA/,
      /ICT/,
      /タブレット/,
      /デジタル教科書/,
      /1\s*人\s*1\s*台/,
      /端末/,
      /生成\s*AI/i,
      /\bAI\b/,
      /校務\s*DX/,
      /教育\s*DX/,
      /プログラミング教育/,
      /情報教育/,
      /STEM/i,
      /STEAM/i,
    ],
  },
  {
    category: "政策・制度",
    patterns: [
      /答申/,
      /中教審/,
      /中央教育審議会/,
      /学習指導要領/,
      /法改正/,
      /通知/,
      /告示/,
      /告知/,
      /文部科学省/,
      /文科省/,
      /こども家庭庁/,
      /審議会/,
      /ワーキング\s*グループ/,
      /\bWG\b/,
      /配付資料/,
      /配布資料/,
      /指針/,
      /ガイドライン/,
      /諮問/,
      /省令/,
      /政令/,
      /概算要求/,
      /教育委員会/,
      /教育振興基本計画/,
      /改訂/,
    ],
  },
  {
    category: "研究・エビデンス",
    patterns: [
      /研究/,
      /調査結果/,
      /メタ分析/,
      /エビデンス/,
      /RCT/i,
      /実証/,
      /学力調査/,
      /学習状況調査/,
      /全国学力/,
      /実態調査/,
      /分析/,
      /報告書/,
      /シンポジウム/,
      /公表/,
      /統計/,
    ],
  },
  {
    category: "国際・海外",
    patterns: [/OECD/i, /PISA/i, /EEF/i, /TALIS/i, /ユネスコ/, /UNESCO/i, /国際比較/, /海外/],
  },
  {
    category: "教員・働き方",
    patterns: [
      /教員/,
      /教師/,
      /教職/,
      /働き方/,
      /給特法/,
      /残業/,
      /志望者/,
      /採用/,
      /研修/,
      /教員養成/,
      /教育職員/,
      /養護教諭/,
      /栄養教諭/,
      /校長/,
      /学校現場/,
      /働き方改革/,
    ],
  },
];

/**
 * sourceId ごとのデフォルトカテゴリ(キーワード未ヒット時のフォールバック)。
 * mext / chukyo は政策発信、nier は研究発信が中核。Tier 2 媒体は
 * 記事内容のばらつきが大きいためデフォルトを設けない。
 */
const SOURCE_DEFAULTS: Record<string, ArticleCategory> = {
  mext: "政策・制度",
  chukyo: "政策・制度",
  nier: "研究・エビデンス",
};

const MAX_CATEGORIES = 3;

export function categorize(
  input: Pick<RawArticle, "title" | "summary"> & { sourceId?: string },
): ArticleCategory[] {
  const text = `${input.title} ${input.summary ?? ""}`;
  const matched: ArticleCategory[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      matched.push(rule.category);
    }
    if (matched.length >= MAX_CATEGORIES) break;
  }
  if (matched.length > 0) return matched;

  const sourceDefault = input.sourceId ? SOURCE_DEFAULTS[input.sourceId] : undefined;
  return sourceDefault ? [sourceDefault] : ["その他"];
}
