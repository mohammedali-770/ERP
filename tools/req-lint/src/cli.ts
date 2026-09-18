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
  ruleProposedRegister, ruleTestRefsResolve, ruleEvidenceIsProducible,
  ruleArtifactsAreReferenced, ruleRiskCitationsResolve,
  type Finding, type LintContext, type TestArtifacts, type ProposedEntry,
} from './rules.ts';

const DOCX = 'docs/source/First_Taste_ERP_PRD_v0.9.docx';
const ANNOTATIONS = 'docs/requirements/annotations.yaml';
const BASELINE = 'docs/requirements/baseline.txt';
const ADR_DIR = 'docs/adr';
const F1_BACKLOG = 'docs/program/f1-backlog.md';
const PROPOSED = 'docs/requirements/proposed.yaml';
const TEST_PLAN = 'docs/lab/test-plan.md';
const UAT_DIR = 'docs/lab/uat';
const SPIKES_DIR = 'spikes';
const RISK_REGISTER = 'docs/program/risk-register.md';

/**
 * The blocker holding the two procedure spikes. Named in the finding so the
 * output reads as a programme fact rather than a lint complaint.
 */
const PROCEDURE_BLOCKER = 'B-03';

/** Documents outside docs/ and spikes/ that cite requirements and must be checked too. */
const ROOT_DOCUMENTS = ['README.md', 'CLAUDE.md'];

/** The twelve open decisions the PRD itself records in section 10.2. */
const OPEN_DECISIONS = Array.from({ length: 12 }, (_, i) => `OPN-${String(i + 1).padStart(3, '0')}`);

/**
 * Prefixes that look like a requirement identifier but are not one: decision
 * records, open decisions, acceptance scenarios, risks, blockers, open questions,
 * invariants, workstreams, phases, spikes and common technical abbreviations.
 */
const NOT_A_REQUIREMENT = /^(ADR|OPN|T|R|B|Q|I|D|W|F|P|SHA|SPIKE|UAT|RFC|SDK|ES|HTTP|TLS|JSON|SQL|API|MDM|NTP|HLC|WAL|AP|EGS|VAT|PDPL|ZATCA|IT|CI)-/;
const CITATION = /\b([A-Z]{2,4}-\d{3})\b/g;
const PROPOSED_CITATION = /\b([A-Z]{2,4}-P\d{2})\b/g;
/**
 * Risk identifiers. The leading word boundary is what keeps this from matching
 * inside HR-014 or PRN-014 — the character before `R` there is a word character,
 * so there is no boundary to match.
 */
const RISK_CITATION = /\bR-\d{2}\b/g;

interface Citations {
  requirements: Array<{ file: string; id: string }>;
  risks: Array<{ file: string; id: string }>;
}

function scanCitations(file: string, into: Citations): void {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CITATION)) {
    const id = m[1]!;
    if (!NOT_A_REQUIREMENT.test(id)) into.requirements.push({ file, id });
  }
  for (const m of text.matchAll(PROPOSED_CITATION)) into.requirements.push({ file, id: m[1]! });
  for (const m of text.matchAll(RISK_CITATION)) into.risks.push({ file, id: m[0]! });
}

/**
 * Walks the documentation trees, plus the two root documents. README.md and
 * CLAUDE.md cite requirements and are the two files most likely to be read
 * first, yet were outside this check while CLAUDE.md itself claimed every
 * requirement cited in a document exists.
 */
function collectCitations(paths: readonly string[]): Citations {
  const out: Citations = { requirements: [], risks: [] };
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) scanCitations(p, out);
    }
  };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (path.endsWith('.md')) scanCitations(path, out);
    else walk(path);
  }
  return out;
}

type ProposedRequirement = ProposedEntry;

/**
 * Reads the proposed register. Deliberately minimal — the file is hand-maintained
 * and small, and adding a YAML dependency for one file would widen the supply
 * chain of the tooling that defines our requirement baseline.
 */
