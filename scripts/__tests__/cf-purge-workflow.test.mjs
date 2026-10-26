// cf-purge.yml の「Workers Builds の終端値をどう扱うか」を固定する。
//
// このステップは壊れても**静かに**壊れる。2026-10-23、main の 53c22bf で Workers の
// ビルドが `terminated` で終わったが、case 文が terminated を知らず「その他 = 待つ」に
// 落ちて 10 分ポーリングを空振りし、warning を出して exit 0 で終わった(run 39906498505)。
// job は緑、purge もしておらず、terminated のビルドには commit の check-run も付かない。
// 気づいたのはマージ後の確認スクリプトだけだった。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。curl と sleep は
// スタブに差し替え、jq は実物に通す(ビルドの絞り込みは jq のフィルタが担っている)。
// ポーリング回数と間隔もワークフローから読む。

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(
  HERE,
  "..",
  "..",
  ".github",
  "workflows",
  "cf-purge.yml"
);
const SHA = "53c22bfb5340aeaeae374abc2dfa8f2badd1bdf0";

const doc = () => YAML.parse(fs.readFileSync(WORKFLOW, "utf8"));
const job = () => doc().jobs.purge;
const step = () => {
  const steps = job().steps;
  assert.equal(steps.length, 1, "purge job のステップが 1 つでなくなった");
  return steps[0];
};

/** ポーリングの回数と間隔はワークフローから読む。**テストに書き写さない。** */
const POLL = (() => {
  const run = step().run;
  const n = run.match(/for i in \$\(seq 1 (\d+)\); do/);
  const s = run.match(/^\s*pending\) sleep (\d+) ;;$/m);
  assert.ok(n, "seq 1 N のポーリングが読み取れない");
  assert.ok(s, "pending) sleep N が読み取れない");
  return { attempts: Number(n[1]), interval: Number(s[1]) };
})();

/**
 * Purge ステップを 1 回走らせる。
 *
 * @param outcomes  builds API の呼び出しごとに返すもの(使い切ったら最後を繰り返す)。
 *                  `null` = ビルドはあるが進行中 / `absent` = 一覧にまだ無い /
 *                  `curlfail` = curl が失敗 / `preview:<値>` = main 以外のブランチの同じ SHA /
 *                  それ以外 = その build_outcome
 * @param tag       services API が返す script tag。空文字なら解決失敗の経路に入る
 */
