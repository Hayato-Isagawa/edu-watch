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
import {
  mergeKeyPaths,
  parseWorkflow,
  replaceOnce,
  stepsNamed,
} from "./workflow-yaml.mjs";

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
 * 字面で最初の `run: |` を取るので、取り出した本文が判定ステップの run と一致することを
 * 下でテストしている。
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

const DECIDE = "Enable auto-merge, or explain why not";

/**
 * 判定ステップが黙らず飛ばされない前提に反している箇所を返す(例: `decide if`)。
 *
 * 字面ではなくパース結果で見る。字面だと `"continue-on-error":` / `? if` / フロー形のような
 * YAML として等価な書き方が素通りする(#920)。continue-on-error は判定ステップだけでなく、
 * どの job・どのステップにも置かない(以前の検査はファイル全体で禁じていたので、保証を
 * 縮めない)。マージキーは、使っていること自体を違反にする(workflow-yaml.mjs)。
 */
function autoMergeViolations(src) {
  const doc = parseWorkflow(src);
  const found = mergeKeyPaths(src).map((at) => `merge key ${at}`);
  const decide = stepsNamed(doc, DECIDE);
  if (decide.length !== 1) found.push(`decide steps ${decide.length}`);
  // if: で飛ばされると、自動マージも保留のコメントも出ないまま緑で終わる
  else if (Object.hasOwn(decide[0].step ?? {}, "if")) found.push("decide if");
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    // job の continue-on-error は job の失敗を run の失敗にしない
    if (Object.hasOwn(job ?? {}, "continue-on-error"))
      found.push(`job ${jobName} continue-on-error`);
    (job?.steps ?? []).forEach((step, i) => {
      if (Object.hasOwn(step ?? {}, "continue-on-error"))
        found.push(`step ${jobName}[${i}] continue-on-error`);
    });
  }
  return found;
}

test("判定ステップは continue-on-error で黙らず、if: で飛ばされない", () => {
  assert.deepEqual(autoMergeViolations(yaml()), []);
});

// ---- autoMergeViolations の fixture。実ファイルの 1 か所だけを書き換える ----

const real = (from, to) => replaceOnce(yaml(), from, to);
const DECIDE_HEAD = `      - name: ${DECIDE}\n`;

for (const [label, lines] of [
  ["そのまま", "        continue-on-error: true\n"],
  ["引用符付きのキー", '        "continue-on-error": true\n'],
  ["明示キー", "        ? continue-on-error\n        : true\n"],
]) {
  test(`fixture: 判定ステップに continue-on-error(${label})を足すと拾う`, () => {
    const src = real(DECIDE_HEAD, DECIDE_HEAD + lines);
    assert.deepEqual(autoMergeViolations(src), [
      "step auto-merge[1] continue-on-error",
    ]);
  });
}

test("fixture: メタデータ取得のステップに continue-on-error を足しても拾う", () => {
  const src = real(
    "        id: metadata\n",
    "        id: metadata\n        continue-on-error: true\n"
  );
  assert.deepEqual(autoMergeViolations(src), [
    "step auto-merge[0] continue-on-error",
  ]);
});

test("fixture: job に continue-on-error を足すと拾う", () => {
  const src = real(
    "    timeout-minutes: 10\n",
    "    timeout-minutes: 10\n    continue-on-error: true\n"
  );
  assert.deepEqual(autoMergeViolations(src), [
    "job auto-merge continue-on-error",
  ]);
});

for (const [label, lines] of [
  ["if: false", "        if: false\n"],
  ["明示キー", "        ? if\n        : false\n"],
]) {
  test(`fixture: 判定ステップに if(${label})を足すと拾う`, () => {
    const src = real(DECIDE_HEAD, DECIDE_HEAD + lines);
    assert.deepEqual(autoMergeViolations(src), ["decide if"]);
  });
}

