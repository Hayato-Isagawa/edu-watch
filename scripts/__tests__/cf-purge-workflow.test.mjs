// cf-purge.yml の「Workers Builds の結果をどう扱うか」を固定する。
//
// このステップは壊れても**静かに**壊れる。2026-10-23、main の 53c22bf で Workers の
// ビルドが `terminated` で終わったが、case 文が terminated を知らず「その他 = 待つ」に
// 落ちて 10 分ポーリングを空振りし、warning を出して exit 0 で終わった(run 39906498505)。
// job は緑、purge もしておらず、terminated のビルドには commit の check-run も付かない。
// 気づいたのはマージ後の確認スクリプトだけだった(ADR 0080)。skipped の後に新しい
// ビルドを追うこと、API のエラーの分け方、確かめられないときに purge して赤で終わる
// ことは ADR 0081。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。curl・sleep・date は
// スタブに差し替え、jq は実物に通す(ビルドの絞り込みと並べ替えは jq のフィルタが担っている)。
// curl のスタブは -o / -D / -w を真似て HTTP ステータスを返し、呼び出しの引数を全部記録する。
// 期限・間隔・回数はステップの env から読む。**テストに書き写さない。**

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflow } from "./workflow-yaml.mjs";

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
const NEWER_SHA = "1cf9320aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROD = "6fbfbb65-46dd-47cf-b5a6-59678827502e";
const PREVIEW_TRIGGER = "b5e6b0e3-d1a9-4ac1-9add-444655be1634";
const T0 = 1_800_000_000;

const doc = () => parseWorkflow(fs.readFileSync(WORKFLOW, "utf8"));
const job = () => doc().jobs.purge;
const step = () => {
  const steps = job().steps;
  assert.equal(steps.length, 1, "purge job のステップが 1 つでなくなった");
  return steps[0];
};

/** 期限・間隔・回数はステップの env から読む。 */
const KNOBS = (() => {
  const env = step().env;
  const names = [
    "OWN_BUILD_SECONDS",
    "TOTAL_SECONDS",
    "POLL_INTERVAL",
    "FALLBACK_WAIT",
    "CURL_MAX_TIME",
    "MAX_API_ERRORS",
    "MAX_RETRY_AFTER",
    "PER_PAGE",
  ];
  const out = {};
  for (const n of names) {
    assert.match(String(env[n]), /^[1-9][0-9]*$/, `env.${n} が正の整数でない`);
    out[n] = Number(env[n]);
  }
  return out;
})();

/** builds API の 1 件。既定は「main の本番トリガーで SHA を建てた進行中のビルド」。 */
const build = ({
  outcome = null,
  created = "2026-10-26T07:00:00.000Z",
  trig = PROD,
  sha = SHA,
  branch = "main",
} = {}) => ({
  build_outcome: outcome,
  created_on: created,
  trigger: { trigger_uuid: trig },
  build_trigger_metadata: { commit_hash: sha, branch },
});
/** builds API の応答(200)。 */
const list = (...rows) => ({
  code: 200,
  body: { success: true, result: rows.map(build) },
});
const own = (outcome) => list({ outcome });
const absent = list();
const curlfail = { code: "curlfail" };
const http = (
  code,
  body = { success: false, errors: [{ message: `e${code}` }] },
  headers
) => ({ code, body, headers });
const OLD = "2026-10-26T07:00:00.000Z";
const NEW = "2026-10-26T07:01:00.000Z";
const NEWEST = "2026-10-26T07:02:00.000Z";

const SERVICES_OK = {
  code: 200,
  body: {
    success: true,
    result: { default_environment: { script: { tag: "tag123" } } },
  },
};
const PURGE_OK = { code: 200, body: { success: true } };

