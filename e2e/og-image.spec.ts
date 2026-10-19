import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { test, expect } from "@playwright/test";

/**
 * ダイジェストの OG 画像(src/lib/og-image.ts)が枠の中に描かれていることを、
 * 配信される PNG の画素で確かめる。
 *
 * 依存の更新で描画が崩れても、ビルドは通り PNG も出る。satori 0.42.0 で
 * box-sizing の既定が content-box に変わったときは、title が右端で切れ、
 * 下端のチップと URL が画像の外に出たまま、非 major の自動マージで main に入った
 * (#867。修正は #884)。VRT は required ではなく、自動マージは required しか待たないので、
 * 止めるならこの E2E(required)で止める。
 *
 * 数値は og-image.ts の 1200×630・padding 60px 70px・チップの maxWidth 850px から。
 * 向こうで padding を減らすなど、描ける範囲を広げる変更をするとここが赤になるので、
 * そのときは合わせて直す。
 */

const WIDTH = 1200;
const HEIGHT = 630;
const BACKGROUND = [0xfa, 0xf9, 0xf5];

// padding の内側(x 70〜1130、y 60〜570)を 20px 広げた箱。行頭の A / V / Y / j は
// 字形が padding の外へ 1〜4px はみ出す(行頭が「生成AI」の「AI」だと x=69)。
// boxSizing を外して崩した 26 号では、x≥1150 にも各号 138〜1,465 画素の字があった
// (右端は x 1162〜1199。2026-10-19 時点)ので、20px の許容で取りこぼさない。
const ALLOWED = { left: 50, right: 1150, top: 40, bottom: 590 };

// 下端の行。チップは maxWidth 850px なので x 70+850=920 より右には出ない。
// それより右にある字は URL(news.edu-evidence.org)。
const BOTTOM_ROW = { top: 500, bottom: 570 };
const CHIP_RIGHT = 920;

// 2026-10-19 時点の 26 号では URL が 1,315 画素、チップ(アクセント色)が 2,284〜4,000 画素
// (macOS で測定)。
// 消えると 0 になる。はぐれた数画素で通らないように下限を置く。
const MIN_INK = 100;

const digestDir = path.resolve(process.cwd(), "src/content/digests");
// content.config.ts の glob と同じパターン。slug は拡張子を除いた相対パス。
const slugs = fs
  .globSync("**/*.md", { cwd: digestDir })
  .map((f) => f.replace(/\.md$/, ""))
  .sort();

test("ダイジェストの OG 画像が枠の中に描かれ、下端のチップと URL がある", async ({
  request,
}) => {
  expect(slugs.length, `${digestDir} にダイジェストが無い`).toBeGreaterThan(0);

  const problems: string[] = [];
  for (const slug of slugs) {
    const res = await request.get(`/og/digest/${slug}.png`);
    if (res.status() !== 200) {
      problems.push(`${slug}: HTTP ${res.status()}`);
      continue;
    }
    if (!res.headers()["content-type"]?.startsWith("image/png")) {
      problems.push(`${slug}: content-type ${res.headers()["content-type"]}`);
      continue;
    }

    const { data, info } = await sharp(await res.body())
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== WIDTH || info.height !== HEIGHT) {
      problems.push(`${slug}: ${info.width}x${info.height}`);
      continue;
    }

    let outside = 0;
    let url = 0;
    let chips = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r === BACKGROUND[0] && g === BACKGROUND[1] && b === BACKGROUND[2]) {
          continue;
        }
        if (
          x < ALLOWED.left ||
          x >= ALLOWED.right ||
          y < ALLOWED.top ||
          y >= ALLOWED.bottom
        ) {
          outside++;
        }
        if (y >= BOTTOM_ROW.top && y < BOTTOM_ROW.bottom) {
          if (x >= CHIP_RIGHT) url++;
          // アクセント色 #1e4a6e とその縁のにじみ。背景・本文の黒・灰はどれも b - r が負。
          else if (b - r > 40) chips++;
        }
      }
    }
    if (outside > 0) problems.push(`${slug}: 枠の外に ${outside} 画素`);
    if (url < MIN_INK) problems.push(`${slug}: 下端の URL が ${url} 画素`);
    if (chips < MIN_INK) problems.push(`${slug}: 下端のチップが ${chips} 画素`);
  }

  expect(problems, problems.join("\n")).toEqual([]);
});
