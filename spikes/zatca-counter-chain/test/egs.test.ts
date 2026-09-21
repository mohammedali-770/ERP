import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EgsUnit, IssuanceLog, verifyChain, CounterReuseError, GENESIS_PIH } from '../src/egs.ts';
import { runZatcaScenario } from '../src/scenario.ts';

const BASE = { units: 3, invoicesPerUnit: 4 } as const;

test('the baseline holds: three units, gapless counters, verified chains', () => {
  const r = runZatcaScenario(BASE);
  assert.equal(r.passed, true, r.problems.join('; '));
  assert.equal(r.counterReuses, 0);
  assert.equal(r.brokenChains, 0);
});

test('a counter increments by exactly one and never repeats', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  for (let i = 0; i < 50; i += 1) unit.issue(100, 1000 + i, log);
  assert.deepEqual(log.issued.map((i) => i.icv), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.deepEqual(log.reusedCounters('egs-pos-1'), []);
});

test('each unit keeps its own chain, seeded from the genesis PIH', () => {
  const log = new IssuanceLog();
  const a = new EgsUnit('egs-pos-1');
  const b = new EgsUnit('egs-pos-2');
  const firstA = a.issue(100, 1000, log);
  const firstB = b.issue(100, 1001, log);
  // Two units issuing at the same moment both start at counter 1. That is correct
  // under ADR-0006 and would be a collision under a shared counter.
  assert.equal(firstA.icv, 1);
  assert.equal(firstB.icv, 1);
  assert.equal(firstA.pih, GENESIS_PIH);
  assert.equal(firstB.pih, GENESIS_PIH);
  assert.notEqual(firstA.hash, firstB.hash, 'unit identity must distinguish the chains');
});

test('a restored device refuses to issue until it reconciles', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  const snapshot = unit.snapshot(1000);
  unit.issue(100, 1001, log);
  unit.issue(100, 1002, log);
  unit.restoreFrom(snapshot);
  assert.throws(() => unit.issue(100, 1003, log), CounterReuseError);
  unit.reconcile(log);
  assert.equal(unit.issue(100, 1004, log).icv, 3, 'must resume above the high-water mark');
  assert.deepEqual(log.reusedCounters('egs-pos-1'), []);
});

test('a restart is not a restore and rewinds nothing', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  unit.issue(100, 1000, log);
  unit.restart();
  assert.equal(unit.issue(100, 1001, log).icv, 2);
  assert.equal(verifyChain('egs-pos-1', log.issued).ok, true);
});

test('verifyChain catches a gap, a relink and a tampered total', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  unit.issue(100, 1000, log);
  unit.issue(100, 1001, log);
  unit.issue(100, 1002, log);
  assert.equal(verifyChain('egs-pos-1', log.issued).ok, true);

  const gapped = [log.issued[0]!, log.issued[2]!];
  assert.equal(verifyChain('egs-pos-1', gapped).ok, false, 'a gap must be caught');

  const relinked = [log.issued[0]!, { ...log.issued[1]!, pih: 'wrong' }, log.issued[2]!];
  assert.equal(verifyChain('egs-pos-1', relinked).ok, false, 'a relink must be caught');

  const tampered = [log.issued[0]!, { ...log.issued[1]!, total_minor: 999_999 }, log.issued[2]!];
  assert.equal(verifyChain('egs-pos-1', tampered).ok, false, 'an altered total must be caught');
});

// --- controls: each must FAIL, or it has proved nothing --------------------

test('the undetected-restore control FAILS, proving counter reuse is detected', () => {
  const r = runZatcaScenario({ ...BASE, skipRestoreReconciliation: true });
  assert.equal(r.passed, false, 'undetected restore was not detected');
  assert.ok(r.counterReuses > 0);
});

test('the shared-counter control FAILS, proving ADR-0006 rejected it for a reason', () => {
  const r = runZatcaScenario({ ...BASE, sharedCounter: true });
  assert.equal(r.passed, false, 'a shared counter was not detected');
  assert.ok(r.counterReuses > 0);
});

test('the broken-chain control FAILS, proving the chain is actually verified', () => {
  const r = runZatcaScenario({ ...BASE, breakChain: true });
  assert.equal(r.passed, false, 'a broken chain was not detected');
  assert.ok(r.brokenChains > 0);
});
