// assert-test-results.mjs の `--exact`(pass が下限とちょうど一致しなければ落とす)を固定する。
//
// `test:workflows` の下限は「実測ちょうど」だが、判定器が下限以上を通すだけだと、テストを足す
// PR が 2 本並んだときに同じ行の書き換えが squash で消え、下限が実測より低いまま残る(#944 と
// #946 で起きた。#949)。判定器自身が壊れても `test:workflows` は緑のままなので、一時ディレクトリに
// テストを置いて判定器を直接走らせ、exit を見る。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const CHECKER = path.join(ROOT, "scripts", "assert-test-results.mjs");

const dirs = [];
after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** pass するテストを `n` 件持つファイルを一時ディレクトリに置き、その glob を返す。 */
function fixture(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-results-"));
  dirs.push(dir);
  const body = Array.from(
    { length: n },
    (_, i) => `test("t${i}", () => {});`
  ).join("\n");
  fs.writeFileSync(
    path.join(dir, "a.test.mjs"),
    `import test from "node:test";\n${body}\n`
  );
  return path.join(dir, "*.test.mjs");
}

function run(args) {
  // `node --test` の配下で継承すると、内側の `node --test` が再帰呼び出しとして 0 件実行になる
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return spawnSync(process.execPath, [CHECKER, ...args], {
    encoding: "utf8",
    env,
  });
}

test("--exact: pass が下限より多いと落とす", () => {
  const r = run(["--exact", "1", fixture(2)]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /pass 2 件が下限 1 より多い/);
});

test("--exact: pass が下限と一致すれば通す", () => {
  const r = run(["--exact", "2", fixture(2)]);
  assert.equal(r.status, 0, r.stderr);
});

test("--exact: pass が下限を下回っても落とす", () => {
  const r = run(["--exact", "3", fixture(2)]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /pass 2 件が下限 3 を下回る/);
});

test("--exact なしは、pass が下限より多くても通す(test:hooks の境界値の下限)", () => {
  const r = run(["1", fixture(2)]);
  assert.equal(r.status, 0, r.stderr);
});

test("test:workflows は --exact で、test:hooks は付けずに判定器を通す", () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  ).scripts;
  assert.match(
    scripts["test:workflows"],
    / && node scripts\/assert-test-results\.mjs --exact \d+ 'scripts\/__tests__\/\*\.test\.mjs'$/
  );
  assert.match(
    scripts["test:hooks"],
    / && node scripts\/assert-test-results\.mjs \d+ '\.claude\/hooks\/__tests__\/\*\.test\.cjs'$/
  );
});
