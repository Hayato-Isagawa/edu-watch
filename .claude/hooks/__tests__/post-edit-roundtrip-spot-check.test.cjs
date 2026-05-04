'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, extractTokens, diffTokens, TARGET_PATH_RE } =
  require('../post-edit-roundtrip-spot-check.cjs');

test('TARGET_PATH_RE: digests path fires', () => {
  assert.match('src/content/digests/2026-05-04.md', TARGET_PATH_RE);
});

test('TARGET_PATH_RE: code path skips', () => {
  assert.doesNotMatch('src/lib/util.ts', TARGET_PATH_RE);
});

test('PostToolUse: numeric change emits additionalContext', () => {
  const oldS = '記事の参照は 200 件、d=0.42';
  const newS = '記事の参照は 800 件、d=0.81';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.equal(out.exitCode, 0);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /effect_size|number/);
});

test('PostToolUse: URL change in body fires', () => {
  const oldS = 'see https://nier.go.jp/source';
  const newS = 'see https://wikipedia.org/article';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /url/);
});

test('PostToolUse: prose-only change emits nothing', () => {
  const oldS = '本文 typo';
  const newS = '本文 typo 直し';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test('PostToolUse: code path skips even with numeric change', () => {
  const oldS = 'const N = 200';
  const newS = 'const N = 800';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/lib/util.ts', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test('PostToolUse: stderr remains empty (user not spammed)', () => {
  const oldS = 'd=0.42';
  const newS = 'd=0.81';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.ok(!out.stderr);
});

test('MultiEdit: aggregates token diffs', () => {
  const input = JSON.stringify({
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: 'src/content/digests/2026-05-04.md',
      edits: [
        { old_string: 'foo', new_string: 'bar' },
        { old_string: 'N=200', new_string: 'N=800' },
      ],
    },
  });
  const out = run(input);
  assert.ok(out.stdout);
});

test('Other tool names ignored', () => {
  const out = run(JSON.stringify({ tool_name: 'Write', tool_input: {} }));
  assert.equal(out.exitCode, 0);
  assert.ok(!out.stdout);
});

test('Malformed JSON does not crash', () => {
  const out = run('not json');
  assert.equal(out.exitCode, 0);
});

test('diffTokens: no-op returns empty', () => {
  assert.deepEqual(diffTokens('hello', 'hello'), []);
});
