/**
 * Abandoned-call callback engine.
 *
 * SPIKE CODE — proves the rules in docs/architecture/call-centre-integration.md
 * before the integration is built. Not for extension into the product.
 *
 * Requirements: CC-P01..CC-P08 (proposed, not yet approved).
 *
 * The property that matters:
 *
 *   **Suppression is evaluated immediately before dialling, never when the entry
 *   is queued.** An order can arrive while the entry waits for a free agent, and
 *   calling someone who has already ordered is the single most likely way this
 *   feature irritates customers.
 */

export type EntryState =
  | 'ELIGIBLE' | 'DIALLING' | 'CONNECTED'
  | 'SUPPRESSED' | 'EXPIRED' | 'UNANSWERED' | 'UNREACHABLE';

export interface CallbackEntry {
  readonly entryId: string;
  /** Canonical form, per the normalisation APP-004 requires. */
  readonly normalizedNumber: string | null;
  readonly abandonedAt: number;
  readonly queue: string;
  state: EntryState;
  closedReason: string | null;
  attempts: number;
  dialledAt: number | null;
}

export interface Order {
  readonly normalizedNumber: string;
  readonly placedAt: number;
  /** Any channel counts — app, call centre, walk-in (CC-P03). */
  readonly channel: string;
}

export interface EngineConfig {
  /** No callback once this has elapsed since abandonment (CC-P04). */
  readonly stalenessWindowMs: number;
  /** Operating hours, as [openMinuteOfDay, closeMinuteOfDay) (CC-P07). */
  readonly operatingHours: readonly [number, number];
  /**
   * Control case: evaluate suppression when the entry is QUEUED rather than
   * immediately before dialling. This is the natural-looking implementation and
   * it calls customers who have already ordered.
   */
  readonly suppressAtQueueTime?: boolean;
}

/** Everything the engine needs from outside, so the spike can drive it. */
export interface Ports {
  /** Orders from this number placed at or after `since`, across every channel. */
  ordersSince(normalizedNumber: string, since: number): readonly Order[];
  /** Whether any agent is free right now. */
  agentAvailable(now: number): boolean;
  /** Places the call. Returns whether the customer answered. */
  dial(entry: CallbackEntry, now: number): boolean;
}

function minuteOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export class CallbackEngine {
  private readonly entries: CallbackEntry[] = [];
  private readonly config: EngineConfig;
  private readonly ports: Ports;
  private nextId = 1;

  /**
   * Every call placed, scoped to its ENTRY.
   *
   * Entry-scoped rather than number-scoped, because a customer who abandons at
   * 10:00 and again at 14:00 has two separate intents and legitimately receives
   * two callbacks. Measuring per number conflates those and reports correct
   * behaviour as a defect.
   */
  readonly dialled: Array<{ entryId: string; normalizedNumber: string; at: number; abandonedAt: number }> = [];

  constructor(config: EngineConfig, ports: Ports) {
    this.config = config;
    this.ports = ports;
  }

  /**
   * Records an abandonment (CC-P01, CC-P02).
   *
   * At most one open entry per number: a customer who abandons three times in
   * ten minutes gets one callback, not three.
   */
  recordAbandonment(normalizedNumber: string | null, queue: string, at: number): CallbackEntry | null {
    if (normalizedNumber === null) {
      // Caller ID withheld — a normal outcome, recorded rather than dropped.
      const entry: CallbackEntry = {
        entryId: `cb-${this.nextId++}`, normalizedNumber: null, abandonedAt: at, queue,
        state: 'UNREACHABLE', closedReason: 'caller_id_withheld', attempts: 0, dialledAt: null,
      };
      this.entries.push(entry);
      return entry;
    }

    const open = this.entries.find(
      (e) => e.normalizedNumber === normalizedNumber && (e.state === 'ELIGIBLE' || e.state === 'DIALLING'),
    );
    if (open) return null; // already queued

    const entry: CallbackEntry = {
      entryId: `cb-${this.nextId++}`, normalizedNumber, abandonedAt: at, queue,
      state: 'ELIGIBLE', closedReason: null, attempts: 0, dialledAt: null,
    };

    // The control case checks here instead of at dial time.
    if (this.config.suppressAtQueueTime && this.isSuppressed(entry, at)) {
      entry.state = 'SUPPRESSED';
      entry.closedReason = 'ordered_since_abandonment';
    }

    this.entries.push(entry);
    return entry;
  }

  /** CC-P03: has this number ordered, through any channel, since abandoning? */
  private isSuppressed(entry: CallbackEntry, _now: number): boolean {
    if (entry.normalizedNumber === null) return false;
    return this.ports.ordersSince(entry.normalizedNumber, entry.abandonedAt).length > 0;
  }

  private isStale(entry: CallbackEntry, now: number): boolean {
    return now - entry.abandonedAt >= this.config.stalenessWindowMs;
  }

  private withinHours(now: number): boolean {
    const [open, close] = this.config.operatingHours;
    const m = minuteOfDay(now);
    return m >= open && m < close;
  }

  /**
   * One pass of the engine. Called whenever an agent frees up or on a timer.
   *
   * Order matters: expiry is evaluated before suppression, so a stale entry
   * closes as EXPIRED rather than being reported as suppressed — the reports in
   * CC-P08 distinguish "they ordered anyway" from "we were too slow".
   */
  tick(now: number): void {
    for (const entry of this.entries) {
      if (entry.state !== 'ELIGIBLE') continue;

      if (this.isStale(entry, now)) {
        entry.state = 'EXPIRED';
        entry.closedReason = 'staleness_window_elapsed';
        continue;
      }

      // CC-P03, evaluated HERE — immediately before dialling, not at queue time.
      //
      // The control case skips this, which is what a naive implementation does:
      // having already checked when the entry was created, it sees no reason to
      // check again. That is precisely the bug — the order arrives in between.
      if (!this.config.suppressAtQueueTime && this.isSuppressed(entry, now)) {
        entry.state = 'SUPPRESSED';
        entry.closedReason = 'ordered_since_abandonment';
        continue;
      }

      if (!this.withinHours(now)) continue;       // CC-P07: wait, do not close
      if (!this.ports.agentAvailable(now)) continue; // CC-P05

      entry.state = 'DIALLING';
      entry.attempts += 1;
      entry.dialledAt = now;
      this.dialled.push({
        entryId: entry.entryId,
        normalizedNumber: entry.normalizedNumber!,
        at: now,
        abandonedAt: entry.abandonedAt,
      });

      const answered = this.ports.dial(entry, now);
      if (answered) {
        entry.state = 'CONNECTED';
        entry.closedReason = 'connected';
      } else {
        // CC-P06: one attempt only. No automated redialling.
        entry.state = 'UNANSWERED';
        entry.closedReason = 'no_answer';
      }
    }
  }

  all(): readonly CallbackEntry[] {
    return this.entries;
  }

  byState(state: EntryState): CallbackEntry[] {
    return this.entries.filter((e) => e.state === state);
  }
}