const CURL_STUB = `#!/usr/bin/env bash
set -uo pipefail
out=""; hdr=""; fmt=""; url=""
args=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -D) hdr="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    -H|-X|--data|--max-time) shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  */workers/services/*) kind=services ;;
  */builds/workers/*) kind=builds ;;
  */purge_cache) kind=purge ;;
  *) echo "unexpected url: $url" >&2; exit 99 ;;
esac
printf '%s\\n' "\${args[@]}" | jq -Rnc --arg k "$kind" --arg u "$url" '{kind:$k,url:$u,args:[inputs]}' >> "$DIR/calls.jsonl"
n=$(grep -c "\\"kind\\":\\"$kind\\"" "$DIR/calls.jsonl")
total=$(jq length "$DIR/$kind.json")
i=$(( n <= total ? n - 1 : total - 1 ))
r=$(jq -c ".[$i]" "$DIR/$kind.json")
secs=$(jq -r '.secs // 0' <<<"$r")
if [ "$secs" != 0 ]; then c=$(cat "$DIR/clock"); echo $((c + secs)) > "$DIR/clock"; fi
code=$(jq -r '.code' <<<"$r")
if [ "$code" = curlfail ]; then
  [ -n "$fmt" ] && printf '000'
  echo "curl: (28) Operation timed out" >&2
  exit 28
fi
if [ -n "$hdr" ]; then
  { printf 'HTTP/2 %s\\r\\n' "$code"; jq -r '(.headers // {}) | to_entries[] | "\\(.key): \\(.value)\\r"' <<<"$r"; printf '\\r\\n'; } > "$hdr"
fi
body=$(jq -r 'if (.body | type) == "string" then .body else (.body | tojson) end' <<<"$r")
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
[ -n "$fmt" ] && printf '%s' "$code"
exit 0
`;

/**
 * Purge ステップを 1 回走らせる。
 *
 * @param builds    builds API の呼び出しごとの応答(使い切ったら最後を繰り返す)
 * @param services  services API(script tag の解決)の応答
 * @param purge     purge API の応答
 * @param env       ステップの env への上書き
 */
