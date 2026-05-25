// Hypothesis B verification: loadRawChunkSources pre/post diff.
// Reads the same extracted-honbun.txt with both implementations
// (pre = PR #177 / commit 6acd761; post = PR #195 / commit 8eecfd8)
// and reports per-chunk byte / line / identity diff. No LLM calls.

import fs from 'node:fs/promises';
import path from 'node:path';

const slug = 'tsuuchi-r6-08-27';
const sectionName = 'honbun';
const repoRoot = '/Users/Hayato/edu-watch';

const registryPath = path.join(repoRoot, 'scripts/ai-summary/registry.json');
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const entry = registry.entries.find((e) => e.slug === slug);
const sectionEntry = entry.sections.find((s) => s.section === sectionName);

const baseDir = path.join(repoRoot, 'tmp/ai-summary', slug);
const extractedPath = path.join(baseDir, `extracted-${sectionName}.txt`);
const chunkRangesPath = path.join(repoRoot, 'scripts/ai-summary', sectionEntry.chunkRanges);

async function loadRanges() {
  const rangesRaw = JSON.parse(await fs.readFile(chunkRangesPath, 'utf8'));
  return Array.isArray(rangesRaw) ? rangesRaw : rangesRaw[sectionName];
}

async function loadRawChunkSources_pre(chunkNumbers) {
  const extracted = await fs.readFile(extractedPath, 'utf8');
  const ranges = await loadRanges();
  const pageMarker = /\n?--- page \d+ \/ \d+ ---\n?/;
  const rawPages = extracted.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
  const sources = {};
  for (const n of chunkNumbers) {
    const r = ranges[n - 1];
    const slice = rawPages.slice(r.startPage - 1, r.endPage);
    const body = slice
      .map((p, idx) => `--- page ${r.startPage + idx} / ${rawPages.length} ---\n${p}`)
      .join('\n\n');
    sources[n] = body;
  }
  return { sources, pageCount: rawPages.length };
}

async function loadRawChunkSources_post(chunkNumbers) {
  const extracted = await fs.readFile(extractedPath, 'utf8');
  const ranges = await loadRanges();
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
    const parts = [];
    for (let p = r.startPage; p <= r.endPage; p++) {
      const content = pageMap.get(p);
      if (content !== undefined) {
        parts.push(`--- page ${p} / ${pageMap.size} ---\n${content}`);
      }
    }
    sources[n] = parts.join('\n\n');
  }
  return { sources, pageCount: pageMap.size };
}

const ranges = await loadRanges();
const chunkNumbers = ranges.map((_, i) => i + 1);
console.log(`slug=${slug} section=${sectionName} chunks=[${chunkNumbers.join(', ')}] (rangesLen=${ranges.length})`);

const pre = await loadRawChunkSources_pre(chunkNumbers);
const post = await loadRawChunkSources_post(chunkNumbers);

console.log(`pre  page count (rawPages.length): ${pre.pageCount}`);
console.log(`post page count (pageMap.size)  : ${post.pageCount}`);
console.log(`page count delta: ${post.pageCount - pre.pageCount}`);

const summary = [];
for (const n of chunkNumbers) {
  const r = ranges[n - 1];
  const preText = pre.sources[n] || '';
  const postText = post.sources[n] || '';
  const preBytes = Buffer.byteLength(preText, 'utf8');
  const postBytes = Buffer.byteLength(postText, 'utf8');
  const identical = preText === postText;
  const preLines = preText.split('\n').length;
  const postLines = postText.split('\n').length;
  console.log(`\n[chunk ${n}] startPage=${r.startPage} endPage=${r.endPage}`);
  console.log(`  pre  bytes=${preBytes} lines=${preLines}`);
  console.log(`  post bytes=${postBytes} lines=${postLines}`);
  console.log(`  identical: ${identical}`);
  if (!identical) {
    console.log(`  byte delta: ${postBytes - preBytes >= 0 ? '+' : ''}${postBytes - preBytes}`);
  }
  summary.push({ chunk: n, startPage: r.startPage, endPage: r.endPage, preBytes, postBytes, identical });
  await fs.writeFile(`/tmp/hypB-${sectionName}-chunk${n}-pre.txt`, preText);
  await fs.writeFile(`/tmp/hypB-${sectionName}-chunk${n}-post.txt`, postText);
}

console.log(`\nDumped per-chunk pre/post to /tmp/hypB-${sectionName}-chunk*-{pre,post}.txt`);
console.log(`Summary JSON:\n${JSON.stringify(summary, null, 2)}`);
