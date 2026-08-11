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

// **`process.exit()` を使わない。** stdout がパイプのとき write は非同期なので、
// 直後に exit すると書き残しが捨てられ、中継した TAP がちょうど 65536B
// (パイプバッファ)で切れる。**切れるのは末尾**なので、診断に要る `# pass` /
// `# fail` の集計行がちょうど消える。ゲートは赤のままなので見逃しではないが、
// 「なぜ落ちたか」が読めなくなる(2026-08-11 に実測。macOS 固有 —
// Linux の pipe への書き込みは同期なので CI では起きない)。
// exitCode を返して Node に flush させるため、本体を関数にして return で抜ける。
function main() {
  const [minPassRaw, pattern] = process.argv.slice(2);
  const minPass = Number(minPassRaw);

  if (!Number.isInteger(minPass) || minPass < 1 || !pattern) {
    console.error('usage: assert-test-results.mjs <min-pass> "<glob>"');
    return 2;
  }

  const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', pattern], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  process.stdout.write(res.stdout ?? '');

  if (res.error) {
    console.error(`[assert-test-results] テストランナーを起動できませんでした: ${res.error.message}`);
    return 1;
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
    return 1;
  }

  const problems = [];
  if (fail > 0) problems.push(`${fail} 件が失敗`);
  if (pass < minPass) problems.push(`pass ${pass} 件が下限 ${minPass} を下回る`);
  if (skipped) problems.push(`${skipped} 件が skip されている`);
  if (todo) problems.push(`${todo} 件が todo になっている`);

  if (problems.length) {
    console.error(`[assert-test-results] ${problems.join(' / ')}`);
    console.error('[assert-test-results] テストが消えた・skip されたままになっていないか確認してください。');
    return 1;
  }

  console.log(`[assert-test-results] pass ${pass} 件(下限 ${minPass})、skip / todo なし`);
  return 0;
}

process.exitCode = main();
