// VRT の撮影が静かに減る経路を塞ぐ。edu-law / edu-evidence の同名テストの移植。
//
// **VRT の中には置けない。** VRT は required check ではなく、`vrt.yml` の `paths` に
// 載る PR でしか起動しない。撮影を減らす変更が `vrt/**` に触れるとは限らない
// (`playwright.vrt.config.ts` の projects を削るのがその例)し、そもそも VRT が走らない
// PR では VRT の中のガードも走らない。ここは required check「Type and text checks」の
// `test:workflows` ステップで常に走る(`vrt-baseline.test.mjs` と同じ口)。
//
// 撮影が減っても**表向きは何も起きない**。落ちるテストが 48 件から 24 件になるだけで、
// 残った分は緑のまま通り、`npm run vrt` の終了コードも 0 のまま。CI からは「VRT は
// 通った」としか見えない。
//
// **ソースを正規表現で読む形は採らない。** edu-law が 1 度書いて捨てた — 数えているのが
// 文字列でしかないので、5 経路が素通りした(ループを `pages.slice(0, 2)` に絞る /
// config に `grepInvert` を足す / コメント行にダミーの `path:` を書いて件数を保つ /
// projects を削除ではなくコメントアウトする / `test.skip(` でなく `test["skip"](` と
// 書く)。逆に、引用符をシングルに変えただけで赤にもなった。そこでここでは
// **Playwright 自身に「何を撮るか」を列挙させて突き合わせる**(`--list` は 1 秒未満で、
// ブラウザも webServer も起動しない)。
//
// **列挙で見えないものは、値そのものを固定する。** `fullPage` を落とす / 比較設定を
// 緩める / 断面(viewport・`colorScheme`)を潰す / `use` でテーマを立てる JS を止める /
// 比較そのものを消す(`ignoreSnapshots`・`updateSnapshots`・`webServer` を main の dist に
// 固定する)/ ワークフローの撮影コマンドに CLI フラグを足す・ステップを skip する —
// いずれも撮影件数を減らさないので `--list` からは見えない。
//
// **残る穴は spec の書き方そのもの。** 第 2 引数での上書き / 実行時 skip / import 元の
// 差し替え / `emulateMedia` でのテーマ上書き、のいずれも撮影件数を変えずに値だけを
// ずらせる(実測)。ワークフロー側は、2026-09-14 時点で、`run:` が複数行のステップの
// 本文を「行頭のコマンド名の列挙」と「行の形」でしか見ておらず、Build baseline の
// 本文では絶対パスや変数展開で始まる行での dist / src の差し替えを捕まえていなかった。
// **列挙が尽きている保証は無い**ので、`vrt/pages.spec.ts` 冒頭に注意書きを置いてある。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { targets, shotOptions } from "../../vrt/targets.mjs";

// config は **VRT ジョブと同じ環境でも**読み直す(理由は下の環境比較テスト)。
// クエリを変えると ESM のモジュールキャッシュを跨げる。
const CONFIG_URL = new URL("../../playwright.vrt.config.ts", import.meta.url)
  .href;
let configReads = 0;
async function readConfig(env = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return (await import(`${CONFIG_URL}?read=${configReads++}`)).default;
  } finally {
    for (const key of Object.keys(env)) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
}

const vrtConfig = await readConfig();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PKG = JSON.parse(read("package.json"));
const WORKFLOW = read(".github/workflows/vrt.yml");

