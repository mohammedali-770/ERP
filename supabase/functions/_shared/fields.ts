/**
 * The shape checks every module's function makes, in one copy.
 *
 * What is checked here is SHAPE only: an id is a UUID, text is text of a bounded length,
 * a status is one of two words, an import is a list of objects. Every rule — who may
 * act, whether the capability is open, codes, names, limits a record imposes — is the
 * database's, and its refusal comes back through ./refusal.ts. Checking a rule twice
 * would let the two copies disagree.
 *
 * A malformed field is a 400 naming the field, and a body past its limit is a 413, both
 * answered by shaped() before anything reaches the database. Lifted out of ./items.ts
 * when the suppliers function needed the same checks (module 2, step 2).
 */
import { readJsonBody, type Deps, type Reply } from './http.ts';
import { withSession, type Session } from './handlers.ts';
import type { Handler } from './http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A write's body is a form; an import's is a file of up to 5000 rows (0012, 0016). A
 * realistic item row is about 450 bytes, so 5000 of them are 2.2 MB, past the 2 MiB
 * first chosen (found in review); 8 MiB leaves room for descriptions and contacts.
 */
export const FORM_LIMIT = 8 * 1024;
export const IMPORT_LIMIT = 8 * 1024 * 1024;

export class TooLarge extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super('too large');
    this.limit = limit;
  }
}

export class Malformed extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`malformed ${field}`);
    this.field = field;
  }
}

export type Source = Readonly<Record<string, unknown>>;

export function uuid(source: Source, field: string): string {
  const v = source[field];
  if (typeof v !== 'string' || !UUID.test(v)) throw new Malformed(field);
  return v;
}

export function optionalUuid(source: Source, field: string): string | null {
  const v = source[field];
  if (v === undefined || v === null || v === '') return null;
  return uuid(source, field);
}

export function text(source: Source, field: string, max: number): string {
  const v = source[field];
  if (typeof v !== 'string' || v.length > max) throw new Malformed(field);
  return v;
}

export function optionalText(source: Source, field: string, max: number): string | null {
  const v = source[field];
  if (v === undefined || v === null) return null;
  return text(source, field, max);
}

export function status(source: Source): 'active' | 'retired' {
  const v = source['status'];
  if (v !== 'active' && v !== 'retired') throw new Malformed('status');
  return v;
}

/** A list's `status` filter: active (the default), retired, or all, which is null. */
export function listStatus(query: Source): 'active' | 'retired' | null {
  const wanted = query['status'] ?? 'active';
  if (wanted !== 'active' && wanted !== 'retired' && wanted !== 'all') throw new Malformed('status');
  return wanted === 'all' ? null : wanted;
}

/** A list's page size: 100 unless asked, at most 500, as the routes allow. */
export function listLimit(query: Source): number {
  const limit = query['limit'] === undefined ? 100 : Number(query['limit']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Malformed('limit');
  return limit;
}

/** The facility a read is asked at, from the query; null asks organisation-wide. */
export function facilityOf(request: Request): string | null {
  return optionalUuid(Object.fromEntries(new URL(request.url).searchParams), 'facility_id');
}

/** An import's rows: 1 to 5000 objects. What each holds is the database's to check. */
export function importRows(source: Source): Record<string, unknown>[] {
  const rows = source['rows'];
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5000
      || !rows.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
    throw new Malformed('rows');
  }
  return rows as Record<string, unknown>[];
}

export async function form(request: Request, limit = FORM_LIMIT): Promise<Source> {
  const body = await readJsonBody(request, limit);
  if (body.kind === 'too_large') throw new TooLarge(limit);
  if (body.kind === 'malformed') throw new Malformed('body');
  return body.value;
}

export const ok = (body: Record<string, unknown> = {}): Reply => ({ http: 200, body: { status: 'ok', ...body } });

export const noSuchRoute: Reply = { http: 404, body: { status: 'no_such_route' } };

/** The path after the function's own name: /functions/v1/items/a/b → ['a', 'b']. */
export function routeOf(request: Request, name: string): string[] {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const at = segments.indexOf(name);
  return at === -1 ? [] : segments.slice(at + 1);
}

/**
 * A router, signed in: withSession supplies the actor (ADR-0025), and a malformed field
 * or an oversized body is answered here, so nothing reaches the database.
 */
export function shaped(dispatch: (request: Request, s: Session, deps: Deps) => Promise<Reply>): Handler {
  return withSession(async (request, s, deps) => {
    try {
      return await dispatch(request, s, deps);
    } catch (error) {
      if (error instanceof Malformed) return { http: 400, body: { status: 'malformed', field: error.field } };
      if (error instanceof TooLarge) return { http: 413, body: { status: 'too_large', limit: error.limit } };
      throw error;
    }
  });
}
