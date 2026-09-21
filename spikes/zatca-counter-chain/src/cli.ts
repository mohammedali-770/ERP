/**
 * npm run spike:zatca-counter-chain
 *
 * Proves the half of T-09 that does not need sandbox credentials: per-unit
 * counters, the previous-invoice-hash chain, and the restore-from-backup case
 * ADR-0006 calls a compliance breach rather than a bug.
 *
 * It does NOT prove deferred synchronisation, clearance, signatures or
 * certificates. Those need B-02 to lift, and claiming them here would be worse
 * than the gap.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { EgsUnit, IssuanceLog, verifyChain, CounterReuseError, GENESIS_PIH } from './egs.ts';
import { runZatcaScenario } from './scenario.ts';

interface Case { name: string; requirement: string; passed: boolean; detail: string }
const cases: Case[] = [];

function check(name: string, requirement: string, fn: () => string): void {
  try {
    cases.push({ name, requirement, passed: true, detail: fn() });
  } catch (e) {
    cases.push({ name, requirement, passed: false, detail: (e as Error).message });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check('three devices are three EGS units with independent chains', 'PAY-016, ADR-0006', () => {
  const r = runZatcaScenario({ units: 3, invoicesPerUnit: 4 });
  assert(r.passed, `baseline must hold: ${r.problems.join('; ')}`);
  assert(r.issued === 13, `expected 13 invoices, got ${r.issued}`);
  return `${r.issued} invoices across 3 units, every chain gapless and verified`;
});

check('a counter increments by exactly one, with no gaps', 'PAY-018', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  for (let i = 0; i < 25; i += 1) unit.issue(500 + i, 1000 + i, log);
  const icvs = log.issued.map((i) => i.icv);
  assert(icvs.every((v, idx) => v === idx + 1), `counter is not gapless: ${icvs.join(',')}`);
  return '25 invoices, counter 1..25 with no gap and no repeat';
});

check('the first invoice starts from the genesis previous-invoice-hash', 'PAY-018', () => {
  const log = new IssuanceLog();
  const first = new EgsUnit('egs-pos-1').issue(1000, 1000, log);
  assert(first.pih === GENESIS_PIH, 'first invoice must chain from the genesis PIH');
  assert(first.icv === 1, 'first invoice must be counter 1');
  return 'chain seeded from SHA-256("0") at counter 1';
});

check('the hash chain verifies end to end', 'PAY-018', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  for (let i = 0; i < 10; i += 1) unit.issue(750, 1000 + i, log);
  const verdict = verifyChain('egs-pos-1', log.issued);
  assert(verdict.ok, `chain did not verify: ${verdict.problem}`);
  return `${verdict.count} invoices verified, each PIH equal to its predecessor's hash`;
});

check('a restart does not disturb the counter or the chain', 'PAY-017', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  unit.issue(1000, 1000, log);
  unit.issue(1000, 1001, log);
  unit.restart();
  const after = unit.issue(1000, 1002, log);
  assert(after.icv === 3, `restart must not rewind: expected counter 3, got ${after.icv}`);
  assert(verifyChain('egs-pos-1', log.issued).ok, 'chain must survive a restart');
  return 'counter continued at 3 across a restart, chain intact';
});

check('a restored device refuses to issue before it reconciles', 'PAY-018, ACC-005', () => {
  const log = new IssuanceLog();
  const unit = new EgsUnit('egs-pos-1');
  const snapshot = unit.snapshot(1000);
  unit.issue(1000, 1001, log);
  unit.issue(1000, 1002, log);
  unit.restoreFrom(snapshot);
  let refused = false;
  try { unit.issue(1000, 1003, log); } catch (e) { refused = e instanceof CounterReuseError; }
  assert(refused, 'a restored device must refuse to issue until it has reconciled');
  unit.reconcile(log);
  const resumed = unit.issue(1000, 1004, log);
  assert(resumed.icv === 3, `after reconciling it must resume above the high-water mark, got ${resumed.icv}`);
  assert(log.reusedCounters('egs-pos-1').length === 0, 'no counter may be reused');
  return 'issuance refused while stale, resumed at counter 3 after reconciling';
});

// --- controls -------------------------------------------------------------
// Each must FAIL. A control that passes has proved nothing.

check('CONTROL: an undetected restore reuses a counter', 'PAY-018, ADR-0006', () => {
  const r = runZatcaScenario({ units: 3, invoicesPerUnit: 4, skipRestoreReconciliation: true });
  assert(!r.passed, 'the undetected-restore control passed — it proves nothing');
  assert(r.counterReuses > 0, 'counter reuse was not detected');
  return `detected: ${r.problems[0]}`;
});

check('CONTROL: one counter shared across devices breaks', 'ADR-0006', () => {
  const r = runZatcaScenario({ units: 3, invoicesPerUnit: 4, sharedCounter: true });
  assert(!r.passed, 'the shared-counter control passed — it proves nothing');
  assert(r.counterReuses > 0, 'sharing a counter must produce reuse');
  return `detected: ${r.problems[0]}`;
});

check('CONTROL: a relinked invoice breaks the chain', 'PAY-018', () => {
  const r = runZatcaScenario({ units: 3, invoicesPerUnit: 4, breakChain: true });
  assert(!r.passed, 'the broken-chain control passed — it proves nothing');
  assert(r.brokenChains > 0, 'a broken chain was not detected');
  return `detected: ${r.problems[0]}`;
});

const passed = cases.filter((c) => c.passed).length;
console.log('spike:zatca-counter-chain — proves the credential-free half of T-09\n');
for (const c of cases) {
  console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}  [${c.requirement}]`);
  console.log(`        ${c.detail}`);
}
console.log(`\n  ${passed}/${cases.length} cases passed`);
console.log('  NOT proved here: deferred synchronisation, clearance, signatures, certificates — blocked by B-02');

mkdirSync('spikes/zatca-counter-chain/out', { recursive: true });
writeFileSync('spikes/zatca-counter-chain/out/report.json', JSON.stringify(
  {
    spike: 'zatca-counter-chain',
    scenario: 'T-09 (partial — counter and hash chain only)',
    blocked_half: 'deferred synchronisation, clearance, signatures, certificates (B-02)',
    cases, passed, total: cases.length, generated_at: new Date().toISOString(),
  }, null, 2));

if (passed === cases.length) {
  console.log('\nPASS — Report: spikes/zatca-counter-chain/out/report.json');
} else {
  console.error('\nFAIL');
  process.exit(1);
}
