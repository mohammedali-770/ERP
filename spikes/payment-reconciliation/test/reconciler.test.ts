import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentProvider, type ProviderFaults } from '../src/provider.ts';
import { Reconciler, DoubleChargeAttempted, type Intent } from '../src/reconciler.ts';
import { runPaymentScenario, type PaymentScenarioConfig } from '../src/scenario.ts';

const NO_FAULTS: ProviderFaults = {
  loseResponseRate: 0, declineRate: 0, terminalUnreachableRate: 0,
  gatewayUnreachableRate: 0, settlementUnreachableRate: 0, supportsQueryByReference: true,
};

const intent = (over: Partial<Intent> = {}): Intent => ({
  intentId: 'pi-1', orderId: 'ord-1', reference: 'REF1', amountMinor: 2500,
  currency: 'SAR', state: 'CREATED', attempts: 0, resolvedBy: null, ...over,
});

const BASE: PaymentScenarioConfig = {
  transactions: 400,
  faults: { loseResponseRate: 0.08, declineRate: 0.03, terminalUnreachableRate: 0.2,
            gatewayUnreachableRate: 0.3, settlementUnreachableRate: 0.1, supportsQueryByReference: true },
  humanAttestationRate: 0.9, refundRate: 0.15, seed: 3,
};

test('a charge from UNKNOWN is refused, not attempted', () => {
  // The structural guard. Without it, every other protection is advisory.
  const p = new PaymentProvider(NO_FAULTS, () => 0.5);
  const r = new Reconciler(p);
  const i = intent({ state: 'UNKNOWN' });
  assert.throws(() => r.attemptCharge(i, 1000), DoubleChargeAttempted);
  assert.equal(p.chargeAttempts.length, 0, 'the provider must not have been contacted at all');
});

test('a charge from a terminal state is refused', () => {
  const p = new PaymentProvider(NO_FAULTS, () => 0.5);
  const r = new Reconciler(p);
  for (const state of ['CAPTURED', 'REFUNDED', 'DECLINED', 'CANCELLED'] as const) {
    assert.throws(() => r.attemptCharge(intent({ state }), 1000), DoubleChargeAttempted);
  }
});

test('reconciliation stops at the first rung that answers', () => {
  const p = new PaymentProvider(NO_FAULTS, () => 0.5);
  const r = new Reconciler(p);
  const i = intent();
  r.attemptCharge(i, 1000);
  i.state = 'UNKNOWN'; // simulate a lost response on a charge that did happen
  r.reconcile(i, false);
  assert.equal(i.state, 'CAPTURED');
  assert.equal(i.resolvedBy, 'terminal_query');
  assert.equal(r.ladderUsage.gateway_query, 0, 'later rungs must not be consulted');
});

test('the ladder falls through when a rung is unreachable', () => {
  const faults = { ...NO_FAULTS, terminalUnreachableRate: 1 };
  const p = new PaymentProvider(faults, () => 0.5);
  const r = new Reconciler(p);
  const i = intent();
  r.attemptCharge(i, 1000);
  i.state = 'UNKNOWN';
  r.reconcile(i, false);
  assert.equal(i.resolvedBy, 'gateway_query');
});

test('an unresolvable outcome escalates rather than guessing', () => {
  const faults = {
    ...NO_FAULTS, terminalUnreachableRate: 1, gatewayUnreachableRate: 1, settlementUnreachableRate: 1,
  };
  const p = new PaymentProvider(faults, () => 0.5);
  const r = new Reconciler(p);
  const i = intent({ state: 'UNKNOWN' });
  r.reconcile(i, false); // nobody available to attest
  assert.equal(i.state, 'ESCALATED');
  assert.deepEqual(r.escalated, ['pi-1']);
});

test('the resolution source is recorded, because they carry different audit weight', () => {
  const faults = { ...NO_FAULTS, terminalUnreachableRate: 1, gatewayUnreachableRate: 1, settlementUnreachableRate: 1 };
  const p = new PaymentProvider(faults, () => 0.5);
  const r = new Reconciler(p);
  const i = intent();
  r.attemptCharge(i, 1000);
  i.state = 'UNKNOWN';
  r.reconcile(i, true); // a person checks the slip
  assert.equal(i.resolvedBy, 'human_attestation');
});

test('a retried refund issues exactly one refund', () => {
  const p = new PaymentProvider(NO_FAULTS, () => 0.5);
  const r = new Reconciler(p);
  const i = intent({ state: 'CAPTURED' });
  const first = r.refund('rf-1', i, 2500);
  const second = r.refund('rf-1', i, 2500);
  assert.equal(first, second);
  assert.equal(p.refundCount(), 1);
});

test('different refund identifiers issue different refunds', () => {
  const p = new PaymentProvider(NO_FAULTS, () => 0.5);
  const r = new Reconciler(p);
  const i = intent({ state: 'CAPTURED' });
  r.refund('rf-1', i, 1000);
  r.refund('rf-2', i, 1500);
  assert.equal(p.refundCount(), 2);
});

test('an order is frozen while any intent is unresolved', () => {
  assert.equal(Reconciler.orderFrozen([intent({ state: 'CAPTURED' })]), false);
  assert.equal(Reconciler.orderFrozen([intent({ state: 'CAPTURED' }), intent({ state: 'UNKNOWN' })]), true);
  assert.equal(Reconciler.orderFrozen([intent({ state: 'ESCALATED' })]), true);
});

test('the full scenario charges nobody twice', () => {
  const r = runPaymentScenario(BASE);
  assert.equal(r.doubleCharges, 0, r.failures.join('; '));
  assert.equal(r.misattributedPayments, 0);
  assert.equal(r.referenceCollisions, 0);
  assert.equal(r.passed, true, r.failures.join('; '));
});

test('every ambiguous outcome had a retry blocked', () => {
  // Proves the guard is universal rather than usually applied.
  const r = runPaymentScenario(BASE);
  assert.equal(r.blockedRetries, r.ambiguousInduced);
});

test('the blind-retry control FAILS, proving the harness detects double charges', () => {
  const r = runPaymentScenario({ ...BASE, blindRetry: true });
  assert.equal(r.passed, false, 'blind retry was not detected');
  assert.ok(r.doubleCharges > 0);
});

test('the truncated-reference control FAILS, proving collisions are detected', () => {
  const r = runPaymentScenario({ ...BASE, unsafeReference: true });
  assert.equal(r.passed, false, 'reference collision was not detected');
  assert.ok(r.referenceCollisions > 0);
});

test('the guard holds even when the acquirer cannot be queried', () => {
  // The provider capability changes how much human effort is needed. It does not
  // change whether a customer can be charged twice.
  const r = runPaymentScenario({
    ...BASE, faults: { ...BASE.faults, supportsQueryByReference: false },
  });
  assert.equal(r.doubleCharges, 0);
});

test('results are deterministic for a given seed', () => {
  assert.deepEqual(runPaymentScenario({ ...BASE, seed: 42 }), runPaymentScenario({ ...BASE, seed: 42 }));
});