/** Playwright に撮影対象を列挙させる。--list なので実行も webServer の起動もしない */
function listPlannedShots() {
  const raw = execFileSync(
    "npx",
    [
      "playwright",
      "test",
      "--config",
      "playwright.vrt.config.ts",
      "--list",
      "--reporter=json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  const report = JSON.parse(raw);
  return report.suites.flatMap((suite) =>
    suite.specs.flatMap((spec) =>
      spec.tests.map((t) => ({
        name: spec.title,
        project: t.projectName,
        expected: t.expectedStatus,
      }))
    )
  );
}

const planned = listPlannedShots();

/**
 * Astro がページとして出力するファイル。`_` 接頭のものはルートにならず、
 * `.ts` / `.js` はエンドポイント(HTML ではない)なので、どちらも撮影対象外。
 */
function listPageTemplates(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith("_")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listPageTemplates(full);
    return /\.(astro|md|mdx|html)$/.test(entry.name)
      ? [path.relative(ROOT, full)]
      : [];
  });
}

const templates = listPageTemplates(path.join(ROOT, "src/pages"));

test("撮影対象が 12 件ある", () => {
  // 下限(>=)ではなく固定。増やしたときにも赤にすることで、`CLAUDE.md` に書いた
  // 撮影件数を一緒に直す機会を作る。
  assert.equal(targets.length, 12);
});

test("撮影対象の path が重複していない", () => {
  // 件数だけを見ていると、全部を同じ path にしても通る(edu-law の実測: 18 枚が
  // 同一画像になってなお緑)。撮っているページの種類は path の一意性でしか見えない。
  const paths = targets.map((t) => t.path);
  const dups = paths.filter((p, i) => paths.indexOf(p) !== i);
  assert.deepEqual(dups, []);
});

test("テンプレートと撮影対象が 1 対 1 で対応している", () => {
  // `/changelog` だけは意図的に撮らない(理由は `vrt/targets.mjs` 冒頭)。それ以外は
  // テンプレートを足したら撮影対象も足す。この対応が崩れると、新しいページを誰も
  // 撮らないまま本番に出る。
  const excluded = ["src/pages/changelog.astro"];
  for (const e of excluded) {
    assert.ok(templates.includes(e), `除外対象 ${e} が存在しない`);
  }
  assert.equal(
    templates.length - excluded.length,
    targets.length,
    `テンプレート ${templates.length} 本(除外 ${excluded.length})に対して撮影対象が ${targets.length} 件`
  );
});

test("Playwright が撮る予定のものが撮影対象と一致する", () => {
  // ここだけが「実際に何が撮られるか」を見ている。上の 3 本はデータの形しか
  // 見ていないので、ループの絞り込み・grep・projects の削減は素通りする。
  const byProject = new Map();
  for (const shot of planned) {
    if (!byProject.has(shot.project)) byProject.set(shot.project, []);
    byProject.get(shot.project).push(shot.name);
  }
  assert.deepEqual([...byProject.keys()].sort(), [
    "desktop",
    "desktop-dark",
    "mobile",
    "mobile-dark",
  ]);
  const expected = targets.map((t) => t.name).sort();
  for (const [project, names] of byProject) {
    assert.deepEqual(
      names.sort(),
      expected,
      `${project} の撮影対象がずれている`
    );
  }
});

test("撮影が skip / fixme に落ちていない", () => {
  // Playwright は skip を **exit 0** で返す。`test(` を `test.skip(` に変えるだけで
  // 全件が skipped になり、CI からは通ったようにしか見えない。node 側は
  // `scripts/assert-test-results.mjs` が skip / todo を 0 に強制しているが、
  // Playwright の口には同等の検査が無い。
  //
  // **見えるのは宣言時の skip だけ。** `test["skip"](` のような別記法も
  // expectedStatus に出るが、**本体の中で `test.skip(条件, …)` と書く実行時 skip は
  // `--list` に出ない**(edu-law の実測: `test.skip(!!process.env.CI, …)` を足すと
  // expectedStatus は `passed` のままで、CI では全件が skipped になる)。
  const notPassed = planned.filter((s) => s.expected !== "passed");
  assert.deepEqual(notPassed, []);
});

