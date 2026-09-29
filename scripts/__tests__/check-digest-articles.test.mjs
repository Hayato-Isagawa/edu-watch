// `scripts/check-digest-articles.ts` の回帰テスト(ADR 0075・#781)。
//
// digest の frontmatter が壊れて節や記事 id が消えても、スキーマは `default([])` と
// 「無い id は表示でスキップ」のせいでビルドを通してしまう。この検査が赤にならなくなると、
// 記事カードや節が黙って消える。一時ディレクトリに最小のリポを作り、検査ごとに 1 か所だけ
// 壊して exit を見る。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const script = path.join(repo, "scripts/check-digest-articles.ts");
const tsx = path.join(repo, "node_modules/.bin/tsx");

const ID_A = "nikkyo-2026-09-25-786ac230c4d757f3";
const ID_B = "nier-2026-09-24-71bafa490808f11b";
const ID_GONE = "resemom-2026-09-24-6f8686b60df11108";

const DIGEST = [
  "---",
  "title: 第 10 号",
  "weekStart: 2026-09-21",
  "weekEnd: 2026-09-27",
  'publishedAt: "2026-09-28T07:00:00+09:00"',
  "summary: 要約",
  "topics:",
  "  - 論点",
  "sections:",
  `  - articleIds: [${ID_A}, ${ID_B}]`,
  "    heading: 見出し",
  "    comment: |",
  "      #2 で扱った件の続き(ブロック記法の中の行頭の # はコメントではない)。",
  "  - articleIds:",
  `      - ${ID_A}`,
  "    heading: 二つ目の見出し",
  "    comment: 二つ目の論点。",
  "relatedEvidenceUrls:",
  "  - url: https://edu-evidence.org/strategies/retrieval-practice/",
  "    title: 関連する戦略",
  "---",
  "",
].join("\n");

function makeRepo({
  digest = DIGEST,
  digests = { "2026-09-28.md": digest },
  excluded = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "digest-check-"));
  const d = path.join(root, "src/content/digests");
  const a = path.join(root, "src/data/articles");
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(a, { recursive: true });
  for (const [name, body] of Object.entries(digests)) {
    fs.writeFileSync(path.join(d, name), body);
  }
  fs.writeFileSync(
    path.join(a, "2026-09-25.json"),
    JSON.stringify([{ id: ID_A }, { id: ID_B }])
  );
  fs.writeFileSync(
    path.join(root, "src/data/excluded-article-ids.json"),
    JSON.stringify({
      schemaVersion: 1,
      ids: Object.keys(excluded),
      reasons: excluded,
    })
  );
  return root;
}

const check = (root) =>
  spawnSync(tsx, [script, "--root", root], { encoding: "utf8" });

