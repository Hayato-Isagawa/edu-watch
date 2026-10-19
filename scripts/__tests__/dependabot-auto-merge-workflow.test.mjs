// dependabot-auto-merge.yml の「どの更新を自動マージするか」の判定を固定する(ADR 0078)。
//
// この判定は壊れても**静かに**壊れる。自動マージ側に倒れると、人が見るはずの更新が
// required check だけで main に入る — satori 0.33.5 → 0.56.1(#867)は Dependabot が
// minor と判定したので自動マージされ、OG 画像が全号で崩れた。人が見る側に倒れても、
// PR が開いたまま溜まるだけで何も赤くならない。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。gh はスタブに
// 差し替えて、呼ばれた引数(merge か comment か)を控える。jq は実物を使う。

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
 */
function runStep({
  updateType = "version-update:semver-minor",
  deps = [],
} = {}) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "automerge-"))
  );
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  // 1 回の呼び出しを 1 件として控える。コメント本文は複数行なので、区切りは改行でなく RS(0x1e)。
  fs.writeFileSync(
    path.join(stubs, "gh"),
    `#!/usr/bin/env bash
printf '%s\\036' "$*" >> "$DIR/gh-args"
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
      GH_TOKEN: "stub",
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
  return {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    ghArgs,
    merged,
    comment,
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
  assert.ok(r.comment.startsWith(`pr comment ${PR_URL} --body `), r.comment);
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
