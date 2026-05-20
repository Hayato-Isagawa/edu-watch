import fs from 'node:fs/promises';
import { setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
}));

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = process.env.MODEL || 'gemma3:12b';
const NUM_CTX = parseInt(process.env.NUM_CTX || '32768', 10);

const SECTION = process.env.SECTION;
if (!SECTION) {
  console.error('SECTION env var required (honbun | betsutenpu-2 | betsutenpu-3)');
  process.exit(1);
}

const SECTIONS_META = {
  'honbun': {
    label: '通知本文',
    desc: '令和6年8月27日付け文部科学省通知「『令和の日本型学校教育』を担う質の高い教師の確保のための環境整備に関する総合的な方策について(答申)を踏まえた取組の徹底等について」の通知本文',
  },
  'betsutenpu-2': {
    label: '別添資料2',
    desc: '上記通知に添付された別添資料２「教師を取り巻く環境整備に関する総合的な推進パッケージ」',
  },
  'betsutenpu-3': {
    label: '別添資料3',
    desc: '上記通知に添付された別添資料３「令和7年度概算要求」',
  },
};
const SECTION_META = SECTIONS_META[SECTION];
if (!SECTION_META) {
  console.error(`Unknown SECTION: ${SECTION}`);
  process.exit(1);
}

const CHUNK_RANGES_PATH = process.env.CHUNK_RANGES_PATH || './chunk-ranges-v4-tsuuchi.json';
const EXTRACTED_PATH = process.env.EXTRACTED_PATH || `./extracted-tsuuchi-${SECTION}.txt`;
const V = process.env.V || `v4-tsuuchi-${SECTION}`;

const allRanges = JSON.parse(await fs.readFile(CHUNK_RANGES_PATH, 'utf8'));
const CHUNK_RANGES = allRanges[SECTION];
if (!CHUNK_RANGES) {
  console.error(`Section ${SECTION} not found in ${CHUNK_RANGES_PATH}`);
  process.exit(1);
}
console.log(`[ranges] section=${SECTION}, ${CHUNK_RANGES.length} chunks loaded from ${CHUNK_RANGES_PATH}`);

const text = await fs.readFile(EXTRACTED_PATH, 'utf8');
const pageMarkerRe = /--- page (\d+) \/ (\d+) ---/g;
const markers = [...text.matchAll(pageMarkerRe)];
if (markers.length === 0) {
  console.error('[error] no page markers found in extracted file');
  process.exit(1);
}
const totalPdfPages = parseInt(markers[0][2], 10);
const pages = markers.map((m, i) => {
  const start = m.index + m[0].length;
  const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
  return { pageNum: parseInt(m[1], 10), content: text.slice(start, end).trim() };
});
console.log(`[parse] ${pages.length} pages parsed (PDF total=${totalPdfPages}), model=${MODEL}, num_ctx=${NUM_CTX}`);

const chunks = CHUNK_RANGES.map(({ startPage, endPage }) => {
  const slice = pages.filter((p) => p.pageNum >= startPage && p.pageNum <= endPage);
  const body = slice
    .map((p) => `--- page ${p.pageNum} / ${totalPdfPages} ---\n${p.content}`)
    .join('\n\n');
  return { startPage, endPage, text: body, chars: body.length };
});
console.log(`[chunks] ${chunks.length} chunks, sizes=[${chunks.map((c) => c.chars).join(', ')}]`);

const SYSTEM = 'あなたは日本の文部科学省が発出する公文書を読み、現場の学校教員にとって有益な要約を作成する編集者です。事実誤認は絶対に避け、文書に書かれていないことは書かないでください。数値・固有名詞・時期はすべて原文と一致させてください。';

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

