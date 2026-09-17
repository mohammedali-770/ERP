import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrintQueue, AUTO_RETRY_ON_UNKNOWN, type Printer } from '../src/queue.ts';
import { runPrintScenario, type PrintScenarioConfig } from '../src/scenario.ts';

const printer = (): Printer => ({ printerId: 'p1', online: true, output: [], silentlyPrinted: new Set() });

const BASE: PrintScenarioConfig = {
  jobs: 200, channels: 4, printerOfflineRate: 0.15,
  responseLostRate: 0.12, restartRate: 0.05, seed: 1,
};

test('a clean run loses no kitchen slips and emits no silent duplicate invoice', () => {
  const r = runPrintScenario(BASE);
  assert.equal(r.kotLost, 0, r.failures.join('; '));
  assert.equal(r.silentDuplicateInvoices, 0, r.failures.join('; '));
  assert.equal(r.passed, true, r.failures.join('; '));
});

test('the control case FAILS, proving the harness detects duplicate invoices', () => {
  const r = runPrintScenario({ ...BASE, sabotageBlindRetry: true });
  assert.equal(r.passed, false, 'blind retry on unknown was not detected');
  assert.ok(r.silentDuplicateInvoices > 0);
});

test('every printed document carries its job id and attempt number', () => {
  // Thermal printers cannot deduplicate, so duplicates must at least be
  // identifiable — which is what staff and auditors actually need (PRN-003).
  const r = runPrintScenario(BASE);
  assert.equal(r.unidentifiableDuplicates, 0);
});

test('the retry bias differs by document type', () => {
  // Duplicate a kitchen slip rather than lose it; never silently reprint an invoice.
  assert.equal(AUTO_RETRY_ON_UNKNOWN.kot, true);
  assert.equal(AUTO_RETRY_ON_UNKNOWN.invoice, false);
  assert.equal(AUTO_RETRY_ON_UNKNOWN.receipt, false);
});

test('an unknown invoice outcome does not auto-retry', () => {
  const q = new PrintQueue();
  const p = printer();
  const job = q.enqueue('invoice', 'ord-1', 'p1', 'invoice:1', 1000);
  q.attempt(job, p, true); // printed, but the response was lost
  assert.equal(job.state, 'unknown');
  const state = q.resolveUnknown(job, { reachable: true, lastJobPrinted: false });
  assert.equal(state, 'failed', 'an invoice must wait for a human, not silently reprint');
});

test('an unknown kitchen slip outcome does auto-retry', () => {
  const q = new PrintQueue();
  const p = printer();
  const job = q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  q.attempt(job, p, true);
  assert.equal(q.resolveUnknown(job, { reachable: true, lastJobPrinted: false }), 'retrying');
});

test('querying the printer resolves an unknown to printed without reprinting', () => {
  const q = new PrintQueue();
  const p = printer();
  const job = q.enqueue('invoice', 'ord-1', 'p1', 'invoice:1', 1000);
  q.attempt(job, p, true);
  const before = p.output.length;
  const state = q.resolveUnknown(job, { reachable: true, lastJobPrinted: true });
  assert.equal(state, 'printed');
  assert.equal(p.output.length, before, 'resolving by query must not emit another document');
});

test('an unreachable printer leaves the outcome unknown rather than guessing', () => {
  const q = new PrintQueue();
  const p = printer();
  const job = q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  q.attempt(job, p, true);
  assert.equal(q.resolveUnknown(job, { reachable: false, lastJobPrinted: false }), 'unknown');
});

test('the queue survives a restart', () => {
  const q = new PrintQueue();
  q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  q.enqueue('kot', 'ord-2', 'p1', 'kot:2', 1001);
  q.restart();
  assert.equal(q.all().length, 2, 'jobs must survive an application restart (PRN-004)');
});

test('content is rendered at enqueue, not at print', () => {
  // A later menu edit cannot change what the kitchen already committed to making.
  const q = new PrintQueue();
  const p = printer();
  const job = q.enqueue('kot', 'ord-1', 'p1', 'Chicken Meal x2', 1000);
  q.attempt(job, p, false);
  assert.match(p.output[0]!, /^Chicken Meal x2\|/);
});

test('a reprint is a new job linked to the original, which is untouched', () => {
  const q = new PrintQueue();
  const original = q.enqueue('receipt', 'ord-1', 'p1', 'receipt:1', 1000);
  const first = q.reprint(original.print_job_id, 1100);
  const second = q.reprint(original.print_job_id, 1200);
  assert.notEqual(first.print_job_id, original.print_job_id);
  assert.equal(first.reprint_of, original.print_job_id);
  assert.equal(first.reprint_seq, 1);
  assert.equal(second.reprint_seq, 2);
  assert.equal(original.reprint_of, null, 'the original must not be mutated');
});

test('a job fails permanently only after the attempt limit', () => {
  const q = new PrintQueue();
  const p = printer();
  p.online = false;
  const job = q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  for (let i = 0; i < 4; i++) assert.equal(q.attempt(job, p, false), 'retrying');
  assert.equal(q.attempt(job, p, false), 'failed_permanent');
});

test('a lease prevents two devices driving one job', () => {
  const q = new PrintQueue();
  q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  const a = q.acquire('dev-a', 1000);
  const b = q.acquire('dev-b', 1000);
  assert.ok(a);
  assert.equal(b, null, 'a second device must not acquire a leased job');
});

test('an expired lease allows a peer to take over', () => {
  // Under iPad-only this is what lets a job complete when its homed device sleeps.
  const q = new PrintQueue();
  q.enqueue('kot', 'ord-1', 'p1', 'kot:1', 1000);
  q.acquire('dev-a', 1000);
  const taken = q.acquire('dev-b', 1000 + 20_000);
  assert.ok(taken, 'a peer must be able to take an expired lease');
  assert.equal(taken.lease_owner_device, 'dev-b');
});

test('results are deterministic for a given seed', () => {
  assert.deepEqual(runPrintScenario({ ...BASE, seed: 5 }), runPrintScenario({ ...BASE, seed: 5 }));
});
