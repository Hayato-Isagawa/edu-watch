#!/usr/bin/env node
/**
 * PreToolUse / PostToolUse / PostToolUseFailure hook (Bash) — digest guard for Bash.
 *
 * pre-edit-frontmatter-immutable.cjs と post-edit-roundtrip-spot-check.cjs は Edit / Write /
 * MultiEdit しか見ない。digest(src/content/digests/*.md|mdx)への書き込みは実際には Bash
 * (cp・`sed > 新ファイル`・python)で行われていて、Edit 側の 2 本は働いていなかった。
 * 本ガードは同じ判定を Bash の前後に当て、事後に知らせる(止めない)。
 * 姉妹リポ edu-law の同名ガードの骨組みを写し、コマンド文字列で判定する事前 ask は持ち込まない
 * (digest への書き込みはすべて Bash なので、書くたびに確認が出て止まる)。
 *
 *   - PreToolUse: 全 worktree の digest の全文を控える
 *   - PostToolUse / PostToolUseFailure: 変わった号ごとに、控えと今の全文に
 *     保護値の差(Edit 側の Write と同じ)・公開済みの号の updatedAt(Edit 側と同じ規則 +
 *     消えたとき)・roundtrip(変わった範囲どうしのトークンの差)を当てる。新しく置かれた号と
 *     消えた公開済みの号は 1 行ずつ出す。roundtrip は Claude にだけ、それ以外は Claude と
 *     ユーザーの両方に出す
 *   - 公開済みかどうか・origin/main と同じ中身かどうかは、`git ls-tree origin/main` を 1 回呼び、
 *     blob の SHA-1 をこの中で計算して比べる。origin/main と同じ中身の号(pull・
 *     `git checkout origin/main -- …`)では updatedAt と roundtrip を出さない
 *
 * `~` 起点のセッションではこのリポの settings.json が読まれない。その経路では、ユーザー環境の
 * グローバルなディスパッチャがこのファイルを呼ぶ。require を組み込みに限っているのは、
 * ディスパッチャの sha256 ピンが実行する 1 ファイルしか照合しないため。Edit 側の 2 本の定義は
 * 複製で、一致はテストが宣言の文字列・実データ全件・同じ表の入力で固定している。
 *
 * 既知の限界:
 *   - Post が発火しない経路(権限拒否。ユーザーによる中断では PostToolUse は発火しない)では
 *     照合しない
 *   - Post が書き換えの完了前に走る経路(run_in_background・タイムアウトによる自動
 *     バックグラウンド化)では照合が空振りし、次の Bash の Pre が書き換え後を控えるので、
 *     その変化は以後どこにも出ない。事前 ask を持たないので、この経路の守りは無い
 *   - 並列の tool call・別セッションの編集・git の切り替え(origin/main 以外への切り替え・
 *     stash を含む)による変化も、その Bash の変化として出る(安全側の誤報)
 *   - roundtrip の「変わった範囲」は最初に変わった行から最後に変わった行までの 1 つ。1 回の
 *     Bash で離れた 2 か所を変えると間の行も範囲に入り、その間に同じ値がある数値・URL の
 *     変化は見落とす
 *   - 公開済みの判定は最終 fetch 時点の origin/main による(Edit 側と同じ)。blob の比較は
 *     作業ツリーのバイト列そのもので、git の変換(autocrlf・.gitattributes の filter)が
 *     掛かる設定では pull で入った号も「新しく置かれた号」に出る(安全側)
 *   - 同じ Bash の中で作った worktree の号は、帰属の判定で丸ごと飛ばす。その worktree の中の
 *     書き換えは公開済みの号の保護値でも出ず、次の Pre が書き換え後を控えるので以後も出ない
 *   - 記事データ(src/data/articles)の変化で digest の意味が変わる場合は見ない(Edit 側も見ない)
 *   - 事後なので取り消しはしない
 *   - 同じ Bash でこのガードが二重に走る(このリポの配線とユーザー環境のディスパッチャ)と、
 *     変化は Post ごとに 2 回出る。Pre だけが二重に走ると控えと印が残り、1 日より古くなると
 *     次の Pre が消す
 *   - 何が起きても exit 0。ディスパッチャ経由では exit 2 が全 Bash の停止になるため、
 *     失敗は systemMessage の警告で知らせる
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

// ここから extractTokens までは Edit 側の 2 本の複製(定義の理由は向こうのコメントにある)。
// 一致はテストが宣言の文字列と、実データ全件・作り物の入力の抽出結果で固定している。
const PROTECTED_KEYS = ["title", "weekStart", "weekEnd", "publishedAt"];

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;
const ARTICLE_ID_WORD_RE = /\b[a-z0-9]+(?:-+[a-z0-9]+)*/g;
const ARTICLE_ID_TAIL_RE = /-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/;
const ARTICLE_ID_BOUNDED_RE = /\b[a-z0-9]+-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}\b/g;

