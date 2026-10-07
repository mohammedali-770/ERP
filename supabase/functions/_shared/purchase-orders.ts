/**
 * The purchase-orders function: 0023's nine runtime routes over HTTP (module 8, step 2).
 *
 *   GET   /purchase-orders                                   erp.purchase_orders()
 *   GET   /purchase-orders/{purchase_order_id}               erp.get_purchase_order()
 *   GET   /purchase-orders/limits                            erp.purchase_limit_history()
 *   POST  /purchase-orders                                   erp.raise_purchase_order()
 *   POST  /purchase-orders/{purchase_order_id}/approve       erp.decide_purchase_order(order_approved)
 *   POST  /purchase-orders/{purchase_order_id}/reject        erp.decide_purchase_order(order_rejected)
 *   POST  /purchase-orders/{purchase_order_id}/cancel        erp.decide_purchase_order(order_cancelled)
 *   POST  /purchase-orders/{purchase_order_id}/close         erp.decide_purchase_order(order_closed)
 *   POST  /purchase-orders/{purchase_order_id}/receipts      erp.receive_purchase_order()
 *   POST  /purchase-orders/receipts/{receipt_id}/reverse     erp.reverse_purchase_receipt()
 *   POST  /purchase-orders/limits                            erp.set_purchase_limit()
 *   POST  /purchase-orders/limits/clear                      erp.clear_purchase_limit()
 *
 * As ./stock.ts and ./stock-alerts.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor —
 *   which matters more here than anywhere: nobody approves an order they raised (PRC-004),
 *   and 0023 can only hold that if the actor is who the token says.
 *
 *   SHAPE ONLY is checked here (./fields.ts). A quantity is decimal text, an amount a whole
 *   number, a moment names its offset, a line is an object; that a quantity is above
 *   nothing, that a pack is supplied, that an order is within its limit, that a receipt is
 *   not more than is still to come — every rule is 0023's, and its refusal comes back
 *   through ./refusal.ts.
 *
 *   EVERY ROUTE NAMES ITS FACILITY: an order goes to one (P1). A write's body states
 *   `facility_id`; a read asks at the query's, and left out, 0023 refuses it.
 *
 *   THE DECISION IDS are minted by the console (I-1), and so is a new order's own id. A
 *   retried write is answered 409 already_recorded, and the console confirms it through
 *   the order at the same facility: its decisions hold a raise or a decision, its receipts
 *   a receipt and the reversal of one. A limit's retry is confirmed through the facility's
 *   limit history. An id the record does not hold was used for something else: a
 *   collision, never a retry. The same order id under a new decision is 409 conflict.
 *
 * THREE THINGS OF ITS OWN:
 *
 *   THE DECISION IS THE PATH. Approve, reject, cancel and close are four paths, each its
 *   own kind; no body names a kind, so none can name another.
 *
 *   AN AMOUNT IS A JSON NUMBER OF HALALAS: a price per pack, a limit — 12500, never
 *   "125.00" or 125.5 (./transfer-prices.ts's rule). A VAT rate is whole basis points.
 *
 *   A LINE CARRIES ON ONLY WHAT IT IS: an order line its pack, quantity and price; a
 *   receipt line its order line's number and quantity. Nothing else a client puts on a
 *   line reaches the database, so no receipt line can name a pack: it arrives in the one
 *   ordered.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, moment, noSuchRoute, ok, optionalText, routeOf, shaped, text, uuid, UUID,
  type Source,
} from './fields.ts';
import type { OrderDecisionKind, PurchaseOrderLine, ReceiptLine } from './purchase-orders-db.ts';

/** Decimal text, as ./stock.ts's: digits, and a point with digits after it. How many is 0023's rule. */
const QUANTITY = /^\d{1,40}(\.\d{1,40})?$/;

/**
 * An order or a receipt is a document of up to 200 lines, not a form: an order line at its
 * longest is about 110 bytes, so a full order is about 22 KB, past the 8 KiB a form may be.
 * 64 KiB leaves room for a pretty-printed body and an Arabic reason.
 */
