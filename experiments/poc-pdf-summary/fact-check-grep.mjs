import fs from 'node:fs/promises';
import { setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
}));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL = process.env.MODEL || 'gemma3:12b';
const NUM_CTX = parseInt(process.env.NUM_CTX || '32768', 10);
const SUMMARY_PATH = process.env.SUMMARY_PATH || './summary-v3.md';
const CHUNK_PATH_TEMPLATE = process.env.CHUNK_PATH_TEMPLATE || './chunk-{N}-v3.md';
const OUTPUT_PATH = process.env.OUTPUT_PATH || './summary-v3-checked.md';
const REPORT_PATH = process.env.REPORT_PATH || './fact-check-grep-report.json';
const SKIP_RETRY = process.env.SKIP_RETRY === 'true';
const REQUIRED_FACTS_PATH = process.env.REQUIRED_FACTS_PATH || '';
const INPUT_SOURCE = process.env.INPUT_SOURCE || 'raw';
const EXTRACTED_PATH = process.env.EXTRACTED_PATH || './extracted.txt';
const CHUNK_RANGES_PATH = process.env.CHUNK_RANGES_PATH || './chunk-ranges-v3.json';

const SYSTEM = 'あなたは日本の文部科学省が発出する公文書を読み、現場の学校教員にとって有益な要約を作成する編集者です。事実誤認は絶対に避け、文書に書かれていないことは書かないでください。数値・固有名詞・時期はすべて原文と一致させてください。';

const REQUIRED_FACTS = [
  {
    id: 'salary-adjustment-10pct',
    description: '教職調整額 10% 以上(現行 4%)',
    severity: 'CRITICAL',
    patterns: [
      /教職調整額[^。\n]{0,40}(10|十)\s*[%％]/,
      /(10|十)\s*[%％][^。\n]{0,40}教職調整額/,
    ],
    sourceChunks: [4],
  },
  {
    id: 'overtime-month-45h',
    description: '時間外在校等時間 月45時間以内',
    severity: 'CRITICAL',
    patterns: [/(月|1か月|一か月)\s*45\s*時間/],
    sourceChunks: [2],
  },
  {
    id: 'overtime-year-360h',
    description: '時間外在校等時間 年360時間以内',
    severity: 'CRITICAL',
    patterns: [/(年|年間|1年間)\s*360\s*時間/],
    sourceChunks: [2],
  },
  {
    id: 'work-survey-41-58-6years',
    description: '教員勤務実態調査 月41h(小)・月58h(中)・6 年で 3 割減',
    severity: 'CRITICAL',
    patterns: [
      /(小学校|小)[^。\n]{0,100}41\s*時間[\s\S]{0,500}(中学校|中)[^。\n]{0,100}58\s*時間/,
      /(中学校|中)[^。\n]{0,100}58\s*時間[\s\S]{0,500}(小学校|小)[^。\n]{0,100}41\s*時間/,
      /(6|六)\s*年[^。\n]{0,10}(3|三)\s*割/,
    ],
    sourceChunks: [2],
  },
  {
    id: 'subject-teacher-9400',
    description: '教科担任制 9,400 人定数措置',
    severity: 'HIGH',
    patterns: [/9,?400\s*人/],
    sourceChunks: [3],
  },
  {
    id: 'karoshi-line-80h',
    description: '過労死ライン 月80時間',
    severity: 'CRITICAL',
    patterns: [
      /過労死[^。\n]{0,30}(月|1か月)?\s*80\s*時間/,
      /(月|1か月)\s*80\s*時間[^。\n]{0,30}過労死/,
      /(月|1か月)\s*80\s*時間(超|以上|を超)/,
    ],
    sourceChunks: [1, 2, 3],
  },
  {
    id: 'class-size-35-r7',
    description: '35人学級 令和7年度までに段階的移行',
    severity: 'HIGH',
    patterns: [
      /35\s*人[^。\n]{0,10}学級/,
      /学級[^。\n]{0,30}35\s*人/,
    ],
    sourceChunks: [3, 5],
  },
  {
    id: 'teacher-cert-info-r6',
    description: '教員資格認定試験(情報)令和6年度再開',
    severity: 'LOW',
    patterns: [/教員資格認定試験/],
    sourceChunks: [4, 5],
  },
  {
    id: 'mental-illness-6539',
    description: '精神疾患による病気休職教師 6,539 人(令和4年度)',
    severity: 'LOW',
    patterns: [/6,?539\s*人/],
    sourceChunks: [1, 3],
  },
];

