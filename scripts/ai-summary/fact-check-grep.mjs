import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setGlobalDispatcher, Agent } from 'undici';
import { grepFacts, judgeStrict, buildRetryPrompt, summarizeFact, computeGate } from './fact-check-lib.mjs';

setGlobalDispatcher(new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
}));

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    section: { type: 'string' },
    'skip-retry': { type: 'boolean', default: false },
    registry: { type: 'string', default: './scripts/ai-summary/registry.json' },
    'out-dir': { type: 'string' },
  },
});

if (!values.slug || !values.section) {
  console.error('Usage: fact-check-grep.mjs --slug <slug> --section <section> [--skip-retry] [--registry <path>] [--out-dir <dir>]');
  process.exit(1);
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_GENERATE_URL = `${OLLAMA_BASE_URL}/api/generate`;
const MODEL = process.env.MODEL || 'gemma3:12b';
const NUM_CTX = parseInt(process.env.NUM_CTX || '32768', 10);

const registryPath = path.resolve(values.registry);
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const entry = registry.entries.find((e) => e.slug === values.slug);
if (!entry) {
  console.error(`slug "${values.slug}" not found in ${registryPath}`);
  process.exit(1);
}
const section = entry.sections.find((s) => s.section === values.section);
if (!section) {
  console.error(`section "${values.section}" not found in slug "${values.slug}"`);
  process.exit(1);
}

const baseDir = path.resolve(values['out-dir'] || `./tmp/ai-summary/${values.slug}`);
const sectionDir = path.join(baseDir, values.section);
const summaryPath = path.join(sectionDir, 'summary.md');
const reportPath = path.join(sectionDir, 'fact-check-report.json');
const extractedPath = path.join(baseDir, `extracted-${values.section}.txt`);

const registryDir = path.dirname(registryPath);
const chunkRangesPath = path.resolve(registryDir, section.chunkRanges);
const requiredFactsPath = path.resolve(registryDir, section.requiredFacts);

const SYSTEM = 'あなたは日本の文部科学省が発出する公文書を読み、現場の学校教員にとって有益な要約を作成する編集者です。事実誤認は絶対に避け、文書に書かれていないことは書かないでください。数値・固有名詞・時期はすべて原文と一致させてください。';

async function loadRequiredFacts(p) {
  const raw = JSON.parse(await fs.readFile(p, 'utf8'));
  return raw.map((f) => ({
    ...f,
    patterns: f.patterns.map((s) => new RegExp(s)),
  }));
}

async function loadRawChunkSources(chunkNumbers) {
  const extracted = await fs.readFile(extractedPath, 'utf8');
  const rangesRaw = JSON.parse(await fs.readFile(chunkRangesPath, 'utf8'));
  const ranges = Array.isArray(rangesRaw) ? rangesRaw : rangesRaw[values.section];
  if (!Array.isArray(ranges)) {
    throw new Error(`chunkRanges must be array (or {section: array}) in ${chunkRangesPath}`);
  }
  const pageMarkerRe = /--- page (\d+) \/ \d+ ---/g;
  const matches = [...extracted.matchAll(pageMarkerRe)];
  const pageMap = new Map();
  for (let i = 0; i < matches.length; i++) {
    const pageNum = Number(matches[i][1]);
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : extracted.length;
    pageMap.set(pageNum, extracted.slice(start, end).trim());
  }
  const sources = {};
  for (const n of chunkNumbers) {
    const r = ranges[n - 1];
    if (!r) {
      throw new Error(`chunk ${n} not found in ${chunkRangesPath} (length=${ranges.length})`);
    }
    const parts = [];
    for (let p = r.startPage; p <= r.endPage; p++) {
      const content = pageMap.get(p);
      if (content !== undefined) {
        parts.push(`--- page ${p} / ${pageMap.size} ---\n${content}`);
      }
    }
    sources[n] = parts.join('\n\n');
  }
  return sources;
}

async function loadAllRawChunkSources(facts) {
  const allChunkNumbers = [...new Set(facts.flatMap((f) => f.sourceChunks || []))].sort((a, b) => a - b);
  if (allChunkNumbers.length === 0) return {};
  return await loadRawChunkSources(allChunkNumbers);
}

async function callOllama(prompt) {
  const t0 = Date.now();
  const res = await fetch(OLLAMA_GENERATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      system: SYSTEM,
      prompt,
      stream: true,
      think: false,
      options: { temperature: 0.2, num_ctx: NUM_CTX },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  let fullText = '';
  let finalChunk = null;
  const decoder = new TextDecoder();
  let buf = '';
  for await (const data of res.body) {
    buf += decoder.decode(data, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.response) fullText += j.response;
        if (j.done) finalChunk = j;
      } catch { /* skip */ }
    }
  }
  if (buf.trim()) {
    try {
      const j = JSON.parse(buf);
      if (j.response) fullText += j.response;
      if (j.done) finalChunk = j;
    } catch { /* skip */ }
  }

  return {
    text: fullText,
    elapsedSec: (Date.now() - t0) / 1000,
    promptEvalCount: finalChunk?.prompt_eval_count || 0,
    evalCount: finalChunk?.eval_count || 0,
    promptEvalDurationSec: (finalChunk?.prompt_eval_duration || 0) / 1e9,
    evalDurationSec: (finalChunk?.eval_duration || 0) / 1e9,
  };
}

