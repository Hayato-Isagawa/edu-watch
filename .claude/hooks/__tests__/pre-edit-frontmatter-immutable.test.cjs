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

// --- CLI 配線 -----------------------------------------------------------
//
// 2026-08-09 の独立レビューで、`process.stdout.write(out.stdout)` を消しても
// 既存テストが全て緑のままだと実測された。run() の戻り値だけを見ていると、
// それが exit code と stdout になる経路が死んでも気づけない。
// フックは本番では子プロセスとして起動される。

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const HOOK = path.join(__dirname, '..', 'pre-edit-frontmatter-immutable.cjs');

const editDigest = (oldStr, newStr) =>
  JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/content/digests/2026-08-03.md',
      old_string: oldStr,
      new_string: newStr,
    },
  });

const runCli = (payload) =>
  spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });

test('CLI: 保護フィールドの変更で permissionDecision を stdout に出す', () => {
  const res = runCli(editDigest('weekStart: 2026-08-01', 'weekStart: 2026-09-01'));
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /weekStart/);
});

test('CLI: 変更が無ければ何も出さずに 0 で終わる', () => {
  const res = runCli(editDigest('本文をすこし直した', '本文をもうすこし直した'));
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('CLI: 壊れた入力でも落ちない', () => {
  assert.equal(runCli('{not json').status, 0);
  assert.equal(runCli('').status, 0);
});

// --------------------------------------------------------------- Write 対応
//
// Write は差分ではなくファイル全体が届くので、ディスク上の現物と突き合わせる。
// これが無いと、Edit では捕捉される weekStart / publishedAt / articleId の改変が
// 「全文書き換え」では一切検知されない(2026-08-10 の横断レビューで発覚)。

const fs = require('node:fs');
const os = require('node:os');

let writeCounter = 0;
/** TARGET_PATH_RE にマッチするパスで実ファイルを作る。 */
function digestFile(body) {
  const dir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), `fm-write-${writeCounter++}-`)),
    'src', 'content', 'digests',
  );
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'x.md');
  if (body !== undefined) fs.writeFileSync(p, body);
  return p;
}

const DIGEST_BODY = [
  '---',
  'title: 第 10 号',
  'weekStart: 2026-08-03',
  'weekEnd: 2026-08-09',
  'publishedAt: 2026-08-10',
  '---',
  '',
  '本文',
  '',
].join('\n');

const firedOn = (out) =>
  out.exitCode === 2 || Boolean(out.stdout && out.stdout.includes('permissionDecision'));
const writeOn = (filePath, content) =>
  run(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath, content } }));

test('Write: 保護フィールドが変わったら確認を出す', () => {
  const p = digestFile(DIGEST_BODY);
  const out = writeOn(p, DIGEST_BODY.replace('weekStart: 2026-08-03', 'weekStart: 2026-07-27'));
  assert.ok(firedOn(out), 'Write による全文書き換えを検知できていない');
  assert.match(out.stdout, /weekStart/);
});

test('Write: publishedAt の書き換えも検知する', () => {
  const p = digestFile(DIGEST_BODY);
  assert.ok(firedOn(writeOn(p, DIGEST_BODY.replace('publishedAt: 2026-08-10', 'publishedAt: 2026-08-11'))));
});

test('Write: 保護フィールドが同じなら素通りする', () => {
  const p = digestFile(DIGEST_BODY);
  assert.equal(firedOn(writeOn(p, DIGEST_BODY.replace('本文', '本文を推敲した'))), false);
});

test('Write: 新規作成(ENOENT)は比較対象が無いので素通りする', () => {
  assert.equal(firedOn(writeOn(digestFile(undefined), DIGEST_BODY)), false);
});

test('Write: 現物を読めないときは素通りさせず確認を出す(fail-safe)', () => {
  const p = digestFile(DIGEST_BODY);
  fs.rmSync(p);
  fs.mkdirSync(p); // 同じパスをディレクトリにして EISDIR を起こす
  const out = writeOn(p, DIGEST_BODY);
  assert.ok(firedOn(out), '読めないのに素通りしている');
  assert.match(out.stdout, /unreadable/);
});

test('Write: 対象外のパスは見ない', () => {
  assert.equal(firedOn(writeOn('/tmp/README.md', DIGEST_BODY)), false);
});
