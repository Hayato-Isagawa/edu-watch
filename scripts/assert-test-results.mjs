#!/usr/bin/env node
// `assert-test-files.mjs` はテストファイルが**在ること**しか見ない。
// ところが `node --test` は次のどれでも exit 0 で終わる:
//
//   - glob が 0 件マッチ        → assert-test-files.mjs が止める
//   - ファイルは在るが中身が空  → 「tests 0」で緑
//   - 全件 test.skip            → 「pass 0 / skipped N」で緑
//
// 後ろ 2 つは、テストを消した / 一時的に skip して戻し忘れた、という
// ごく普通の操作で起きる。守っているつもりのガードが CI では
// 完全な no-op に落ちているのに、誰も気づけない。
//
// そこで実行結果そのものを検査する。TAP の集計行を読み、
// pass が下限を割るか、skip / todo が 1 件でもあれば落とす。
//
// 使い方: node scripts/assert-test-results.mjs <min-pass> "<glob>"

import { spawnSync } from 'node:child_process';

const [minPassRaw, pattern] = process.argv.slice(2);
const minPass = Number(minPassRaw);

if (!Number.isInteger(minPass) || minPass < 1 || !pattern) {
  console.error('usage: assert-test-results.mjs <min-pass> "<glob>"');
  process.exit(2);
}

const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', pattern], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

process.stdout.write(res.stdout ?? '');

if (res.error) {
  console.error(`[assert-test-results] テストランナーを起動できませんでした: ${res.error.message}`);
  process.exit(1);
}

const count = (label) => {
  const m = (res.stdout ?? '').match(new RegExp(`^# ${label} (\\d+)$`, 'm'));
  return m ? Number(m[1]) : null;
};

const pass = count('pass');
const fail = count('fail');
const skipped = count('skipped');
const todo = count('todo');

if (pass === null || fail === null) {
  console.error('[assert-test-results] TAP の集計行を読めませんでした。');
  process.exit(1);
}

const problems = [];
if (fail > 0) problems.push(`${fail} 件が失敗`);
if (pass < minPass) problems.push(`pass ${pass} 件が下限 ${minPass} を下回る`);
if (skipped) problems.push(`${skipped} 件が skip されている`);
if (todo) problems.push(`${todo} 件が todo になっている`);

if (problems.length) {
  console.error(`[assert-test-results] ${problems.join(' / ')}`);
  console.error('[assert-test-results] テストが消えた・skip されたままになっていないか確認してください。');
  process.exit(1);
}

console.log(`[assert-test-results] pass ${pass} 件(下限 ${minPass})、skip / todo なし`);
