import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShiftLedger } from '../src/shifts.ts';

test('cash follows the shift, not the device', () => {
  // POS-023: one cashier may work several terminals; responsibility stays with
  // the shift. This is the normal case, not a conflict.
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  l.joinDevice(s.shift_id, 'dev-b');
  l.joinDevice(s.shift_id, 'dev-c');
  l.recordCash(s.shift_id, 'drawer-1', 5000, 'dev-a', 1100);
  l.recordCash(s.shift_id, 'drawer-1', 3000, 'dev-b', 1200);
  l.recordCash(s.shift_id, 'drawer-1', 2000, 'dev-c', 1300);
  assert.equal(l.expectedCash(s.shift_id), 10_000);
});

test('a duplicate close is rejected and recorded', () => {
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  assert.equal(l.requestClose(s.shift_id, 'dev-a', 1100).accepted, true);
  assert.equal(l.requestClose(s.shift_id, 'dev-b', 1101).accepted, false);
  assert.ok(l.incidents.some((i) => i.kind === 'ShiftCloseRejected'));
});

test('a duplicate open merges to the earliest HLC with zero cash lost', () => {
  const l = new ShiftLedger();
  const early = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  const late = l.openShift('br-1', 'cashier-1', 'dev-b', 2000);
  l.recordCash(early.shift_id, 'drawer-1', 4000, 'dev-a', 1100);
  l.recordCash(late.shift_id, 'drawer-2', 6000, 'dev-b', 2100);
  const before = l.totalCash();

  const merge = l.mergeDuplicateOpen(early.shift_id, late.shift_id);
  assert.equal(merge.canonical, early.shift_id);
  assert.equal(l.totalCash(), before, 'cash was lost in the merge');
  assert.equal(l.expectedCash(early.shift_id), 10_000);
});

test('merge order does not change the outcome', () => {
  // The rule is "earliest HLC wins", not "whoever merged first wins".
  const build = (): [ShiftLedger, string, string] => {
    const l = new ShiftLedger();
    const early = l.openShift('br-1', 'c1', 'dev-a', 1000);
    const late = l.openShift('br-1', 'c1', 'dev-b', 2000);
    l.recordCash(late.shift_id, 'd2', 6000, 'dev-b', 2100);
    return [l, early.shift_id, late.shift_id];
  };
  const [l1, e1, t1] = build();
  const [l2, e2, t2] = build();
  assert.equal(l1.mergeDuplicateOpen(e1, t1).canonical, e1);
  assert.equal(l2.mergeDuplicateOpen(t2, e2).canonical, e2);
});

test('reassignment is append-only and retains the original parent', () => {
  // OFF-009: corrections are appended, never destructive overwrites.
  const l = new ShiftLedger();
  const early = l.openShift('br-1', 'c1', 'dev-a', 1000);
  const late = l.openShift('br-1', 'c1', 'dev-b', 2000);
  l.recordCash(late.shift_id, 'd2', 6000, 'dev-b', 2100);
  l.mergeDuplicateOpen(early.shift_id, late.shift_id);
  const moved = l.movementsFor(early.shift_id);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]!.reassigned_from, late.shift_id, 'the original parent must be retained');
});

test('shifts for different cashiers are never merged', () => {
  const l = new ShiftLedger();
  const a = l.openShift('br-1', 'cashier-1', 'dev-a', 1000);
  const b = l.openShift('br-1', 'cashier-2', 'dev-b', 2000);
  assert.throws(() => l.mergeDuplicateOpen(a.shift_id, b.shift_id), /one cashier/);
});

test('variance requires a prior count commitment', () => {
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'c1', 'dev-a', 1000);
  assert.throws(() => l.computeVariance(s.shift_id, 9500, 'n'), /committed first/);
});

test('an altered count is detected by its commitment hash', () => {
  // POS-024: a UI-only blind count is defeated by anyone who can read the local
  // database. Commit-then-reveal makes alteration detectable.
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'c1', 'dev-a', 1000);
  l.recordCash(s.shift_id, 'd1', 10_000, 'dev-a', 1100);
  l.commitCount(s.shift_id, 9500, 'nonce', 1200);
  assert.throws(() => l.computeVariance(s.shift_id, 10_000, 'nonce'), /altered/);
});

test('the committed count yields the correct variance', () => {
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'c1', 'dev-a', 1000);
  l.recordCash(s.shift_id, 'd1', 10_000, 'dev-a', 1100);
  l.commitCount(s.shift_id, 9500, 'nonce', 1200);
  const v = l.computeVariance(s.shift_id, 9500, 'nonce');
  assert.equal(v.expected_minor, 10_000);
  assert.equal(v.counted_minor, 9500);
  assert.equal(v.variance_minor, -500);
});

test('a count cannot be committed after the variance is revealed', () => {
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'c1', 'dev-a', 1000);
  l.commitCount(s.shift_id, 0, 'n', 1100);
  l.computeVariance(s.shift_id, 0, 'n');
  assert.throws(() => l.commitCount(s.shift_id, 500, 'n2', 1200), /not be blind/);
});

test('a closed shift is terminal', () => {
  const l = new ShiftLedger();
  const s = l.openShift('br-1', 'c1', 'dev-a', 1000);
  l.commitCount(s.shift_id, 0, 'n', 1100);
  l.computeVariance(s.shift_id, 0, 'n');
  assert.equal(l.getShift(s.shift_id)?.status, 'closed');
  assert.throws(() => l.joinDevice(s.shift_id, 'dev-z'), /closed/);
});

test('a merged shift reconciles cash from every device that joined either', () => {
  const l = new ShiftLedger();
  const early = l.openShift('br-1', 'c1', 'dev-a', 1000);
  const late = l.openShift('br-1', 'c1', 'dev-b', 2000);
  l.joinDevice(late.shift_id, 'dev-c');
  l.recordCash(early.shift_id, 'd1', 1000, 'dev-a', 1100);
  l.recordCash(late.shift_id, 'd2', 2000, 'dev-b', 2100);
  l.recordCash(late.shift_id, 'd2', 3000, 'dev-c', 2200);
  l.mergeDuplicateOpen(early.shift_id, late.shift_id);
  assert.equal(l.expectedCash(early.shift_id), 6000);
  assert.equal(l.getShift(early.shift_id)?.devices.size, 3);
});
