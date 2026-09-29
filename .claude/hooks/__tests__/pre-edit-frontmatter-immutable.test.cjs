"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  run,
  captureProtectedFields,
  PROTECTED_KEYS,
  TARGET_PATH_RE,
} = require("../pre-edit-frontmatter-immutable.cjs");

test("TARGET_PATH_RE: matches digests path", () => {
  assert.match("src/content/digests/2026-05-04.md", TARGET_PATH_RE);
  assert.match(
    "/Users/H/edu-watch/src/content/digests/2026-05-04.md",
    TARGET_PATH_RE
  );
});

test("TARGET_PATH_RE: rejects non-digest paths", () => {
  assert.doesNotMatch("src/content/strategies/x.md", TARGET_PATH_RE);
  assert.doesNotMatch("docs/decisions/0001.md", TARGET_PATH_RE);
});

test("captureProtectedFields: top-level digest fields", () => {
  const fm = [
    "title: 2026 Week 18",
    'weekStart: "2026-04-27"',
    'weekEnd: "2026-05-03"',
    'publishedAt: "2026-05-03T20:00:00+09:00"',
  ].join("\n");
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get("title"), ["2026 Week 18"]);
  assert.deepEqual(m.get("weekStart"), ["2026-04-27"]);
  assert.deepEqual(m.get("weekEnd"), ["2026-05-03"]);
  assert.deepEqual(m.get("publishedAt"), ["2026-05-03T20:00:00+09:00"]);
});

// 記事 id は `src/lib/normalize.ts` の generateArticleId が作る `<sourceId>-<yyyy-mm-dd>-<16-hex>`。
// 以前のテストは実在しないキー `articleId` と実在しない形の id(`a-001`)で書かれていて、digest が
// 使う `articleIds` を 1 件も拾っていないことを見逃していた(#747)。
const ID_A = "nikkyo-2026-09-25-786ac230c4d757f3";
const ID_B = "resemom-2026-09-24-6f8686b60df11108";
const ID_C = "nier-2026-09-24-71bafa490808f11b";

test("captureProtectedFields: articleIds in all three YAML list forms", () => {
  // 1 行の flow リスト(公開済みの号のほぼすべて)・複数行の flow リスト(2026-08-25 号)・ブロックリスト
  const fm = [
    "sections:",
    `  - articleIds: [${ID_A}, ${ID_B}]`,
    "    heading: x",
    "  - articleIds:",
    "      [",
    `        ${ID_C},`,
    "      ]",
    "    heading: y",
    "  - articleIds:",
    `      - ${ID_B}`,
    "    heading: z",
  ].join("\n");
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get("__articleIds__"), [ID_A, ID_B, ID_C, ID_B]);
  // キー名では拾わない(拾うと 1 行の flow リストだけ二重に数える)
  assert.equal(m.has("articleIds"), false);
  assert.equal(m.has("articleId"), false);
});

test("captureProtectedFields: URL set captured from frontmatter", () => {
  const fm = [
    "relatedEvidenceUrls:",
    "  - https://example.com/a",
    "  - https://example.com/b",
  ].join("\n");
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get("__urls__"), [
    "https://example.com/a",
    "https://example.com/b",
  ]);
});

test("Edit: weekStart change fires ask", () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n';
  const newS = '---\nweekStart: "2026-04-20"\n---\n';
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  assert.equal(out.exitCode, 0);
  assert.ok(out.stdout);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /weekStart/);
});

test("Edit: articleIds change fires ask", () => {
  const oldS = `---\nsections:\n  - articleIds: [${ID_A}]\n---\n`;
  const newS = `---\nsections:\n  - articleIds: [${ID_B}]\n---\n`;
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  const parsed = JSON.parse(out.stdout);
  assert.match(
    parsed.hookSpecificOutput.permissionDecisionReason,
    /articleIds/
  );
});

const editChunk = (oldS, newS) =>
  run(
    JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: "src/content/digests/2026-05-04.md",
        old_string: oldS,
        new_string: newS,
      },
    })
  );

test("Edit: a chunk that carries only the id (no key) fires ask", () => {
  // Edit の old_string は id の部分だけのことがある。キー名で探す形では捕まらない
  const out = editChunk(ID_A, ID_B);
  assert.ok(out.stdout, "id だけの書き換えで確認が出なかった");
  assert.match(
    JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason,
    /articleIds/
  );
});

test("Edit: moving an id to another section fires ask (order is compared)", () => {
  // 集合は同じでも、節をまたいで入れ替えると記事カードの帰属が変わる
  const oldS = `  - articleIds: [${ID_A}]\n    heading: x\n  - articleIds: [${ID_B}]\n`;
  const newS = `  - articleIds: [${ID_B}]\n    heading: x\n  - articleIds: [${ID_A}]\n`;
  assert.ok(editChunk(oldS, newS).stdout, "id の入れ替えで確認が出なかった");
});

test("Edit: editing a section heading next to unchanged ids passes", () => {
  const oldS = `  - articleIds: [${ID_A}, ${ID_B}]\n    heading: 古い見出し\n`;
  const newS = `  - articleIds: [${ID_A}, ${ID_B}]\n    heading: 新しい見出し\n`;
  const out = editChunk(oldS, newS);
  assert.equal(out.exitCode, 0);
  assert.ok(!out.stdout);
});

const TAIL = "2026-09-25-786ac230c4d757f3";

