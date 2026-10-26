// dependabot-auto-merge.yml の「どの更新を自動マージするか」の判定を固定する(ADR 0078)。
//
// この判定は壊れても**静かに**壊れる。自動マージ側に倒れると、人が見るはずの更新が
// required check だけで main に入る — satori 0.33.5 → 0.56.1(#867)は Dependabot が
// minor と判定したので自動マージされ、OG 画像が全号で崩れた。人が見る側に倒れても、
// PR が開いたまま溜まるだけで何も赤くならない。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。gh はスタブに
// 差し替えて、呼ばれた引数(merge か comment か)を控え、既存コメントを返し、指定した
// 呼び出しを失敗させる。jq は判定のフィルタも gh の `--jq` も実物を使う。

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(
  HERE,
  "..",
  "..",
  ".github",
  "workflows",
  "dependabot-auto-merge.yml"
);
const yaml = () => fs.readFileSync(WORKFLOW, "utf8");

const PR_URL = "https://github.com/example/repo/pull/42";

/**
 * ワークフローの `run: |` ブロックを取り出す。
 * dependabot-auto-merge.yml の `run: |` は判定ステップの 1 つだけ。
 * 2 つ目が増えたらこの前提が崩れるので、そのことも下でテストしている。
 */
function extractRunBlock() {
  const lines = yaml().split("\n");
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.notEqual(start, -1, "run: | ブロックが見つからない");

  const body = lines.slice(start + 1);
  const indent = body[0].length - body[0].trimStart().length;
  const out = [];
  for (const line of body) {
    const isBlank = line.trim() === "";
    if (!isBlank && line.length - line.trimStart().length < indent) break;
    out.push(line.slice(indent));
  }
  return out.join("\n");
}

const dep = (name, prev, next, type = "direct:production", extra = {}) => ({
  dependencyName: name,
  dependencyType: type,
  prevVersion: prev,
  newVersion: next,
  ...extra,
});

/**
 * 判定ステップを 1 回走らせる。
 *
 * @param updateType  fetch-metadata の `update-type`。
 * @param deps        `updated-dependencies-json` に入る配列。文字列ならそのまま渡す。
 * @param failOn      この前方一致の gh 呼び出し(`pr merge` / `pr comment` / `api`)を exit 1 にする。
 * @param existing    PR に既にあるコメントの配列。文字列なら github-actions[bot] の本文、
 *                    `{ body, login }` なら作者も指定する。gh api は REST の形
 *                    (`[{ body, user: { login } }]`)に包んで、ワークフローの `--jq` を実 jq に通して返す。
 */
