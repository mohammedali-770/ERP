/**
 * A minimal but faithful model of the branch runtime and central store, used to
 * prove the properties in docs/architecture/core-transaction-design.md under
 * fault injection.
 *
 * This is SPIKE CODE. It exists to retire risk R-02, not to be extended into the
 * product. Its value is that it implements exactly the mechanisms the design
 * claims — transactional outbox, gapless sequence, prefix acknowledgement,
 * idempotent ingestion — so a failure here is a real design failure.
 */
import {
  uuidv7, hlcZero, hlcNow, hlcEncode, payloadHash, chainHash, GENESIS_HASH,
  selectPushBatch, resumePoint,
  type ChainedEvent, type Hlc, type AckHello, type AggregateType,
} from '@firsttaste/contracts';

export interface DeviceOptions {
  readonly deviceId: string;
  readonly branchId: string;
  /** Milliseconds of clock error injected into this device. */
  readonly clockSkewMs?: number;
}

/** One branch device: local store plus durable outbox. */
export class Device {
  readonly deviceId: string;
  readonly branchId: string;
  private readonly clockSkewMs: number;

  /** Durably committed events. Survives a simulated crash. */
  private committed: ChainedEvent[] = [];
  /** Uncommitted work. Lost on crash — which is correct; it is a draft. */
  private uncommitted: ChainedEvent[] = [];

  private seq = 0;
  private hlc: Hlc;
  private chainHead = GENESIS_HASH;
  private ackedThrough = 0;

  constructor(opts: DeviceOptions) {
    this.deviceId = opts.deviceId;
    this.branchId = opts.branchId;
    this.clockSkewMs = opts.clockSkewMs ?? 0;
    this.hlc = hlcZero(opts.deviceId);
  }

  private now(wallClock: number): number {
    return wallClock + this.clockSkewMs;
  }

  /**
   * Appends an event to the local store and outbox in ONE transaction.
   *
   * This is invariant I-2. The event is not visible to synchronisation until
   * `commit()` returns, which models the fsync boundary that defines "accepted"
   * (core-transaction-design.md §0).
   */
  append(
    aggregateType: AggregateType,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
    wallClock: number,
  ): ChainedEvent {
    this.seq += 1;
    this.hlc = hlcNow(this.hlc, this.now(wallClock));
    const hash = payloadHash(payload);
    const event: ChainedEvent = {
      event_id: uuidv7(this.now(wallClock)),
      device_id: this.deviceId,
      device_seq: this.seq,
      hlc: hlcEncode(this.hlc),
      occurred_at: new Date(this.now(wallClock)).toISOString(),
      tz_name: 'Asia/Riyadh',
      business_date: '2026-09-17',
      branch_id: this.branchId,
      shift_id: 'shift-1',
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: eventType,
      schema_version: 1,
      payload,
      correlation_id: null,
      causation_id: null,
      actor_type: 'cashier',
      actor_id: 'emp-1',
      payload_hash: hash,
      prev_hash: this.chainHead,
    };
    this.chainHead = chainHash(this.chainHead, hash);
    this.uncommitted.push(event);
    return event;
  }

  /** The fsync boundary. After this returns, the event is accepted. */
  commit(): void {
    this.committed.push(...this.uncommitted);
    this.uncommitted = [];
  }

  /**
   * Simulates a crash or force-quit: uncommitted work is lost, committed work
   * survives, and the sequence and chain rewind to the committed head.
   */
  crash(): void {
    this.uncommitted = [];
    const last = this.committed.at(-1);
    this.seq = last?.device_seq ?? 0;
    this.chainHead = last ? chainHash(last.prev_hash, last.payload_hash) : GENESIS_HASH;
  }

  pending(): ChainedEvent[] {
    return this.committed.filter((e) => e.device_seq > this.ackedThrough);
  }

  committedEvents(): readonly ChainedEvent[] {
    return this.committed;
  }

  /**
   * One synchronisation round. Returns how many events were durably accepted.
   *
   * `duplicateWire` models an HTTP-level retry: the batch reaches central, the
   * response is lost, and the client re-sends the identical batch before it can
   * ask again. This is the path the event_id primary key absorbs, and the only
   * one that genuinely exercises it — a retry that gets as far as a fresh
   * handshake is resolved by `acked_through_seq` and never re-sends at all.
   */
  sync(central: Central, duplicateWire = false): number {
    const ack: AckHello = central.hello(this.deviceId, this.ackedThrough);
    // Trust the server's answer to "did my push land?" over local belief.
    this.ackedThrough = Math.max(this.ackedThrough, ack.acked_through_seq);
    const from = resumePoint(ack);

    const batch = selectPushBatch(this.pending(), from);
    if (batch.length === 0) return 0;

    const result = central.push(this.deviceId, batch);
    if (duplicateWire) central.push(this.deviceId, batch); // response lost; client retries
    const before = this.ackedThrough;
    this.ackedThrough = Math.max(this.ackedThrough, result.accepted_through_seq);
    return this.ackedThrough - before;
  }
}

