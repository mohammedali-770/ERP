/**
 * npm run spike:offline-sync [-- --minutes 240 --seed 42]
 *
 * Retires risk R-02 (Critical). Emits a machine-readable report so the executive
 * evidence package is assembled from artifacts rather than written up.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { runScenario, type ScenarioConfig } from './scenario.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const config: ScenarioConfig = {
  branches: arg('branches', 3),
  devicesPerBranch: arg('devices', 3),
  ordersPerHourPerBranch: arg('rate', 250),
  durationMinutes: arg('minutes', 240),
  syncFailureRate: 0.25,   // central link flapping
  crashRate: 0.02,         // a device dies every ~50 orders
  duplicatePushRate: 0.05, // retry after a lost acknowledgement
  clockSkewMs: 5 * 60_000, // one device per branch is five minutes out
  ackLossRate: 0.10,       // response lost after the batch landed; client re-sends
  seed: arg('seed', 20260917),
};

console.log('spike:offline-sync — retires R-02 (Critical)\n');
console.log(`  branches            ${config.branches}`);
console.log(`  devices per branch  ${config.devicesPerBranch}`);
console.log(`  target rate         ${config.ordersPerHourPerBranch}/h per branch`);
console.log(`  duration            ${config.durationMinutes} min (simulated)`);
console.log(`  sync failure rate   ${config.syncFailureRate}`);
console.log(`  crash rate          ${config.crashRate}`);
console.log(`  duplicate push rate ${config.duplicatePushRate}`);
console.log(`  clock skew          ${config.clockSkewMs / 60_000} min on one device per branch`);
console.log(`  lost-response rate  ${config.ackLossRate}`);
console.log(`  seed                ${config.seed}\n`);

const started = Date.now();
const result = runScenario(config);
const elapsed = Date.now() - started;

console.log(`  orders accepted         ${result.ordersAccepted}`);
console.log(`  orders at central       ${result.ordersAtCentral}`);
console.log(`  orders LOST             ${result.ordersLost}`);
console.log(`  orders DUPLICATED       ${result.ordersDuplicated}`);
console.log(`  duplicate pushes ignored ${result.duplicatePushesIgnored}`);
console.log(`  hash-chain failures     ${result.chainFailures}`);
console.log(`  throughput              ${result.ordersPerHour.toFixed(0)}/h per branch`);
console.log(`  wall time               ${elapsed} ms\n`);

// The control case. A harness that cannot fail is not evidence, so every run
// proves the detector works before reporting a pass.
const control = runScenario({ ...config, durationMinutes: 30, sabotageIdentity: true });
const controlDetected = !control.passed;
console.log(`  control (identity regeneration) detected: ${controlDetected ? 'YES' : 'NO'}`);
if (!controlDetected) {
  console.error('\n  The control case did NOT fail. The harness is not detecting duplication,');
  console.error('  so a pass from it means nothing. Fix the harness before trusting a result.');
}

mkdirSync('spikes/offline-sync/out', { recursive: true });
const report = { spike: 'offline-sync', risk: 'R-02', config, result, control: { detected: controlDetected, failures: control.failures }, elapsed_ms: elapsed, generated_at: new Date().toISOString() };
writeFileSync('spikes/offline-sync/out/report.json', JSON.stringify(report, null, 2));

if (result.passed && controlDetected) {
  console.log('\nPASS — zero lost, zero duplicated, chains intact, throughput above gate.');
  console.log('Report: spikes/offline-sync/out/report.json');
} else {
  console.error('\nFAIL');
  for (const f of result.failures) console.error(`  - ${f}`);
  if (!controlDetected) console.error('  - control case did not detect sabotage');
  process.exit(1);
}
