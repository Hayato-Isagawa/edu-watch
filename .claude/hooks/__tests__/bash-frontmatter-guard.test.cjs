"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HOOKS = path.join(__dirname, "..");
const GUARD_PATH = path.join(HOOKS, "bash-frontmatter-guard.cjs");
const EDIT_PATH = path.join(HOOKS, "pre-edit-frontmatter-immutable.cjs");
const ROUNDTRIP_PATH = path.join(HOOKS, "post-edit-roundtrip-spot-check.cjs");

// --- Edit 側の 2 本との一致 ------------------------------------------------
//
// 本ガードは Edit 側の 2 本を require しない(ディスパッチャの sha256 ピンは実行する 1 ファイル
// しか照合しないので、require した先は無検査で走る)。Edit 側の 2 本はユーザー環境の
// ディスパッチャが sha256 で固定しているので、定数を export させるために書き換えることもできない。代わりに、宣言の文字列と
// 抽出の結果でずれていないことをここで固定する。

/** `const NAME = …;` の宣言を、空白を詰めた文字列で取り出す。無ければ null */
function declaration(src, name) {
  const m = src.match(new RegExp(`^const ${name} =([\\s\\S]*?);$`, "m"));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

test("抽出の宣言(保護キー・正規表現・トークンの正規表現)が Edit 側の 2 本のソースと一致する", () => {
  const guardSrc = fs.readFileSync(GUARD_PATH, "utf8");
  const pairs = [
    [
      EDIT_PATH,
      [
        "PROTECTED_KEYS",
        "FRONTMATTER_RE",
        "URL_RE",
        "ARTICLE_ID_WORD_RE",
        "ARTICLE_ID_TAIL_RE",
        "ARTICLE_ID_BOUNDED_RE",
        "UPDATED_AT_RE",
        "PUBLISHED_AT_RE",
        "ISO_OFFSET_RE",
      ],
    ],
    [
      ROUNDTRIP_PATH,
      ["URL_RE", "DOI_RE", "DP_ID_RE", "EFFECT_SIZE_RE", "NUMBER_RE", "KINDS"],
    ],
  ];
  for (const [file, names] of pairs) {
    const src = fs.readFileSync(file, "utf8");
    for (const name of names) {
      const theirs = declaration(src, name);
      assert.ok(theirs, `${path.basename(file)} に ${name} が無い`);
      assert.equal(declaration(guardSrc, name), theirs, name);
    }
  }
});

/** `function NAME(…) { … }` の宣言を(行頭の `}` まで)、空白を詰めた文字列で取り出す。無ければ null */
function functionDeclaration(src, name) {
  const m = src.match(new RegExp(`^function ${name}\\(([\\s\\S]*?)^\\}$`, "m"));
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

test("判定と表示の関数(diffTokens・fmtList・fmtVal・multisetMinus)が Edit 側の 2 本のソースと一致する", () => {
  // 抽出が一致していても、どのトークンを出すか(diffTokens)や、URL の増えた・減った(multisetMinus)・
  // 値の並べ方(fmtList・fmtVal)が片方だけ変わると、同じ変化を違って見せる
  const guardSrc = fs.readFileSync(GUARD_PATH, "utf8");
  for (const [file, names] of [
    [ROUNDTRIP_PATH, ["diffTokens", "fmtList"]],
    [EDIT_PATH, ["fmtVal", "multisetMinus"]],
  ]) {
    const src = fs.readFileSync(file, "utf8");
    for (const name of names) {
      const theirs = functionDeclaration(src, name);
      assert.ok(theirs, `${path.basename(file)} に ${name} が無い`);
      assert.equal(functionDeclaration(guardSrc, name), theirs, name);
    }
  }
});

test("require するのは node の組み込みだけ", () => {
  // 組み込み以外を require すると、その先はディスパッチャの sha256 照合を通らずに走る。
  const src = fs.readFileSync(GUARD_PATH, "utf8");
  const required = [...src.matchAll(/\brequire\s*\(\s*([^)]*)\)/g)].map((m) =>
    m[1].trim()
  );
  assert.ok(required.length > 0);
  for (const r of required) assert.match(r, /^"node:[a-z_/]+"$/);
});

const guard = require("../bash-frontmatter-guard.cjs");
const editGuard = require("../pre-edit-frontmatter-immutable.cjs");
const roundtrip = require("../post-edit-roundtrip-spot-check.cjs");

const REPO = path.resolve(__dirname, "..", "..", "..");
const DIGESTS_DIR = "src/content/digests";

test("保護値とトークンの抽出が実データ全件と作り物の入力で Edit 側の 2 本と一致する", () => {
  // キーごとの正規表現は関数の中で組み立てているので、宣言の比較では固定できない。
  // 窓の取り方は Edit 側の Write と同じ(frontmatter、無ければ全文)。トークンは全文で比べる
  let compared = 0;
  const dir = path.join(REPO, DIGESTS_DIR);
  for (const name of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const fm = editGuard.extractFrontmatter(text);
    assert.equal(guard.extractFrontmatter(text), fm, name);
    assert.deepEqual(
      guard.captureProtectedFields(fm ?? text),
      editGuard.captureProtectedFields(fm ?? text),
      name
    );
    assert.deepEqual(
      guard.extractTokens(text),
      roundtrip.extractTokens(text),
      name
    );
    compared++;
  }
  assert.ok(compared >= 30, `比較が ${compared} 件しかない`);

  // 実データに無い形も比べる。実データだけだと、前置きの `(?:-[ \t]*)?` を落とす変異や
  // 値の取り方(valueAfterColon)の変異が緑のまま通る
  const id = "2026-09-25-786ac230c4d757f3";
  for (const fm of [
    "relatedEvidenceUrls:\n  - title: 根拠 12 件\n    url: https://example.org/x",
    "title:\nweekStart: 2026-08-01",
    "　title: 第 1 号\nweekEnd: 2026-08-07",
    "weekStart: '2026-08-01'\r\npublishedAt: \"2026-08-02T07:00:00+09:00\"\r\n",
    "title: a  b \t\nweekStart:  \t\nweekEnd:\npublishedAt:'x'",
    `articleIds: [mext-press-${id}, nikkyo-${id}]`,
    `articleIds:\n  - nikkyo-${id}_x\n  - kyodo-${id}-v2\n  - mext--${id}`,
    "DP12-345 d = 0.31 Cohen's g=-1.20 10.1234/abc.5 1,234.5 https://a.example/b)",
    "",
  ]) {
    assert.deepEqual(
      guard.captureProtectedFields(fm),
      editGuard.captureProtectedFields(fm),
      JSON.stringify(fm)
    );
    assert.deepEqual(
      guard.extractTokens(fm),
      roundtrip.extractTokens(fm),
      JSON.stringify(fm)
    );
  }
});

test("roundtrip の判定(diffTokens)が実データの号の組と作り物の入力で Edit 側と一致する", () => {
  // 宣言の文字列の比較に加えて、出力でも固定する(関数の中で使う定数や組み立ての変化も拾う)
  const dir = path.join(REPO, DIGESTS_DIR);
  const texts = fs
    .readdirSync(dir)
    .sort()
    .map((n) => fs.readFileSync(path.join(dir, n), "utf8"));
  let compared = 0;
  for (let i = 1; i < texts.length; i++) {
    assert.deepEqual(
      guard.diffTokens(texts[i - 1], texts[i]),
      roundtrip.diffTokens(texts[i - 1], texts[i]),
      String(i)
    );
    compared++;
  }
  assert.ok(compared >= 29, `比較が ${compared} 組しかない`);
  for (const [a, b] of [
    ["DP12-345 は 12.9%", "DP12-346 は 13.9%"],
    ["d = 0.31", "Cohen's d = 0.35"],
    ["10.1234/abc.5 https://a.example/b", "10.1234/abc.6 https://a.example/c"],
    ["", "1,234.5"],
  ]) {
    assert.deepEqual(
      guard.diffTokens(a, b),
      roundtrip.diffTokens(a, b),
      `${a} → ${b}`
    );
  }
});

test("settings.json が Bash の 3 イベントにこのガードを配線している", () => {
  // 配線が消えるとガード全体が黙って無効になるが、他のどのテストも赤にならない
  const settings = JSON.parse(
    fs.readFileSync(path.join(HOOKS, "..", "settings.json"), "utf8")
  );
  assert.notEqual(settings.disableAllHooks, true);
  for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
    const wired = (settings.hooks?.[event] ?? []).some(
      (group) =>
        group.matcher === "Bash" &&
        (group.hooks ?? []).some(
          (h) =>
            h.type === "command" &&
            h.timeout === 5 &&
            h.async !== true &&
            h.command ===
              'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/bash-frontmatter-guard.cjs'
        )
    );
    assert.ok(wired, event);
  }
});

