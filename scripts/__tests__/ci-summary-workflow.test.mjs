// ci-summary.yml の「全 Actions が成功したときだけ PR に 1 件コメントする」判定を固定する。
//
// このステップは壊れても**静かに**壊れる。失敗時に何もしない設計なので、判定が
// 崩れて通知が消えても workflow は exit 0 のまま、PR の check 一覧にも出ない
// (run は既定ブランチの sha に紐づく)。気づく手段は「通知が来なかった」しかない。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。gh はスタブに
// 差し替え、`--jq` のフィルタは実 jq に通す — `.app.slug == "github-actions"` の絞り込みが
// 無いと、Cloudflare Workers Builds の check-run(workflow_run を起こさない)を待ち続けて
// 再判定の機会が無いまま通知が消える。フィルタを素通りさせると、その退行を検出できない。

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { mergeKeyPaths, parseWorkflow, replaceOnce } from "./workflow-yaml.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(HERE, "..", "..", ".github", "workflows");
const WORKFLOW = path.join(WORKFLOWS_DIR, "ci-summary.yml");
const yaml = () => fs.readFileSync(WORKFLOW, "utf8");

/**
 * 権限と if の規則に反している箇所を返す(例: `job notify permissions` / `step notify[0] if`)。
 *
 * 字面ではなくパース結果で見る。字面だと `"permissions":` / `? permissions` / フロー形のような
 * YAML として等価な書き方も、step の if も、notify より前に置いた別の job も素通りする(#723 / #920)。
 * edu-law の同じテスト(Hayato-Isagawa/edu-law#273 / #336 / #340)からの移植。
 *
 * マージキー(`<<:`)は、使っていること自体を違反にする(workflow-yaml.mjs)。
 *
 * 実ファイルでは違反 0 しか見えず、判定を無効にしても緑のまま通るので、下の fixture で
 * 規則ごとに発火することも確かめている。
 */
function violations(src) {
  const doc = parseWorkflow(src);
  const found = mergeKeyPaths(src).map((at) => `merge key ${at}`);
  if (
    !isDeepStrictEqual(doc?.permissions, {
      checks: "read",
      "pull-requests": "write",
    })
  )
    found.push("workflow permissions");
  for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
    // job 直下の permissions は workflow 直下の宣言より優先され、token の権限が静かに広がる
    if (Object.hasOwn(job ?? {}, "permissions"))
      found.push(`job ${name} permissions`);
    // conclusion で絞ると、最後に完了した workflow が skipped のとき再判定が走らず通知が消える
    if (String(job?.if ?? "").includes("conclusion"))
      found.push(`job ${name} if`);
    (job?.steps ?? []).forEach((step, i) => {
      if (Object.hasOwn(step ?? {}, "permissions"))
        found.push(`step ${name}[${i}] permissions`);
      // step の if は値によらず通知を止めうる(`if: false` でも黙って skip される)ので置かない
      if (Object.hasOwn(step ?? {}, "if")) found.push(`step ${name}[${i}] if`);
    });
  }
  return found;
}

// 通知ステップの run が読む値。SELF が空だと `grep -v -F ""` が全行を落として無音で終わるので、
// キーだけでなく値も固定する。余分なキーは見ない
const ENV = {
  GH_TOKEN: "${{ github.token }}",
  GH_REPO: "${{ github.repository }}",
  SHA: "${{ github.event.workflow_run.head_sha }}",
  PR_FROM_EVENT: "${{ github.event.workflow_run.pull_requests[0].number }}",
  SELF: "${{ github.job }}",
};

/**
 * 通知ステップの配線(run の所在・env の値・直列化)に反している箇所を返す。
 * `violations()` と同じくパース結果で見る。マージキーの検出は `violations()` が受け持つ。
 *
 * job に concurrency を置くと、workflow 直下の group に加えてもう 1 つ group がかかる。
 * 既定の queue: single は待っている run を cancel し、cancel-in-progress も効くので、
 * どちらでも通知が消えうる。
 */
