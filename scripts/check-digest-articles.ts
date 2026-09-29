/**
 * digest の frontmatter が壊れて、節や記事 id がビルドを通ったまま消えていないかを見る
 * (ADR 0075・#781)。
 *
 * 使い方: `npx tsx scripts/check-digest-articles.ts`(または `npm run check:digest-articles`)。
 * `--root <dir>` で別のリポを見る(テスト用)。
 *
 * スキーマ(`src/content.config.ts`)は `sections` を `default([])` にしていて、表示は
 * 記事データに無い id を黙って飛ばす(`getArticlesByIds`)。そのため frontmatter が壊れて
 * 節や id が消えても、ビルドは通り、画面から記事カードや節が消えるだけになる。
 * ここではローダーと同じ切り出しで読んだ結果を検査する。
 *
 * 失敗したら exit 1。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "astro/markdown";
import { loadExcludedIds } from "../src/lib/excluded-ids.ts";

// digest の frontmatter に現れるキー(`src/content.config.ts` の digests スキーマ)
const KEYS = [
  "title",
  "weekStart",
  "weekEnd",
  "publishedAt",
  "updatedAt",
  "summary",
  "topics",
  "sections",
  "articleIds",
  "heading",
  "comment",
  "relatedEvidenceUrls",
  "url",
];
const KEY_ALT = KEYS.join("|");
// 生の frontmatter に書かれた記事 id の形の語(ハイフンでつながった語のうち id の形で終わるもの)
const RAW_ID_WORD_RE = /[a-z0-9]+(?:-+[a-z0-9]+)*/g;
const RAW_ID_TAIL_RE = /-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/;
const KEY_LINE_RE = new RegExp(`^[ \\t]*(?:- )?(?:${KEY_ALT}):`, "m");
const COMMENTED_KEY_RE = new RegExp(
  `^[ \\t]*#[ \\t]*(?:- )?(?:${KEY_ALT}):`,
  "m"
);

function argRoot(): string {
  const i = process.argv.indexOf("--root");
  return path.resolve(i >= 0 ? process.argv[i + 1] : ".");
}

function loadArticleIds(root: string): Set<string> {
  const dir = path.join(root, "src/data/articles");
  const ids = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const a of JSON.parse(readFileSync(path.join(dir, f), "utf8"))) {
      ids.add(a.id);
    }
  }
  return ids;
}

