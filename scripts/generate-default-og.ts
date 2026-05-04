import satori from "satori";
import type { ReactNode } from "react";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

interface SiteOgConfig {
  kicker: string;
  headlineLines: string[];
  sub: string;
  domainLabel: string;
  accentColor: string;
}

const config: SiteOgConfig = {
  kicker: "EduWatch JP",
  headlineLines: ["一次情報から、", "教育の今を追う。"],
  sub: "文科省・教育専門紙の教育情報を日次で。",
  domainLabel: "news.edu-evidence.org",
  accentColor: "#1e4a6e",
};

const FONT_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "fonts",
  "noto-sans-jp-bold.bin",
);

async function loadNotoSansJpFont(): Promise<ArrayBuffer> {
  const buf = await fs.readFile(FONT_PATH);
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

async function buildDefaultOg(): Promise<Buffer> {
  const fontData = await loadNotoSansJpFont();

  const headlineParts: Array<Record<string, unknown>> = [];
  config.headlineLines.forEach((line, i) => {
    headlineParts.push({
      type: "div",
      props: {
        style: {
          fontSize: "84px",
          fontWeight: 900,
          color: "#1a1a1a",
          lineHeight: 1.18,
          letterSpacing: "-0.01em",
        },
        children: line,
      },
      key: `line-${i}`,
    });
  });

  const element = {
    type: "div",
    props: {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#faf9f5",
        fontFamily: "Noto Sans JP",
        position: "relative",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              left: "0",
              top: "0",
              width: "8px",
              height: "100%",
              background: config.accentColor,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "28px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "20px",
                    letterSpacing: "0.18em",
                    color: config.accentColor,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  },
                  children: config.kicker,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                  },
                  children: headlineParts,
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
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "26px",
                    color: "#3a3a36",
                    fontWeight: 700,
                  },
                  children: config.sub,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "18px",
                    color: "#6b6b66",
                    letterSpacing: "0.02em",
                  },
                  children: config.domainLabel,
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

async function main(): Promise<void> {
  const outPath = path.resolve(process.cwd(), "public", "og-image.png");
  const buf = await buildDefaultOg();
  await fs.writeFile(outPath, buf);
  process.stdout.write(`generated: ${outPath} (${buf.byteLength} bytes)\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`failed to generate default OG: ${String(err)}\n`);
  process.exit(1);
});