function wiring(src) {
  const doc = parseWorkflow(src);
  const found = [];
  const c = doc?.concurrency;
  if (c?.group !== "ci-summary-${{ github.event.workflow_run.head_sha }}")
    found.push("concurrency group");
  if (c?.["cancel-in-progress"] !== false)
    found.push("concurrency cancel-in-progress");
  for (const [name, job] of Object.entries(doc?.jobs ?? {}))
    if (Object.hasOwn(job ?? {}, "concurrency"))
      found.push(`job ${name} concurrency`);
  const runs = notifyRunSteps(doc);
  if (runs.length !== 1) found.push(`notify run steps ${runs.length}`);
  const env = runs[0]?.env ?? {};
  for (const [key, value] of Object.entries(ENV))
    if (env[key] !== value) found.push(`env ${key}`);
  return found;
}

/** notify job で run を持つステップ。テストが走らせる本体はこの 1 つ */
const notifyRunSteps = (doc) =>
  (doc?.jobs?.notify?.steps ?? []).filter((s) => Object.hasOwn(s ?? {}, "run"));

const SHA = "0123456789abcdef0123456789abcdef01234567";
const MARKER = `<!-- ci-summary: ${SHA} -->`;

/**
 * ワークフローの `run: |` ブロックを取り出す。
 * 字面で最初の `run: |` を取るので、取り出した本文が notify の run と一致することを
 * 下でテストしている。
 */
