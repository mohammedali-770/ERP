/**
 * The HTTP edge every function shares: origins, methods, the bearer token, and the one
 * place a handler's answer becomes a Response.
 *
 * Handlers return a `Reply` rather than a Response, so headers are added in exactly one
 * place and no handler can forget `no-store` on a response that carries a token.
 */
import type { Db } from './db.ts';

export interface Deps {
  readonly db: Db;
  /** Browser origins admitted, exactly as a browser sends them. Never `*` (ADR-0025). */
  readonly allowedOrigins: ReadonlySet<string>;
}

export interface Reply {
  readonly http: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export type Handler = (request: Request, deps: Deps) => Promise<Reply>;
export type Endpoint = (request: Request, deps: Deps) => Promise<Response>;

/** A token as `erp.sign_in()` issues it: 32 bytes, lowercase hex. */
const TOKEN = /^[0-9a-f]{64}$/;

/**
 * `ERP_ALLOWED_ORIGINS`, comma-separated. Each entry must be an exact origin — scheme,
 * host and port, nothing else — so a typo fails the function at start rather than
 * admitting something unintended. Unset or empty admits no browser at all; a caller that
 * sends no Origin header (a till's native shell, a test) is unaffected.
 */
export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let origin: string;
    try {
      origin = new URL(entry).origin;
    } catch {
      throw new Error(`ERP_ALLOWED_ORIGINS: "${entry}" is not an origin`);
    }
    if (origin !== entry || origin === 'null') {
      throw new Error(`ERP_ALLOWED_ORIGINS: "${entry}" is not an exact origin (expected "${origin}")`);
    }
    origins.add(origin);
  }
  return origins;
}

/**
 * The token from `Authorization: Bearer <token>`, or null. A value that is not shaped
 * like a token is null too, so it never reaches the database.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token !== undefined && TOKEN.test(token) ? token : null;
}

/** A JSON object body of at most `limit` bytes, or null. */
export async function readJsonObject(request: Request, limit = 1024): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length === 0 || text.length > limit) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Wraps a handler with what every endpoint needs, in this order:
 *
 *   1. an Origin that is sent and not allowed is refused, before anything else runs;
 *   2. a preflight is answered;
 *   3. a method the endpoint does not take is refused;
 *   4. the handler runs, and anything it throws becomes a 500 that says nothing about
 *      why. The cause is logged, never returned: it can name a table or a constraint.
 *
 * Every response is `no-store`: some carry a token, and none should be cached.
 */
export function endpoint(methods: readonly string[], handler: Handler): Endpoint {
  return async (request, deps) => {
    const origin = request.headers.get('origin');
    if (origin !== null && !deps.allowedOrigins.has(origin)) {
      return respond({ http: 403, body: { status: 'origin_refused' } }, null, methods);
    }
    if (request.method === 'OPTIONS') return respond(null, origin, methods);
    if (!methods.includes(request.method)) {
      return respond({ http: 405, body: { status: 'method_not_allowed' } }, origin, methods);
    }
    try {
      return respond(await handler(request, deps), origin, methods);
    } catch (error) {
      console.error(`edge: ${request.method} ${new URL(request.url).pathname} failed:`, describe(error));
      return respond({ http: 500, body: { status: 'error' } }, origin, methods);
    }
  };
}

/** The error's kind and message only — never a stack with arguments in it. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === 'string' ? ` ${code}` : ''}: ${error.message}`;
  }
  return typeof error;
}

function respond(reply: Reply | null, origin: string | null, methods: readonly string[]): Response {
  const headers = new Headers({ 'cache-control': 'no-store', vary: 'Origin' });
  if (origin !== null) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', [...methods, 'OPTIONS'].join(', '));
    headers.set('access-control-allow-headers', 'authorization, content-type');
    headers.set('access-control-max-age', '600');
  }
  if (reply === null) return new Response(null, { status: 204, headers });
  if (reply.http === 405) headers.set('allow', [...methods, 'OPTIONS'].join(', '));
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(reply.body), { status: reply.http, headers });
}