// --- fixture ------------------------------------------------------------

const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const ID_A = "nikkyo-2026-08-05-786ac230c4d757f3";
const ID_B = "mext-press-2026-08-04-6f8686b60df11108";

/** 公開済みの号の形。publishedAt は過去 */
const DIGEST = [
  "---",
  "title: 第 10 号 — 12 の論点",
  'weekStart: "2026-08-03"',
  'weekEnd: "2026-08-09"',
  'publishedAt: "2026-08-10T07:00:00+09:00"',
  "summary: 要約 12.9%",
  "sections:",
  `  - articleIds: [${ID_A}, ${ID_B}]`,
  "    heading: 見出し",
  "    comment: |",
  "      本文 12.9% と 36.2%。[資料](https://www.example.go.jp/a)",
  "relatedEvidenceUrls:",
  "  - title: 根拠 3 件",
  "    url: https://edu-evidence.org/strategies/x",
  "---",
  "",
].join("\n");
const PUB = `${DIGESTS_DIR}/2026-08-10.md`;
const DRAFT = `${DIGESTS_DIR}/2026-08-17.md`;
const DRAFT_BODY = DIGEST.replace("第 10 号", "第 11 号");

function git(cwd, ...args) {
  const res = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" }
  );
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

// 1 回の実行で git リポを 20 個以上作るので、終わったら消す
const tmpDirs = [];
const tmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * 公開済みの号(origin/main にある)1 本と、未公開の号(追跡外)1 本がある git リポと、
 * 未作成の状態置き場。origin/main は `git update-ref` で張る(Edit 側のテストと同じ作り方)
 */