function extractRunBlock(yamlPath) {
  const lines = fs.readFileSync(yamlPath, "utf8").split("\n");
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

const checkRun = (name, status, conclusion, slug = "github-actions") => ({
  name,
  status,
  conclusion,
  app: { slug },
});
const ACTIONS_GREEN = [
  checkRun("Build site", "completed", "success"),
  checkRun("Playwright E2E", "completed", "success"),
  checkRun("auto-merge", "completed", "skipped"),
];

/**
 * 通知ステップを 1 回走らせる。
 *
 * @param checkRuns  `commits/{sha}/check-runs` が返す check_runs。
 * @param comments   `issues/{n}/comments` が返す既存コメント。文字列なら github-actions[bot] の
 *                   本文、`{ body, login }` なら作者も指定する。null なら API エラー(fixture 無し → exit 1)。
 * @param pulls      `commits/{sha}/pulls` が返す PR。`prFromEvent` が空のときだけ引かれる。
 * @param prFromEvent  `workflow_run.pull_requests[0].number` に相当する env。
 * @param self       `SELF`(job 名)。同名の check-run は除外される。
 */
function runStep({
  checkRuns = ACTIONS_GREEN,
  comments = [],
  pulls = [],
  prFromEvent = "42",
  self = "notify",
} = {}) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cisummary-"))
  );
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);

  fs.writeFileSync(
    path.join(dir, "check-runs.json"),
    JSON.stringify({ check_runs: checkRuns })
  );
  fs.writeFileSync(path.join(dir, "pulls.json"), JSON.stringify(pulls));
  if (comments !== null) {
    fs.writeFileSync(
      path.join(dir, "comments.json"),
      JSON.stringify(
        comments.map((c) => {
          const { body, login = "github-actions[bot]" } =
            typeof c === "string" ? { body: c } : c;
          return { body, user: { login } };
        })
      )
    );
  }

  // gh のスタブ。`api` の path で fixture を選び、`--jq` は**実 jq に通す**。
  // `-f body=` を持つ呼び出しは投稿として本文を控える。fixture が無い path は
  // 404 相当で失敗させる(API エラーが「未投稿」と読まれて二重投稿にならないことを見る)。
  fs.writeFileSync(
    path.join(stubs, "gh"),
    `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$*" >> "$DIR/gh-args"
[ "$1" = "api" ] || { echo "unexpected gh: $*" >&2; exit 1; }
filter=""; prev=""; body=""; endpoint=""
for a in "$@"; do
  case "$prev" in
    --jq) filter="$a" ;;
    -f) body="\${a#body=}" ;;
  esac
  case "$a" in
    repos/*) endpoint="$a" ;;
  esac
  prev="$a"
done
if [ -n "$body" ]; then
  printf '%s' "$body" > "$DIR/commented-body"
  echo '{}'
  exit 0
fi
case "$endpoint" in
  */check-runs) fixture="$DIR/check-runs.json" ;;
  */pulls) fixture="$DIR/pulls.json" ;;
  */comments) fixture="$DIR/comments.json" ;;
  *) echo "unexpected endpoint: $endpoint" >&2; exit 1 ;;
esac
if [ ! -f "$fixture" ]; then
  echo "gh: HTTP 404: Not Found ($endpoint)" >&2
  exit 1
fi
jq -r "$filter" "$fixture"
`,
    { mode: 0o755 }
  );

  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, extractRunBlock(WORKFLOW));

  const res = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      DIR: dir,
      GH_TOKEN: "stub",
      GH_REPO: "example/repo",
      SHA,
      PR_FROM_EVENT: prFromEvent,
      SELF: self,
    },
  });

  const read = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };
  const out = {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    ghArgs: (read("gh-args") ?? "").trim().split("\n").filter(Boolean),
    commentedBody: read("commented-body"),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("jq が使える(スタブは --jq を実 jq に通す)", () => {
  const r = spawnSync("jq", ["--version"], { encoding: "utf8" });
  assert.equal(r.status, 0, "jq が PATH に無い。スタブが --jq を評価できない");
});

test("Actions が全部 success(auto-merge は skipped)なら、PR にコメントを 1 件付ける", () => {
  const r = runStep();
  assert.equal(r.code, 0, r.out);
  assert.ok(r.commentedBody, "コメントが投稿されていない");
  assert.match(r.commentedBody, /@Hayato-Isagawa/);
  assert.ok(r.commentedBody.includes(MARKER), "重複防止のマーカーが本文に無い");
  assert.ok(r.commentedBody.includes(SHA.slice(0, 7)), "短縮 sha が本文に無い");
  assert.equal(
    r.ghArgs.filter((a) => a.includes("-f body=")).length,
    1,
    r.ghArgs.join(" / ")
  );
  assert.match(
    r.ghArgs.find((a) => a.includes("-f body=")),
    /^api repos\/example\/repo\/issues\/42\/comments /
  );
});

test("Cloudflare の check-run が実行中でも、Actions が揃っていれば投稿する", () => {
  const r = runStep({
    checkRuns: [
      ...ACTIONS_GREEN,
      checkRun(
        "Workers Builds: site",
        "in_progress",
        null,
        "cloudflare-workers-and-pages"
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.commentedBody, "Cloudflare を待ってしまい、投稿されていない");
});

test("Cloudflare の check-run が失敗していても、Actions だけを見る", () => {
  const r = runStep({
    checkRuns: [
      ...ACTIONS_GREEN,
      checkRun(
        "Workers Builds: site",
        "completed",
        "failure",
        "cloudflare-workers-and-pages"
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.commentedBody, "Cloudflare の失敗で投稿が止まっている");
});

test("Actions に実行中があれば、何もせず次の完了に任せる", () => {
  const r = runStep({
    checkRuns: [
      checkRun("Build site", "completed", "success"),
      checkRun("Playwright E2E", "in_progress", null),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.commentedBody, null, "揃う前に投稿している");
  assert.match(r.out, /still running/);
});

test("Actions に失敗があれば投稿しない(failure / cancelled / timed_out)", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const r = runStep({
      checkRuns: [
        checkRun("Build site", "completed", "success"),
        checkRun("Playwright E2E", "completed", conclusion),
      ],
    });
    assert.equal(r.code, 0, `${conclusion}: ${r.out}`);
    assert.equal(r.commentedBody, null, `${conclusion} なのに投稿している`);
    assert.match(r.out, /not notifying/);
  }
});

test("Actions の check-run が 1 つも無ければ、何もしない", () => {
  const r = runStep({
    checkRuns: [
      checkRun(
        "Workers Builds: site",
        "completed",
        "success",
        "cloudflare-workers-and-pages"
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.commentedBody, null);
  assert.match(r.out, /no Actions check-runs/);
});

test("自分自身(SELF と同名の check-run)は判定から除く", () => {
  const r = runStep({
    checkRuns: [...ACTIONS_GREEN, checkRun("notify", "in_progress", null)],
    self: "notify",
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.commentedBody, "自分の in_progress を待ってしまっている");
});

test("同じ sha のマーカーがあれば、二重に投稿しない", () => {
  const r = runStep({ comments: ["先行コメント", `✅ 前回\n${MARKER}`] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.commentedBody, null, "二重投稿している");
  assert.match(r.out, /already commented/);
});

test("マーカーの後ろに大量のコメントがあっても、重複を見逃さない(SIGPIPE 回帰)", () => {
  // マーカーを先頭(古い側)に置き、その後ろに pipe 容量(64KB)を超える本文を並べる。
  // `gh ... | grep -q` だと grep が先に抜けて gh が SIGPIPE で落ち、pipefail が
  // 「未投稿」と読んで二重投稿になる(実 gh で再現済み)。順序が逆だと再現しない。
  const big = "x".repeat(5000);
  const r = runStep({
    comments: [MARKER, ...Array.from({ length: 40 }, () => big)],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.commentedBody, null, "SIGPIPE 経路で二重投稿している");
});

test("同じ sha のマーカーでも github-actions[bot] 以外が書いたものは数えない", () => {
  for (const login of ["someone", "dependabot[bot]", "github-actions"]) {
    const r = runStep({ comments: [{ body: `✅ 前回\n${MARKER}`, login }] });
    assert.equal(r.code, 0, `${login}: ${r.out}`);
    assert.ok(r.commentedBody, `${login}: 投稿されなかった`);
  }
});

test("別の sha のマーカーしか無ければ投稿する(再 push は別扱い)", () => {
  const r = runStep({
    comments: ["<!-- ci-summary: ffffffffffffffffffffffffffffffffffffffff -->"],
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.commentedBody, "別 sha のマーカーで止まっている");
});

test("PR 番号がイベントに無ければ、commits/{sha}/pulls から引く", () => {
  const r = runStep({ prFromEvent: "", pulls: [{ number: 7 }] });
  assert.equal(r.code, 0, r.out);
  assert.ok(
    r.ghArgs.some((a) => a.includes(`/commits/${SHA}/pulls`)),
    r.ghArgs.join(" / ")
  );
  assert.match(
    r.ghArgs.find((a) => a.includes("-f body=")),
    /\/issues\/7\/comments /
  );
});

test("PR が見つからなければ、何もしない", () => {
  const r = runStep({ prFromEvent: "", pulls: [] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.commentedBody, null);
  assert.match(r.out, /no pull request found/);
});

test("コメント一覧の API が失敗したら、投稿せずステップごと落ちる", () => {
  // 失敗を「未投稿」と読んで投稿へ進むと二重投稿になる。赤で止まる方を取る。
  const r = runStep({ comments: null });
  assert.notEqual(r.code, 0, "API エラーを握り潰している");
  assert.equal(r.commentedBody, null, "API エラーなのに投稿している");
});

test("テストが走らせる本文は、notify の run そのもの", () => {
  // extractRunBlock は字面で最初の `run: |` を取る。別のステップに run を足すと、
  // テストが本体とは別のスクリプトを検証することになる
  assert.deepEqual(
    wiring(yaml()).filter((v) => v.startsWith("notify run steps")),
    []
  );
  const [step] = notifyRunSteps(parseWorkflow(yaml()));
  assert.equal(
    String(step.run).trimEnd(),
    extractRunBlock(WORKFLOW).trimEnd(),
    "extractRunBlock が notify の run と別の本文を取り出している"
  );
});

test("run: が読む値は env で渡っている(SELF は job 名)", () => {
  assert.deepEqual(
    wiring(yaml()).filter((v) => v.startsWith("env ")),
    []
  );
});

test("マージキー(<<:)を使っていない(GitHub Actions は展開しない)", () => {
  assert.deepEqual(
    violations(yaml()).filter((v) => v.startsWith("merge key")),
    []
  );
});

test("token の権限は check-run の参照とコメント投稿だけ", () => {
  assert.deepEqual(
    violations(yaml()).filter((v) => v === "workflow permissions"),
    []
  );
});

test("PR 由来の run だけを、Dependabot と自動収集 PR を除いて扱う", () => {
  // 字面ではなく notify の if の値で見る(コメント行に移しただけの式を拾わない)。
  // 部分一致だと `… != 'dependabot[bot]' || true` のように字面を残したまま条件を
  // 無効にできるので、空白を詰めた式全体を固定する。式を変えるときはこの期待値も直す
  //
  // fetch-news / recheck-nikkyo-membership が PAT で作る自動 PR は actor がユーザー本人なので、
  // ブランチ名で除く。外すと自動 PR の CI が緑になるたび(最大 1 日 2 回)通知が届く。
  const cond = String(parseWorkflow(yaml()).jobs?.notify?.if ?? "")
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(
    cond,
    "github.event.workflow_run.event == 'pull_request' && " +
      "github.event.workflow_run.triggering_actor.login != 'dependabot[bot]' && " +
      "!startsWith(github.event.workflow_run.head_branch, 'chore/auto-collect-') && " +
      "!startsWith(github.event.workflow_run.head_branch, 'chore/recheck-nikkyo-')"
  );
  const src = yaml();
  assert.doesNotMatch(
    src,
    /workflow_run\.conclusion == 'success'\s*&&/,
    "起動元の conclusion で絞ると、最後が skipped のとき再判定が走らない"
  );
});

test("permissions: は workflow 直下の 1 か所だけ(job / step には置かない)", () => {
  assert.deepEqual(
    violations(yaml()).filter((v) => v.endsWith(" permissions")),
    []
  );
});

test("job の if: に起動元の conclusion を置かず、step には if: を置かない", () => {
  // `conclusion == 'success' &&` の先頭形だけでなく、末尾に
  // `&& github.event.workflow_run.conclusion == 'success'` と付ける形でも、最後に完了した
  // workflow が skipped のとき再判定が走らず通知が消える。notify の if の式そのものは
  // 「PR 由来の run だけを…」が完全一致で見ている。
  assert.deepEqual(
    violations(yaml()).filter((v) => v.endsWith(" if")),
    []
  );
});

// ---- 判定そのものの fixture(#723 で素通りしていた書き方)----

const FIXTURE = `on:
  workflow_run:
    workflows: [Checks]
    types: [completed]
permissions:
  checks: read
  pull-requests: write
jobs:
  notify:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`;

const fixture = (from, to) => replaceOnce(FIXTURE, from, to);

const JOB_PERMS = (key) =>
  fixture(
    "    runs-on: ubuntu-latest\n",
    `    runs-on: ubuntu-latest\n    ${key}\n      contents: write\n`
  );

test("fixture: 手を加えない形では違反 0(以下の fixture の対照)", () => {
  assert.deepEqual(violations(FIXTURE), []);
});

test('fixture: job の "permissions": を拾う', () => {
  assert.deepEqual(violations(JOB_PERMS('"permissions":')), [
    "job notify permissions",
  ]);
});

test("fixture: job の 'permissions': を拾う", () => {
  assert.deepEqual(violations(JOB_PERMS("'permissions':")), [
    "job notify permissions",
  ]);
});

test("fixture: job の permissions : (コロンの前に空白)を拾う", () => {
  assert.deepEqual(violations(JOB_PERMS("permissions :")), [
    "job notify permissions",
  ]);
});

test("fixture: job の ? permissions(明示キー)を拾う", () => {
  const src = fixture(
    "    runs-on: ubuntu-latest\n",
    "    runs-on: ubuntu-latest\n    ? permissions\n    : {contents: write}\n"
  );
  assert.deepEqual(violations(src), ["job notify permissions"]);
});

test("fixture: フロー形の job の permissions を拾う", () => {
  const src = fixture(
    FIXTURE.slice(FIXTURE.indexOf("  notify:\n")),
    "  notify: {permissions: {contents: write}, runs-on: ubuntu-latest, steps: [{run: echo ok}]}\n"
  );
  assert.deepEqual(violations(src), ["job notify permissions"]);
});

test("fixture: マージキー(<<:)で入れた job の permissions は、マージキーとして拾う", () => {
  // GitHub は展開しないので permissions としては効かないが、書いた側の意図はそれ
  const src = fixture(
    "    runs-on: ubuntu-latest\n",
    "    runs-on: ubuntu-latest\n    <<: {permissions: {contents: write}}\n"
  );
  assert.deepEqual(violations(src), ["merge key jobs.notify"]);
});

test("fixture: workflow 直下の permissions をマージキーで書くと、権限が無いものとして拾う", () => {
  // merge: true で読むと deepEqual が通ってしまう形(GitHub では権限が宣言されていない)
  const src = fixture(
    "permissions:\n  checks: read\n  pull-requests: write\n",
    "permissions:\n  <<: {checks: read, pull-requests: write}\n"
  );
  assert.deepEqual(violations(src), [
    "merge key permissions",
    "workflow permissions",
  ]);
});

test("fixture: step の permissions を拾う", () => {
  const src = fixture(
    "      - run: echo ok\n",
    "      - run: echo ok\n        permissions:\n          contents: write\n"
  );
  assert.deepEqual(violations(src), ["step notify[0] permissions"]);
});

test("fixture: step の if: false を拾う", () => {
  const src = fixture(
    "      - run: echo ok\n",
    "      - if: false\n        run: echo ok\n"
  );
  assert.deepEqual(violations(src), ["step notify[0] if"]);
});

test("fixture: step の if: の conclusion を拾う", () => {
  const src = fixture(
    "      - run: echo ok\n",
    "      - if: github.event.workflow_run.conclusion == 'success'\n        run: echo ok\n"
  );
  assert.deepEqual(violations(src), ["step notify[0] if"]);
});

test("fixture: notify より前に別の job があっても、notify の末尾形の conclusion を拾う", () => {
  const src = fixture(
    "jobs:\n  notify:\n    if: github.event.workflow_run.event == 'pull_request'\n",
    "jobs:\n  pre:\n    if: github.event.workflow_run.event == 'pull_request'\n" +
      "    runs-on: ubuntu-latest\n    steps:\n      - run: echo pre\n" +
      "  notify:\n    if: github.event.workflow_run.event == 'pull_request'" +
      " && github.event.workflow_run.conclusion == 'success'\n"
  );
  assert.deepEqual(violations(src), ["job notify if"]);
});

test("fixture: workflow 直下の permissions に空行を挟んで足した権限を拾う", () => {
  const src = fixture(
    "  pull-requests: write\n",
    "  pull-requests: write\n\n  contents: write\n"
  );
  assert.deepEqual(violations(src), ["workflow permissions"]);
});

test("同じ commit の判定は head_sha で直列化する", () => {
  assert.deepEqual(
    wiring(yaml()).filter((v) => v.includes("concurrency")),
    []
  );
});

// ---- 配線(wiring)の fixture。実ファイルの 1 か所だけを書き換える ----

const real = (from, to) => replaceOnce(yaml(), from, to);

test("fixture: 実ファイルのままでは配線の違反 0(以下の fixture の対照)", () => {
  assert.deepEqual(wiring(yaml()), []);
});

test("fixture: job に置いた concurrency を拾う", () => {
  const src = real("  notify:\n", "  notify:\n    concurrency: notify\n");
  assert.deepEqual(wiring(src), ["job notify concurrency"]);
});

test('fixture: job に置いた "concurrency": (引用符付き)を拾う', () => {
  const src = real("  notify:\n", '  notify:\n    "concurrency": notify\n');
  assert.deepEqual(wiring(src), ["job notify concurrency"]);
});

test("fixture: cancel-in-progress を true にすると拾う", () => {
  const src = real(
    "  cancel-in-progress: false\n",
    "  cancel-in-progress: true\n"
  );
  assert.deepEqual(wiring(src), ["concurrency cancel-in-progress"]);
});

test("fixture: group を head_sha 以外にすると拾う", () => {
  const src = real(
    "  group: ci-summary-${{ github.event.workflow_run.head_sha }}\n",
    "  group: ci-summary-${{ github.run_id }}\n"
  );
  assert.deepEqual(wiring(src), ["concurrency group"]);
});

test("fixture: concurrency をマージキーで書くと、無いものとして拾う", () => {
  const src = real(
    "concurrency:\n  group: ci-summary-${{ github.event.workflow_run.head_sha }}\n  cancel-in-progress: false\n",
    "concurrency:\n  <<: {group: 'ci-summary-${{ github.event.workflow_run.head_sha }}', cancel-in-progress: false}\n"
  );
  assert.deepEqual(wiring(src), [
    "concurrency group",
    "concurrency cancel-in-progress",
  ]);
  assert.deepEqual(violations(src), ["merge key concurrency"]);
});

test("fixture: env の SELF を空にすると拾う", () => {
  const src = real("          SELF: ${{ github.job }}", '          SELF: ""');
  assert.deepEqual(wiring(src), ["env SELF"]);
});

test("fixture: env のキーを引用符で書いても、値が同じなら違反にしない", () => {
  const src = real("          GH_TOKEN:", '          "GH_TOKEN":');
  assert.deepEqual(wiring(src), []);
});

test("fixture: notify に run を持つステップをもう 1 つ足すと拾う", () => {
  const src = real("    steps:\n", "    steps:\n      - run: echo before\n");
  // 先頭に足したステップには env が無いので、env も全部欠けて見える
  assert.deepEqual(wiring(src), [
    "notify run steps 2",
    ...Object.keys(ENV).map((k) => `env ${k}`),
  ]);
});

test("on: は workflow_run だけで、workflows: の列挙は PR で起動する workflow の name と過不足なく一致する", () => {
  // PR 起動の workflow を足したのにここへ足し忘れると、その完了では再判定が走らない。
  // トリガーはパースした `on` から読む。1 行形・フロー形・ブロック形のどれでも、`on:` の中に
  // 列 0 のコメントがあっても拾い、`if:` 式や ci-summary 自身の `workflow_run.event == 'pull_request'`
  // は拾わない。`on` が読めない形(`%YAML 1.1` の下ではキーの `on` が真偽値として読まれ、`on` が無くなる)は落とす。
  const expected = [];
  for (const f of fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((n) => /\.ya?ml$/.test(n))) {
    if (f === "ci-summary.yml") continue;
    const wf = parseWorkflow(
      fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8")
    );
    assert.ok(
      typeof wf?.name === "string" && wf.name.trim(),
      `${f} に name: が無い`
    );
    const on = wf.on;
    const triggers =
      typeof on === "string"
        ? [on]
        : Array.isArray(on)
          ? on
          : on !== null && typeof on === "object"
            ? Object.keys(on)
            : assert.fail(`${f} の on: が読めない: ${JSON.stringify(on)}`);
    if (triggers.includes("pull_request")) expected.push(wf.name.trim());
  }
  const listed = yaml().match(/^ {4}workflows: \[(.*)\]$/m);
  assert.ok(listed, "workflows: [...] の 1 行形が読めない");
  const actual = listed[1].split(",").map((s) => s.trim());
  assert.deepEqual(actual.sort(), expected.sort());
  // workflow_run: の行の ignore[dangerous-triggers] は on: 全体に効き、ここに足したトリガーの指摘も
  // zizmor から消える(1.31.1 で実測)。トリガーを足すなら、抑止を外して zizmor を当て直すこと。
  assert.deepEqual(
    Object.keys(parseWorkflow(yaml()).on ?? {}),
    ["workflow_run"],
    "on: に workflow_run 以外のトリガーがある(抑止がその指摘も黙らせる)"
  );
});
