import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { Item, ItemsDb } from '../items-db.ts';
import { items } from '../items.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { StockDb } from '../stock-db.ts';
import type { NotificationsDb } from '../notifications-db.ts';
import type { StockAlertsDb } from '../stock-alerts-db.ts';
import { notUsed } from './not-used.ts';
import { asRefusal, Refusal, refusalReply } from '../refusal.ts';
import type { FacilitiesDb } from '../facilities-db.ts';

const TOKEN = 'cd'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const CASHIER = '01936f00-0000-7000-8000-000000000901';
const FACILITY = '01936f00-0000-7000-8000-000000000401';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const UNIT = '01936f00-0000-7000-8000-000000004201';
const D1 = '01936f00-0000-7000-8000-0000000e0101';
const D2 = '01936f00-0000-7000-8000-0000000e0102';
const D3 = '01936f00-0000-7000-8000-0000000e0103';
const BRAND = '01936f00-0000-7000-8000-000000000201';

const ITEM_ROW: Item = {
  item_id: ITEM, brand_id: BRAND, code: 'RICE-01', item_kind: 'raw_ingredient', base_unit_key: 'kg',
  name_en: 'Rice', name_ar: 'أرز', description_en: null, description_ar: null, picture_path: null,
  status: 'active', as_of_decision_id: D1, units: [],
};

type Call = { method: string; actor: string; args: unknown[] };

/** The suppliers routes, which no items request may reach. */
const suppliersNotUsed = notUsed<SuppliersDb>('suppliers', {
  listSuppliers: true, getSupplier: true, supplierHistory: true, itemSuppliers: true, createSupplier: true,
  amendSupplier: true, changeSupplierStatus: true, setSupplierContact: true, addSupplierItem: true,
  amendSupplierItem: true, retireSupplierItem: true, importSuppliers: true,
});

/** The transfer-price routes, which no items request may reach. */
const transferPricesNotUsed = notUsed<TransferPricesDb>('transfer prices', {
  listTransferPrices: true, itemTransferPrices: true, transferPriceHistory: true, setTransferPrice: true,
  withdrawTransferPrice: true,
});

const facilitiesNotUsed = notUsed<FacilitiesDb>('facilities', {
  listFacilities: true, getFacility: true, facilityHistory: true, createFacility: true, amendFacility: true,
  setFacilityArea: true, changeFacilityStatus: true,
});

/** The stock routes, which these tests never reach either. */
const stockNotUsed = notUsed<StockDb>('stock', {
  stockOnHand: true, stockHistory: true, getStockDecision: true, recordStockAdjustment: true,
  recordStockCount: true, reverseStockDecision: true,
});
const notificationsNotUsed = notUsed<NotificationsDb>('notifications', {
  listNotifications: true, countUnreadNotifications: true, markNotificationsRead: true,
});
const stockAlertsNotUsed = notUsed<StockAlertsDb>('stock alerts', {
  stockMinimums: true, stockMinimumHistory: true, setStockMinimum: true, clearStockMinimum: true,
});

/** An items database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<ItemsDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'listItems') return [ITEM_ROW];
    if (method === 'getItem') return ITEM_ROW;
    if (method === 'itemHistory') return [{ decision_id: D1, kind: 'item_created' }];
    if (method === 'importItems') return { created: 1, amended: 0, unchanged: 0 };
    return undefined;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-04T20:00:00+00:00' };
  return {
    calls,
    signIn: async () => { throw new Error('not used'); },
    signOut: async () => { throw new Error('not used'); },
    resolveSession: async () => session,
    viewer: async () => { throw new Error('not used'); },
    ...suppliersNotUsed,
    ...transferPricesNotUsed,
    ...facilitiesNotUsed,
    ...stockNotUsed,
    ...notificationsNotUsed,
    ...stockAlertsNotUsed,
    listItems: record('listItems'),
    getItem: record('getItem'),
    itemHistory: record('itemHistory'),
    createItem: record('createItem'),
    amendItem: record('amendItem'),
    changeItemStatus: record('changeItemStatus'),
    addItemUnit: record('addItemUnit'),
    retireItemUnit: record('retireItemUnit'),
    importItems: record('importItems'),
  } as Db & { calls: Call[] };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/items';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const CREATE = {
  decision_id: D1, item_id: ITEM, base_unit_decision_id: D2, base_item_unit_id: UNIT,
  brand_id: BRAND, code: 'rice-01', item_kind: 'raw_ingredient', base_unit_key: 'kg',
  name_en: 'Rice', name_ar: 'أرز', description_en: null, description_ar: null, picture_path: null,
  reason: 'New item.',
};

/** Every write route, with a body that is well formed. */
const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['createItem', '', CREATE],
  ['amendItem', `/${ITEM}/amend`, { decision_id: D1, expected_decision_id: D2, name_en: 'Rice', name_ar: 'أرز', reason: 'Renamed.' }],
  ['changeItemStatus', `/${ITEM}/status`, { decision_id: D1, expected_decision_id: D2, status: 'retired', reason: 'Seasonal.' }],
  ['addItemUnit', `/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: '12', reason: 'Packs.' }],
  ['retireItemUnit', `/units/${UNIT}/retire`, { decision_id: D1, reason: 'Pack size changed.' }],
  ['importItems', '/import', { reason: 'Opening catalogue.', rows: [{ code: 'RICE-02' }] }],
];

// --- the actor ---------------------------------------------------------------

test('CONTROL: every write acts as the signed-in person, whatever the request names', async () => {
  // A cashier's token, and a body that names the administrator in every way it could.
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(CASHIER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await items(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, CASHIER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every read asks as the signed-in person', async () => {
  for (const path of ['', `/${ITEM}`, `/${ITEM}/history`]) {
    const db = fakeDb(CASHIER);
    const response = await items(get(`${path}?facility_id=${FACILITY}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.actor, CASHIER, path);
  }
});