const UPDATED_AT_RE = /^[ \t]*updatedAt:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m;
const PUBLISHED_AT_RE =
  /^[ \t]*publishedAt:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m;
const ISO_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const DOI_RE = /\b10\.\d{4,9}\/[^\s)>"']+/gi;
const DP_ID_RE = /\bDP\d{2}-\d+\b/gi;
const EFFECT_SIZE_RE = /\b(?:cohen'?s\s*)?[dgr]\s*=\s*-?\d+\.\d+\b/gi;
const NUMBER_RE = /\b\d[\d.,]*\d\b/g;

const KINDS = ["number", "url", "doi", "dp_id", "effect_size"];

function extractFrontmatter(s) {
  if (!s) return null;
  const m = s.match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

function valueAfterColon(rest) {
  if (!rest) return null;
  const isBlank = (c) => c === " " || c === "\t";
  let i = 0;
  while (i < rest.length && isBlank(rest[i])) i++;
  if (i === rest.length) return rest[rest.length - 1];
  let j = rest.length;
  while (j > i && isBlank(rest[j - 1])) j--;
  return rest.slice(i, j);
}

// Edit 側の `topLevelTitle` は渡さない(false と同じ)。ファイル全体を比べる Edit 側の Write と同じで、
// true にすると relatedEvidenceUrls の入れ子の `title:` の変更を見落とす
function captureProtectedFields(fm) {
  if (!fm) return new Map();
  const map = new Map();
  for (const key of PROTECTED_KEYS) {
    const re = new RegExp(`^[ \\t]*(?:-[ \\t]*)?${key}:(.*)$`, "gm");
    const values = [];
    for (const m of fm.matchAll(re)) {
      const v = valueAfterColon(m[1]);
      if (v !== null) values.push(v.replace(/^["']|["']$/g, ""));
    }
    if (values.length) map.set(key, values);
  }
  const ids = (fm.match(ARTICLE_ID_WORD_RE) || []).filter((w) =>
    ARTICLE_ID_TAIL_RE.test(w)
  );
  if (ids.length) map.set("__articleIds__", ids);
  const bounded = fm.match(ARTICLE_ID_BOUNDED_RE) || [];
  if (bounded.length) map.set("__articleIdsBounded__", bounded);
  const urls = (fm.match(URL_RE) || []).map((x) => x.trim());
  if (urls.length) map.set("__urls__", urls.sort());
  return map;
}

function extractTokens(s) {
  const src = String(s ?? "");
  const dpIds = src.match(DP_ID_RE) || [];
  const stripped = src.replace(DP_ID_RE, " ");
  return {
    number: new Set((stripped.match(NUMBER_RE) || []).map((x) => x.trim())),
    url: new Set((src.match(URL_RE) || []).map((x) => x.trim())),
    doi: new Set((src.match(DOI_RE) || []).map((x) => x.trim())),
    dp_id: new Set(dpIds.map((x) => x.trim())),
    effect_size: new Set(
      (src.match(EFFECT_SIZE_RE) || []).map((x) => x.trim().toLowerCase())
    ),
  };
}

function diffMaps(beforeM, afterM) {
  const allKeys = new Set([...beforeM.keys(), ...afterM.keys()]);
  const diffs = [];
  for (const key of allKeys) {
    const before = beforeM.get(key) ?? [];
    const after = afterM.get(key) ?? [];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push({ key, before, after });
    }
  }
  return diffs;
}

function boundedFollowsIds(m) {
  const derived = (m.get("__articleIds__") ?? []).flatMap(
    (w) => w.match(ARTICLE_ID_BOUNDED_RE) ?? []
  );
  return (
    JSON.stringify(derived) ===
    JSON.stringify(m.get("__articleIdsBounded__") ?? [])
  );
}

/** 控えと今の全文の保護値の差。Edit 側の Write(evaluatePair)と同じ窓・同じ重複の除去 */
function protectedDiffs(beforeText, afterText) {
  const before = captureProtectedFields(
    extractFrontmatter(beforeText) ?? beforeText
  );
  const after = captureProtectedFields(
    extractFrontmatter(afterText) ?? afterText
  );
  const diffs = diffMaps(before, after);
  if (boundedFollowsIds(before) && boundedFollowsIds(after)) {
    return diffs.filter((d) => d.key !== "__articleIdsBounded__");
  }
  return diffs;
}

// --- 事後照合: Pre で全文を控え、Post / PostToolUseFailure で比べる ------------

const DIGEST_FILE_RE = /\.(md|mdx)$/i;
const DIGESTS_DIR = "src/content/digests";

// 姉妹リポの同名ガード(edu-law-fm-guard・edu-evidence-fm-guard)と分ける。ディスパッチャ経由では
// 全ガードが同じ session_id・tool_use_id で走るので、同じ置き場だと互いの控えを消す
const DEFAULT_STATE_DIR = path.join(os.tmpdir(), "edu-watch-fm-guard");
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const STALE_MS = 24 * 60 * 60 * 1000;
const MESSAGE_LIMIT = 9000;

const gitEnv = () => ({
  PATH: process.env.PATH || "",
  HOME: os.homedir(),
  GIT_OPTIONAL_LOCKS: "0",
});

/**
 * 照合する worktree の一覧。メインだけでなく `.claude/worktrees/*` などの
 * worktree の中の書き換えも拾う。git が失敗したらメインだけを見て警告する。
 */
function listWorktrees(root) {
  const res = spawnSync(
    "git",
    ["-C", root, "worktree", "list", "--porcelain"],
    { encoding: "utf8", timeout: 2000, env: gitEnv() }
  );
  if (res.status !== 0) {
    return {
      roots: [root],
      warning: `git worktree list failed (${res.error?.code || `status ${res.status}`}); checked ${root} only.`,
    };
  }
  const roots = [...res.stdout.matchAll(/^worktree (.+)$/gm)].map((m) => m[1]);
  return { roots: roots.length ? roots : [root] };
}

const readText = (abs) => {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

/** 全 worktree の digest の全文。キーは絶対パス */
function takeSnapshot(root) {
  const { roots, warning } = listWorktrees(root);
  const files = {};
  for (const wt of roots) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(wt, DIGESTS_DIR));
    } catch {
      // 消えた worktree・digest の無いブランチ
    }
    for (const name of names) {
      if (!DIGEST_FILE_RE.test(name)) continue;
      const abs = path.join(wt, DIGESTS_DIR, name);
      const text = readText(abs);
      if (text !== null) files[abs] = text;
    }
  }
  return { snapshot: { worktrees: roots, files }, warning };
}

/** 自分だけが読み書きできるディレクトリであることを確かめる。満たさなければ throw */
function ensureStateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid())
    throw new Error(`${dir} is owned by another user`);
  if (st.mode & 0o077) throw new Error(`${dir} is accessible by others`);
}

