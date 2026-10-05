/**
 * The transfer-prices function: 0018's five runtime routes over HTTP (module 3, step 2).
 *
 *   GET   /transfer-prices                            erp.list_transfer_prices()
 *   GET   /transfer-prices/items/{item_id}            erp.item_transfer_prices()
 *   GET   /transfer-prices/items/{item_id}/history    erp.transfer_price_history()
 *   POST  /transfer-prices                            erp.set_transfer_price()
 *   POST  /transfer-prices/{price_id}/withdraw        erp.withdraw_transfer_price()
 *
 * As ./suppliers.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). An amount is a whole number and a moment
 *   names its offset; that an amount runs 0 to 10^11, that the currency is SAR, that a
 *   moment is not in the past, that a price changes something — every rule is 0018's,
 *   and its refusal comes back through ./refusal.ts.
 *
 *   THE FACILITY is a read's query parameter, checked by erp.assert_permitted() at that
 *   facility, which also limits what is read to the facility's brand (ADR-0012). Writes
 *   take none: 0018 gates them organisation-wide.
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through the item's price history.
 *
 * TWO THINGS OF ITS OWN, both about money and time:
 *
 *   AN AMOUNT IS A JSON NUMBER OF MINOR UNITS: 18500, never "185.00" or 185.5. A
 *   decimal would be rounded somewhere, and a string is one more thing to parse. The
 *   answer carries amounts the same way (./transfer-prices-db.ts, asMinor()).
 *
 *   A MOMENT NAMES ITS OFFSET: 2026-11-01T00:00:00+03:00, never 2026-11-01T00:00:00.
 *   Without one, PostgreSQL reads the moment in the session's time zone, which is UTC
 *   on Supabase, and a price meant for midnight in Riyadh would take effect at three in
 *   the morning (ADR-0027, question 5). Left out, the price takes effect now.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, noSuchRoute, ok, optionalText, routeOf, shaped, text, uuid, type Source,
} from './fields.ts';

/** A whole number of minor units, as a JSON number. Its range is the route's rule. */
function priceMinor(source: Source): number {
  const v = source['price_minor'];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Malformed('price_minor');
  return v;
}

/** An offset PostgreSQL accepts: within ±15:59. */
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-](0\d|1[0-5]):[0-5]\d)$/;

/**
 * An ISO 8601 moment with its offset, or null — absent or null — for now. The day must
 * exist: Date.parse() rolls 30 February over to 2 March, so the date is rebuilt and
 * compared. An impossible day or offset reached PostgreSQL and came back a 422 naming
 * no field, where it is a 400 naming this one (found in review).
 */
function effectiveFrom(source: Source): string | null {
  const v = source['effective_from'];
  if (v === undefined || v === null) return null;
  const m = typeof v === 'string' ? MOMENT.exec(v) : null;
  if (m === null) throw new Malformed('effective_from');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1 || day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) {
    throw new Malformed('effective_from');
  }
  return v as string;
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const prices = await deps.db.listTransferPrices(s.personId, {
    facilityId: facilityOf(request),
    search: optionalText(q, 'search', 100),
    afterCode: optionalText(q, 'after', 64),
    limit,
  });
  // Keyset paging by item code. A page holds `limit` items, each with every one of its
  // active packs, so a full page is told by its items, not its rows.
  const codes = [...new Set(prices.map((p) => p.code))];
  return ok({ prices, next_after: codes.length === limit ? codes[codes.length - 1]! : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'transfer-prices');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if ((path.length === 2 || (path.length === 3 && path[2] === 'history')) && path[0] === 'items') {
      const itemId = uuid({ item_id: path[1] }, 'item_id');
      if (path.length === 2) return ok({ prices: await deps.db.itemTransferPrices(actor, facilityOf(request), itemId) });
      return ok({ decisions: await deps.db.transferPriceHistory(actor, facilityOf(request), itemId) });
    }
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 0) {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.setTransferPrice(actor, {
      decisionId,
      priceId: uuid(b, 'price_id'),
      itemUnitId: uuid(b, 'item_unit_id'),
      priceMinor: priceMinor(b),
      currency: text(b, 'currency', 3),
      effectiveFrom: effectiveFrom(b),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 2 && path[0] !== 'items' && path[1] === 'withdraw') {
    const priceId = uuid({ price_id: path[0] }, 'price_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.withdrawTransferPrice(actor, { decisionId, priceId, reason: text(b, 'reason', 500) });
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const transferPrices = endpoint(['GET', 'POST'], shaped(dispatch));
