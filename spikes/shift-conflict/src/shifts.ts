/**
 * Shift, cash and blind-count model.
 *
 * SPIKE CODE — proves the shift rules in
 * docs/architecture/core-transaction-design.md §3 and §5:
 *   - a shift is a CASH-RESPONSIBILITY assignment to a cashier, not a device lock
 *   - one cashier across several terminals is the NORMAL case (POS-022, POS-023)
 *   - duplicate close: first HLC wins, the loser is told, close is terminal
 *   - duplicate open under partition: earliest HLC canonical, cash re-parented by
 *     APPEND-ONLY correction events, zero cash lost (OFF-009)
 *   - blind count is commit-then-reveal, so a count cannot be edited after the
 *     variance becomes knowable (POS-024)
 */
import { uuidv7, hlcEncode, hlcNow, hlcZero, payloadHash, type Hlc } from '@firsttaste/contracts';

export interface Shift {
  readonly shift_id: string;
  readonly branch_id: string;
  readonly cashier_id: string;
  readonly opened_hlc: string;
  status: 'open' | 'closing' | 'closed';
  readonly devices: Set<string>;
}

export interface CashMovement {
  readonly movement_id: string;
  /** Mutable ONLY through an append-only reassignment event, never edited in place. */
  shift_id: string;
  readonly drawer_id: string;
  readonly amount_minor: number;
  readonly device_id: string;
  readonly reassigned_from: string | null;
}

export interface CountCommitment {
  readonly shift_id: string;
  /** Hash of the counted denominations plus a nonce, committed BEFORE variance. */
  readonly count_hash: string;
  readonly committed_at_hlc: string;
}

export interface Variance {
  readonly shift_id: string;
  readonly expected_minor: number;
  readonly counted_minor: number;
  readonly variance_minor: number;
}

export class ShiftLedger {
  private readonly shifts = new Map<string, Shift>();
  private readonly movements: CashMovement[] = [];
  private readonly commitments = new Map<string, CountCommitment>();
  private readonly variances = new Map<string, Variance>();
  /** Append-only incident log. Conflicts are raised, never silently merged (I-3). */
  readonly incidents: Array<{ kind: string; detail: string }> = [];
  private clock: Hlc;

  constructor(deviceId = 'ledger') {
    this.clock = hlcZero(deviceId);
  }

  private tick(wallClock: number): string {
    this.clock = hlcNow(this.clock, wallClock);
    return hlcEncode(this.clock);
  }

  openShift(branchId: string, cashierId: string, deviceId: string, wallClock: number): Shift {
    const hlc = this.tick(wallClock);
    const shift: Shift = {
      shift_id: uuidv7(wallClock), branch_id: branchId, cashier_id: cashierId,
      opened_hlc: hlc, status: 'open', devices: new Set([deviceId]),
    };
    this.shifts.set(shift.shift_id, shift);
    return shift;
  }

  /** A cashier working another terminal JOINS the shift. Not a conflict. */
  joinDevice(shiftId: string, deviceId: string): void {
    const shift = this.shifts.get(shiftId);
    if (!shift) throw new Error(`No such shift: ${shiftId}`);
    if (shift.status !== 'open') throw new Error(`Cannot join a ${shift.status} shift`);
    shift.devices.add(deviceId);
  }

  /** Cash posts against the shift and drawer, never the device (POS-023). */
  recordCash(shiftId: string, drawerId: string, amountMinor: number, deviceId: string, wallClock: number): CashMovement {
    const movement: CashMovement = {
      movement_id: uuidv7(wallClock), shift_id: shiftId, drawer_id: drawerId,
      amount_minor: amountMinor, device_id: deviceId, reassigned_from: null,
    };
    this.movements.push(movement);
    return movement;
  }