test("captureProtectedFields: ハイフンを含む sourceId の id も丸ごと拾う(#773)", () => {
  const fm = [
    `  - articleIds: [mext-press-${TAIL}, a--b-${TAIL}]`,
    "  - articleIds:",
    "      [",
    `        mext-press-${TAIL},`,
    "      ]",
    "  - articleIds:",
    `      - a--b-${TAIL}`,
  ].join("\n");
  assert.deepEqual(captureProtectedFields(fm).get("__articleIds__"), [
    `mext-press-${TAIL}`,
    `a--b-${TAIL}`,
    `mext-press-${TAIL}`,
    `a--b-${TAIL}`,
  ]);
  // 語の区切りで拾う旧来の並びも残す。直後に `-英数字` が続く id は旧来の並びにだけ入り、
  // 直後が `_` の id は新しい並びにだけ入る
  const v2 = captureProtectedFields(`articleIds: [nier-${TAIL}-v2]`);
  assert.equal(v2.has("__articleIds__"), false);
  assert.deepEqual(v2.get("__articleIdsBounded__"), [`nier-${TAIL}`]);
  const us = captureProtectedFields(`articleIds: [nier-${TAIL}_]`);
  assert.deepEqual(us.get("__articleIds__"), [`nier-${TAIL}`]);
  assert.equal(us.has("__articleIdsBounded__"), false);
});

test("Edit: sourceId の先頭の区切りだけ変える・id の直後に _ を足すと確認を出す(#773)", () => {
  const reasonOf = (out) =>
    JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason;
  // 旧来の並びはどちらも `press-…` で変わらない。新しい並びだけが捕まえる
  const renamed = editChunk(`[mext-press-${TAIL}]`, `[nier-press-${TAIL}]`);
  assert.ok(renamed.stdout, "先頭の区切りだけの書き換えで確認が出なかった");
  assert.match(reasonOf(renamed), /nier-press-/);
  // 新しい並びは `_` の手前で語が切れて変わらない。旧来の並びだけが捕まえる
  const suffixed = editChunk(`[nier-${TAIL}]`, `[nier-${TAIL}_]`);
  assert.ok(suffixed.stdout, "id の直後に _ を足して確認が出なかった");
  assert.match(reasonOf(suffixed), /articleIds \(word-bounded, in order\)/);
  // 旧来の並びの変化が新しい並びの変化から導けるときは 1 回だけ出す
  const both = reasonOf(editChunk(ID_A, ID_B));
  assert.equal(both.match(/articleIds \(/g).length, 1);
  // 別々の箇所で両方が変わったときは両方出す(`_` の破損を隠さない)
  const U = "2026-09-26-0123456789abcdef";
  const mixed = reasonOf(
    editChunk(
      `articleIds: [mext-press-${TAIL}, nier-${U}]`,
      `articleIds: [nier-press-${TAIL}, nier-${U}_]`
    )
  );
  assert.match(mixed, /articleIds \(in order\)/);
  assert.match(mixed, /articleIds \(word-bounded, in order\)/);
});

test("Edit: relatedEvidenceUrls swap fires (urls block)", () => {
  const oldS =
    ["---", "relatedEvidenceUrls:", "  - https://nier.go.jp/a", "---"].join(
      "\n"
    ) + "\n";
  const newS =
    ["---", "relatedEvidenceUrls:", "  - https://wikipedia.org/b", "---"].join(
      "\n"
    ) + "\n";
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /urls/);
});

test("Edit: prose-only body change does not fire", () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n\n本文 typo。';
  const newS = '---\nweekStart: "2026-04-27"\n---\n\n本文 typo を直した。';
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  assert.equal(out.exitCode, 0);
  assert.ok(!out.stdout);
});

