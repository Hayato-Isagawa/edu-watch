/**
 * カテゴリメタデータ
 *
 * `ArticleCategory` の各カテゴリ名と URL slug の対応、および 1〜2 行の
 * 短い説明をまとめる。slug は ASCII で URL に乗せやすいローマ字 / 英語
 * を採用。`/categories/<slug>` ページの生成と内部リンクで利用する。
 */
import type { ArticleCategory } from "./article-schema.ts";

export interface CategoryMeta {
  category: ArticleCategory;
  slug: string;
  description: string;
}

export const CATEGORY_META: readonly CategoryMeta[] = [
  {
    category: "いじめ",
    slug: "ijime",
    description: "いじめ防止対策推進法の運用、重大事態、認知件数の調査。",
  },
  {
    category: "不登校",
    slug: "futoukou",
    description: "教育機会確保法、別室登校、フリースクール、教育支援センター。",
  },
  {
    category: "ICT / GIGA",
    slug: "ict-giga",
    description: "GIGA スクール、1 人 1 台端末、生成 AI、デジタル教科書、校務 DX。",
  },
  {
    category: "政策・制度",
    slug: "policy",
    description: "中央教育審議会、学習指導要領、答申、告示、教育委員会。",
  },
  {
    category: "研究・エビデンス",
    slug: "research",
    description: "学力調査、報告書、シンポジウム、研究機関の調査結果と分析。",
  },
  {
    category: "国際・海外",
    slug: "international",
    description: "OECD / PISA / TALIS、ユネスコ、国際比較、海外の動向。",
  },
  {
    category: "教員・働き方",
    slug: "teachers",
    description: "教員養成、給特法、働き方改革、研修、養護教諭・栄養教諭。",
  },
  {
    category: "その他",
    slug: "other",
    description: "上記カテゴリに該当しない記事。学校現場の取り組み、地域行事など。",
  },
];

const BY_CATEGORY = new Map<string, CategoryMeta>(
  CATEGORY_META.map((m) => [m.category, m]),
);
const BY_SLUG = new Map<string, CategoryMeta>(CATEGORY_META.map((m) => [m.slug, m]));

export function getCategoryMetaByName(name: ArticleCategory): CategoryMeta | undefined {
  return BY_CATEGORY.get(name);
}

export function getCategoryMetaBySlug(slug: string): CategoryMeta | undefined {
  return BY_SLUG.get(slug);
}

export function slugForCategory(name: ArticleCategory): string {
  return BY_CATEGORY.get(name)?.slug ?? "other";
}