const facts = await loadRequiredFacts(requiredFactsPath);
console.log(`[facts] loaded ${facts.length} required facts from ${requiredFactsPath}`);

const summary = await fs.readFile(summaryPath, 'utf8');
console.log(`[load] summary ${summary.length} chars from ${summaryPath}`);

const grepInitial = grepFacts(summary, facts);
const present = grepInitial.filter((f) => f.found);
const missing = grepInitial.filter((f) => !f.found);
console.log(`[grep] present ${present.length}/${facts.length}, missing ${missing.length} (ollama=${OLLAMA_BASE_URL})`);
for (const m of missing) {
  console.log(`  [missing] ${m.severity} ${m.id}: ${m.description} (sourceChunks=[${(m.sourceChunks || []).join(', ')}])`);
}

const recoverable = missing.filter((f) => f.sourceChunks && f.sourceChunks.length > 0);
const outOfScope = missing.filter((f) => !f.sourceChunks || f.sourceChunks.length === 0);

// 公開可否ゲート（ADR 0057）。canonical summary.md のみを完全性の正とし、retry recovered は本体未統合のため算入しない。
const gate = computeGate(present, missing, facts.length);

let retryRecord = { attempted: false };
let recovered = [];
let stillMissing = [];

if (recoverable.length === 0) {
  retryRecord = { attempted: false, reason: 'no-recoverable-missing' };
} else if (values['skip-retry']) {
  retryRecord = { attempted: false, reason: 'skip-retry-flag' };
} else {
  const chunkNumbers = [...new Set(recoverable.flatMap((f) => f.sourceChunks))].sort((a, b) => a - b);
  const allChunkSources = await loadRawChunkSources(chunkNumbers);
  console.log(`[retry] missing ${recoverable.length}, chunks [${chunkNumbers.join(', ')}], per-chunk retry (raw)`);
  const perChunkResults = [];
  const recoveredSet = new Set();
  for (const n of chunkNumbers) {
    const single = { [n]: allChunkSources[n] };
    const retryPrompt = buildRetryPrompt(summary, recoverable, single);
    console.log(`[retry chunk ${n}] prompt ${retryPrompt.length} chars`);
    const result = await callOllama(retryPrompt);
    const chunkOutputPath = path.join(sectionDir, `summary-checked-raw.chunk${n}.md`);
    await fs.writeFile(chunkOutputPath, result.text);
    console.log(`[retry chunk ${n} done] ${result.elapsedSec.toFixed(1)}s, output ${result.text.length} chars → ${chunkOutputPath}`);
    const grepAfter = grepFacts(result.text, facts);
    const chunkRecovered = recoverable.filter((f) => grepAfter.find((g) => g.id === f.id && g.found));
    for (const f of chunkRecovered) recoveredSet.add(f.id);
    perChunkResults.push({
      chunk: n,
      promptChars: retryPrompt.length,
      elapsedSec: result.elapsedSec,
      promptEvalCount: result.promptEvalCount,
      evalCount: result.evalCount,
      outputPath: chunkOutputPath,
      outputChars: result.text.length,
      recovered: chunkRecovered.map(summarizeFact),
    });
  }
  recovered = recoverable.filter((f) => recoveredSet.has(f.id));
  stillMissing = recoverable.filter((f) => !recoveredSet.has(f.id));
  retryRecord = {
    attempted: true,
    inputSource: 'raw',
    perChunk: perChunkResults,
    recovered: recovered.map(summarizeFact),
    stillMissing: stillMissing.map(summarizeFact),
  };
}

// strict は canonical summary.md のみを対象に判定（retry 連結を廃止、ADR 0057 D3 が ADR 0054 D1 を supersede）。参考情報であり合否には算入しない。
const allChunkSources = await loadAllRawChunkSources(facts);
const strict = judgeStrict(facts, summary, allChunkSources);

const report = {
  timestamp: new Date().toISOString(),
  slug: values.slug,
  section: values.section,
  summaryPath,
  model: MODEL,
  numCtx: NUM_CTX,
  ollamaBaseUrl: OLLAMA_BASE_URL,
  gate,
  strict,
  initial: {
    total: facts.length,
    present: present.map(summarizeFact),
    missing: missing.map((f) => ({ ...summarizeFact(f), sourceChunks: f.sourceChunks })),
  },
  retry: retryRecord,
  outOfScope: outOfScope.map((f) => ({
    ...summarizeFact(f),
    reason: 'missing-in-chunk (chunk 段階から脱落、ADR 0040 §C-6 編集者最終監修で補完)',
  })),
};

await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`[report] ${reportPath}`);
console.log(`[gate] ${gate.status} — canonical present ${present.length}/${facts.length}, missing HIGH ${gate.missingHigh.length} / MEDIUM ${gate.missingMedium.length}`);
console.log(`[retry/参考] recovered ${recovered.length}, still-missing ${stillMissing.length}, out-of-scope ${outOfScope.length}（advisory・本体未統合）`);
console.log(`[strict/参考] present ${strict.strictPresent}/${strict.totalFacts}, llm_hallucination ${strict.llmHallucinated}, llm_dropped ${strict.llmDropped}, missing ${strict.stillMissingStrict}`);
process.exitCode = gate.status === 'BLOCK' ? 1 : 0;