test("Edit: summary change does not fire (not protected)", () => {
  const oldS = "---\ntitle: x\nsummary: 古い\n---\n";
  const newS = "---\ntitle: x\nsummary: 新しい\n---\n";
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test("Edit on non-digest path: skips entirely", () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n';
  const newS = '---\nweekStart: "2026-04-20"\n---\n';
  const input = JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "docs/decisions/0001.md",
      old_string: oldS,
      new_string: newS,
    },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test("MultiEdit: combines edits and fires when any protected", () => {
  const input = JSON.stringify({
    tool_name: "MultiEdit",
    tool_input: {
      file_path: "src/content/digests/2026-05-04.md",
      edits: [
        { old_string: "本文 typo", new_string: "本文 typo 直し" },
        {
          old_string: 'weekStart: "2026-04-27"',
          new_string: 'weekStart: "2026-04-20"',
        },
      ],
    },
  });
  const out = run(input);
  assert.ok(out.stdout);
});

test("Malformed JSON does not crash", () => {
  const out = run("not json");
  assert.equal(out.exitCode, 0);
});

test("Other tool names ignored", () => {
  const out = run(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  assert.equal(out.exitCode, 0);
});

// --- 探索コスト -----------------------------------------------------------
//
// settings.json の `timeout: 5`(秒)を超えるとプロセスが kill され、stdout が
// 出ない = ガードが黙って素通りする。空白の多い入力で二次的に膨らむ書き方に
// 戻っていないかを見る。
//
// **サイズと閾値は実測で決めた**(本機 Node 24、保護キー 5 本):
//   32KB / 線形       0.7ms
//   32KB / 全キー二次  8,486ms
//   32KB / 1 キーだけ二次  1,702ms   ← 部分的な退行もこの閾値で捕まる
// 16KB では 1 キーだけの退行が 424ms で閾値を割らない。逆に 256KB まで広げると
// 検知力は変わらないまま、赤になるまでの待ち時間だけが伸びる。
test("空白の多い入力でも探索が線形にとどまる", () => {
  const started = process.hrtime.bigint();
  captureProtectedFields(" ".repeat(32 * 1024));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    ms < 500,
    `32KB の空白に ${ms.toFixed(0)}ms かかった(二次挙動の疑い)`
  );

  // 値の途中に長い空白を挟む行。値の捕獲と行末の空白が重なると 2 乗になる。
  // キーごとに測る(1 キーだけ 2 乗に戻る部分的な退行も捕まえる)
  for (const key of PROTECTED_KEYS) {
    const t0 = process.hrtime.bigint();
    captureProtectedFields(`${key}: a${" ".repeat(32 * 1024)}b`);
    const inLine = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(
      inLine < 500,
      `${key} の値の中の 32KB の空白に ${inLine.toFixed(0)}ms かかった`
    );
  }

  // 線形にしても値の取り方は変えない: 前後の空白を落とす・空白だけなら最後の 1 文字・空なら値なし
  assert.deepEqual(
    [
      ...captureProtectedFields(
        "title: a  b \t\nweekStart:  \t\nweekEnd:\npublishedAt:'x'"
      ),
    ],
    [
      ["title", ["a  b"]],
      ["weekStart", ["\t"]],
      ["publishedAt", ["x"]],
    ]
  );

  // 記事 id の形の探索も線形に保つ。英数字の長い連続・ハイフン区切りの長い並び・
  // 連続したハイフン(語の中の `-+`)・ハイフンだけの並び
  for (const input of [
    "a".repeat(32 * 1024),
    "a-".repeat(16 * 1024),
    "a--".repeat(11 * 1024),
    "-".repeat(32 * 1024),
    "2026-".repeat(8 * 1024),
  ]) {
    const t0 = process.hrtime.bigint();
    captureProtectedFields(input);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(
      ms < 500,
      `記事 id の探索に ${ms.toFixed(0)}ms かかった(${input.slice(0, 6)}…)`
    );
  }
});

// --- CLI 配線 -----------------------------------------------------------
//
// 2026-08-09 の独立レビューで、`process.stdout.write(out.stdout)` を消しても
// 既存テストが全て緑のままだと実測された。run() の戻り値だけを見ていると、
// それが exit code と stdout になる経路が死んでも気づけない。
// フックは本番では子プロセスとして起動される。

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const HOOK = path.join(__dirname, "..", "pre-edit-frontmatter-immutable.cjs");

const editDigest = (oldStr, newStr) =>
  JSON.stringify({
    tool_name: "Edit",
    tool_input: {
      file_path: "src/content/digests/2026-08-03.md",
      old_string: oldStr,
      new_string: newStr,
    },
  });

const runCli = (payload) =>
  spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });

test("CLI: 保護フィールドの変更で permissionDecision を stdout に出す", () => {
  const res = runCli(
    editDigest("weekStart: 2026-08-01", "weekStart: 2026-09-01")
  );
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "ask");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /weekStart/);
});

test("CLI: 変更が無ければ何も出さずに 0 で終わる", () => {
  const res = runCli(
    editDigest("本文をすこし直した", "本文をもうすこし直した")
  );
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), "");
});

test("CLI: 壊れた入力でも落ちない", () => {
  assert.equal(runCli("{not json").status, 0);
  assert.equal(runCli("").status, 0);
});

// --- 判定 JSON が切れないこと --------------------------------------------
//
// **`process.exit()` は非同期の stdout を flush しない。** stdout がパイプのとき
// write は非同期なので、直後に exit すると書き残しが捨てられ、判定 JSON が
// ちょうど 65536B(パイプバッファ)で切れる。
//
// 切れた JSON は誰もエラーにしない。global ディスパッチャの isDecision() が
// false を返し、「判定ではない付随出力」として捨てて exit 0 =
// **ask が無音で消える**。このガードが防ごうとしている失敗そのもの。
//
// fmtVal は値を切らず(#779 までは 1 値を 60 文字で丸めていた)、**値の本数にも上限が無い**ので、
// relatedEvidenceUrls を多数持つ frontmatter の全文書き換えでこの大きさに届く。

const manyUrls = (tag, count) =>
  Array.from(
    { length: count },
    (_, i) =>
      `  - https://www.mext.go.jp/a/${tag}/id-${String(i).padStart(4, "0")}.html`
  ).join("\n");

test("CLI: 判定が 64KB を超えても stdout が切れない", () => {
  const res = runCli(
    editDigest(manyUrls("2026-04", 1200), manyUrls("2026-05", 1200))
  );

  assert.equal(res.status, 0);

  // **JSON.parse を先に置く。** サイズ検査を先にすると、切断された stdout は
  // ちょうど 65536B なので「フィクスチャが小さい」と読めるメッセージで落ち、
  // **本数を増やす方向に誤誘導する**(この検査を書いた時に実際に踏んだ)。
  // 末尾の固定文も見て、切れた JSON がたまたま構文的に閉じている場合を潰す。
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "ask");
  assert.match(
    parsed.hookSpecificOutput.permissionDecisionReason,
    /ledger before applying\.$/
  );

  // ここに来た時点で JSON は無傷。残る失敗は「フィクスチャが境界に届いていない」だけ。
  assert.ok(
    Buffer.byteLength(res.stdout) > 65536,
    `フィクスチャがパイプバッファ(65536B)に届いていない(${Buffer.byteLength(res.stdout)}B)。URL の本数を増やすこと`
  );
});