test("VRT が config と spec の変更で起動する", () => {
  // ガードが在っても、対象の変更で VRT が起動しなければ撮り比べは行われない。
  // 列挙の正典は `vrt.yml` なので件数は数えないが、**否定パターンで打ち消されて
  // いないこと**は見る(`- "!vrt/**"` を後ろに足すだけで起動しなくなる)。
  for (const pattern of ["vrt/**", "playwright.vrt.config.ts"]) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      WORKFLOW,
      new RegExp(`^\\s+- "${escaped}"$`, "m"),
      `${pattern} が paths に無い`
    );
    assert.doesNotMatch(
      WORKFLOW,
      new RegExp(`^\\s+- "!${escaped}"$`, "m"),
      `${pattern} が打ち消されている`
    );
  }
  // **起動条件そのものも見る。** `paths` の末尾に `- "!**"` を足す(最後に一致した
  // パターンが勝つので全部が打ち消される)/ `branches` を別の名前にする / `paths-ignore`
  // や `types` を足す、のどれでも VRT は一度も起動しなくなるが、上の 2 パターンの
  // 検査は緑のままだった(2026-09-14 時点で実測)。列挙の正典は `vrt.yml` なので
  // 肯定の path は写さず、否定の path と `branches` とキー集合だけを固定する。
  const on = WORKFLOW.split(/^on:\n/m)[1]?.split(/^\w/m)[0];
  assert.ok(on, "on: が無い");
  assert.deepEqual(keysAt(on, 2).sort(), ["pull_request", "workflow_dispatch"]);
  const pullRequest = on
    .split(/^ {2}pull_request:\n/m)[1]
    ?.split(/^ {2}\w/m)[0];
  assert.ok(pullRequest, "on.pull_request が無い");
  assert.deepEqual(keysAt(pullRequest, 4).sort(), ["branches", "paths"]);
  assert.match(
    pullRequest,
    /^ {4}branches: \[main\]$/m,
    "pull_request.branches が [main] ではない"
  );
  assert.deepEqual(
    [...pullRequest.matchAll(/^ {6}- "(![^"]*)"$/gm)].map((m) => m[1]),
    ["!src/pages/changelog.astro"]
  );
});

/** 指定インデントに在るマッピングのキー。クォートとコロン前の空白は `stepKeys` と同じ扱い */
function keysAt(text, indent) {
  return [
    ...text.matchAll(new RegExp(`^ {${indent}}(["']?)([\\w-]+)\\1\\s*:`, "gm")),
  ].map((m) => m[2]);
}

/** ステップの `name:`(位置は問わない・クォートは剥がす)。無ければ null */
function stepName(step) {
  const m = step.match(/^(?: {6}- | {8})name\s*:[ \t]*(.*)$/m);
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : null;
}

