import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const PDF_PATH = process.argv[2] || './tsuuchi.pdf';
const PAGE_JOINER = '\n--- page page_number / total_number ---\n';

const pdfBuffer = await fs.readFile(PDF_PATH);
const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
const parsed = await parser.getText({ pageJoiner: PAGE_JOINER });
const text = parsed.text;

console.log(`[PDF] ${PDF_PATH}`);
console.log(`[meta] pages=${parsed.total}, chars=${text.length}`);

const pageMarker = /\n?--- page \d+ \/ \d+ ---\n?/;
const pages = text.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
console.log(`[pages] ${pages.length} pages extracted (rawPages from pageMarker split)`);

function findSectionStart(pattern, label) {
  const hits = [];
  for (let i = 0; i < pages.length; i++) {
    if (pattern.test(pages[i])) hits.push(i + 1);
  }
  console.log(`[detect] ${label}: hit pages = [${hits.join(', ')}]`);
  return hits;
}

const hits1 = findSectionStart(/別\s*添\s*資\s*料\s*[１1]/, '別添資料１');
const hits2 = findSectionStart(/別\s*添\s*資\s*料\s*[２2]/, '別添資料２');
const hits3 = findSectionStart(/別\s*添\s*資\s*料\s*[３3]/, '別添資料３');

if (hits1.length === 0 || hits2.length === 0 || hits3.length === 0) {
  console.error('[error] one or more section markers not found');
  process.exit(1);
}

const start1 = hits1[hits1.length - 1];
const start2Raw = hits2[hits2.length - 1];
const start3 = hits3[hits3.length - 1];
const start2 = start2Raw + 1;
console.log(`[boundaries] start1=p.${start1}, start2=p.${start2} (raw=p.${start2Raw} +1 for end-of-page marker), start3=p.${start3}`);

if (!(start1 < start2 && start2 < start3 && start3 <= pages.length)) {
  console.error('[error] boundaries are not in ascending order');
  process.exit(1);
}

function sliceSection(startPage, endPage) {
  return pages.slice(startPage - 1, endPage)
    .map((p, idx) => `--- page ${startPage + idx} / ${pages.length} ---\n${p}`)
    .join('\n\n');
}

const honbun = sliceSection(1, start1 - 1);
const betsutenpu1 = sliceSection(start1, start2 - 1);
const betsutenpu2 = sliceSection(start2, start3 - 1);
const betsutenpu3 = sliceSection(start3, pages.length);

await fs.writeFile('./extracted-tsuuchi-full.txt', text);
await fs.writeFile('./extracted-tsuuchi-honbun.txt', honbun);
await fs.writeFile('./extracted-tsuuchi-betsutenpu-2.txt', betsutenpu2);
await fs.writeFile('./extracted-tsuuchi-betsutenpu-3.txt', betsutenpu3);

console.log('[output]');
console.log(`  extracted-tsuuchi-full.txt: ${text.length} chars (all ${pages.length} pages)`);
console.log(`  extracted-tsuuchi-honbun.txt: ${honbun.length} chars (pages 1-${start1 - 1})`);
console.log(`  (skipped) 別添資料１: ${betsutenpu1.length} chars (pages ${start1}-${start2 - 1}) — already measured in obs-2026-05-17`);
console.log(`  extracted-tsuuchi-betsutenpu-2.txt: ${betsutenpu2.length} chars (pages ${start2}-${start3 - 1})`);
console.log(`  extracted-tsuuchi-betsutenpu-3.txt: ${betsutenpu3.length} chars (pages ${start3}-${pages.length})`);
