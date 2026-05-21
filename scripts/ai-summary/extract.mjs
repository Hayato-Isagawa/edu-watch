import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PDFParse } from 'pdf-parse';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    pdf: { type: 'string' },
    url: { type: 'string' },
    registry: { type: 'string', default: './scripts/ai-summary/registry.json' },
    'out-dir': { type: 'string' },
  },
});

if (!values.slug) {
  console.error('Usage: extract.mjs --slug <slug> (--pdf <path> | --url <url>) [--registry <path>] [--out-dir <dir>]');
  process.exit(1);
}
if (!values.pdf && !values.url) {
  console.error('--pdf <path> or --url <url> required');
  process.exit(1);
}

const registryPath = path.resolve(values.registry);
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const entry = registry.entries.find((e) => e.slug === values.slug);
if (!entry) {
  console.error(`slug "${values.slug}" not found in ${registryPath}`);
  process.exit(1);
}

const outDir = path.resolve(values['out-dir'] || `./tmp/ai-summary/${values.slug}`);
await fs.mkdir(outDir, { recursive: true });

let pdfBuffer;
if (values.pdf) {
  pdfBuffer = await fs.readFile(values.pdf);
  console.log(`[pdf] local ${values.pdf} (${pdfBuffer.length} bytes)`);
} else {
  console.log(`[pdf] fetching ${values.url}`);
  const res = await fetch(values.url);
  if (!res.ok) {
    console.error(`fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  pdfBuffer = Buffer.from(await res.arrayBuffer());
  const cachedPath = path.join(outDir, 'source.pdf');
  await fs.writeFile(cachedPath, pdfBuffer);
  console.log(`[pdf] cached at ${cachedPath} (${pdfBuffer.length} bytes)`);
}

const PAGE_JOINER = '\n--- page page_number / total_number ---\n';
const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
const parsed = await parser.getText({ pageJoiner: PAGE_JOINER });
const text = parsed.text;
console.log(`[meta] pages=${parsed.total}, chars=${text.length}`);

const pageMarker = /\n?--- page \d+ \/ \d+ ---\n?/;
const pages = text.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
console.log(`[pages] ${pages.length} pages extracted`);

const patterns = entry.sectionDetectionPatterns || {};
const hitsByKey = {};
for (const [key, patternStr] of Object.entries(patterns)) {
  const re = new RegExp(patternStr);
  const hits = [];
  for (let i = 0; i < pages.length; i++) {
    if (re.test(pages[i])) hits.push(i + 1);
  }
  hitsByKey[key] = hits;
  console.log(`[detect] ${key}: hit pages = [${hits.join(', ')}]`);
}

function resolveBoundary(boundary, totalPages) {
  let startPage;
  if (boundary.fromPage !== undefined) {
    startPage = boundary.fromPage;
  } else if (boundary.fromAtKey) {
    const hits = hitsByKey[boundary.fromAtKey];
    if (!hits || hits.length === 0) {
      throw new Error(`fromAtKey "${boundary.fromAtKey}" not detected`);
    }
    startPage = hits[hits.length - 1] + (boundary.fromOffset || 0);
  } else {
    throw new Error('boundary requires fromPage or fromAtKey');
  }

  let endPage;
  if (boundary.toEnd) {
    endPage = totalPages;
  } else if (boundary.toBeforeKey) {
    const hits = hitsByKey[boundary.toBeforeKey];
    if (!hits || hits.length === 0) {
      throw new Error(`toBeforeKey "${boundary.toBeforeKey}" not detected`);
    }
    endPage = hits[hits.length - 1] - 1;
  } else if (boundary.toPage !== undefined) {
    endPage = boundary.toPage;
  } else {
    throw new Error('boundary requires toEnd, toBeforeKey, or toPage');
  }

  return { startPage, endPage };
}

function sliceSection(startPage, endPage) {
  return pages.slice(startPage - 1, endPage)
    .map((p, idx) => `--- page ${startPage + idx} / ${pages.length} ---\n${p}`)
    .join('\n\n');
}

await fs.writeFile(path.join(outDir, 'extracted-full.txt'), text);
console.log(`[output] extracted-full.txt: ${text.length} chars (all ${pages.length} pages)`);

for (const section of entry.sections) {
  const { startPage, endPage } = resolveBoundary(section.boundary, pages.length);
  if (startPage > endPage || startPage < 1 || endPage > pages.length) {
    console.error(`[error] section ${section.section}: invalid range ${startPage}-${endPage} (total ${pages.length})`);
    process.exit(1);
  }
  const body = sliceSection(startPage, endPage);
  const outPath = path.join(outDir, `extracted-${section.section}.txt`);
  await fs.writeFile(outPath, body);
  console.log(`[output] extracted-${section.section}.txt: ${body.length} chars (pages ${startPage}-${endPage})`);
}

console.log('[done] extract');