test('without a session nothing reaches an items route', async () => {
  for (const request of [get(''), get('', {}), post('', CREATE, {}), post('/import', { reason: 'x', rows: [{}] }, {})]) {
    const db = fakeDb(null);
    const response = await items(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each route calls its database route with the request\'s fields', async () => {
  const db = fakeDb(ADMIN);
  await items(post('', CREATE), deps(db));
  assert.deepEqual(db.calls[0]!.args, [{
    decisionId: D1, itemId: ITEM, baseUnitDecisionId: D2, baseItemUnitId: UNIT, brandId: BRAND,
    code: 'rice-01', itemKind: 'raw_ingredient', baseUnitKey: 'kg', nameEn: 'Rice', nameAr: 'أرز',
    descriptionEn: null, descriptionAr: null, picturePath: null, reason: 'New item.',
  }]);

  const db2 = fakeDb(ADMIN);
  await items(post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: '12', reason: 'r' }), deps(db2));
  assert.deepEqual(db2.calls[0]!.args, [{ decisionId: D1, itemUnitId: UNIT, itemId: ITEM, unitKey: 'carton', factor: '12', reason: 'r' }]);

  const db3 = fakeDb(ADMIN);
  await items(post(`/units/${UNIT}/retire`, { decision_id: D3, reason: 'r' }), deps(db3));
  assert.deepEqual(db3.calls[0]!.args, [{ decisionId: D3, itemUnitId: UNIT, reason: 'r' }]);

  const db4 = fakeDb(ADMIN);
  await items(get(`/${ITEM}/history`), deps(db4));
  assert.deepEqual(db4.calls[0], { method: 'itemHistory', actor: ADMIN, args: [null, ITEM] });
});

test('a write answers with its decision id; a derived factor is passed as null, never 1', async () => {
  const db = fakeDb(ADMIN);
  const response = await items(post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'g', reason: 'r' }), deps(db));
  assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 });
  assert.equal((db.calls[0]!.args[0] as { factor: unknown }).factor, null);
});

test('the list takes its filters from the query and pages by code', async () => {
  const db = fakeDb(ADMIN, { listItems: async () => [ITEM_ROW, { ...ITEM_ROW, code: 'RICE-02' }] });
  const response = await items(get(`?facility_id=${FACILITY}&status=all&item_kind=packaging&search=ri&after=A&limit=2`), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls[0]!.args, [{
    facilityId: FACILITY, brandId: null, status: null, itemKind: 'packaging', search: 'ri', afterCode: 'A', limit: 2,
  }]);
  const body = await json(response);
  assert.equal(body['items'].length, 2);
  assert.equal(body['next_after'], 'RICE-02', 'a full page names where the next one starts');

  const partial = await items(get('?limit=5'), deps(fakeDb(ADMIN)));
  assert.equal((await json(partial))['next_after'], null, 'a short page is the last');
  const defaults = fakeDb(ADMIN);
  await items(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{
    facilityId: null, brandId: null, status: 'active', itemKind: null, search: null, afterCode: null, limit: 100,
  }]);
});

