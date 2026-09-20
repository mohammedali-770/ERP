/**
 * The payment outcome state machine.
 *
 * Two properties carry the whole design:
 *   1. Transitions are monotonic — a terminal state is never re-opened (I-6).
 *      A state machine that can go backwards is one that will eventually charge
 *      someone twice.
 *   2. From UNKNOWN the only permitted action is a QUERY, never a charge
 *      (PAY-007, I-4).
 *
 * See docs/architecture/core-transaction-design.md §4.
 */

export type PaymentState =
  | 'CREATED' | 'INITIATED' | 'AUTHORIZED' | 'CAPTURED'
  | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'DECLINED' | 'CANCELLED'
  | 'EXPIRED' | 'PENDING' | 'UNKNOWN' | 'ESCALATED';

export const TERMINAL_STATES: ReadonlySet<PaymentState> = new Set<PaymentState>([
  'REFUNDED', 'DECLINED', 'CANCELLED', 'EXPIRED',
]);

const TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  CREATED: ['INITIATED', 'CANCELLED'],
  INITIATED: ['AUTHORIZED', 'CAPTURED', 'DECLINED', 'CANCELLED', 'PENDING', 'UNKNOWN'],
  AUTHORIZED: ['CAPTURED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'],
  CAPTURED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PENDING: ['CAPTURED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'],
  // UNKNOWN resolves only through reconciliation, to a real outcome or escalation.
  UNKNOWN: ['AUTHORIZED', 'CAPTURED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'ESCALATED'],
  ESCALATED: ['AUTHORIZED', 'CAPTURED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
  REFUNDED: [],
  DECLINED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Illegal payment transition ${from} → ${to}. ` +
      `Terminal states are never re-opened; contradicting evidence must raise a ` +
      `PaymentOutcomeDisputed incident instead (I-6).`,
    );
  }
}

/** The one question the whole protocol turns on: may we send money-moving traffic? */
export function mayAttemptCharge(state: PaymentState): boolean {
  return state === 'CREATED' || state === 'INITIATED';
}

/** UNKNOWN blocks retry. Only a query is allowed (PAY-007). */
export function requiresReconciliation(state: PaymentState): boolean {
  return state === 'UNKNOWN' || state === 'ESCALATED';
}

/** The reconciliation ladder, in order. Stops at the first authoritative answer. */
export type ReconciliationSource =
  | 'terminal_query'    // works with central unreachable, which is why it is first
  | 'gateway_query'
  | 'settlement_file'
  | 'human_attestation'; // lower confidence; always reviewed at shift close

export const RECONCILIATION_LADDER: readonly ReconciliationSource[] = [
  'terminal_query', 'gateway_query', 'settlement_file', 'human_attestation',
];

export interface PaymentIntent {
  readonly intent_id: string;
  readonly order_id: string;
  readonly state: PaymentState;
  readonly amount_minor: number;
  readonly currency: string;
  /** Derived from the INTENT, never the attempt, so a retry cannot look new. */
  readonly provider_ref: string;
}

/**
 * Whether an order is frozen for payment activity.
 *
 * While any intent is unresolved: no new intents, no automatic refunds, no
 * auto-close of the containing shift.
 */
export function orderPaymentFrozen(intents: readonly PaymentIntent[]): boolean {
  return intents.some((i) => requiresReconciliation(i.state));
}

/**
 * Enforces at most one non-terminal intent per order.
 *
 * Under a genuine partition two devices could both create one. This does not
 * pretend to prevent that without a coordinator — it guarantees DETECTION, which
 * is what raises a PaymentConflictIncident rather than silently merging (I-3).
 */
export function liveIntents(intents: readonly PaymentIntent[]): PaymentIntent[] {
  return intents.filter((i) => !TERMINAL_STATES.has(i.state));
}

export function detectIntentConflict(intents: readonly PaymentIntent[]): PaymentIntent[] | null {
  const live = liveIntents(intents);
  return live.length > 1 ? live : null;
}
