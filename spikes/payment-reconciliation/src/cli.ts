/**
 * npm run spike:payment-reconciliation
 *
 * Retires the design risk behind D-1 (payment provider, frozen). Proves the
 * unknown-outcome protocol against a simulator, so that when a provider is
 * selected the remaining work is integration rather than design.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { runPaymentScenario, type PaymentScenarioConfig } from './scenario.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const config: PaymentScenarioConfig = {
  transactions: arg('transactions', 2000),
  faults: {
    loseResponseRate: 0.08,          // the ambiguous case we care about
    declineRate: 0.03,
    terminalUnreachableRate: 0.20,   // forces the ladder past rung 1
    gatewayUnreachableRate: 0.30,    // and past rung 2
    settlementUnreachableRate: 0.10, // and occasionally past rung 3
    supportsQueryByReference: true,
  },
  humanAttestationRate: 0.9,
  refundRate: 0.15,
  seed: arg('seed', 20260917),
};

console.log('spike:payment-reconciliation — retires the design risk behind D-1\n');
console.log(`  transactions             ${config.transactions}`);
console.log(`  lost response rate       ${config.faults.loseResponseRate}`);
console.log(`  terminal unreachable     ${config.faults.terminalUnreachableRate}`);
console.log(`  gateway unreachable      ${config.faults.gatewayUnreachableRate}`);
console.log(`  query-by-reference       ${config.faults.supportsQueryByReference ? 'supported' : 'NOT supported'}`);
console.log(`  seed                     ${config.seed}\n`);

const started = Date.now();
const result = runPaymentScenario(config);
const elapsed = Date.now() - started;

console.log(`  ambiguous outcomes induced   ${result.ambiguousInduced}`);
console.log(`  resolved automatically       ${result.resolvedAutomatically} (${(result.autoResolutionRate * 100).toFixed(1)}%)`);
console.log(`  escalated to a person        ${result.escalated}`);
console.log(`  retries BLOCKED by the guard ${result.blockedRetries}`);
console.log(`  DOUBLE CHARGES               ${result.doubleCharges}`);
console.log(`  misattributed payments       ${result.misattributedPayments}`);
console.log(`  reference collisions         ${result.referenceCollisions}`);
console.log(`  refunds requested / issued   ${result.refundsRequested} / ${result.refundsIssued}`);
console.log(`  ladder usage                 ${JSON.stringify(result.ladderUsage)}`);
console.log(`  wall time                    ${elapsed} ms\n`);

// Control case: retry blindly from UNKNOWN, as a naive implementation would.
const control = runPaymentScenario({ ...config, transactions: 500, blindRetry: true, seed: config.seed + 1 });
const controlDetected = !control.passed && control.doubleCharges > 0;
console.log(`  control (blind retry from UNKNOWN) detected: ${controlDetected ? 'YES' : 'NO'}  [${control.doubleCharges} double charges]`);
if (!controlDetected) {
  console.error('\n  The control case did NOT produce detectable double charges.');
  console.error('  A pass from this harness would mean nothing. Fix the harness first.');
}

// Second control: derive the terminal reference by truncating the identifier
// rather than hashing it. UUIDv7 leads with a timestamp, so two intents in one
// millisecond collide — and a collision is a payment attached to the wrong order.
const unsafeRef = runPaymentScenario({ ...config, transactions: 500, unsafeReference: true, seed: config.seed + 3 });
const unsafeRefDetected = !unsafeRef.passed && unsafeRef.referenceCollisions > 0;
console.log(`  control (truncated reference)     detected: ${unsafeRefDetected ? 'YES' : 'NO'}  [${unsafeRef.referenceCollisions} collisions]`);

// The cost of lacking query-by-reference (questionnaire A1), measured where it
// actually bites: during a connectivity outage. When the branch is online the
// gateway covers us, so the terminal query is only decisive when nothing else is
// reachable — which is precisely when branches must keep trading (OFF-001).
// Not pass/fail; a cost estimate for the provider selection.
// A real outage: nothing networked is reachable. Only the terminal on the
// local counter, and a person with a printed slip, remain.
const outageFaults = { ...config.faults, gatewayUnreachableRate: 1.0, settlementUnreachableRate: 1.0 };
const withQuery = runPaymentScenario({
  ...config, transactions: 500, seed: config.seed + 2,
  faults: { ...outageFaults, supportsQueryByReference: true },
});
const withoutQuery = runPaymentScenario({
  ...config, transactions: 500, seed: config.seed + 2,
  faults: { ...outageFaults, supportsQueryByReference: false },
});
const personCount = (r: typeof withQuery): number => r.escalated + (r.ladderUsage['human_attestation'] ?? 0);
console.log(`\n  Cost of query-by-reference, measured DURING AN OUTAGE (questionnaire A1/A3):`);
console.log(`    ambiguous outcomes                  ${withoutQuery.ambiguousInduced} in 500 transactions`);
console.log(`    needing a person WITH the query     ${personCount(withQuery)}`);
console.log(`    needing a person WITHOUT it         ${personCount(withoutQuery)}`);
console.log(`    double charges, either way          ${withQuery.doubleCharges} / ${withoutQuery.doubleCharges}`);
console.log(`    -> the safety guard holds regardless of the provider. What changes is`);
console.log(`       how often a cashier must stop and check a printed slip mid-service.`);

mkdirSync('spikes/payment-reconciliation/out', { recursive: true });
writeFileSync('spikes/payment-reconciliation/out/report.json', JSON.stringify(
  { spike: 'payment-reconciliation', decision: 'D-1', config, result,
    control_blind_retry: { detected: controlDetected, doubleCharges: control.doubleCharges },
    control_truncated_reference: { detected: unsafeRefDetected, collisions: unsafeRef.referenceCollisions },
    query_by_reference_cost_during_outage: {
      with_query: { needing_a_person: personCount(withQuery), double_charges: withQuery.doubleCharges },
      without_query: { needing_a_person: personCount(withoutQuery), double_charges: withoutQuery.doubleCharges },
      ambiguous_outcomes: withoutQuery.ambiguousInduced,
    },
    elapsed_ms: elapsed, generated_at: new Date().toISOString() },
  null, 2));

if (result.passed && controlDetected && unsafeRefDetected) {
  console.log('\nPASS — zero double charges, zero misattribution, refunds idempotent.');
  console.log('Report: spikes/payment-reconciliation/out/report.json');
} else {
  console.error('\nFAIL');
  for (const f of result.failures) console.error(`  - ${f}`);
  if (!controlDetected) console.error('  - control case did not detect blind retry');
  if (!unsafeRefDetected) console.error('  - control case did not detect reference collision');
  process.exit(1);
}
