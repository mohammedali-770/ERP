/**
 * A simulated payment provider — the acquirer, gateway and card terminal.
 *
 * SPIKE CODE. It exists so the reconciliation protocol can be proven before a
 * provider is selected (D-1 is frozen), not to be extended into the product.
 *
 * The essential property: **the provider holds ground truth about whether a
 * customer was charged, and our system does not.** Every fault it injects
 * separates what actually happened from what we were told. That gap is the entire
 * problem PAY-007 and NFR-004 describe, and the only honest way to model it.
 */

export interface Charge {
  /** Our reference, derived from the payment INTENT, never the attempt. */
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Ground truth: did the customer's money actually move? */
  readonly captured: boolean;
  readonly providerRef: string;
  readonly at: number;
}

export interface Refund {
  readonly refundId: string;
  readonly chargeReference: string;
  readonly amountMinor: number;
  readonly providerRef: string;
}

export type ChargeOutcome =
  | { kind: 'captured'; providerRef: string }
  | { kind: 'declined'; reason: string }
  /** The provider processed it, but we never learned the result. */
  | { kind: 'no_response' };

export interface ProviderFaults {
  /** Charge succeeds at the provider, but the response never reaches us. */
  readonly loseResponseRate: number;
  /** The provider declines. */
  readonly declineRate: number;
  /** A terminal query cannot reach the terminal. */
  readonly terminalUnreachableRate: number;
  /** A gateway query cannot reach the gateway (e.g. branch offline). */
  readonly gatewayUnreachableRate: number;
  /**
   * The settlement file cannot be fetched. It is retrieved over the network like
   * everything else, so during an outage it is no more available than the
   * gateway — modelling it as always-reachable would hide the whole cost of
   * lacking a terminal query.
   */
  readonly settlementUnreachableRate: number;
  /** Whether the acquirer supports query-by-reference at all (question A1). */
  readonly supportsQueryByReference: boolean;
}

export class PaymentProvider {
  /** Ground truth, keyed by our reference. */
  private readonly charges = new Map<string, Charge>();
  private readonly refunds = new Map<string, Refund>();
  private readonly random: () => number;
  private readonly faults: ProviderFaults;

  /** Every charge attempt that reached the provider, for double-charge detection. */
  readonly chargeAttempts: Array<{ reference: string; amountMinor: number; at: number }> = [];

  constructor(faults: ProviderFaults, random: () => number) {
    this.faults = faults;
    this.random = random;
  }

  /**
   * Attempt a charge. The reference is ours, derived from the intent.
   *
   * A repeated reference is NOT deduplicated by the provider — most terminal
   * protocols do not — so a blind retry charges the customer again. That is
   * precisely the failure the reconciliation protocol exists to prevent, and
   * modelling it faithfully is what gives the control case teeth.
   */
  charge(reference: string, amountMinor: number, currency: string, at: number): ChargeOutcome {
    this.chargeAttempts.push({ reference, amountMinor, at });

    if (this.random() < this.faults.declineRate) {
      return { kind: 'declined', reason: 'insufficient_funds' };
    }

    const providerRef = `prv-${this.chargeAttempts.length}`;
    const existing = this.charges.get(reference);
    if (existing) {
      // A second charge on the same reference. The provider happily takes the
      // money again — it has no idea this is a retry.
      this.charges.set(reference, { ...existing, captured: true, amountMinor: existing.amountMinor + amountMinor });
    } else {
      this.charges.set(reference, { reference, amountMinor, currency, captured: true, providerRef, at });
    }

    if (this.random() < this.faults.loseResponseRate) return { kind: 'no_response' };
    return { kind: 'captured', providerRef };
  }

  /** Rung 1 of the ladder: ask the terminal directly. Works with central offline. */
  queryTerminal(reference: string): { reachable: boolean; captured: boolean | null } {
    if (!this.faults.supportsQueryByReference) return { reachable: false, captured: null };
    if (this.random() < this.faults.terminalUnreachableRate) return { reachable: false, captured: null };
    const charge = this.charges.get(reference);
    return { reachable: true, captured: charge?.captured ?? false };
  }

  /** Rung 2: ask the gateway. Needs connectivity. */
  queryGateway(reference: string): { reachable: boolean; captured: boolean | null } {
    if (this.random() < this.faults.gatewayUnreachableRate) return { reachable: false, captured: null };
    const charge = this.charges.get(reference);
    return { reachable: true, captured: charge?.captured ?? false };
  }

  /** Rung 3: the end-of-day settlement file. Authoritative, late, and networked. */
  settlementFile(): ReadonlyArray<Charge> | null {
    if (this.random() < this.faults.settlementUnreachableRate) return null;
    return [...this.charges.values()].filter((c) => c.captured);
  }

  /**
   * Refunds are idempotent on OUR refund identifier — this is question B1 in the
   * provider questionnaire, and the design depends on it.
   */
  refund(refundId: string, chargeReference: string, amountMinor: number): Refund {
    const existing = this.refunds.get(refundId);
    if (existing) return existing;
    const refund: Refund = { refundId, chargeReference, amountMinor, providerRef: `rfd-${this.refunds.size + 1}` };
    this.refunds.set(refundId, refund);
    return refund;
  }

  /** How many times the customer was actually charged against one reference. */
  timesCharged(reference: string): number {
    return this.chargeAttempts.filter((a) => a.reference === reference).length;
  }

  totalCapturedMinor(reference: string): number {
    return this.charges.get(reference)?.amountMinor ?? 0;
  }

  refundCount(): number {
    return this.refunds.size;
  }

  allCharges(): ReadonlyArray<Charge> {
    return [...this.charges.values()];
  }
}