test("fixture: 判定ステップの if をマージキーで入れると、マージキーとして拾う", () => {
  // merge: false で読むので、`<<` の下の if は判定ステップの if に見えない。
  // GitHub もマージキーを展開しないが、使っていること自体を違反にする
  const src = real(DECIDE_HEAD, DECIDE_HEAD + "        <<: {if: false}\n");
  assert.deepEqual(autoMergeViolations(src), [
    "merge key jobs.auto-merge.steps[1]",
  ]);
});

test("fixture: 判定ステップと同じ名前のステップが 2 つあると拾う", () => {
  const src = real(
    DECIDE_HEAD,
    DECIDE_HEAD + "        run: echo duplicate\n" + DECIDE_HEAD
  );
  assert.deepEqual(autoMergeViolations(src), ["decide steps 2"]);
});

// 判定ステップの run が読む値。キーだけでなく値も固定する。余分なキーは見ない
const ENV = {
  GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
  GH_REPO: "${{ github.repository }}",
  PR_NUMBER: "${{ github.event.pull_request.number }}",
  PR_URL: "${{ github.event.pull_request.html_url }}",
  UPDATE_TYPE: "${{ steps.metadata.outputs.update-type }}",
  DEPS_JSON: "${{ steps.metadata.outputs.updated-dependencies-json }}",
};

/** run を持つステップを全 job から集める */
const runSteps = (doc) =>
  Object.entries(doc?.jobs ?? {}).flatMap(([jobName, job]) =>
    (job?.steps ?? [])
      .filter((step) => Object.hasOwn(step ?? {}, "run"))
      .map((step) => ({ jobName, step }))
  );

/**
 * 判定ステップの配線(run の所在・env の値・メタデータの id・直列化)に反している箇所を返す。
 * `autoMergeViolations()` と同じくパース結果で見る(#940)。マージキーの検出は
 * `autoMergeViolations()` が受け持つ。
 *
 * run を持つステップがちょうど 1 つで、それが判定ステップであることまで見る。名前だけで
 * 特定すると、本物のステップを改名して `if:` を付け、run の無い同名のダミーを置いた形が
 * 素通りする。job に concurrency を置くと、workflow 直下の group に加えてもう 1 つ group が
 * かかり、既定の queue: single が待っている run を cancel しうる。
 */
function autoMergeWiring(src) {
  const doc = parseWorkflow(src);
  const found = [];
  const c = doc?.concurrency;
  if (
    c?.group !== "dependabot-auto-merge-${{ github.event.pull_request.number }}"
  )
    found.push("concurrency group");
  if (c?.["cancel-in-progress"] !== false)
    found.push("concurrency cancel-in-progress");
  for (const [name, job] of Object.entries(doc?.jobs ?? {}))
    if (Object.hasOwn(job ?? {}, "concurrency"))
      found.push(`job ${name} concurrency`);
  const runs = runSteps(doc);
  if (runs.length !== 1) found.push(`run steps ${runs.length}`);
  else if (runs[0].step?.name !== DECIDE) found.push("run step is not decide");
  const decide = stepsNamed(doc, DECIDE);
  const env = decide.length === 1 ? (decide[0].step?.env ?? {}) : {};
  for (const [key, value] of Object.entries(ENV))
    if (env[key] !== value) found.push(`env ${key}`);
  const metadata = stepsNamed(doc, "Fetch Dependabot metadata");
  if (metadata.length !== 1) found.push(`metadata steps ${metadata.length}`);
  else if (metadata[0].step?.id !== "metadata") found.push("metadata id");
  return found;
}

test("同じ PR の run は PR 番号を鍵に直列化する", () => {
  assert.deepEqual(
    autoMergeWiring(yaml()).filter((v) => v.includes("concurrency")),
    []
  );
});

test("テストが走らせる本文は、判定ステップの run そのもの", () => {
  // extractRunBlock は字面で最初の `run: |` を取る。run を持つステップの本数と、本文の一致の両方で見る
  assert.deepEqual(
    autoMergeWiring(yaml()).filter((v) => v.startsWith("run step")),
    []
  );
  const [decide] = stepsNamed(parseWorkflow(yaml()), DECIDE);
  assert.equal(
    String(decide?.step?.run).trimEnd(),
    extractRunBlock().trimEnd(),
    "extractRunBlock が判定ステップの run と別の本文を取り出している"
  );
});

