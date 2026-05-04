import satori from "satori";
import type { ReactNode } from "react";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

interface OgParams {
  title: string;
  weekStart: string;
  weekEnd: string;
  topics?: string[];
}

// build 時にリポジトリ同梱のフォントを読み込む。
// ADR 0031 で Google Fonts / jsDelivr への build-time 依存を排除し、
// `scripts/fonts/noto-sans-jp-bold.bin` を git 管理対象として同梱する方針に変更。
// (姉妹サイト edu-evidence ADR 0017 のミラー)
const FONT_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "fonts",
  "noto-sans-jp-bold.bin",
);

let inProcessFontData: ArrayBuffer | null = null;

async function loadNotoSansJpFont(): Promise<ArrayBuffer> {
  if (inProcessFontData) return inProcessFontData;

  const buf = await fs.readFile(FONT_PATH);
  const data = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  inProcessFontData = data;
  return data;
}

const dayFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

function formatRange(weekStart: string, weekEnd: string): string {
  const f = dayFormatter.format(new Date(`${weekStart}T00:00:00+09:00`));
  const t = dayFormatter.format(new Date(`${weekEnd}T00:00:00+09:00`));
  return `${f} 〜 ${t}`;
}

export async function generateOgImage(params: OgParams): Promise<Buffer> {
  const { title, weekStart, weekEnd, topics } = params;

  const fontData = await loadNotoSansJpFont();
  const rangeLabel = formatRange(weekStart, weekEnd);
  const topicChips = (topics ?? []).slice(0, 4);

  const element = {
    type: "div",
    props: {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 70px",
        background: "#faf9f5",
        fontFamily: "Noto Sans JP",
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: "16px" },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "14px",
                    letterSpacing: "0.15em",
                    color: "#1e4a6e",
                    textTransform: "uppercase",
                  },
                  children: "EduWatch JP — Weekly Digest",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: title.length > 22 ? "44px" : title.length > 14 ? "52px" : "60px",
                    fontWeight: 900,
                    color: "#1a1a1a",
                    lineHeight: 1.2,
                  },
                  children: title,
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: "18px", color: "#6b6b66" },
                  children: `期間: ${rangeLabel}`,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: "24px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "10px",
                    maxWidth: "850px",
                  },
                  children: topicChips.map((topic) => ({
                    type: "div",
                    props: {
                      style: {
                        fontSize: "16px",
                        color: "#1e4a6e",
                        border: "1px solid #1e4a6e",
                        borderRadius: "9999px",
                        padding: "6px 16px",
                      },
                      children: topic,
                    },
                  })),
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "16px",
                    color: "#6b6b66",
                  },
                  children: "news.edu-evidence.org",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element as unknown as ReactNode, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Noto Sans JP",
        data: fontData,
        weight: 700,
        style: "normal" as const,
      },
    ],
  });

  return await sharp(Buffer.from(svg)).png().toBuffer();
}
