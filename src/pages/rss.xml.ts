import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const digests = await getCollection("digests");
  const sorted = [...digests].sort((a, b) =>
    b.data.publishedAt.localeCompare(a.data.publishedAt),
  );

  return rss({
    title: "EduWatch JP — 週次ダイジェスト",
    description:
      "1 週間の教育ニュースから主要な論点を編集者が整理する週次ダイジェスト。毎週金曜公開。",
    site: context.site?.toString() ?? "https://news.edu-evidence.org",
    items: sorted.map((d) => ({
      title: d.data.title,
      description: d.data.summary,
      pubDate: new Date(d.data.publishedAt),
      link: `/digest/${d.id}/`,
      categories: d.data.topics,
    })),
    customData: "<language>ja</language>",
  });
}
