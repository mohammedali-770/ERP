import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallbackEngine, type EngineConfig, type Ports, type Order } from '../src/engine.ts';
import { runCallbackScenario, type CallbackScenarioConfig } from '../src/scenario.ts';

const HOURS: readonly [number, number] = [8 * 60, 23 * 60];
const NOON = Date.UTC(2026, 8, 17, 12, 0, 0);
const MIDNIGHT = Date.UTC(2026, 8, 17, 2, 0, 0);

function harness(over: Partial<EngineConfig> = {}, orders: Order[] = [], answered = true) {
  const dialled: string[] = [];
  const ports: Ports = {
    ordersSince: (num, since) => orders.filter((o) => o.normalizedNumber === num && o.placedAt >= since),
    agentAvailable: () => true,
    dial: (e) => { dialled.push(e.entryId); return answered; },
  };
  const engine = new CallbackEngine(
    { stalenessWindowMs: 10 * 60_000, operatingHours: HOURS, ...over }, ports,
  );
  return { engine, ports, orders, dialled };
}

test('an abandoned call is queued and called back when an agent is free', () => {
  const { engine } = harness();
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 60_000);
  assert.equal(engine.byState('CONNECTED').length, 1);
});

test('a caller who orders while waiting is NOT called back', () => {
  // CC-P03, and the whole reason this spike exists.
  const orders: Order[] = [];
  const { engine } = harness({}, orders);
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  orders.push({ normalizedNumber: '+966500000001', placedAt: NOON + 30_000, channel: 'app' });
  engine.tick(NOON + 60_000);
  assert.equal(engine.byState('SUPPRESSED').length, 1);
  assert.equal(engine.byState('CONNECTED').length, 0);
});

test('suppression counts an order from ANY channel', () => {
  for (const channel of ['app', 'call_centre', 'walk_in']) {
    const orders: Order[] = [];
    const { engine } = harness({}, orders);
    engine.recordAbandonment('+966500000001', 'orders', NOON);
    orders.push({ normalizedNumber: '+966500000001', placedAt: NOON + 30_000, channel });
    engine.tick(NOON + 60_000);
    assert.equal(engine.byState('SUPPRESSED').length, 1, `${channel} did not suppress`);
  }
});

test('an order placed BEFORE the abandonment does not suppress', () => {
  // They ordered, then called and gave up — a fresh intent, not a satisfied one.
  const orders: Order[] = [{ normalizedNumber: '+966500000001', placedAt: NOON - 60_000, channel: 'app' }];
  const { engine } = harness({}, orders);
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 60_000);
  assert.equal(engine.byState('CONNECTED').length, 1);
});

test('an entry past the staleness window expires instead of being called', () => {
  const { engine, dialled } = harness({ stalenessWindowMs: 10 * 60_000 });
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 11 * 60_000);
  assert.equal(engine.byState('EXPIRED').length, 1);
  assert.deepEqual(dialled, [], 'a stale entry must never be dialled');
});

test('expiry is reported distinctly from suppression', () => {
  // CC-P08: "they ordered anyway" and "we were too slow" are different outcomes
  // and the report must not conflate them.
  const orders: Order[] = [{ normalizedNumber: '+966500000001', placedAt: NOON + 30_000, channel: 'app' }];
  const { engine } = harness({ stalenessWindowMs: 10 * 60_000 }, orders);
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 11 * 60_000);
  assert.equal(engine.byState('EXPIRED').length, 1, 'stale entries close as EXPIRED even if also suppressible');
  assert.equal(engine.byState('SUPPRESSED').length, 0);
});

test('one open entry per number — repeat abandonment does not queue a second', () => {
  const { engine } = harness();
  const first = engine.recordAbandonment('+966500000001', 'orders', NOON);
  const second = engine.recordAbandonment('+966500000001', 'orders', NOON + 10_000);
  assert.ok(first);
  assert.equal(second, null, 'a second open entry was created for one number');
});

test('a new abandonment AFTER the first closes is a fresh entry', () => {
  // A customer who gives up at 12:00 and again at 14:00 has two intents.
  const { engine } = harness();
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 60_000);
  const later = engine.recordAbandonment('+966500000001', 'orders', NOON + 2 * 3_600_000);
  assert.ok(later, 'a later abandonment must be callable again');
});

