import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleStableIds, ruleUniqueIds, ruleBilingual, ruleAdrRefsResolve,
  ruleF1Coverage, ruleOpenDecisionsHaveAdrs, ruleCitationsResolve, ruleF1BacklogCoverage,
  ruleProposedRegister, ruleTestRefsResolve, ruleEvidenceIsProducible,
  ruleArtifactsAreReferenced, ruleRiskCitationsResolve, ruleVerbatimBlocksMatchSource,
  sectionBody, dequote, trimBlank,
  type LintContext, type TestArtifacts,
} from '../src/rules.ts';
import type { Requirement } from '../../prd-extract/src/extract.ts';

function req(over: Partial<Requirement> = {}): Requirement {
  return {
    id: 'POS-001', module: 'POS', phase: 'F1', priority: 'P0',
    prd_section: '5.3 Point of sale', text_en: 'English.', text_ar: 'عربي.', ...over,
  };
}

function ctx(over: Partial<LintContext> = {}): LintContext {
  return { requirements: [req()], annotations: {}, adrIds: new Set(), baseline: null, adrCorpus: '', ...over };
}

test('unique-ids flags a duplicated requirement', () => {
  const findings = ruleUniqueIds(ctx({ requirements: [req(), req()] }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'error');
  assert.match(findings[0]!.message, /appears 2 times/);
});

test('unique-ids passes a clean catalogue', () => {
  assert.deepEqual(ruleUniqueIds(ctx({ requirements: [req(), req({ id: 'POS-002' })] })), []);
});

test('stable-ids flags a requirement dropped from an approved baseline', () => {
  const findings = ruleStableIds(ctx({ baseline: new Set(['POS-001', 'POS-999']) }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.requirement, 'POS-999');
  assert.match(findings[0]!.message, /PRG-015/);
});

test('stable-ids is inert before a baseline is frozen', () => {
  assert.deepEqual(ruleStableIds(ctx({ baseline: null })), []);
});

test('bilingual flags a missing Arabic translation', () => {
  const findings = ruleBilingual(ctx({ requirements: [req({ text_ar: '' })] }));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /Arabic/);
});

test('adr-refs-resolve flags a dangling ADR reference', () => {
  const findings = ruleAdrRefsResolve(ctx({
    annotations: { 'POS-001': { adr_refs: ['ADR-0099'] } },
    adrIds: new Set(['ADR-0001']),
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'error');
});

test('adr-refs-resolve accepts a reference that exists', () => {
  assert.deepEqual(ruleAdrRefsResolve(ctx({
    annotations: { 'POS-001': { adr_refs: ['ADR-0001'] } },
    adrIds: new Set(['ADR-0001']),
  })), []);
});

test('f1-coverage warns by default and errors under the F0 exit gate', () => {
  const bare = ctx();
  assert.equal(ruleF1Coverage(bare, false).every((f) => f.severity === 'warning'), true);
  assert.equal(ruleF1Coverage(bare, true).every((f) => f.severity === 'error'), true);
});

test('f1-coverage is satisfied by an owner plus a test reference', () => {
  const complete = ctx({ annotations: { 'POS-001': { owner: 'Ops', test_refs: ['T-01'] } } });
  assert.deepEqual(ruleF1Coverage(complete, true), []);
});

test('f1-coverage ignores requirements outside F1/P0', () => {
  assert.deepEqual(ruleF1Coverage(ctx({ requirements: [req({ phase: 'F4' })] }), true), []);
  assert.deepEqual(ruleF1Coverage(ctx({ requirements: [req({ priority: 'P1' })] }), true), []);
});

test('open-decisions-have-adrs flags an unreferenced decision', () => {
  const findings = ruleOpenDecisionsHaveAdrs(ctx({ adrCorpus: 'closes OPN-001' }), ['OPN-001', 'OPN-002']);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.requirement, 'OPN-002');
});

test('citations-resolve flags a reference to a requirement that does not exist', () => {
  // The real instance this rule was written for: the print design cited PRN-019
  // for the reprint label, but PRN stops at 015 — the requirement is POS-019.
  const findings = ruleCitationsResolve(
    ctx({ requirements: [req({ id: 'POS-019' })] }),
    [{ file: 'docs/architecture/core-transaction-design.md', id: 'PRN-019' }],
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'error');
  assert.match(findings[0]!.message, /neither the requirement catalogue nor the proposed register/);
});

test('citations-resolve accepts a reference that exists', () => {
  const findings = ruleCitationsResolve(
    ctx({ requirements: [req({ id: 'POS-019' })] }),
    [{ file: 'docs/x.md', id: 'POS-019' }],
  );
  assert.deepEqual(findings, []);
});

test('citations-resolve reports each bad citation separately', () => {
  const findings = ruleCitationsResolve(ctx(), [
    { file: 'a.md', id: 'XXX-001' },
    { file: 'b.md', id: 'YYY-002' },
  ]);
  assert.equal(findings.length, 2);
});

test('f1-backlog-coverage flags an F1 requirement belonging to no epic', () => {
  // The backlog claims complete coverage; without this the claim decays the first
  // time a requirement is added or an epic reshaped.
  const findings = ruleF1BacklogCoverage(
    ctx({ requirements: [req({ id: 'POS-001' }), req({ id: 'POS-002' })] }),
    'Epic E6 covers `POS-001`.',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.requirement, 'POS-002');
  assert.equal(findings[0]!.severity, 'error');
});

test('f1-backlog-coverage passes when every F1 requirement is present', () => {
  const findings = ruleF1BacklogCoverage(
    ctx({ requirements: [req({ id: 'POS-001' })] }),
    'Epic E6 covers `POS-001`.',
  );
  assert.deepEqual(findings, []);
});

test('f1-backlog-coverage ignores requirements outside F1', () => {
  const findings = ruleF1BacklogCoverage(
    ctx({ requirements: [req({ id: 'FIN-001', phase: 'F4' })] }),
    'nothing here',
  );
  assert.deepEqual(findings, []);
});

test('f1-backlog-coverage is inert before the backlog exists', () => {
  assert.deepEqual(ruleF1BacklogCoverage(ctx(), null), []);
});

const proposed = (over: Partial<{ id: string; module: string; text_en: string; text_ar: string }> = {}) => ({
  id: 'CC-P01', module: 'CC', text_en: 'English.', text_ar: 'عربي.', ...over,
});

test('proposed-register accepts a well-formed entry', () => {
  assert.deepEqual(ruleProposedRegister(ctx(), [proposed()]), []);
});

test('proposed-register rejects an identifier in the approved form', () => {
  // A proposal must be visibly provisional; CC-001 would read as approved.
  const findings = ruleProposedRegister(ctx(), [proposed({ id: 'CC-001' })]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /not a valid proposed identifier/);
});

test('proposed-register rejects a malformed identifier', () => {
  assert.equal(ruleProposedRegister(ctx(), [proposed({ id: 'CC-PROPOSED-1' })]).length, 1);
  assert.equal(ruleProposedRegister(ctx(), [proposed({ id: 'CCP01' })]).length, 1);
});

test('proposed-register flags a duplicate', () => {
  const findings = ruleProposedRegister(ctx(), [proposed(), proposed()]);
  assert.ok(findings.some((f) => /more than once/.test(f.message)));
});

test('proposed-register enforces both languages (PRG-014)', () => {
  assert.ok(ruleProposedRegister(ctx(), [proposed({ text_ar: '' })]).some((f) => /Arabic/.test(f.message)));
  assert.ok(ruleProposedRegister(ctx(), [proposed({ text_en: '' })]).some((f) => /English/.test(f.message)));
});

test('proposed-register is inert before the register exists', () => {
  assert.deepEqual(ruleProposedRegister(ctx(), null), []);
});

test('citations-resolve accepts a proposed identifier that is registered', () => {
  // Before this, CC-P01 was silently ignored by the citation rule, so a typo in
  // a proposed identifier went uncaught.
  const findings = ruleCitationsResolve(ctx(), [{ file: 'a.md', id: 'CC-P01' }], new Set(['CC-P01']));
  assert.deepEqual(findings, []);
});

test('citations-resolve rejects a proposed identifier that is not registered', () => {
  const findings = ruleCitationsResolve(ctx(), [{ file: 'a.md', id: 'CC-P99' }], new Set(['CC-P01']));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /neither the requirement catalogue nor the proposed register/);
});

const artifacts = (over: Partial<TestArtifacts> = {}): TestArtifacts => ({
  scenarios: new Set(['T-01', 'T-07']),
  spikes: new Set(['offline-sync', 'print-queue', 'lan-peer-sync']),
  executableSpikes: new Set(['offline-sync', 'print-queue']),
  uatPacks: new Set(['cashier', 'kitchen']),
  ...over,
});

test('test-refs-resolve accepts references that exist', () => {
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'POS-001': { test_refs: ['T-01', 'SPIKE-print-queue', 'UAT-cashier'] } } }),
    artifacts(),
  );
  assert.deepEqual(findings, []);
});

