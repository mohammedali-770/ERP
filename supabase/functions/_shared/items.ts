/**
 * The items function: 0012's nine routes over HTTP (module 1, step 2).
 *
 *   GET   /items                              erp.list_items()
 *   GET   /items/{item_id}                    erp.get_item()
 *   GET   /items/{item_id}/history            erp.item_history()
 *   POST  /items                              erp.create_item()
 *   POST  /items/{item_id}/amend              erp.amend_item()
 *   POST  /items/{item_id}/status             erp.change_item_status()
 *   POST  /items/{item_id}/units              erp.add_item_unit()
 *   POST  /items/units/{item_unit_id}/retire  erp.retire_item_unit()
 *   POST  /items/import                       erp.import_items()
 *
 * Every route is wrapped in withSession, so the actor is the person the caller's token
 * resolves to and is passed to the database as its own argument (ADR-0025). No field of
 * any body or query is read as an actor.
 *
 * What is checked here is SHAPE only: ids are UUIDs, text is text of a bounded length, a
 * factor is a decimal. Every rule — who may act, whether the capability is open, codes,
 * names, conversions, staleness — is the database's, and its refusal comes back through
 * ./refusal.ts. Checking a rule twice would let the two copies disagree.
 *
 * THE FACILITY. Reads take `facility_id` from the query. It is not bound to the session:
 * erp.assert_permitted() checks the actor's role AT that facility, and a facility's reads
 * are limited to its brand (ADR-0012), so naming a facility grants nothing a role there
 * does not. Writes take none: 0012 gates them organisation-wide.
 *
 * THE DECISION IDS are minted by the console (I-1). A retried write is answered
 * 409 already_recorded, and the console confirms it through the item's history.
 */
import { endpoint, readJsonObject, type Handler, type Reply } from './http.ts';
import { withSession, type Session } from './handlers.ts';
import type { Deps } from './http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Up to six decimal places, as erp.item_unit.factor holds. */
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

/** A write's body is a form; an import's is a file of up to 5000 rows (0012). */
const FORM_LIMIT = 8 * 1024;
const IMPORT_LIMIT = 2 * 1024 * 1024;

class Malformed extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`malformed ${field}`);
    this.field = field;
  }
}

type Source = Readonly<Record<string, unknown>>;

function uuid(source: Source, field: string): string {
  const v = source[field];
  if (typeof v !== 'string' || !UUID.test(v)) throw new Malformed(field);
  return v;
}

function optionalUuid(source: Source, field: string): string | null {
  const v = source[field];
  if (v === undefined || v === null || v === '') return null;
  return uuid(source, field);
}

function text(source: Source, field: string, max: number): string {
  const v = source[field];
  if (typeof v !== 'string' || v.length > max) throw new Malformed(field);
  return v;
}

function optionalText(source: Source, field: string, max: number): string | null {
  const v = source[field];
  if (v === undefined || v === null) return null;
  return text(source, field, max);
}

function factor(source: Source): string | null {
  const v = source['factor'];
  if (v === undefined || v === null) return null;
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
  if (typeof s !== 'string' || !DECIMAL.test(s)) throw new Malformed('factor');
  return s;
}

function status(source: Source): 'active' | 'retired' {
  const v = source['status'];
  if (v !== 'active' && v !== 'retired') throw new Malformed('status');
  return v;
}

async function form(request: Request, limit = FORM_LIMIT): Promise<Source> {
  const body = await readJsonObject(request, limit);
  if (body === null) throw new Malformed('body');
  return body;
}

const ok = (body: Record<string, unknown> = {}): Reply => ({ http: 200, body: { status: 'ok', ...body } });

