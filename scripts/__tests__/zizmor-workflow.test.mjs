// zizmor.yml の、検査を黙って無効にできる設定を固定する。どれが崩れても workflow は緑のまま検査だけが効かなく
// なる — advanced-security が true なら指摘があっても job は落ちず、config: が外れればリポに置いた設定が CI に効き、
// collect: が既定に戻れば .gitignore に書いた workflow が検査から外れ、env の ZIZMOR_OFFLINE は online の audit を
// 飛ばし、continue-on-error や if: は job を落とさない。「workflow 全体が決まった形」のテストで全体を固定する。
// uses: は形(SHA で pin した同じ action)だけを見て SHA の中身は見ないので、同じ action の古い SHA や fork にある
// 別の SHA への差し替えは通る。行区切りに使われうる単独の CR・U+0085・U+2028・U+2029・yaml の警告・タグ・
// ディレクティブのように yaml と GitHub で読みが食い違いうる書き方は、全体の固定を素通りするので、ファイルに置くこと
// 自体を落とす(workflow-yaml.mjs の ambiguousYaml)。その判定の fixture と、`.github/workflows/` の
// 全部の workflow に判定を当てるテストも、このファイルの末尾に置く。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ambiguousYaml,
  mergeKeyPaths,
  parseWorkflow,
} from "./workflow-yaml.mjs";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "workflows",
  "zizmor.yml"
);
const source = () => fs.readFileSync(FILE, "utf8");
const job = () => parseWorkflow(source()).jobs.zizmor;

test("ステップは checkout・CI 用の設定を書く・zizmor-action の 3 つで、この順", () => {
  assert.deepEqual(
    job().steps.map((s) => s.name),
    ["Checkout", "Write the CI zizmor config", "Run zizmor"]
  );
});

test("CI 用の設定(rules: {})を書くステップは、このとおり", () => {
  assert.deepEqual(job().steps[1], {
    name: "Write the CI zizmor config",
    run: `printf 'rules: {}\\n' > "$RUNNER_TEMP/zizmor-ci.yml"\n`,
  });
});

test("zizmor-action のステップは、advanced-security: false・CI 用の config・collect: all だけを渡す", () => {
  // uses: の SHA は Dependabot が上げるので、形だけを見る
  const { uses, ...rest } = job().steps[2];
  assert.match(uses, /^zizmorcore\/zizmor-action@[0-9a-f]{40}$/);
  assert.deepEqual(rest, {
    name: "Run zizmor",
    with: {
      "advanced-security": false,
      config: "${{ runner.temp }}/zizmor-ci.yml",
      collect: "all",
    },
  });
});

test("workflow 全体が決まった形(env・continue-on-error・if・defaults も checkout の中身も足せない)", () => {
  assert.deepEqual(ambiguousYaml(source()), []);
  // uses: は SHA で pin した同じ action であることだけを見て、比べる前に名前に置き換える(Dependabot が上げるため)
  const doc = parseWorkflow(source());
  for (const step of doc?.jobs?.zizmor?.steps ?? []) {
    if (typeof step?.uses !== "string") continue;
    const m =
      /^(actions\/checkout|zizmorcore\/zizmor-action)@[0-9a-f]{40}$/.exec(
        step.uses
      );
    if (m) step.uses = `<${m[1]}>`;
  }
  assert.deepEqual(doc, {
    name: "zizmor",
    on: {
      pull_request: { branches: ["main"], paths: [".github/**"] },
      schedule: [{ cron: "17 0 * * 1" }],
      workflow_dispatch: null,
    },
    concurrency: {
      group: "zizmor-${{ github.ref }}",
      "cancel-in-progress": true,
    },
    permissions: { contents: "read" },
    jobs: {
      zizmor: {
        name: "zizmor",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 10,
        steps: [
          {
            name: "Checkout",
            uses: "<actions/checkout>",
            with: { "persist-credentials": false },
          },
          {
            name: "Write the CI zizmor config",
            run: `printf 'rules: {}\\n' > "$RUNNER_TEMP/zizmor-ci.yml"\n`,
          },
          {
            name: "Run zizmor",
            uses: "<zizmorcore/zizmor-action>",
            with: {
              "advanced-security": false,
              config: "${{ runner.temp }}/zizmor-ci.yml",
              collect: "all",
            },
          },
        ],
      },
    },
  });
});

