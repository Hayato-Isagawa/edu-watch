import type { APIRoute } from "astro";
// ?raw で CSS をそのまま文字列として取り込む。fs で読むとビルド後の
// バンドル位置を指してしまい、ソースの global.css に届かない。
import css from "../styles/global.css?raw";

/**
 * デザイントークンを機械可読な形で公開する。
 *
 * 値は `src/styles/global.css` から抽出する。ここに数値を書き写すと実装と
 * ずれるため、CSS を唯一の真実として毎ビルド読み直す。
 *
 * ポートフォリオ(hayato-isagawa.work)のデザインハブが、ファミリー各サイトの
 * この出力を集めて横断比較する。別オリジンからは getComputedStyle で測れない
 * ため、各サイトが自分で公開する形にしている。
 */

/** `--name: value;` を拾う。value 内の `;` は使っていない前提。 */
function parseDeclarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim().replace(/\s+/g, " ");
  }
  return out;
}

/**
 * コメントを取り除く。日本語コメント中の「@theme」のような文字列に
 * セレクタの正規表現がマッチし、別のブロックを拾う事故が実際に起きた。
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 対応する `}` までを取り出す(ネストは想定しない)。 */
function extractBlock(css: string, opener: RegExp): string[] {
  const blocks: string[] = [];
  for (const m of css.matchAll(opener)) {
    const start = css.indexOf("{", m.index ?? 0);
    if (start < 0) continue;
    const end = css.indexOf("}", start);
    if (end < 0) continue;
    blocks.push(css.slice(start + 1, end));
  }
  return blocks;
}

function categorise(name: string): string {
  if (name.startsWith("--color-")) return "color";
  if (name.startsWith("--font-")) return "font";
  if (name.startsWith("--leading-")) return "leading";
  if (name.startsWith("--breakpoint-")) return "breakpoint";
  return "other";
}

export const GET: APIRoute = () => {
  const source = stripComments(css);

  const light: Record<string, string> = {};
  for (const block of extractBlock(source, /@theme[^{]*\{/g)) {
    Object.assign(light, parseDeclarations(block));
  }
  const dark: Record<string, string> = {};
  for (const block of extractBlock(source, /\[data-theme="dark"\]\s*\{/g)) {
    Object.assign(dark, parseDeclarations(block));
  }

  const tokens: Record<
    string,
    Record<string, { light: string; dark?: string }>
  > = {};
  for (const [name, value] of Object.entries(light)) {
    const cat = categorise(name);
    tokens[cat] ??= {};
    tokens[cat][name] = dark[name]
      ? { light: value, dark: dark[name] }
      : { light: value };
  }
  // dark にしか無いトークンがあれば拾う(現状は無い想定だが、静かに落とさない)
  for (const [name, value] of Object.entries(dark)) {
    if (light[name]) continue;
    const cat = categorise(name);
    tokens[cat] ??= {};
    tokens[cat][name] = { light: "", dark: value };
  }

  const body = {
    $schema: "https://hayato-isagawa.work/schemas/design-tokens-v1.json",
    site: {
      id: "edu-watch",
      name: "EduWatch JP",
      url: "https://news.edu-evidence.org",
      // docs/BRAND.md の木の部位体系
      brandRole: "双葉(cotyledon)",
      themeAttribute: 'data-theme="light|dark"',
    },
    source: "src/styles/global.css",
    generatedAt: new Date().toISOString(),
    tokens,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