test('an unanswered callback closes after one attempt', () => {
  const { engine, dialled } = harness({}, [], false);
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 60_000);
  engine.tick(NOON + 120_000);
  assert.equal(engine.byState('UNANSWERED').length, 1);
  assert.equal(dialled.length, 1, 'no automated redialling');
});

test('a withheld caller ID is recorded as unreachable, not dropped', () => {
  const { engine } = harness();
  const entry = engine.recordAbandonment(null, 'orders', NOON);
  assert.equal(entry?.state, 'UNREACHABLE');
  assert.equal(entry?.closedReason, 'caller_id_withheld');
});

test('no callback is placed outside operating hours', () => {
  const { engine, dialled } = harness();
  engine.recordAbandonment('+966500000001', 'orders', MIDNIGHT);
  engine.tick(MIDNIGHT + 60_000);
  assert.deepEqual(dialled, []);
  assert.equal(engine.byState('ELIGIBLE').length, 1, 'it should wait, not close');
});

test('an entry whose window elapses overnight expires rather than waiting for morning', () => {
  // CC-P07: a callback about last night's abandoned order is not a service.
  const { engine, dialled } = harness({ stalenessWindowMs: 10 * 60_000 });
  engine.recordAbandonment('+966500000001', 'orders', MIDNIGHT);
  engine.tick(Date.UTC(2026, 8, 17, 9, 0, 0)); // next morning, within hours
  assert.equal(engine.byState('EXPIRED').length, 1);
  assert.deepEqual(dialled, []);
});

test('no callback is placed while every agent is busy', () => {
  const dialled: string[] = [];
  const engine = new CallbackEngine(
    { stalenessWindowMs: 10 * 60_000, operatingHours: HOURS },
    { ordersSince: () => [], agentAvailable: () => false, dial: (e) => { dialled.push(e.entryId); return true; } },
  );
  engine.recordAbandonment('+966500000001', 'orders', NOON);
  engine.tick(NOON + 60_000);
  assert.deepEqual(dialled, []);
  assert.equal(engine.byState('ELIGIBLE').length, 1);
});

// --- scenario level ---------------------------------------------------------

const BASE: CallbackScenarioConfig = {
  abandonments: 400, selfServeRate: 0.35, answerRate: 0.6,
  agentBusyRate: 0.85, withheldRate: 0.05, stalenessWindowMs: 10 * 60_000, seed: 4,
};

test('the scenario places no wrong calls', () => {
  const r = runCallbackScenario(BASE);
  assert.equal(r.calledAfterOrdering, 0, r.failures.join('; '));
  assert.equal(r.duplicateCallbacks, 0);
  assert.equal(r.calledWhenStale, 0);
  assert.equal(r.calledOutOfHours, 0);
  assert.equal(r.passed, true, r.failures.join('; '));
});

test('the scenario actually exercises suppression and expiry', () => {
  // Without this, a pass could mean the interesting paths never ran.
  const r = runCallbackScenario(BASE);
  assert.ok(r.suppressed > 0, 'suppression was never exercised');
  assert.ok(r.expired > 0, 'expiry was never exercised');
  assert.ok(r.unreachable > 0, 'withheld caller ID was never exercised');
});

test('the control case FAILS, proving the harness detects the race', () => {
  const r = runCallbackScenario({ ...BASE, suppressAtQueueTime: true });
  assert.equal(r.passed, false, 'queue-time suppression was not detected');
  assert.ok(r.calledAfterOrdering > 0);
});

test('every entry reaches exactly one terminal state', () => {
  const r = runCallbackScenario(BASE);
  const accounted = r.connected + r.suppressed + r.expired + r.unanswered + r.unreachable;
  assert.equal(accounted, r.abandonments, 'entries were lost or double-counted');
});

test('results are deterministic for a given seed', () => {
  assert.deepEqual(runCallbackScenario({ ...BASE, seed: 9 }), runCallbackScenario({ ...BASE, seed: 9 }));
});