async function loadFile(p) {
  return await fs.readFile(p, 'utf8');
}

async function loadRawChunkSources(chunkNumbers) {
  const extracted = await loadFile(EXTRACTED_PATH);
  const ranges = JSON.parse(await loadFile(CHUNK_RANGES_PATH));
  const pageMarker = /\n?--- page \d+ \/ \d+ ---\n?/;
  const rawPages = extracted.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
  const sources = {};
  for (const n of chunkNumbers) {
    const r = ranges[n - 1];
    if (!r) {
      throw new Error(`chunk ${n} not found in ${CHUNK_RANGES_PATH} (length=${ranges.length})`);
    }
    const slice = rawPages.slice(r.startPage - 1, r.endPage);
    const body = slice
      .map((p, idx) => `--- page ${r.startPage + idx} / ${rawPages.length} ---\n${p}`)
      .join('\n\n');
    sources[n] = body;
  }
  return sources;
}

async function loadRequiredFacts(path) {
  const raw = JSON.parse(await fs.readFile(path, 'utf8'));
  return raw.map((f) => ({
    ...f,
    patterns: f.patterns.map((s) => new RegExp(s)),
  }));
}

function grepFacts(text, facts) {
  const norm = text.normalize('NFKC');
  return facts.map((f) => ({
    ...f,
    found: f.patterns.some((re) => re.test(norm)),
  }));
}

function buildRetryPrompt(summary, missingFacts, chunkSources, sourceLabel = 'chunk-{N}-v3.md') {
  const missingList = missingFacts
    .map((f, i) => `${i + 1}. ${f.description}`)
    .join('\n');
  const chunkExcerpts = Object.entries(chunkSources)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([n, text]) => `## ${sourceLabel.replace('{N}', String(n))}\n\n${text}`)
    .join('\n\n---\n\n');

  return `あなたは中央教育審議会答申の要約編集者です。以下の要約には核心数値が脱落しています。chunk 抜粋メモから不足数値を保持しながら、要約全体を再生成してください。

# 不足している必須数値

${missingList}

# 制約

- 元の 4 セクション構造(「1. 何が決まったか」「2. いつから実施されるか」「3. 現場で必要な対応」「4. 参照すべき PDF ページ」)を維持
- 不足数値は本文中に必ず組み込み、出典ページを (p.X) 形式で併記
- 圧縮しないでください(出力長は元の要約と同等以上)
- chunk 抜粋メモにない内容、推測、一般論は書かない
- 数値・固有名詞・時期は原文と一致させてください

# 元の要約

${summary}

# 該当 chunk 抜粋メモ

${chunkExcerpts}`;
}

