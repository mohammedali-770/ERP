/**
 * Generates docs/requirements/INDEX.md — a human-readable view of the catalogue,
 * grouped by module, showing phase, priority and current traceability state.
 *
 *   npm run req:index            # write
 *   npm run req:index -- --check # fail if stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extractFromDocx } from '../../prd-extract/src/extract.ts';
import { parseAnnotations, type Node } from '../../prd-extract/src/yaml.ts';

const DOCX = 'docs/source/First_Taste_ERP_PRD_v0.9.docx';
const ANNOTATIONS = 'docs/requirements/annotations.yaml';
const OUTPUT = 'docs/requirements/INDEX.md';

const list = (v: Node | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

const escapePipes = (s: string): string => s.replace(/\|/g, '\\|');

function main(): void {
  const check = process.argv.includes('--check');
  const { requirements } = extractFromDocx(DOCX);
  const annotations = existsSync(ANNOTATIONS) ? parseAnnotations(readFileSync(ANNOTATIONS, 'utf8')) : {};

  const byModule = new Map<string, typeof requirements>();
  for (const r of requirements) {
    const bucket = byModule.get(r.module) ?? [];
    bucket.push(r);
    byModule.set(r.module, bucket);
  }

  const byPhase = new Map<string, number>();
  for (const r of requirements) byPhase.set(r.phase, (byPhase.get(r.phase) ?? 0) + 1);

  const out: string[] = [
    '# Requirement index',
    '',
    '<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run req:index -->',
    '',
    `Generated from \`${DOCX}\`. **${requirements.length} requirements.**`,
    '',
    'Annotations (owner, status, ADR and test links) are maintained in',
    '[`annotations.yaml`](./annotations.yaml); the full machine-readable catalogue is',
    '[`requirements.yaml`](./requirements.yaml).',
    '',
    '## By phase',
    '',
    '| Phase | Count |',
    '|---|---|',
    ...[...byPhase.entries()].sort().map(([p, n]) => `| ${p} | ${n} |`),
    '',
    '## By module',
    '',
    '| Module | Count | Section |',
    '|---|---|---|',
    ...[...byModule.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([m, rs]) => `| [${m}](#${m.toLowerCase()}) | ${rs.length} | ${escapePipes(rs[0]!.prd_section)} |`),
    '',
  ];

  for (const [module, reqs] of [...byModule.entries()].sort()) {
    out.push(`## ${module}`, '', `_${escapePipes(reqs[0]!.prd_section)}_`, '',
      '| ID | Phase | Pri | Owner | Tests | Requirement |', '|---|---|---|---|---|---|');
    for (const r of reqs) {
      const a = annotations[r.id] ?? {};
      const owner = a['owner'] ? String(a['owner']) : '—';
      const tests = list(a['test_refs']);
      out.push(`| \`${r.id}\` | ${r.phase} | ${r.priority} | ${escapePipes(owner)} | ${tests.length ? tests.join(', ') : '—'} | ${escapePipes(r.text_en)} |`);
    }
    out.push('');
  }

  const rendered = out.join('\n');
  if (check) {
    if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== rendered) {
      console.error(`${OUTPUT} is stale. Run: npm run req:index`);
      process.exit(1);
    }
    console.log(`req-index: ${OUTPUT} is up to date.`);
    return;
  }
  writeFileSync(OUTPUT, rendered);
  console.log(`req-index: wrote ${OUTPUT} (${requirements.length} requirements, ${byModule.size} modules)`);
}

main();
