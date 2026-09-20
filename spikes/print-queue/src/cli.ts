/**
 * npm run spike:print-queue [-- --jobs 500 --seed 42]
 *
 * Retires risk R-01 (High): print reliability under simultaneous multi-channel
 * load, with printer loss, lost responses and restarts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { runPrintScenario, type PrintScenarioConfig } from './scenario.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const config: PrintScenarioConfig = {
  jobs: arg('jobs', 500),
  channels: arg('channels', 4),
  printerOfflineRate: 0.15,
  responseLostRate: 0.12,
  restartRate: 0.05,
  seed: arg('seed', 20260917),
};

console.log('spike:print-queue — retires R-01 (High)\n');
console.log(`  jobs                 ${config.jobs}`);
console.log(`  channels             ${config.channels}`);
console.log(`  printer offline rate ${config.printerOfflineRate}`);
console.log(`  lost response rate   ${config.responseLostRate}`);
console.log(`  restart rate         ${config.restartRate}`);
console.log(`  seed                 ${config.seed}\n`);

const started = Date.now();
const result = runPrintScenario(config);
const elapsed = Date.now() - started;

console.log(`  kitchen slips enqueued     ${result.kotEnqueued}`);
console.log(`  kitchen slips printed      ${result.kotPrinted}`);
console.log(`  kitchen slips LOST         ${result.kotLost}`);
console.log(`  invoices enqueued          ${result.invoicesEnqueued}`);
console.log(`  invoice documents emitted  ${result.invoiceDocumentsEmitted}`);
console.log(`  SILENT duplicate invoices  ${result.silentDuplicateInvoices}`);
console.log(`  unidentifiable documents   ${result.unidentifiableDuplicates}`);
console.log(`  restarts survived          ${result.survivedRestarts}`);
console.log(`  wall time                  ${elapsed} ms\n`);

// Control case: retry an unknown outcome blindly instead of querying the printer.
const control = runPrintScenario({ ...config, jobs: 200, sabotageBlindRetry: true });
const controlDetected = !control.passed;
console.log(`  control (blind retry on unknown) detected: ${controlDetected ? 'YES' : 'NO'}`);
if (!controlDetected) {
  console.error('\n  The control case did NOT fail. The harness is not detecting duplicate');
  console.error('  invoices, so a pass from it means nothing.');
}

mkdirSync('spikes/print-queue/out', { recursive: true });
writeFileSync('spikes/print-queue/out/report.json', JSON.stringify(
  { spike: 'print-queue', risk: 'R-01', config, result, control: { detected: controlDetected, failures: control.failures }, elapsed_ms: elapsed, generated_at: new Date().toISOString() },
  null, 2));

if (result.passed && controlDetected) {
  console.log('\nPASS — no lost kitchen slips, no silent duplicate invoices, all output identifiable.');
  console.log('Report: spikes/print-queue/out/report.json');
} else {
  console.error('\nFAIL');
  for (const f of result.failures) console.error(`  - ${f}`);
  if (!controlDetected) console.error('  - control case did not detect blind retry');
  process.exit(1);
}
