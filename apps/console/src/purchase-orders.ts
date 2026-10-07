/**
 * The purchase-order screens' logic (module 8, step 3), kept out of .tsx so
 * test/purchase-orders.test.ts can read it.
 *
 * AN ORDER GOES TO ONE FACILITY (P1), a warehouse or a factory, as stock does: the screens
 * read and write only at the facility worked at (stock.ts, stockPlace), and offer a change
 * only where 0023's gate would let it through (purchaseRights).
 *
 * MONEY IS NEVER A FLOAT (P2). A price is typed in riyals and sent as whole halalas
 * (transfer-prices.ts, priceInput). A line's amount, the subtotal and the VAT shown before
 * sending are worked out here in BigInt, rounded as 0023 rounds them, half up: the figure
 * the person checks is the figure the order will carry. A quantity is decimal text
 * throughout (stock.ts, quantityInput), and is compared here by scaling it, never parsed.
 *
 * NOBODY APPROVES WHAT THEY RAISED (P3, PRC-004). Approve and reject are offered only to
 * someone holding approve here, on an order someone else raised. 0023 refuses it anyway.
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0023 decides every rule: the limit, the supply, a
 * receipt past what is still to come, a cancel with goods received.
 *
 * Requirements: PRC-001 · PRC-002 · PRC-004 · PRC-006 · INV-006 · PRG-014
 */
import type {
  ClearLimitInput, DecideOrderInput, LimitDecision, OrderDecisionPath, OrderLineInput, PurchaseOrder, RaiseOrderInput, ReceiptLineInput,
  ReceiveInput, ReceiptReversalInput, SetLimitInput, ViewerFacility,
} from './api.ts';
import { latinDigits } from './format.ts';
import { holds, stateOf, type NavItem, type Viewer } from './navigation.ts';
import { quantityInput, STOCK_FACILITY_TYPES } from './stock.ts';
import { CURRENCY, priceInput } from './transfer-prices.ts';