// stderr も同じ epilogue を通る。judgment そのものではないが、**この hook の
// テストには stderr 側を通る CLI 検査が 1 本も無く**、`process.stderr.write` の行を
// 消してもテストが 1 件も落ちなかった(2026-08-11 の変異試験で確認)。
// 理由文が途中で切れると **何を確認すればよいか分からない ask** になるので固定する。
test("CLI: 判定の理由は stderr にも出る", () => {
  const res = runCli(
    editDigest("weekStart: 2026-08-01", "weekStart: 2026-09-01")
  );
  assert.match(res.stderr, /weekStart/);
  assert.match(res.stderr, /ledger before applying\.\n$/);
});

test("CLI: 64KB を超える判定は stderr 側も切れない", () => {
  const res = runCli(
    editDigest(manyUrls("2026-04", 1200), manyUrls("2026-05", 1200))
  );
  assert.match(res.stderr, /ledger before applying\.\n$/);
  assert.ok(
    Buffer.byteLength(res.stderr) > 65536,
    `フィクスチャがパイプバッファ(65536B)に届いていない(${Buffer.byteLength(res.stderr)}B)。URL の本数を増やすこと`
  );
});

// --------------------------------------------------------------- Write 対応
//
// Write は差分ではなくファイル全体が届くので、ディスク上の現物と突き合わせる。
// これが無いと、Edit では捕捉される weekStart / publishedAt / 記事 id の改変が
// 「全文書き換え」では一切検知されない(2026-08-10 の横断レビューで発覚)。

const fs = require("node:fs");
const os = require("node:os");

let writeCounter = 0;
/** TARGET_PATH_RE にマッチするパスで実ファイルを作る。 */
function digestFile(body) {
  const dir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), `fm-write-${writeCounter++}-`)),
    "src",
    "content",
    "digests"
  );
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "x.md");
  if (body !== undefined) fs.writeFileSync(p, body);
  return p;
}

// publishedAt は未来(未公開)にしてある。公開済みにすると #688 の updatedAt 要求が
// 重なって、保護フィールドだけを見るテストにならない(公開済みの fixture は下の PUBLISHED_BODY)
const DIGEST_BODY = [
  "---",
  "title: 第 10 号",
  "weekStart: 2026-08-03",
  "weekEnd: 2026-08-09",
  "publishedAt: 2099-08-10",
  "---",
  "",
  "本文",
  "",
].join("\n");

const firedOn = (out) =>
  out.exitCode === 2 ||
  Boolean(out.stdout && out.stdout.includes("permissionDecision"));
const writeOn = (filePath, content) =>
  run(
    JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: filePath, content },
    })
  );

test("Write: 保護フィールドが変わったら確認を出す", () => {
  const p = digestFile(DIGEST_BODY);
  const out = writeOn(
    p,
    DIGEST_BODY.replace("weekStart: 2026-08-03", "weekStart: 2026-07-27")
  );
  assert.ok(firedOn(out), "Write による全文書き換えを検知できていない");
  assert.match(out.stdout, /weekStart/);
});

test("Write: publishedAt の書き換えも検知する", () => {
  const p = digestFile(DIGEST_BODY);
  assert.ok(
    firedOn(
      writeOn(
        p,
        DIGEST_BODY.replace(
          "publishedAt: 2099-08-10",
          "publishedAt: 2099-08-11"
        )
      )
    )
  );
});

test("Write: 保護フィールドが同じなら素通りする", () => {
  const p = digestFile(DIGEST_BODY);
  assert.equal(
    firedOn(writeOn(p, DIGEST_BODY.replace("本文", "本文を推敲した"))),
    false
  );
});

test("Write: 新規作成(ENOENT)は比較対象が無いので素通りする", () => {
  assert.equal(firedOn(writeOn(digestFile(undefined), DIGEST_BODY)), false);
});

test("Write: 現物を読めないときは素通りさせず確認を出す(fail-safe)", () => {
  const p = digestFile(DIGEST_BODY);
  fs.rmSync(p);
  fs.mkdirSync(p); // 同じパスをディレクトリにして EISDIR を起こす
  const out = writeOn(p, DIGEST_BODY);
  assert.ok(firedOn(out), "読めないのに素通りしている");
  assert.match(out.stdout, /unreadable/);
  // 見出しは保護値の変化ではなく、確かめられないとして出す(#781)
  const heading = JSON.parse(
    out.stdout
  ).hookSpecificOutput.permissionDecisionReason.split("\n")[0];
  assert.match(heading, /Cannot verify/);
  assert.doesNotMatch(heading, /Protected fields changed/);
});

test("Write: 対象外のパスは見ない", () => {
  assert.equal(firedOn(writeOn("/tmp/README.md", DIGEST_BODY)), false);
});

// ---- 公開済みの号を編集したら updatedAt を要求する(#688) ----

const PUBLISHED_BODY = [
  "---",
  "title: 第 10 号",
  "weekStart: 2026-08-03",
  "weekEnd: 2026-08-09",
  'publishedAt: "2026-08-10T07:00:00+09:00"',
  "summary: 要約",
  "---",
  "",
].join("\n");

const editOn = (filePath, old_string, new_string) =>
  run(
    JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath, old_string, new_string },
    })
  );

test("Edit: 公開済みの号の summary を変えて updatedAt を書かないと確認を出す", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = editOn(p, "summary: 要約", "summary: 直した要約");
  assert.ok(firedOn(out), "updatedAt 無しの編集が素通りしている");
  assert.match(out.stdout, /updatedAt/);
});

