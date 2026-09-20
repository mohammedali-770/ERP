/**
 * Regenerates the two files derived from the vendored PRD: the requirement
 * catalogue and the risk register.
 *
 *   npm run prd:extract            # write both
 *   npm run prd:extract -- --check # fail if either committed file is stale
 *
 * Extraction owns the immutable facts (id, bilingual text, phase, priority,
 * section). Human judgement — ownership, status, ADR and test links — lives in
 * annotations.yaml and is merged in here, so regenerating after a PRD revision
 * never discards that work.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extractFromDocx, readBlocks, type Requirement } from './extract.ts';
import { extractRisks } from './risks.ts';
import { renderRiskRegister } from './risk-register.ts';
import { parseAnnotations, emitScalar, emitList, type Node } from './yaml.ts';

const DOCX = 'docs/source/First_Taste_ERP_PRD_v0.9.docx';
const ANNOTATIONS = 'docs/requirements/annotations.yaml';
const OUTPUT = 'docs/requirements/requirements.yaml';
const RISK_OUTPUT = 'docs/program/risk-register.md';

const LIST_FIELDS = ['adr_refs', 'test_refs', 'estate_refs'] as const;
const SCALAR_FIELDS = ['status', 'owner'] as const;
const DEFAULT_STATUS = 'baselined';

function asList(v: Node | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function render(reqs: Requirement[], annotations: Record<string, Record<string, Node>>, sha: string): string {
  const byPhase = new Map<string, number>();
  for (const r of reqs) byPhase.set(r.phase, (byPhase.get(r.phase) ?? 0) + 1);
  const phaseSummary = [...byPhase.entries()].sort().map(([p, n]) => `#   ${p}: ${n}`).join('\n');

  const head = [
    '# First Taste ERP — requirement catalogue',
    '#',
    '# GENERATED FILE — do not edit by hand.',
    '# Regenerate with: npm run prd:extract',
    '#',
    '# Immutable fields (id, text_en, text_ar, phase, priority, prd_section) are',
    '# extracted from the source PRD. Ownership and traceability fields come from',
    '# docs/requirements/annotations.yaml — edit that file instead.',
    '#',
    `# source: ${DOCX}`,
    `# source_sha256: ${sha}`,
    `# total: ${reqs.length}`,
    phaseSummary,
    '',
    `total: ${reqs.length}`,
    `source_sha256: ${emitScalar(sha)}`,
    'requirements:',
  ].join('\n');

  const body = reqs.map((r) => {
    const a = annotations[r.id] ?? {};
    const lines = [
      `  - id: ${emitScalar(r.id)}`,
      `    module: ${emitScalar(r.module)}`,
      `    phase: ${emitScalar(r.phase)}`,
      `    priority: ${emitScalar(r.priority)}`,
      `    prd_section: ${emitScalar(r.prd_section)}`,
      `    text_en: ${emitScalar(r.text_en)}`,
      `    text_ar: ${emitScalar(r.text_ar)}`,
    ];
    for (const f of SCALAR_FIELDS) {
      const v = a[f];
      lines.push(`    ${f}: ${emitScalar(v === undefined ? (f === 'status' ? DEFAULT_STATUS : null) : String(v))}`);
    }
    for (const f of LIST_FIELDS) {
      lines.push(`    ${f}:${emitList(asList(a[f]), '      ')}`);
    }
    return lines.join('\n');
  }).join('\n');

  return `${head}\n${body}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const { requirements, sourceSha256 } = extractFromDocx(DOCX);
  const annotations = existsSync(ANNOTATIONS)
    ? parseAnnotations(readFileSync(ANNOTATIONS, 'utf8'))
    : {};

  const unknown = Object.keys(annotations).filter((id) => !requirements.some((r) => r.id === id));
  if (unknown.length > 0) {
    console.error(`annotations.yaml references requirements that do not exist: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const rendered = render(requirements, annotations, sourceSha256);
  const risks = extractRisks(readBlocks(DOCX).blocks);
  const renderedRisks = renderRiskRegister(risks, DOCX, sourceSha256);

  const outputs: Array<[string, string, string]> = [
    [OUTPUT, rendered, `${requirements.length} requirements`],
    [RISK_OUTPUT, renderedRisks, `${risks.length} risks`],
  ];

  if (check) {
    let stale = false;
    for (const [path, content] of outputs) {
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
      if (existing !== content) {
        console.error(`${path} is stale. Run: npm run prd:extract`);
        stale = true;
      }
    }
    if (stale) process.exit(1);
    console.log(`prd-extract: ${OUTPUT} and ${RISK_OUTPUT} are up to date (${requirements.length} requirements, ${risks.length} risks).`);
    return;
  }

  for (const [path, content, what] of outputs) {
    writeFileSync(path, content);
    console.log(`prd-extract: wrote ${what} to ${path}`);
  }
}

main();
