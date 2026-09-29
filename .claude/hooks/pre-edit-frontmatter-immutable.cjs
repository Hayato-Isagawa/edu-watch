#!/usr/bin/env node
/**
 * PreToolUse hook (Edit | Write | MultiEdit) — frontmatter immutable guard for edu-watch.
 *
 * Blocks silent edits to high-stakes frontmatter fields in
 * src/content/digests/*.md (week-end news digest collection).
 *
 * Protected fields (any value change → permissionDecision="ask"):
 *   - title
 *   - weekStart           (YYYY-MM-DD; digit slip = wrong week)
 *   - weekEnd             (YYYY-MM-DD)
 *   - publishedAt         (ISO datetime)
 *
 * Plus: any change to the sequence of article ids in the frontmatter block
 * (sections[].articleIds, #747). The ids are matched by their shape, not by
 * the key, so the one-line list, the multi-line flow list and the block list
 * are all covered, and so is an Edit chunk that carries only the id itself.
 * A sourceId may contain hyphens (`mext-press-…`, #773); the whole id is
 * compared, as is the older word-bounded match (see ARTICLE_ID_WORD_RE).
 *
 * Edit / MultiEdit are compared twice: chunk against chunk, and the file on
 * disk before and after the edit is applied to it (#779), so a chunk without
 * the key or the id's date and hash is still seen. The file's CRLF is read
 * as LF first; old_string is used as given (#781). When old_string is not
 * found there or is not unique, the edit asks (Claude Code may normalise
 * quotes or `\u` escapes before applying it). Joining a block-list id line to
 * the next line keeps the id words intact, so that form is left to
 * `npm run check:digest-articles` (ADR 0075).
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

const PROTECTED_KEYS = ["title", "weekStart", "weekEnd", "publishedAt"];

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const TARGET_PATH_RE = /(?:^|\/)src\/content\/digests\/[^/]+\.(md|mdx)$/i;
const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;
// 記事 id の形(`src/lib/normalize.ts` の generateArticleId: `<sourceId>-<yyyy-mm-dd>-<16-hex>`)。
// キー名ではなく形で拾う。以前は `articleId:` を探していたが、digest が使うキーは
// `articleIds`(`src/content.config.ts`)で、1 件も当たっていなかった(#747)。
// 並びは 2 通りで拾い、どちらが変わっても確認を出す(#773)。
// - ARTICLE_ID_WORD_RE: ハイフンでつながった英数字を 1 語とし、id の形で終わる語を拾う。
//   sourceId にハイフンがあっても(`mext-press-…`)丸ごと拾う。語の中は英数字とハイフンが
//   交互で分け方が 1 通り、語の後ろに条件が無いので後戻りせず線形。
// - ARTICLE_ID_BOUNDED_RE: 語の区切り(`\b`)で挟んで拾う旧来の形。こちらだけが捕まえる編集
//   (id の直後に `_` や大文字を足す、sourceId にハイフンの無い `<id>-v2` の id 部分を変える)を
//   落とさないために残す。ハイフンを含む sourceId の `<id>-v2` は、先頭部分の変更をどちらも拾わない。
//   `[a-z0-9]+` は `\b` から始まるので、英数字の連続 1 本につき探索の起点は 1 つで線形。
const ARTICLE_ID_WORD_RE = /\b[a-z0-9]+(?:-+[a-z0-9]+)*/g;
const ARTICLE_ID_TAIL_RE = /-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/;
const ARTICLE_ID_BOUNDED_RE = /\b[a-z0-9]+-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}\b/g;