/** The path after the function's own name: /functions/v1/items/a/b → ['a', 'b']. */
function route(request: Request): string[] {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const at = segments.indexOf('items');
  return at === -1 ? [] : segments.slice(at + 1);
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const wanted = q['status'] ?? 'active';
  if (wanted !== 'active' && wanted !== 'retired' && wanted !== 'all') throw new Malformed('status');
  const limit = q['limit'] === undefined ? 100 : Number(q['limit']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Malformed('limit');
  const items = await deps.db.listItems(s.personId, {
    facilityId: optionalUuid(q, 'facility_id'),
    brandId: optionalUuid(q, 'brand_id'),
    status: wanted === 'all' ? null : wanted,
    itemKind: optionalText(q, 'item_kind', 32),
    search: optionalText(q, 'search', 100),
    afterCode: optionalText(q, 'after', 64),
    limit,
  });
  // Keyset paging: a full page may have a next one, which starts after its last code.
  return ok({ items, next_after: items.length === limit ? items[items.length - 1]!.code : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = route(request);
  const facility = () => optionalUuid(Object.fromEntries(new URL(request.url).searchParams), 'facility_id');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if (path.length === 1) {
      return ok({ item: await deps.db.getItem(actor, facility(), uuid({ item_id: path[0] }, 'item_id')) });
    }
    if (path.length === 2 && path[1] === 'history') {
      return ok({ decisions: await deps.db.itemHistory(actor, facility(), uuid({ item_id: path[0] }, 'item_id')) });
    }
    return noSuchRoute;
  }

  // POST
  if (path.length === 0) {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.createItem(actor, {
      decisionId,
      itemId: uuid(b, 'item_id'),
      baseUnitDecisionId: uuid(b, 'base_unit_decision_id'),
      baseItemUnitId: uuid(b, 'base_item_unit_id'),
      brandId: uuid(b, 'brand_id'),
      code: text(b, 'code', 64),
      itemKind: text(b, 'item_kind', 32),
      baseUnitKey: text(b, 'base_unit_key', 32),
      nameEn: text(b, 'name_en', 200),
      nameAr: text(b, 'name_ar', 200),
      descriptionEn: optionalText(b, 'description_en', 2000),
      descriptionAr: optionalText(b, 'description_ar', 2000),
      picturePath: optionalText(b, 'picture_path', 500),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 1 && path[0] === 'import') {
    const b = await form(request, IMPORT_LIMIT);
    const rows = b['rows'];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5000
        || !rows.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
      throw new Malformed('rows');
    }
    const { created, amended, unchanged } = await deps.db.importItems(actor, text(b, 'reason', 500), rows as Record<string, unknown>[]);
    return ok({ created, amended, unchanged });
  }
  if (path.length === 3 && path[0] === 'units' && path[2] === 'retire') {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.retireItemUnit(actor, {
      decisionId,
      itemUnitId: uuid({ item_unit_id: path[1] }, 'item_unit_id'),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  // The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 2 && ['amend', 'status', 'units'].includes(path[1]!) && path[0] !== 'units') {
    const itemId = uuid({ item_id: path[0] }, 'item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    switch (path[1]) {
      case 'amend':
        await deps.db.amendItem(actor, {
          decisionId,
          itemId,
          expectedDecisionId: uuid(b, 'expected_decision_id'),
          nameEn: text(b, 'name_en', 200),
          nameAr: text(b, 'name_ar', 200),
          descriptionEn: optionalText(b, 'description_en', 2000),
          descriptionAr: optionalText(b, 'description_ar', 2000),
          picturePath: optionalText(b, 'picture_path', 500),
          reason: text(b, 'reason', 500),
        });
        return ok({ decision_id: decisionId });
      case 'status':
        await deps.db.changeItemStatus(actor, {
          decisionId,
          itemId,
          expectedDecisionId: uuid(b, 'expected_decision_id'),
          status: status(b),
          reason: text(b, 'reason', 500),
        });
        return ok({ decision_id: decisionId });
      case 'units':
        await deps.db.addItemUnit(actor, {
          decisionId,
          itemUnitId: uuid(b, 'item_unit_id'),
          itemId,
          unitKey: text(b, 'unit_key', 32),
          factor: factor(b),
          reason: text(b, 'reason', 500),
        });
        return ok({ decision_id: decisionId });
    }
  }
  return noSuchRoute;
}

const noSuchRoute: Reply = { http: 404, body: { status: 'no_such_route' } };

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
const handler: Handler = withSession(async (request, s, deps) => {
  try {
    return await dispatch(request, s, deps);
  } catch (error) {
    if (error instanceof Malformed) return { http: 400, body: { status: 'malformed', field: error.field } };
    throw error;
  }
});

export const items = endpoint(['GET', 'POST'], handler);
