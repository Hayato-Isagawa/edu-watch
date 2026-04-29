/**
 * Astro Content Collection 定義
 *
 * - digests: 週次ダイジェスト(`src/content/digests/YYYY-MM-DD.md`)
 *   詳細は docs/sprint-4-design.md §3 を参照。
 */
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const digests = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/digests" }),
  schema: z.object({
    title: z.string().min(1),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    publishedAt: z.string().datetime({ offset: true }),
    summary: z.string().min(1),
    topics: z.array(z.string().min(1)).min(1),
    sections: z
      .array(
        z.object({
          articleId: z.string().min(1),
          heading: z.string().min(1),
          comment: z.string().min(1),
        }),
      )
      .default([]),
    relatedEvidenceUrls: z.array(z.string().url()).default([]),
  }),
});

export const collections = { digests };
