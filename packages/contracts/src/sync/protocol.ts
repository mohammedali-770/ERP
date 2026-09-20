/**
 * The branch synchronisation protocol.
 *
 * One protocol, unchanged, for device↔peer, device↔controller and device↔central.
 * This is what makes the ADR-0004 hardware decision deferrable: a controller is a
 * peer with better uptime, not a different protocol.
 *
 * See docs/architecture/core-transaction-design.md §3.
 */
import type { ChainedEvent } from '../events/envelope.ts';

export interface Hello {
  readonly device_id: string;
  readonly branch_id: string;
  readonly app_version: string;
  readonly schema_version: number;
  readonly my_seq_high: number;
  readonly my_chain_head_hash: string;
  readonly peer_cursors: Readonly<Record<string, number>>;
  readonly stream_cursors: Readonly<Record<string, string>>;
  readonly local_now: string;
  readonly hlc: string;
  readonly unresolved: { readonly payments_unknown: number; readonly prints_failed: number };
}

export interface AckHello {
  readonly server_now: string;
  /** Bumping this forces a full resync — the recovery lever after a restore. */
  readonly epoch: number;
  /**
   * Answers "did my push land?" before the device does anything else.
   * The push path has the same ambiguity as a payment, but here it is free to
   * solve: the identifier is a primary key and the sequence is gapless.
   */
  readonly acked_through_seq: number;
  readonly want_from_seq: number;
  readonly config_version: string;
  readonly backoff_hint_ms: number;
  readonly resume_token: string;
}

export interface Push {
  readonly resume_token: string;
  /** Ordered by device_seq from want_from_seq, capped by count and bytes. */
  readonly events: readonly ChainedEvent[];
}

export type RejectionReason =
  | 'schema_too_new' | 'unknown_aggregate' | 'constraint_violation'
  | 'epoch_mismatch' | 'auth_failed' | 'conflict_incident';

export interface PushAck {
  /**
   * PREFIX acceptance: 1..N are durable. A rejection halts the prefix.
   * Per-event acknowledgement sets would reintroduce gap bookkeeping, which is
   * where bugs live.
   */
  readonly accepted_through_seq: number;
  readonly rejected: ReadonlyArray<{
    readonly event_id: string;
    readonly device_seq: number;
    readonly reason: RejectionReason;
    readonly detail: string;
  }>;
  readonly conflicts: ReadonlyArray<{
    readonly aggregate_id: string;
    readonly incident_id: string;
    readonly rule: string;
  }>;
}

export const PUSH_MAX_EVENTS = 500;
export const PUSH_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Selects the next batch to push. Always starts at `wantFromSeq` and never skips:
 * a gap would break the prefix guarantee that makes acknowledgement cheap.
 */
export function selectPushBatch(
  pending: readonly ChainedEvent[],
  wantFromSeq: number,
  maxEvents: number = PUSH_MAX_EVENTS,
  maxBytes: number = PUSH_MAX_BYTES,
): ChainedEvent[] {
  const ordered = [...pending]
    .filter((e) => e.device_seq >= wantFromSeq)
    .sort((a, b) => a.device_seq - b.device_seq);

  const batch: ChainedEvent[] = [];
  let bytes = 0;
  let expectedSeq = wantFromSeq;

  for (const e of ordered) {
    // Stop at the first gap rather than pushing past it.
    if (e.device_seq !== expectedSeq) break;
    const size = JSON.stringify(e).length;
    // Always include at least one event, even if it alone exceeds the byte cap,
    // otherwise an oversized event wedges the queue permanently.
    if (batch.length > 0 && (batch.length >= maxEvents || bytes + size > maxBytes)) break;
    batch.push(e);
    bytes += size;
    expectedSeq += 1;
  }
  return batch;
}

/**
 * Where to resume after a handshake. A device that timed out mid-push simply
 * resumes from what the server confirms it holds — no reconciliation needed.
 */
export function resumePoint(ack: AckHello): number {
  return Math.max(ack.want_from_seq, ack.acked_through_seq + 1);
}
