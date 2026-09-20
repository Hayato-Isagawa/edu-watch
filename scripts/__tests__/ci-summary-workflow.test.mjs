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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(HERE, "..", "..", ".github", "workflows");
const WORKFLOW = path.join(WORKFLOWS_DIR, "ci-summary.yml");
const yaml = () => fs.readFileSync(WORKFLOW, "utf8");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const MARKER = `<!-- ci-summary: ${SHA} -->`;

/**
 * ワークフローの `run: |` ブロックを取り出す。
 * ci-summary.yml の `run: |` は通知ステップの 1 つだけ。
 * 2 つ目が増えたらこの前提が崩れるので、そのことも下でテストしている。
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
 * @param comments   `issues/{n}/comments` が返す既存コメント(body の配列)。null なら
 *                   API エラー(fixture 無し → exit 1)。
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
      JSON.stringify(comments.map((body) => ({ body })))
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

test("run: | ブロックは 1 つだけ(テストが別のステップを走らせていない)", () => {
  const count = yaml()
    .split("\n")
    .filter((l) => /^\s+run: \|\s*$/.test(l)).length;
  assert.equal(
    count,
    1,
    `run: | が ${count} 個ある。extractRunBlock の前提が崩れている`
  );
});

test("run: が読む値は env で渡っている(SELF は job 名)", () => {
  // SELF が空だと `grep -v -F ""` が全行を落として無音で終わる。キーだけでなく値も固定する。
  const src = yaml();
  for (const line of [
    /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m,
    /^ {10}GH_REPO: \$\{\{ github\.repository \}\}/m,
    /^ {10}SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}$/m,
    /^ {10}PR_FROM_EVENT: \$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.number \}\}$/m,
    /^ {10}SELF: \$\{\{ github\.job \}\}/m,
  ]) {
    assert.match(src, line);
  }
});

test("token の権限は check-run の参照とコメント投稿だけ", () => {
  const block = yaml().match(/^permissions:\n((?: {2}\S.*\n)+)/m);
  assert.ok(block, "permissions: が無い");
  const keys = block[1]
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim().replace(/\s*#.*$/, ""));
  assert.deepEqual(keys.sort(), ["checks: read", "pull-requests: write"]);
});

test("PR 由来の run だけを、Dependabot と自動収集 PR を除いて扱う", () => {
  const src = yaml();
  assert.match(src, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(
    src,
    /github\.event\.workflow_run\.triggering_actor\.login != 'dependabot\[bot\]'/
  );
  // fetch-news / recheck-nikkyo-membership が PAT で作る自動 PR は actor がユーザー本人なので、
  // ブランチ名で除く。外すと自動 PR の CI が緑になるたび(最大 1 日 2 回)通知が届く。
  assert.match(
    src,
    /!startsWith\(github\.event\.workflow_run\.head_branch, 'chore\/auto-collect-'\)/
  );
  assert.match(
    src,
    /!startsWith\(github\.event\.workflow_run\.head_branch, 'chore\/recheck-nikkyo-'\)/
  );
  assert.doesNotMatch(
    src,
    /workflow_run\.conclusion == 'success'\s*&&/,
    "起動元の conclusion で絞ると、最後が skipped のとき再判定が走らない"
  );
});

test("permissions: は workflow 直下の 1 か所だけ(job / step には置かない)", () => {
  // job 直下の `permissions:` は workflow 直下の宣言より優先される。job に `contents: write`
  // を足すと token の権限が静かに広がるが、workflow 直下だけを読む検査では緑のまま通る。
  // 字面の `permissions:` を全行拾い、列 0 の 1 行に固定する。
  const lines = yaml()
    .split("\n")
    .filter((l) => /^\s*permissions:/.test(l));
  assert.deepEqual(lines, ["permissions:"]);
});

test("job の if: の式のどこにも起動元の conclusion を置かない(末尾形も含む)", () => {
  // `conclusion == 'success' &&` の先頭形だけでなく、末尾に
  // `&& github.event.workflow_run.conclusion == 'success'` と付ける形でも、最後に完了した
  // workflow が skipped のとき再判定が走らず通知が消える。式を丸ごと取り出して見る。
  const lines = yaml().split("\n");
  const start = lines.findIndex((l) => /^ {4}if:/.test(l));
  assert.notEqual(start, -1, "job 直下の if: が見つからない");
  const expr = [lines[start].replace(/^ {4}if:\s*/, "")];
  // 継続行は `if:` の列(4)より深い行すべて。`>-` の 6 スペース固定にすると、plain スカラーで
  // 値の列(8 スペース)に揃えた末尾形が 1 行目で打ち切られて素通りする(YAML の値は同一文字列)。
  // 空行は折り畳みの途中にも置けるので飛ばす。
  for (const l of lines.slice(start + 1)) {
    if (l.trim() === "") continue;
    if (!/^ {5,}\S/.test(l)) break;
    expr.push(l.trim());
  }
  const joined = expr.join("\n");
  assert.match(
    joined,
    /workflow_run\.event == 'pull_request'/,
    "if: の式が取れていない"
  );
  assert.doesNotMatch(joined, /conclusion/);
});

test("同じ commit の判定は head_sha で直列化する", () => {
  assert.match(
    yaml(),
    /^ {2}group: ci-summary-\$\{\{ github\.event\.workflow_run\.head_sha \}\}$/m
  );
  assert.match(yaml(), /^ {2}cancel-in-progress: false$/m);
});

test("workflows: の列挙は、PR で起動する workflow の name と過不足なく一致する", () => {
  // PR 起動の workflow を足したのにここへ足し忘れると、その完了では再判定が走らない。
  // `on: pull_request`(1 行形)と `on:` ブロック直下の `pull_request:` の両方を拾う。
  // コメント・`if:` 式・ci-summary 自身の `workflow_run.event == 'pull_request'` は拾わない。
  const expected = [];
  for (const f of fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((n) => /\.ya?ml$/.test(n))) {
    if (f === "ci-summary.yml") continue;
    const src = fs.readFileSync(path.join(WORKFLOWS_DIR, f), "utf8");
    const name = src.match(/^name: (.+)$/m);
    assert.ok(name, `${f} に name: が無い`);
    const onScalar = /^on: pull_request\s*$/m.test(src);
    const onBlock = src.match(/^on:\n((?: {2}.*\n|\n)*)/m);
    const onKeys = onBlock
      ? onBlock[1]
          .split("\n")
          .filter((l) => /^ {2}\S/.test(l))
          .map((l) => l.trim().replace(/:.*$/, ""))
      : [];
    if (onScalar || onKeys.includes("pull_request"))
      expected.push(name[1].trim());
  }
  const listed = yaml().match(/^ {4}workflows: \[(.*)\]$/m);
  assert.ok(listed, "workflows: [...] の 1 行形が読めない");
  const actual = listed[1].split(",").map((s) => s.trim());
  assert.deepEqual(actual.sort(), expected.sort());
});