function runStep({ outcomes, tag = "tag123" }) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cfpurge-"))
  );
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  fs.writeFileSync(path.join(dir, "outcomes"), outcomes.join("\n") + "\n");

  // curl のスタブ。URL で応答を選び、purge と builds の呼び出しを記録する。
  fs.writeFileSync(
    path.join(stubs, "curl"),
    `#!/usr/bin/env bash
set -uo pipefail
url="\${@: -1}"
for a in "$@"; do case "$a" in https://*) url="$a" ;; esac; done
case "$url" in
  */workers/services/*)
    jq -n --arg t "$TAG" '{success:true,result:{default_environment:{script:{tag:$t}}}}' ;;
  */builds/workers/*)
    echo x >> "$DIR/builds-calls"
    n=$(wc -l < "$DIR/builds-calls")
    line=$(sed -n "\${n}p" "$DIR/outcomes")
    [ -n "$line" ] || line=$(grep . "$DIR/outcomes" | tail -n 1)
    branch=main
    case "$line" in preview:*) branch=preview; line="\${line#preview:}" ;; esac
    case "$line" in
      curlfail) echo "curl: (7) Failed to connect" >&2; exit 7 ;;
      absent) echo '{"success":true,"result":[]}' ;;
      null) jq -n --arg s "$SHA" --arg b "$branch" '{success:true,result:[{build_outcome:null,build_trigger_metadata:{commit_hash:$s,branch:$b}}]}' ;;
      *) jq -n --arg s "$SHA" --arg b "$branch" --arg o "$line" '{success:true,result:[{build_outcome:$o,build_trigger_metadata:{commit_hash:$s,branch:$b}}]}' ;;
    esac ;;
  */purge_cache)
    echo x >> "$DIR/purge-calls"
    echo '{"success":true}' ;;
  *) echo "unexpected url: $url" >&2; exit 99 ;;
esac
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(stubs, "sleep"),
    `#!/usr/bin/env bash\necho "$1" >> "$DIR/sleeps"\n`,
    { mode: 0o755 }
  );

  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, step().run);
  const res = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      DIR: dir,
      TAG: tag,
      SHA,
      GITHUB_SHA: SHA,
      CF_API_TOKEN: "stub",
      CF_ACCOUNT_ID: "acct",
      CF_ZONE_ID: "zone",
      WORKER_NAME: "edu-watch",
    },
  });
  const lines = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p)
      ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
      : [];
  };
  const out = {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    builds: lines("builds-calls").length,
    purges: lines("purge-calls").length,
    sleeps: lines("sleeps"),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("jq が使える(ビルドの絞り込みは実 jq に通す)", () => {
  const r = spawnSync("jq", ["--version"], { encoding: "utf8" });
  assert.equal(r.status, 0, "jq が PATH に無い");
});

test("success: purge して exit 0", () => {
  const r = runStep({ outcomes: ["success"] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.purges, 1);
  assert.match(r.out, /Cache purged\./);
});

test("進行中・未掲載・curl 失敗は待ち続け、success で purge する", () => {
  const r = runStep({ outcomes: ["absent", "curlfail", "null", "success"] });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 4);
  assert.equal(r.purges, 1);
  assert.deepEqual(r.sleeps, Array(3).fill(String(POLL.interval)));
});

test("main 以外のブランチの同じ SHA は数えない", () => {
  const r = runStep({
    outcomes: ["preview:success", "preview:terminated", "success"],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 3);
  assert.equal(r.purges, 1);
});

for (const outcome of ["terminated", "fail", "failure"]) {
  test(`${outcome}: 待たずに exit 1、purge しない`, () => {
    const r = runStep({ outcomes: [outcome] });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.builds, 1, "終端値を見たのにポーリングを続けた");
    assert.equal(r.purges, 0);
    assert.deepEqual(r.sleeps, []);
    assert.match(r.out, new RegExp(`::error::.*ended as ${outcome}`));
  });
}

for (const outcome of ["cancelled", "canceled", "skipped"]) {
  test(`${outcome}: 待たずに exit 0、purge しない`, () => {
    const r = runStep({ outcomes: [outcome] });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.builds, 1, "終端値を見たのにポーリングを続けた");
    assert.equal(r.purges, 0);
    assert.doesNotMatch(r.out, /::error::/);
  });
}

test("未知の終端値: 待たずに exit 1、purge しない", () => {
  const r = runStep({ outcomes: ["exploded"] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 1);
  assert.equal(r.purges, 0);
  assert.match(r.out, /::error::Unknown build outcome 'exploded'/);
});

test("2026-10-23 の再現(pending 21 回 → terminated): 22 回目で止まり exit 1", () => {
  const r = runStep({ outcomes: [...Array(21).fill("null"), "terminated"] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 22);
  assert.equal(r.purges, 0);
});

test("ずっと進行中: ポーリング上限まで待って exit 1、purge しない", () => {
  const r = runStep({ outcomes: ["null"] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, POLL.attempts);
  assert.equal(r.purges, 0);
  assert.match(r.out, /::error::Timed out waiting for the build/);
});

test("script tag を引けない: 固定で待ってから purge する(従来どおり)", () => {
  const r = runStep({ outcomes: ["success"], tag: "" });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 0);
  assert.equal(r.purges, 1);
  assert.deepEqual(r.sleeps, ["180"]);
});

test("ポーリングが成功までに約 20 分かかったビルド(2026-10-21)に届く", () => {
  // 6a3cb65 は push の約 20.8 分後に Workers Builds が success になった
  assert.ok(
    POLL.attempts * POLL.interval >= 21 * 60,
    `ポーリング上限 ${POLL.attempts * POLL.interval} 秒では 2026-10-21 のビルドに届かない`
  );
});

test("job の timeout-minutes がポーリング上限より長い", () => {
  // 短いと、ポーリング中に job ごと cancelled になり、::error:: も出ない
  const minutes = job()["timeout-minutes"];
  assert.ok(
    minutes * 60 > POLL.attempts * POLL.interval,
    `timeout-minutes ${minutes} がポーリング上限 ${POLL.attempts * POLL.interval} 秒以下`
  );
});

test("Purge ステップに continue-on-error が無い(exit 1 が job に伝わる)", () => {
  assert.equal(Object.hasOwn(step(), "continue-on-error"), false);
  assert.equal(Object.hasOwn(job(), "continue-on-error"), false);
});