function removeStale(dir, now) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      if (now - fs.lstatSync(p).mtimeMs > STALE_MS) fs.unlinkSync(p);
    } catch {
      // 並行するセッションが先に消した
    }
  }
}

function snapshotPath(dir, input) {
  const session = String(input?.session_id ?? "");
  const toolUse = String(input?.tool_use_id ?? "");
  if (!ID_RE.test(session) || !ID_RE.test(toolUse)) return null;
  return path.join(dir, `${session}-${toolUse}.json`);
}

function saveSnapshot(dir, input, root, now) {
  const p = snapshotPath(dir, input);
  if (!p)
    return {
      warning:
        "session_id / tool_use_id missing or malformed; not snapshotted.",
    };
  ensureStateDir(dir);
  removeStale(dir, now);
  const { snapshot, warning } = takeSnapshot(root);
  const body = JSON.stringify(snapshot);
  try {
    fs.writeFileSync(p, body, { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    fs.unlinkSync(p);
    fs.writeFileSync(p, body, { flag: "wx", mode: 0o600 });
  }
  addTicket(p);
  return { warning };
}

// --- 控えの印 ------------------------------------------------------------
//
// 同じ Bash でこのガードが二重に走る経路がある(このリポの配線とユーザー環境のディスパッチャ)。
// Pre は走るたびに印 `<控え>.t<k>` を 1 つ作り、Post は控えを読んでから印を 1 つ取る。
// 印が残っていれば控えは消さない(まだ読む Post がいる)。これが無いと 1 本目の Post が控えを
// 消し、2 本目が「not verified」と誤って警告する。
//
// 印は rename で取る。同じパスへの同時の unlink は APFS で両方とも成功を返す(実測)ので、
// unlink では取り合いの勝者が決まらない。rename は片方だけが成功する。

const TICKET_LIMIT = 16;

const ticketBase = (p) => p.slice(0, -".json".length);

function addTicket(p) {
  for (let k = 0; k < TICKET_LIMIT; k++) {
    try {
      fs.writeFileSync(`${ticketBase(p)}.t${k}`, "", {
        flag: "wx",
        mode: 0o600,
      });
      return;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
  }
}

/** まだ取られていない印のパス */
function openTickets(p) {
  const prefix = `${path.basename(ticketBase(p))}.t`;
  return fs
    .readdirSync(path.dirname(p))
    .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))
    .map((n) => path.join(path.dirname(p), n));
}

/** 印を 1 つ取る。取れる印が無ければ何もしない */
function takeTicket(p) {
  for (const t of openTickets(p)) {
    const taken = `${t}.c${process.pid}`;
    try {
      fs.renameSync(t, taken);
    } catch (e) {
      if (e?.code === "ENOENT") continue; // 別の Post が先に取った
      throw e;
    }
    fs.unlinkSync(taken);
    return;
  }
}

/**
 * 控えを読み、印を 1 つ取る。印が残っていなければ控えを消す。無ければ null。
 * 読んでから取るので、控えを消すのは最後に取った Post で、そのとき他の Post は読み終えている。
 * 最後の 2 本がどちらも「残り 0」を見ることはあるので、控えの unlink の ENOENT は許す。
 */
function loadSnapshot(dir, input) {
  const p = snapshotPath(dir, input);
  if (!p) return null;
  let body;
  try {
    if (!fs.lstatSync(p).isFile()) return null;
    body = fs.readFileSync(p, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
  takeTicket(p);
  if (openTickets(p).length === 0) {
    try {
      fs.unlinkSync(p);
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
    }
  }
  return JSON.parse(body);
}

// --- origin/main との照合 ---------------------------------------------------
//
// 公開済み = origin/main に同じファイル名の号がある(Edit 側の isPublished と同じ定義)。
// Edit 側はファイルごとに `git cat-file` を起動するが、ここでは変わった号が多くても 1 回で済む
// よう `git ls-tree` を 1 回だけ呼び、ファイルの blob の SHA-1 をこの中で計算して比べる。
// origin/main は全 worktree で共有なので、どの worktree の号も同じ一覧で引ける。

/** origin/main の digest のファイル名 → blob の SHA-1。git が答えないときは null */
function mainBlobs(root) {
  const res = spawnSync(
    "git",
    ["-C", root, "ls-tree", "-z", "origin/main", `${DIGESTS_DIR}/`],
    { encoding: "utf8", timeout: 2000, env: gitEnv() }
  );
  if (res.status !== 0) return null;
  const blobs = new Map();
  for (const entry of res.stdout.split("\0")) {
    const m = entry.match(/^\d+ blob ([0-9a-f]{40,64})\t(.+)$/);
    if (m) blobs.set(path.posix.basename(m[2]), m[1]);
  }
  return blobs;
}

/** 作業ツリーのファイルの git の blob の SHA-1(`git hash-object` と同じ)。読めなければ null */
function blobSha(abs) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return null;
  }
  return crypto
    .createHash("sha1")
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest("hex");
}

// --- roundtrip: 変わった範囲どうしのトークンの差 ------------------------------
//
// ファイル全体の集合で比べると、同じ数値がファイル内の別の場所にもあるため、数値の変更を
// 見落とす。控えと今の全文から共通の先頭行と末尾行を削った範囲どうしで比べる(Edit の断片に近い)。

/** 共通の先頭行と末尾行を削った、控えと今の「変わった範囲」 */
function changedRange(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++;
  return [
    x.slice(head, x.length - tail).join("\n"),
    y.slice(head, y.length - tail).join("\n"),
  ];
}

// ここから describeRoundtrip までは post-edit-roundtrip-spot-check.cjs の diffTokens / 表示の複製
function diffTokens(beforeS, afterS) {
  const before = extractTokens(beforeS);
  const after = extractTokens(afterS);
  const result = [];
  for (const k of KINDS) {
    const added = [...after[k]].filter((x) => !before[k].has(x));
    const removed = [...before[k]].filter((x) => !after[k].has(x));
    if (added.length || removed.length) {
      result.push({ kind: k, added, removed });
    }
  }
  return result;
}

function fmtList(items) {
  if (!items.length) return "∅";
  const head = items.slice(0, 4).join(", ");
  const tail = items.length > 4 ? ` (+${items.length - 4} more)` : "";
  return head + tail;
}

function describeRoundtrip({ file, tokens }, root) {
  const rel = path.relative(root, file);
  const lines = [
    `[roundtrip] Tracked tokens changed in ${rel.startsWith("..") ? file : rel}:`,
  ];
  for (const d of tokens) {
    if (d.added.length) lines.push(`  + ${d.kind}: ${fmtList(d.added)}`);
    if (d.removed.length) lines.push(`  - ${d.kind}: ${fmtList(d.removed)}`);
  }
  lines.push(
    "",
    "Before continuing, briefly state which source article supports each",
    "numeric or URL change. If unsure, ask the user before further edits."
  );
  return lines.join("\n");
}

// --- 照合と表示 ------------------------------------------------------------

/** 控えと今の全文を比べ、ファイルごとの所見を返す */
function compareSnapshots(before, after, root, now) {
  const findings = [];
  const roundtrips = [];
  // ls-tree は何かが変わったときだけ呼ぶ(変化の無い Bash で git を起動しない)
  let blobs;
  const main = () => (blobs === undefined ? (blobs = mainBlobs(root)) : blobs);
  const sameAsMain = (abs) => {
    const sha = main()?.get(path.basename(abs));
    return sha !== undefined && sha === blobSha(abs);
  };
  for (const [abs, text] of Object.entries(after.files)) {
    const prev = before.files[abs];
    if (prev === undefined) {
      // 帰属は最長一致で決める。メインは `.claude/worktrees/*` の接頭辞でもあるので、
      // 前方一致だけだと、Bash で作った worktree の全ファイルがメインの新規ファイルに化ける
      const owner = ownerOf(abs, after.worktrees);
      if (!owner || !before.worktrees.includes(owner)) continue;
      // origin/main と同じ中身(pull・origin/main からの取り出しで入った号)は黙る
      if (!sameAsMain(abs))
        findings.push({ file: abs, kind: "added", diffs: [] });
      continue;
    }
    if (prev === text) continue;
    const same = sameAsMain(abs);
    const diffs = protectedDiffs(prev, text);
    const updatedAt =
      !same && isPublished(abs, prev, main(), now)
        ? updatedAtProblems(prev, text, now)
        : [];
    if (diffs.length || updatedAt.length)
      findings.push({ file: abs, kind: "changed", diffs, updatedAt, same });
    const tokens = same ? [] : diffTokens(...changedRange(prev, text));
    if (tokens.length) roundtrips.push({ file: abs, tokens });
  }
  for (const [abs, prev] of Object.entries(before.files)) {
    if (abs in after.files) continue;
    // worktree ごと消えた(Bash で worktree を外した)ときは号ごとに数えない
    const owner = ownerOf(abs, before.worktrees);
    if (!owner || !after.worktrees.includes(owner)) continue;
    if (isPublished(abs, prev, main(), now))
      findings.push({ file: abs, kind: "removed", diffs: [] });
  }
  return { findings, roundtrips };
}

/**
 * 公開済みか。git が答えないとき(リポ外・origin/main 無し)だけ、Edit 側と同じく
 * publishedAt < 今 で代える(publishedAt は控えの側から読む = Edit 側のディスクの現物)
 */
function isPublished(abs, beforeText, blobs, nowMs) {
  if (blobs) return blobs.has(path.basename(abs));
  const publishedAt = Date.parse(
    readField(PUBLISHED_AT_RE, extractFrontmatter(beforeText)) ?? ""
  );
  return Number.isFinite(publishedAt) && publishedAt < nowMs;
}

function readField(re, text) {
  const m = (text ?? "").match(re);
  return m ? m[1] : null;
}

// JST の暦日(YYYY-MM-DD)。digest の日時は全て +09:00 で書かれている
function jstDate(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validateUpdatedAt(value, current, nowMs) {
  const problems = [];
  const ms = Date.parse(value);
  if (!ISO_OFFSET_RE.test(value) || !Number.isFinite(ms)) {
    problems.push(
      "オフセット付き ISO8601(例: 2026-09-17T10:00:00+09:00)ではない"
    );
  } else {
    const publishedAt = Date.parse(
      readField(PUBLISHED_AT_RE, extractFrontmatter(current)) ?? ""
    );
    if (Number.isFinite(publishedAt) && ms < publishedAt)
      problems.push("publishedAt より前");
    if (jstDate(ms) > jstDate(nowMs)) problems.push("今日(JST)より後");
  }
  if (!problems.length) return [];
  return [{ key: "__updatedAtInvalid__", before: [value], after: problems }];
}

/**
 * 公開済みの号の中身が変わったとき、updatedAt が伴っているか。Edit 側の Write と同じ入り方
 * (控え = ディスクの現物、今の全文 = Write の content)で、規則も同じ: 新しい値が控えと違えば
 * その値を検証し、そうでなければ控えの値が今日(JST)なら通す。
 * Edit 側と違い、控えにあった updatedAt が消えたときも出す(Edit 側の Write にも同じ穴があるが、
 * Edit 側はユーザー環境のディスパッチャが sha256 で固定しているので触らない)
 */
function updatedAtProblems(beforeText, afterText, nowMs) {
  const onDisk = readField(UPDATED_AT_RE, extractFrontmatter(beforeText));
  const after = readField(UPDATED_AT_RE, afterText);
  if (after !== null && after !== onDisk) {
    return validateUpdatedAt(after, beforeText, nowMs);
  }
  if (onDisk !== null && after === null) {
    return [{ key: "__updatedAtRemoved__", before: [onDisk], after: [] }];
  }
  const onDiskMs = Date.parse(onDisk ?? "");
  if (Number.isFinite(onDiskMs) && jstDate(onDiskMs) === jstDate(nowMs))
    return [];
  return [{ key: "__updatedAt__", before: [onDisk ?? "∅"], after: [] }];
}

function ownerOf(abs, worktrees) {
  return worktrees
    .filter((wt) => abs.startsWith(wt + path.sep))
    .sort((a, b) => b.length - a.length)[0];
}

/** 所見の件数。保護値は 1 キーで 1 件、新しい号・消えた号は 1 件 */
const countOf = (f) =>
  f.kind === "changed" ? f.diffs.length + f.updatedAt.length : 1;

// 値は切らない。切ると長い URL や記事 id の末尾の変化が同じに見える(Edit 側と同じ)
function fmtVal(arr) {
  if (!arr.length) return "∅";
  return arr.join(" | ");
}

// 多重集合の差(a にあって b に無い分)。個数を Map で数える(URL 数の 2 乗だと hook の timeout を超えうる)
function multisetMinus(a, b) {
  const left = new Map();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  const out = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

function labelOf(key) {
  if (key === "__articleIds__") return "articleIds (in order)";
  if (key === "__articleIdsBounded__")
    return "articleIds (word-bounded, in order)";
  return key;
}

function describeUpdatedAt(u, file) {
  const lines = [];
  if (u.key === "__updatedAtInvalid__") {
    lines.push(
      `  ${file} updatedAt: ${fmtVal(u.before)} は ${u.after.join(" / ")}(publishedAt 以降・今日以前のオフセット付き ISO8601 にする)`
    );
  } else if (u.key === "__updatedAtRemoved__") {
    lines.push(
      `  ${file} updatedAt: 公開済みの号から updatedAt が消えた(控え: ${fmtVal(u.before)})`
    );
  } else {
    lines.push(
      `  ${file} updatedAt: 公開済みの号の中身が変わったが updatedAt が更新されていない(控え: ${fmtVal(u.before)})`
    );
  }
  lines.push(
    "    Article.dateModified に出る値なので、updatedAt を今日の日時にする(ADR 0071 / docs/digest-workflow.md)",
    "    この判定は、この Bash 以外(並行セッション・Edit)の変化を含みうる。自分のコマンドが書いたかを確かめてから直す"
  );
  return lines;
}

function describeFindings(findings, root) {
  const shown = (file) => {
    const rel = path.relative(root, file);
    return rel.startsWith("..") ? file : rel;
  };
  const count = findings.reduce((n, f) => n + countOf(f), 0);
  // 件数とファイル一覧を先に出す。詳細が長くて切り詰められても、どこが変わったかは残る
  const lines = [
    `[bash-frontmatter-guard] ${count} change(s) in ${findings.length} digest file(s) during this Bash command:`,
    `  ${findings.map((f) => shown(f.file)).join(", ")}`,
    "",
  ];
  for (const f of findings) {
    if (f.kind === "added") {
      lines.push(`  新しく置かれた号: ${shown(f.file)}(比較の対象なし)`);
      continue;
    }
    if (f.kind === "removed") {
      lines.push(`  公開済みの号が消えた: ${shown(f.file)}`);
      continue;
    }
    // pull・`git checkout origin/main -- …` で戻った号。updatedAt と roundtrip は出さない
    if (f.same && f.diffs.length)
      lines.push(
        `  ${shown(f.file)}: origin/main と同じ内容になった(取り込み・切り替えの可能性)`
      );
    for (const d of f.diffs) {
      // URL は frontmatter の全部を並べると 1 文字の変化が埋もれるので、増減だけを出す
      if (d.key === "__urls__") {
        lines.push(`  ${shown(f.file)} urls (frontmatter block):`);
        lines.push(`    増えた: ${fmtVal(multisetMinus(d.after, d.before))}`);
        lines.push(`    減った: ${fmtVal(multisetMinus(d.before, d.after))}`);
        continue;
      }
      lines.push(`  ${shown(f.file)} ${labelOf(d.key)}:`);
      lines.push(`    before: ${fmtVal(d.before)}`);
      lines.push(`    after:  ${fmtVal(d.after)}`);
    }
    for (const u of f.updatedAt)
      lines.push(...describeUpdatedAt(u, shown(f.file)));
  }
  lines.push(
    "",
    "Digest frontmatter pins reader-facing facts (week range, articleIds, related evidence URLs).",
    "Edit / Write would have asked for confirmation. Confirm each change against the source",
    "article ledger and tell the user what changed.",
    "Changes from a parallel tool call, another session or a git checkout are reported here too."
  );
  return lines.join("\n");
}

const clip = (s) =>
  s.length > MESSAGE_LIMIT
    ? s.slice(0, MESSAGE_LIMIT - 20) + "\n...(truncated)"
    : s;

const warn = (s) => `[bash-frontmatter-guard] ${s}`;

/**
 * 出力は 1 つの JSON にまとめる(行を分けると全体がパース失敗になり、知らせごと消える)。
 * Post では `additionalContext`(Claude へ。PostToolUseFailure が受け付ける唯一の
 * 判定フィールド)と `systemMessage`(ユーザーへ)に同じ文を載せ、roundtrip は
 * `additionalContext` にだけ足す。
 */
function output(event, { messages, claudeOnly = [] }) {
  const out = {};
  const text = clip(messages.join("\n\n"));
  if (text) out.systemMessage = text;
  if (event !== "PreToolUse") {
    const context = clip([...messages, ...claudeOnly].join("\n\n"));
    if (context)
      out.hookSpecificOutput = {
        hookEventName: event,
        additionalContext: context,
      };
  }
  return Object.keys(out).length
    ? { exitCode: 0, stdout: JSON.stringify(out) }
    : { exitCode: 0 };
}

function run(inputOrRaw, options = {}) {
  let input;
  try {
    input =
      typeof inputOrRaw === "string"
        ? inputOrRaw.trim()
          ? JSON.parse(inputOrRaw)
          : {}
        : inputOrRaw || {};
  } catch {
    return { exitCode: 0 };
  }
  if (String(input?.tool_name || "") !== "Bash") return { exitCode: 0 };
  const event = String(input?.hook_event_name || "");
  if (!["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(event))
    return { exitCode: 0 };

  const stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
  const now = options.now ?? Date.now();
  const messages = [];
  // roundtrip は Claude にだけ出す(Edit 側の roundtrip と同じ方針)
  const claudeOnly = [];
  let root;
  try {
    root = fs.realpathSync(options.root ?? path.resolve(__dirname, "..", ".."));
  } catch (e) {
    messages.push(
      warn(`could not resolve the repository root (${e?.message || e}).`)
    );
  }

  if (event === "PreToolUse") {
    if (root) {
      try {
        const saved = saveSnapshot(stateDir, input, root, now);
        if (saved.warning) messages.push(warn(saved.warning));
      } catch (e) {
        messages.push(warn(`could not snapshot digests (${e?.message || e}).`));
      }
    }
    return output(event, { messages });
  }

  if (root) {
    try {
      const before = loadSnapshot(stateDir, input);
      if (!before) {
        messages.push(
          warn(
            "no snapshot from PreToolUse; digests were not verified for this command."
          )
        );
      } else {
        const { snapshot: after, warning } = takeSnapshot(root);
        if (warning) messages.push(warn(warning));
        const { findings, roundtrips } = compareSnapshots(
          before,
          after,
          root,
          now
        );
        if (findings.length) messages.push(describeFindings(findings, root));
        for (const r of roundtrips) claudeOnly.push(describeRoundtrip(r, root));
      }
    } catch (e) {
      messages.push(warn(`could not verify digests (${e?.message || e}).`));
    }
  }
  return output(event, { messages, claudeOnly });
}

module.exports = {
  run,
  extractFrontmatter,
  captureProtectedFields,
  extractTokens,
  diffTokens,
  protectedDiffs,
  mainBlobs,
  isPublished,
  updatedAtProblems,
  takeSnapshot,
  DEFAULT_STATE_DIR,
};

if (require.main === module) {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    data += c;
  });
  process.stdin.on("end", () => {
    let out;
    try {
      out = run(data);
    } catch (e) {
      // 何が起きても Bash を止めない(exit 2 は全 Bash の停止になる)。黙りもしない。
      out = {
        exitCode: 0,
        stdout: JSON.stringify({
          systemMessage: warn(
            `crashed; nothing was verified (${e?.message || e}).`
          ),
        }),
      };
    }
    if (out.stdout) process.stdout.write(out.stdout);
    // `process.exit()` にしない。stdout がパイプのとき書き残しが捨てられ、判定 JSON が
    // 64KiB で切れる(pre-edit-frontmatter-immutable.cjs の同じ箇所を参照)。
    process.exitCode = 0;
  });
}
