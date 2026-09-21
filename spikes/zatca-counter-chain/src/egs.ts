/**
 * The half of T-09 that needs no sandbox credentials.
 *
 * ZATCA Phase 2 requires each EGS unit to hold its own identity, an invoice
 * counter (ICV) that increments by exactly one, and a previous-invoice-hash
 * (PIH) chain. ADR-0006 puts one EGS unit on each POS device.
 *
 * None of that needs ZATCA to be reachable. Whether a counter is gapless, whether
 * a chain verifies, and whether a restored device reuses a counter are properties
 * of our own bookkeeping — provable here, today, while B-02 blocks only the
 * deferred-synchronisation half.
 *
 * What this deliberately does NOT model: certificates, CSIDs, signatures, QR
 * codes, XML, or clearance. Those need the sandbox. Simulating them would produce
 * confidence without evidence, which is worse than a gap.
 */
import { createHash } from 'node:crypto';

/** ZATCA's seed for the first invoice of a chain: SHA-256 of "0", base64. */
export const GENESIS_PIH = createHash('sha256').update('0').digest('base64');

export interface Invoice {
  readonly unit_id: string;
  /** Invoice counter value. Increments by exactly one, per unit, forever. */
  readonly icv: number;
  /** Hash of the previous invoice in this unit's chain. */
  readonly pih: string;
  /** This invoice's own hash, which becomes the next invoice's PIH. */
  readonly hash: string;
  readonly total_minor: number;
  readonly issued_at: number;
}

/** What a device backup captures — and therefore what a restore can rewind. */
export interface UnitSnapshot {
  readonly unit_id: string;
  readonly icv: number;
  readonly last_hash: string;
  readonly taken_at: number;
}

function invoiceHash(unitId: string, icv: number, pih: string, totalMinor: number): string {
  return createHash('sha256')
    .update(`${unitId}|${icv}|${pih}|${totalMinor}`)
    .digest('base64');
}

/**
 * The append-only record of every counter value this estate has ever issued.
 *
 * Stands in for whatever is authoritative in production — the central ledger once
 * reachable, a tamper-evident local log while offline. Its only job here is to be
 * the thing a restored device must reconcile against before it issues again.
 */
export class IssuanceLog {
  private readonly highWater = new Map<string, number>();
  readonly issued: Invoice[] = [];

  record(invoice: Invoice): void {
    this.issued.push(invoice);
    const current = this.highWater.get(invoice.unit_id) ?? 0;
    if (invoice.icv > current) this.highWater.set(invoice.unit_id, invoice.icv);
  }

  /** The highest counter value this unit is known to have issued. */
  highWaterFor(unitId: string): number {
    return this.highWater.get(unitId) ?? 0;
  }

  /** Counter values this unit issued more than once. Empty is the only lawful answer. */
  reusedCounters(unitId: string): number[] {
    const seen = new Set<number>();
    const reused = new Set<number>();
    for (const inv of this.issued) {
      if (inv.unit_id !== unitId) continue;
      if (seen.has(inv.icv)) reused.add(inv.icv);
      seen.add(inv.icv);
    }
    return [...reused].sort((a, b) => a - b);
  }
}

export class CounterReuseError extends Error {}

/**
 * One EGS unit — one POS device, per ADR-0006.
 *
 * `reconciled` is the whole point of the restore case. A unit restored from a
 * backup does not know it is stale; the log does. Until it has checked, issuing
 * is refused rather than guessed.
 */
export class EgsUnit {
  readonly unitId: string;
  private icv: number;
  private lastHash: string;
  private reconciled = true;

  constructor(unitId: string) {
    this.unitId = unitId;
    this.icv = 0;
    this.lastHash = GENESIS_PIH;
  }

  snapshot(takenAt: number): UnitSnapshot {
    return { unit_id: this.unitId, icv: this.icv, last_hash: this.lastHash, taken_at: takenAt };
  }

  /**
   * Restoring rewinds this unit's counter.
   *
   * `detected` is the control surface. With it true — the design — the unit knows
   * it is stale and refuses to issue until it has reconciled. With it false, the
   * unit carries on from the rewound counter believing nothing happened, which is
   * what a system with no restore detection actually does, and which reuses a
   * counter value on the very next invoice.
   */
  restoreFrom(snapshot: UnitSnapshot, detected = true): void {
    if (snapshot.unit_id !== this.unitId) throw new Error('snapshot belongs to another unit');
    this.icv = snapshot.icv;
    this.lastHash = snapshot.last_hash;
    this.reconciled = !detected;
  }

  /**
   * The guard ADR-0006 calls a compliance control rather than a bug fix: never
   * issue at or below a counter value already issued.
   */
  reconcile(log: IssuanceLog): void {
    const highWater = log.highWaterFor(this.unitId);
    if (highWater > this.icv) {
      const replayed = log.issued.filter((i) => i.unit_id === this.unitId && i.icv === highWater);
      this.icv = highWater;
      this.lastHash = replayed[replayed.length - 1]!.hash;
    }
    this.reconciled = true;
  }

  /** A restart loses nothing — state is persisted, not held in memory. Unlike a restore. */
  restart(): void {
    this.reconciled = true;
  }

  issue(totalMinor: number, issuedAt: number, log: IssuanceLog): Invoice {
    if (!this.reconciled) {
      throw new CounterReuseError(
        `${this.unitId} was restored and has not reconciled; issuing would reuse counter ${this.icv + 1}`,
      );
    }
    const icv = this.icv + 1;
    const pih = this.lastHash;
    const invoice: Invoice = {
      unit_id: this.unitId,
      icv,
      pih,
      hash: invoiceHash(this.unitId, icv, pih, totalMinor),
      total_minor: totalMinor,
      issued_at: issuedAt,
    };
    this.icv = icv;
    this.lastHash = invoice.hash;
    log.record(invoice);
    return invoice;
  }
}

export interface ChainVerdict {
  readonly unit_id: string;
  readonly ok: boolean;
  readonly count: number;
  readonly problem: string | null;
}

/**
 * Verify one unit's chain end to end: starts at the genesis PIH, increments by
 * exactly one with no gaps, and every PIH equals the previous invoice's hash.
 */
export function verifyChain(unitId: string, invoices: readonly Invoice[]): ChainVerdict {
  const chain = invoices.filter((i) => i.unit_id === unitId);
  let expectedIcv = 1;
  let expectedPih = GENESIS_PIH;
  for (const inv of chain) {
    if (inv.icv !== expectedIcv) {
      return { unit_id: unitId, ok: false, count: chain.length, problem: `counter expected ${expectedIcv}, found ${inv.icv}` };
    }
    if (inv.pih !== expectedPih) {
      return { unit_id: unitId, ok: false, count: chain.length, problem: `hash chain broken at counter ${inv.icv}` };
    }
    if (inv.hash !== invoiceHash(inv.unit_id, inv.icv, inv.pih, inv.total_minor)) {
      return { unit_id: unitId, ok: false, count: chain.length, problem: `invoice ${inv.icv} hash does not match its contents` };
    }
    expectedIcv = inv.icv + 1;
    expectedPih = inv.hash;
  }
  return { unit_id: unitId, ok: true, count: chain.length, problem: null };
}
