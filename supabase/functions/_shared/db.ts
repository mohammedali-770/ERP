/**
 * What the edge layer asks the database, and the answers it accepts.
 *
 * The edge functions reach the ERP only through SECURITY DEFINER routes (ADR-0023), so
 * this interface is a list of routes, not a query builder. The one implementation that
 * talks to PostgreSQL is `../_deno/db.ts`; the tests here use a fake. Nothing in
 * `_shared/` imports a driver, so Node can typecheck and test every line of it.
 *
 * Every answer is checked on the way in. A route that answers a status this file does
 * not know is a migration and an edge out of step, and that is an error, not a
 * response to pass on.
 */
import type { ItemsDb } from './items-db.ts';

/** `erp.sign_in()`: `erp.verify_pin()`'s answer, plus a token on `ok` (0014). */
export type SignInAnswer =
  | { readonly status: 'ok'; readonly person_id: string; readonly token: string; readonly expires_at: string }
  | { readonly status: 'wrong'; readonly attempts_left?: number }
  | { readonly status: 'locked'; readonly locked_until: string }
  | { readonly status: 'disabled' };

/** `erp.resolve_session()`: who a token names now, or why it names nobody. */
export type SessionAnswer =
  | { readonly status: 'ok'; readonly person_id: string; readonly expires_at: string }
  | { readonly status: SessionRefusal };

export type SessionRefusal = 'invalid' | 'ended' | 'expired' | 'idle' | 'disabled';

/** `erp.sign_out()`. */
export type SignOutAnswer = { readonly status: 'ok' | 'invalid' };

export interface SessionDb {
  signIn(employeeNumber: string, pin: string): Promise<SignInAnswer>;
  resolveSession(token: string): Promise<SessionAnswer>;
  signOut(token: string): Promise<SignOutAnswer>;
}

/** Every route the edge may call: the session routes, and each module's. */
export type Db = SessionDb & ItemsDb;

/** Raised when the database answers something this edge does not understand. */
export class UnexpectedAnswer extends Error {
  constructor(route: string, value: unknown) {
    const status = isRecord(value) ? String(value['status']) : typeof value;
    super(`${route} answered an unknown shape (status: ${status})`);
    this.name = 'UnexpectedAnswer';
  }
}

const SESSION_REFUSALS: ReadonlySet<string> = new Set(['invalid', 'ended', 'expired', 'idle', 'disabled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function asSignInAnswer(value: unknown): SignInAnswer {
  if (isRecord(value)) {
    const { status } = value;
    if (status === 'ok' && isText(value['person_id']) && isText(value['token']) && isText(value['expires_at'])) {
      return { status, person_id: value['person_id'], token: value['token'], expires_at: value['expires_at'] };
    }
    if (status === 'wrong') {
      const left = value['attempts_left'];
      return typeof left === 'number' ? { status, attempts_left: left } : { status };
    }
    if (status === 'locked' && isText(value['locked_until'])) return { status, locked_until: value['locked_until'] };
    if (status === 'disabled') return { status };
  }
  throw new UnexpectedAnswer('erp.sign_in', value);
}

export function asSessionAnswer(value: unknown): SessionAnswer {
  if (isRecord(value)) {
    const { status } = value;
    if (status === 'ok' && isText(value['person_id']) && isText(value['expires_at'])) {
      return { status, person_id: value['person_id'], expires_at: value['expires_at'] };
    }
    if (typeof status === 'string' && SESSION_REFUSALS.has(status)) return { status: status as SessionRefusal };
  }
  throw new UnexpectedAnswer('erp.resolve_session', value);
}

export function asSignOutAnswer(value: unknown): SignOutAnswer {
  if (isRecord(value) && (value['status'] === 'ok' || value['status'] === 'invalid')) {
    return { status: value['status'] };
  }
  throw new UnexpectedAnswer('erp.sign_out', value);
}