export const DOCUMENT_LIMIT = 64 * 1024;

const DECISIONS: Readonly<Record<string, OrderDecisionKind>> = {
  approve: 'order_approved', reject: 'order_rejected', cancel: 'order_cancelled', close: 'order_closed',
};

/** A whole number as a JSON number: an amount, a rate, a line's number. Its range is 0023's rule. */
function whole(source: Source, field: string): number {
  const v = source[field];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Malformed(field);
  return v;
}

/**
 * A whole number the driver casts to `integer`: a VAT rate. Past int4, PostgreSQL's own
 * cast fails with a 22003 that names no field, so the edge says which (found in review).
 * That it is 0 to 10000 is still 0023's rule.
 */
function int4(source: Source, field: string): number {
  const v = whole(source, field);
  if (v < -2147483648 || v > 2147483647) throw new Malformed(field);
  return v;
}

function lineArray(source: Source): Source[] {
  const v = source['lines'];
  if (!Array.isArray(v) || v.length < 1 || v.length > 200) throw new Malformed('lines');
  return v.map((line: unknown, i: number) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) throw new Malformed(`lines[${i}]`);
    return line as Source;
  });
}

/** An order's lines: 1 to 200, each a pack by id, a quantity as decimal text and a price in halalas. */
function orderLines(source: Source): PurchaseOrderLine[] {
  return lineArray(source).map((l, i) => {
    const itemUnitId = l['item_unit_id'];
    if (typeof itemUnitId !== 'string' || !UUID.test(itemUnitId)) throw new Malformed(`lines[${i}].item_unit_id`);
    const quantity = l['quantity'];
    if (typeof quantity !== 'string' || !QUANTITY.test(quantity)) throw new Malformed(`lines[${i}].quantity`);
    const price = l['price_minor'];
    if (typeof price !== 'number' || !Number.isSafeInteger(price)) throw new Malformed(`lines[${i}].price_minor`);
    return { item_unit_id: itemUnitId, quantity, price_minor: price };
  });
}

/** A receipt's lines: 1 to 200, each an order line's number and a quantity as decimal text. */
function receiptLines(source: Source): ReceiptLine[] {
  return lineArray(source).map((l, i) => {
    const lineNo = l['line_no'];
    if (typeof lineNo !== 'number' || !Number.isSafeInteger(lineNo) || lineNo < 1) throw new Malformed(`lines[${i}].line_no`);
    const quantity = l['quantity'];
    if (typeof quantity !== 'string' || !QUANTITY.test(quantity)) throw new Malformed(`lines[${i}].quantity`);
    return { line_no: lineNo, quantity };
  });
}

/** A stamp the form read: present, and a UUID or null. Absent or empty is malformed, never "none". */
function statedStamp(source: Source): string | null {
  return source['expected_decision_id'] === null ? null : uuid(source, 'expected_decision_id');
}

/** A page ends before a seq: decimal text of a positive int8. */
function beforeSeq(query: Source): string | null {
  const v = query['before'];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) {
    throw new Malformed('before');
  }
  return v;
}

/** Newest first: a full page may have an older one, which ends before its last seq. */
function olderPage(rows: readonly Readonly<Record<string, unknown>>[], limit: number): string | null {
  const last = rows[rows.length - 1];
  return rows.length === limit && last !== undefined ? String(last['seq']) : null;
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const orders = await deps.db.purchaseOrders(s.personId, {
    facilityId: facilityOf(request),
    state: optionalText(q, 'state', 16),
    beforeSeq: beforeSeq(q),
    limit,
  });
  return ok({ orders, next_before: olderPage(orders as unknown as Record<string, unknown>[], limit) });
}

