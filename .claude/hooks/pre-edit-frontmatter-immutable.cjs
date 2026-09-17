#!/usr/bin/env node
/**
 * PreToolUse hook (Edit | MultiEdit) — frontmatter immutable guard for edu-watch.
 *
 * Blocks silent edits to high-stakes frontmatter fields in
 * src/content/digests/*.md (week-end news digest collection).
 *
 * Protected fields (any value change → permissionDecision="ask"):
 *   - title
 *   - weekStart           (YYYY-MM-DD; digit slip = wrong week)
 *   - weekEnd             (YYYY-MM-DD)
 *   - publishedAt         (ISO datetime)
 *   - articleId           (per-section identifier; under sections[])
 *
 * Plus: any URL set change in the frontmatter block (relatedEvidenceUrls
 * lives as a YAML list, so we compare URL multisets across the whole
 * frontmatter section).
 *
 * Plus (#688): editing a digest that is already published must carry
 * `updatedAt` (ADR 0071 — it feeds Article.dateModified). "Published" means
 * the file exists on origin/main (digests are usually merged hours after
 * their publishedAt, so the timestamp alone would flag the writing window;
 * origin/main is only as fresh as the last fetch, so a digest merged on
 * GitHub but not yet fetched here still counts as unpublished);
 * when git cannot answer, publishedAt < now is the fallback. The edit passes
 * when it sets updatedAt to a new value (offset ISO8601, >= publishedAt,
 * not after today JST), or when the file on disk already has updatedAt dated
 * today (JST); otherwise → "ask". Every edit of a published digest counts,
 * including topics / formatting-only changes (ADR 0071 — one rule, no
 * judgement call). Accepted limits (#695): a publishedAt the regex cannot
 * read falls back to "unpublished"; the fetch window above; MultiEdit reads
 * only the first updatedAt line across all edits (errs toward asking).
 *
 * Backed by DELEGATE-52 (arxiv 2604.15597) — sparse silent corruption
 * (Claude 4.6 Opus 26.9% rate) most often targets numeric/URL frontmatter.
 */

"use strict";

const PROTECTED_KEYS = [
  "title",
  "weekStart",
  "weekEnd",
  "publishedAt",
  "articleId",
];

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const TARGET_PATH_RE = /(?:^|\/)src\/content\/digests\/[^/]+\.(md|mdx)$/i;
const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;