test("Edit: 同じ Edit で updatedAt を新しい値にすれば素通りする", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = editOn(
    p,
    'publishedAt: "2026-08-10T07:00:00+09:00"\nsummary: 要約',
    'publishedAt: "2026-08-10T07:00:00+09:00"\nupdatedAt: "2026-09-17T10:00:00+09:00"\nsummary: 直した要約'
  );
  assert.equal(firedOn(out), false);
});

// 今日(JST)の日付。updatedAt を先に書いてから本文を直す運用を通すため
const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

test("Edit: ディスクの updatedAt が今日(JST)なら、続く編集は素通りする", () => {
  const p = digestFile(
    PUBLISHED_BODY.replace(
      "summary: 要約",
      `updatedAt: "${todayJst}T09:00:00+09:00"\nsummary: 要約`
    )
  );
  assert.equal(
    firedOn(editOn(p, "summary: 要約", "summary: 直した要約")),
    false
  );
});

test("Edit: ディスクの updatedAt が昨日以前なら、今日の編集は確認を出す", () => {
  const p = digestFile(
    PUBLISHED_BODY.replace(
      "summary: 要約",
      'updatedAt: "2026-08-20T09:00:00+09:00"\nsummary: 要約'
    )
  );
  const out = editOn(p, "summary: 要約", "summary: 直した要約");
  assert.ok(firedOn(out));
  assert.match(out.stdout, /2026-08-20/);
});

test("Edit: 未公開の号(publishedAt が未来)は updatedAt を要求しない", () => {
  const p = digestFile(
    PUBLISHED_BODY.replace(
      "2026-08-10T07:00:00+09:00",
      "2099-08-10T07:00:00+09:00"
    )
  );
  assert.equal(
    firedOn(editOn(p, "summary: 要約", "summary: 直した要約")),
    false
  );
});

test("Edit: ファイルが無い(新規作成中)なら updatedAt は見ない", () => {
  assert.equal(
    firedOn(
      editOn(digestFile(undefined), "summary: 要約", "summary: 直した要約")
    ),
    false
  );
});

test("Write: 公開済みの号を updatedAt 無しで書き換えると確認を出す", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = writeOn(
    p,
    PUBLISHED_BODY.replace("summary: 要約", "summary: 直した要約")
  );
  assert.ok(firedOn(out));
  assert.match(out.stdout, /updatedAt/);
});

test("Write: updatedAt を新しい値にした全文なら素通りする", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = writeOn(
    p,
    PUBLISHED_BODY.replace(
      "summary: 要約",
      'updatedAt: "2026-09-17T10:00:00+09:00"\nsummary: 直した要約'
    )
  );
  assert.equal(firedOn(out), false);
});

test("MultiEdit: どれか 1 つの編集が updatedAt を書いていれば素通りする", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = run(
    JSON.stringify({
      tool_name: "MultiEdit",
      tool_input: {
        file_path: p,
        edits: [
          { old_string: "summary: 要約", new_string: "summary: 直した要約" },
          {
            old_string: 'publishedAt: "2026-08-10T07:00:00+09:00"',
            new_string:
              'publishedAt: "2026-08-10T07:00:00+09:00"\nupdatedAt: "2026-09-17T10:00:00+09:00"',
          },
        ],
      },
    })
  );
  assert.equal(firedOn(out), false);
});

test("Edit: 同じ値で updatedAt を書き直しても「更新」にはならず確認を出す", () => {
  const p = digestFile(
    PUBLISHED_BODY.replace(
      "summary: 要約",
      'updatedAt: "2026-08-20T09:00:00+09:00"\nsummary: 要約'
    )
  );
  const out = editOn(
    p,
    'updatedAt: "2026-08-20T09:00:00+09:00"\nsummary: 要約',
    'updatedAt: "2026-08-20T09:00:00+09:00"\nsummary: 直した要約'
  );
  assert.ok(firedOn(out));
});

test("evaluateUpdatedAt: 「今日」は JST の暦日で判定する", () => {
  const {
    evaluateUpdatedAt,
  } = require("../pre-edit-frontmatter-immutable.cjs");
  const p = digestFile(
    PUBLISHED_BODY.replace(
      "summary: 要約",
      'updatedAt: "2026-09-18T00:30:00+09:00"\nsummary: 要約'
    )
  );
  // 2026-09-17T15:30Z = JST 09-18 00:30 → 同じ日なので通す
  assert.equal(
    evaluateUpdatedAt(
      p,
      "summary: 要約",
      "summary: x",
      Date.parse("2026-09-17T15:30:00Z")
    ).length,
    0
  );
  // 2026-09-17T14:30Z = JST 09-17 23:30 → 前日なので確認を出す
  assert.equal(
    evaluateUpdatedAt(
      p,
      "summary: 要約",
      "summary: x",
      Date.parse("2026-09-17T14:30:00Z")
    ).length,
    1
  );
});

// ---- 「公開済み」は origin/main に同じパスがあるかで決める ----

const { execFileSync } = require("node:child_process");
/** digestFile と同じ配置を git リポジトリの中に作り、origin/main を指す ref を張る。 */
function digestRepoFile(body, { onMain }) {
  const p = digestFile(body);
  const root = path.resolve(path.dirname(p), "../../..");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "-q");
  if (onMain) {
    git("add", "-A");
    git("commit", "-q", "-m", "x");
  } else {
    fs.writeFileSync(path.join(root, "README.md"), "x");
    git("add", "README.md");
    git("commit", "-q", "-m", "x");
  }
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return p;
}

test("Edit: origin/main に無い号は publishedAt が過去でも執筆中として通す", () => {
  const p = digestRepoFile(PUBLISHED_BODY, { onMain: false });
  assert.equal(
    firedOn(editOn(p, "summary: 要約", "summary: 直した要約")),
    false
  );
});

