/**
 * Induced-ambiguity scenario.
 *
 * Gates (docs/lab/test-plan.md T-04 and T-05, NFR-004, PAY-007, PAY-011):
 *   - zero double charges
 *   - zero payments attached to the wrong order
 *   - at least 99 of 100 ambiguous outcomes resolved automatically
 *   - a retried refund issues exactly one refund
 */
import { uuidv7 } from '@firsttaste/contracts';
import { deriveReference, unsafePrefixReference } from './reference.ts';
import { PaymentProvider, type ProviderFaults } from './provider.ts';
import { Reconciler, DoubleChargeAttempted, type Intent } from './reconciler.ts';

export interface PaymentScenarioConfig {
  readonly transactions: number;
  readonly faults: ProviderFaults;
  /** Share of unresolved cases where a person checks the printed slip. */
  readonly humanAttestationRate: number;
  /** Share of captured payments that are later refunded, with a retried call. */
  readonly refundRate: number;
  readonly seed: number;
  /** Width of the terminal's merchant-reference field (questionnaire A2). */
  readonly referenceWidth?: number;
  /** Control case: retry blindly from UNKNOWN instead of querying. */
  readonly blindRetry?: boolean;
  /**
   * Control case: derive the terminal reference by truncating the identifier
   * instead of hashing it. Demonstrates payment misattribution.
   */
  readonly unsafeReference?: boolean;
}

export interface PaymentScenarioResult {
  readonly transactions: number;
  readonly ambiguousInduced: number;
  readonly resolvedAutomatically: number;
  readonly escalated: number;
  readonly autoResolutionRate: number;
  readonly doubleCharges: number;
  readonly misattributedPayments: number;
  readonly referenceCollisions: number;
  readonly refundsRequested: number;
  readonly refundsIssued: number;
  readonly ladderUsage: Record<string, number>;
  readonly blockedRetries: number;
  readonly passed: boolean;
  readonly failures: string[];
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function runPaymentScenario(config: PaymentScenarioConfig): PaymentScenarioResult {
  const random = makeRandom(config.seed);
  const provider = new PaymentProvider(config.faults, random);
  const reconciler = new Reconciler(provider, { blindRetry: config.blindRetry ?? false });

  const intents: Intent[] = [];
  let ambiguousInduced = 0;
  let blockedRetries = 0;
  let refundsRequested = 0;

  for (let i = 0; i < config.transactions; i++) {
    const at = 1_700_000_000_000 + i * 1000;
    const intentId = uuidv7(at);
    const intent: Intent = {
      intentId,
      orderId: `ord-${i}`,
      // Derived from the INTENT, so a retry reuses it (ADR-0005), and derived by
      // HASHING rather than truncation — see reference.ts for why that matters.
      reference: (config.unsafeReference ? unsafePrefixReference : deriveReference)(
        intentId, config.referenceWidth ?? 12,
      ),
      amountMinor: 2500 + (i % 100),
      currency: 'SAR',
      state: 'CREATED',
      attempts: 0,
      resolvedBy: null,
    };
    intents.push(intent);

    reconciler.attemptCharge(intent, at);

    if (intent.state === 'UNKNOWN') {
      ambiguousInduced += 1;

      // A naive caller tries to charge again while the outcome is unknown. The
      // guard must refuse — this is the structural protection, not a convention.
      try {
        reconciler.attemptCharge(intent, at + 1);
      } catch (e) {
        if (e instanceof DoubleChargeAttempted) blockedRetries += 1;
        else throw e;
      }

      reconciler.reconcile(intent, random() < config.humanAttestationRate);
    }

    // Refunds, with the call retried to prove idempotency.
    if (intent.state === 'CAPTURED' && random() < config.refundRate) {
      refundsRequested += 1;
      const refundId = uuidv7(at + 2);
      reconciler.refund(refundId, intent, intent.amountMinor);
      reconciler.refund(refundId, intent, intent.amountMinor); // response lost; retried
    }
  }

  // A double charge is the provider having taken money more than once against one
  // reference. This is measured from the PROVIDER's ground truth, not from our
  // own records, because our records are exactly what can be wrong.
  let doubleCharges = 0;
  for (const intent of intents) {
    if (provider.timesCharged(intent.reference) > 1) doubleCharges += 1;
  }

  // A payment attached to the wrong order: every reference must map to exactly
  // one intent, and every intent to exactly one order.
  const referenceToOrder = new Map<string, Set<string>>();
  for (const intent of intents) {
    const set = referenceToOrder.get(intent.reference) ?? new Set<string>();
    set.add(intent.orderId);
    referenceToOrder.set(intent.reference, set);
  }
  const misattributed = [...referenceToOrder.values()].filter((s) => s.size > 1).length;
  // A reference collision IS misattribution: a query for one order returns the
  // other order's outcome. Counted explicitly so the cause is visible.
  const referenceCollisions = intents.length - new Set(intents.map((i) => i.reference)).size;

  const escalated = reconciler.escalated.length;
  const resolvedAutomatically = ambiguousInduced - escalated;
  const autoResolutionRate = ambiguousInduced === 0 ? 1 : resolvedAutomatically / ambiguousInduced;

  const failures: string[] = [];
  if (doubleCharges > 0) failures.push(`${doubleCharges} double charge(s) (NFR-004)`);
  if (misattributed > 0) failures.push(`${misattributed} payment(s) attached to more than one order (NFR-004)`);
  if (referenceCollisions > 0) failures.push(`${referenceCollisions} terminal reference collision(s) — two orders share a payment reference (NFR-004)`);
  if (provider.refundCount() !== refundsRequested) {
    failures.push(`${provider.refundCount()} refunds issued for ${refundsRequested} requested (PAY-011)`);
  }
  if (ambiguousInduced > 0 && autoResolutionRate < 0.99) {
    failures.push(`${(autoResolutionRate * 100).toFixed(1)}% of ambiguous outcomes resolved automatically, below the 99% gate`);
  }
  // Every unresolved intent must still have been protected from a retry.
  if (!config.blindRetry && blockedRetries !== ambiguousInduced) {
    failures.push(`${blockedRetries} of ${ambiguousInduced} retry attempts were blocked — the guard is not universal`);
  }

  return {
    transactions: config.transactions,
    ambiguousInduced,
    resolvedAutomatically,
    escalated,
    autoResolutionRate,
    doubleCharges,
    misattributedPayments: misattributed,
    referenceCollisions,
    refundsRequested,
    refundsIssued: provider.refundCount(),
    ladderUsage: { ...reconciler.ladderUsage },
    blockedRetries,
    passed: failures.length === 0,
    failures,
  };
}
