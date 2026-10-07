/**
 * The stock-alerts function: 0022's four runtime routes over HTTP (module 7, step 2).
 *
 *   GET   /stock-alerts                             erp.stock_minimums()
 *   GET   /stock-alerts/items/{item_id}             erp.stock_minimum_history()
 *   POST  /stock-alerts/minimums                    erp.set_stock_minimum()
 *   POST  /stock-alerts/items/{item_id}/clear       erp.clear_stock_minimum()
 *
 * As ./stock.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). A quantity is decimal text; that it is above
 *   nothing, exact in the base unit and within range, that the pack is current and of the
 *   facility's brand, that the facility holds stock — every rule is 0022's, and its
 *   refusal comes back through ./refusal.ts.
 *
 *   EVERY ROUTE NAMES ITS FACILITY, as stock's do: a minimum is held at one (A1). A write's
 *   body states `facility_id`; a read asks at the query's, and left out, 0022 refuses it.
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through the item's history at the same
 *   facility.
 *
 * ONE THING OF ITS OWN:
 *
 *   THE STAMP IS STATED. A set names `expected_decision_id`: the minimum's stamp the person
 *   read, or null when the item had none there. Left out, it is a 400, not read as "none":
 *   a form that never read the minimum must not pass for one that read its absence. A clear
 *   names a stamp, always, since there is a minimum to clear. An item cleared is named in
 *   the path, as a reversal's target is, so the body cannot name another.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, noSuchRoute, ok, optionalText, optionalUuid, routeOf, shaped, text, uuid,
  type Source,
} from './fields.ts';

/** Decimal text, as ./stock.ts's: digits, and a point with digits after it. How many is 0022's rule. */
const QUANTITY = /^\d{1,40}(\.\d{1,40})?$/;

function quantity(source: Source): string {
  const v = source['quantity'];
  if (typeof v !== 'string' || !QUANTITY.test(v)) throw new Malformed('quantity');
  return v;
}

/** A stamp the form read: present, and a UUID or null. Absent is malformed, never "none". */
function statedStamp(source: Source): string | null {
  if (!Object.hasOwn(source, 'expected_decision_id')) throw new Malformed('expected_decision_id');
  return optionalUuid(source, 'expected_decision_id');
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

/** `low=true` lists only what stands at or below its minimum; nothing else is a value. */
function lowOnly(query: Source): boolean {
  const v = query['low'];
  if (v === undefined || v === 'false') return false;
  if (v === 'true') return true;
  throw new Malformed('low');
}

async function minimums(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const rows = await deps.db.stockMinimums(s.personId, {
    facilityId: facilityOf(request),
    lowOnly: lowOnly(q),
    afterCode: optionalText(q, 'after', 64),
    limit,
  });
  // Keyset paging: a full page may have a next one, which starts after its last code.
  return ok({ minimums: rows, next_after: rows.length === limit ? rows[rows.length - 1]!.code : null });
}

async function history(request: Request, s: Session, deps: Deps, itemId: string): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const decisions = await deps.db.stockMinimumHistory(s.personId, {
    facilityId: facilityOf(request), itemId, beforeSeq: beforeSeq(q), limit,
  });
  // Newest first: a full page may have an older one, which ends before its last seq.
  const last = decisions[decisions.length - 1];
  return ok({ decisions, next_before: decisions.length === limit && last !== undefined ? String(last['seq']) : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'stock-alerts');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return minimums(request, s, deps);
    if (path.length === 2 && path[0] === 'items') return history(request, s, deps, uuid({ item_id: path[1] }, 'item_id'));
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 1 && path[0] === 'minimums') {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.setStockMinimum(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      itemUnitId: uuid(b, 'item_unit_id'),
      quantity: quantity(b),
      expectedDecisionId: statedStamp(b),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 3 && path[0] === 'items' && path[2] === 'clear') {
    const itemId = uuid({ item_id: path[1] }, 'item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.clearStockMinimum(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      itemId,
      expectedDecisionId: uuid(b, 'expected_decision_id'),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const stockAlerts = endpoint(['GET', 'POST'], shaped(dispatch));