test("Edit: origin/main にある号は publishedAt が未来でも公開済みとして確認を出す", () => {
  const p = digestRepoFile(
    PUBLISHED_BODY.replace(
      "2026-08-10T07:00:00+09:00",
      "2099-08-10T07:00:00+09:00"
    ),
    { onMain: true }
  );
  assert.ok(firedOn(editOn(p, "summary: 要約", "summary: 直した要約")));
});

// ---- updatedAt の値そのものを見る(#695) ----

test("Edit: updatedAt が publishedAt より前なら確認を出す", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = editOn(
    p,
    "summary: 要約",
    'updatedAt: "2026-08-01T10:00:00+09:00"\nsummary: 直した要約'
  );
  assert.ok(firedOn(out), "publishedAt より前の updatedAt が素通りしている");
  assert.match(out.stdout, /publishedAt/);
});

test("Edit: updatedAt が今日(JST)より後なら確認を出す", () => {
  const p = digestFile(PUBLISHED_BODY);
  const out = editOn(
    p,
    "summary: 要約",
    'updatedAt: "2099-01-01T10:00:00+09:00"\nsummary: 直した要約'
  );
  assert.ok(firedOn(out));
  assert.match(out.stdout, /今日/);
});

test("Edit: updatedAt がオフセット付き ISO8601 でなければ確認を出す", () => {
  const p = digestFile(PUBLISHED_BODY);
  // 最後の 1 つは regex を通るが Date.parse が NaN になる形(isFinite の分岐)
  for (const bad of [
    "tomorrow",
    "2026-09-17",
    "2026-09-17T10:00:00",
    "2026-13-01T10:00:00+09:00",
  ]) {
    const out = editOn(
      p,
      "summary: 要約",
      `updatedAt: "${bad}"\nsummary: 直した要約`
    );
    assert.ok(firedOn(out), `${bad} が素通りしている`);
    assert.match(out.stdout, /ISO8601/);
  }
});

test("Edit: publishedAt 以降・今日以前のオフセット付き ISO8601 なら素通りする", () => {
  const p = digestFile(PUBLISHED_BODY);
  // 今日の JST 00:30 を +09:00 で書く(境界の日付側)
  const out = editOn(
    p,
    "summary: 要約",
    `updatedAt: "${todayJst}T00:30:00+09:00"\nsummary: 直した要約`
  );
  assert.equal(firedOn(out), false);
});

// 実際の sourceId で組んだ id を hook に通し、丸ごと拾えるかを見る(以前は `mext-press-…` から
// `press-…` しか拾わなかった、#773)。正規表現は写さない。
// 見るのは `src/lib/sources/<sourceId>.ts` の各ファイルで最初の `sourceId: "…"` だけ。
// 同じファイルの 2 本目の parser や、別の置き場所・書き方の sourceId は素通りする。
// 素通りした分は、収集後に次のテスト(記事データの全 id)が拾う。
test("captureProtectedFields: 全 source の sourceId で組んだ id を丸ごと拾う(#773)", () => {
  const dir = path.join(__dirname, "..", "..", "..", "src", "lib", "sources");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts");
  assert.ok(files.length > 0, `${dir} に parser が無い`);
  for (const f of files) {
    const m = fs
      .readFileSync(path.join(dir, f), "utf8")
      .match(/^\s*sourceId:\s*"([^"]+)"/m);
    assert.ok(m, `${f}: \`sourceId: "…"\` の行が読めない`);
    const id = `${m[1]}-2026-01-01-0123456789abcdef`;
    assert.deepEqual(
      captureProtectedFields(`articleIds: [${id}]`).get("__articleIds__"),
      [id],
      `${f}: sourceId "${m[1]}" の id を hook が丸ごと拾えない(#773 の退行)`
    );
  }
});

// 上のテストの最後の網(#776)。parser の置き方や書き方によらず、実際に作られた id を
// hook に通す。赤になるのは収集の後で、自動収集 PR の必須チェックが落ちて取り込みが止まる。
test("captureProtectedFields: 記事データの全 id を丸ごと拾う(#776)", () => {
  const dir = path.join(__dirname, "..", "..", "..", "src", "data", "articles");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, `${dir} に記事データが無い`);
  let count = 0;
  const missed = [];
  for (const f of files) {
    for (const article of JSON.parse(
      fs.readFileSync(path.join(dir, f), "utf8")
    )) {
      assert.equal(
        typeof article.id,
        "string",
        `${f}: id が文字列でない記事がある`
      );
      count++;
      const got = captureProtectedFields(`articleIds: [${article.id}]`).get(
        "__articleIds__"
      );
      if (!got || got.length !== 1 || got[0] !== article.id)
        missed.push(`${f}: ${article.id}`);
    }
  }
  assert.ok(count > 0, "記事データに id が 1 件も無い");
  assert.deepEqual(
    missed,
    [],
    "hook が丸ごと拾えない記事 id がある(#773 の退行)"
  );
});

// --- Edit を現物に当てて frontmatter 全体を比べる(#779) ------------------
//
// 断片どうしの比較だけでは、記事 id の日付とハッシュを含まない断片(`[nikkyo-` → `[kyodo-`)や、
// キー名を含まない断片(`08-03` → `08-04`)の編集に確認が出なかった。
// publishedAt は未来にしてある(公開済みの号だと updatedAt の確認が常に出て、テストが空振りする)。