function makeRepo() {
  const root = tmp("bash-fm-repo-");
  fs.mkdirSync(path.join(root, DIGESTS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, PUB), DIGEST);
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  fs.writeFileSync(path.join(root, DRAFT), DRAFT_BODY);
  const stateDir = path.join(tmp("bash-fm-state-"), "guard");
  return { root, stateDir };
}

const call = (ctx, event, toolUseId = "toolu_01", extra = {}) =>
  guard.run(
    JSON.stringify({
      hook_event_name: event,
      session_id: "sess-1",
      tool_use_id: toolUseId,
      tool_name: "Bash",
      tool_input: { command: "true" },
      cwd: ctx.root,
    }),
    { root: ctx.root, stateDir: ctx.stateDir, ...extra }
  );

const parsed = (out) => (out.stdout ? JSON.parse(out.stdout) : {});
const contextOf = (out) => out.hookSpecificOutput?.additionalContext ?? "";

/** Pre → (Bash の実行を模して) mutate → Post の順に走らせ、Post の出力を返す */
function roundTrip(ctx, mutate, { event = "PostToolUse", ...extra } = {}) {
  call(ctx, "PreToolUse", "toolu_01", extra);
  mutate();
  return parsed(call(ctx, event, "toolu_01", extra));
}

const rewrite = (root, rel, from, to) => {
  const p = path.join(root, rel);
  const before = fs.readFileSync(p, "utf8");
  const after = before.replace(from, to);
  assert.notEqual(after, before, `${rel} に ${from} が無い`);
  fs.writeFileSync(p, after);
};

// --- 事後照合 ------------------------------------------------------------

test("Post: 保護値の変化を Claude とユーザーの両方へ出す", () => {
  const ctx = makeRepo();
  const out = roundTrip(ctx, () =>
    rewrite(
      ctx.root,
      DRAFT,
      'weekStart: "2026-08-03"',
      'weekStart: "2026-08-04"'
    )
  );
  assert.equal(out.hookSpecificOutput?.hookEventName, "PostToolUse");
  for (const text of [contextOf(out), out.systemMessage ?? ""]) {
    assert.match(text, /digests\/2026-08-17\.md/);
    assert.match(
      text,
      /weekStart:\n\s+before: 2026-08-03\n\s+after:  2026-08-04/
    );
  }
});

test("Post: URL の変化は増えた URL と減った URL だけを出す(Edit 側と同じ)", () => {
  const ctx = makeRepo();
  const out = roundTrip(ctx, () =>
    rewrite(ctx.root, DRAFT, "strategies/x", "strategies/y")
  );
  const context = contextOf(out);
  assert.match(context, /urls \(frontmatter block\):/);
  assert.match(context, /増えた: https:\/\/edu-evidence\.org\/strategies\/y\n/);
  assert.match(context, /減った: https:\/\/edu-evidence\.org\/strategies\/x\n/);
  // 変わっていない URL は並べない(1 文字の変化が埋もれる)
  assert.doesNotMatch(context, /www\.example\.go\.jp/);
});

/** Edit 側の Write の確認に出る保護値のキー(updatedAt と確かめられない旨は除く) */
function editWriteKeys(before, after) {
  const dir = path.join(tmp("bash-fm-edit-"), DIGESTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "x.md");
  fs.writeFileSync(p, before);
  const out = editGuard.run(
    JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: p, content: after },
    })
  );
  if (!out.stdout) return [];
  const reason = JSON.parse(out.stdout).hookSpecificOutput
    .permissionDecisionReason;
  const label = {
    "urls (frontmatter block)": "__urls__",
    "articleIds (in order)": "__articleIds__",
    "articleIds (word-bounded, in order)": "__articleIdsBounded__",
  };
  return [...reason.matchAll(/^ {2}([^\s].*?):$/gm)]
    .map((m) => label[m[1]] ?? m[1])
    .filter((k) => k !== "updatedAt")
    .sort();
}

test("保護値の差分(入れ子の title・記事 id の並び・重複の除去)が Edit 側の Write と一致する", () => {
  // Edit 側の Write はファイル全体を比べる(topLevelTitle は false)。true にすると、数値を含む
  // 入れ子の `relatedEvidenceUrls[].title` の変更を見落とす
  const cases = [
    ["根拠 3 件", "根拠 4 件", ["title"]],
    // 節の中の並べ替え: 旧来の並びは新しい並びから導けるので、重複として落とす
    [`${ID_A}, ${ID_B}`, `${ID_B}, ${ID_A}`, ["__articleIds__"]],
    // sourceId のハイフンの後ろだけ変える: 新しい並びだけが変わり、旧来の並びは落とす
    ["mext-press-2026", "mext-presz-2026", ["__articleIds__"]],
    // id の直後に `_` を足す: 旧来の並びだけが変わる
    [ID_A, `${ID_A}_x`, ["__articleIdsBounded__"]],
    ['weekEnd: "2026-08-09"', 'weekEnd: "2026-08-10"', ["weekEnd"]],
    ["strategies/x", "strategies/y", ["__urls__"]],
    ["本文 12.9%", "本文 13.9%", []],
  ];
  const future = DIGEST.replace("2026-08-10T07", "2099-08-10T07");
  for (const [from, to, expected] of cases) {
    const after = future.replace(from, to);
    assert.notEqual(after, future, from);
    const ours = guard
      .protectedDiffs(future, after)
      .map((d) => d.key)
      .sort();
    assert.deepEqual(ours, [...expected].sort(), `${from} → ${to}`);
    assert.deepEqual(ours, editWriteKeys(future, after), `${from} → ${to}`);
  }
});