/** An order's states, in 0023's order (purchase_order_state_is_known). */
export const ORDER_STATES = ['pending', 'approved', 'rejected', 'cancelled', 'closed'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** How much of an order has arrived (erp.purchase_order_progress()). */
export const ORDER_PROGRESS = ['none', 'partial', 'full'] as const;

/** The decisions 0023 records about an order (purchase_order_decision_kind_is_known), for labels. */
export const ORDER_DECISION_KINDS = ['order_raised', 'order_approved', 'order_rejected', 'order_cancelled', 'order_closed'] as const;

/** The decisions about a facility's limit (purchase_limit_decision_kind_is_known), for labels. */
export const LIMIT_KINDS = ['limit_set', 'limit_cleared'] as const;

/** A decision about an order is its path: approve, reject, cancel or close, never a word in a body. */
export const ORDER_DECISIONS: readonly OrderDecisionPath[] = ['approve', 'reject', 'cancel', 'close'];
export type OrderDecision = OrderDecisionPath;

/** 0023's line limit for an order and a receipt (purchase_order_lines_are_stated, purchase_receipt_lines_are_stated). */
export const MAX_ORDER_LINES = 200;

/** 0023's VAT range: 0 to 10000 basis points, 0% to 100% (purchase_order_vat_rate_is_known). */
export const MAX_VAT_BP = 10_000;

/** The rate a new order starts at: Saudi VAT, 15%. A form shows it, and the person may change it. */
export const DEFAULT_VAT = '15';

/** 0023's caps, in halalas: a line, an order before VAT, a limit. */
export const MAX_LINE_MINOR = 100_000_000_000_000n;
export const MAX_SUBTOTAL_MINOR = 1_000_000_000_000_000n;
export const MAX_LIMIT_MINOR = 10_000_000_000_000;

/** A delivery note, as 0023 keeps it: trimmed, 1 to 64 characters (purchase_receipt_delivery_note_is_canonical). */
export const MAX_DELIVERY_NOTE = 64;

/**
 * A VAT rate typed as a percentage, as whole basis points: "15" → 1500, "15.5" → 1550,
 * "0" → 0. Arabic-Indic digits and the Arabic decimal separator are read. At most two
 * decimals, since a basis point is a hundredth of a percent, and at most 100%.
 */
export function vatInput(raw: string): { ok: true; value: number } | { ok: false } {
  const v = latinDigits(raw).trim().replace(/%$/, '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v);
  if (m === null) return { ok: false };
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= MAX_VAT_BP ? { ok: true, value: bp } : { ok: false };
}

/** Basis points as a percentage for reading: 1500 → "15", 1550 → "15.5", 1505 → "15.05". */
export function formatVat(bp: number): string {
  const whole = Math.floor(bp / 100);
  const part = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return part === '' ? String(whole) : `${whole}.${part}`;
}

/** Decimal text as a whole number of millionths: 0023 holds quantities to six places. */
function micro(q: string): bigint {
  const [whole, part = ''] = q.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(part.padEnd(6, '0').slice(0, 6) || '0');
}

/** Halves round up, as PostgreSQL's round(numeric) does for a positive amount. */
function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return (n % d) * 2n >= d ? q + 1n : q;
}

/**
 * A line's amount in halalas: its quantity, decimal text, times its price per pack,
 * rounded half up to a whole halala, as 0023 computes it (round(quantity * price_minor)).
 */
export function lineAmount(quantity: string, priceMinor: number): bigint {
  return roundDiv(micro(quantity) * BigInt(priceMinor), 1_000_000n);
}

/** An order's figures before sending, as 0023 will record them: VAT is round(subtotal × rate / 10000). */
export function orderTotals(lines: readonly { quantity: string; price_minor: number }[], vatBp: number):
  { subtotal: bigint; vat: bigint; total: bigint } {
  const subtotal = lines.reduce((sum, l) => sum + lineAmount(l.quantity, l.price_minor), 0n);
  const vat = roundDiv(subtotal * BigInt(vatBp), 10_000n);
  return { subtotal, vat, total: subtotal + vat };
}

/** -1, 0 or 1: two quantities compared as decimal text, never as floats. */
export function compareQuantity(a: string, b: string): number {
  const x = micro(a);
  const y = micro(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** One line of a new order as the form holds it: the pack chosen, the quantity and price as typed. */
export interface DraftOrderLine {
  readonly itemUnitId: string;
  readonly quantity: string;
  /** In riyals, as typed. */
  readonly price: string;
}

export type OrderLineProblem =
  | { readonly kind: 'no_lines' }
  | { readonly kind: 'too_many' }
  | { readonly kind: 'pack'; readonly line: number }
  | { readonly kind: 'quantity'; readonly line: number }
  | { readonly kind: 'price'; readonly line: number }
  | { readonly kind: 'repeat'; readonly line: number; readonly first: number }
  | { readonly kind: 'line_too_much'; readonly line: number }
  | { readonly kind: 'order_too_much' };

/**
 * The lines a new order sends: each a pack the supplier sells, a quantity as decimal text
 * above nothing, and a price in whole halalas. A problem names its line, counted from 1.
 * One line per pack: 0023 refuses a repeated one (purchase_order_line_pack_once).
 */
export function orderLines(drafts: readonly DraftOrderLine[]):
  { ok: true; value: OrderLineInput[] } | { ok: false; problem: OrderLineProblem } {
  if (drafts.length === 0) return { ok: false, problem: { kind: 'no_lines' } };
  if (drafts.length > MAX_ORDER_LINES) return { ok: false, problem: { kind: 'too_many' } };
  const seen = new Map<string, number>();
  const lines: OrderLineInput[] = [];
  let subtotal = 0n;
  for (const [i, d] of drafts.entries()) {
    const line = i + 1;
    if (d.itemUnitId === '') return { ok: false, problem: { kind: 'pack', line } };
    const first = seen.get(d.itemUnitId);
    if (first !== undefined) return { ok: false, problem: { kind: 'repeat', line, first } };
    seen.set(d.itemUnitId, line);
    const q = quantityInput(d.quantity, false);
    if (!q.ok) return { ok: false, problem: { kind: 'quantity', line } };
    const p = priceInput(d.price);
    if (!p.ok) return { ok: false, problem: { kind: 'price', line } };
    const amount = lineAmount(q.value, p.value);
    if (amount > MAX_LINE_MINOR) return { ok: false, problem: { kind: 'line_too_much', line } };
    subtotal += amount;
    lines.push({ item_unit_id: d.itemUnitId, quantity: q.value, price_minor: p.value });
  }
  if (subtotal > MAX_SUBTOTAL_MINOR) return { ok: false, problem: { kind: 'order_too_much' } };
  return { ok: true, value: lines };
}

export type ReceiptProblem =
  | { readonly kind: 'no_lines' }
  | { readonly kind: 'quantity'; readonly line: number }
  | { readonly kind: 'exceeds'; readonly line: number };

/**
 * A receipt's lines: for each order line given a quantity, its number and that quantity
 * as decimal text, in the line's own pack. A blank line did not arrive and is left out;
 * none at all is no receipt. Nothing past what is still to come (0023:
 * purchase_receipt_exceeds_order), so the form says which line before sending. A problem
 * names the ORDER's line number, which is what the person reads beside it.
 */
export function receiptLines(order: Pick<PurchaseOrder, 'lines'>, typed: Readonly<Record<number, string>>):
  { ok: true; value: ReceiptLineInput[] } | { ok: false; problem: ReceiptProblem } {
  const lines: ReceiptLineInput[] = [];
  for (const l of order.lines) {
    const raw = typed[l.line_no] ?? '';
    if (raw.trim() === '') continue;
    const q = quantityInput(raw, false);
    if (!q.ok) return { ok: false, problem: { kind: 'quantity', line: l.line_no } };
    if (compareQuantity(q.value, l.remaining) > 0) return { ok: false, problem: { kind: 'exceeds', line: l.line_no } };
    lines.push({ line_no: l.line_no, quantity: q.value });
  }
  if (lines.length === 0) return { ok: false, problem: { kind: 'no_lines' } };
  return { ok: true, value: lines };
}

/**
 * A limit typed in riyals, as whole halalas, more than nothing: to have none, it is
 * cleared. Its own parser, not a price's: a price stops at ten digits of riyals, and a
 * limit runs to 0023's 100,000,000,000.00 (found in review). Read as priceInput reads.
 */
export function limitInput(raw: string): { ok: true; value: number } | { ok: false } {
  const v = latinDigits(raw).trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(v);
  if (m === null) return { ok: false };
  const halalas = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return halalas > 0 && halalas <= MAX_LIMIT_MINOR ? { ok: true, value: halalas } : { ok: false };
}

/** Optional text as the routes take it: blank is null. */
const optional = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** A new order: its ids minted when the form opened, at the facility worked at. */
export function raiseBody(ids: { decision_id: string; purchase_order_id: string }, f: {
  facilityId: string; supplierId: string; vatRateBp: number; lines: readonly OrderLineInput[]; reason: string;
}): RaiseOrderInput {
  return {
    decision_id: ids.decision_id,
    purchase_order_id: ids.purchase_order_id,
    facility_id: f.facilityId,
    supplier_id: f.supplierId,
    vat_rate_bp: f.vatRateBp,
    lines: f.lines,
    reason: f.reason.trim(),
  };
}

/** A decision about an order: the order and the decision are named in the path, never here. */
export function decideBody(ids: { decision_id: string }, f: { facilityId: string; reason: string }): DecideOrderInput {
  return { decision_id: ids.decision_id, facility_id: f.facilityId, reason: f.reason.trim() };
}

/** Goods received against an order: a stock decision's id, the order named in the path. */
export function receiptBody(ids: { decision_id: string }, f: {
  facilityId: string; receivedAt: string | null; lines: readonly ReceiptLineInput[]; deliveryNote: string;
}): ReceiveInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    received_at: f.receivedAt,
    lines: f.lines,
    delivery_note: optional(f.deliveryNote),
  };
}

/** A receipt reversed: the receipt named in the path, never here. */
export function receiptReversalBody(ids: { decision_id: string }, f: {
  facilityId: string; reason: string; overrideReason: string;
}): ReceiptReversalInput {
  return { decision_id: ids.decision_id, facility_id: f.facilityId, reason: f.reason.trim(), override_reason: optional(f.overrideReason) };
}

/** A limit, in halalas before VAT, against the stamp read: null only where the facility never had one. */
export function setLimitBody(ids: { decision_id: string }, f: {
  facilityId: string; limitMinor: number; expectedDecisionId: string | null; reason: string;
}): SetLimitInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.facilityId,
    limit_minor: f.limitMinor,
    currency: CURRENCY,
    // Stated, null included: the edge refuses a set that leaves it out.
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

export function clearLimitBody(ids: { decision_id: string }, f: {
  facilityId: string; expectedDecisionId: string; reason: string;
}): ClearLimitInput {
  return { decision_id: ids.decision_id, facility_id: f.facilityId, expected_decision_id: f.expectedDecisionId, reason: f.reason.trim() };
}

/**
 * The stamp a limit is set or cleared against: the decision in force, which the history
 * marks, a clearing included, or null when the facility has never had one. The history is
 * newest first, so its first row is the one in force should the mark be missing.
 */
export function limitStamp(history: readonly LimitDecision[]): string | null {
  return (history.find((d) => d.is_current) ?? history[0])?.decision_id ?? null;
}

/** The limit in force, or null: never set, or cleared. */
export function currentLimit(history: readonly LimitDecision[]): LimitDecision | null {
  const d = history.find((x) => x.is_current) ?? history[0];
  return d !== undefined && d.kind === 'limit_set' ? d : null;
}

/** What the person may do with orders at the facility worked at, by 0023's gates. */
export interface PurchaseRights {
  /** Read on orders, suppliers and items here: every 0023 order read asks all three. */
  readonly sees: boolean;
  /** Raise, cancel and close: write on orders here. */
  readonly raises: boolean;
  /** Approve and reject: approve on orders here. */
  readonly approves: boolean;
  /** Receive and reverse a receipt: write on orders and on stock here. */
  readonly receives: boolean;
  /** Read the facility's limits. */
  readonly seesLimits: boolean;
  /** Set and clear them. */
  readonly setsLimits: boolean;
}

export const NO_PURCHASE_RIGHTS: PurchaseRights = {
  sees: false, raises: false, approves: false, receives: false, seesLimits: false, setsLimits: false,
};

/** New work is admitted where the capability is enabled or in pilot (erp.capability_admits_new_work()), never in a preview. */
function admits(viewer: Viewer, capability: string, action: 'write' | 'approve'): boolean {
  const state = stateOf(viewer, capability);
  return !viewer.preview && (state === 'enabled' || state === 'pilot') && holds(viewer, capability, action);
}

const readable = (viewer: Viewer, capability: string) => stateOf(viewer, capability) !== 'hidden' && holds(viewer, capability, 'read');

/**
 * The rights at the facility worked at, from a viewer computed there, as 0023 asks there.
 * `entry` is the menu's: its visibility is the read every order route asks. Nothing is
 * offered organisation-wide or at a branch or office: an order goes to a warehouse or a
 * factory (assert_purchase_facility).
 */
export function purchaseRights(facility: ViewerFacility | undefined, viewer: Viewer, entry: NavItem,
                               itemIsVisible: (item: NavItem, viewer: Viewer) => boolean): PurchaseRights {
  if (facility === undefined || !STOCK_FACILITY_TYPES.has(facility.facility_type)) return NO_PURCHASE_RIGHTS;
  const sees = itemIsVisible(entry, viewer);
  const seesLimits = readable(viewer, 'procurement.purchase_limits');
  return {
    sees,
    raises: sees && admits(viewer, 'procurement.purchase_orders', 'write'),
    approves: sees && admits(viewer, 'procurement.purchase_orders', 'approve'),
    receives: sees && admits(viewer, 'procurement.purchase_orders', 'write') && admits(viewer, 'inventory.stock', 'write'),
    seesLimits,
    setsLimits: seesLimits && admits(viewer, 'procurement.purchase_limits', 'write'),
  };
}

/** What an order's page offers, by its state and what has arrived, to this person. */
export interface OrderActions {
  readonly approve: boolean;
  readonly reject: boolean;
  readonly cancel: boolean;
  readonly close: boolean;
  readonly receive: boolean;
}

/**
 * The decisions offered on an order, as 0023 would take them:
 *
 *   approve, reject   pending, to one holding approve who did not raise it (PRC-004)
 *   cancel            pending or approved, with nothing received: else it is closed
 *   close             approved, with part received and the rest not coming
 *   receive           approved, and not yet received in full
 *
 * A receipt's own reversal is offered beside it (receiptReversible).
 */
export function orderActions(order: Pick<PurchaseOrder, 'state' | 'progress' | 'raised_by'>, personId: string,
                             rights: PurchaseRights, facilityOpen: boolean): OrderActions {
  const decides = rights.approves && order.state === 'pending' && order.raised_by !== personId && facilityOpen;
  return {
    approve: decides,
    // Rejecting is not new work, but it is offered with approval: one decision, made by the approver.
    reject: rights.approves && order.state === 'pending' && order.raised_by !== personId,
    cancel: rights.raises && (order.state === 'pending' || order.state === 'approved') && order.progress === 'none',
    close: rights.raises && order.state === 'approved' && order.progress === 'partial',
    receive: rights.receives && order.state === 'approved' && order.progress !== 'full' && facilityOpen,
  };
}

/** Whether a receipt is offered for reversal: not reversed yet, by one who may receive here. */
export function receiptReversible(r: { readonly reversed_by_decision_id: string | null }, rights: PurchaseRights): boolean {
  return rights.receives && r.reversed_by_decision_id === null;
}

/** 0023's refusal when a receipt's reversal would take stock below zero (D1): the form then offers the override. */
export const RECEIPT_WOULD_GO_NEGATIVE = 'stock_would_go_negative';