async function callOllama(prompt) {
  const t0 = Date.now();
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      system: SYSTEM,
      prompt,
      stream: true,
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
      } catch {
        /* skip partial json */
      }
    }
  }
  if (buf.trim()) {
    try {
      const j = JSON.parse(buf);
      if (j.response) fullText += j.response;
      if (j.done) finalChunk = j;
    } catch {
      /* skip */
    }
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

function summarizeFact(f) {
  return { id: f.id, severity: f.severity, description: f.description };
}

async function main() {
  const facts = REQUIRED_FACTS_PATH
    ? await loadRequiredFacts(REQUIRED_FACTS_PATH)
    : REQUIRED_FACTS;
  if (REQUIRED_FACTS_PATH) {
    console.log(`[facts] loaded ${facts.length} required facts from ${REQUIRED_FACTS_PATH}`);
  }

  const summary = await loadFile(SUMMARY_PATH);
  console.log(`[load] summary ${summary.length} chars from ${SUMMARY_PATH}`);

  const grepInitial = grepFacts(summary, facts);
  const present = grepInitial.filter((f) => f.found);
  const missing = grepInitial.filter((f) => !f.found);
  console.log(`[grep] present ${present.length}/${facts.length}, missing ${missing.length}`);
  for (const m of missing) {
    console.log(`  [missing] ${m.severity} ${m.id}: ${m.description} (sourceChunks=[${m.sourceChunks.join(', ')}])`);
  }

  const recoverable = missing.filter((f) => f.sourceChunks.length > 0);
  const outOfScope = missing.filter((f) => f.sourceChunks.length === 0);

  let retryRecord = { attempted: false };
  let recovered = [];
  let stillMissing = [];

  if (recoverable.length === 0) {
    retryRecord = { attempted: false, reason: 'no-recoverable-missing' };
  } else if (SKIP_RETRY) {
    retryRecord = { attempted: false, reason: 'skip-retry-flag' };
  } else if (INPUT_SOURCE === 'raw') {
    const chunkNumbers = [...new Set(recoverable.flatMap((f) => f.sourceChunks))].sort((a, b) => a - b);
    const allChunkSources = await loadRawChunkSources(chunkNumbers);
    console.log(`[retry raw] missing ${recoverable.length}, chunks [${chunkNumbers.join(', ')}], per-chunk retry`);
    const perChunkResults = [];
    const recoveredSet = new Set();
    for (const n of chunkNumbers) {
      const single = { [n]: allChunkSources[n] };
      const retryPrompt = buildRetryPrompt(summary, recoverable, single, 'extracted.txt (chunk-{N} raw)');
      console.log(`[retry chunk ${n}] prompt ${retryPrompt.length} chars`);
      const result = await callOllama(retryPrompt);
      const chunkOutputPath = OUTPUT_PATH.replace(/\.md$/, '') + `.chunk${n}.md`;
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
  } else {
    const chunkNumbers = [...new Set(recoverable.flatMap((f) => f.sourceChunks))].sort((a, b) => a - b);
    const chunkSources = {};
    for (const n of chunkNumbers) {
      chunkSources[n] = await loadFile(CHUNK_PATH_TEMPLATE.replace('{N}', String(n)));
    }
    const retryPrompt = buildRetryPrompt(summary, recoverable, chunkSources);
    console.log(`[retry] missing ${recoverable.length}, chunks [${chunkNumbers.join(', ')}], prompt ${retryPrompt.length} chars`);
    const result = await callOllama(retryPrompt);
    await fs.writeFile(OUTPUT_PATH, result.text);
    console.log(`[retry done] ${result.elapsedSec.toFixed(1)}s, output ${result.text.length} chars → ${OUTPUT_PATH}`);

    const grepAfter = grepFacts(result.text, facts);
    recovered = recoverable.filter((f) => grepAfter.find((g) => g.id === f.id && g.found));
    stillMissing = recoverable.filter((f) => !grepAfter.find((g) => g.id === f.id && g.found));
    retryRecord = {
      attempted: true,
      inputSource: 'summary',
      promptChars: retryPrompt.length,
      elapsedSec: result.elapsedSec,
      promptEvalCount: result.promptEvalCount,
      evalCount: result.evalCount,
      outputChars: result.text.length,
      recovered: recovered.map(summarizeFact),
      stillMissing: stillMissing.map(summarizeFact),
    };
  }

  const report = {
    timestamp: new Date().toISOString(),
    summaryPath: SUMMARY_PATH,
    outputPath: retryRecord.attempted ? OUTPUT_PATH : null,
    model: MODEL,
    numCtx: NUM_CTX,
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

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`[report] ${REPORT_PATH}`);
  const finalPresent = present.length + recovered.length;
  console.log(`[final] present ${present.length} → after retry ${finalPresent}/${facts.length}, out-of-scope ${outOfScope.length}, still-missing ${stillMissing.length}`);
}

await main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
