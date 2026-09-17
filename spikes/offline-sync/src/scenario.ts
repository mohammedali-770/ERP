/**
 * The R-02 scenario: concurrent multi-channel intake with fault injection.
 *
 * Gates (docs/lab/test-plan.md T-01, NFR-001/003/004):
 *   - zero lost accepted orders
 *   - zero duplicate business orders
 *   - every device's hash chain intact
 *   - sustained throughput above 200 orders/hour per branch
 */
import { verifyChain } from '@firsttaste/contracts';
import { Device, Central } from './model.ts';

export interface ScenarioConfig {
  readonly branches: number;
  readonly devicesPerBranch: number;
  readonly ordersPerHourPerBranch: number;
  readonly durationMinutes: number;
  /** Probability that a sync round is dropped entirely (central link flapping). */
  readonly syncFailureRate: number;
  /** Probability that a device crashes after committing, before syncing. */
  readonly crashRate: number;
  /** Probability that a push is duplicated (retry after a lost acknowledgement). */
  readonly duplicatePushRate: number;
  /** Clock error injected into one device per branch. */
  readonly clockSkewMs: number;
  /**
   * Probability that a sync round's response is lost after the batch landed, so
   * the client re-sends the identical batch at the wire level.
   */
  readonly ackLossRate: number;
  readonly seed: number;
  /**
   * Control case: makes a retry MINT A NEW ORDER IDENTIFIER instead of resuming
   * the existing one — the real-world failure that happens without durable
   * mint-once identity (ADR-0005). Used to prove the harness detects duplication.
   * A spike that cannot fail is not evidence.
   */
  readonly sabotageIdentity?: boolean;
}

export interface ScenarioResult {
  readonly ordersAccepted: number;
  readonly ordersAtCentral: number;
  readonly ordersLost: number;
  readonly ordersDuplicated: number;
  readonly duplicatePushesIgnored: number;
  readonly chainFailures: number;
  readonly ordersPerHour: number;
  readonly passed: boolean;
  readonly failures: string[];
}

/** Deterministic PRNG, so a failing run can be reproduced exactly from its seed. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const CHANNELS = ['cashier', 'customer_app', 'call_centre', 'delivery_platform'] as const;

export function runScenario(config: ScenarioConfig): ScenarioResult {
  const random = makeRandom(config.seed);
  const central = new Central();
  const devices: Device[] = [];

  for (let b = 0; b < config.branches; b++) {
    for (let d = 0; d < config.devicesPerBranch; d++) {
      devices.push(new Device({
        deviceId: `br${b}-dev${d}`,
        branchId: `br${b}`,
        // One device per branch carries a wrong clock, as the lab injects.
        clockSkewMs: d === 0 ? config.clockSkewMs : 0,
      }));
    }
  }

  const totalOrders = Math.round(
    (config.ordersPerHourPerBranch * config.branches * config.durationMinutes) / 60,
  );
  const startWallClock = Date.UTC(2026, 8, 17, 8, 0, 0);
  const msPerOrder = (config.durationMinutes * 60_000) / Math.max(1, totalOrders);

  /** Business orders we believe were accepted: the device fsync'd OrderAccepted. */
  const acceptedBusinessKeys = new Set<string>();

  for (let i = 0; i < totalOrders; i++) {
    const wallClock = startWallClock + Math.round(i * msPerOrder);
    const device = devices[i % devices.length]!;
    const channel = CHANNELS[i % CHANNELS.length]!;
    // The business order: one real customer transaction. The technical
    // identifier below must map to exactly one of these, forever.
    const businessKey = `${device.deviceId}-biz-${i}`;
    const orderId = businessKey;

    const writeOrder = (id: string): void => {
      device.append('order', id, 'OrderCreated', { channel, business_key: businessKey }, wallClock);
      device.append('order', id, 'OrderLineAdded', { item: `item-${i % 40}`, qty: 1 + (i % 3), business_key: businessKey }, wallClock);
      device.append('order', id, 'OrderAccepted', { channel, total_minor: 2500 + (i % 100), business_key: businessKey }, wallClock);
    };

    writeOrder(orderId);

    // A crash BEFORE commit loses a draft, which is correct behaviour and must
    // not be counted as a lost accepted order.
    if (random() < config.crashRate) {
      device.crash();
      continue;
    }

    device.commit();
    acceptedBusinessKeys.add(businessKey);

    // A crash AFTER commit must lose nothing: the outbox is durable.
    if (random() < config.crashRate) device.crash();

    // Central link flapping. When the round runs, its response is sometimes lost
    // after the batch landed, forcing an identical wire-level re-send. Central
    // must absorb every one of those by event_id and not move the order count.
    const syncDropped = random() < config.syncFailureRate;
    if (!syncDropped) device.sync(central, random() < config.ackLossRate);

    // The ambiguous case: the push may or may not have landed, and the device
    // retries. Correct behaviour is to RESUME the same identity.
    if (random() < config.duplicatePushRate) {
      if (config.sabotageIdentity) {
        // The failure this design exists to prevent: re-entering the order under
        // a fresh identifier because the first outcome was unclear.
        writeOrder(`${businessKey}-retry`);
        device.commit();
        device.sync(central);
      } else {
        device.sync(central);
      }
    }
  }

  // Connectivity restored: everything drains. Repeat until quiescent.
  for (let round = 0; round < 10; round++) {
    let moved = 0;
    for (const device of devices) moved += device.sync(central);
    if (moved === 0) break;
  }

  const index = central.businessOrderIndex();
  const lost = [...acceptedBusinessKeys].filter((key) => !index.has(key));
  // One business order holding more than one technical identifier is a duplicate
  // order in the books — the thing NFR-003 forbids.
  const duplicated = [...index.entries()].filter(([, ids]) => ids.size > 1);
  const unexpected = [...index.keys()].filter((key) => !acceptedBusinessKeys.has(key));

  let chainFailures = 0;
  for (const device of devices) {
    const result = verifyChain(central.eventsFor(device.deviceId));
    chainFailures += result.failures.length;
  }

  const failures: string[] = [];
  if (lost.length > 0) failures.push(`${lost.length} accepted order(s) lost (NFR-003)`);
  if (duplicated.length > 0) failures.push(`${duplicated.length} business order(s) became multiple orders (NFR-003)`);
  if (unexpected.length > 0) failures.push(`${unexpected.length} order(s) at central were never accepted (NFR-003)`);
  if (chainFailures > 0) failures.push(`${chainFailures} hash-chain failure(s) (SEC-006)`);

  const ordersPerHour = (acceptedBusinessKeys.size / config.durationMinutes) * 60 / config.branches;
  if (ordersPerHour < 200) {
    failures.push(`throughput ${ordersPerHour.toFixed(0)}/h per branch is below the 200/h gate (NFR-001)`);
  }

  return {
    ordersAccepted: acceptedBusinessKeys.size,
    ordersAtCentral: index.size,
    ordersLost: lost.length,
    ordersDuplicated: duplicated.length,
    duplicatePushesIgnored: central.duplicates(),
    chainFailures,
    ordersPerHour,
    passed: failures.length === 0,
    failures,
  };
}
