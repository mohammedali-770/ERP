import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, type ScenarioConfig } from '../src/scenario.ts';
import { Device, Central } from '../src/model.ts';
import { verifyChain } from '@firsttaste/contracts';

const BASE: ScenarioConfig = {
  branches: 1, devicesPerBranch: 3, ordersPerHourPerBranch: 250, durationMinutes: 30,
  syncFailureRate: 0.25, crashRate: 0.02, duplicatePushRate: 0.05,
  clockSkewMs: 5 * 60_000, ackLossRate: 0.1, seed: 1,
};

test('a clean run loses and duplicates nothing', () => {
  const r = runScenario(BASE);
  assert.equal(r.ordersLost, 0, r.failures.join('; '));
  assert.equal(r.ordersDuplicated, 0, r.failures.join('; '));
  assert.equal(r.passed, true, r.failures.join('; '));
});

test('the control case FAILS, proving the harness detects duplication', () => {
  // A spike that cannot fail is not evidence.
  const r = runScenario({ ...BASE, sabotageIdentity: true });
  assert.equal(r.passed, false, 'sabotaged identity was not detected');
  assert.ok(r.ordersDuplicated > 0, 'no duplicate business orders were reported');
  assert.ok(r.failures.some((f) => f.includes('multiple orders')));
});

test('the wire-level retry path is actually exercised', () => {
  // Without this, a pass would prove only that we never sent a duplicate.
  const r = runScenario({ ...BASE, ackLossRate: 0.5 });
  assert.ok(r.duplicatePushesIgnored > 0, 'idempotent ingestion was never tested');
  assert.equal(r.ordersDuplicated, 0);
});

test('results are deterministic for a given seed', () => {
  // A failing run must be reproducible from its seed alone.
  assert.deepEqual(runScenario({ ...BASE, seed: 99 }), runScenario({ ...BASE, seed: 99 }));
});

test('holds under an extreme outage rate', () => {
  const r = runScenario({ ...BASE, syncFailureRate: 0.9, seed: 7 });
  assert.equal(r.ordersLost, 0);
  assert.equal(r.ordersDuplicated, 0);
});

test('holds under an extreme crash rate', () => {
  const r = runScenario({ ...BASE, crashRate: 0.3, seed: 11 });
  assert.equal(r.ordersLost, 0, 'a committed order was lost to a crash');
  assert.equal(r.ordersDuplicated, 0);
});

test('a crash before commit loses a draft, not an accepted order', () => {
  const central = new Central();
  const d = new Device({ deviceId: 'dev-a', branchId: 'br-1' });
  d.append('order', 'ord-1', 'OrderAccepted', { business_key: 'ord-1' }, 1000);
  d.crash(); // never committed — correctly lost
  d.sync(central);
  assert.equal(central.size(), 0);
});

test('a crash after commit loses nothing', () => {
  const central = new Central();
  const d = new Device({ deviceId: 'dev-a', branchId: 'br-1' });
  d.append('order', 'ord-1', 'OrderAccepted', { business_key: 'ord-1' }, 1000);
  d.commit();
  d.crash(); // outbox is durable
  d.sync(central);
  assert.equal(central.distinctOrders().has('ord-1'), true);
});

test('the sequence resumes correctly after a crash', () => {
  const central = new Central();
  const d = new Device({ deviceId: 'dev-a', branchId: 'br-1' });
  d.append('order', 'ord-1', 'OrderAccepted', { business_key: 'ord-1' }, 1000);
  d.commit();
  d.append('order', 'ord-2', 'OrderAccepted', { business_key: 'ord-2' }, 1100);
  d.crash(); // discards seq 2, must not leave a gap
  d.append('order', 'ord-3', 'OrderAccepted', { business_key: 'ord-3' }, 1200);
  d.commit();
  d.sync(central);
  const seqs = central.eventsFor('dev-a').map((e) => e.device_seq);
  assert.deepEqual(seqs, [1, 2], 'sequence not contiguous after a crash');
  assert.equal(verifyChain(central.eventsFor('dev-a')).ok, true, 'hash chain broken after a crash');
});

test('re-sending an identical batch is a no-op', () => {
  const central = new Central();
  const d = new Device({ deviceId: 'dev-a', branchId: 'br-1' });
  for (let i = 0; i < 5; i++) {
    d.append('order', `ord-${i}`, 'OrderAccepted', { business_key: `ord-${i}` }, 1000 + i);
  }
  d.commit();
  d.sync(central, true);
  d.sync(central, true);
  assert.equal(central.distinctOrders().size, 5);
  assert.ok(central.duplicates() > 0, 'the duplicate path was not exercised');
});

test('central stops at a genuine gap rather than accepting out of order', () => {
  const central = new Central();
  const d = new Device({ deviceId: 'dev-a', branchId: 'br-1' });
  for (let i = 1; i <= 4; i++) {
    d.append('order', `ord-${i}`, 'OrderAccepted', { business_key: `ord-${i}` }, 1000 + i);
  }
  d.commit();
  const events = d.committedEvents();
  // Deliver 1, 2 and 4 — 3 is missing.
  const result = central.push('dev-a', [events[0]!, events[1]!, events[3]!]);
  assert.equal(result.accepted_through_seq, 2, 'accepted past a gap');
});
