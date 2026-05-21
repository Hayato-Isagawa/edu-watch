import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    section: { type: 'string' },
    'skip-retry': { type: 'boolean', default: false },
    'skip-extract': { type: 'boolean', default: false },
    registry: { type: 'string', default: './scripts/ai-summary/registry.json' },
    'out-dir': { type: 'string' },
    pdf: { type: 'string' },
    url: { type: 'string' },
  },
});

if (!values.slug) {
  console.error('Usage: run-pipeline.mjs --slug <slug> [--section <section>] [--skip-retry] [--skip-extract] [--registry <path>] [--out-dir <dir>] [--pdf <path>] [--url <url>]');
  process.exit(1);
}

const registryPath = path.resolve(values.registry);
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const entry = registry.entries.find((e) => e.slug === values.slug);
if (!entry) {
  console.error(`slug "${values.slug}" not found in ${registryPath}`);
  process.exit(1);
}

const targetSections = values.section
  ? entry.sections.filter((s) => s.section === values.section)
  : entry.sections;
if (targetSections.length === 0) {
  console.error(`section "${values.section}" not found in slug "${values.slug}"`);
  process.exit(1);
}

function runStep(scriptName, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);
    const child = spawn('node', [scriptPath, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

const commonArgs = ['--slug', values.slug, '--registry', values.registry];
if (values['out-dir']) commonArgs.push('--out-dir', values['out-dir']);

const t0 = Date.now();
const sectionResults = [];

if (!values['skip-extract']) {
  console.log(`\n=== EXTRACT (slug=${values.slug}) ===`);
  const extractArgs = [...commonArgs];
  if (values.pdf) extractArgs.push('--pdf', values.pdf);
  else if (values.url) extractArgs.push('--url', values.url);
  else if (entry.pdfUrl && entry.pdfUrl !== 'TBD') extractArgs.push('--url', entry.pdfUrl);
  else {
    console.error('extract requires --pdf, --url, or non-TBD pdfUrl in registry');
    process.exit(1);
  }
  await runStep('extract.mjs', extractArgs);
} else {
  console.log(`\n=== EXTRACT (skipped) ===`);
}

for (const section of targetSections) {
  const tSec = Date.now();
  console.log(`\n=== MAPREDUCE (section=${section.section}) ===`);
  await runStep('mapreduce.mjs', [...commonArgs, '--section', section.section]);

  console.log(`\n=== FACT-CHECK (section=${section.section}) ===`);
  const factCheckArgs = [...commonArgs, '--section', section.section];
  if (values['skip-retry']) factCheckArgs.push('--skip-retry');
  await runStep('fact-check-grep.mjs', factCheckArgs);

  const baseDir = path.resolve(values['out-dir'] || `./tmp/ai-summary/${values.slug}`);
  const sectionDir = path.join(baseDir, section.section);
  const reportPath = path.join(sectionDir, 'fact-check-report.json');
  let report = null;
  try {
    report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch { /* skip */ }
  sectionResults.push({
    section: section.section,
    elapsedSec: (Date.now() - tSec) / 1000,
    report,
  });
}

const totalSec = (Date.now() - t0) / 1000;
console.log(`\n=== PIPELINE SUMMARY (slug=${values.slug}, total=${totalSec.toFixed(1)}s) ===`);
for (const r of sectionResults) {
  if (!r.report) {
    console.log(`  ${r.section}: ${r.elapsedSec.toFixed(1)}s, report missing`);
    continue;
  }
  const total = r.report.initial.total;
  const present = r.report.initial.present.length;
  const recovered = r.report.retry?.recovered?.length || 0;
  const stillMissing = r.report.retry?.stillMissing?.length || 0;
  const outOfScope = r.report.outOfScope.length;
  console.log(`  ${r.section}: ${r.elapsedSec.toFixed(1)}s, present ${present} → ${present + recovered}/${total} (out-of-scope ${outOfScope}, still-missing ${stillMissing})`);
}