test("Post: 新しく置いた号は「比較の対象なし」の 1 行を両方へ出す", () => {
  const ctx = makeRepo();
  const NEW = `${DIGESTS_DIR}/2026-08-24.md`;
  const out = roundTrip(ctx, () =>
    fs.copyFileSync(path.join(ctx.root, DRAFT), path.join(ctx.root, NEW))
  );
  for (const text of [contextOf(out), out.systemMessage ?? ""]) {
    assert.match(
      text,
      /^ {2}新しく置かれた号: src\/content\/digests\/2026-08-24\.md\(比較の対象なし\)$/m
    );
    // 保護値の before / after は並べない
    assert.doesNotMatch(text, /before:/);
  }
});

test("Post: origin/main と同じ中身の新しい号(pull で入った号)は黙り、中身が違えば 1 行出す", () => {
  const ctx = makeRepo();
  const PULLED = `${DIGESTS_DIR}/2026-08-24.md`;
  const body = DIGEST.replace("第 10 号", "第 12 号");
  // origin/main にだけある号を作る(作業ツリーからは消す)
  fs.writeFileSync(path.join(ctx.root, PULLED), body);
  git(ctx.root, "add", PULLED);
  git(ctx.root, "commit", "-q", "-m", "pulled");
  git(ctx.root, "update-ref", "refs/remotes/origin/main", "HEAD");
  fs.rmSync(path.join(ctx.root, PULLED));

  const pulled = roundTrip(ctx, () =>
    fs.writeFileSync(path.join(ctx.root, PULLED), body)
  );
  assert.deepEqual(pulled, {});

  fs.rmSync(path.join(ctx.root, PULLED));
  const edited = roundTrip(ctx, () =>
    fs.writeFileSync(path.join(ctx.root, PULLED), body.replace("要約", "概要"))
  );
  assert.match(
    contextOf(edited),
    /新しく置かれた号: src\/content\/digests\/2026-08-24\.md/
  );
});

test("Post: 公開済みの号が消えたら 1 行出し、未公開の号が消えても黙る(改名は消えた + 新しく置かれた)", () => {
  const ctx = makeRepo();
  const out = roundTrip(ctx, () =>
    fs.renameSync(
      path.join(ctx.root, PUB),
      path.join(ctx.root, `${DIGESTS_DIR}/2026-08-11.md`)
    )
  );
  for (const text of [contextOf(out), out.systemMessage ?? ""]) {
    assert.match(
      text,
      /^ {2}公開済みの号が消えた: src\/content\/digests\/2026-08-10\.md$/m
    );
    assert.match(
      text,
      /^ {2}新しく置かれた号: src\/content\/digests\/2026-08-11\.md/m
    );
  }

  const draft = roundTrip(ctx, () => fs.rmSync(path.join(ctx.root, DRAFT)));
  assert.deepEqual(draft, {});
});

/**
 * 号を 1 本置いた作業ツリー。mode は "main"(origin/main にある)・"branch"(origin/main に無い)・
 * "noOrigin"(git リポだが origin/main が無い)・"noGit"(git リポでない)
 */
function digestIn(mode, body) {
  const root = tmp("bash-fm-pub-");
  fs.mkdirSync(path.join(root, DIGESTS_DIR), { recursive: true });
  const p = path.join(root, PUB);
  fs.writeFileSync(p, body);
  if (mode !== "noGit") {
    git(root, "init", "-q");
    if (mode === "main") git(root, "add", ".");
    else {
      fs.writeFileSync(path.join(root, "README.md"), "x");
      git(root, "add", "README.md");
    }
    git(root, "commit", "-q", "-m", "x");
    if (mode !== "noOrigin")
      git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  }
  return { root, p };
}

test("公開済みの判定(ls-tree 1 回 + 代替)が Edit 側の isPublished と同じ表で一致する", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const past = DIGEST;
  const future = DIGEST.replace("2026-08-10T07", "2099-08-10T07");
  const broken = DIGEST.replace(/publishedAt: .*/, "publishedAt: 未定");
  const cases = [
    ["main", future, true],
    ["main", past, true],
    ["branch", past, false],
    ["branch", future, false],
    ["noOrigin", past, true],
    ["noOrigin", future, false],
    ["noGit", past, true],
    ["noGit", future, false],
    ["noGit", broken, false],
  ];
  for (const [mode, body, expected] of cases) {
    const { root, p } = digestIn(mode, body);
    const label = `${mode} / ${body === past ? "past" : body === future ? "future" : "broken"}`;
    assert.equal(editGuard.isPublished(p, body, now), expected, label);
    assert.equal(
      guard.isPublished(p, body, guard.mainBlobs(root), now),
      expected,
      label
    );
  }
});

const withUpdatedAt = (body, value) =>
  body.replace("summary: 要約", `updatedAt: "${value}"\nsummary: 要約`);
const editSummary = (body) =>
  body.replace("summary: 要約", "summary: 直した要約");

