#!/usr/bin/env node
// `node --test "<glob>"` は 1 件もマッチしなくても「tests 0」を出して exit 0 で
// 終わる。テストファイルをリネーム・移動・拡張子変更した瞬間に、CI のステップは
// **緑のまま完全な no-op** に落ちる。守っているつもりのフックが無防備になっても
// 誰も気づけない。
//
// ディレクトリを渡す形(`node --test <dir>`)は exit 1 で落ちるので安全側だが、
// テスト以外のファイルまで実行しようとするため使えない。
//
// そこで実行前にマッチ数を確かめ、0 なら落とす。
//
// 使い方: node scripts/assert-test-files.mjs "<glob>"

import { globSync } from 'node:fs';

const pattern = process.argv[2];

if (!pattern) {
  console.error('usage: assert-test-files.mjs <glob>');
  process.exit(2);
}

const files = globSync(pattern);

if (files.length === 0) {
  console.error(`[assert-test-files] no test files matched: ${pattern}`);
  console.error('[assert-test-files] テストが移動・改名されていないか確認してください。');
  process.exit(1);
}

console.log(`[assert-test-files] ${files.length} file(s) matched: ${pattern}`);
