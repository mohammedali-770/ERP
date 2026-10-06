/**
 * The stock function: 0020's six runtime routes over HTTP (module 5, step 2).
 *
 *   GET   /stock                                    erp.stock_on_hand()
 *   GET   /stock/items/{item_id}                    erp.stock_history()
 *   GET   /stock/decisions/{decision_id}            erp.get_stock_decision()
 *   POST  /stock/adjustments                        erp.record_stock_adjustment()
 *   POST  /stock/counts                             erp.record_stock_count()
 *   POST  /stock/decisions/{decision_id}/reverse    erp.reverse_stock_decision()
 *
 * As ./facilities.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). A quantity is decimal text, a moment names
 *   its offset, a line is an object; that a quantity is above nothing and exact, that a
 *   movement is not dated before a count, that stock does not go below zero, that a
 *   reversal comes before any count covers it — every rule is 0020's, and its refusal
 *   comes back through ./refusal.ts.
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through erp.get_stock_decision() at the
 *   same facility. A 404 there means the id was used at another facility: a collision,
 *   never a retry.
 *
 * TWO THINGS OF ITS OWN:
 *
 *   EVERY ROUTE NAMES ITS FACILITY. Stock is held at one (ADR-0029 D4), and these are the
 *   first routes whose WRITES are scoped to one: a write's body states `facility_id`, and
 *   0020 asks permission there. A read asks at the query's `facility_id`, as every read
 *   does; left out, 0020 refuses it (stock_facility_required) rather than mix every
 *   facility's stock.
 *
 *   A QUANTITY IS DECIMAL TEXT, as a factor and a coordinate are: "3.5", never the number
 *   3.5. It goes to a numeric column, and a float has no business on the way. Answers
 *   carry quantities the same way (./stock-db.ts).
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, moment, noSuchRoute, ok, optionalText, routeOf, shaped, text, uuid, type Source,
} from './fields.ts';
import type { StockLine } from './stock-db.ts';

/** Decimal text: digits, and a point with digits after it. How many of each is 0020's rule. */
const QUANTITY = /^\d{1,40}(\.\d{1,40})?$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stock write is a document of up to 500 lines, not a form: a line at its longest is
 * about 100 bytes, so a full count is about 50 KB, past the 8 KiB a form may be. 128 KiB
 * leaves room for a pretty-printed body and an Arabic reason.
 */
export const DOCUMENT_LIMIT = 128 * 1024;

/**
 * A document's lines: 1 to 500 objects, each naming a conversion by id, with a quantity
 * as decimal text and, on an adjustment, a direction. Only those three fields go on, so
 * nothing else a client puts on a line reaches the database. A malformed line names
 * itself: lines[2].quantity.
 */
function lines(source: Source): StockLine[] {
  const v = source['lines'];
  if (!Array.isArray(v) || v.length < 1 || v.length > 500) throw new Malformed('lines');
  return v.map((line: unknown, i: number) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) throw new Malformed(`lines[${i}]`);
    const l = line as Source;
    const itemUnitId = l['item_unit_id'];
    if (typeof itemUnitId !== 'string' || !UUID.test(itemUnitId)) throw new Malformed(`lines[${i}].item_unit_id`);
    const quantity = l['quantity'];
    if (typeof quantity !== 'string' || !QUANTITY.test(quantity)) throw new Malformed(`lines[${i}].quantity`);
    const direction = l['direction'];
    if (direction === undefined || direction === null) return { item_unit_id: itemUnitId, quantity };
    if (direction !== 'in' && direction !== 'out') throw new Malformed(`lines[${i}].direction`);
    return { item_unit_id: itemUnitId, quantity, direction };
  });
}

/** A history page ends before a seq: decimal text of a positive int8. */
function beforeSeq(query: Source): string | null {
  const v = query['before'];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) {
    throw new Malformed('before');
  }
  return v;
}

/** `negative=true` lists only what stands below zero; nothing else is a value. */
function negativeOnly(query: Source): boolean {
  const v = query['negative'];
  if (v === undefined || v === 'false') return false;
  if (v === 'true') return true;
  throw new Malformed('negative');
}

async function onHand(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const balances = await deps.db.stockOnHand(s.personId, {
    facilityId: facilityOf(request),
    search: optionalText(q, 'search', 100),
    afterCode: optionalText(q, 'after', 64),
    limit,
    negativeOnly: negativeOnly(q),
  });
  // Keyset paging: a full page may have a next one, which starts after its last code.
  return ok({ balances, next_after: balances.length === limit ? balances[balances.length - 1]!.code : null });
}

async function history(request: Request, s: Session, deps: Deps, itemId: string): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const decisions = await deps.db.stockHistory(s.personId, {
    facilityId: facilityOf(request), itemId, beforeSeq: beforeSeq(q), limit,
  });
  // Newest first: a full page may have an older one, which ends before its last seq.
  const last = decisions[decisions.length - 1];
  return ok({ decisions, next_before: decisions.length === limit && last !== undefined ? String(last['seq']) : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'stock');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return onHand(request, s, deps);
    if (path.length === 2 && path[0] === 'items') return history(request, s, deps, uuid({ item_id: path[1] }, 'item_id'));
    if (path.length === 2 && path[0] === 'decisions') {
      const decisionId = uuid({ decision_id: path[1] }, 'decision_id');
      return ok({ decision: await deps.db.getStockDecision(actor, facilityOf(request), decisionId) });
    }
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 1 && path[0] === 'adjustments') {
    const b = await form(request, DOCUMENT_LIMIT);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.recordStockAdjustment(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      kind: text(b, 'kind', 32),
      occurredAt: moment(b, 'occurred_at'),
      lines: lines(b),
      reason: text(b, 'reason', 500),
      overrideReason: optionalText(b, 'override_reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 1 && path[0] === 'counts') {
    const b = await form(request, DOCUMENT_LIMIT);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.recordStockCount(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      countedAt: moment(b, 'counted_at'),
      lines: lines(b),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 3 && path[0] === 'decisions' && path[2] === 'reverse') {
    const targetDecisionId = uuid({ target_decision_id: path[1] }, 'target_decision_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.reverseStockDecision(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      targetDecisionId,
      reason: text(b, 'reason', 500),
      overrideReason: optionalText(b, 'override_reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const stock = endpoint(['GET', 'POST'], shaped(dispatch));