/** YAML のコメント行を落とす(`run: |` の中の shell コメントも同じ形なので一緒に落ちる) */
function stripComments(text) {
  return text.replace(/^\s*#.*$/gm, "");
}

/**
 * ステップ(`      - ` 始まりの塊)が持つキー。順序は見ない(マッピングのキー順に
 * 意味は無い)。`"if":` のようにクォートしたキーも `if :` のようにコロンの前に空白を
 * 置いたキーも YAML では同じキーなので、同じ名前で返す。
 */
function stepKeys(step) {
  return [...step.matchAll(/^(?: {6}- | {8})(["']?)([\w-]+)\1\s*:/gm)].map(
    (m) => m[2]
  );
}

/** ステップ内の `key:` の下にぶら下がる行(インデント 10)を trim して返す */
function blockLines(step, key) {
  const m = step.match(
    new RegExp(`^(?: {6}- | {8})${key}:[^\\n]*\\n((?: {10}.*\\n?)*)`, "m")
  );
  return m
    ? m[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
}

/**
 * ステップの `run:` を空白区切りのトークンにして返す。`run: cmd` / `run: "cmd"` /
 * `run: 'cmd'` / `run: |`(次行以降)を同じに扱う。ブロックスカラーで非空行が
 * 2 行以上あれば `null`(1 行目が正しくても 2 行目で結果を握り潰せるため)。
 */
function runTokens(step) {
  const m = step.match(/^(?: {6}- | {8})run:[ \t]*(.*)$/m);
  if (!m) return null;
  let value = m[1].trim();
  if (/^[|>][+-]?$/.test(value)) {
    const lines = blockLines(step, "run");
    if (lines.length !== 1) return null;
    value = lines[0];
  }
  value = value.replace(/^(["'])(.*)\1$/, "$2");
  return value.split(/\s+/).filter(Boolean);
}

test("VRT が main と PR の 2 ビルドを撮り比べている", () => {
  // 比較ステップを消すとベースライン撮影だけが残り、**恒久的に緑**になる。
  //
  // **ステップ名だけでは足りない。** 名前を残したまま比較側に `--update-snapshots` を
  // 足す / `VRT_DIST` を `dist-main` に向ける、のどちらでも恒久的に緑になり、
  // 名前を見るだけの検査は素通りする(edu-law の実測)。
  //
  // **1 本の正規表現で `env:` と `run:` を続けて拾う形も採らない。** YAML として等価な
  // 書き方(`run:` をクォートする / `run: |` のブロックスカラー / `env:` と `run:` の
  // 順序入れ替え)で赤になる。マッピングのキー順に意味は無いので、
  // **ステップの塊に切ってから、その中に何が在るかを見る**。
  // **撮影 2 ステップの外側も見る。** job / workflow レベルの `env:`(`NODE_OPTIONS` で
  // 両撮影に細工する)、`defaults:`(`shell` を差し替えて `-e` を外す)、前段のステップ
  // (`rsync -a --delete dist-main/ dist-pr/` を 1 つ挟む・`Checkout PR` に `ref:` を足して
  // PR 側を main にする)は、撮影 2 ステップを丸ごと固定しても素通りした(2026-09-14
  // 時点で実測)。マッピングのキー集合・ステップの並び・各ステップのキー集合・
  // `uses:` の action を固定し、`run:` が 1 行のステップは完全一致にする。複数行の
  // `run:`(Build baseline / Report baseline mode)の本文は、2026-09-14 時点では
  // `vrt-baseline.test.mjs` が行の列挙と形で見ていた。
  assert.deepEqual(keysAt(WORKFLOW, 0).sort(), [
    "concurrency",
    "jobs",
    "name",
    "on",
    "permissions",
  ]);
  const jobs = WORKFLOW.split(/^jobs:\n/m)[1];
  assert.ok(jobs, "jobs: が無い");
  assert.deepEqual(keysAt(jobs, 2), ["vrt"]);
  assert.deepEqual(keysAt(jobs, 4).sort(), [
    "name",
    "runs-on",
    "steps",
    "timeout-minutes",
  ]);

  // **`steps:` の下の塊は全部 `- name:` で始まっていなければならない。** name の無い
  // ステップ(`- run: …`)や `-   name:` / `- { name: … }` のような綴りは、name で
  // 引く下の検査から丸ごと消える。paths の `- "…"` を除くために null を捨てる形に
  // すると、そういうステップも一緒に捨てて緑のままになる(2026-09-14 時点で実測)。
  const stepsBlock = jobs.split(/^ {4}steps:\n/m)[1];
  assert.ok(stepsBlock, "steps: が無い");
  // 最初のステップより前に置かれたコメントは、どのステップにも付かない塊になるので
  // 先に落とす(ステップ間のコメントは次のステップの塊に入る)。
  const steps = stripComments(stepsBlock)
    .split(/^(?= {6}- )/m)
    .filter((s) => s.trim());
  assert.deepEqual(
    steps.filter((s) => stepName(s) === null),
    [],
    "name の無いステップがある"
  );
  assert.deepEqual(steps.map(stepName), [
    "Checkout PR",
    "Setup Node.js",
    "Install dependencies",
    "Install Playwright browser",
    "Build PR branch",
    "Stash PR build",
    "Build baseline (main code x PR content)",
    "Report baseline mode",
    "Capture baseline from main",
    "Compare PR against baseline",
    "Upload VRT report",
  ]);
  const byName = new Map(steps.map((s) => [stepName(s), s]));
  // 各ステップのキー集合。`shell:` / `working-directory:` / `env:` を足すだけで
  // 本文を変えずに挙動を変えられるので、撮影 2 ステップ以外も固定する。
  assert.deepEqual(
    steps.map((s) => [stepName(s), stepKeys(s).sort()]),
    [
      ["Checkout PR", ["name", "uses", "with"]],
      ["Setup Node.js", ["name", "uses", "with"]],
      ["Install dependencies", ["name", "run"]],
      ["Install Playwright browser", ["name", "run"]],
      ["Build PR branch", ["name", "run"]],
      ["Stash PR build", ["name", "run"]],
      ["Build baseline (main code x PR content)", ["env", "id", "name", "run"]],
      ["Report baseline mode", ["env", "name", "run"]],
      ["Capture baseline from main", ["env", "name", "run"]],
      ["Compare PR against baseline", ["env", "name", "run"]],
      ["Upload VRT report", ["if", "name", "uses", "with"]],
    ]
  );
  // `uses:` は action の名前まで固定する(sha は Dependabot が bump するので見ない)。
  for (const [name, action] of [
    ["Checkout PR", "actions/checkout@"],
    ["Setup Node.js", "actions/setup-node@"],
    ["Upload VRT report", "actions/upload-artifact@"],
  ]) {
    const uses = byName.get(name).match(/^ {8}uses\s*:[ \t]*(\S+)/m)?.[1] ?? "";
    assert.ok(
      uses.startsWith(action),
      `${name} の uses が ${action} で始まっていない`
    );
  }
  // 1 行の `run:` は完全一致。`Install dependencies` を `npm ci && git checkout
  // origin/main -- src/…` にすると PR 側のビルドが main のコードになる。
  for (const [name, tokens] of [
    ["Install dependencies", ["npm", "ci"]],
    [
      "Install Playwright browser",
      ["npx", "playwright", "install", "chromium", "--with-deps"],
    ],
    ["Build PR branch", ["npm", "run", "build"]],
    ["Stash PR build", ["mv", "dist", "dist-pr"]],
  ]) {
    assert.deepEqual(runTokens(byName.get(name)), tokens, name);
  }
  // `Checkout PR` は `with: ref: …` で PR 以外を取り出せるので、`with` の中身まで固定する。
  assert.deepEqual(blockLines(byName.get("Checkout PR"), "with"), [
    "fetch-depth: 0",
  ]);
  // dist-pr / dist-main に触るステップの集合(コメントは除く)。前段に dist を差し替える
  // ステップを足すと、名前の並びとここの両方で赤になる。glob や変数で綴りを隠した
  // 差し替えはここでは捕まらない(名前の並びだけが捕まえる)。
  const mentioning = (needle) =>
    steps.filter((s) => stripComments(s).includes(needle)).map(stepName);
  assert.deepEqual(mentioning("dist-pr"), [
    "Stash PR build",
    "Compare PR against baseline",
  ]);
  assert.deepEqual(mentioning("dist-main"), [
    "Build baseline (main code x PR content)",
    "Capture baseline from main",
  ]);

  // **撮るステップは 2 つだけ、と数で固定する。** 比較の前に「`VRT_DIST: "dist-pr"` で
  // `--update-snapshots`」の 3 つ目を挟むと、最初に見つかった 1 つだけを検査する形では
  // 元の比較ステップだけが通り、実行順は撮り直し → 同じ dist と比較で恒久的に緑になる
  // (実測)。`playwright test` を呼ぶステップも `VRT_DIST` を持つステップも、下で
  // 検査する 2 つと同じ集合でなければならない。
  const stepsFor = (needle) => steps.filter((step) => step.includes(needle));
  const [baseline, ...moreBaseline] = stepsFor("VRT_DIST: dist-main");
  const [compare, ...moreCompare] = stepsFor("VRT_DIST: dist-pr");
  assert.ok(baseline, "main の dist を撮るステップが無い");
  assert.ok(compare, "PR の dist を撮るステップが無い");
  assert.deepEqual(
    [...moreBaseline, ...moreCompare],
    [],
    "撮るステップが 3 つ以上ある"
  );
  assert.deepEqual(stepsFor("VRT_DIST"), [baseline, compare]);
  assert.deepEqual(stepsFor("playwright test"), [baseline, compare]);

  // **撮影コマンドは完全一致で固定する。** 部分一致だと、後ろに `--project desktop
  // --project mobile` を足して dark だけ落とす / `--ignore-snapshots` で比較を消す /
  // `-u`(`--update-snapshots` の短縮形)を足す、のいずれも緑のまま通る(実測)。
  // 撮り直しの指定はベースライン側にだけ在る — 比較側に付くと毎回上書きになり、
  // 差分が出ることが無くなる。
  //
  // **ステップに在るキーも固定する。** `if:` で比較を skip する / `shell: bash {0}` +
  // 2 行目の `true` で失敗を握り潰す / `env:` に `NODE_OPTIONS` を足す、はどれも
  // コマンド行を変えずに比較を無効にできる(実測)。`run:` は `run: cmd` / クォート /
  // `run: |` の等価な書き方を同じに扱い、ブロックスカラーは非空行がちょうど 1 行で
  // あることを要求する。
  const PLAYWRIGHT = [
    "npx",
    "playwright",
    "test",
    "--config",
    "playwright.vrt.config.ts",
  ];
  for (const [label, step, dist, args] of [
    ["ベースライン撮影", baseline, "dist-main", ["--update-snapshots"]],
    ["比較", compare, "dist-pr", []],
  ]) {
    assert.deepEqual(
      stepKeys(step).sort(),
      ["env", "name", "run"],
      `${label}のキー`
    );
    assert.deepEqual(
      blockLines(step, "env"),
      [`VRT_DIST: ${dist}`],
      `${label}の env`
    );
    assert.deepEqual(
      runTokens(step),
      [...PLAYWRIGHT, ...args],
      `${label}のコマンド`
    );
  }

  // 撮ってから比べる。逆順だとベースラインが無い状態で比較が走る。
  assert.ok(
    WORKFLOW.indexOf(baseline) < WORKFLOW.indexOf(compare),
    "比較がベースライン撮影より先に置かれている"
  );

  // `continue-on-error` が付くと job は緑のまま比較だけが無効になる。
  assert.doesNotMatch(
    WORKFLOW,
    /continue-on-error/,
    "vrt.yml に continue-on-error が付いている"
  );
});

test("比較設定が完全一致のまま固定されている", () => {
  // edu-law #160 の形に静かに戻す変異を塞ぐ。`threshold` の既定は 0.2 で、それ未満の
  // 色差は差分として**数えられない**。`maxDiffPixels` の既定は 0 だが型定義は
  // "unset by default" としか書いておらず契約ではないので、明示されていることまで見る。
  //
  // **ソースを読まずに config を import して評価済みの値を見る。** 正規表現では、
  // キーを消したのかコメントアウトしたのか、別の場所で上書きしたのかを区別できない。
  // `--list --reporter=json` には `expect` が入らないので、Playwright 経由では取れない。
  assert.deepEqual(vrtConfig.expect.toHaveScreenshot, {
    threshold: 0,
    maxDiffPixels: 0,
    animations: "disabled",
    caret: "hide",
  });
  // 比率(`maxDiffPixelRatio`)が戻ってきた場合も、余分なキーとしてここで赤になる。
  // 使わないのは、許容量が総ピクセル数に比例して長いページほど甘くなるため
  // (ADR 0068)。

  // **比較そのものを消す 2 つのキーも見る。** どちらも 1 行で VRT を完全な no-op に
  // する(edu-law の実測: `ignoreSnapshots: true` / `updateSnapshots: 'all'` の
  // どちらでも、本文に letter-spacing を注入した dist が passed になる)。
  assert.ok(!vrtConfig.ignoreSnapshots, "ignoreSnapshots が有効になっている");
  assert.equal(
    vrtConfig.updateSnapshots,
    undefined,
    "updateSnapshots が設定されている"
  );

  // **project 単位の `expect` は上位を上書きする。** 同じファイルの中で
  // `projects[].expect.toHaveScreenshot` を書けば、上の deepEqual を通したまま
  // 実効値だけを緩められる。
  for (const project of vrtConfig.projects) {
    assert.equal(
      project.expect,
      undefined,
      `${project.name} が expect を上書きしている`
    );
  }
});

test("比較設定が VRT ジョブの環境でも同じ値になる", async () => {
  // **import した時点の値を見るだけでは足りない。** config が実行環境で分岐すると、
  // このガードが走る「Type and text checks」(`VRT_DIST` 未設定)では厳格な値が見え、
  // 実際に撮る VRT ジョブ(`VRT_DIST: dist-main` / `dist-pr`)では緩い値が使われる。
  // `VRT_DIST` はこの config が元から読んでいる変数なので、「CI では少し緩める」形の
  // 分岐が自然な修正として紛れ込みうる(edu-law の実測: 三項演算子 1 つで
  // `threshold` が 0 → 0.9 に化けたまま `test:workflows` は緑だった)。
  //
  // **並行に読まない。** `readConfig` は `process.env` を書き換えてから `import()` する
  // ので、`Promise.all` で 2 本同時に走らせると後から設定した環境を両方が見る。
  const variants = [];
  for (const env of [{ VRT_DIST: "dist-main" }, { VRT_DIST: "dist-pr" }]) {
    variants.push(await readConfig(env));
  }
  //
  // **フィールドを選んで比べない。** `expect` と `use` だけを比べる形だと、`shard` /
  // `grepInvert` / `webServer.cwd` に `VRT_DIST ? … : undefined` を書くだけで、既定環境
  // では同じに見えて VRT ジョブでだけ撮影が減る・404 ページを撮る(実測)。`VRT_DIST` で
  // 変わってよいのは `webServer.command` に埋まる dist 名だけなので、それを除いた
  // config 全体を `deepEqual` する。
  const withoutDist = (c) => ({
    ...c,
    webServer: { ...c.webServer, command: undefined },
  });
  for (const config of variants) {
    assert.deepEqual(withoutDist(config), withoutDist(vrtConfig));
  }
  // **配信する dist が `VRT_DIST` に追従していること。** `webServer.command` が
  // `dist-main` を固定で配信すると、2 ステップとも同じビルドを撮って恒久的に緑になる
  // (実測)。config は `VRT_DIST ?? "dist"` を埋めているので、その値が出ていることを見る。
  for (const [dist, config] of [
    ["dist-main", variants[0]],
    ["dist-pr", variants[1]],
  ]) {
    assert.equal(config.webServer.command, `npx serve ${dist} -l 4174`);
  }
});

test("撮影の断面とリトライが固定されている", () => {
  // **断面が減っても件数は減らない。** mobile の viewport を desktop と同じにする /
  // `colorScheme` を 4 つとも light にすると、48 件は撮り続けたまま同じ画像を 2 度撮る
  // ことになり、モバイルやダークの崩れは一切写らなくなる(`targets` の path 重複を
  // 禁じているのと同じ形)。viewport も `colorScheme` も `--list --reporter=json` の
  // `config.projects[]` に入らないので、config を import して見る。
  // **並び順は見ない。** projects の順序は撮るものを変えないので、入れ替えただけで
  // 赤くするのは偽陽性になる。
  //
  // **`use` はキーを追いかけず丸ごと固定する。** viewport と `colorScheme` を保った
  // まま `-dark` の 2 断面を light にする書き方が `use` の中に何通りもある —
  // `storageState` で `localStorage.theme` を注入する(`Layout.astro` は localStorage を
  // `prefers-color-scheme` より先に見る)/ `contextOptions.storageState` に綴りを変える
  // (`use.storageState` が未設定なら Playwright はそこを既定値にする)/
  // `javaScriptEnabled: false` や `launchOptions.args` の `--blink-settings=scriptEnabled=false`
  // で `data-theme` を立てるスクリプトごと止める(ダークは `[data-theme="dark"]` でしか
  // 定義していない)。いずれも実測で light を描いた。1 つずつ `undefined` を見る形は
  // 綴りが増えるたびに負けるので、`expect.toHaveScreenshot` と同じく余分なキーが
  // あれば赤になる形にする。
  assert.deepEqual(vrtConfig.use, { baseURL: "http://localhost:4174" });
  // project も `name` と `use` を選ばず丸ごと。`-dark` の 2 つにだけ `testMatch` で
  // 別の spec(`emulateMedia` で light に上書きしたもの)を向けると、テスト名が同じなので
  // `--list` の突き合わせも通る(実測)。
  assert.deepEqual(
    [...vrtConfig.projects].sort((a, b) => a.name.localeCompare(b.name)),
    [
      {
        name: "desktop",
        use: { viewport: { width: 1280, height: 800 }, colorScheme: "light" },
      },
      {
        name: "desktop-dark",
        use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
      },
      {
        name: "mobile",
        use: { viewport: { width: 390, height: 844 }, colorScheme: "light" },
      },
      {
        name: "mobile-dark",
        use: { viewport: { width: 390, height: 844 }, colorScheme: "dark" },
      },
    ]
  );
  // リトライは入れない(理由は config のコメント)。増やすと、安定化ループでも
  // 収まらなかった問題まで握り潰す。
  assert.equal(vrtConfig.retries, 0);
  // **`webServer` も丸ごと。** `command` だけ固定しても `cwd: "/tmp"` を足せば serve が
  // 404 ページを返し、2 ステップとも同じ白いページを撮って恒久的に緑になる(実測)。
  assert.deepEqual(vrtConfig.webServer, {
    command: "npx serve dist -l 4174",
    port: 4174,
    reuseExistingServer: !process.env.CI,
  });
  // **config のキー集合と reporter も固定する。** `globalSetup` やカスタム reporter から
  // dist の起動スクリプトを書き換えれば `-dark` は light を描く(実測)。ガードの `--list`
  // は `globalSetup` を実行せず、reporter は `--reporter=json` の指定が config の値を
  // 上書きするので、どちらもガードの中では動かない。
  assert.deepEqual(Object.keys(vrtConfig).sort(), [
    "expect",
    "forbidOnly",
    "fullyParallel",
    "projects",
    "reporter",
    "retries",
    "snapshotPathTemplate",
    "testDir",
    "use",
    "webServer",
    "workers",
  ]);
  assert.equal(vrtConfig.reporter, "html");
});

test("全ページをフルページで撮っている", () => {
  // `fullPage` を落とすとビューポート内(1280x800 / 390x844)しか撮らなくなるが、
  // 48 件は走り続けて全部緑のまま通る。config の `expect.toHaveScreenshot` には
  // 置けない値なので、`vrt/targets.mjs` にデータとして持たせてここで固定する。
  assert.deepEqual(shotOptions, { fullPage: true });
});

test("npm run vrt が VRT の config を指している", () => {
  assert.equal(
    PKG.scripts.vrt,
    "npx playwright test --config playwright.vrt.config.ts"
  );
});
