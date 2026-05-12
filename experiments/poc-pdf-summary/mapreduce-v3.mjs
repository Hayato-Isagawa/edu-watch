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
const V = process.env.V || 'v3';
const CHUNK_RANGES_PATH = process.env.CHUNK_RANGES_PATH || '';
const EXTRACTED_PATH = process.env.EXTRACTED_PATH || './extracted.txt';

const DEFAULT_CHUNK_RANGES = [
  { startPage: 1, endPage: 15 },
  { startPage: 16, endPage: 30 },
  { startPage: 31, endPage: 45 },
  { startPage: 46, endPage: 60 },
  { startPage: 61, endPage: 67 },
];

const CHUNK_RANGES = CHUNK_RANGES_PATH
  ? JSON.parse(await fs.readFile(CHUNK_RANGES_PATH, 'utf8'))
  : DEFAULT_CHUNK_RANGES;
if (CHUNK_RANGES_PATH) {
  console.log(`[ranges] loaded ${CHUNK_RANGES.length} chunk ranges from ${CHUNK_RANGES_PATH}`);
}

const text = await fs.readFile(EXTRACTED_PATH, 'utf8');
const pageMarker = /\n?--- page \d+ \/ \d+ ---\n?/;
const rawPages = text.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
console.log(`[split] ${rawPages.length} pages, model=${MODEL}, num_ctx=${NUM_CTX}`);

const chunks = CHUNK_RANGES.map(({ startPage, endPage }) => {
  const slice = rawPages.slice(startPage - 1, endPage);
  const body = slice
    .map((p, idx) => `--- page ${startPage + idx} / ${rawPages.length} ---\n${p}`)
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
  const prompt = `以下は中央教育審議会答申「『令和の日本型学校教育』を担う質の高い教師の確保のための環境整備に関する総合的な方策について」(令和6年8月27日、第251号、全${rawPages.length}ページ)のうち、${c.startPage}〜${c.endPage}ページ部分です。

この範囲で「学校教員にとって重要な決定事項・数値・期限・固有名詞」を、原文の表現に忠実な箇条書きで抽出してください。各項目末尾に必ず該当ページ番号を「(p.X)」形式で付してください。文書に書かれていない内容、推測、一般論は一切書かないでください。

# 範囲(${c.startPage}〜${c.endPage}ページ)

${c.text}`;
  const r = await callOllama(prompt);
  mapResults.push({ chunk: c, ...r });
  await fs.writeFile(
    `./chunk-${i + 1}-${V}.md`,
    `# Chunk ${i + 1}: pages ${c.startPage}-${c.endPage} (${c.chars} chars, model=${MODEL})\n\n## Metrics\n- elapsed: ${r.elapsedSec.toFixed(1)}s\n- prompt_eval: ${r.promptEvalCount} tokens / ${r.promptEvalDurationSec.toFixed(1)}s\n- eval: ${r.evalCount} tokens / ${r.evalDurationSec.toFixed(1)}s (${(r.evalCount / r.evalDurationSec).toFixed(2)} tok/s)\n\n## Summary\n\n${r.text}\n`,
  );
  console.log(`  done: ${r.elapsedSec.toFixed(1)}s, prompt=${r.promptEvalCount}t, eval=${r.evalCount}t`);
}

const reduceInput = mapResults
  .map((m, i) => `## Chunk ${i + 1} (pages ${m.chunk.startPage}-${m.chunk.endPage})\n\n${m.text}`)
  .join('\n\n---\n\n');

const reducePrompt = `以下は中央教育審議会答申(令和6年8月27日、第251号、全${rawPages.length}ページ)を分割した各部の抜粋メモです(pages 68-73 は PDF 末尾の文字化け領域のため除外済み、抜粋は pages 1-67 をカバー)。これらを統合し、現場の学校教員に向けた 4 軸構造化要約を Markdown で作成してください。各事実の末尾には抜粋メモ由来のページ番号(p.X)を必ず付けてください。

# 重要な統合原則

- 特定の chunk(章)に偏らず、5 chunk すべての論点を均等に拾ってください。
- 抜粋メモに含まれる重要数値は **必ず本文に組み込み、reduce で圧縮しない** でください。特に下記のような数値が抜粋メモに存在する場合は、必ず最終要約に保持してください:
  - 教職調整額の率(現行 % → 引き上げ後 %)
  - 時間外在校等時間の上限(月 X 時間以内、年 X 時間以内)
  - 過労死ラインの時間数(月 X 時間)
  - 勤務実態調査の実数値(小学校 X 時間、中学校 X 時間、X 年間で X 割減 等)
  - 定数改善の規模(教科担任制 X 人、その他の人数規模)
  - 実施期限(令和 X 年度、20XX 年度)
- 抜粋メモに記載のない内容、推測、一般論は一切書かないでください。

# 出力フォーマット

## 1. 何が決まったか
(政策・施策の核心、5-10 行、各行末尾に該当ページ。重要数値を必ず含めること)

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
  model: MODEL,
  numCtx: NUM_CTX,
  pdfPages: rawPages.length,
  pdfChars: text.length,
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