async function limits(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const decisions = await deps.db.purchaseLimitHistory(s.personId, {
    facilityId: facilityOf(request), beforeSeq: beforeSeq(q), limit,
  });
  return ok({ decisions, next_before: olderPage(decisions, limit) });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'purchase-orders');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if (path.length === 1 && path[0] === 'limits') return limits(request, s, deps);
    if (path.length === 1 && path[0] !== 'receipts') {
      const purchaseOrderId = uuid({ purchase_order_id: path[0] }, 'purchase_order_id');
      return ok({ order: await deps.db.getPurchaseOrder(actor, facilityOf(request), purchaseOrderId) });
    }
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 0) {
    const b = await form(request, DOCUMENT_LIMIT);
    const decisionId = uuid(b, 'decision_id');
    const purchaseOrderId = uuid(b, 'purchase_order_id');
    await deps.db.raisePurchaseOrder(actor, {
      decisionId,
      purchaseOrderId,
      facilityId: uuid(b, 'facility_id'),
      supplierId: uuid(b, 'supplier_id'),
      vatRateBp: int4(b, 'vat_rate_bp'),
      lines: orderLines(b),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId, purchase_order_id: purchaseOrderId });
  }
  if (path[0] === 'limits') {
    if (path.length === 1) {
      const b = await form(request);
      const decisionId = uuid(b, 'decision_id');
      await deps.db.setPurchaseLimit(actor, {
        decisionId,
        facilityId: uuid(b, 'facility_id'),
        limitMinor: whole(b, 'limit_minor'),
        currency: text(b, 'currency', 3),
        expectedDecisionId: statedStamp(b),
        reason: text(b, 'reason', 500),
      });
      return ok({ decision_id: decisionId });
    }
    if (path.length === 2 && path[1] === 'clear') {
      const b = await form(request);
      const decisionId = uuid(b, 'decision_id');
      await deps.db.clearPurchaseLimit(actor, {
        decisionId,
        facilityId: uuid(b, 'facility_id'),
        expectedDecisionId: uuid(b, 'expected_decision_id'),
        reason: text(b, 'reason', 500),
      });
      return ok({ decision_id: decisionId });
    }
    return noSuchRoute;
  }
  if (path[0] === 'receipts') {
    if (path.length === 3 && path[2] === 'reverse') {
      const receiptDecisionId = uuid({ receipt_id: path[1] }, 'receipt_id');
      const b = await form(request);
      const decisionId = uuid(b, 'decision_id');
      await deps.db.reversePurchaseReceipt(actor, {
        decisionId,
        facilityId: uuid(b, 'facility_id'),
        receiptDecisionId,
        reason: text(b, 'reason', 500),
        overrideReason: optionalText(b, 'override_reason', 500),
      });
      return ok({ decision_id: decisionId });
    }
    return noSuchRoute;
  }
  if (path.length === 2) {
    const kind = Object.hasOwn(DECISIONS, path[1]!) ? DECISIONS[path[1]!] : undefined;
    if (kind === undefined && path[1] !== 'receipts') return noSuchRoute;
    const purchaseOrderId = uuid({ purchase_order_id: path[0] }, 'purchase_order_id');
    if (kind !== undefined) {
      const b = await form(request);
      const decisionId = uuid(b, 'decision_id');
      await deps.db.decidePurchaseOrder(actor, {
        decisionId,
        facilityId: uuid(b, 'facility_id'),
        purchaseOrderId,
        kind,
        reason: text(b, 'reason', 500),
      });
      return ok({ decision_id: decisionId });
    }
    const b = await form(request, DOCUMENT_LIMIT);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.receivePurchaseOrder(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      purchaseOrderId,
      receivedAt: moment(b, 'received_at'),
      lines: receiptLines(b),
      // 0023 trims a note, then holds it to 64 characters; the edge only bounds its size,
      // so a padded note is not refused here that 0023 would take (found in review).
      deliveryNote: optionalText(b, 'delivery_note', 500),
    });
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const purchaseOrders = endpoint(['GET', 'POST'], shaped(dispatch));