test('a path that is no route is 404, and a method the function does not take is 405', async () => {
  for (const request of [get(`/${ITEM}/units`), post(`/${ITEM}/delete`, { decision_id: D1 }), post(`/units/${UNIT}`, { decision_id: D1 })]) {
    const db = fakeDb(ADMIN);
    const response = await items(request, deps(db));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await items(new Request(`${base}/${ITEM}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete, here or in the database');
});

// --- shape -------------------------------------------------------------------

test('a malformed field is a 400 naming it, and nothing reaches the database', async () => {
  const cases: Array<[Request, string]> = [
    [get('/not-a-uuid'), 'item_id'],
    [get('?facility_id=nope'), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?limit=501'), 'limit'],
    [get('?status=deleted'), 'status'],
    [post('', { ...CREATE, decision_id: 'x' }), 'decision_id'],
    [post('', { ...CREATE, name_en: 'x'.repeat(201) }), 'name_en'],
    [post('', { ...CREATE, code: 7 }), 'code'],
    [post('', { ...CREATE, brand_id: null }), 'brand_id'],
    [post(`/${ITEM}/status`, { decision_id: D1, expected_decision_id: D2, status: 'deleted', reason: 'r' }), 'status'],
    [post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: '1e3', reason: 'r' }), 'factor'],
    [post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: '0.1234567', reason: 'r' }), 'factor'],
    [post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: '-2', reason: 'r' }), 'factor'],
    // A number is a binary float before it is read: 12.3456789999999999 would arrive as
    // 12.345679 and pass. Only text keeps every digit the person typed.
    [post(`/${ITEM}/units`, '{"decision_id":"' + D1 + '","item_unit_id":"' + UNIT + '","unit_key":"carton","factor":12.3456789999999999,"reason":"r"}'), 'factor'],
    [post(`/${ITEM}/units`, { decision_id: D1, item_unit_id: UNIT, unit_key: 'carton', factor: 12, reason: 'r' }), 'factor'],
    [post('', { ...CREATE, base_unit_decision_id: D1 }), 'base_unit_decision_id'],
    [post('/import', { reason: 'r', rows: [] }), 'rows'],
    [post('/import', { reason: 'r', rows: 'a,b' }), 'rows'],
    [post('/import', { reason: 'r', rows: [1, 2] }), 'rows'],
    [post('', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await items(request, deps(db));
    assert.equal(response.status, 400, field);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('an import of the full 5000 rows, each as large as a real one, fits', async () => {
  // Five ids, a code, a kind, a unit and bilingual names: about 450 bytes a row, 2.2 MB in
  // all, which the first limit of 2 MiB refused (found in review).
  const rows = Array.from({ length: 5000 }, (_, n) => ({
    line: String(n + 1), decision_id: D1, item_id: ITEM, base_unit_decision_id: D2, base_item_unit_id: UNIT,
    brand_id: BRAND, code: `B1-RAW-INGREDIENT-${String(n).padStart(5, '0')}`, item_kind: 'raw_ingredient',
    base_unit_key: 'kg', name_en: `Imported raw ingredient number ${n}`, name_ar: `مادة خام مستوردة رقم ${n}`,
  }));
  assert.ok(JSON.stringify({ reason: 'r', rows }).length > 2 * 1024 * 1024, 'the file is past the old limit');
  const db = fakeDb(ADMIN);
  const response = await items(post('/import', { reason: 'Opening catalogue.', rows }), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', created: 1, amended: 0, unchanged: 0 });
  assert.equal((db.calls[0]!.args[1] as unknown[]).length, 5000);
});

test('a body past its limit is 413 too_large, not malformed', async () => {
  const db = fakeDb(ADMIN);
  const form = await items(post('', { ...CREATE, description_en: 'x'.repeat(9000) }), deps(db));
  assert.equal(form.status, 413);
  assert.deepEqual(await form.json(), { status: 'too_large', limit: 8 * 1024 });
  const huge = 'x'.repeat(8 * 1024 * 1024);
  const file = await items(post('/import', { reason: 'r', rows: [{ code: huge }] }), deps(db));
  assert.equal(file.status, 413);
  assert.deepEqual(db.calls, []);
});

// --- refusals ------------------------------------------------------------------

test('each kind of refusal is answered as the person can act on it', async () => {
  const cases: Array<[Refusal, number, string]> = [
    [new Refusal('23505', 'decision is already recorded', 'item_decision_pkey', null, 'Read erp.item_history()'), 409, 'already_recorded'],
    [new Refusal('23505', 'code RICE-01 is already used', 'item_code_key', null, null), 409, 'conflict'],
    [new Refusal('23001', 'capability inventory.items is hidden for this scope (CAP-P02)', null, null, null), 403, 'forbidden'],
    [new Refusal('23001', 'item RICE-01 has changed since it was read', 'item_stale', null, null), 409, 'stale'],
    [new Refusal('23001', 'item RICE-01 is retired', 'item_is_retired', null, null), 422, 'refused'],
    [new Refusal('P0002', 'no item', 'item_exists', null, null), 404, 'not_found'],
    [new Refusal('22023', 'item import refused: 2 line(s) failed', 'item_import_refused', 'line 3: bad\nline 9: bad', null), 422, 'invalid'],
    [new Refusal('23514', 'names are bilingual', 'item_names_are_bilingual', null, null), 422, 'invalid'],
  ];
  for (const [refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { createItem: async () => { throw refusal; } });
    const response = await items(post('', CREATE), deps(db));
    assert.equal(response.status, http, refusal.message);
    const body = await json(response);
    assert.equal(body['status'], status);
    assert.equal(body['message'], refusal.message, 'the database\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(body['constraint'], refusal.constraint);
    if (refusal.detail !== null) assert.equal(body['detail'], refusal.detail, 'an import says which lines failed');
  }
});

test('PostgreSQL\'s own words never reach the person; the constraint does', async () => {
  // A unique index, not a route's RAISE: its message is PostgreSQL's and its detail
  // prints the failing row.
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "ux_item_active_name_en"',
    'ux_item_active_name_en', 'Key (brand_id, lower(name_en))=(…, rice) already exists.', null, false);
  const db = fakeDb(ADMIN, { createItem: async () => { throw native; } });
  const response = await items(post('', CREATE), deps(db));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'ux_item_active_name_en',
  });

  const row = new Refusal('23514', 'new row for relation "item" violates check constraint "item_description_is_bilingual"',
    'item_description_is_bilingual', 'Failing row contains (…, 2026-10-04 …).', null, false);
  const r2 = await items(post('', CREATE), deps(fakeDb(ADMIN, { createItem: async () => { throw row; } })));
  const b2 = await json(r2);
  assert.equal(b2['detail'], undefined, 'a failing row is never printed');
  assert.equal(b2['constraint'], 'item_description_is_bilingual');
});

test('CONTROL: only a route\'s own retry check is answered as a retry', async () => {
  // The base unit's decision inserted under an id already used fails natively on the same
  // constraint, and nothing was recorded: that is a conflict, not a retry.
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "item_decision_pkey"',
    'item_decision_pkey', null, null, false);
  const response = await items(post('', CREATE), deps(fakeDb(ADMIN, { createItem: async () => { throw native; } })));
  assert.equal((await json(response))['status'], 'conflict');
});

test('a failure that is not a refusal is a 500 that says nothing', async () => {
  const db = fakeDb(ADMIN, { createItem: async () => { throw new Error('function erp.create_item(...) does not exist'); } });
  const original = console.error;
  console.error = () => {};
  try {
    const response = await items(post('', CREATE), deps(db));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { status: 'error' });
  } finally {
    console.error = original;
  }
});

test('only the refusal classes become refusals', () => {
  const pg = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`pg ${code}`), { code, ...extra });
  const r = asRefusal(pg('23505', { constraint_name: 'item_code_key', detail: 'd', hint: '', routine: 'exec_stmt_raise' }));
  assert.ok(r instanceof Refusal);
  assert.equal(r.raised, true, 'raised by a route');
  assert.equal(asRefusal(pg('23505', { routine: '_bt_check_unique' }))?.raised, false, 'raised by PostgreSQL');
  assert.equal(r.constraint, 'item_code_key');
  assert.equal(r.detail, 'd');
  assert.equal(r.hint, null, 'an empty hint is no hint');
  assert.ok(asRefusal(pg('P0002')) instanceof Refusal);
  assert.ok(asRefusal(pg('22P02')) instanceof Refusal);
  // Not refusals: a missing function, a broken connection, permission denied (a grant
  // missing is a defect, not an answer), an error with no code.
  for (const code of ['42883', '08006', '42501', 'P0001', '40001']) assert.equal(asRefusal(pg(code)), null, code);
  assert.equal(asRefusal(new Error('no code')), null);
  assert.equal(asRefusal('a string'), null);
  assert.deepEqual(refusalReply(new Refusal('23001', 'm', null, null, null)).http, 403);
});
