// VRT のベースラインを「main のコード x PR のコンテンツ」で撮る配線を固定する（ADR 0068）。
//
// この配線が壊れても CI は緑のままになる。運ぶ素材を 1 つ落とせば、その素材由来の
// 差分がベースラインに残らないだけで、テストは走り、多くのページは通る。
// 落ちるのは「そのページを見た人が意味を誤解する」ときだけで、機械には見えない。
//
// **一番腐りやすいのは allowlist。** `src/content` / `src/data` / `src/content.config.ts`
// は手書きの列挙なので、将来 `src/copy/` のような置き場が増えても何も落ちない。
// そこで src/ の実際のディレクトリを走査し、**運ぶか・監視するか・描画に入らないと
// 明言するか**の三択を強制する。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const WORKFLOW = fs.readFileSync(
  path.join(REPO, ".github/workflows/vrt.yml"),
  "utf8"
);

/** `- name:` から次の `- name:` までを 1 ステップとして切り出す。 */
function step(name) {
  const all = WORKFLOW.split(/^ {6}(?=- name: )/m);
  const found = all.find((s) => s.startsWith(`- name: ${name}`));
  assert.ok(found, `ステップ「${name}」が無い`);
  return found;
}

/** ステップの `run: |` 本体だけ。env の式まで混ざると走査が誤爆する。 */
function runBody(name) {
  const body = step(name).split(/^ {8}run: \|$/m)[1];
  assert.ok(body, `ステップ「${name}」に run ブロックが無い`);
  return body;
}

/** on.pull_request.paths の肯定パターン。 */
function paths() {
  const block = WORKFLOW.split("\n  workflow_dispatch:")[0];
  return [...block.matchAll(/^ {6}- "([^"!][^"]*)"$/gm)].map((m) => m[1]);
}

// 運ぶ素材。ここを変えたら下の三択テストも一緒に見直すことになる。
const CARRIED = ["src/content", "src/data"];
// 描画に入らないと明言したもの。増やすときは理由を書くこと。
const NOT_RENDERED = [];

test("ベースラインが PR の素材を --delete 付きで運んでいる", () => {
  const b = step("Build baseline (main code x PR content)");
  for (const dir of CARRIED) {
    assert.match(
      b,
      new RegExp(
        `^ +rsync -a --delete ${dir}/ /tmp/edu-watch-main/${dir}/$`,
        "m"
      ),
      `${dir} を運んでいない、または --delete が落ちている`
    );
  }
  // スキーマを同伴させないと、PR のフロントマターを main の zod が弾く。
  assert.match(
    b,
    /^ +cp src\/content\.config\.ts \/tmp\/edu-watch-main\/src\/content\.config\.ts$/m
  );
});

test("素材を運ぶのがベースラインのビルドより前である", () => {
  // **ベタ検索だけでは、rsync をビルドの後ろへ移す変異が素通りする**(実測: 10/10 緑)。
  // その形はベースラインが main 自身のコンテンツで焼かれるのに mode=neutral と
  // 報告されるので、この PR の効果が丸ごと静かに失効する。位置で固定する。
  const b = runBody("Build baseline (main code x PR content)");
  const neutralPath = b.split('if [ "$VRT_NEUTRAL" = "false" ]')[1] ?? "";
  const afterRawBranch = neutralPath.split("\n          fi\n")[1] ?? "";
  assert.ok(afterRawBranch, "raw 分岐の後ろが読めない");
  const build = afterRawBranch.indexOf(
    "npm --prefix /tmp/edu-watch-main run build"
  );
  assert.ok(build > 0, "中立化経路にビルドが無い");
  for (const carry of [
    "rsync -a --delete src/content/",
    "rsync -a --delete src/data/",
    "cp src/content.config.ts",
  ]) {
    const at = afterRawBranch.indexOf(carry);
    assert.ok(at >= 0, `${carry} が中立化経路に無い`);
    assert.ok(at < build, `${carry} がビルドより後ろにある`);
  }
});

test("相を報告するステップと、その出力元が存在する", () => {
  // `相の報告が比較より前にある` は indexOf の比較なので、ステップごと消すと
  // -1 < N で必ず真になる。存在を先に主張する。
  step("Report baseline mode");
  const b = step("Build baseline (main code x PR content)");
  // id が無いと steps.baseline.outputs.mode が常に空になり、summary は raw、
  // artifact 名は nobaseline に落ちる。どちらも赤くならない。
  assert.match(b, /^ {8}id: baseline$/m, "id: baseline が無い");
});

test("失敗の握りつぶしが || 以外の形でも入っていない", () => {
  // `degraded への分岐が…` が固定しているのは ` || ` という字面だけ。
  // set +e で囲めば同じことができる(実測: 10/10 緑で通った)。
  const b = runBody("Build baseline (main code x PR content)");
  assert.doesNotMatch(b, /set \+e/, "set +e で errexit を外している");
  assert.doesNotMatch(b, /^\s*if ! npm/m, "if ! で失敗を握りつぶしている");
});

