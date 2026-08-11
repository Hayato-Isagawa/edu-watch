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

// --- CLI 配線 -------------------------------------------------------------
//
// ここまでのテストは run() の戻り値しか見ていない。それが stdout と exit code に
// なる経路が死んでも全部緑のまま通る。フックは本番では子プロセスとして起動される。

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const HOOK = path.join(__dirname, '..', 'post-edit-roundtrip-spot-check.cjs');

const runCli = (payload) =>
  spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });

const multiEdit = (edits) => JSON.stringify({
  tool_name: 'MultiEdit',
  tool_input: { file_path: 'src/content/digests/2026-08-03.md', edits },
});

test('CLI: additionalContext を stdout に出す', () => {
  const res = runCli(multiEdit([{ old_string: 'N=200', new_string: 'N=800' }]));
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /number/);
});

// --- 付随出力が切れないこと ------------------------------------------------
//
// **`process.exit()` は非同期の stdout を flush しない。** stdout がパイプのとき
// write は非同期なので、直後に exit すると書き残しが捨てられ、JSON がちょうど
// 65536B(パイプバッファ)で切れる。
//
// PostToolUse は additionalContext しか返さないので ask を落とすことは無いが、
// 切れた JSON はディスパッチャが黙って捨てるので **nudge が無音で消える**。
//
// `fmtList` は 1 診断あたり 4 件で打ち切るが、**打ち切るのは件数だけ**で
// 1 トークンの長さにも MultiEdit の編集数にも上限が無い。編集ごとに別の
// 診断行が出るので、編集を重ねれば境界に届く(実測: 102 編集で 65,536B を跨ぐ。
// 下のフィクスチャは 120 編集)。
const longUrls = (tag, n) =>
  Array.from(
    { length: n },
    (_, i) => `https://www.mext.go.jp/b_menu/houdou/${tag}/mext_syoto01-000028${String(i).padStart(4, '0')}_01.html`,
  ).join(' ');

const bigMultiEdit = (count) =>
  multiEdit(Array.from({ length: count }, (_, i) => ({
    old_string: longUrls(`before${i}`, 4),
    new_string: longUrls(`after${i}`, 4),
  })));

test('CLI: 付随出力が 64KB を超えても stdout が切れない', () => {
  const res = runCli(bigMultiEdit(120));

  assert.equal(res.status, 0);

  // **JSON.parse を先に置く。** サイズ検査を先にすると、切断された stdout は
  // ちょうど 65536B なので「フィクスチャが小さい」と読めるメッセージで落ち、
  // **本数を増やす方向に誤誘導する**。末尾の固定文も見て、切れた JSON が
  // たまたま構文的に閉じている場合を潰す。
  const parsed = JSON.parse(res.stdout);
  assert.match(
    parsed.hookSpecificOutput.additionalContext,
    /ask the user before further edits\.$/,
  );

  // ここに来た時点で JSON は無傷。残る失敗は「フィクスチャが境界に届いていない」だけ。
  assert.ok(
    Buffer.byteLength(res.stdout) > 65536,
    `フィクスチャがパイプバッファ(65536B)に届いていない(${Buffer.byteLength(res.stdout)}B)。編集の本数を増やすこと`,
  );
});
