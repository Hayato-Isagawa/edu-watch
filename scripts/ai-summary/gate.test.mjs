// 正直化ゲート（ADR 0057）の決定的・LLM 非依存テスト。`node --test scripts/ai-summary/` で実行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGate, judgeStrict, buildRetryPrompt } from './fact-check-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const factCheckScript = path.join(scriptDir, 'fact-check-grep.mjs');

// --- computeGate（公開可否ゲートの中核ロジック） ---

test('computeGate: HIGH 必須 fact 欠落で BLOCK', () => {
  const missing = [{ id: 'a', severity: 'HIGH' }, { id: 'b', severity: 'MEDIUM' }];
  const gate = computeGate([], missing, 2);
  assert.equal(gate.status, 'BLOCK');
  assert.equal(gate.missingHigh.length, 1);
  assert.equal(gate.missingMedium.length, 1);
  assert.equal(gate.canonicalPresent, 0);
  assert.equal(gate.total, 2);
});

test('computeGate: 全 present で PASS', () => {
  const present = [{ id: 'a', severity: 'HIGH' }, { id: 'b', severity: 'MEDIUM' }];
  const gate = computeGate(present, [], 2);
  assert.equal(gate.status, 'PASS');
  assert.equal(gate.canonicalPresent, 2);
});

test('computeGate: MEDIUM のみ欠落で WARN（BLOCK させない）', () => {
  const present = [{ id: 'a', severity: 'HIGH' }];
  const missing = [{ id: 'b', severity: 'MEDIUM' }];
  const gate = computeGate(present, missing, 2);
  assert.equal(gate.status, 'WARN');
});

// --- judgeStrict（strict を canonical のみに限定したことの担保） ---

test('judgeStrict: rawChunk に在り canonical 本体に無い fact は llm_dropped', () => {
  const facts = [{ id: 'x', severity: 'HIGH', patterns: [/10:06/], sourceChunks: [1] }];
  const canonicalSummary = '本体要約には高校教諭の在校等時間の具体値が含まれない。';
  const chunkSources = { 1: '高等学校教諭の10月・11月の平日在校等時間は 10:06 である。' };
  const strict = judgeStrict(facts, canonicalSummary, chunkSources);
  assert.equal(strict.details[0].summaryHit, false);
  assert.equal(strict.details[0].rawChunkHit, true);
  assert.equal(strict.details[0].judgment, 'llm_dropped');
  assert.equal(strict.strictPresent, 0);
  assert.equal(strict.llmDropped, 1);
});

// --- buildRetryPrompt（循環回収の遮断：答案数値を不足リストに漏らさない） ---

test('buildRetryPrompt: retryHint 使用時、答案数値が不足リストに漏れない', () => {
  const facts = [{
    id: 'kotogakkou-zaikoutou-1006',
    description: '高等学校教諭 10:06 / 土日 2:14',
    severity: 'MEDIUM',
    retryHint: '高等学校教諭の10・11月の平日・土日の在校等時間',
  }];
  // chunkSources を空にすると、答案数値の出所は description リークのみになる。
  const prompt = buildRetryPrompt('本体要約（数値なし）', facts, {});
  assert.ok(!prompt.includes('10:06'), '答案数値 10:06 が漏れている');
  assert.ok(!prompt.includes('2:14'), '答案数値 2:14 が漏れている');
  assert.ok(prompt.includes('高等学校教諭の10・11月の平日・土日の在校等時間'), 'retryHint が含まれていない');
});

test('buildRetryPrompt: retryHint 欠落でもフォールバックが answer 数値・id を漏らさない', () => {
  const facts = [{
    id: 'kotogakkou-zaikoutou-1006',
    description: '高等学校教諭 10:06 / 土日 2:14',
    severity: 'MEDIUM',
  }];
  const prompt = buildRetryPrompt('本体要約（数値なし）', facts, {});
  assert.ok(!prompt.includes('10:06'), 'フォールバックで答案数値 10:06 が漏れている');
  assert.ok(!prompt.includes('1006'), 'フォールバックで id 由来の数値 1006 が漏れている');
  assert.ok(prompt.includes('必須データ点 1'), 'フォールバック文言が無い');
});

// --- 統合: 実 exit code（computeGate → process.exitCode → CLI の配線） ---

function setupFixture(summaryContent) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  const registry = {
    version: 1,
    entries: [{ slug: 'fixture', sections: [{ section: 's1', chunkRanges: 'cr.json', requiredFacts: 'rf.json' }] }],
  };
  // sourceChunks を空にすると loadAllRawChunkSources が {} を返し、extracted/chunkRanges を読まない最小 fixture になる。
  const facts = [
    { id: 'high-fact', description: 'HIGH データ点', severity: 'HIGH', patterns: ['HIGHマーカー'], sourceChunks: [] },
    { id: 'med-fact', description: 'MEDIUM データ点', severity: 'MEDIUM', patterns: ['MEDIUMマーカー'], sourceChunks: [] },
  ];
  writeFileSync(path.join(tmp, 'registry.json'), JSON.stringify(registry));
  writeFileSync(path.join(tmp, 'rf.json'), JSON.stringify(facts));
  const outDir = path.join(tmp, 'out');
  mkdirSync(path.join(outDir, 's1'), { recursive: true });
  writeFileSync(path.join(outDir, 's1', 'summary.md'), summaryContent);
  return { tmp, outDir };
}

function runFactCheck(tmp, outDir) {
  return spawnSync('node', [
    factCheckScript,
    '--slug', 'fixture',
    '--section', 's1',
    '--skip-retry',
    '--registry', path.join(tmp, 'registry.json'),
    '--out-dir', outDir,
  ], { encoding: 'utf8' });
}

test('統合: HIGH 必須 fact 欠落で fact-check が exit 1（BLOCK）', () => {
  const { tmp, outDir } = setupFixture('この要約にはマーカーが含まれない。');
  const res = runFactCheck(tmp, outDir);
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(res.status, 1);
});

test('統合: HIGH/MEDIUM 全充足で fact-check が exit 0（PASS）', () => {
  const { tmp, outDir } = setupFixture('HIGHマーカー と MEDIUMマーカー を含む完全な要約。');
  const res = runFactCheck(tmp, outDir);
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(res.status, 0);
});
