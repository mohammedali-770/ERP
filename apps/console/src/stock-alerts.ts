/**
 * The stock-alert screens' logic (module 7, step 3), kept out of .tsx so
 * test/stock-alerts.test.ts can read it.
 *
 * A MINIMUM IS HELD AT ONE FACILITY (A1), as stock is: the screens read and write only at
 * the warehouse or factory being worked at (stock.ts, stockPlace), and change things only
 * where 0022's gate would let them: write on stock alerts there, with the reads its list
 * asks.
 *
 * A MINIMUM IS A QUANTITY, typed in a pack of the item and sent as the decimal text typed
 * (stock.ts, quantityInput), and more than nothing: in the warehouse 0 meant none, so here
 * none is cleared, never set to 0.
 *
 * THE STAMP IS THE DECISION IN FORCE. A set sends `expected_decision_id`: the item's
 * current decision here, which its history marks, a clearing included, or null when the
 * item has never had a minimum here (ADR-0031's step 2 addendum). The list leaves cleared
 * minimums out, so the stamp is read from the history, never from the list.
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0022 decides every rule.
 *
 * Requirements: INV-P03 · SUP-P04 · PRG-014
 */
import type { ClearMinimumInput, ItemUnit, MinimumDecision, SetMinimumInput } from './api.ts';
import { quantityInput } from './stock.ts';

/** A minimum as typed: 0022's rule (stock_minimum_is_valid), and more than nothing. */
export function minimumInput(raw: string): { ok: true; value: string } | { ok: false } {
  return quantityInput(raw, false);
}

/**
 * The stamp a set or a clear is checked against: the decision in force here, which the
 * history marks, or null when the item has never had a minimum here. A history is newest
 * first, so its first row is the one in force should the mark be missing.
 */
export function stampOf(history: readonly MinimumDecision[]): string | null {
  return (history.find((d) => d.is_current) ?? history[0])?.decision_id ?? null;
}

/** The minimum in force, as entered, or null when there is none: never set, or cleared. */
export function currentMinimum(history: readonly MinimumDecision[]): MinimumDecision | null {
  const d = history.find((x) => x.is_current) ?? history[0];
  return d !== undefined && d.kind === 'minimum_set' ? d : null;
}

/** The packs a minimum may be entered in: the item's current ones (0022: stock_minimum_pack_is_retired). */
export function minimumPacks(units: readonly ItemUnit[]): ItemUnit[] {
  return units.filter((u) => u.status === 'active');
}

/** A set's body: the ids minted when the form opened, at the facility worked at, against the stamp read. */
export function setMinimumBody(ids: { decision_id: string }, f: {
  facilityId: string; itemUnitId: string; quantity: string; expectedDecisionId: string | null; reason: string;
}): SetMinimumInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    item_unit_id: f.itemUnitId,
    quantity: f.quantity,
    // Stated, null included: the edge refuses a set that leaves it out (ADR-0031's step 2 addendum).
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

/** A clear's body: the item cleared is named in the path, never here. */
export function clearMinimumBody(ids: { decision_id: string }, f: {
  facilityId: string; expectedDecisionId: string; reason: string;
}): ClearMinimumInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

/** The decision kinds 0022 records (stock_minimum_decision_kind_is_known), for labels. */
export const MINIMUM_KINDS = ['minimum_set', 'minimum_cleared'] as const;