function extractFrontmatter(s) {
  if (!s) return null;
  const m = s.match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

function captureProtectedFields(fm) {
  if (!fm) return new Map();
  const map = new Map();
  for (const key of PROTECTED_KEYS) {
    // 前置きを `[ \t]*(?:-[ \t]*)?` にしてある。以前の `\s*-?\s*` は
    // **隣り合う 2 つの `*` が空白を分け合える**ため探索が O(N²) に落ちる。
    // 実測(保護キー 5 本を走査、本機 Node 24):
    //          4KB      16KB      32KB
    //   旧    133ms   2,117ms   8,486ms
    //   新    0.1ms     0.5ms     0.7ms
    // `-` を伴う場合だけ 2 つ目の空白列を許すと分割の曖昧さが消えて線形になる。
    // `\s` を `[ \t]` に置き換えるだけでは直らない(分割の曖昧さが残る)。
    // 抽出結果は実データで完全一致(digests 16 本 × 保護キー 5 本 × frontmatter 窓 /
    // 全文窓 = 160 比較で差分 0)。合成入力では 2 種類だけ差が出て、
    // **どちらも新形の方が正しい**:
    //   1. **値が空のキー**。`\s` は改行を跨げるので、旧形は `title:` の値として
    //      **次の行をまるごと**拾っていた(`title:\nweekStart: 2026-08-01` → `weekStart: 2026-08-01`)。
    //      空のまま次の行を編集すると before/after が変わり、**無関係な ask が出る**。
    //   2. `\s` に含まれて `[ \t]` に含まれない非改行文字(全角空白・NBSP・垂直タブ・
    //      フォームフィード)でインデントした行。旧形はそれを `title` として拾うが、
    //      YAML から見るとキー名自体が別物(`　title`)なので拾う方が誤り。
    //
    // 詰めておく理由: settings.json の `timeout: 5`(秒)を超えるとプロセスが
    // kill され、stdout が出ない = ガードが黙って素通りする。
    const re = new RegExp(
      `^[ \\t]*(?:-[ \\t]*)?${key}:[ \\t]*(.+?)[ \\t]*$`,
      "gm"
    );
    const values = [...fm.matchAll(re)].map((m) =>
      m[1].replace(/^["']|["']$/g, "")
    );
    if (values.length) map.set(key, values);
  }
  // URLs in the frontmatter block (relatedEvidenceUrls list etc.)
  const urls = (fm.match(URL_RE) || []).map((x) => x.trim());
  if (urls.length) map.set("__urls__", urls.sort());
  return map;
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

function evaluatePair(oldStr, newStr) {
  // Edit chunks usually don't include the `---` delimiters; fall back to the
  // whole chunk so single-line frontmatter edits ("weekStart: ...") still
  // get inspected. Path filter (TARGET_PATH_RE) keeps body-text false
  // positives unlikely.
  const beforeFm = extractFrontmatter(oldStr) ?? oldStr ?? "";
  const afterFm = extractFrontmatter(newStr) ?? newStr ?? "";
  if (!beforeFm && !afterFm) return [];
  return diffMaps(
    captureProtectedFields(beforeFm),
    captureProtectedFields(afterFm)
  );
}

// Write は差分ではなくファイル全体が届く。比較対象はディスク上の現物。
// 読めない理由で挙動を分ける:
//   ファイルが無い   → 新規作成。比較対象が無いので通す
//   それ以外の失敗   → 検証できない。通さずに確認を出す(fail-safe)
// これが無いと、Edit では捕捉される weekStart / publishedAt / articleId の改変が
// Write による全文書き換えでは一切検知されない(edu-law から移植)。
function evaluateWrite(filePath, content) {
  let current;
  try {
    current = require("node:fs").readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    return [
      {
        key: "__unreadable__",
        before: [String(err && err.code) || "read error"],
        after: [],
      },
    ];
  }
  return evaluatePair(current, content ?? "");
}

const UPDATED_AT_RE = /^[ \t]*updatedAt:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m;
const PUBLISHED_AT_RE =
  /^[ \t]*publishedAt:[ \t]*["']?([^"'\n]+?)["']?[ \t]*$/m;

function readField(re, text) {
  const m = (text ?? "").match(re);
  return m ? m[1] : null;
}

// JST の暦日(YYYY-MM-DD)。digest の日時は全て +09:00 で書かれている
function jstDate(ms) {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 公開済み = origin/main に同じパスがある(= 配信済み)。publishedAt < 今 で判定すると、
// 号は publishedAt(土曜 07:00)の後にマージされることが多いので、執筆中の Edit まで
// 止めてしまう。git が答えられないとき(リポ外・origin/main 無し)だけ publishedAt で代用する
function isPublished(filePath, current, nowMs) {
  const path = require("node:path");
  const r = require("node:child_process").spawnSync(
    "git",
    [
      "-C",
      path.dirname(filePath),
      "cat-file",
      "-e",
      `origin/main:./${path.basename(filePath)}`,
    ],
    // stderr の文言で「無い」を判定するので、ロケールで訳されないよう C に固定する
    { encoding: "utf8", timeout: 2000, env: { ...process.env, LC_ALL: "C" } }
  );
  if (r.status === 0) return true;
  if (
    r.status === 128 &&
    /does not exist|exists on disk, but not in/.test(r.stderr || "")
  )
    return false;
  const publishedAt = Date.parse(
    readField(PUBLISHED_AT_RE, extractFrontmatter(current)) ?? ""
  );
  return Number.isFinite(publishedAt) && publishedAt < nowMs;
}

// content.config.ts の z.string().datetime({ offset: true }) と同じ形(オフセット付き ISO8601)
const ISO_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// 新しく書かれた updatedAt の値そのもの。zod は publishedAt 以降しか見ないので、
// 非 ISO・未来(今日の JST より後)はビルドを通ってしまう。ここで一緒に止める(#695)
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

// 公開済みの号を編集するとき、updatedAt が伴っているか。
// 伴っている = この編集で updatedAt を新しい値にする / ディスクの updatedAt が今日(JST)。
// 判定できない(ファイルが無い = 新規作成)ときは見ない。読めない他の理由は fail-safe で確認を出す。
function evaluateUpdatedAt(filePath, _oldStr, newStr, nowMs = Date.now()) {
  let current;
  try {
    current = require("node:fs").readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    return [
      {
        key: "__unreadable__",
        before: [String(err && err.code) || "read error"],
        after: [],
      },
    ];
  }
  if (!isPublished(filePath, current, nowMs)) return [];
  const onDisk = readField(UPDATED_AT_RE, extractFrontmatter(current));
  const after = readField(UPDATED_AT_RE, newStr);
  // ディスクと同じ値の書き直しは「更新」ではない(Edit の old_string はディスクと一致するので before は見ない)
  if (after !== null && after !== onDisk) {
    return validateUpdatedAt(after, current, nowMs);
  }
  const onDiskMs = Date.parse(onDisk ?? "");
  if (Number.isFinite(onDiskMs) && jstDate(onDiskMs) === jstDate(nowMs))
    return [];
  return [{ key: "__updatedAt__", before: [onDisk ?? "∅"], after: [] }];
}

function evaluatePayload(toolName, toolInput) {
  const filePath = String(toolInput?.file_path || "");
  if (toolName === "Edit") {
    const oldS = toolInput?.old_string ?? "";
    const newS = toolInput?.new_string ?? "";
    return [
      ...evaluatePair(oldS, newS),
      ...evaluateUpdatedAt(filePath, oldS, newS),
    ];
  }
  if (toolName === "Write") {
    const content = toolInput?.content ?? "";
    const diffs = evaluateWrite(filePath, content);
    if (diffs.some((d) => d.key === "__unreadable__")) return diffs;
    // Write は全文なので、updatedAt の before はディスクの現物側で見る
    return [...diffs, ...evaluateUpdatedAt(filePath, "", content)];
  }
  if (toolName === "MultiEdit") {
    const edits = Array.isArray(toolInput?.edits) ? toolInput.edits : [];
    const merged = [];
    for (const e of edits) {
      merged.push(...evaluatePair(e?.old_string ?? "", e?.new_string ?? ""));
    }
    // 複数の編集のどれかが updatedAt を書いていれば足りる
    const newAll = edits.map((e) => e?.new_string ?? "").join("\n");
    merged.push(...evaluateUpdatedAt(filePath, "", newAll));
    return merged;
  }
  return [];
}

function fmtVal(arr) {
  if (!arr.length) return "∅";
  return arr
    .map((v) => (v.length > 60 ? v.slice(0, 57) + "..." : v))
    .join(" | ");
}

function buildReason(diffs, filePath) {
  const lines = [
    `[frontmatter-immutable] Protected fields changed in ${filePath}:`,
  ];
  for (const d of diffs) {
    if (d.key === "__updatedAtInvalid__") {
      lines.push(
        `  updatedAt: ${fmtVal(d.before)} は ${d.after.join(" / ")}(publishedAt 以降・今日以前のオフセット付き ISO8601 にする)`
      );
      continue;
    }
    if (d.key === "__updatedAt__") {
      lines.push(
        `  updatedAt: 公開済みの号を編集していますが updatedAt が更新されていません(現在: ${fmtVal(d.before)})`
      );
      lines.push(
        "    Article.dateModified に出る値なので、この編集と同じ Edit で updatedAt を今日の日時にする(ADR 0071 / docs/digest-workflow.md)"
      );
      continue;
    }
    const label = d.key === "__urls__" ? "urls (frontmatter block)" : d.key;
    lines.push(`  ${label}:`);
    lines.push(`    before: ${fmtVal(d.before)}`);
    lines.push(`    after:  ${fmtVal(d.after)}`);
  }
  lines.push("");
  lines.push(
    "Digest frontmatter pins reader-facing facts (week range, articleId,"
  );
  lines.push(
    "related evidence URLs). Confirm the change matches the source article"
  );
  lines.push("ledger before applying.");
  return lines.join("\n");
}

function run(inputOrRaw, _options = {}) {
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

  const toolName = String(input?.tool_name || "");
  if (!["Edit", "Write", "MultiEdit"].includes(toolName))
    return { exitCode: 0 };

  const toolInput = input?.tool_input || {};
  const filePath = String(toolInput?.file_path || "");
  if (!TARGET_PATH_RE.test(filePath)) return { exitCode: 0 };

  const diffs = evaluatePayload(toolName, toolInput);
  if (!diffs.length) return { exitCode: 0 };

  const reason = buildReason(diffs, filePath);
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  });

  return { exitCode: 0, stdout, stderr: reason };
}

module.exports = {
  run,
  extractFrontmatter,
  captureProtectedFields,
  diffMaps,
  evaluateUpdatedAt,
  isPublished,
  PROTECTED_KEYS,
  TARGET_PATH_RE,
};

if (require.main === module) {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    data += c;
  });
  process.stdin.on("end", () => {
    const out = run(data);
    if (out.stdout) process.stdout.write(out.stdout);
    if (out.stderr)
      process.stderr.write(
        out.stderr.endsWith("\n") ? out.stderr : out.stderr + "\n"
      );
    // **`process.exit()` にしないこと。** stdout がパイプのとき write は非同期なので、
    // 直後に exit すると書き残しが捨てられ、判定 JSON がちょうど 65536B
    // (パイプバッファ)で切れる。切れた JSON は誰もエラーにせず、global
    // ディスパッチャは「判定ではない付随出力」として捨てて exit 0 =
    // **ask が無音で消える**。exitCode を置くだけにして、Node に flush させる。
    process.exitCode = Number.isInteger(out.exitCode) ? out.exitCode : 0;
  });
}