test("run: に式を展開せず、読む値は env で渡っている", () => {
  const [decide] = stepsNamed(parseWorkflow(yaml()), DECIDE);
  assert.doesNotMatch(String(decide?.step?.run), /\$\{\{/);
  assert.deepEqual(
    autoMergeWiring(yaml()).filter(
      (v) => v.startsWith("env ") || v.startsWith("metadata ")
    ),
    []
  );
});

// ---- autoMergeWiring の fixture。実ファイルの 1 か所だけを書き換える ----

test("fixture: 実ファイルのままでは配線の違反 0(以下の fixture の対照)", () => {
  assert.deepEqual(autoMergeWiring(yaml()), []);
});

test("fixture: job に置いた concurrency を拾う", () => {
  const src = real(
    "    timeout-minutes: 10\n",
    "    timeout-minutes: 10\n    concurrency: auto-merge\n"
  );
  assert.deepEqual(autoMergeWiring(src), ["job auto-merge concurrency"]);
});

test("fixture: cancel-in-progress を true にすると拾う", () => {
  const src = real(
    "  cancel-in-progress: false\n",
    "  cancel-in-progress: true\n"
  );
  assert.deepEqual(autoMergeWiring(src), ["concurrency cancel-in-progress"]);
});

test("fixture: group を PR 番号以外にすると拾う", () => {
  const src = real(
    "  group: dependabot-auto-merge-${{ github.event.pull_request.number }}\n",
    "  group: dependabot-auto-merge-${{ github.run_id }}\n"
  );
  assert.deepEqual(autoMergeWiring(src), ["concurrency group"]);
});

test("fixture: concurrency をマージキーで書くと、無いものとして拾う", () => {
  const src = real(
    "concurrency:\n  group: dependabot-auto-merge-${{ github.event.pull_request.number }}\n  cancel-in-progress: false\n",
    "concurrency:\n  <<: {group: 'dependabot-auto-merge-${{ github.event.pull_request.number }}', cancel-in-progress: false}\n"
  );
  assert.deepEqual(autoMergeWiring(src), [
    "concurrency group",
    "concurrency cancel-in-progress",
  ]);
  assert.deepEqual(autoMergeViolations(src), ["merge key concurrency"]);
});

test("fixture: env の値を変えると拾う", () => {
  const src = real(
    "          PR_NUMBER: ${{ github.event.pull_request.number }}",
    "          PR_NUMBER: ${{ github.run_id }}"
  );
  assert.deepEqual(autoMergeWiring(src), ["env PR_NUMBER"]);
});

test("fixture: env のキーを引用符で書いても、値が同じなら違反にしない", () => {
  const src = real("          GH_REPO:", '          "GH_REPO":');
  assert.deepEqual(autoMergeWiring(src), []);
});

test("fixture: メタデータ取得のステップの id を変えると拾う", () => {
  const src = real("        id: metadata\n", "        id: meta\n");
  assert.deepEqual(autoMergeWiring(src), ["metadata id"]);
});

test("fixture: run を持つステップをもう 1 つ足すと拾う", () => {
  const src = real("    steps:\n", "    steps:\n      - run: echo before\n");
  assert.deepEqual(autoMergeWiring(src), ["run steps 2"]);
});

test("fixture: 判定ステップを改名して if を付け、run の無い同名のダミーを置くと拾う", () => {
  // #940 の形。名前だけで判定ステップを特定すると、if の検査も字面の本数も通ってしまう
  const src = real(
    DECIDE_HEAD,
    `      - name: ${DECIDE}\n        uses: actions/github-script@v7\n` +
      "      - name: Renamed\n        if: false\n"
  );
  assert.deepEqual(autoMergeViolations(src), []);
  assert.deepEqual(autoMergeWiring(src), [
    "run step is not decide",
    ...Object.keys(ENV).map((k) => `env ${k}`),
  ]);
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
