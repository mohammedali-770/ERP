/**
 * The stock screens' logic, kept out of .tsx so test/stock.test.ts can read it.
 *
 * A QUANTITY IS NEVER A FLOAT. It is typed ("12.5", or "١٢٫٥"), checked here as the edge
 * and 0020 check it, and sent as the decimal text typed; it comes back as text and is
 * shown from that text. Nothing on the way parses it into a JavaScript number.
 *
 * STOCK IS HELD AT ONE FACILITY (ADR-0029 D4), so these screens are the masters'
 * inverse: the item, supplier, price and facility screens change things only while
 * working organisation-wide, and these only while working AT a warehouse or a factory,
 * where 0020 asks permission (erp.assert_permitted(…, 'inventory.stock', 'write', the
 * facility)). A branch holds no stock until its business day is decided (Q-06), and an
 * office none at all.
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0020 decides every rule: that stock does not go
 * below zero without an override, that nothing is dated at or before a count, that a
 * quantity is exact in the base unit. The form asks a few before sending only so a
 * person is told which line.
 *
 * Requirements: INV-009 · INV-P01 · INV-P02 · PRG-014
 */
import type {
  StockAdjustmentInput, StockCountInput, StockLineInput, StockReversalInput, ViewerFacility,
} from './api.ts';
import { latinDigits } from './format.ts';
import { holds, type Viewer } from './navigation.ts';
import { momentInput } from './transfer-prices.ts';

/** What an adjustment form records, write-offs first: the commonest entry is a waste. 0020's kinds, less count and reversal. */
export const ADJUSTMENT_KINDS = ['waste', 'damage', 'expiry', 'adjustment'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Every kind 0020 records (stock_decision_kind_is_known), for labels. */
export const STOCK_KINDS = ['count', 'adjustment', 'waste', 'damage', 'expiry', 'reversal'] as const;

/** The facility types that hold stock (0020: stock_branch_business_day_undecided, stock_facility_holds_no_stock). */
export const STOCK_FACILITY_TYPES: ReadonlySet<string> = new Set(['warehouse', 'factory']);

/** 0020's line limit (stock_lines_are_stated). */
export const MAX_LINES = 500;

/**
 * A quantity as typed: up to twelve digits and six decimal places, 0020's rule
 * (stock_quantity_is_valid), with Arabic-Indic digits and the Arabic decimal separator
 * read. A count may find none; nothing else moves none. Grouping commas are refused, since
 * "1,250" could be read two ways.
 */
export function quantityInput(raw: string, zeroAllowed: boolean): { ok: true; value: string } | { ok: false } {
  const v = latinDigits(raw).trim();
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(v)) return { ok: false };
  if (!zeroAllowed && /^0+(\.0+)?$/.test(v)) return { ok: false };
  return { ok: true, value: v };
}

/**
 * A quantity as the database answered it, without trailing zeros: "12.500" reads "12.5",
 * "-10" stays "-10". Text throughout.
 */
export function formatQuantity(q: string | null): string {
  if (q === null) return '';
  return q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q;
}

/** True when a balance stands below zero: read from the text's sign, never parsed. */
export function isNegative(q: string): boolean {
  return /^-(?!0+(\.0+)?$)/.test(q.trim());
}

/** True when a quantity is nothing at all: "0", "0.000". */
export function isZero(q: string): boolean {
  return /^-?0+(\.0+)?$/.test(q.trim());
}

/**
 * When something happened: now, or a stated Riyadh date and time, sent with its offset
 * (transfer-prices.ts, momentInput). A late entry states its moment (D3); a blank or
 * half-typed one is refused, never read as now.
 */
export function stockMoment(when: 'now' | 'stated', date: string, time: string, badInput = false):
  { ok: true; value: string | null } | { ok: false } {
  return momentInput(when === 'now' ? 'now' : 'later', date, time, badInput);
}

/** The facility the person is working at, from the session's list; undefined organisation-wide. */
export function workingFacility(facilities: readonly ViewerFacility[], facilityId: string | null): ViewerFacility | undefined {
  return facilityId === null ? undefined : facilities.find((f) => f.facility_id === facilityId);
}

/**
 * Whether the stock screens offer changes: working at a warehouse or a factory, where the
 * viewer — computed for that facility, as 0020's gate asks there — admits the write.
 */
export function stockWritable(facility: ViewerFacility | undefined, viewer: Viewer, writable: (v: Viewer) => boolean): boolean {
  return facility !== undefined && STOCK_FACILITY_TYPES.has(facility.facility_type) && writable(viewer);
}

