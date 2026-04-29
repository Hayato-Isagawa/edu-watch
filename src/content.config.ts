/**
 * Astro Content Collection 定義
 *
 * - digests: 週次ダイジェスト(`src/content/digests/YYYY-MM-DD.md`)
 *   詳細は docs/sprint-4-design.md §3 を参照。
 */
import { defineCollection, z } from "astro:content";

const digests = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(1),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    publishedAt: z.string().datetime({ offset: true }),
    summary: z.string().min(1),
    topics: z.array(z.string().min(1)).min(1),
    referencedArticleIds: z.array(z.string()).default([]),
    relatedEvidenceUrls: z.array(z.string().url()).default([]),
  }),
});

export const collections = { digests };
