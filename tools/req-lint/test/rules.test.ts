import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleStableIds, ruleUniqueIds, ruleBilingual, ruleAdrRefsResolve,
  ruleF1Coverage, ruleOpenDecisionsHaveAdrs, ruleCitationsResolve, ruleF1BacklogCoverage, type LintContext,
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
  assert.match(findings[0]!.message, /not in the requirement catalogue/);
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