test("updatedAt の判定が Edit 側(Write と同じ入り方)と同じ表で一致し、消えたときだけ Bash 側が多く出す", () => {
  // Edit 側はディスクを読むので、控えの全文を一時ファイルに置いて当てる(git の外なので
  // 公開済みは publishedAt < 今 で決まる。DIGEST の publishedAt は過去)
  const noon = Date.parse("2026-09-17T03:00:00Z"); // JST 09-17 12:00
  const lateJst = Date.parse("2026-09-17T15:30:00Z"); // JST 09-18 00:30
  const earlyJst = Date.parse("2026-09-17T14:30:00Z"); // JST 09-17 23:30
  const older = withUpdatedAt(DIGEST, "2026-08-20T09:00:00+09:00");
  const cases = [
    ["書き忘れ", DIGEST, editSummary(DIGEST), noon, ["__updatedAt__"]],
    [
      "新しい値",
      DIGEST,
      editSummary(withUpdatedAt(DIGEST, "2026-09-17T10:00:00+09:00")),
      noon,
      [],
    ],
    [
      "publishedAt より前",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-08-01T10:00:00+09:00"),
      noon,
      ["__updatedAtInvalid__"],
    ],
    [
      "今日より後",
      DIGEST,
      withUpdatedAt(DIGEST, "2099-01-01T10:00:00+09:00"),
      noon,
      ["__updatedAtInvalid__"],
    ],
    [
      "オフセット無し",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-09-17T10:00:00"),
      noon,
      ["__updatedAtInvalid__"],
    ],
    [
      "日付だけ",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-09-17"),
      noon,
      ["__updatedAtInvalid__"],
    ],
    [
      "暦に無い",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-13-01T10:00:00+09:00"),
      noon,
      ["__updatedAtInvalid__"],
    ],
    [
      "控えの値が今日",
      withUpdatedAt(DIGEST, "2026-09-17T09:00:00+09:00"),
      editSummary(withUpdatedAt(DIGEST, "2026-09-17T09:00:00+09:00")),
      noon,
      [],
    ],
    ["控えの値が昨日以前", older, editSummary(older), noon, ["__updatedAt__"]],
    [
      "同じ値の書き直し",
      older,
      older.replace("要約", "要約。"),
      noon,
      ["__updatedAt__"],
    ],
    // JST の暦日の境界(控えの値: 09-18 00:30 JST)
    [
      "境界: 同じ日",
      withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00"),
      editSummary(withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00")),
      lateJst,
      [],
    ],
    [
      "境界: 前日",
      withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00"),
      editSummary(withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00")),
      earlyJst,
      ["__updatedAt__"],
    ],
    [
      "境界: 新しい値が今日",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00"),
      lateJst,
      [],
    ],
    [
      "境界: 新しい値が明日",
      DIGEST,
      withUpdatedAt(DIGEST, "2026-09-18T00:30:00+09:00"),
      earlyJst,
      ["__updatedAtInvalid__"],
    ],
  ];
  for (const [label, before, after, now, expected] of cases) {
    const { p } = digestIn("noGit", before);
    const edit = editGuard
      .evaluateUpdatedAt(p, "", after, now)
      .map((d) => d.key);
    const ours = guard.updatedAtProblems(before, after, now).map((d) => d.key);
    assert.deepEqual(edit, expected, `Edit 側: ${label}`);
    assert.deepEqual(ours, expected, `Bash 側: ${label}`);
  }

  // 控えにあった updatedAt が消えた: Edit 側の Write は控えの値が今日なら通すが、Bash 側は出す
  const today = withUpdatedAt(DIGEST, "2026-09-17T09:00:00+09:00");
  for (const [label, before] of [
    ["今日", today],
    ["昨日以前", older],
  ]) {
    const ours = guard.updatedAtProblems(before, DIGEST, noon);
    assert.deepEqual(
      ours.map((d) => d.key),
      ["__updatedAtRemoved__"],
      label
    );
  }
  const { p } = digestIn("noGit", today);
  assert.deepEqual(editGuard.evaluateUpdatedAt(p, "", DIGEST, noon), []);
});

test("Post: 公開済みの号を updatedAt 無しで変えると両方へ出し、未公開の号と updatedAt を今日にした変更は黙る", () => {
  const now = Date.parse("2026-09-17T03:00:00Z");
  const ctx = makeRepo();
  const out = roundTrip(
    ctx,
    () => rewrite(ctx.root, PUB, "summary: 要約", "summary: 直した要約"),
    { now }
  );
  for (const text of [contextOf(out), out.systemMessage ?? ""]) {
    assert.match(text, /src\/content\/digests\/2026-08-10\.md updatedAt:/);
    assert.match(
      text,
      /この Bash 以外\(並行セッション・Edit\)の変化を含みうる/
    );
    assert.match(text, /自分のコマンドが書いたかを確かめてから直す/);
  }

  const draft = roundTrip(
    ctx,
    () => rewrite(ctx.root, DRAFT, "summary: 要約", "summary: 直した要約"),
    { now }
  );
  assert.deepEqual(draft, {});

  const fixed = roundTrip(
    ctx,
    () =>
      rewrite(
        ctx.root,
        PUB,
        "summary: 直した要約",
        'updatedAt: "2026-09-17T10:00:00+09:00"\nsummary: もう一度直した要約'
      ),
    { now }
  );
  // updatedAt の行を足したことは roundtrip(Claude だけ)に数値として出るが、updatedAt の指摘は出ない
  assert.equal(fixed.systemMessage, undefined);
  assert.doesNotMatch(contextOf(fixed), /updatedAt:/);
});

test("Post: origin/main と同じ中身に戻った号は、保護値に注記を添え、updatedAt と roundtrip を出さない", () => {
  const ctx = makeRepo();
  // 作業ツリーで書き換えてあった公開済みの号を、Bash で origin/main の中身に戻す
  rewrite(ctx.root, PUB, 'weekStart: "2026-08-03"', 'weekStart: "2026-08-02"');
  rewrite(ctx.root, PUB, "本文 12.9%", "本文 13.9%");
  const out = roundTrip(ctx, () =>
    git(ctx.root, "checkout", "origin/main", "--", PUB)
  );
  const context = contextOf(out);
  assert.match(
    context,
    /weekStart:\n\s+before: 2026-08-02\n\s+after:  2026-08-03/
  );
  assert.match(
    context,
    /origin\/main と同じ内容になった\(取り込み・切り替えの可能性\)/
  );
  assert.match(out.systemMessage ?? "", /origin\/main と同じ内容になった/);
  assert.doesNotMatch(context, /updatedAt/);
  assert.doesNotMatch(context, /\[roundtrip\]/);
});

test("Post: roundtrip は変わった範囲どうしで比べ(同じ数値が別の場所にあっても出す)、Claude にだけ出す", () => {
  // summary にも 12.9 があるので、ファイル全体の集合で比べると「12.9 → 36.2」は差が出ない
  const ctx = makeRepo();
  const out = roundTrip(ctx, () =>
    rewrite(ctx.root, DRAFT, "本文 12.9% と 36.2%", "本文 36.2% と 36.2%")
  );
  assert.match(
    contextOf(out),
    /\[roundtrip\] Tracked tokens changed in src\/content\/digests\/2026-08-17\.md:\n {2}- number: 12\.9\n/
  );
  assert.equal(out.systemMessage, undefined);
});

test("PostToolUseFailure: 失敗したコマンドの途中の書き換えも、roundtrip を含めて出す", () => {
  const ctx = makeRepo();
  const out = roundTrip(
    ctx,
    () => {
      rewrite(
        ctx.root,
        DRAFT,
        'weekEnd: "2026-08-09"',
        'weekEnd: "2026-08-08"'
      );
      // 範囲は weekEnd から本文までの 1 つになる。範囲の中に他に無い数値に変える
      rewrite(ctx.root, DRAFT, "と 36.2%", "と 37.2%");
    },
    { event: "PostToolUseFailure" }
  );
  assert.equal(out.hookSpecificOutput?.hookEventName, "PostToolUseFailure");
  assert.match(contextOf(out), /weekEnd:/);
  assert.match(contextOf(out), /\[roundtrip\]/);
  assert.match(out.systemMessage ?? "", /weekEnd:/);
  assert.doesNotMatch(out.systemMessage ?? "", /\[roundtrip\]/);
});

test("出力: 9000 字で切り詰めても、先頭の件数とファイル一覧は残る", () => {
  const ctx = makeRepo();
  const names = [];
  for (let i = 0; i < 12; i++) {
    const rel = `${DIGESTS_DIR}/2026-09-${String(i + 10).padStart(2, "0")}.md`;
    fs.writeFileSync(path.join(ctx.root, rel), DRAFT_BODY);
    names.push(rel);
  }
  const long = "長".repeat(1000);
  const out = roundTrip(ctx, () => {
    for (const rel of names)
      rewrite(ctx.root, rel, "title: 第 11 号", `title: 第 11 号 ${long}`);
  });
  for (const text of [contextOf(out), out.systemMessage ?? ""]) {
    assert.ok(text.length <= 9000, `${text.length} 字`);
    assert.match(text, /\.\.\.\(truncated\)$/);
    const [heading, list] = text.split("\n");
    assert.match(
      heading,
      /^\[bash-frontmatter-guard\] 12 change\(s\) in 12 digest file\(s\)/
    );
    for (const rel of names) assert.ok(list.includes(rel), rel);
  }
});

test("Post: 既存の worktree の中の書き換えと新しい号も出す", () => {
  const ctx = makeRepo();
  const wt = path.join(ctx.root, ".claude", "worktrees", "w1");
  git(ctx.root, "worktree", "add", "-q", wt, "-b", "w1");
  const out = roundTrip(ctx, () => {
    rewrite(wt, PUB, 'weekEnd: "2026-08-09"', 'weekEnd: "2026-08-07"');
    fs.writeFileSync(path.join(wt, DRAFT), DRAFT_BODY);
  });
  const context = contextOf(out);
  assert.match(
    context,
    /worktrees\/w1\/src\/content\/digests\/2026-08-10\.md weekEnd:/
  );
  assert.match(
    context,
    /新しく置かれた号: \.claude\/worktrees\/w1\/src\/content\/digests\/2026-08-17\.md/
  );
});

test("Post: Bash で作った worktree・外した worktree の号は数えず、同時の本物の変化は出す", () => {
  // メインは `.claude/worktrees/*` の接頭辞でもある。前方一致で帰属を決めると、新しい
  // worktree の全ファイルがメインの新規ファイルに化け、本物の変化が切り詰めの外に落ちる
  const ctx = makeRepo();
  // 新しい worktree の号が origin/main と同じ中身だと「pull で入った号」として黙り、帰属の判定を
  // 素通りしても赤にならない。origin/main に無い号をコミットしてから worktree を作る
  git(ctx.root, "add", DRAFT);
  git(ctx.root, "commit", "-q", "-m", "draft");
  const old = path.join(ctx.root, ".claude/worktrees/old");
  git(ctx.root, "worktree", "add", "-q", old, "-b", "old");
  const out = roundTrip(ctx, () => {
    git(
      ctx.root,
      "worktree",
      "add",
      "-q",
      path.join(ctx.root, ".claude/worktrees/new"),
      "-b",
      "new"
    );
    git(ctx.root, "worktree", "remove", old);
    rewrite(ctx.root, DRAFT, 'weekEnd: "2026-08-09"', 'weekEnd: "2026-08-06"');
  });
  const context = contextOf(out);
  assert.match(
    context,
    /^\[bash-frontmatter-guard\] 1 change\(s\) in 1 digest file\(s\)/
  );
  assert.match(
    context,
    /^ {2}src\/content\/digests\/2026-08-17\.md weekEnd:$/m
  );
  assert.doesNotMatch(context, /worktrees\/(new|old)/);
});

// --- 控えの置き場と印 ------------------------------------------------------

test("控えの置き場は os.tmpdir()/edu-watch-fm-guard で、姉妹リポの同名ガードと違う", () => {
  // ディスパッチャ経由では全ガードが同じ session_id・tool_use_id で走る。置き場を写したままに
  // すると互いの控えを消し、検出が黙って消える
  assert.equal(
    guard.DEFAULT_STATE_DIR,
    path.join(os.tmpdir(), "edu-watch-fm-guard")
  );
  for (const sibling of ["edu-law-fm-guard", "edu-evidence-fm-guard"])
    assert.notEqual(path.basename(guard.DEFAULT_STATE_DIR), sibling);
});

test("Post: Pre の控えが無ければ、照合できなかったことを両方へ出す", () => {
  const ctx = makeRepo();
  for (const event of ["PostToolUse", "PostToolUseFailure"]) {
    const out = parsed(call(ctx, event, "toolu_never_pre"));
    assert.match(out.systemMessage ?? "", /not verified/, event);
    assert.match(contextOf(out), /not verified/, event);
  }
});

test("二重に走った Pre / Post では、どちらの Post も照合して警告せず、控えと印を残さない", () => {
  // このリポの配線とユーザー環境のディスパッチャの両方が同じ Bash でこのガードを走らせる
  // 経路がある。1 本目の Post が控えを消すと、2 本目が「not verified」と誤って警告する
  const ctx = makeRepo();
  for (const [i, event] of ["PostToolUse", "PostToolUseFailure"].entries()) {
    call(ctx, "PreToolUse");
    call(ctx, "PreToolUse");
    rewrite(
      ctx.root,
      DRAFT,
      /weekEnd: "[\d-]+"/,
      `weekEnd: "2026-08-0${i + 1}"`
    );
    for (const n of [1, 2]) {
      const out = parsed(call(ctx, event));
      assert.doesNotMatch(
        out.systemMessage ?? "",
        /not verified|could not verify/,
        `${event} #${n}`
      );
      assert.match(contextOf(out), /weekEnd/, `${event} #${n}`);
    }
    assert.deepEqual(fs.readdirSync(ctx.stateDir), [], event);
  }
});

test("Pre が 1 本で Post が 2 本なら、2 本目は照合できなかったことを出す", () => {
  const ctx = makeRepo();
  call(ctx, "PreToolUse");
  assert.doesNotMatch(
    parsed(call(ctx, "PostToolUse")).systemMessage ?? "",
    /not verified/
  );
  assert.match(
    parsed(call(ctx, "PostToolUse")).systemMessage ?? "",
    /not verified/
  );
});

test("同時に走る 2 本の Post も、どちらも照合して控えと印を残さない", async () => {
  // 印を unlink で取ると、同時の 2 本がどちらも成功して同じ印を取り、控えが残る(APFS で実測)
  const ctx = makeRepo();
  const script = [
    "const [guardPath, root, stateDir, at] = process.argv.slice(1);",
    "let d = '';",
    "process.stdin.on('data', (c) => (d += c)).on('end', () => {",
    "  while (Date.now() < Number(at));",
    "  const out = require(guardPath).run(d, { root, stateDir });",
    "  process.stdout.write(out.stdout || '');",
    "});",
  ].join("\n");
  const input = JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "sess-1",
    tool_use_id: "toolu_01",
    tool_name: "Bash",
    tool_input: { command: "true" },
  });
  const post = (at) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["-e", script, GUARD_PATH, ctx.root, ctx.stateDir, String(at)],
        { stdio: ["pipe", "pipe", "inherit"] }
      );
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("close", () => resolve(out));
      child.stdin.end(input);
    });
  const problems = [];
  // 60 回: 順序の変異(控えを読む前に印を取る・控えの unlink の ENOENT を許さない)は確率的にしか
  // 表に出ない。回数は edu-law の同じテストの実測に合わせた
  for (let i = 0; i < 60; i++) {
    call(ctx, "PreToolUse");
    call(ctx, "PreToolUse");
    const at = Date.now() + 150;
    const outs = await Promise.all([post(at), post(at)]);
    for (const out of outs)
      if (/not verified|could not verify/.test(out))
        problems.push(`${i}: ${out}`);
    const left = fs.readdirSync(ctx.stateDir);
    if (left.length) problems.push(`${i}: ${left.join(", ")}`);
    for (const name of left) fs.rmSync(path.join(ctx.stateDir, name));
  }
  assert.deepEqual(problems, []);
});

