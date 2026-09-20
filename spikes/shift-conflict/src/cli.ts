/**
 * npm run spike:shift-conflict
 *
 * Proves the shift, cash and blind-count rules (T-08, POS-022..026).
 * Each case states what it proves and fails loudly if the property does not hold.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { ShiftLedger } from './shifts.ts';

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

check('one cashier across three terminals', 'POS-022, POS-023', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.joinDevice(shift.shift_id, 'dev-b');
  l.joinDevice(shift.shift_id, 'dev-c');
  l.recordCash(shift.shift_id, 'drawer-1', 5000, 'dev-a', 1100);
  l.recordCash(shift.shift_id, 'drawer-1', 3000, 'dev-b', 1200);
  l.recordCash(shift.shift_id, 'drawer-1', 2000, 'dev-c', 1300);
  assert(l.expectedCash(shift.shift_id) === 10_000, 'cash from all three devices must reconcile to one shift');
  assert(shift.devices.size === 3, 'all three devices must be on the shift');
  return 'one shift reconciled 10000 minor units across three terminals';
});

check('duplicate close: first wins, second is told', 'POS-026', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  const first = l.requestClose(shift.shift_id, 'dev-a', 1100);
  const second = l.requestClose(shift.shift_id, 'dev-b', 1101);
  assert(first.accepted, 'first close must win');
  assert(!second.accepted, 'second close must be rejected, not silently accepted');
  assert(l.incidents.some((i) => i.kind === 'ShiftCloseRejected'), 'rejection must be recorded');
  return 'second close rejected and recorded';
});

check('duplicate open under partition merges with zero cash lost', 'OFF-009, POS-023', () => {
  const l = new ShiftLedger();
  const early = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  const late = l.openShift('br-1', 'cashier-1', 'dev-b', 2000);
  l.recordCash(early.shift_id, 'drawer-1', 4000, 'dev-a', 1100);
  l.recordCash(late.shift_id, 'drawer-2', 6000, 'dev-b', 2100);
  const before = l.totalCash();

  const merge = l.mergeDuplicateOpen(early.shift_id, late.shift_id);
  assert(merge.canonical === early.shift_id, 'earliest HLC must be canonical');
  assert(merge.reassigned === 1, 'the later shift cash must be reassigned');
  assert(l.totalCash() === before, 'no cash may be lost in a merge');
  assert(l.expectedCash(early.shift_id) === 10_000, 'all cash must land on the canonical shift');
  const reassigned = l.movementsFor(early.shift_id).filter((m) => m.reassigned_from !== null);
  assert(reassigned.length === 1 && reassigned[0]!.reassigned_from === late.shift_id,
    'the reassignment must retain its original parent — append-only, not an edit');
  assert(l.incidents.some((i) => i.kind === 'ShiftMergeRequired'), 'the merge must raise an incident');
  return 'merged with zero cash lost and an append-only correction trail';
});

check('blind count: variance cannot be computed before a commitment', 'POS-024', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.recordCash(shift.shift_id, 'drawer-1', 10_000, 'dev-a', 1100);
  let threw = false;
  try { l.computeVariance(shift.shift_id, 9500, 'nonce'); } catch { threw = true; }
  assert(threw, 'variance must require a prior count commitment');
  return 'variance refused without a commitment';
});

check('blind count: an altered count is detected', 'POS-024', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.recordCash(shift.shift_id, 'drawer-1', 10_000, 'dev-a', 1100);
  l.commitCount(shift.shift_id, 9500, 'nonce-1', 1200);
  let threw = false;
  // The cashier learns the expected figure and tries to submit a matching count.
  try { l.computeVariance(shift.shift_id, 10_000, 'nonce-1'); } catch { threw = true; }
  assert(threw, 'a count that does not match its commitment must be rejected');
  const v = l.computeVariance(shift.shift_id, 9500, 'nonce-1');
  assert(v.variance_minor === -500, 'variance must be computed from the committed count');
  return 'altered count rejected; committed count yields variance -500';
});

check('a count cannot be committed after the variance is known', 'POS-024', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.recordCash(shift.shift_id, 'drawer-1', 10_000, 'dev-a', 1100);
  l.commitCount(shift.shift_id, 9800, 'n', 1200);
  l.computeVariance(shift.shift_id, 9800, 'n');
  let threw = false;
  try { l.commitCount(shift.shift_id, 10_000, 'n2', 1300); } catch { threw = true; }
  assert(threw, 'a second count after reveal would not be blind');
  return 'post-reveal commitment refused';
});

check('a closed shift is never reopened', 'POS-026', () => {
  const l = new ShiftLedger();
  const shift = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.commitCount(shift.shift_id, 0, 'n', 1100);
  l.computeVariance(shift.shift_id, 0, 'n');
  let threw = false;
  try { l.joinDevice(shift.shift_id, 'dev-z'); } catch { threw = true; }
  assert(threw, 'a device must not join a closed shift');
  return 'closed shift refused a new device';
});

const passed = cases.filter((c) => c.passed).length;
console.log('spike:shift-conflict — proves T-08 / POS-022..026\n');
for (const c of cases) {
  console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.name}  [${c.requirement}]`);
  console.log(`        ${c.detail}`);
}
console.log(`\n  ${passed}/${cases.length} cases passed`);

mkdirSync('spikes/shift-conflict/out', { recursive: true });
writeFileSync('spikes/shift-conflict/out/report.json', JSON.stringify(
  { spike: 'shift-conflict', scenario: 'T-08', cases, passed, total: cases.length, generated_at: new Date().toISOString() },
  null, 2));

if (passed === cases.length) {
  console.log('\nPASS — Report: spikes/shift-conflict/out/report.json');
} else {
  console.error('\nFAIL');
  process.exit(1);
}