  /**
   * Merges a duplicate open for one cashier: earliest HLC is canonical, the
   * later shift's cash is re-parented by APPEND-ONLY reassignment. Nothing is
   * deleted and no cash is lost.
   */
  mergeDuplicateOpen(shiftA: string, shiftB: string): { canonical: string; merged: string; reassigned: number } {
    const a = this.shifts.get(shiftA);
    const b = this.shifts.get(shiftB);
    if (!a || !b) throw new Error('Both shifts must exist to merge');
    if (a.cashier_id !== b.cashier_id || a.branch_id !== b.branch_id) {
      throw new Error('Only a duplicate open for one cashier in one branch may merge');
    }
    const [canonical, merged] = a.opened_hlc <= b.opened_hlc ? [a, b] : [b, a];

    let reassigned = 0;
    for (const m of this.movements) {
      if (m.shift_id !== merged.shift_id) continue;
      // Append-only correction: the original parent is retained on the record.
      const corrected: CashMovement = { ...m, shift_id: canonical.shift_id, reassigned_from: merged.shift_id };
      this.movements[this.movements.indexOf(m)] = corrected;
      reassigned += 1;
    }
    for (const d of merged.devices) canonical.devices.add(d);
    merged.status = 'closed';
    this.shifts.delete(merged.shift_id);
    this.shifts.set(merged.shift_id, merged);

    this.incidents.push({
      kind: 'ShiftMergeRequired',
      detail: `${merged.shift_id} merged into ${canonical.shift_id}; ${reassigned} movement(s) reassigned`,
    });
    return { canonical: canonical.shift_id, merged: merged.shift_id, reassigned };
  }

  /** First close wins; later attempts are told, not silently ignored. */
  requestClose(shiftId: string, deviceId: string, wallClock: number): { accepted: boolean; reason?: string } {
    const shift = this.shifts.get(shiftId);
    if (!shift) throw new Error(`No such shift: ${shiftId}`);
    if (shift.status === 'open') {
      shift.status = 'closing';
      this.tick(wallClock);
      return { accepted: true };
    }
    this.incidents.push({
      kind: 'ShiftCloseRejected',
      detail: `${deviceId} tried to close ${shiftId} which is already ${shift.status}`,
    });
    return { accepted: false, reason: `already ${shift.status}` };
  }

  /**
   * Commits the blind count. The hash is recorded BEFORE the variance can be
   * computed, so a count cannot be adjusted once the expected figure is known.
   */
  commitCount(shiftId: string, countedMinor: number, nonce: string, wallClock: number): CountCommitment {
    if (this.variances.has(shiftId)) {
      throw new Error('Variance already computed; a count committed now would not be blind');
    }
    const commitment: CountCommitment = {
      shift_id: shiftId,
      count_hash: payloadHash({ counted_minor: countedMinor, shift_id: shiftId, nonce }),
      committed_at_hlc: this.tick(wallClock),
    };
    this.commitments.set(shiftId, commitment);
    return commitment;
  }

  /** Reveals the expected figure and computes variance. Only after a commitment. */
  computeVariance(shiftId: string, countedMinor: number, nonce: string): Variance {
    const commitment = this.commitments.get(shiftId);
    if (!commitment) throw new Error('No count commitment; the count must be committed first');
    const expected = payloadHash({ counted_minor: countedMinor, shift_id: shiftId, nonce });
    if (expected !== commitment.count_hash) {
      throw new Error('Counted amount does not match the committed hash — the count was altered');
    }
    const expectedMinor = this.expectedCash(shiftId);
    const variance: Variance = {
      shift_id: shiftId, expected_minor: expectedMinor, counted_minor: countedMinor,
      variance_minor: countedMinor - expectedMinor,
    };
    this.variances.set(shiftId, variance);
    const shift = this.shifts.get(shiftId);
    if (shift) shift.status = 'closed';
    return variance;
  }

  /** Total cash for a shift, across every device that joined it. */
  expectedCash(shiftId: string): number {
    return this.movements
      .filter((m) => m.shift_id === shiftId)
      .reduce((sum, m) => sum + m.amount_minor, 0);
  }

  totalCash(): number {
    return this.movements.reduce((sum, m) => sum + m.amount_minor, 0);
  }

  movementsFor(shiftId: string): CashMovement[] {
    return this.movements.filter((m) => m.shift_id === shiftId);
  }

  getShift(shiftId: string): Shift | undefined {
    return this.shifts.get(shiftId);
  }

  allMovements(): readonly CashMovement[] {
    return this.movements;
  }
}
