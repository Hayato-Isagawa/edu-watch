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
 * Backed by DELEGATE-52 (arxiv 2604.15597) — sparse silent corruption
 * (Claude 4.6 Opus 26.9% rate) most often targets numeric/URL frontmatter.
 */

'use strict';

const PROTECTED_KEYS = ['title', 'weekStart', 'weekEnd', 'publishedAt', 'articleId'];

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
    const re = new RegExp(`^\\s*-?\\s*${key}:\\s*(.+?)\\s*$`, 'gm');
    const values = [...fm.matchAll(re)].map(m => m[1].replace(/^["']|["']$/g, ''));
    if (values.length) map.set(key, values);
  }
  // URLs in the frontmatter block (relatedEvidenceUrls list etc.)
  const urls = (fm.match(URL_RE) || []).map(x => x.trim());
  if (urls.length) map.set('__urls__', urls.sort());
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
  const beforeFm = extractFrontmatter(oldStr) ?? (oldStr ?? '');
  const afterFm = extractFrontmatter(newStr) ?? (newStr ?? '');
  if (!beforeFm && !afterFm) return [];
  return diffMaps(captureProtectedFields(beforeFm), captureProtectedFields(afterFm));
}

function evaluatePayload(toolName, toolInput) {
  if (toolName === 'Edit') {
    return evaluatePair(toolInput?.old_string ?? '', toolInput?.new_string ?? '');
  }
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(toolInput?.edits) ? toolInput.edits : [];
    const merged = [];
    for (const e of edits) {
      merged.push(...evaluatePair(e?.old_string ?? '', e?.new_string ?? ''));
    }
    return merged;
  }
  return [];
}

function fmtVal(arr) {
  if (!arr.length) return '∅';
  return arr.map(v => (v.length > 60 ? v.slice(0, 57) + '...' : v)).join(' | ');
}

function buildReason(diffs, filePath) {
  const lines = [`[frontmatter-immutable] Protected fields changed in ${filePath}:`];
  for (const d of diffs) {
    const label = d.key === '__urls__' ? 'urls (frontmatter block)' : d.key;
    lines.push(`  ${label}:`);
    lines.push(`    before: ${fmtVal(d.before)}`);
    lines.push(`    after:  ${fmtVal(d.after)}`);
  }
  lines.push('');
  lines.push('Digest frontmatter pins reader-facing facts (week range, articleId,');
  lines.push('related evidence URLs). Confirm the change matches the source article');
  lines.push('ledger before applying.');
  return lines.join('\n');
}

function run(inputOrRaw, _options = {}) {
  let input;
  try {
    input = typeof inputOrRaw === 'string'
      ? (inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {})
      : (inputOrRaw || {});
  } catch {
    return { exitCode: 0 };
  }

  const toolName = String(input?.tool_name || '');
  if (!['Edit', 'MultiEdit'].includes(toolName)) return { exitCode: 0 };

  const toolInput = input?.tool_input || {};
  const filePath = String(toolInput?.file_path || '');
  if (!TARGET_PATH_RE.test(filePath)) return { exitCode: 0 };

  const diffs = evaluatePayload(toolName, toolInput);
  if (!diffs.length) return { exitCode: 0 };

  const reason = buildReason(diffs, filePath);
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
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
  PROTECTED_KEYS,
  TARGET_PATH_RE,
};

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { data += c; });
  process.stdin.on('end', () => {
    const out = run(data);
    if (out.stdout) process.stdout.write(out.stdout);
    if (out.stderr) process.stderr.write(out.stderr.endsWith('\n') ? out.stderr : out.stderr + '\n');
    process.exit(Number.isInteger(out.exitCode) ? out.exitCode : 0);
  });
}