function runStep({
  builds = [own("success")],
  services = [SERVICES_OK],
  purge = [PURGE_OK],
  env = {},
} = {}) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cfpurge-"))
  );
  const stubs = path.join(dir, "stubs");
  fs.mkdirSync(stubs);
  fs.writeFileSync(path.join(dir, "builds.json"), JSON.stringify(builds));
  fs.writeFileSync(path.join(dir, "services.json"), JSON.stringify(services));
  fs.writeFileSync(path.join(dir, "purge.json"), JSON.stringify(purge));
  fs.writeFileSync(path.join(dir, "clock"), `${T0}\n`);
  fs.writeFileSync(path.join(stubs, "curl"), CURL_STUB, { mode: 0o755 });
  fs.writeFileSync(
    path.join(stubs, "sleep"),
    `#!/usr/bin/env bash
echo "$1" >> "$DIR/sleeps"
c=$(cat "$DIR/clock"); echo $((c + $1)) > "$DIR/clock"
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(stubs, "date"),
    `#!/usr/bin/env bash
if [ "\${1:-}" = "+%s" ]; then cat "$DIR/clock"; else exec /bin/date "$@"; fi
`,
    { mode: 0o755 }
  );

  const script = path.join(dir, "step.sh");
  fs.writeFileSync(script, step().run);
  const res = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...step().env,
      CF_API_TOKEN: "stub-token",
      CF_ACCOUNT_ID: "acct",
      CF_ZONE_ID: "zone",
      ...env,
      PATH: `${stubs}:${process.env.PATH}`,
      TMPDIR: dir,
      DIR: dir,
      GITHUB_SHA: SHA,
    },
  });
  const lines = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p)
      ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
      : [];
  };
  const calls = lines("calls.jsonl").map((l) => JSON.parse(l));
  const out = {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    calls,
    services: calls.filter((c) => c.kind === "services").length,
    builds: calls.filter((c) => c.kind === "builds").length,
    purges: calls.filter((c) => c.kind === "purge"),
    sleeps: lines("sleeps").map(Number),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const purged = (r) => assert.equal(r.purges.length, 1, r.out);
const notPurged = (r) => assert.equal(r.purges.length, 0, r.out);

test("jq が使える(ビルドの絞り込みは実 jq に通す)", () => {
  const r = spawnSync("jq", ["--version"], { encoding: "utf8" });
  assert.equal(r.status, 0, "jq が PATH に無い");
});

test("success: purge して exit 0。purge は zone の purge_everything を POST する", () => {
  const r = runStep();
  assert.equal(r.code, 0, r.out);
  purged(r);
  const a = r.purges[0].args;
  assert.equal(
    r.purges[0].url,
    "https://api.cloudflare.com/client/v4/zones/zone/purge_cache"
  );
  assert.equal(a[a.indexOf("-X") + 1], "POST");
  assert.deepEqual(JSON.parse(a[a.indexOf("--data") + 1]), {
    purge_everything: true,
  });
  assert.ok(
    a.includes("Authorization: Bearer stub-token"),
    "purge に Authorization が無い"
  );
  assert.match(r.out, /Cache purged\./);
});

test("どの curl にも --max-time が付いている(期限の計算はこの値を前提にしている)", () => {
  const r = runStep();
  assert.ok(r.calls.length >= 3);
  for (const c of r.calls) {
    const i = c.args.indexOf("--max-time");
    assert.ok(i >= 0, `${c.kind} の curl に --max-time が無い`);
    assert.equal(Number(c.args[i + 1]), KNOBS.CURL_MAX_TIME);
  }
});

test("builds の一覧は per_page を env から取る", () => {
  const r = runStep();
  const b = r.calls.find((c) => c.kind === "builds");
  assert.equal(
    new URL(b.url).searchParams.get("per_page"),
    String(KNOBS.PER_PAGE)
  );
  assert.match(b.url, /\/builds\/workers\/tag123\/builds\?/);
});

test("進行中・未掲載・curl の失敗は待ち続け、success で purge する", () => {
  const r = runStep({
    builds: [absent, curlfail, own(null), own("success")],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 4);
  purged(r);
  assert.deepEqual(r.sleeps, Array(3).fill(KNOBS.POLL_INTERVAL));
});

test("main 以外のブランチの同じ SHA は数えない", () => {
  const r = runStep({
    builds: [
      list({ outcome: "success", branch: "fix/x", trig: PREVIEW_TRIGGER }),
      list({ outcome: "terminated", branch: "fix/x", trig: PREVIEW_TRIGGER }),
      own("success"),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 3);
  purged(r);
});

test("別の commit のビルドは数えない", () => {
  const r = runStep({
    builds: [list({ outcome: "success", sha: NEWER_SHA }), own("success")],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 2);
  purged(r);
});

for (const outcome of ["terminated", "fail", "failure"]) {
  test(`${outcome}: 待たずに exit 1、purge しない`, () => {
    const r = runStep({ builds: [own(outcome)] });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.builds, 1, "終端値を見たのにポーリングを続けた");
    notPurged(r);
    assert.deepEqual(r.sleeps, []);
    assert.match(r.out, new RegExp(`::error::.*ended as ${outcome}`));
  });
}

test("未知の終端値: 待たずに exit 1、purge しない", () => {
  const r = runStep({ builds: [own("exploded")] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 1);
  notPurged(r);
  assert.match(r.out, /::error::Unknown build outcome 'exploded'/);
});

test("2026-10-23 の再現(pending 21 回 → terminated): 22 回目で止まり exit 1", () => {
  const r = runStep({
    builds: [...Array(21).fill(own(null)), own("terminated")],
  });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 22);
  notPurged(r);
});

test("ずっと進行中: 自分のビルドの期限まで待って exit 1、purge しない", () => {
  const r = runStep({ builds: [own(null)] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, KNOBS.OWN_BUILD_SECONDS / KNOBS.POLL_INTERVAL);
  notPurged(r);
  assert.match(r.out, /::error::Timed out waiting for the build of /);
});

test("期限は経過時間で測る(curl にかかった時間も数える)", () => {
  const slow = KNOBS.POLL_INTERVAL;
  const r = runStep({ builds: [{ ...own(null), secs: slow }] });
  assert.equal(r.code, 1, r.out);
  assert.equal(
    r.builds,
    Math.ceil(KNOBS.OWN_BUILD_SECONDS / (KNOBS.POLL_INTERVAL + slow))
  );
});

// 同じ SHA の再ビルド。一覧の並び順に依存せず、created_on が新しい方を見る。
for (const [label, order] of [
  ["新しい順", (a, b) => [b, a]],
  ["古い順", (a, b) => [a, b]],
]) {
  test(`同じ SHA の再ビルド(${label}): 新しい方の terminated で exit 1`, () => {
    const rows = order(
      { outcome: "success", created: OLD },
      { outcome: "terminated", created: NEW }
    );
    const r = runStep({ builds: [list(...rows)] });
    assert.equal(r.code, 1, r.out);
    notPurged(r);
  });
  test(`同じ SHA の再ビルド(${label}): 新しい方の success で purge`, () => {
    const rows = order(
      { outcome: "terminated", created: OLD },
      { outcome: "success", created: NEW }
    );
    const r = runStep({ builds: [list(...rows)] });
    assert.equal(r.code, 0, r.out);
    purged(r);
  });
}

test("created_on は時刻として並べる(小数秒の有無で文字列順と食い違う)", () => {
  // 文字列では "…:11.500Z" < "…:11Z" なので、文字列で並べると古い方を選ぶ
  const r = runStep({
    builds: [
      list(
        { outcome: "terminated", created: "2026-10-26T07:13:11Z" },
        { outcome: "success", created: "2026-10-26T07:13:11.500Z" }
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  purged(r);
});

// skipped / cancelled の後は、置き換えた新しいビルドを追う(ADR 0081)
const skippedThen = (...newer) =>
  list(...newer, { outcome: "skipped", created: OLD });

test("skipped → 新しいビルドが success: purge して exit 0", () => {
  const r = runStep({
    builds: [skippedThen({ outcome: "success", created: NEW, sha: NEWER_SHA })],
  });
  assert.equal(r.code, 0, r.out);
  purged(r);
  assert.match(r.out, /following the newer build/);
});

test("skipped → 新しいビルドが進行中 → success: 待ってから purge", () => {
  const running = skippedThen({ outcome: null, created: NEW, sha: NEWER_SHA });
  const r = runStep({
    builds: [
      running,
      running,
      skippedThen({ outcome: "success", created: NEW, sha: NEWER_SHA }),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.builds, 3);
  purged(r);
});

for (const outcome of ["terminated", "fail"]) {
  test(`skipped → 新しいビルドが ${outcome}: exit 1、purge しない`, () => {
    const r = runStep({
      builds: [skippedThen({ outcome, created: NEW, sha: NEWER_SHA })],
    });
    assert.equal(r.code, 1, r.out);
    notPurged(r);
    assert.match(
      r.out,
      new RegExp(`::error::.*${NEWER_SHA} ended as ${outcome}`)
    );
  });
}

test("skipped の連鎖(自分 → B skipped → C success): 最新の C を見て purge", () => {
  const r = runStep({
    builds: [
      skippedThen(
        { outcome: "skipped", created: NEW, sha: "b".repeat(40) },
        { outcome: "success", created: NEWEST, sha: NEWER_SHA }
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  purged(r);
});

for (const outcome of ["skipped", "cancelled", "canceled"]) {
  test(`${outcome} で新しいビルドが無い: 待たずに exit 0、purge しない`, () => {
    const r = runStep({ builds: [list({ outcome, created: OLD })] });
    assert.equal(r.code, 0, r.out);
    notPurged(r);
    assert.deepEqual(r.sleeps, []);
    assert.doesNotMatch(r.out, /::error::/);
    assert.match(r.out, /No newer build superseded/);
  });
}

test("skipped → 新しいビルドも cancelled: purge せず exit 0", () => {
  const r = runStep({
    builds: [
      skippedThen({ outcome: "cancelled", created: NEW, sha: NEWER_SHA }),
    ],
  });
  assert.equal(r.code, 0, r.out);
  notPurged(r);
  assert.doesNotMatch(r.out, /::error::/);
  assert.match(r.out, new RegExp(`newer build ${NEWER_SHA} was cancelled`));
});

test("skipped より前の古い success は追わない", () => {
  const r = runStep({
    builds: [
      list(
        { outcome: "skipped", created: NEW },
        { outcome: "success", created: OLD, sha: NEWER_SHA }
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  notPurged(r);
});

test("skipped の後の新しいビルドでも、トリガーやブランチが違えば追わない", () => {
  const r = runStep({
    builds: [
      skippedThen(
        {
          outcome: "success",
          created: NEW,
          sha: NEWER_SHA,
          trig: PREVIEW_TRIGGER,
        },
        { outcome: "success", created: NEWEST, sha: NEWER_SHA, branch: "fix/x" }
      ),
    ],
  });
  assert.equal(r.code, 0, r.out);
  notPurged(r);
  assert.match(r.out, /No newer build superseded/);
});

test("skipped → 新しいビルドが終わらない: 全体の期限で exit 1、purge しない", () => {
  const r = runStep({
    builds: [skippedThen({ outcome: null, created: NEW, sha: NEWER_SHA })],
  });
  assert.equal(r.code, 1, r.out);
  notPurged(r);
  assert.match(
    r.out,
    /::error::Timed out waiting for the build that superseded/
  );
  // skipped を見た 1 回(待たない)と、全体の期限までの間隔ごとの 1 回
  assert.equal(r.builds, KNOBS.TOTAL_SECONDS / KNOBS.POLL_INTERVAL + 1);
});

// ビルドを確かめられないときは、固定時間待って purge し、赤で終わる(ADR 0081)
test("script tag を引けない: 固定時間待って purge し、exit 1", () => {
  const r = runStep({
    services: [{ code: 200, body: { success: true, result: {} } }],
  });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 0);
  purged(r);
  assert.deepEqual(r.sleeps, [KNOBS.FALLBACK_WAIT]);
  assert.match(r.out, /::error::Could not resolve the script tag/);
});

for (const code of [401, 403, 404]) {
  test(`tag の解決が HTTP ${code}: 再試行せず purge して exit 1(本文を出す)`, () => {
    const r = runStep({ services: [http(code)] });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.services, 1);
    assert.equal(r.builds, 0);
    purged(r);
    assert.match(
      r.out,
      new RegExp(`::error::Cloudflare API returned HTTP ${code}: .*e${code}`)
    );
  });
  test(`builds が HTTP ${code}: 再試行せず purge して exit 1`, () => {
    const r = runStep({ builds: [http(code)] });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.builds, 1);
    purged(r);
    assert.match(
      r.out,
      new RegExp(`::error::Cloudflare API returned HTTP ${code}`)
    );
  });
}

test("tag の解決の 5xx は一時的: 上限の手前で回復すれば通常どおり", () => {
  const r = runStep({
    services: [...Array(KNOBS.MAX_API_ERRORS - 1).fill(http(502)), SERVICES_OK],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.services, KNOBS.MAX_API_ERRORS);
  purged(r);
});

test("tag の解決での失敗の回数は、builds の取得に持ち越さない", () => {
  const n = KNOBS.MAX_API_ERRORS - 1;
  const r = runStep({
    services: [...Array(n).fill(http(502)), SERVICES_OK],
    builds: [http(502), own("success")],
  });
  assert.equal(r.code, 0, r.out);
  purged(r);
});

test("tag の解決が 429 のまま期限に届く: purge して exit 1(ADR 0082)", () => {
  const limited = http(429, { success: false }, { "Retry-After": "60" });
  const r = runStep({ services: [limited] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, 0);
  purged(r);
  assert.match(r.out, /::error::Timed out looking up the script tag/);
  assert.equal(r.services, Math.ceil(KNOBS.OWN_BUILD_SECONDS / 60));
});

test("tag の解決の 5xx が上限まで続く: purge して exit 1", () => {
  const r = runStep({ services: [http(503)] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.services, KNOBS.MAX_API_ERRORS);
  assert.equal(r.builds, 0);
  purged(r);
  assert.match(r.out, /::error::Cloudflare API failed \d+ times in a row/);
});

for (const [label, fail] of [
  ["5xx", http(500)],
  ["curl の失敗", curlfail],
  ["success:false の 200", { code: 200, body: { success: false } }],
  ["JSON でない 200", { code: 200, body: "<html>" }],
]) {
  test(`builds の${label}が上限まで続く: purge して exit 1`, () => {
    const r = runStep({ builds: [fail] });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.builds, KNOBS.MAX_API_ERRORS);
    purged(r);
    assert.match(r.out, /::error::Cloudflare API failed/);
  });
}

test("一時的な失敗の回数は、成功を挟むと数え直す", () => {
  const n = KNOBS.MAX_API_ERRORS - 1;
  const r = runStep({
    builds: [
      ...Array(n).fill(http(502)),
      own(null),
      ...Array(n).fill(http(502)),
      own("success"),
    ],
  });
  assert.equal(r.code, 0, r.out);
  purged(r);
  assert.doesNotMatch(r.out, /::error::/);
});

test("一覧を読めない(created_on が無い)のも一時的な失敗として数える", () => {
  const broken = {
    code: 200,
    body: { success: true, result: [{ ...build(), created_on: null }] },
  };
  const r = runStep({ builds: [broken] });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.builds, KNOBS.MAX_API_ERRORS);
  assert.match(r.out, /Could not read the builds list/);
});

test("created_on が想定外の書式(時差つき)なら、黙って追う先を見失わず一時的な失敗として数える", () => {
  // capture は一致しないと何も出さない。エラーにしないと「新しいビルドが無い」に化けて緑になる
  const r = runStep({
    builds: [
      list(
        {
          outcome: "success",
          created: "2026-10-26T07:01:00+00:00",
          sha: NEWER_SHA,
        },
        { outcome: "skipped", created: "2026-10-26T07:00:00+00:00" }
      ),
    ],
  });
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /No newer build superseded/);
  assert.match(r.out, /Could not read the builds list/);
});

test("429 は Retry-After だけ待ち、失敗の回数に数えない", () => {
  const n = KNOBS.MAX_API_ERRORS + 2;
  const limited = http(429, { success: false }, { "Retry-After": "60" });
  const r = runStep({ builds: [...Array(n).fill(limited), own("success")] });
  assert.equal(r.code, 0, r.out);
  purged(r);
  assert.deepEqual(r.sleeps, Array(n).fill(60));
});

test("429 の Retry-After は上限で切り、無ければ通常の間隔で待つ", () => {
  const huge = String(KNOBS.MAX_RETRY_AFTER * 10);
  const r = runStep({
    builds: [
      http(429, { success: false }, { "retry-after": huge }),
      http(429, { success: false }),
      own("success"),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.sleeps, [KNOBS.MAX_RETRY_AFTER, KNOBS.POLL_INTERVAL]);
});

test("429 の Retry-After が通常の間隔より短ければ、通常の間隔で待つ", () => {
  // 0 や 1 のまま従うと、回数に数えないので期限まで API を叩き続ける(#943)
  const r = runStep({
    builds: [
      http(429, { success: false }, { "Retry-After": "0" }),
      http(429, { success: false }, { "Retry-After": "1" }),
      own("success"),
    ],
  });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.sleeps, [KNOBS.POLL_INTERVAL, KNOBS.POLL_INTERVAL]);
});

test("429 のまま期限に届いたら、確かめられないので purge して exit 1", () => {
  const limited = http(429, { success: false }, { "Retry-After": "60" });
  const r = runStep({ builds: [limited] });
  assert.equal(r.code, 1, r.out);
  purged(r);
  assert.match(
    r.out,
    /::error::Rate limited by the Cloudflare API until the deadline/
  );
  assert.equal(r.builds, Math.ceil(KNOBS.OWN_BUILD_SECONDS / 60));
});

test("429 を挟んでも、最後が進行中なら期限切れは purge しない", () => {
  const limited = http(429, { success: false }, { "Retry-After": "60" });
  const r = runStep({ builds: [limited, limited, own(null)] });
  assert.equal(r.code, 1, r.out);
  notPurged(r);
  assert.match(r.out, /::error::Timed out waiting for the build of /);
});

test("purge が success:false: exit 1(本文を出す)", () => {
  const r = runStep({
    purge: [
      { code: 200, body: { success: false, errors: [{ message: "nope" }] } },
    ],
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Purge failed: .*nope/);
});

test("purge の curl が失敗: exit 1", () => {
  const r = runStep({ purge: [curlfail] });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Purge failed: curl exited 28/);
});

for (const name of ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_ZONE_ID"]) {
  test(`${name} が空: API を呼ばずに exit 1`, () => {
    const r = runStep({ env: { [name]: "" } });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.calls.length, 0);
    assert.match(r.out, /::error::Missing /);
  });
}

test("自分のビルドの期限が、成功までに約 20 分かかったビルド(2026-10-21)に届く", () => {
  // 6a3cb65 は push の約 20.8 分後に Workers Builds が success になった
  assert.ok(
    KNOBS.OWN_BUILD_SECONDS >= 21 * 60,
    `OWN_BUILD_SECONDS ${KNOBS.OWN_BUILD_SECONDS} では 2026-10-21 のビルドに届かない`
  );
});

test("全体の期限は自分のビルドの期限より長い", () => {
  assert.ok(KNOBS.TOTAL_SECONDS > KNOBS.OWN_BUILD_SECONDS);
});

test("job の timeout-minutes が、期限を越えうる最大の時間より長い", () => {
  // 期限の判定は API を呼ぶ前。最後の 1 回の待ち(最長 MAX_RETRY_AFTER)と、builds と
  // purge の curl 2 回分だけ期限を越えうる。60 秒は runner の準備の余裕。
  // 短いと job ごと cancelled になり、::error:: も出ない
  const minutes = job()["timeout-minutes"];
  const worst =
    KNOBS.TOTAL_SECONDS + KNOBS.MAX_RETRY_AFTER + 2 * KNOBS.CURL_MAX_TIME + 60;
  assert.ok(
    minutes * 60 >= worst,
    `timeout-minutes ${minutes} が ${worst} 秒に届かない`
  );
});

test("Purge ステップに continue-on-error が無い(exit 1 が job に伝わる)", () => {
  assert.equal(Object.hasOwn(step(), "continue-on-error"), false);
  assert.equal(Object.hasOwn(job(), "continue-on-error"), false);
});
