// zizmor.yml の、検査を黙って無効にできる設定を固定する。どれが崩れても workflow は緑のまま検査だけが効かなく
// なる — advanced-security が true なら指摘があっても job は落ちず、config: が外れればリポに置いた設定が CI に効き、
// collect: が既定に戻れば .gitignore に書いた workflow が検査から外れ、env の ZIZMOR_OFFLINE は online の audit を
// 飛ばし、continue-on-error や if: は job を落とさない。「workflow 全体が決まった形」のテストで全体を固定する。
// uses: は形(SHA で pin した同じ action)だけを見て SHA の中身は見ないので、同じ action の古い SHA や fork にある
// 別の SHA への差し替えは通る。行区切りに使われうる単独の CR・U+0085・U+2028・U+2029 は、yaml と GitHub で読みが
// 食い違うので、ファイルに置くこと自体を落とす。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeKeyPaths, parseWorkflow } from "./workflow-yaml.mjs";

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
  assert.doesNotMatch(
    source().replace(/\r\n/g, "\n"),
    /[\r\u0085\u2028\u2029]/,
    "行区切りに使われうる文字がある"
  );
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
