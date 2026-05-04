import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { generateOgImage } from "../../../lib/og-image";

export const getStaticPaths: GetStaticPaths = async () => {
  const digests = await getCollection("digests");
  return digests.map((d) => ({
    params: { slug: d.id },
    props: {
      title: d.data.title,
      weekStart: d.data.weekStart,
      weekEnd: d.data.weekEnd,
      topics: d.data.topics ?? [],
    },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const png = await generateOgImage(
    props as {
      title: string;
      weekStart: string;
      weekEnd: string;
      topics?: string[];
    },
  );

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
