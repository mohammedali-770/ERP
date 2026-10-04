/**
 * Sign-in, the session, and sign-out (ADR-0025) — and `withSession`, which every later
 * function's handler is wrapped in.
 *
 * THE ACTOR. Every route that records a decision takes an actor id, and the database
 * trusts it: it asks whether that person may act, not whether that person is the one
 * calling (ADR-0022, "What this does not decide"). This file closes that gap. A handler
 * wrapped in `withSession` receives the person `erp.resolve_session()` resolved from the
 * caller's token, and nothing else; a request body cannot name anyone. A handler that
 * passes `session.personId` as the actor is therefore passing the person who signed in.
 */
import type { SignInAnswer } from './db.ts';
import { bearerToken, endpoint, readJsonObject, type Deps, type Handler, type Reply } from './http.ts';

/** Who is calling, as the database resolved it. Frozen: a handler cannot swap it. */
export interface Session {
  readonly personId: string;
  readonly expiresAt: string;
}

export type SessionHandler = (request: Request, session: Session, deps: Deps) => Promise<Reply>;

/**
 * Resolves the caller's token, and runs the handler only for an open session. A missing
 * or malformed token is refused without a database call; one the database refuses is
 * answered with the database's reason, so a till can tell "signed out after 30 minutes
 * idle" from "your account is disabled".
 */
export function withSession(handler: SessionHandler): Handler {
  return async (request, deps) => {
    const token = bearerToken(request);
    if (token === null) return { http: 401, body: { status: 'unauthenticated' } };
    const answer = await deps.db.resolveSession(token);
    if (answer.status !== 'ok') return { http: 401, body: { status: answer.status } };
    const session: Session = Object.freeze({ personId: answer.person_id, expiresAt: answer.expires_at });
    return handler(request, session, deps);
  };
}

/** HTTP status for each sign-in answer. */
const SIGN_IN_HTTP: Readonly<Record<SignInAnswer['status'], number>> = {
  ok: 200,
  wrong: 401,
  disabled: 403,
  locked: 423,
};

/**
 * POST `{ employee_number, pin }`.
 *
 * Only the SHAPE is checked here — two short strings. Their format (IAM-P01, IAM-P04) is
 * checked by the database, which records every attempt it is shown (IAM-008); refusing a
 * malformed number here would answer it without recording it. The answer is the
 * database's, unchanged, so an unknown number and a wrong PIN stay indistinguishable
 * (IAM-P02).
 */
export const signIn = endpoint(['POST'], async (request, deps) => {
  const body = await readJsonObject(request);
  const number = body?.['employee_number'];
  const pin = body?.['pin'];
  if (typeof number !== 'string' || typeof pin !== 'string' || number.length > 32 || pin.length > 32) {
    return { http: 400, body: { status: 'malformed' } };
  }
  const answer = await deps.db.signIn(number, pin);
  return { http: SIGN_IN_HTTP[answer.status], body: answer };
});

/** GET: who the caller's token names, and when the session ends. */
export const session = endpoint(['GET'], withSession(async (_request, s) => ({
  http: 200,
  body: { status: 'ok', person_id: s.personId, expires_at: s.expiresAt },
})));

/** POST: ends the session the caller's token names. */
export const signOut = endpoint(['POST'], async (request, deps) => {
  const token = bearerToken(request);
  if (token === null) return { http: 401, body: { status: 'unauthenticated' } };
  const answer = await deps.db.signOut(token);
  return { http: answer.status === 'ok' ? 200 : 401, body: { status: answer.status } };
});
