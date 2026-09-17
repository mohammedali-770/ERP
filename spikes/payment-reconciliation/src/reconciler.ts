/**
 * The unknown-outcome reconciliation protocol.
 *
 * Implements docs/architecture/core-transaction-design.md §4 using the state
 * machine already defined in @firsttaste/contracts.
 *
 * The single rule everything rests on:
 *
 *   **From UNKNOWN, the only permitted action is a QUERY. Never a charge.**
 *
 * A retry is permitted only after reconciliation returns "not charged".
 */
import {
  assertTransition, mayAttemptCharge, requiresReconciliation,
  RECONCILIATION_LADDER, TERMINAL_STATES,
  type PaymentState, type ReconciliationSource,
} from '@firsttaste/contracts';
import type { PaymentProvider } from './provider.ts';

export interface Intent {
  readonly intentId: string;
  readonly orderId: string;
  /** Derived from the intent, so a retry reuses it and cannot look like new business. */
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  state: PaymentState;
  attempts: number;
  /** How the unknown outcome was eventually settled, retained permanently. */
  resolvedBy: ReconciliationSource | null;
}

export class DoubleChargeAttempted extends Error {
  constructor(intentId: string, state: PaymentState) {
    super(`Refused to charge intent ${intentId} in state ${state}. ` +
          `From UNKNOWN the only permitted action is a query (PAY-007).`);
    this.name = 'DoubleChargeAttempted';
  }
}

export interface ReconcilerOptions {
  /**
   * Control case: retry blindly from UNKNOWN instead of querying. This is what a
   * naive implementation does, and it double-charges customers. Used to prove the
   * harness detects the failure it claims to test.
   */
  readonly blindRetry?: boolean;
}

export class Reconciler {
  private readonly provider: PaymentProvider;
  private readonly options: ReconcilerOptions;
  /** Refund identifiers minted before their call, so a retry is idempotent. */
  private readonly refundsIssued = new Map<string, string>();

  readonly ladderUsage: Record<ReconciliationSource, number> = {
    terminal_query: 0, gateway_query: 0, settlement_file: 0, human_attestation: 0,
  };
  readonly escalated: string[] = [];

  constructor(provider: PaymentProvider, options: ReconcilerOptions = {}) {
    this.provider = provider;
    this.options = options;
  }

  /**
   * Attempt a charge. Refuses unless the intent is in a state where money may
   * move — which is the guard that makes double-charging structurally impossible
   * rather than merely unlikely.
   */
  attemptCharge(intent: Intent, at: number): void {
    if (!mayAttemptCharge(intent.state)) throw new DoubleChargeAttempted(intent.intentId, intent.state);

    if (intent.state === 'CREATED') {
      assertTransition(intent.state, 'INITIATED');
      intent.state = 'INITIATED';
    }
    intent.attempts += 1;

    const outcome = this.provider.charge(intent.reference, intent.amountMinor, intent.currency, at);
    switch (outcome.kind) {
      case 'captured':
        assertTransition(intent.state, 'CAPTURED');
        intent.state = 'CAPTURED';
        return;
      case 'declined':
        assertTransition(intent.state, 'DECLINED');
        intent.state = 'DECLINED';
        return;
      case 'no_response':
        // We do not know whether the customer was charged. This is a state, not
        // an error, and it blocks retry (I-4).
        assertTransition(intent.state, 'UNKNOWN');
        intent.state = 'UNKNOWN';
        return;
    }
  }

  /**
   * Walk the ladder until an authoritative answer is found. Stops at the first
   * rung that answers; records which one, because "resolved by the terminal" and
   * "resolved by a person reading a slip" carry different audit weight.
   */
  reconcile(intent: Intent, humanWillAttest: boolean): void {
    if (!requiresReconciliation(intent.state)) return;

    if (this.options.blindRetry) {
      // THE CONTROL CASE. A naive implementation retries because retrying is what
      // you do when a request fails. The provider does not deduplicate, so the
      // customer pays twice.
      intent.state = 'INITIATED';
      this.attemptCharge(intent, Date.now());
      return;
    }

    for (const source of RECONCILIATION_LADDER) {
      const answer = this.ask(source, intent, humanWillAttest);
      if (answer === null) continue; // rung unreachable, try the next

      this.ladderUsage[source] += 1;
      intent.resolvedBy = source;
      if (answer) {
        assertTransition(intent.state, 'CAPTURED');
        intent.state = 'CAPTURED';
      } else {
        // Established as not charged. Only now may a retry happen, and it reuses
        // the same reference.
        assertTransition(intent.state, 'CANCELLED');
        intent.state = 'CANCELLED';
      }
      return;
    }

    // No rung answered. Escalate rather than guess.
    if (intent.state === 'UNKNOWN') {
      assertTransition(intent.state, 'ESCALATED');
      intent.state = 'ESCALATED';
    }
    this.escalated.push(intent.intentId);
  }

  /** Returns true (charged), false (not charged) or null (this rung cannot answer). */
  private ask(source: ReconciliationSource, intent: Intent, humanWillAttest: boolean): boolean | null {
    switch (source) {
      case 'terminal_query': {
        const r = this.provider.queryTerminal(intent.reference);
        return r.reachable ? r.captured : null;
      }
      case 'gateway_query': {
        const r = this.provider.queryGateway(intent.reference);
        return r.reachable ? r.captured : null;
      }
      case 'settlement_file': {
        const file = this.provider.settlementFile();
        if (file === null) return null; // not reachable; try the next rung
        return file.some((c) => c.reference === intent.reference);
      }
      case 'human_attestation': {
        if (!humanWillAttest) return null;
        // A person reads the printed slip. Lower confidence, always reviewed.
        return this.provider.allCharges().some((c) => c.reference === intent.reference && c.captured);
      }
    }
  }

  /**
   * Issue a refund. The identifier is minted and persisted BEFORE the call and
   * carried as the provider's idempotency key, so a retry cannot refund twice
   * (PAY-011). Lookup is by identifier only — never by matching amount and time,
   * which is the standard way teams accidentally refund twice.
   */
  refund(refundId: string, intent: Intent, amountMinor: number): string {
    const already = this.refundsIssued.get(refundId);
    if (already) return already;
    const result = this.provider.refund(refundId, intent.reference, amountMinor);
    this.refundsIssued.set(refundId, result.providerRef);
    return result.providerRef;
  }

  /** An order is frozen for payment activity while any intent is unresolved. */
  static orderFrozen(intents: readonly Intent[]): boolean {
    return intents.some((i) => requiresReconciliation(i.state));
  }

  static settled(intent: Intent): boolean {
    return TERMINAL_STATES.has(intent.state) || intent.state === 'CAPTURED';
  }
}
