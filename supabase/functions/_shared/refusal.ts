/**
 * A database refusal, and the HTTP answer each kind of refusal gets.
 *
 * The ERP's write routes refuse by raising an SQLSTATE and, for every domain rule, a
 * named constraint (0012 names one for each). A refusal is an answer, not a failure: the
 * person at the till needs to read "the code ITM-001 is already used", not "error". So
 * the driver turns the refusal classes below into a `Refusal`, and `endpoint()` answers
 * it. Anything else — a broken connection, a missing function, a syntax error — stays an
 * error, is logged, and is answered 500 with nothing in it.
 *
 * What a refusal carries back: the database's message, written for the person reading it,
 * and its constraint name, which the console can match. The message can name ids and
 * codes the caller sent, and the capability a person may not use; it never carries a
 * credential, because no route that touches one raises with it.
 */
import type { Reply } from './http.ts';

/** The SQLSTATE classes the routes use to refuse. */
const REFUSAL = /^(22|23|P0002$)/;

export class Refusal extends Error {
  readonly sqlstate: string;
  readonly constraint: string | null;
  readonly detail: string | null;
  readonly hint: string | null;

  constructor(sqlstate: string, message: string, constraint: string | null, detail: string | null, hint: string | null) {
    super(message);
    this.name = 'Refusal';
    this.sqlstate = sqlstate;
    this.constraint = constraint;
    this.detail = detail;
    this.hint = hint;
  }
}

/**
 * The driver's error as a Refusal, or null when it is not one. Reads the fields
 * postgres.js puts on a PostgresError: `code`, `constraint_name`, `detail`, `hint`.
 */
export function asRefusal(error: unknown): Refusal | null {
  if (!(error instanceof Error)) return null;
  const e = error as Error & { code?: unknown; constraint_name?: unknown; detail?: unknown; hint?: unknown };
  if (typeof e.code !== 'string' || !REFUSAL.test(e.code)) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  return new Refusal(e.code, e.message, text(e.constraint_name), text(e.detail), text(e.hint));
}

/**
 * The answer a refusal gets:
 *
 *   409 already_recorded  23505 on item_decision_pkey: a retry of a write that already
 *                         succeeded. The console reads the item's history to confirm.
 *   409 conflict          any other 23505: a code or a name already taken.
 *   409 stale             the form was loaded before someone else changed the item.
 *   403 forbidden         23001 with no constraint: erp.assert_permitted() refused — the
 *                         capability is hidden or closed, or the person may not act here.
 *   422 refused           23001 naming a rule: the request breaks one (a retired item, a
 *                         fixed base unit, a final retirement).
 *   422 invalid           22xxx, 23502, 23503, 23514: the request is malformed or names
 *                         something that does not exist in a way a form can correct.
 *   404 not_found         P0002: no such item, conversion or facility — or one of another
 *                         brand, which the routes answer exactly as a missing one.
 */
export function refusalReply(r: Refusal): Reply {
  const body = (status: string) => ({
    status,
    message: r.message,
    ...(r.constraint === null ? {} : { constraint: r.constraint }),
    ...(r.detail === null ? {} : { detail: r.detail }),
    ...(r.hint === null ? {} : { hint: r.hint }),
  });
  if (r.sqlstate === '23505') {
    return { http: 409, body: body(r.constraint === 'item_decision_pkey' ? 'already_recorded' : 'conflict') };
  }
  if (r.sqlstate === '23001') {
    if (r.constraint === null) return { http: 403, body: body('forbidden') };
    if (r.constraint === 'item_stale') return { http: 409, body: body('stale') };
    return { http: 422, body: body('refused') };
  }
  if (r.sqlstate === 'P0002') return { http: 404, body: body('not_found') };
  return { http: 422, body: body('invalid') };
}