test("トリガーは pull_request・週 1 回の schedule・workflow_dispatch で、マージキーを使っていない", () => {
  assert.deepEqual(parseWorkflow(source()).on, {
    pull_request: { branches: ["main"], paths: [".github/**"] },
    schedule: [{ cron: "17 0 * * 1" }],
    workflow_dispatch: null,
  });
  assert.deepEqual(mergeKeyPaths(source()), []);
});

test("全部の workflow に、手元の yaml と GitHub で読みが食い違いうる書き方を置かない", () => {
  // テストが読む workflow だけに当てると、判定を当てない workflow が残る(2026-11 に姉妹リポで調べたとき、別の
  // テストが字面やパース結果で読むのに判定を当てていない workflow が 4 本あった)。判定と理由は ambiguousYaml
  const dir = path.dirname(FILE);
  const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0, ".github/workflows に workflow が無い");
  for (const f of files)
    assert.deepEqual(
      ambiguousYaml(fs.readFileSync(path.join(dir, f), "utf8")),
      [],
      f
    );
});

test("fixture: ambiguousYaml は区切り文字・yaml のエラーと警告・タグ・ディレクティブを拾い、ふつうの書き方は拾わない", () => {
  // 実ファイルでは「何も無い」ことしか見えず、判定が no-op に落ちても緑のまま通るので、書き方ごとに発火を見る
  const base = "name: x\non:\n  push:\n    branches: [main]\n";
  assert.deepEqual(ambiguousYaml(base), [], "ふつうの書き方");
  assert.deepEqual(
    ambiguousYaml(base.replace(/\n/g, "\r\n")),
    [],
    "ファイル全体の CRLF"
  );
  assert.deepEqual(
    ambiguousYaml(`a: "q"\nb: 'r'\nc: {d: [1, 2]}\ne: &x 1\nf: *x\n`),
    [],
    "引用符・フロー形・アンカー"
  );
  for (const [label, src] of [
    ["単独の CR", "# c\rname: x\n"],
    ["U+0085", "# c\u0085name: x\n"],
    ["U+2028", "# c\u2028name: x\n"],
    ["U+2029", "# c\u2029name: x\n"],
    ["未知のディレクティブ", "%FOO bar\n---\nname: x\n"],
    ["キーの重複", "name: x\nname: y\n"],
    ["スカラーの未知のタグ", "name: !foo x\n"],
    ["マップの未知のタグ", "jobs: !foo {a: 1}\n"],
    ["引用符付きの値の型のタグ", 'timeout-minutes: !!int "5"\n'],
    ["警告の出ない既知のタグ", "name: !!timestamp 2001-12-14\n"],
    ["!!str", "name: !!str x\n"],
    ["警告の出ないマップのタグ", "jobs: !!map {a: 1}\n"],
    ["!!set", "a: !!set {x, y}\n"],
    ["非特定タグ !", "a: ! 5\n"],
    ["キーの位置のタグ", "!!str k: 1\n"],
    ["列のタグ", "a: !!seq [1]\n"],
    ["文書ルートのタグ", "--- !!map\na: 1\n"],
    ["%YAML 1.2", "%YAML 1.2\n---\nname: x\n"],
    ["%YAML 1.1", "%YAML 1.1\n---\nname: x\n"],
    ["%TAG", "%TAG !e! tag:example.com,2000:\n---\nname: x\n"],
    ["%TAG で ! を差し替える", "%TAG ! tag:example.com,2000:\n---\nname: x\n"],
    [
      "%TAG で !! を差し替える",
      "%TAG !! tag:example.com,2000:\n---\nname: x\n",
    ],
  ]) {
    assert.notDeepEqual(ambiguousYaml(src), [], label);
  }
});