const mapResults = [];
for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  console.log(`[map ${i + 1}/${chunks.length}] pages ${c.startPage}-${c.endPage}, ${c.chars} chars`);
  const prompt = `以下は${SECTION_META.desc}のうち、p.${c.startPage}〜p.${c.endPage}部分です。

この範囲で「学校教員にとって重要な決定事項・数値・期限・固有名詞」を、原文の表現に忠実な箇条書きで抽出してください。各項目末尾に必ず該当ページ番号を「(p.X)」形式で付してください。文書に書かれていない内容、推測、一般論は一切書かないでください。

# 範囲(p.${c.startPage}〜p.${c.endPage})

${c.text}`;
  const r = await callOllama(prompt);
  mapResults.push({ chunk: c, ...r });
  await fs.writeFile(
    `./chunk-${i + 1}-${V}.md`,
    `# Chunk ${i + 1}: pages ${c.startPage}-${c.endPage} (${c.chars} chars, model=${MODEL})\n\n## Metrics\n- elapsed: ${r.elapsedSec.toFixed(1)}s\n- prompt_eval: ${r.promptEvalCount} tokens / ${r.promptEvalDurationSec.toFixed(1)}s\n- eval: ${r.evalCount} tokens / ${r.evalDurationSec.toFixed(1)}s (${(r.evalCount / r.evalDurationSec).toFixed(2)} tok/s)\n\n## Summary\n\n${r.text}\n`,
  );
  console.log(`  done: ${r.elapsedSec.toFixed(1)}s, prompt=${r.promptEvalCount}t, eval=${r.evalCount}t`);
}

const coveredPagesText = chunks.length === 1
  ? `p.${chunks[0].startPage}-${chunks[0].endPage}`
  : `p.${chunks[0].startPage}-${chunks[chunks.length - 1].endPage}`;

const reduceInput = mapResults
  .map((m, i) => `## Chunk ${i + 1} (pages ${m.chunk.startPage}-${m.chunk.endPage})\n\n${m.text}`)
  .join('\n\n---\n\n');

const reducePrompt = `以下は${SECTION_META.desc}(${coveredPagesText})を分割した各部の抜粋メモです。これらを統合し、現場の学校教員に向けた 4 軸構造化要約を Markdown で作成してください。各事実の末尾には抜粋メモ由来のページ番号(p.X)を必ず付けてください。

# 重要な統合原則

- 抜粋メモに含まれる重要数値(金額、人数、時期、率、件数等)は **必ず本文に組み込み、reduce で圧縮しない** でください。
- 抜粋メモに記載のない内容、推測、一般論は一切書かないでください。

# 出力フォーマット

## 1. 何が決まったか
(${SECTION_META.label}の核心、5-10 行、各行末尾に該当ページ。重要数値を必ず含めること)

## 2. いつから実施されるか
(時期・期限、明示されていなければ「明示なし」と書く)

## 3. 現場で必要な対応
(学校・教員が取るべき具体的アクション、5-10 行、各行末尾に該当ページ)

## 4. 参照すべき PDF ページ
(主要論点 5 つを「論点 → p.X」形式でリスト)

# 抜粋メモ

${reduceInput}`;

console.log(`[reduce] integrating ${mapResults.length} chunk summaries, prompt ${reducePrompt.length} chars`);
const reduce = await callOllama(reducePrompt);
await fs.writeFile(`./summary-${V}.md`, reduce.text);
console.log(`[reduce done] ${reduce.elapsedSec.toFixed(1)}s, prompt=${reduce.promptEvalCount}t, eval=${reduce.evalCount}t`);

const totalMapElapsed = mapResults.reduce((s, r) => s + r.elapsedSec, 0);
const metrics = {
  source: `mapreduce-${V}.mjs`,
  section: SECTION,
  sectionLabel: SECTION_META.label,
  model: MODEL,
  numCtx: NUM_CTX,
  pdfPages: totalPdfPages,
  extractedChars: text.length,
  chunkRanges: CHUNK_RANGES,
  chunks: mapResults.map((r) => ({
    pages: `${r.chunk.startPage}-${r.chunk.endPage}`,
    chars: r.chunk.chars,
    elapsedSec: r.elapsedSec,
    promptEvalCount: r.promptEvalCount,
    evalCount: r.evalCount,
    tokensPerSec: r.evalDurationSec ? r.evalCount / r.evalDurationSec : 0,
  })),
  reduce: {
    elapsedSec: reduce.elapsedSec,
    promptEvalCount: reduce.promptEvalCount,
    evalCount: reduce.evalCount,
    tokensPerSec: reduce.evalDurationSec ? reduce.evalCount / reduce.evalDurationSec : 0,
  },
  totalElapsedSec: totalMapElapsed + reduce.elapsedSec,
  totalLLMCalls: mapResults.length + 1,
  outputChars: reduce.text.length,
};
await fs.writeFile(`./metrics-${V}.json`, JSON.stringify(metrics, null, 2));
console.log(`[done] total=${metrics.totalElapsedSec.toFixed(1)}s, calls=${metrics.totalLLMCalls}, output=${metrics.outputChars}chars`);