export interface IngestResult {
  readonly accepted_through_seq: number;
  readonly duplicatesIgnored: number;
}

/** The central store: an append-only event log with idempotent ingestion. */
export class Central {
  /** Keyed by event_id — this primary key IS the duplicate prevention (ADR-0005). */
  private readonly log = new Map<string, ChainedEvent>();
  /** Highest contiguous sequence held per device. */
  private readonly ackedThrough = new Map<string, number>();
  private duplicatesIgnored = 0;

  hello(deviceId: string, _clientBelief: number): AckHello {
    const acked = this.ackedThrough.get(deviceId) ?? 0;
    return {
      server_now: new Date().toISOString(),
      epoch: 1,
      acked_through_seq: acked,
      want_from_seq: acked + 1,
      config_version: 'v1',
      backoff_hint_ms: 0,
      resume_token: `tok-${deviceId}-${acked}`,
    };
  }

  /**
   * Ingests a batch. Acceptance is PREFIX-based: a gap above the acknowledged
   * point halts the prefix, so the device re-pushes from there rather than the
   * server tracking holes.
   *
   * Replays at or below the acknowledged point are NOT a gap — a device that
   * lost its acknowledgement state (restored from backup, or an ack dropped in
   * flight) re-sends events we already hold. Those are absorbed by the event_id
   * primary key, which is the mechanism ADR-0005 relies on. Treating them as a
   * gap would make the replay path untested, which is exactly the bug the
   * control case exists to catch.
   */
  push(deviceId: string, events: readonly ChainedEvent[]): IngestResult {
    let acked = this.ackedThrough.get(deviceId) ?? 0;

    for (const e of [...events].sort((a, b) => a.device_seq - b.device_seq)) {
      if (e.device_seq <= acked) {
        // Replay of something already durable. ON CONFLICT DO NOTHING.
        if (this.log.has(e.event_id)) this.duplicatesIgnored += 1;
        else this.log.set(e.event_id, e);
        continue;
      }
      if (e.device_seq !== acked + 1) break; // genuine gap: stop the prefix
      if (this.log.has(e.event_id)) this.duplicatesIgnored += 1;
      else this.log.set(e.event_id, e);
      acked = e.device_seq;
    }
    this.ackedThrough.set(deviceId, acked);
    return { accepted_through_seq: acked, duplicatesIgnored: this.duplicatesIgnored };
  }

  size(): number {
    return this.log.size;
  }

  duplicates(): number {
    return this.duplicatesIgnored;
  }

  all(): ChainedEvent[] {
    return [...this.log.values()];
  }

  /** Distinct technical order identifiers that reached the accepted state. */
  distinctOrders(): Set<string> {
    const orders = new Set<string>();
    for (const e of this.log.values()) {
      if (e.aggregate_type === 'order' && e.event_type === 'OrderAccepted') {
        orders.add(e.aggregate_id);
      }
    }
    return orders;
  }

  /**
   * Maps each BUSINESS order to the technical identifiers central holds for it.
   *
   * This is what "no duplicate order" actually means (NFR-003): not that an event
   * arrived twice — the primary key handles that — but that one real customer
   * transaction became two orders in the books. That happens when an identifier
   * is regenerated on retry instead of resumed, which is the failure ADR-0005's
   * mint-once rule prevents.
   */
  businessOrderIndex(): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();
    for (const e of this.log.values()) {
      if (e.aggregate_type !== 'order' || e.event_type !== 'OrderAccepted') continue;
      const businessKey = String((e.payload as { business_key?: unknown }).business_key ?? e.aggregate_id);
      const ids = index.get(businessKey) ?? new Set<string>();
      ids.add(e.aggregate_id);
      index.set(businessKey, ids);
    }
    return index;
  }

  eventsFor(deviceId: string): ChainedEvent[] {
    return [...this.log.values()]
      .filter((e) => e.device_id === deviceId)
      .sort((a, b) => a.device_seq - b.device_seq);
  }
}