test("Pre: tool_use_id が不正な形なら控えを取らずに警告する", () => {
  const ctx = makeRepo();
  const out = parsed(call(ctx, "PreToolUse", "../../etc/x"));
  assert.match(out.systemMessage ?? "", /malformed/);
  assert.equal(fs.existsSync(ctx.stateDir), false);
});

test("Pre: 状態置き場が他人に開いている・symlink なら控えを取らずに警告する", () => {
  const loose = makeRepo();
  fs.mkdirSync(loose.stateDir, { mode: 0o755 });
  fs.chmodSync(loose.stateDir, 0o755);
  assert.match(
    parsed(call(loose, "PreToolUse")).systemMessage ?? "",
    /accessible by others/
  );
  assert.deepEqual(fs.readdirSync(loose.stateDir), []);

  const linked = makeRepo();
  const target = tmp("bash-fm-target-");
  fs.symlinkSync(target, linked.stateDir);
  assert.match(
    parsed(call(linked, "PreToolUse")).systemMessage ?? "",
    /not a directory/
  );
  assert.deepEqual(fs.readdirSync(target), []);
});

test("Pre: 1 日より古い控えの残骸を消す(権限拒否では Post が発火しない)", () => {
  const ctx = makeRepo();
  const age = (id, ms) => {
    const at = new Date(Date.now() - ms);
    for (const name of [`sess-1-${id}.json`, `sess-1-${id}.t0`])
      fs.utimesSync(path.join(ctx.stateDir, name), at, at);
  };
  call(ctx, "PreToolUse", "toolu_old");
  age("toolu_old", 25 * 60 * 60 * 1000);
  call(ctx, "PreToolUse", "toolu_recent");
  age("toolu_recent", 23 * 60 * 60 * 1000);
  call(ctx, "PreToolUse", "toolu_new");
  assert.deepEqual(fs.readdirSync(ctx.stateDir).sort(), [
    "sess-1-toolu_new.json",
    "sess-1-toolu_new.t0",
    "sess-1-toolu_recent.json",
    "sess-1-toolu_recent.t0",
  ]);
});