function runStep({
  updateType = "version-update:semver-minor",
  deps = [],
  failOn = "",
  existing = [],
} = {}) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "automerge-"))
  );
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  fs.writeFileSync(
    path.join(dir, "comments.json"),
    JSON.stringify(
      existing.map((c) => {
        const { body, login = "github-actions[bot]" } =
          typeof c === "string" ? { body: c } : c;
        return { id: 1, body, user: { login } };
      })
    )
  );
  // 1 回の呼び出しを 1 件として控える。コメント本文は複数行なので、区切りは改行でなく RS(0x1e)。
  // `api` の `--jq` は実 jq に通す。フィルタを素通りさせると、本文を取り出せなくなる退行
  // (印が見つからず push のたびに再投稿される)を検出できない。
  fs.writeFileSync(
    path.join(stubs, "gh"),
    `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\036' "$*" >> "$DIR/gh-args"
if [ -n "$GH_FAIL" ] && [[ "$*" == "$GH_FAIL"* ]]; then exit 1; fi
[ "$1" = api ] || exit 0
filter=""; prev=""
for a in "$@"; do
  [ "$prev" = --jq ] && filter="$a"
  prev="$a"
done
[ -n "$filter" ] || { echo "gh api without --jq" >&2; exit 1; }
jq -r "$filter" "$DIR/comments.json"
`,
    { mode: 0o755 }
  );
  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, extractRunBlock());

  const res = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${stubs}:${process.env.PATH}`,
      DIR: dir,
      GH_FAIL: failOn,
      GH_TOKEN: "stub",
      GH_REPO: "example/repo",
      PR_NUMBER: "42",
      PR_URL,
      UPDATE_TYPE: updateType,
      DEPS_JSON: typeof deps === "string" ? deps : JSON.stringify(deps),
    },
  });
  const argsPath = path.join(dir, "gh-args");
  const ghArgs = fs.existsSync(argsPath)
    ? fs.readFileSync(argsPath, "utf8").split("\x1e").filter(Boolean)
    : [];
  fs.rmSync(dir, { recursive: true, force: true });
  const merged = ghArgs.some((a) => a.startsWith("pr merge "));
  const comment = ghArgs.find((a) => a.startsWith("pr comment ")) ?? null;
  const commentPrefix = `pr comment ${PR_URL} --body `;
  return {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    ghArgs,
    merged,
    comment,
    body: comment?.startsWith(commentPrefix)
      ? comment.slice(commentPrefix.length)
      : null,
  };
}

test("1.x 以上の本番依存の minor 更新は自動マージする", () => {
  const r = runStep({ deps: [dep("astro", "7.3.1", "7.4.0")] });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.merged, r.ghArgs.join(" / "));
  assert.equal(r.comment, null);
  assert.ok(
    r.ghArgs.includes(`pr merge --auto --squash --delete-branch ${PR_URL}`),
    r.ghArgs.join(" / ")
  );
});

test("0.x の本番依存の minor 更新は自動マージせず、理由をコメントする(#867 の形)", () => {
  const r = runStep({ deps: [dep("satori", "0.33.5", "0.56.1")] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.merged, false, r.ghArgs.join(" / "));
  assert.ok(r.comment, "コメントが無い");
  assert.ok(
    r.comment.startsWith(`pr comment ${PR_URL} --body @Hayato-Isagawa `),
    r.comment
  );
  assert.match(
    r.comment,
    /satori: 0\.x の本番依存の minor 更新\(0\.33\.5 → 0\.56\.1\)/
  );
});

test("0.x の本番依存でも patch 更新は自動マージする", () => {
  const r = runStep({
    updateType: "version-update:semver-patch",
    deps: [dep("satori", "0.33.4", "0.33.5")],
  });
  assert.ok(r.merged, r.out);
});

test("0.x から 1.0 へ上がる本番依存は自動マージしない", () => {
  const r = runStep({ deps: [dep("lib", "0.9.3", "1.0.0")] });
  assert.equal(r.merged, false, r.out);
  assert.match(r.comment, /lib: 0\.x の本番依存の minor 更新/);
});

test("0.x の開発依存・推移依存の minor 更新は自動マージする", () => {
  for (const type of ["direct:development", "indirect"]) {
    const r = runStep({ deps: [dep("oxfmt", "0.72.0", "0.73.0", type)] });
    assert.ok(r.merged, `${type}: ${r.out}`);
  }
});

test("グループ PR は 2 件目以降の依存も見る", () => {
  const r = runStep({
    deps: [dep("astro", "7.3.1", "7.4.0"), dep("sharp", "0.35.5", "0.36.0")],
  });
  assert.equal(r.merged, false, r.out);
  assert.match(r.comment, /sharp: 0\.x/);
  assert.doesNotMatch(r.comment, /astro/);
});

test("major 更新は自動マージしない", () => {
  const r = runStep({
    updateType: "version-update:semver-major",
    deps: [dep("vite", "8.1.0", "9.0.0")],
  });
  assert.equal(r.merged, false, r.out);
  assert.match(r.comment, /major 更新/);
});

test("update-type が空・未知の値なら自動マージしない", () => {
  for (const updateType of ["", "version-update:semver-unknown"]) {
    const r = runStep({ updateType, deps: [dep("astro", "7.3.1", "7.4.0")] });
    assert.equal(r.merged, false, `${JSON.stringify(updateType)}: ${r.out}`);
    assert.match(r.comment, /update-type を判定できなかった/);
  }
});

test("本番依存のバージョンを読めなければ自動マージしない(空・数字で始まらない)", () => {
  for (const [prev, next] of [
    ["", "0.56.1"],
    ["0.33.5", ""],
    ["latest", "0.56.1"],
  ]) {
    const r = runStep({ deps: [dep("satori", prev, next)] });
    assert.equal(r.merged, false, `${prev} → ${next}: ${r.out}`);
    assert.match(r.comment, /satori: バージョンを読めない/);
  }
});

test("先頭の v は外して判定する", () => {
  assert.equal(runStep({ deps: [dep("x", "v0.5.0", "v0.6.0")] }).merged, false);
  assert.ok(runStep({ deps: [dep("x", "v1.2.0", "v1.3.0")] }).merged);
});

test("dependencyType が無い依存は本番依存として扱う", () => {
  const d = dep("satori", "0.33.5", "0.56.1");
  delete d.dependencyType;
  const r = runStep({ deps: [d] });
  assert.equal(r.merged, false, r.out);
  assert.match(r.comment, /satori: 0\.x/);
});

test("updated-dependencies-json が読めない・空・配列でなければ自動マージしない", () => {
  for (const deps of ["", "not json", "[]", "{}", "null"]) {
    const r = runStep({ deps });
    assert.equal(r.code, 0, `${JSON.stringify(deps)}: ${r.out}`);
    assert.equal(r.merged, false, `${JSON.stringify(deps)}: ${r.out}`);
    assert.ok(r.comment, `${JSON.stringify(deps)}: コメントが無い`);
  }
});

test("自動マージの有効化に失敗したら job を落とす", () => {
  const r = runStep({
    deps: [dep("astro", "7.3.1", "7.4.0")],
    failOn: "pr merge",
  });
  assert.ok(
    r.ghArgs.some((a) => a.startsWith("pr merge ")),
    r.out
  );
  assert.notEqual(r.code, 0, r.out);
});

test("保留コメントの投稿に失敗したら job を落とす", () => {
  const r = runStep({
    deps: [dep("satori", "0.33.5", "0.56.1")],
    failOn: "pr comment",
  });
  assert.ok(r.comment, r.out);
  assert.notEqual(r.code, 0, r.out);
});

test("既存コメントの取得に失敗したら、投稿せずに job を落とす", () => {
  const r = runStep({
    deps: [dep("satori", "0.33.5", "0.56.1")],
    failOn: "api",
  });
  assert.ok(
    r.ghArgs.some((a) => a.startsWith("api ")),
    r.out
  );
  assert.equal(r.comment, null, r.out);
  assert.notEqual(r.code, 0, r.out);
});

test("同じ理由のコメントが既にあれば、push し直しても投稿しない", () => {
  const deps = [dep("satori", "0.33.5", "0.56.1")];
  const first = runStep({ deps });
  assert.ok(first.body, first.out);

  const r = runStep({ deps, existing: ["LGTM", first.body] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.comment, null, r.out);
  const list = r.ghArgs.find((a) => a.startsWith("api "));
  assert.ok(list, r.out);
  assert.ok(list.includes("repos/example/repo/issues/42/comments"), list);
  assert.ok(list.split(" ").includes("--paginate"), list);
});

test("同じ印でも github-actions[bot] 以外が書いたコメントは数えない", () => {
  const deps = [dep("satori", "0.33.5", "0.56.1")];
  const first = runStep({ deps });
  assert.ok(first.body, first.out);

  for (const login of ["someone", "dependabot[bot]", "github-actions"]) {
    const r = runStep({ deps, existing: [{ body: first.body, login }] });
    assert.equal(r.code, 0, `${login}: ${r.out}`);
    assert.ok(r.comment, `${login}: 投稿されなかった`);
  }
});

test("同じ PR の run は PR 番号を鍵に直列化する", () => {
  const y = yaml();
  const block = y.match(/^concurrency:\n((?:[ \t]+.*\n)+)/m);
  assert.ok(block, "最上位に concurrency: が無い");
  assert.match(
    block[1],
    /^\s+group: dependabot-auto-merge-\$\{\{ github\.event\.pull_request\.number \}\}\s*$/m
  );
  assert.match(block[1], /^\s+cancel-in-progress: false\s*$/m);
});

test("理由が変われば、前の保留コメントがあっても投稿する", () => {
  const before = runStep({ deps: [dep("satori", "0.33.5", "0.56.1")] });
  assert.ok(before.body, before.out);

  const r = runStep({
    deps: [dep("satori", "0.33.5", "0.57.0")],
    existing: [before.body],
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.comment, r.out);
  assert.match(r.comment, /0\.33\.5 → 0\.57\.0/);
});

test("run: | ブロックは 1 つだけ(テストが別のステップを走らせていない)", () => {
  const count = yaml()
    .split("\n")
    .filter((l) => /^\s+run: \|\s*$/.test(l)).length;
  assert.equal(count, 1);
  assert.doesNotMatch(yaml(), /^\s+run: [^|\s]/m, "1 行の run: がある");
});

test("run: に式を展開せず、読む値は env で渡っている", () => {
  assert.doesNotMatch(extractRunBlock(), /\$\{\{/);
  const y = yaml();
  for (const [name, expr] of [
    ["UPDATE_TYPE", "steps.metadata.outputs.update-type"],
    ["DEPS_JSON", "steps.metadata.outputs.updated-dependencies-json"],
    ["PR_URL", "github.event.pull_request.html_url"],
    ["PR_NUMBER", "github.event.pull_request.number"],
    ["GH_REPO", "github.repository"],
  ]) {
    assert.match(
      y,
      new RegExp(
        `^\\s+${name}: \\$\\{\\{ ${expr.replace(/[.-]/g, "\\$&")} \\}\\}\\s*$`,
        "m"
      ),
      `${name} が ${expr} から渡っていない`
    );
  }
  assert.match(
    y,
    /^\s+id: metadata\s*$/m,
    "fetch-metadata のステップに id: metadata が無い"
  );
});

test("判定ステップは continue-on-error で黙らず、if: で飛ばされない", () => {
  assert.doesNotMatch(yaml(), /continue-on-error/);
  const steps = yaml().split(/^\s+- name: /m);
  const decide = steps.find((s) => s.includes("run: |"));
  assert.doesNotMatch(decide, /^\s+if:/m);
});

test("job の if: が、作成者・head のリポ・actor の 3 条件と理由つきの抑止を持つ", () => {
  // この行には zizmor の bot-conditions を抑止するコメントが付いていて、抑止は条件を書き換えても
  // 残る(作成者の判定を消して actor だけに戻しても zizmor は何も出さない。1.31.1 で実測)ので、
  // ここで行ごと固定する。
  assert.match(
    yaml(),
    /^ {4}if: github\.event\.pull_request\.user\.login == 'dependabot\[bot\]' && github\.repository == github\.event\.pull_request\.head\.repo\.full_name && github\.actor == 'dependabot\[bot\]' # zizmor: ignore\[bot-conditions\] \S.*$/m,
    "Dependabot の判定(作成者・head のリポ・actor)と、actor を残す理由つきの抑止が無い"
  );
});