function extractFrontmatter(s) {
  if (!s) return null;
  const m = s.match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

// 保護キーの値。旧 `key:[ \t]*(.+?)[ \t]*$` と同じ値を線形で取る: 前後の [ \t] を落とし、
// 空白だけの値は最後の 1 文字、空なら値なし。正規表現で `(.+?)` と `[ \t]*$` を隣り合わせると、
// 値の途中の長い空白で 2 乗になる(32KB で約 2.4 秒)。
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

function captureProtectedFields(fm, { topLevelTitle = false } = {}) {
  if (!fm) return new Map();
  const map = new Map();
  for (const key of PROTECTED_KEYS) {
    // 前置きを `[ \t]*(?:-[ \t]*)?` にしてある。以前の `\s*-?\s*` は
    // **隣り合う 2 つの `*` が空白を分け合える**ため探索が O(N²) に落ちる。
    // 実測(#745 時点・2026-09-27。当時の保護キー 5 本を走査、本機 Node 24):
    //          4KB      16KB      32KB
    //   旧    133ms   2,117ms   8,486ms
    //   新    0.1ms     0.5ms     0.7ms
    // `-` を伴う場合だけ 2 つ目の空白列を許すと分割の曖昧さが消えて線形になる。
    // `\s` を `[ \t]` に置き換えるだけでは直らない(分割の曖昧さが残る)。
    // 抽出結果は実データで完全一致(#745 時点。digests 16 本 × 保護キー 5 本 × frontmatter 窓 /
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
    // topLevelTitle: 現物に当てた比較では、title を行頭(digest 自体の題)だけで見る。
    // relatedEvidenceUrls の入れ子の `title:` まで見ると、その断片の編集にも確認が出る(#779)
    const lead = key === "title" && topLevelTitle ? "" : "[ \\t]*(?:-[ \\t]*)?";
    const re = new RegExp(`^${lead}${key}:(.*)$`, "gm");
    const values = [];
    for (const m of fm.matchAll(re)) {
      const v = valueAfterColon(m[1]);
      if (v !== null) values.push(v.replace(/^["']|["']$/g, ""));
    }
    if (values.length) map.set(key, values);
  }
  // 記事 id は並び順のまま比べる(並べ替えない)。節をまたいで id を移すと記事カードの
  // 帰属が変わるので、集合が同じでも順序の変化を捕まえる。
  const ids = (fm.match(ARTICLE_ID_WORD_RE) || []).filter((w) =>
    ARTICLE_ID_TAIL_RE.test(w)
  );
  if (ids.length) map.set("__articleIds__", ids);
  const bounded = fm.match(ARTICLE_ID_BOUNDED_RE) || [];
  if (bounded.length) map.set("__articleIdsBounded__", bounded);
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

function evaluatePair(oldStr, newStr, options = {}) {
  // Edit chunks usually don't include the `---` delimiters; fall back to the
  // whole chunk so single-line frontmatter edits ("weekStart: ...") still
  // get inspected. Path filter (TARGET_PATH_RE) keeps body-text false
  // positives unlikely.
  const beforeFm = extractFrontmatter(oldStr) ?? oldStr ?? "";
  const afterFm = extractFrontmatter(newStr) ?? newStr ?? "";
  if (!beforeFm && !afterFm) return [];
  const before = captureProtectedFields(beforeFm, options);
  const after = captureProtectedFields(afterFm, options);
  const diffs = diffMaps(before, after);
  // 旧来の並びが両側とも新しい並びから導けるなら、その変化は新しい並びの変化に含まれる。
  // 表示が重複するだけなので落とす。導けない側があれば別の箇所の変化かもしれないので残す
  // (変わっていない `<id>-v2` などが混じると、同じ変化が 2 つのラベルで出ることがある)
  if (boundedFollowsIds(before) && boundedFollowsIds(after)) {
    return diffs.filter((d) => d.key !== "__articleIdsBounded__");
  }
  return diffs;
}

// 新しい並びの各語から旧来の形で拾い直したものが、旧来の並びと一致するか
function boundedFollowsIds(m) {
  const derived = (m.get("__articleIds__") ?? []).flatMap(
    (w) => w.match(ARTICLE_ID_BOUNDED_RE) ?? []
  );
  return (
    JSON.stringify(derived) ===
    JSON.stringify(m.get("__articleIdsBounded__") ?? [])
  );
}

// Write は差分ではなくファイル全体が届く。比較対象はディスク上の現物。
// 読めない理由で挙動を分ける:
//   ファイルが無い   → 新規作成。比較対象が無いので通す
//   それ以外の失敗   → 検証できない。通さずに確認を出す(fail-safe)
// これが無いと、Edit では捕捉される weekStart / publishedAt / 記事 id の改変が
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

// Edit / MultiEdit の断片だけでは、記事 id の日付とハッシュやキー名を含まない編集
// (`[nikkyo-` → `[kyodo-`、`08-03` → `08-04`)が見えない(#779)。ディスクの現物に編集を当て、
// frontmatter 全体の編集前後も比べる。現物が無い・読めないときは断片の比較だけに任せる。
function evaluateApplied(filePath, edits) {
  let current;
  try {
    current = require("node:fs").readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  // 現物だけ CRLF を LF に直してから当てる。old_string / new_string は直さないので、
  // `\r` を含む old_string は見つからず、確かめられないとして確認に回る(#781)
  current = current.replaceAll("\r\n", "\n");
  try {
    // 空の new_string のとき、Claude Code は直後の改行も消すことがある。
    // どちらになるかは決め打ちせず、両方を当てて比べる
    let variants = [current];
    for (const e of edits) {
      const oldS = e?.old_string ?? "";
      const newS = e?.new_string ?? "";
      const all = e?.replace_all === true;
      // 空の old_string は、中身のある既存ファイルに対して Claude Code が拒否する
      if (!oldS) return [];
      const next = [];
      for (const v of variants) {
        const applied = applyEdit(v, oldS, newS, all);
        if (applied === null) {
          return [{ key: "__unapplied__", before: [oldS], after: [] }];
        }
        next.push(applied);
        if (newS === "" && !oldS.endsWith("\n")) {
          const joined = applyEdit(v, oldS + "\n", "", all);
          if (joined !== null) next.push(joined);
        }
      }
      variants = [...new Set(next)];
      if (
        variants.length > MAX_APPLIED_VARIANTS ||
        variants.some((v) => v.length > MAX_APPLIED_LENGTH)
      ) {
        return [{ key: "__uncheckable__", before: [], after: [] }];
      }
    }
    const seen = new Set();
    const diffs = [];
    for (const v of variants) {
      for (const d of evaluatePair(current, v, { topLevelTitle: true })) {
        if (seen.has(d.key)) continue;
        seen.add(d.key);
        diffs.push(d);
      }
    }
    return diffs;
  } catch {
    // 当てる途中で落ちたら、断片の比較だけに戻さず確認を出す
    return [{ key: "__uncheckable__", before: [], after: [] }];
  }
}

// 当てた結果がこれより大きい・候補が多すぎるなら、編集後を確かめられないとして確認を出す(digest は数 KB)
const MAX_APPLIED_LENGTH = 4 * 1024 * 1024;
const MAX_APPLIED_VARIANTS = 16;

// 見つからない・replace_all でないのに複数ある、なら null。
// Claude Code は曲がった引用符・`\u` を正規化してから当てるので、ここで見つからなくても
// 編集が失敗するとは限らない。null は「編集後を確かめられない」として確認に回す。
// `String.prototype.replace` は置換文字列の `$&` などを解釈するので使わない
function applyEdit(content, oldS, newS, all) {
  const i = content.indexOf(oldS);
  if (i < 0) return null;
  if (all) return content.split(oldS).join(newS);
  if (content.indexOf(oldS, i + oldS.length) >= 0) return null;
  return content.slice(0, i) + newS + content.slice(i + oldS.length);
}

// キーごとに、現物に当てた比較の差分があればそちらを、無ければ断片の差分を使う
function mergeDiffs(chunkDiffs, appliedDiffs) {
  const keys = new Set(appliedDiffs.map((d) => d.key));
  return [...appliedDiffs, ...chunkDiffs.filter((d) => !keys.has(d.key))];
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
      ...mergeDiffs(
        evaluatePair(oldS, newS),
        evaluateApplied(filePath, [toolInput])
      ),
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
    const chunks = [];
    for (const e of edits) {
      chunks.push(...evaluatePair(e?.old_string ?? "", e?.new_string ?? ""));
    }
    const merged = mergeDiffs(chunks, evaluateApplied(filePath, edits));
    // 複数の編集のどれかが updatedAt を書いていれば足りる
    const newAll = edits.map((e) => e?.new_string ?? "").join("\n");
    merged.push(...evaluateUpdatedAt(filePath, "", newAll));
    return merged;
  }
  return [];
}

// 保護値の before / after は切らない。切ると長い URL や記事 id の末尾の変化が同じに見える(#779)。
// 切るのは、確かめられないときに出す old_string だけ(MAX_SHOWN_OLD_STRING)
function fmtVal(arr) {
  if (!arr.length) return "∅";
  return arr.join(" | ");
}

// 多重集合の差(a にあって b に無い分)
function multisetMinus(a, b) {
  const rest = [...b];
  const out = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i >= 0) rest.splice(i, 1);
    else out.push(x);
  }
  return out;
}

// 見出しは差分の分類から組み立てる。公開済みの号では確かめられないときも updatedAt が同時に出るので、
// キー名の列挙で「これだけなら」と分けない(#781)
const UNCHECKABLE_KEYS = new Set([
  "__unapplied__",
  "__uncheckable__",
  "__unreadable__",
]);
const UPDATED_AT_KEYS = new Set(["__updatedAt__", "__updatedAtInvalid__"]);

// 確かめられないときに出す old_string の長さ。全文を出すと、ディスパッチャの spawnSync の
// maxBuffer(stdout と stderr の合計 1 MiB)を超えて確認ではなく停止になる(#781)
const MAX_SHOWN_OLD_STRING = 200;

function headingOf(diffs) {
  const parts = [];
  if (
    diffs.some(
      (d) => !UNCHECKABLE_KEYS.has(d.key) && !UPDATED_AT_KEYS.has(d.key)
    )
  )
    parts.push("Protected fields changed");
  if (diffs.some((d) => UNCHECKABLE_KEYS.has(d.key)))
    parts.push("Cannot verify the edited frontmatter");
  if (diffs.some((d) => UPDATED_AT_KEYS.has(d.key)))
    parts.push("updatedAt needs attention");
  return parts.join(" / ");
}

function buildReason(diffs, filePath) {
  const lines = [`[frontmatter-immutable] ${headingOf(diffs)} in ${filePath}:`];
  for (const d of diffs) {
    if (d.key === "__updatedAtInvalid__") {
      lines.push(
        `  updatedAt: ${fmtVal(d.before)} は ${d.after.join(" / ")}(publishedAt 以降・今日以前のオフセット付き ISO8601 にする)`
      );
      continue;
    }
    if (d.key === "__unapplied__") {
      const old = d.before[0];
      const shown =
        old.length > MAX_SHOWN_OLD_STRING
          ? `${JSON.stringify(old.slice(0, MAX_SHOWN_OLD_STRING))}…(全 ${old.length} 文字)`
          : JSON.stringify(old);
      lines.push(
        `  編集後の frontmatter を確かめられない: old_string が現物に見つからないか、1 か所に決まらない(${shown})`
      );
      lines.push(
        "    引用符の形・エスケープが現物と違うと、Claude Code が正規化して当てることがある(old_string の CR は直さない)"
      );
      continue;
    }
    if (d.key === "__uncheckable__") {
      lines.push(
        "  編集後の frontmatter を確かめられない: 当てた結果が大きすぎる・候補が多すぎる、または当てる途中で失敗した"
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
    // URL は frontmatter の全部を並べると 1 文字の変化が埋もれるので、増減だけを出す(#781)
    if (d.key === "__urls__") {
      lines.push("  urls (frontmatter block):");
      lines.push(`    増えた: ${fmtVal(multisetMinus(d.after, d.before))}`);
      lines.push(`    減った: ${fmtVal(multisetMinus(d.before, d.after))}`);
      continue;
    }
    const label =
      d.key === "__articleIds__"
        ? "articleIds (in order)"
        : d.key === "__articleIdsBounded__"
          ? "articleIds (word-bounded, in order)"
          : d.key;
    lines.push(`  ${label}:`);
    lines.push(`    before: ${fmtVal(d.before)}`);
    lines.push(`    after:  ${fmtVal(d.after)}`);
  }
  lines.push("");
  lines.push(
    "Digest frontmatter pins reader-facing facts (week range, articleIds,"
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
