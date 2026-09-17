/**
 * The event envelope every event carries, and its canonical serialisation.
 *
 * See docs/domain/event-catalogue.md. Rules from ADR-0003 and I-10: append-only,
 * additive-only schema, schema_version on every event.
 */
import { createHash } from 'node:crypto';

export type AggregateType =
  | 'order' | 'payment' | 'shift' | 'cash' | 'print' | 'availability' | 'invoice' | 'menu';

export type ActorType = 'cashier' | 'system' | 'integration';

export interface EventEnvelope {
  readonly event_id: string;        // UUIDv7 — the idempotency key
  readonly device_id: string;
  readonly device_seq: number;      // gapless per device
  readonly hlc: string;             // encoded, sortable
  readonly occurred_at: string;     // RFC3339 UTC
  readonly tz_name: string;         // 'Asia/Riyadh'
  readonly business_date: string;   // set at shift open, NOT calendar midnight
  readonly branch_id: string;
  readonly shift_id: string | null;
  readonly aggregate_type: AggregateType;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlation_id: string | null;
  readonly causation_id: string | null;
  readonly actor_type: ActorType;
  readonly actor_id: string | null;
}

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace.
 *
 * Two devices serialising the same logical payload must produce byte-identical
 * output, or the hash chain reports tampering where none occurred.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * Links an event into its device's hash chain.
 *
 * One SHA-256 per event buys provable detection of gaps, reordering and
 * tampering — the cheapest audit mechanism available for a system whose top risk
 * is financial-record integrity (SEC-006, SEC-007).
 */
export function chainHash(previousChainHash: string, currentPayloadHash: string): string {
  return createHash('sha256').update(previousChainHash).update(currentPayloadHash).digest('hex');
}

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainedEvent extends EventEnvelope {
  readonly payload_hash: string;
  readonly prev_hash: string;
}

export interface ChainVerification {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<{ event_id: string; device_seq: number; reason: string }>;
}

/**
 * Verifies one device's chain: sequence gapless and ascending, payload hashes
 * intact, chain links consistent.
 */
export function verifyChain(events: readonly ChainedEvent[]): ChainVerification {
  const failures: Array<{ event_id: string; device_seq: number; reason: string }> = [];
  const ordered = [...events].sort((a, b) => a.device_seq - b.device_seq);

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = ordered.length > 0 ? ordered[0]!.device_seq : 0;

  for (const e of ordered) {
    if (e.device_seq !== expectedSeq) {
      failures.push({
        event_id: e.event_id,
        device_seq: e.device_seq,
        reason: `sequence gap: expected ${expectedSeq}, got ${e.device_seq}`,
      });
      expectedSeq = e.device_seq;
    }
    const recomputed = payloadHash(e.payload);
    if (recomputed !== e.payload_hash) {
      failures.push({ event_id: e.event_id, device_seq: e.device_seq, reason: 'payload hash mismatch' });
    }
    if (e.prev_hash !== expectedPrev) {
      failures.push({ event_id: e.event_id, device_seq: e.device_seq, reason: 'chain link mismatch' });
    }
    expectedPrev = chainHash(e.prev_hash, e.payload_hash);
    expectedSeq += 1;
  }
  return { ok: failures.length === 0, failures };
}
