/**
 * Requirement traceability validator.
 *
 *   npm run req:lint                  # errors fail, gate rules warn
 *   npm run req:lint -- --gate f0-exit # promote F0 exit-gate rules to errors
 *
 * Run in CI so the requirement baseline cannot drift silently.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractFromDocx } from '../../prd-extract/src/extract.ts';
import { parseAnnotations } from '../../prd-extract/src/yaml.ts';
import {
  ruleStableIds, ruleUniqueIds, ruleBilingual, ruleAdrRefsResolve,
  ruleF1Coverage, ruleOpenDecisionsHaveAdrs, ruleCitationsResolve, ruleF1BacklogCoverage,
  type Finding, type LintContext,
} from './rules.ts';

const DOCX = 'docs/source/First_Taste_ERP_PRD_v0.9.docx';
const ANNOTATIONS = 'docs/requirements/annotations.yaml';
const BASELINE = 'docs/requirements/baseline.txt';
const ADR_DIR = 'docs/adr';
const F1_BACKLOG = 'docs/program/f1-backlog.md';

/** The twelve open decisions the PRD itself records in section 10.2. */
const OPEN_DECISIONS = Array.from({ length: 12 }, (_, i) => `OPN-${String(i + 1).padStart(3, '0')}`);

/**
 * Prefixes that look like a requirement identifier but are not one: decision
 * records, open decisions, acceptance scenarios, risks, blockers, open questions,
 * invariants, workstreams, phases, spikes and common technical abbreviations.
 */
const NOT_A_REQUIREMENT = /^(ADR|OPN|T|R|B|Q|I|D|W|F|P|SHA|SPIKE|UAT|RFC|SDK|ES|HTTP|TLS|JSON|SQL|API|MDM|NTP|HLC|WAL|AP|EGS|VAT|PDPL|ZATCA|IT|CI)-/;
const CITATION = /\b([A-Z]{2,4}-\d{3})\b/g;

function collectCitations(dir: string): Array<{ file: string; id: string }> {
  const out: Array<{ file: string; id: string }> = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) {
        const text = readFileSync(p, 'utf8');
        for (const m of text.matchAll(CITATION)) {
          const id = m[1]!;
          if (!NOT_A_REQUIREMENT.test(id)) out.push({ file: p, id });
        }
      }
    }
  };
  walk(dir);
  return out;
}

function loadAdrs(): { ids: Set<string>; corpus: string } {
  const ids = new Set<string>();
  let corpus = '';
  if (!existsSync(ADR_DIR)) return { ids, corpus };
  for (const file of readdirSync(ADR_DIR)) {
    if (!file.endsWith('.md')) continue;
    const id = /^(ADR-\d{4})/.exec(file)?.[1];
    if (id) ids.add(id);
    corpus += readFileSync(join(ADR_DIR, file), 'utf8');
  }
  return { ids, corpus };
}

function main(): void {
  const gateActive = process.argv.includes('--gate') &&
    process.argv[process.argv.indexOf('--gate') + 1] === 'f0-exit';

  const { requirements } = extractFromDocx(DOCX);
  const annotations = existsSync(ANNOTATIONS) ? parseAnnotations(readFileSync(ANNOTATIONS, 'utf8')) : {};
  const { ids: adrIds, corpus: adrCorpus } = loadAdrs();
  const baseline = existsSync(BASELINE)
    ? new Set(readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
    : null;

  const ctx: LintContext = { requirements, annotations, adrIds, baseline, adrCorpus };

  const findings: Finding[] = [
    ...ruleUniqueIds(ctx),
    ...ruleStableIds(ctx),
    ...ruleBilingual(ctx),
    ...ruleAdrRefsResolve(ctx),
    ...ruleF1Coverage(ctx, gateActive),
    ...ruleOpenDecisionsHaveAdrs(ctx, OPEN_DECISIONS),
    ...ruleCitationsResolve(ctx, [...collectCitations('docs'), ...collectCitations('spikes')]),
    ...ruleF1BacklogCoverage(ctx, existsSync(F1_BACKLOG) ? readFileSync(F1_BACKLOG, 'utf8') : null),
  ];

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  // Group by rule so a hundred identical findings read as one actionable item.
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = byRule.get(f.rule) ?? [];
    bucket.push(f);
    byRule.set(f.rule, bucket);
  }

  console.log(`req-lint: ${requirements.length} requirements, ${adrIds.size} ADRs, gate=${gateActive ? 'f0-exit' : 'off'}`);
  for (const [rule, items] of byRule) {
    const sev = items[0]!.severity;
    console.log(`\n  ${sev === 'error' ? 'ERROR' : 'warn '} ${rule} (${items.length})`);
    for (const f of items.slice(0, 5)) console.log(`      ${f.message}`);
    if (items.length > 5) console.log(`      ... and ${items.length - 5} more`);
  }

  console.log(`\nreq-lint: ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length > 0) process.exit(1);
}

main();