// --- 時間予算と CLI 配線 --------------------------------------------------
//
// settings.json の `timeout: 5`(秒)を超えると kill され、stdout が出ない = 素通りする。
// Pre と Post はそれぞれ全 worktree の digest の全文を読むので、実データで測る。

test("実データの控えが 500ms に収まり、抽出は長い空白でも線形にとどまる", () => {
  const started = process.hrtime.bigint();
  const { snapshot } = guard.takeSnapshot(REPO);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  // digest 30 本(2026-11-18)。worktree があれば増える
  assert.ok(Object.keys(snapshot.files).length >= 30);
  assert.ok(ms < 500, `控えに ${ms.toFixed(0)}ms かかった`);

  // 抽出の正規表現が二次挙動に戻ると、空白 32KB で数秒かかる(Edit 側ガードの実測)
  for (const input of [
    " ".repeat(32 * 1024),
    `title: a${" ".repeat(32 * 1024)}b`,
  ]) {
    const t0 = process.hrtime.bigint();
    guard.captureProtectedFields(input);
    const t = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(t < 500, `${input.length} 字に ${t.toFixed(0)}ms かかった`);
  }
});

const runCli = (payload) =>
  spawnSync(process.execPath, [GUARD_PATH], {
    input: payload,
    encoding: "utf8",
  });

