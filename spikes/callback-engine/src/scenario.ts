/**
 * Concurrent abandonment, ordering and agent availability.
 *
 * Gates:
 *   - zero callbacks to a number that ordered after abandoning (CC-P03)
 *   - zero duplicate callbacks to one number (CC-P02, CC-P06)
 *   - zero callbacks after the staleness window (CC-P04)
 *   - zero callbacks outside operating hours (CC-P07)
 */
import { CallbackEngine, type EngineConfig, type Order, type Ports, type CallbackEntry } from './engine.ts';

export interface CallbackScenarioConfig {
  readonly abandonments: number;
  /** Share of abandoned callers who order themselves before we reach them. */
  readonly selfServeRate: number;
  /** Share of callbacks the customer answers. */
  readonly answerRate: number;
  /** Share of ticks where no agent is free, so entries wait. */
  readonly agentBusyRate: number;
  /** Share of calls with caller ID withheld. */
  readonly withheldRate: number;
  readonly stalenessWindowMs: number;
  readonly seed: number;
  readonly suppressAtQueueTime?: boolean;
}

export interface CallbackScenarioResult {
  readonly abandonments: number;
  readonly connected: number;
  readonly suppressed: number;
  readonly expired: number;
  readonly unanswered: number;
  readonly unreachable: number;
  /** The failure this spike exists to detect. */
  readonly calledAfterOrdering: number;
  readonly duplicateCallbacks: number;
  readonly calledWhenStale: number;
  readonly calledOutOfHours: number;
  readonly recoveryRate: number;
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

const OPEN_MINUTE = 8 * 60;   // 08:00 UTC
const CLOSE_MINUTE = 23 * 60; // 23:00 UTC

export function runCallbackScenario(config: CallbackScenarioConfig): CallbackScenarioResult {
  const random = makeRandom(config.seed);
  const orders: Order[] = [];
  let agentFree = true;

  const ports: Ports = {
    ordersSince: (num, since) => orders.filter((o) => o.normalizedNumber === num && o.placedAt >= since),
    agentAvailable: () => agentFree,
    dial: () => random() < config.answerRate,
  };

  const engineConfig: EngineConfig = {
    stalenessWindowMs: config.stalenessWindowMs,
    operatingHours: [OPEN_MINUTE, CLOSE_MINUTE],
    ...(config.suppressAtQueueTime !== undefined ? { suppressAtQueueTime: config.suppressAtQueueTime } : {}),
  };
  const engine = new CallbackEngine(engineConfig, ports);

  // Start mid-morning so most of the run sits inside operating hours, with some
  // entries deliberately crossing the close time.
  const start = Date.UTC(2026, 8, 17, 9, 0, 0);
  const stepMs = 30_000;
  const steps = config.abandonments * 3;

  const entries: CallbackEntry[] = [];

  for (let i = 0; i < steps; i++) {
    const now = start + i * stepMs;

    // New abandonment.
    if (i < config.abandonments) {
      const withheld = random() < config.withheldRate;
      const number = withheld ? null : `+9665${String(10_000_000 + (i % 400)).slice(0, 8)}`;
      const entry = engine.recordAbandonment(number, 'orders', now);
      if (entry) entries.push(entry);
    }

    // Some callers order for themselves while their entry waits. This is the
    // condition suppression must catch, and the reason it is checked at dial
    // time rather than when the entry was created.
    for (const entry of engine.all()) {
      if (entry.state !== 'ELIGIBLE' || entry.normalizedNumber === null) continue;
      if (random() < config.selfServeRate / 10) {
        orders.push({
          normalizedNumber: entry.normalizedNumber,
          placedAt: now,
          channel: random() < 0.5 ? 'app' : 'call_centre',
        });
      }
    }

    agentFree = random() >= config.agentBusyRate;
    engine.tick(now);
  }

  // Final sweep so entries that expired during a quiet period are closed.
  engine.tick(start + steps * stepMs);

  // --- Measurement, from what the engine actually dialled ---------------------

  // Entry-scoped: was there an order from this number placed at or after THIS
  // entry's abandonment and at or before we dialled? An order predating the
  // abandonment is irrelevant — that call is a fresh intent.
  let calledAfterOrdering = 0;
  for (const call of engine.dialled) {
    const orderedFirst = orders.some(
      (o) => o.normalizedNumber === call.normalizedNumber &&
             o.placedAt >= call.abandonedAt &&
             o.placedAt <= call.at,
    );
    if (orderedFirst) calledAfterOrdering += 1;
  }

  // CC-P06 is per ENTRY: one attempt per abandoned call. Two abandonments by one
  // customer are two entries and may each receive a callback.
  const perEntry = new Map<string, number>();
  for (const call of engine.dialled) perEntry.set(call.entryId, (perEntry.get(call.entryId) ?? 0) + 1);
  const duplicateCallbacks = [...perEntry.values()].filter((n) => n > 1).length;

  let calledWhenStale = 0;
  let calledOutOfHours = 0;
  for (const entry of engine.all()) {
    if (entry.dialledAt === null) continue;
    if (entry.dialledAt - entry.abandonedAt >= config.stalenessWindowMs) calledWhenStale += 1;
    const m = new Date(entry.dialledAt).getUTCHours() * 60 + new Date(entry.dialledAt).getUTCMinutes();
    if (m < OPEN_MINUTE || m >= CLOSE_MINUTE) calledOutOfHours += 1;
  }

  const connected = engine.byState('CONNECTED').length;
  const failures: string[] = [];
  if (calledAfterOrdering > 0) failures.push(`${calledAfterOrdering} callback(s) placed to a number that had already ordered (CC-P03)`);
  if (duplicateCallbacks > 0) failures.push(`${duplicateCallbacks} number(s) received more than one callback (CC-P02, CC-P06)`);
  if (calledWhenStale > 0) failures.push(`${calledWhenStale} callback(s) placed after the staleness window (CC-P04)`);
  if (calledOutOfHours > 0) failures.push(`${calledOutOfHours} callback(s) placed outside operating hours (CC-P07)`);

  return {
    abandonments: entries.length,
    connected,
    suppressed: engine.byState('SUPPRESSED').length,
    expired: engine.byState('EXPIRED').length,
    unanswered: engine.byState('UNANSWERED').length,
    unreachable: engine.byState('UNREACHABLE').length,
    calledAfterOrdering, duplicateCallbacks, calledWhenStale, calledOutOfHours,
    recoveryRate: entries.length === 0 ? 0 : connected / entries.length,
    passed: failures.length === 0,
    failures,
  };
}