test("壊れていない digest は通る", () => {
  const r = check(makeRepo());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("記事データに無い id は赤", () => {
  const r = check(makeRepo({ digest: DIGEST.replace(ID_B, ID_GONE) }));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, new RegExp(ID_GONE));
  // 複数行の flow リストで `,` を消すと、2 つの id が空白でつながった 1 つの文字列になる
  const multiline = DIGEST.replace(
    `  - articleIds: [${ID_A}, ${ID_B}]`,
    `  - articleIds:\n      [\n        ${ID_A}\n        ${ID_B},\n      ]`
  );
  assert.equal(check(makeRepo({ digest: multiline })).status, 1);
});

test("記事データに無くても、denylist に理由つきで載っている id は通る(削除依頼)", () => {
  const digest = DIGEST.replace(ID_B, ID_GONE);
  assert.equal(
    check(makeRepo({ digest, excluded: { [ID_GONE]: "削除依頼(ADR 0008)" } }))
      .status,
    0
  );
  // 理由が無ければ通さない(denylist の ids だけに載せて reasons を書き忘れた形)
  const root = makeRepo({ digest });
  fs.writeFileSync(
    path.join(root, "src/data/excluded-article-ids.json"),
    JSON.stringify({ schemaVersion: 1, ids: [ID_GONE], reasons: {} })
  );
  assert.equal(check(root).status, 1);
});

test("節が無い号・digest が 0 件・読めない frontmatter は赤", () => {
  // `sections:` のキー名が壊れると、スキーマの default([]) で節が全部消えたままビルドが通る
  const noSections = DIGEST.replace(
    /sections:\n[\s\S]*?(?=relatedEvidenceUrls:)/,
    ""
  );
  assert.equal(check(makeRepo({ digest: noSections })).status, 1);
  assert.equal(check(makeRepo({ digests: {} })).status, 1);
  assert.equal(
    check(
      makeRepo({ digest: DIGEST.replace("summary: 要約", "summary: [要約") })
    ).status,
    1
  );
});

test("frontmatter の途中に区切りの形の行が入り、残りが本文に落ちると赤", () => {
  // Astro は行頭の `---` / `+++` で frontmatter を閉じるので、そこから後ろが本文になる。
  // digest の本文はどこにも描画されないので、画面にも痕跡が残らない
  for (const sep of ["----", "+++", "---x"]) {
    const digest = DIGEST.replace(
      "relatedEvidenceUrls:",
      `${sep}\nrelatedEvidenceUrls:`
    );
    assert.equal(check(makeRepo({ digest })).status, 1, sep);
  }
});

test("frontmatter に行区切りに似た文字(U+2028 / U+2029 / U+0085 / 単独の CR)があると赤", () => {
  // YAML と JS の正規表現で行の数え方が食い違い、節や関連リンクが前の値に吸い込まれても見えなくなる
  // 単独の CR は、続く行を字下げすると YAML としては読める(読めない形だと YAML の失敗で赤になり、この検査を縛れない)
  for (const ch of [0x2028, 0x2029, 0x85]
    .map((c) => String.fromCharCode(c))
    .concat("\r  ")) {
    const digest = DIGEST.replace("summary: 要約", `summary: 要${ch}約`);
    assert.equal(check(makeRepo({ digest })).status, 1, JSON.stringify(ch));
  }
  // CRLF の改行そのものは許す
  assert.equal(
    check(makeRepo({ digest: DIGEST.replace(/\n/g, "\r\n") })).status,
    0
  );
});

test("キーをコメントアウトした行と、0 桁目の # 行は赤", () => {
  // 節を丸ごとコメントアウトすると、その節だけが黙って消える(ほかの節が残るので節の数では捕まらない)
  const commented = DIGEST.replace(
    `  - articleIds:\n      - ${ID_A}\n    heading: 二つ目の見出し\n    comment: 二つ目の論点。`,
    `#  - articleIds:\n#      - ${ID_A}\n#    heading: 二つ目の見出し\n#    comment: 二つ目の論点。`
  );
  assert.notEqual(commented, DIGEST);
  assert.equal(check(makeRepo({ digest: commented })).status, 1);
  const indented = DIGEST.replace(
    "    heading: 二つ目の見出し",
    "    # heading: 二つ目の見出し\n    heading: 二つ目の見出し"
  );
  assert.equal(check(makeRepo({ digest: indented })).status, 1);
  // キーの形でなくても、0 桁目の # 行(リストの項目だけをコメントアウトした形)は赤
  const item = DIGEST.replace(
    `      - ${ID_A}\n    heading: 二つ目`,
    `#      - ${ID_A}\n    heading: 二つ目`
  );
  assert.notEqual(item, DIGEST);
  assert.equal(check(makeRepo({ digest: item })).status, 1);
});

test("字下げした # <id> や行末の # <id> でコメントになった id は赤", () => {
  // YAML のコメントになり、その id だけが消える
  const multiline = (second) =>
    DIGEST.replace(
      `  - articleIds: [${ID_A}, ${ID_B}]`,
      `  - articleIds:\n      [\n        ${ID_A},\n        ${second}\n      ]`
    );
  assert.equal(check(makeRepo({ digest: multiline(`${ID_B},`) })).status, 0);
  assert.equal(check(makeRepo({ digest: multiline(`# ${ID_B},`) })).status, 1);
  const trailing = DIGEST.replace(
    `  - articleIds: [${ID_A}, ${ID_B}]`,
    `  - articleIds:\n      - ${ID_A} # ${ID_B}`
  );
  assert.equal(check(makeRepo({ digest: trailing })).status, 1);
});

test("書かれている id と読める id が合わないときは、合わない語を出す", () => {
  // 本文(comment)に id の形の語を書いても赤になる。メッセージがその語と原因を指す
  const inComment = DIGEST.replace(
    "    comment: 二つ目の論点。",
    `    comment: ${ID_B} の続報。`
  );
  const r = check(makeRepo({ digest: inComment }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`読めない: ${ID_B}`));
  assert.match(r.stderr, /本文や URL/);
  // 区切りが消えてつながった id は、読めた側の語を「書かれていない」として出す
  const joined = DIGEST.replace(
    `  - articleIds: [${ID_A}, ${ID_B}]`,
    `  - articleIds:\n      [\n        ${ID_A}\n        ${ID_B}\n      ]`
  );
  assert.match(
    check(makeRepo({ digest: joined })).stderr,
    new RegExp(`書かれていない: ${ID_A} ${ID_B}`)
  );
  // コメントになった id も、どの id かを出す
  const trailing = DIGEST.replace(
    `  - articleIds: [${ID_A}, ${ID_B}]`,
    `  - articleIds:\n      - ${ID_A} # ${ID_B}`
  );
  assert.match(
    check(makeRepo({ digest: trailing })).stderr,
    new RegExp(`読めない: ${ID_B}`)
  );
});

test("節や関連リンクが字下げで前の値に吸い込まれると赤", () => {
  // 二つ目の節を 4 字下げると、一つ目の節の comment(ブロック記法)の本文になる
  const absorbed = DIGEST.replace(
    `  - articleIds:\n      - ${ID_A}\n    heading: 二つ目の見出し\n    comment: 二つ目の論点。`,
    `      - articleIds:\n          - ${ID_A}\n        heading: 二つ目の見出し\n        comment: 二つ目の論点。`
  );
  assert.notEqual(absorbed, DIGEST);
  assert.equal(check(makeRepo({ digest: absorbed })).status, 1);
});

test("id を含まない塊のコメントアウトと吸い込みも赤(書かれた id の突き合わせでは見えない形)", () => {
  // topics の項目を 0 桁目の # で外すと、その論点だけが消える
  const topic = DIGEST.replace(
    "topics:\n  - 論点",
    "topics:\n  - 論点\n#  - 二つ目の論点"
  );
  assert.notEqual(topic, DIGEST);
  assert.equal(check(makeRepo({ digest: topic })).status, 1);
  // 関連リンクの塊が、字下げで前の comment(ブロック記法)に吸い込まれると、関連リンクが消える
  const related = DIGEST.replace(
    "    comment: 二つ目の論点。\nrelatedEvidenceUrls:\n  - url: https://edu-evidence.org/strategies/retrieval-practice/\n    title: 関連する戦略",
    "    comment: |\n      二つ目の論点。\n      relatedEvidenceUrls:\n        - url: https://edu-evidence.org/strategies/retrieval-practice/\n          title: 関連する戦略"
  );
  assert.notEqual(related, DIGEST);
  assert.equal(check(makeRepo({ digest: related })).status, 1);
});