test("CLI: 壊れた入力・Bash 以外でも 0 で終わり、Pre → Post の往復で控えを残さない", () => {
  for (const payload of [
    "{not json",
    "",
    JSON.stringify({ tool_name: "Edit" }),
  ]) {
    const res = runCli(payload);
    assert.equal(res.status, 0, payload);
    assert.equal(res.stdout, "", payload);
  }
  // 既定の置き場と、このリポ自身を対象に走らせる(id はこのテストだけのもの)
  const ids = {
    session_id: `test-${process.pid}`,
    tool_use_id: `toolu_${Date.now()}`,
  };
  const payload = (event) =>
    JSON.stringify({
      hook_event_name: event,
      tool_name: "Bash",
      tool_input: { command: "true" },
      ...ids,
    });
  const pre = runCli(payload("PreToolUse"));
  assert.equal(pre.status, 0);
  assert.equal(pre.stdout, "", pre.stdout);
  const post = runCli(payload("PostToolUse"));
  assert.equal(post.status, 0);
  assert.doesNotMatch(post.stdout, /not verified|could not/);
  assert.equal(
    fs.existsSync(
      path.join(
        guard.DEFAULT_STATE_DIR,
        `${ids.session_id}-${ids.tool_use_id}.json`
      )
    ),
    false
  );
});