const APPLIED_BODY = [
  "---",
  "title: 第 10 号",
  "weekStart: 2026-08-03",
  "weekEnd: 2026-08-09",
  "publishedAt: 2099-08-10",
  "summary: abc tail",
  "sections:",
  `  - articleIds: [nikkyo-${TAIL}, nier-2026-09-26-0123456789abcdef]`,
  "    heading: 見出し",
  "relatedEvidenceUrls:",
  "  - url: https://edu-evidence.org/strategies/retrieval-practice-long-slug-for-testing/",
  "    title: 関連する戦略",
  "---",
  "",
  "本文",
  "",
].join("\n");

const reasonOn = (out) =>
  out.stdout
    ? JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason
    : "";

test("Edit: id の日付とハッシュを含まない断片でも、現物に当てて変わるなら確認を出す(#779)", () => {
  for (const [o, n, re] of [
    ["[nikkyo-", "[kyodo-", /articleIds/],
    ["786ac230c4d7", "786ac230c4d8", /articleIds/],
    ["08-03", "08-04", /weekStart/],
    ["retrieval-practice-long", "retrieval-practice-lang", /urls/],
  ]) {
    const out = editOn(digestFile(APPLIED_BODY), o, n);
    assert.match(reasonOn(out), re, `${o} → ${n} で確認が出なかった`);
  }
  // 断片にも id がある編集では、現物に当てた側の並び(節の中のほかの id も含む)を出す
  const both = reasonOn(
    editOn(digestFile(APPLIED_BODY), `nikkyo-${TAIL}`, `kyodo-${TAIL}`)
  );
  assert.ok(
    both.includes("nier-2026-09-26-0123456789abcdef"),
    "現物に当てた並びではなく断片の並びが出ている"
  );
});

test("Edit: 現物に当てられないときは確認を出し、replace_all と `$&` はそのまま当てる(#779)", () => {
  const p = digestFile(APPLIED_BODY);
  const editWith = (input) =>
    run(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: p, ...input },
      })
    );
  // Claude Code は曲がった引用符・`\u` を正規化してから当てるので、見つからない＝失敗とは限らない
  assert.match(reasonOn(editOn(p, "“見出し”", "“別”")), /確かめられない/);
  // replace_all でないのに複数ある(weekStart / weekEnd / publishedAt)
  assert.match(reasonOn(editOn(p, "08-", "09-")), /確かめられない/);
  assert.match(
    reasonOn(
      editWith({ old_string: "08-", new_string: "09-", replace_all: true })
    ),
    /weekStart/
  );
  // 空の old_string は Claude Code が既存ファイルに対して拒否するので、現物には当てない
  assert.equal(reasonOn(editOn(p, "", "x")), "");
  // 当てた結果が大きすぎる(4MB 超)ときも、確かめられないとして確認を出す
  assert.match(
    reasonOn(
      editWith({
        old_string: "08-03",
        new_string: "x".repeat(4 * 1024 * 1024 + 1),
      })
    ),
    /確かめられない/
  );
  // 改行を含む old_string も 1 行で出す
  const multiline = reasonOn(editOn(p, "\nnot-in-file", "x"));
  assert.match(multiline, /"\\nnot-in-file"/);
  // `$&` を置換パターンとして解釈すると、編集後も `08-03` のままに見える
  assert.match(reasonOn(editOn(p, "08-03", "$&")), /weekStart/);
});

test("Edit: 空の new_string で次の行とつながる編集に確認を出す(#779)", () => {
  // Claude Code は空の new_string のとき、直後の改行も消すことがある。
  // `summary: abc tail` の ` tail` を消すと、次の `weekStart:` 行が summary 行につながる(実測)
  const p = digestFile(
    APPLIED_BODY.replace("summary: abc tail\n", "").replace(
      "title: 第 10 号\n",
      "title: 第 10 号\nsummary: abc tail\n"
    )
  );
  assert.match(reasonOn(editOn(p, " tail", "")), /weekStart/);
  // 直後に改行が無い位置なら、つながる行が無いので素通り
  assert.equal(reasonOn(editOn(p, "abc ", "")), "");
});

test("見出しは差分の分類から組み立てる(確かめられない・updatedAt・保護値の変化)(#781)", () => {
  const heading = (out) => reasonOn(out).split("\n")[0];
  const p = digestFile(APPLIED_BODY);
  const unapplied = heading(editOn(p, "not-in-file", "x"));
  assert.match(unapplied, /Cannot verify/);
  assert.doesNotMatch(unapplied, /Protected fields changed/);
  // 公開済みの号では updatedAt の確認が同時に出る。それでも保護値の変化とは書かない
  const published = heading(
    editOn(
      digestFile(
        APPLIED_BODY.replace(
          "publishedAt: 2099-08-10",
          'publishedAt: "2026-08-10T07:00:00+09:00"'
        )
      ),
      "not-in-file",
      "x"
    )
  );
  assert.match(published, /Cannot verify/);
  assert.match(published, /updatedAt/);
  assert.doesNotMatch(published, /Protected fields changed/);
  assert.match(
    heading(editOn(p, "08-03", "08-04")),
    /Protected fields changed/
  );
});

test("確かめられないときの old_string は先頭だけを出し、出力を 1 MiB 未満に収める(#781)", () => {
  const out = editOn(digestFile(APPLIED_BODY), "a".repeat(600000), "x");
  const reason = reasonOn(out);
  assert.match(reason, /確かめられない/);
  assert.match(reason, /全 600000 文字/);
  const bytes =
    Buffer.byteLength(out.stdout ?? "") + Buffer.byteLength(out.stderr ?? "");
  assert.ok(bytes < 1024 * 1024, `出力が ${bytes} バイト`);
});