test("src/ の各ディレクトリが 運ぶ / 監視する / 描画外 のどれかに割り当てられている", () => {
  const dirs = fs
    .readdirSync(path.join(REPO, "src"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `src/${e.name}`);
  const watched = paths();
  const unassigned = dirs.filter(
    (d) =>
      !CARRIED.includes(d) &&
      !NOT_RENDERED.includes(d) &&
      !watched.some((p) => p === d || p.startsWith(`${d}/`))
  );
  assert.deepEqual(
    unassigned,
    [],
    "運びも監視もしていないディレクトリがある。ベースラインへ運ぶか、paths に足すか、NOT_RENDERED に理由つきで入れること"
  );
});

test("運ぶディレクトリは paths に載っていない", () => {
  // 載っていると「起動はするが構造上ぜったいに差分が出ない」トリガになり、
  // 5 分前後の CI を空回りさせる。対象 0 件で緑になる経路そのもの。
  const watched = paths();
  for (const dir of CARRIED) {
    assert.ok(
      !watched.some((p) => p === dir || p.startsWith(`${dir}/`)),
      `${dir} を運びながら paths でも起動している`
    );
  }
});

test("degraded への分岐がビルドコマンドだけに掛かっている", () => {
  const b = runBody("Build baseline (main code x PR content)");
  // 広く掛けると npm ci の失敗・ネットワーク断・pagefind の異常終了まで
  // 「degraded で続行」に落ちて、インフラ障害が緑で通る。
  const tolerated = [...b.matchAll(/^ +(.*?) \|\| .*$/gm)].map((m) =>
    m[1].trim()
  );
  assert.deepEqual(tolerated, ["npm --prefix /tmp/edu-watch-main run build"]);
});

test("degraded 側の撮り直しは失敗を握りつぶさない", () => {
  const b = step("Build baseline (main code x PR content)");
  const fallback = b.split('if [ "$build_rc" -ne 0 ]')[1] ?? "";
  assert.ok(fallback, "degraded 分岐が無い");
  assert.doesNotMatch(
    fallback,
    /run build \|\|/,
    "撮り直しの失敗が握りつぶされている"
  );
  assert.match(
    fallback,
    /npm --prefix \/tmp\/edu-watch-main run build/,
    "撮り直しが無い"
  );
  // 握りつぶさないことは set -e に依存している。
  assert.match(b, /^ +set -euo pipefail$/m, "set -euo pipefail が落ちている");
});

test("degraded の復元が Astro のキャッシュまで消している", () => {
  const b = step("Build baseline (main code x PR content)");
  const fallback = b.split('if [ "$build_rc" -ne 0 ]')[1] ?? "";
  // git clean は -x が無いと gitignore 済みを消さない。残ると PR のコンテンツで
  // 描かれたページがベースラインに混入する = 静かな緑。
  for (const cache of [
    "/tmp/edu-watch-main/.astro",
    "/tmp/edu-watch-main/node_modules/.astro",
  ]) {
    assert.ok(fallback.includes(cache), `${cache} を消していない`);
  }
  assert.match(fallback, /git -C \/tmp\/edu-watch-main checkout -- \./);
  assert.match(fallback, /git -C \/tmp\/edu-watch-main clean -fd/);
});

test("neutral の既定が式の型変換で反転しない", () => {
  // GitHub の式は型が違うと数値に寄せるので、`inputs.neutral == false` は
  // pull_request（null）でも真になり、既定が raw に反転する。
  assert.match(
    WORKFLOW,
    /VRT_NEUTRAL: \$\{\{ github\.event\.inputs\.neutral \|\| 'true' \}\}/
  );
  // 式の中だけを見る。コメントで「こう書くな」と書いてある行に当たらないように。
  const expressions = [...WORKFLOW.matchAll(/\$\{\{([^}]*)\}\}/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(
    expressions.filter((e) => /inputs\.neutral\s*==/.test(e)),
    [],
    "型変換で反転する書き方になっている"
  );
});

test("main と PR を撮り比べる形が保たれている", () => {
  const capture = step("Capture baseline from main");
  const compare = step("Compare PR against baseline");
  assert.match(capture, /VRT_DIST: dist-main/);
  assert.match(
    capture,
    /--update-snapshots/,
    "ベースライン撮影が撮り直しになっていない"
  );
  assert.match(compare, /VRT_DIST: dist-pr/);
  assert.doesNotMatch(
    compare,
    /--update-snapshots/,
    "比較が撮り直しになっている"
  );
  assert.doesNotMatch(
    WORKFLOW,
    /continue-on-error/,
    "vrt.yml に continue-on-error が付いている"
  );
});

test("artifact 名にベースラインの相が出る", () => {
  // 赤い run で人が実際にクリックするのは artifact であって summary ではない。
  // 三項で「neutral だけ素の名前」にはできない。GitHub の式は空文字が falsy
  // なので `X == 'neutral' && '' || format(...)` が常に右辺を返す。
  const upload = step("Upload VRT report");
  assert.match(
    upload,
    /^ {10}name: vrt-report-\$\{\{ steps\.baseline\.outputs\.mode \|\| 'nobaseline' \}\}$/m
  );
});

test("相の報告が比較より前にある", () => {
  // 後ろに置くと if: always() が要るうえ、比較がクラッシュした回に書かれない。
  assert.ok(
    WORKFLOW.indexOf("- name: Report baseline mode") <
      WORKFLOW.indexOf("- name: Compare PR against baseline")
  );
});
