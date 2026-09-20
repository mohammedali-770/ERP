import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, assertTransition, mayAttemptCharge, requiresReconciliation,
  orderPaymentFrozen, detectIntentConflict, liveIntents, TERMINAL_STATES,
  RECONCILIATION_LADDER, type PaymentIntent, type PaymentState,
} from '../src/events/payment-state.ts';

const intent = (state: PaymentState, id = 'pi-1'): PaymentIntent => ({
  intent_id: id, order_id: 'ord-1', state, amount_minor: 5000, currency: 'SAR', provider_ref: `ref-${id}`,
});

test('a normal capture path is permitted', () => {
  assert.ok(canTransition('CREATED', 'INITIATED'));
  assert.ok(canTransition('INITIATED', 'AUTHORIZED'));
  assert.ok(canTransition('AUTHORIZED', 'CAPTURED'));
  assert.ok(canTransition('CAPTURED', 'REFUNDED'));
});

test('terminal states are never re-opened', () => {
  // I-6: a state machine that can go backwards will eventually charge twice.
  for (const terminal of TERMINAL_STATES) {
    for (const to of ['INITIATED', 'CAPTURED', 'AUTHORIZED'] as PaymentState[]) {
      assert.equal(canTransition(terminal, to), false, `${terminal} → ${to} must be illegal`);
    }
  }
});

test('an illegal transition throws with the reason, not silently', () => {
  assert.throws(() => assertTransition('REFUNDED', 'CAPTURED'), /never re-opened/);
});

test('UNKNOWN blocks any further charge attempt', () => {
  // PAY-007: reconcile before attempting another charge.
  assert.equal(mayAttemptCharge('UNKNOWN'), false);
  assert.equal(requiresReconciliation('UNKNOWN'), true);
});

test('UNKNOWN can only resolve to a real outcome or escalation', () => {
  assert.ok(canTransition('UNKNOWN', 'CAPTURED'));
  assert.ok(canTransition('UNKNOWN', 'DECLINED'));
  assert.ok(canTransition('UNKNOWN', 'ESCALATED'));
  // Crucially, it cannot go back to INITIATED — that would be a silent retry.
  assert.equal(canTransition('UNKNOWN', 'INITIATED'), false);
});

test('only CREATED and INITIATED may send money-moving traffic', () => {
  const chargeable = (['CREATED','INITIATED','AUTHORIZED','CAPTURED','PENDING','UNKNOWN','DECLINED'] as PaymentState[])
    .filter(mayAttemptCharge);
  assert.deepEqual(chargeable, ['CREATED', 'INITIATED']);
});

test('the reconciliation ladder starts with the terminal query', () => {
  // The terminal query works with central unreachable, which is why it is first.
  assert.equal(RECONCILIATION_LADDER[0], 'terminal_query');
  assert.equal(RECONCILIATION_LADDER.at(-1), 'human_attestation');
});

test('an order with an unresolved intent is frozen for payment', () => {
  assert.equal(orderPaymentFrozen([intent('CAPTURED')]), false);
  assert.equal(orderPaymentFrozen([intent('CAPTURED'), intent('UNKNOWN', 'pi-2')]), true);
});

test('two live intents on one order are detected, not merged', () => {
  // I-3: the system does not pick a winner; it raises an incident.
  const conflict = detectIntentConflict([intent('INITIATED', 'pi-1'), intent('AUTHORIZED', 'pi-2')]);
  assert.ok(conflict);
  assert.equal(conflict.length, 2);
});

test('a split payment of settled plus live legs is not a conflict', () => {
  assert.equal(detectIntentConflict([intent('REFUNDED', 'pi-1'), intent('INITIATED', 'pi-2')]), null);
});

test('several settled legs are not a conflict', () => {
  // PAY-008: split payment is several intents, and settled ones do not contend.
  assert.equal(detectIntentConflict([intent('DECLINED', 'pi-1'), intent('CANCELLED', 'pi-2')]), null);
  assert.equal(liveIntents([intent('DECLINED'), intent('CANCELLED', 'pi-2')]).length, 0);
});

test('partial refunds may repeat but a full refund is terminal', () => {
  assert.ok(canTransition('PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'));
  assert.ok(canTransition('PARTIALLY_REFUNDED', 'REFUNDED'));
  assert.equal(canTransition('REFUNDED', 'PARTIALLY_REFUNDED'), false);
});
