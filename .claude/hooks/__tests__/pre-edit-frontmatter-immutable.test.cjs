'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  run,
  extractFrontmatter,
  captureProtectedFields,
  diffMaps,
  TARGET_PATH_RE,
} = require('../pre-edit-frontmatter-immutable.cjs');

test('TARGET_PATH_RE: matches digests path', () => {
  assert.match('src/content/digests/2026-05-04.md', TARGET_PATH_RE);
  assert.match('/Users/H/edu-watch/src/content/digests/2026-05-04.md', TARGET_PATH_RE);
});

test('TARGET_PATH_RE: rejects non-digest paths', () => {
  assert.doesNotMatch('src/content/strategies/x.md', TARGET_PATH_RE);
  assert.doesNotMatch('docs/decisions/0001.md', TARGET_PATH_RE);
});

test('captureProtectedFields: top-level digest fields', () => {
  const fm = [
    'title: 2026 Week 18',
    'weekStart: "2026-04-27"',
    'weekEnd: "2026-05-03"',
    'publishedAt: "2026-05-03T20:00:00+09:00"',
  ].join('\n');
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get('title'), ['2026 Week 18']);
  assert.deepEqual(m.get('weekStart'), ['2026-04-27']);
  assert.deepEqual(m.get('weekEnd'), ['2026-05-03']);
  assert.deepEqual(m.get('publishedAt'), ['2026-05-03T20:00:00+09:00']);
});

test('captureProtectedFields: articleId in sections', () => {
  const fm = [
    'sections:',
    '  - articleId: a-001',
    '    heading: x',
    '  - articleId: a-002',
    '    heading: y',
  ].join('\n');
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get('articleId'), ['a-001', 'a-002']);
});

test('captureProtectedFields: URL set captured from frontmatter', () => {
  const fm = [
    'relatedEvidenceUrls:',
    '  - https://example.com/a',
    '  - https://example.com/b',
  ].join('\n');
  const m = captureProtectedFields(fm);
  assert.deepEqual(m.get('__urls__'), ['https://example.com/a', 'https://example.com/b']);
});

test('Edit: weekStart change fires ask', () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n';
  const newS = '---\nweekStart: "2026-04-20"\n---\n';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.equal(out.exitCode, 0);
  assert.ok(out.stdout);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /weekStart/);
});

test('Edit: articleId change fires ask', () => {
  const oldS = '---\nsections:\n  - articleId: a-001\n---\n';
  const newS = '---\nsections:\n  - articleId: a-099\n---\n';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /articleId/);
});

test('Edit: relatedEvidenceUrls swap fires (urls block)', () => {
  const oldS = [
    '---',
    'relatedEvidenceUrls:',
    '  - https://nier.go.jp/a',
    '---',
  ].join('\n') + '\n';
  const newS = [
    '---',
    'relatedEvidenceUrls:',
    '  - https://wikipedia.org/b',
    '---',
  ].join('\n') + '\n';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /urls/);
});

test('Edit: prose-only body change does not fire', () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n\n本文 typo。';
  const newS = '---\nweekStart: "2026-04-27"\n---\n\n本文 typo を直した。';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.equal(out.exitCode, 0);
  assert.ok(!out.stdout);
});

test('Edit: summary change does not fire (not protected)', () => {
  const oldS = '---\ntitle: x\nsummary: 古い\n---\n';
  const newS = '---\ntitle: x\nsummary: 新しい\n---\n';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'src/content/digests/2026-05-04.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test('Edit on non-digest path: skips entirely', () => {
  const oldS = '---\nweekStart: "2026-04-27"\n---\n';
  const newS = '---\nweekStart: "2026-04-20"\n---\n';
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: 'docs/decisions/0001.md', old_string: oldS, new_string: newS },
  });
  const out = run(input);
  assert.ok(!out.stdout);
});

test('MultiEdit: combines edits and fires when any protected', () => {
  const input = JSON.stringify({
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: 'src/content/digests/2026-05-04.md',
      edits: [
        { old_string: '本文 typo', new_string: '本文 typo 直し' },
        { old_string: 'weekStart: "2026-04-27"', new_string: 'weekStart: "2026-04-20"' },
      ],
    },
  });
  const out = run(input);
  assert.ok(out.stdout);
});

test('Malformed JSON does not crash', () => {
  const out = run('not json');
  assert.equal(out.exitCode, 0);
});

test('Other tool names ignored', () => {
  const out = run(JSON.stringify({ tool_name: 'Bash', tool_input: {} }));
  assert.equal(out.exitCode, 0);
});