/**
 * Whether the person may let stock go below zero here (D1): approve on the capability at
 * this facility, which 0020 asks only when a movement would. Never in a preview.
 */
export function holdsOverride(viewer: Viewer): boolean {
  return !viewer.preview && holds(viewer, 'inventory.stock', 'approve');
}

/** Whether a decision is offered for reversal: a movement, not a count or a reversal, not reversed yet. */
export function reversible(d: { readonly kind: string; readonly reversed_by_decision_id: string | null }): boolean {
  return (ADJUSTMENT_KINDS as readonly string[]).includes(d.kind) && d.reversed_by_decision_id === null;
}

/** One line as a form holds it: the pack chosen, the quantity as typed, the direction on an adjustment. */
export interface DraftLine {
  readonly itemUnitId: string;
  readonly quantity: string;
  readonly direction: 'in' | 'out' | '';
}

export type LineProblem =
  | { readonly kind: 'no_lines' }
  | { readonly kind: 'too_many' }
  | { readonly kind: 'pack'; readonly line: number }
  | { readonly kind: 'quantity'; readonly line: number }
  | { readonly kind: 'direction'; readonly line: number }
  | { readonly kind: 'repeat'; readonly line: number; readonly first: number };

/**
 * The lines a form sends: each a chosen pack and a quantity as decimal text, with a
 * direction on an adjustment and none on a write-off or a count. A problem names its line,
 * counted from 1 as a person reads it. One line per pack: 0020 refuses a repeated one
 * (stock_line_repeats), so the form says which before sending.
 */
export function stockLines(kind: AdjustmentKind | 'count', drafts: readonly DraftLine[]):
  { ok: true; value: StockLineInput[] } | { ok: false; problem: LineProblem } {
  if (drafts.length === 0) return { ok: false, problem: { kind: 'no_lines' } };
  if (drafts.length > MAX_LINES) return { ok: false, problem: { kind: 'too_many' } };
  const seen = new Map<string, number>();
  const lines: StockLineInput[] = [];
  for (const [i, d] of drafts.entries()) {
    const line = i + 1;
    if (d.itemUnitId === '') return { ok: false, problem: { kind: 'pack', line } };
    const first = seen.get(d.itemUnitId);
    if (first !== undefined) return { ok: false, problem: { kind: 'repeat', line, first } };
    seen.set(d.itemUnitId, line);
    const q = quantityInput(d.quantity, kind === 'count');
    if (!q.ok) return { ok: false, problem: { kind: 'quantity', line } };
    if (kind === 'adjustment') {
      if (d.direction !== 'in' && d.direction !== 'out') return { ok: false, problem: { kind: 'direction', line } };
      lines.push({ item_unit_id: d.itemUnitId, quantity: q.value, direction: d.direction });
    } else {
      lines.push({ item_unit_id: d.itemUnitId, quantity: q.value });
    }
  }
  return { ok: true, value: lines };
}

/** Optional text as the routes take it: blank is null. */
const optional = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** An adjustment or a write-off: the id the form minted when it opened, at the facility worked at. */
export function adjustmentBody(ids: { decision_id: string }, f: {
  facilityId: string; kind: AdjustmentKind; occurredAt: string | null; lines: readonly StockLineInput[];
  reason: string; overrideReason: string;
}): StockAdjustmentInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    kind: f.kind,
    occurred_at: f.occurredAt,
    lines: f.lines,
    reason: f.reason.trim(),
    override_reason: optional(f.overrideReason),
  };
}

export function countBody(ids: { decision_id: string }, f: {
  facilityId: string; countedAt: string | null; lines: readonly StockLineInput[]; reason: string;
}): StockCountInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    counted_at: f.countedAt,
    lines: f.lines,
    reason: f.reason.trim(),
  };
}

/** A reversal's body: the decision reversed is named in the path, never here. */
export function reversalBody(ids: { decision_id: string }, f: {
  facilityId: string; reason: string; overrideReason: string;
}): StockReversalInput {
  return { decision_id: ids.decision_id, facility_id: f.facilityId, reason: f.reason.trim(), override_reason: optional(f.overrideReason) };
}

/** 0020's refusal when a movement would take stock below zero (D1): the form then offers the override, to those who hold it. */
export const WOULD_GO_NEGATIVE = 'stock_would_go_negative';
