/**
 * npm run spike:callback-engine
 *
 * Proves the abandoned-call callback rules (CC-P01..CC-P08, proposed) before the
 * integration is built. Needs no PBX.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { runCallbackScenario, type CallbackScenarioConfig } from './scenario.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const config: CallbackScenarioConfig = {
  abandonments: arg('abandonments', 1000),
  selfServeRate: 0.35,      // a third of callers order themselves while waiting
  answerRate: 0.6,
  agentBusyRate: 0.85,      // agents are scarce, so entries genuinely wait — which is
                            // what makes both the suppression race and expiry reachable
  withheldRate: 0.05,
  stalenessWindowMs: arg('window', 10) * 60_000,
  seed: arg('seed', 20260917),
};

console.log('spike:callback-engine — proves CC-P01..CC-P08 (proposed)\n');
console.log(`  abandonments        ${config.abandonments}`);
console.log(`  staleness window    ${config.stalenessWindowMs / 60_000} min`);
console.log(`  self-serve rate     ${config.selfServeRate}`);
console.log(`  agent busy rate     ${config.agentBusyRate}`);
console.log(`  caller ID withheld  ${config.withheldRate}`);
console.log(`  seed                ${config.seed}\n`);

const started = Date.now();
const result = runCallbackScenario(config);
const elapsed = Date.now() - started;

console.log(`  abandonments recorded          ${result.abandonments}`);
console.log(`  connected (recovered)          ${result.connected}  (${(result.recoveryRate * 100).toFixed(1)}%)`);
console.log(`  suppressed — ordered anyway    ${result.suppressed}`);
console.log(`  expired — too slow             ${result.expired}`);
console.log(`  unanswered                     ${result.unanswered}`);
console.log(`  unreachable — ID withheld      ${result.unreachable}`);
console.log(`  CALLED AFTER ORDERING          ${result.calledAfterOrdering}`);
console.log(`  duplicate callbacks            ${result.duplicateCallbacks}`);
console.log(`  called when stale              ${result.calledWhenStale}`);
console.log(`  called out of hours            ${result.calledOutOfHours}`);
console.log(`  wall time                      ${elapsed} ms\n`);

// Control: evaluate suppression when the entry is QUEUED rather than immediately
// before dialling. This is the natural-looking implementation, and it calls
// customers who ordered while their entry was waiting for a free agent.
const control = runCallbackScenario({ ...config, abandonments: 500, suppressAtQueueTime: true, seed: config.seed + 1 });
const controlDetected = !control.passed && control.calledAfterOrdering > 0;
console.log(`  control (suppress at queue time) detected: ${controlDetected ? 'YES' : 'NO'}  [${control.calledAfterOrdering} customers called after ordering]`);
if (!controlDetected) {
  console.error('\n  The control case did NOT produce detectable wrong calls.');
  console.error('  A pass from this harness would mean nothing. Fix the harness first.');
}

mkdirSync('spikes/callback-engine/out', { recursive: true });
writeFileSync('spikes/callback-engine/out/report.json', JSON.stringify(
  { spike: 'callback-engine', requirements: 'CC-P01..CC-P08 (proposed)', config, result,
    control_suppress_at_queue_time: { detected: controlDetected, calledAfterOrdering: control.calledAfterOrdering },
    elapsed_ms: elapsed, generated_at: new Date().toISOString() },
  null, 2));

if (result.passed && controlDetected) {
  console.log('\nPASS — nobody called after ordering, no duplicates, no stale or out-of-hours calls.');
  console.log('Report: spikes/callback-engine/out/report.json');
} else {
  console.error('\nFAIL');
  for (const f of result.failures) console.error(`  - ${f}`);
  if (!controlDetected) console.error('  - control case did not detect queue-time suppression');
  process.exit(1);
}