async function main(): Promise<number> {
  const root = argRoot();
  const articles = loadArticleIds(root);
  const denylist = await loadExcludedIds(
    path.join(root, "src/data/excluded-article-ids.json")
  );
  // 削除依頼(ADR 0008 §5)などで消した記事は、denylist に載っていれば欠けてよい
  // (理由の無い id は loadExcludedIds が読み込みごと拒否する)
  const excluded = new Set(denylist.ids);

  const dir = path.join(root, "src/content/digests");
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const problems: string[] = [];
  if (!files.length)
    problems.push("digest が 1 件も無い(見る対象が無いまま緑にしない)");
  for (const f of files) {
    const raw = readFileSync(path.join(dir, f), "utf8");
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(raw, { frontmatter: "empty-with-spaces" });
    } catch (err) {
      problems.push(
        `${f}: frontmatter を YAML として読めない(${String(err).split("\n")[0]})`
      );
      continue;
    }
    const { frontmatter, content, rawFrontmatter } = parsed;
    // 節や関連リンクを丸ごとコメントアウトすると、その塊だけが黙って消える。
    // 0 桁目の `#` 行と、キーをコメントアウトした行を止める(ブロック記法の中の
    // 「#2 で扱った…」のような行は字下げがあり、キーの形でもないので当たらない)
    if (/^#/m.test(rawFrontmatter) || COMMENTED_KEY_RE.test(rawFrontmatter)) {
      problems.push(
        `${f}: frontmatter にコメントアウトした行がある(その塊がビルドを通ったまま消える)`
      );
    }
    // YAML と JS の正規表現で行の数え方が食い違う文字。節や関連リンクが前の値に吸い込まれても
    // 下の検査から見えなくなるので、それ自体を止める(CRLF の改行は許す)
    if (/[\u2028\u2029\u0085]|\r(?!\n)/.test(rawFrontmatter)) {
      problems.push(
        `${f}: frontmatter に行区切りに似た文字(U+2028 / U+2029 / U+0085 / 単独の CR)がある`
      );
    }
    // digest の本文はどこにも描画されない。本文があるのは、frontmatter の途中の行頭の
    // `---` / `+++`(`----`・`---x` も)で Astro が frontmatter を閉じ、残りが本文に落ちたとき
    if (content.trim() !== "") {
      problems.push(
        `${f}: 本文がある(frontmatter の途中に行頭が --- / +++ の行があると、そこから後ろが本文として扱われて節や関連リンクが消える)`
      );
    }
    const sections = Array.isArray(frontmatter.sections)
      ? frontmatter.sections
      : [];
    if (!sections.length) {
      problems.push(
        `${f}: 節が無い(\`sections:\` のキー名が壊れる・字下げがずれると、スキーマの default([]) で節が全部消えたままビルドが通る)`
      );
    }
    // 字下げがずれると、後ろの節や関連リンクが前の値(ブロック記法の comment など)の本文に
    // 吸い込まれる。値の中にキーの形をした行があれば止める
    const texts: unknown[] = [
      frontmatter.title,
      frontmatter.summary,
      ...(Array.isArray(frontmatter.topics) ? frontmatter.topics : []),
      ...sections.flatMap((s) => [s?.heading, s?.comment]),
      ...(Array.isArray(frontmatter.relatedEvidenceUrls)
        ? frontmatter.relatedEvidenceUrls.flatMap((r) => [r?.title, r?.url])
        : []),
    ];
    if (texts.some((t) => typeof t === "string" && KEY_LINE_RE.test(t))) {
      problems.push(
        `${f}: 値の中にキーの形をした行がある(字下げがずれて、後ろの節や関連リンクが前の値に吸い込まれている)`
      );
    }
    // 字下げした `# <id>` や行末の `# <id>` は YAML のコメントになり、その id だけが消える。
    // 書かれている id と読めた id を個数まで比べる
    const written = (rawFrontmatter.match(RAW_ID_WORD_RE) ?? [])
      .filter((w) => RAW_ID_TAIL_RE.test(w))
      .sort();
    const read = sections
      .flatMap((s) => (Array.isArray(s?.articleIds) ? s.articleIds : []))
      .map(String)
      .sort();
    if (JSON.stringify(written) !== JSON.stringify(read)) {
      const unread = [...written];
      const unwritten: string[] = [];
      for (const id of read) {
        const i = unread.indexOf(id);
        if (i >= 0) unread.splice(i, 1);
        else unwritten.push(id);
      }
      const diff = [
        unread.length ? `読めない: ${unread.join(", ")}` : "",
        unwritten.length ? `書かれていない: ${unwritten.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" / ");
      problems.push(
        `${f}: 書かれている記事 id と読める記事 id が合わない(${diff})。コメントアウトされた id、区切りが消えてつながった id、本文や URL の中の id の形の語のどれか`
      );
    }
    for (const s of sections) {
      for (const id of s?.articleIds ?? []) {
        if (!articles.has(id) && !excluded.has(id)) {
          problems.push(
            `${f}: 記事データに無い id "${id}"(書き間違いか、記録なしに消えた記事。削除した記事なら excluded-article-ids.json に理由つきで載せる)`
          );
        }
      }
    }
  }

  for (const p of problems) console.error(`[check:digest-articles] ${p}`);
  console.log(
    `[check:digest-articles] ${files.length} 号・記事 ${articles.size} 件を確認、問題 ${problems.length} 件`
  );
  return problems.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[check:digest-articles] 失敗:", err);
    process.exit(1);
  }
);
