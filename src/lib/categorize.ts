/**
 * カテゴリ分類(MVP: キーワードマッチベース)
 *
 * title + summary を走査し、該当するカテゴリを付与する。
 * 最大 3 カテゴリまで、合致なしは `"その他"` のフォールバック。
 *
 * 将来 LLM 分類に置き換える際は、本ファイルを差し替えて同じ `categorize(raw)` の
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
    patterns: [/不登校/, /登校拒否/, /COCOLO/, /教育支援センター/],
  },
  {
    category: "ICT / GIGA",
    patterns: [/GIGA/, /ICT/, /タブレット/, /デジタル教科書/, /1\s*人\s*1\s*台/, /端末/i],
  },
  {
    category: "政策・制度",
    patterns: [/答申/, /中教審/, /中央教育審議会/, /学習指導要領/, /法改正/, /通知/, /告示/, /文部科学省/],
  },
  {
    category: "研究・エビデンス",
    patterns: [/研究/, /調査結果/, /メタ分析/, /エビデンス/, /RCT/i, /実証/],
  },
  {
    category: "国際・海外",
    patterns: [/OECD/i, /PISA/i, /EEF/i, /国際比較/, /海外/],
  },
  {
    category: "教員・働き方",
    patterns: [/教員/, /働き方/, /給特法/, /残業/, /志望者/, /採用/],
  },
];

const MAX_CATEGORIES = 3;

export function categorize(raw: Pick<RawArticle, "title" | "summary">): ArticleCategory[] {
  const text = `${raw.title} ${raw.summary ?? ""}`;
  const matched: ArticleCategory[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      matched.push(rule.category);
    }
    if (matched.length >= MAX_CATEGORIES) break;
  }
  return matched.length > 0 ? matched : ["その他"];
}
