#!/usr/bin/env node
/**
 * PostToolUse hook (Edit | MultiEdit) — roundtrip spot check for edu-watch.
 *
 * After a Markdown edit in src/content/digests/, surfaces a Claude-only
 * additionalContext message listing the numeric / URL / DOI / DP-id tokens
 * that changed. The user does not see this message — it nudges Claude to
 * confirm sourcing in its next turn.
 *
 * Backed by DELEGATE-52 (arxiv 2604.15597). Cannot block (PostToolUse exit 2
 * is ignored), so always exits 0 with additionalContext payload via stdout.
 */

'use strict';

const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;
const DOI_RE = /\b10\.\d{4,9}\/[^\s)>"']+/gi;
const DP_ID_RE = /\bDP\d{2}-\d+\b/gi;
const EFFECT_SIZE_RE = /\b(?:cohen'?s\s*)?[dgr]\s*=\s*-?\d+\.\d+\b/gi;
const NUMBER_RE = /\b\d[\d.,]*\d\b/g;

const TARGET_PATH_RE = /(?:^|\/)src\/content\/digests\/[^/]+\.(md|mdx)$/i;

const KINDS = ['number', 'url', 'doi', 'dp_id', 'effect_size'];

function extractTokens(s) {
  const src = String(s ?? '');
  const dpIds = src.match(DP_ID_RE) || [];
  const stripped = src.replace(DP_ID_RE, ' ');
  return {
    number: new Set((stripped.match(NUMBER_RE) || []).map(x => x.trim())),
    url: new Set((src.match(URL_RE) || []).map(x => x.trim())),
    doi: new Set((src.match(DOI_RE) || []).map(x => x.trim())),
    dp_id: new Set(dpIds.map(x => x.trim())),
    effect_size: new Set((src.match(EFFECT_SIZE_RE) || []).map(x => x.trim().toLowerCase())),
  };
}

function diffTokens(beforeS, afterS) {
  const before = extractTokens(beforeS);
  const after = extractTokens(afterS);
  const result = [];
  for (const k of KINDS) {
    const added = [...after[k]].filter(x => !before[k].has(x));
    const removed = [...before[k]].filter(x => !after[k].has(x));
    if (added.length || removed.length) {
      result.push({ kind: k, added, removed });
    }
  }
  return result;
}

function evaluatePayload(toolName, toolInput) {
  if (toolName === 'Edit') {
    return diffTokens(toolInput?.old_string ?? '', toolInput?.new_string ?? '');
  }
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(toolInput?.edits) ? toolInput.edits : [];
    const merged = [];
    for (const e of edits) {
      merged.push(...diffTokens(e?.old_string ?? '', e?.new_string ?? ''));
    }
    return merged;
  }
  return [];
}

function fmtList(items) {
  if (!items.length) return '∅';
  const head = items.slice(0, 4).join(', ');
  const tail = items.length > 4 ? ` (+${items.length - 4} more)` : '';
  return head + tail;
}

function buildContext(diffs, filePath) {
  const lines = [`[roundtrip] Tracked tokens changed in ${filePath}:`];
  for (const d of diffs) {
    if (d.added.length) lines.push(`  + ${d.kind}: ${fmtList(d.added)}`);
    if (d.removed.length) lines.push(`  - ${d.kind}: ${fmtList(d.removed)}`);
  }
  lines.push('');
  lines.push('Before continuing, briefly state which source article supports each');
  lines.push('numeric or URL change. If unsure, ask the user before further edits.');
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

  const additionalContext = buildContext(diffs, filePath);
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext,
    },
  });

  return { exitCode: 0, stdout };
}

module.exports = { run, extractTokens, diffTokens, TARGET_PATH_RE };

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { data += c; });
  process.stdin.on('end', () => {
    const out = run(data);
    if (out.stdout) process.stdout.write(out.stdout);
    process.exit(Number.isInteger(out.exitCode) ? out.exitCode : 0);
  });
}