test("URL の変化は、増えた URL と減った URL だけを出す(#781)", () => {
  const KEEP = "https://edu-evidence.org/strategies/feedback/";
  const p = digestFile(
    APPLIED_BODY.replace(
      "    title: 関連する戦略\n",
      `    title: 関連する戦略\n  - url: ${KEEP}\n    title: 変えない\n`
    )
  );
  const reason = reasonOn(
    editOn(p, "retrieval-practice-long", "retrieval-practice-lang")
  );
  assert.match(reason, /増えた: .*retrieval-practice-lang/);
  assert.match(reason, /減った: .*retrieval-practice-long/);
  assert.ok(!reason.includes(KEEP), "変わらない URL まで出ている");
});

test("Edit: CRLF のファイルでも、空の new_string で次の行とつながる編集に確認を出す(#781)", () => {
  // 現物の CRLF を LF に直してから当てる。直さないと `old_string + "\n"` が見つからず、つながる候補が作られない
  const p = digestFile(
    APPLIED_BODY.replace("summary: abc tail\n", "")
      .replace("title: 第 10 号\n", "title: 第 10 号\nsummary: abc tail\n")
      .replaceAll("\n", "\r\n")
  );
  assert.match(reasonOn(editOn(p, " tail", "")), /weekStart/);
  // CRLF を含む old_string は、直した現物には見つからないので確かめられないとして確認を出す
  assert.match(
    reasonOn(editOn(p, "abc tail\r\nweekStart", "abc tail\r\nweekStart")),
    /確かめられない/
  );
});

test("Edit: 見出しの編集と入れ子の title の断片は素通りし、最上位の title は断片でも確認を出す(#779)", () => {
  const p = digestFile(APPLIED_BODY);
  assert.equal(reasonOn(editOn(p, "見出し", "新しい見出し")), "");
  // 本文の長い号(約 100KB)でも、現物に当てた比較が上限で止まらない
  const long = digestFile(
    `${APPLIED_BODY}${"本文の段落。\n".repeat(8 * 1024)}`
  );
  assert.equal(reasonOn(editOn(long, "見出し", "新しい見出し")), "");
  // 現物に当てた比較では title を最上位だけで見る。入れ子の title(relatedEvidenceUrls)は、
  // 断片に `title:` が入るときだけ今までどおり確認が出る
  assert.equal(reasonOn(editOn(p, "関連する戦略", "関連する別の戦略")), "");
  assert.match(
    reasonOn(editOn(p, "    title: 関連する戦略", "    title: 別")),
    /title/
  );
  assert.match(reasonOn(editOn(p, "第 10 号", "第 11 号")), /title/);
});

test("MultiEdit: 断片の編集も現物に順に当てて比べる(#779)", () => {
  const p = digestFile(APPLIED_BODY);
  const multi = (edits) =>
    run(
      JSON.stringify({
        tool_name: "MultiEdit",
        tool_input: { file_path: p, edits },
      })
    );
  const renamed = multi([
    { old_string: "見出し", new_string: "別の見出し" },
    { old_string: "[nikkyo-", new_string: "[kyodo-" },
  ]);
  assert.match(reasonOn(renamed), /articleIds/);
  // 順に当てる: 2 本目は 1 本目が作った文字列を書き換える(現物に別々に当てると見つからない)
  const chained = multi([
    { old_string: "見出し", new_string: "仮の見出し" },
    { old_string: "仮の見出し", new_string: "決めた見出し" },
  ]);
  assert.equal(reasonOn(chained), "");
  // 空の new_string は 2 通りを当てるので、候補は編集ごとに倍になる。上限(16)を超えたら
  // 断片の比較だけに戻さず、確かめられないとして確認を出す(断片の `08-03` はキー名を含まない)
  const body = [1, 2, 3, 4, 5].map((i) => `a${i} t${i}\nz${i}`).join("\n");
  const q = digestFile(`${APPLIED_BODY}${body}\n`);
  const many = run(
    JSON.stringify({
      tool_name: "MultiEdit",
      tool_input: {
        file_path: q,
        edits: [
          { old_string: "08-03", new_string: "08-04" },
          ...[1, 2, 3, 4, 5].map((i) => ({
            old_string: ` t${i}`,
            new_string: "",
          })),
        ],
      },
    })
  );
  assert.match(reasonOn(many), /確かめられない/);
  // 上限の手前(3 本で 8 通り)の無害な編集は素通り
  const few = run(
    JSON.stringify({
      tool_name: "MultiEdit",
      tool_input: {
        file_path: q,
        edits: [1, 2, 3].map((i) => ({ old_string: ` t${i}`, new_string: "" })),
      },
    })
  );
  assert.equal(reasonOn(few), "");
});

test("理由表示は値を切らずに出す(#779)", () => {
  // 以前は 1 値を 57 文字で切っていたので、長い URL や id の末尾の変化が before / after で同じに見えた
  const url = `https://edu-evidence.org/strategies/${"a".repeat(80)}/`;
  const urlReason = reasonOn(editChunk(`  - url: ${url}`, `  - url: ${url}x`));
  assert.ok(urlReason.includes(`${url}x`), "変更後の URL が切られている");
  const id = `${"a".repeat(40)}-${TAIL}`;
  const changed = `${id.slice(0, -1)}4`;
  assert.ok(
    reasonOn(editChunk(`[${id}]`, `[${changed}]`)).includes(changed),
    "変更後の記事 id が切られている"
  );
});
