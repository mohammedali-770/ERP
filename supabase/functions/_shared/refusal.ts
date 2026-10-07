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
 * What a refusal carries back depends on who raised it:
 *
 *   RAISED BY A ROUTE (plpgsql RAISE): its message, detail and hint, written for the
 *   person reading them, and its constraint name. They can name ids and codes the caller
 *   sent, and the capability a person may not use; never a credential, since no route
 *   that touches one raises with it.
 *
 *   RAISED BY POSTGRESQL ITSELF (a unique index, a CHECK, a NOT NULL): the constraint
 *   name, which the console can match, and a generic message. PostgreSQL's own words are
 *   not for people — "duplicate key value violates unique constraint", and a detail that
 *   prints the whole failing row, stamps and sequence numbers included (found in review).
 */
import type { Reply } from './http.ts';

/** The SQLSTATE classes the routes use to refuse. */
const REFUSAL = /^(22|23|P0002$)/;

export class Refusal extends Error {
  readonly sqlstate: string;
  readonly constraint: string | null;
  readonly detail: string | null;
  readonly hint: string | null;
  /** True when a route raised it with RAISE; false when PostgreSQL raised it itself. */
  readonly raised: boolean;

  constructor(sqlstate: string, message: string, constraint: string | null, detail: string | null, hint: string | null,
              raised = true) {
    super(message);
    this.name = 'Refusal';
    this.sqlstate = sqlstate;
    this.constraint = constraint;
    this.detail = detail;
    this.hint = hint;
    this.raised = raised;
  }
}

/**
 * The driver's error as a Refusal, or null when it is not one. Reads the fields
 * postgres.js puts on a PostgresError: `code`, `constraint_name`, `detail`, `hint`.
 */
export function asRefusal(error: unknown): Refusal | null {
  if (!(error instanceof Error)) return null;
  const e = error as Error & {
    code?: unknown; constraint_name?: unknown; detail?: unknown; hint?: unknown; routine?: unknown;
  };
  if (typeof e.code !== 'string' || !REFUSAL.test(e.code)) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  // exec_stmt_raise is the server routine behind plpgsql's RAISE: a route's own words.
  return new Refusal(e.code, e.message, text(e.constraint_name), text(e.detail), text(e.hint),
    e.routine === 'exec_stmt_raise');
}

/**
 * The answer a refusal gets:
 *
 *   409 already_recorded  23505 on a decision log's primary key — item_decision_pkey,
 *                         supplier_decision_pkey, transfer_price_decision_pkey,
 *                         facility_decision_pkey, stock_decision_pkey,
 *                         stock_minimum_decision_pkey — RAISED by that log's
 *                         assert_*_decision_is_new(), or re-raised whole by its import:
 *                         a retry of a write that already succeeded. The console reads the
 *                         record's history to confirm. The same constraint raised natively
 *                         is a conflict, not a retry: nothing was recorded (found in
 *                         review).
 *   409 conflict          any other 23505: a code or a name already taken, or a stock
 *                         decision already reversed (stock_already_reversed).
 *   409 stale             the form was loaded before someone else changed the record
 *                         (item_stale, supplier_stale, supplier_item_stale, facility_stale,
 *                         stock_minimum_stale).
 *   403 forbidden         23001 with no constraint: erp.assert_permitted() refused — the
 *                         capability is hidden or closed, or the person may not act here.
 *                         Every other 23001 a route reachable here raises names a
 *                         constraint. A future trigger raising restrict_violation without
 *                         one would be answered 403 too: name the constraint.
 *   422 refused           23001 naming a rule: the request breaks one (a retired item, a
 *                         fixed base unit, a final retirement, a price already in effect,
 *                         stock that would go below zero, a movement dated before a count).
 *   422 invalid           22xxx, 23502, 23503, 23514: the request is malformed or names
 *                         something that does not exist in a way a form can correct.
 *   404 not_found         P0002: no such item, conversion, facility or stock decision — or
 *                         one of another brand, or a stock decision at another facility,
 *                         which the routes answer exactly as a missing one.
 */
const GENERIC: Readonly<Record<string, string>> = {
  conflict: 'a value that must be unique is already in use',
  invalid: 'a value breaks a rule of the record',
  refused: 'the request breaks a rule of the record',
  not_found: 'no such record',
  forbidden: 'not permitted',
  stale: 'the record has changed since it was read',
  already_recorded: 'this decision is already recorded',
};

/** The logs whose route-raised 23505 is a retry. A module adds its log here. */
const DECISION_LOGS: ReadonlySet<string> = new Set([
  'item_decision_pkey', 'supplier_decision_pkey', 'transfer_price_decision_pkey', 'facility_decision_pkey',
  'stock_decision_pkey', 'stock_minimum_decision_pkey',
]);

/** The stamps an edit form sends back, whose 23001 means someone changed the record since. */
const STALE: ReadonlySet<string> = new Set([
  'item_stale', 'supplier_stale', 'supplier_item_stale', 'facility_stale', 'stock_minimum_stale',
]);

export function refusalReply(r: Refusal): Reply {
  const body = (status: string) => ({
    status,
    message: r.raised ? r.message : GENERIC[status]!,
    ...(r.constraint === null ? {} : { constraint: r.constraint }),
    ...(!r.raised || r.detail === null ? {} : { detail: r.detail }),
    ...(!r.raised || r.hint === null ? {} : { hint: r.hint }),
  });
  if (r.sqlstate === '23505') {
    const retry = r.raised && r.constraint !== null && DECISION_LOGS.has(r.constraint);
    return { http: 409, body: body(retry ? 'already_recorded' : 'conflict') };
  }
  if (r.sqlstate === '23001') {
    if (r.constraint === null) return { http: 403, body: body('forbidden') };
    if (STALE.has(r.constraint)) return { http: 409, body: body('stale') };
    return { http: 422, body: body('refused') };
  }
  if (r.sqlstate === 'P0002') return { http: 404, body: body('not_found') };
  return { http: 422, body: body('invalid') };
}