function loadProposed(): ProposedRequirement[] | null {
  if (!existsSync(PROPOSED)) return null;
  const out: ProposedRequirement[] = [];
  let current: ProposedRequirement | null = null;
  /** The list field currently being accumulated, if any. */
  let listField: 'test_refs' | null = null;

  for (const line of readFileSync(PROPOSED, 'utf8').split('\n')) {
    const id = /^  - id: "([^"]+)"/.exec(line);
    if (id) {
      if (current?.id) out.push(current);
      current = { id: id[1]!, module: '', text_en: '', text_ar: '' };
      listField = null;
      continue;
    }
    if (!current) continue;

    if (/^    test_refs:\s*$/.test(line)) { listField = 'test_refs'; current.test_refs = []; continue; }
    const item = /^      - (\S+)\s*$/.exec(line);
    if (item && listField === 'test_refs') { current.test_refs!.push(item[1]!); continue; }
    // Any other four-space key ends the list; relates_to has the same item shape,
    // so without this a relates_to entry would be read as a test reference.
    if (/^    \S/.test(line)) listField = null;

    for (const field of ['module', 'text_en', 'text_ar', 'owner'] as const) {
      const m = new RegExp(`^    ${field}: "(.*)"$`).exec(line);
      if (m) current[field] = m[1]!;
    }
  }
  if (current?.id) out.push(current);
  return out;
}

function loadRiskIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(RISK_REGISTER)) return ids;
  for (const m of readFileSync(RISK_REGISTER, 'utf8').matchAll(/^\| `(R-\d{2})`/gm)) ids.add(m[1]!);
  return ids;
}

/**
 * Discovers what test artifacts actually exist, rather than trusting that a
 * reference implies one.
 */
function loadTestArtifacts(): TestArtifacts {
  const scenarios = new Set<string>();
  if (existsSync(TEST_PLAN)) {
    for (const m of readFileSync(TEST_PLAN, 'utf8').matchAll(/^## (T-\d{2})\b/gm)) {
      scenarios.add(m[1]!);
    }
  }

  // A spike with a CLI can be run and produce a report; one without is a
  // procedure for a person to carry out against hardware.
  const spikes = new Set<string>();
  const executableSpikes = new Set<string>();
  if (existsSync(SPIKES_DIR)) {
    for (const entry of readdirSync(SPIKES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      spikes.add(entry.name);
      if (existsSync(join(SPIKES_DIR, entry.name, 'src', 'cli.ts'))) executableSpikes.add(entry.name);
    }
  }

  const uatPacks = new Set<string>();
  if (existsSync(UAT_DIR)) {
    for (const file of readdirSync(UAT_DIR)) {
      if (file.endsWith('.md') && file !== 'README.md') uatPacks.add(file.replace(/\.md$/, ''));
    }
  }

  return { scenarios, spikes, executableSpikes, uatPacks };
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

  const testArtifacts = loadTestArtifacts();
  const proposed = loadProposed();
  const proposedIds = new Set((proposed ?? []).map((p) => p.id));
  const riskIds = loadRiskIds();
  const citations = collectCitations(['docs', 'spikes', ...ROOT_DOCUMENTS]);
  // Proposed requirements carry their own test references, so an artifact proving
  // a proposal is not reported as unreferenced.
  const proposedTestRefs = (proposed ?? []).flatMap((p) => p.test_refs ?? []);
  const ctx: LintContext = { requirements, annotations, adrIds, baseline, adrCorpus };

  const findings: Finding[] = [
    ...ruleUniqueIds(ctx),
    ...ruleStableIds(ctx),
    ...ruleBilingual(ctx),
    ...ruleAdrRefsResolve(ctx),
    ...ruleF1Coverage(ctx, gateActive),
    ...ruleOpenDecisionsHaveAdrs(ctx, OPEN_DECISIONS),
    ...ruleCitationsResolve(ctx, citations.requirements, proposedIds),
    ...ruleRiskCitationsResolve(citations.risks, riskIds),
    ...ruleProposedRegister(ctx, proposed),
    ...ruleTestRefsResolve(ctx, testArtifacts),
    ...ruleEvidenceIsProducible(ctx, testArtifacts, gateActive, PROCEDURE_BLOCKER),
    ...ruleArtifactsAreReferenced(ctx, testArtifacts, proposedTestRefs),
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

  console.log(
    `req-lint: ${requirements.length} requirements, ${proposedIds.size} proposed, ${adrIds.size} ADRs, ` +
    `${testArtifacts.scenarios.size} scenarios, ${testArtifacts.uatPacks.size} UAT packs, ` +
    `${testArtifacts.spikes.size} spikes (${testArtifacts.executableSpikes.size} executable), ${riskIds.size} risks, ` +
    `gate=${gateActive ? 'f0-exit' : 'off'}`,
  );
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