test('test-refs-resolve flags a UAT pack that does not exist', () => {
  // The gap this rule was written for: every UAT-* reference pointed at nothing,
  // and the F0 exit gate passed anyway because it only checked for a non-empty
  // string.
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'POS-001': { test_refs: ['UAT-nonexistent'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /docs\/lab\/uat/);
});

test('test-refs-resolve flags a spike directory that does not exist', () => {
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'OFF-001': { test_refs: ['SPIKE-imaginary'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /spikes\//);
});

test('test-refs-resolve flags a scenario absent from the test plan', () => {
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'POS-001': { test_refs: ['T-99'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /test-plan/);
});

test('test-refs-resolve rejects an unrecognised reference form', () => {
  // Catches a typo that would otherwise be silently treated as some new kind of
  // artifact nobody has to produce.
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'POS-001': { test_refs: ['SOMETHING-ELSE'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /not a recognised form/);
});

test('test-refs-resolve reports each bad reference separately', () => {
  const findings = ruleTestRefsResolve(
    ctx({ annotations: { 'POS-001': { test_refs: ['UAT-nope', 'SPIKE-nope', 'T-99'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 3);
});

test('test-refs-resolve is inert when a requirement has no references', () => {
  assert.deepEqual(ruleTestRefsResolve(ctx({ annotations: { 'POS-001': { owner: 'Ops' } } }), artifacts()), []);
});

// ---------------------------------------------------------------------------
// evidence-is-producible
// ---------------------------------------------------------------------------

test('evidence-is-producible flags a requirement evidenced only by a procedure', () => {
  // lan-peer-sync exists on disk and so satisfies test-refs-resolve, but it has
  // no harness and cannot run until B-03 lifts. The requirement is untested.
  const findings = ruleEvidenceIsProducible(
    ctx({ annotations: { 'OFF-012': { test_refs: ['SPIKE-lan-peer-sync'] } } }),
    artifacts(), false, 'B-03',
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'warning');
  assert.match(findings[0]!.message, /B-03/);
});

test('evidence-is-producible becomes an error under the F0 gate', () => {
  const findings = ruleEvidenceIsProducible(
    ctx({ annotations: { 'OFF-012': { test_refs: ['SPIKE-lan-peer-sync'] } } }),
    artifacts(), true, 'B-03',
  );
  assert.equal(findings[0]!.severity, 'error');
});

test('evidence-is-producible passes when one reference can produce evidence', () => {
  // A procedure alongside something runnable is fine: the requirement can be
  // evidenced today and more thoroughly later.
  const findings = ruleEvidenceIsProducible(
    ctx({ annotations: { 'OFF-012': { test_refs: ['SPIKE-lan-peer-sync', 'T-01'] } } }),
    artifacts(), true, 'B-03',
  );
  assert.deepEqual(findings, []);
});

test('evidence-is-producible ignores a requirement with no references at all', () => {
  // That case belongs to f1-coverage; reporting it twice would obscure both.
  assert.deepEqual(
    ruleEvidenceIsProducible(ctx({ annotations: { 'OFF-012': { test_refs: [] } } }), artifacts(), true, 'B-03'),
    [],
  );
});

// ---------------------------------------------------------------------------
// artifacts-are-referenced
// ---------------------------------------------------------------------------

test('artifacts-are-referenced flags a spike no requirement names', () => {
  const findings = ruleArtifactsAreReferenced(
    ctx({ annotations: { 'POS-001': { test_refs: ['SPIKE-offline-sync', 'UAT-cashier', 'UAT-kitchen'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /spikes\/print-queue/);
});

test('artifacts-are-referenced accepts a reference from the proposed register', () => {
  // CC-P01..P08 live in proposed.yaml, not annotations.yaml, so without this the
  // callback spike would read as unreferenced.
  const findings = ruleArtifactsAreReferenced(
    ctx({ annotations: { 'POS-001': { test_refs: ['SPIKE-offline-sync', 'UAT-cashier', 'UAT-kitchen'] } } }),
    artifacts(),
    ['SPIKE-print-queue'],
  );
  assert.deepEqual(findings, []);
});

test('artifacts-are-referenced ignores procedure spikes', () => {
  // lan-peer-sync is not runnable, so "what does it prove?" is answered by its
  // own README rather than by a requirement naming it.
  const findings = ruleArtifactsAreReferenced(
    ctx({ annotations: { 'POS-001': { test_refs: ['SPIKE-offline-sync', 'SPIKE-print-queue', 'UAT-cashier', 'UAT-kitchen'] } } }),
    artifacts(),
  );
  assert.deepEqual(findings, []);
});

test('artifacts-are-referenced flags an orphan UAT pack', () => {
  const findings = ruleArtifactsAreReferenced(
    ctx({ annotations: { 'POS-001': { test_refs: ['SPIKE-offline-sync', 'SPIKE-print-queue', 'UAT-cashier'] } } }),
    artifacts(),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /uat\/kitchen\.md/);
});

// ---------------------------------------------------------------------------
// risk-citations-resolve
// ---------------------------------------------------------------------------

test('risk-citations-resolve rejects a risk that is not in the register', () => {
  const findings = ruleRiskCitationsResolve([{ file: 'a.md', id: 'R-11' }], new Set(['R-01', 'R-02']));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'error');
  assert.match(findings[0]!.message, /risk register/);
});

test('risk-citations-resolve accepts a registered risk', () => {
  assert.deepEqual(ruleRiskCitationsResolve([{ file: 'a.md', id: 'R-02' }], new Set(['R-01', 'R-02'])), []);
});

test('risk-citations-resolve is inert before the register exists', () => {
  // Otherwise generating the register and citing it would have to land together.
  assert.deepEqual(ruleRiskCitationsResolve([{ file: 'a.md', id: 'R-99' }], new Set()), []);
});

test('open-decisions-have-adrs is an error, so the enforcement claim holds', () => {
  const findings = ruleOpenDecisionsHaveAdrs(ctx({ adrCorpus: '' }), ['OPN-001']);
  assert.equal(findings[0]!.severity, 'error');
});

const DOC = [
  '# Ticket', '', '## Draft', '',
  '> **Subject:** crashes', '>', '> Body line.', '',
  '---', '', '## After', '', 'Not part of the draft.',
].join('\n');

test('section-body takes a section without its heading or neighbours', () => {
  assert.deepEqual(sectionBody(DOC, 'draft'), ['> **Subject:** crashes', '>', '> Body line.']);
});

test('section-body stops at a heading of the same level', () => {
  const doc = ['## A', '', 'one', '', '## B', '', 'two'].join('\n');
  assert.deepEqual(sectionBody(doc, 'a'), ['one']);
});

test('section-body returns null for a section that does not exist', () => {
  assert.equal(sectionBody(DOC, 'nowhere'), null);
});

test('dequote strips one blockquote level, including the bare marker', () => {
  assert.deepEqual(dequote(['> a', '>', '> b']), ['a', '', 'b']);
});

test('trim-blank drops surrounding blank lines but not interior ones', () => {
  assert.deepEqual(trimBlank(['', 'a', '', 'b', '']), ['a', '', 'b']);
});

test('verbatim-blocks-match-source accepts an identical copy', () => {
  const block = sectionBody(DOC, 'draft')!;
  assert.deepEqual(
    ruleVerbatimBlocksMatchSource([{ file: 'ar/t.md', source: '../t.md#draft', claimed: block, actual: block }]),
    [],
  );
});

test('verbatim-blocks-match-source accepts a de-quoted copy', () => {
  const block = sectionBody(DOC, 'draft')!;
  assert.deepEqual(
    ruleVerbatimBlocksMatchSource([
      { file: 'extracts/t.md', source: '../t.md#draft', claimed: dequote(block), actual: dequote(block) },
    ]),
    [],
  );
});

/**
 * The control. This is the drift that actually happened: a correction rewrote the
 * source's evidence section and left the copy's Subject asserting the old claim.
 * If this passes, the rule proves nothing.
 */
test('verbatim-blocks-match-source catches a copy whose subject was left behind', () => {
  const findings = ruleVerbatimBlocksMatchSource([{
    file: 'ar/t.md', source: '../t.md#draft',
    claimed: ['> **Subject:** crashes, and get_token errors', '>', '> Body line.'],
    actual: ['> **Subject:** crashes', '>', '> Body line.'],
  }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'error');
  assert.match(findings[0]!.message, /block line 1/);
  assert.match(findings[0]!.message, /get_token/);
});

test('verbatim-blocks-match-source reports only the first difference per claim', () => {
  const findings = ruleVerbatimBlocksMatchSource([
    { file: 'a.md', source: 's.md#d', claimed: ['x', 'y'], actual: ['a', 'b'] },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /block line 1/);
});

test('verbatim-blocks-match-source catches a copy that ends early', () => {
  const findings = ruleVerbatimBlocksMatchSource([
    { file: 'a.md', source: 's.md#d', claimed: ['a'], actual: ['a', 'b'] },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /ends early/);
});

test('verbatim-blocks-match-source rejects a marker naming a section that does not exist', () => {
  const findings = ruleVerbatimBlocksMatchSource([
    { file: 'a.md', source: 'gone.md#draft', claimed: ['a'], actual: null },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /no section that exists/);
});

test('verbatim-blocks-match-source rejects a marker with nothing beneath it', () => {
  const findings = ruleVerbatimBlocksMatchSource([
    { file: 'a.md', source: 's.md#d', claimed: [], actual: ['a'] },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /no block to compare/);
});
