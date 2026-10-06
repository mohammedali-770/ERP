import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { Supplier, SuppliersDb } from '../suppliers-db.ts';
import { suppliers } from '../suppliers.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import { Refusal } from '../refusal.ts';
import type { StockDb } from '../stock-db.ts';
import type { NotificationsDb } from '../notifications-db.ts';
import { notUsed } from './not-used.ts';
import type { FacilitiesDb } from '../facilities-db.ts';

const TOKEN = 'cd'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACILITY = '01936f00-0000-7000-8000-000000000401';
const SUPPLIER = '01936f00-0000-7000-8000-000000005101';
const SUPPLY = '01936f00-0000-7000-8000-000000005201';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const UNIT = '01936f00-0000-7000-8000-000000004201';
const D1 = '01936f00-0000-7000-8000-0000000e0101';
const D2 = '01936f00-0000-7000-8000-0000000e0102';

const SUPPLIER_ROW: Supplier = {
  supplier_id: SUPPLIER, code: 'POULTRY', name_en: 'Al Waha Poultry', name_ar: 'دواجن الواحة',
  vat_number: '310000000000003', cr_number: '1010000001', payment_terms_days: 30, status: 'active',
  contact_person: null, phone: null, email: null, address: null, as_of_decision_id: D1,
};

type Call = { method: string; actor: string; args: unknown[] };

/** The items routes, which no suppliers request may reach. */
const itemsNotUsed = notUsed<ItemsDb>('items', {
  listItems: true, getItem: true, itemHistory: true, createItem: true, amendItem: true,
  changeItemStatus: true, addItemUnit: true, retireItemUnit: true, importItems: true,
});

/** The transfer-price routes, which no suppliers request may reach. */
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

/** A suppliers database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<SuppliersDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'listSuppliers') return [SUPPLIER_ROW];
    if (method === 'getSupplier') return { ...SUPPLIER_ROW, supplies: [] };
    if (method === 'supplierHistory') return [{ decision_id: D1, kind: 'supplier_created' }];
    if (method === 'itemSuppliers') return [{ supplier_item_id: SUPPLY, supplier_id: SUPPLIER, preferred: true }];
    if (method === 'importSuppliers') return { created: 1, amended: 0, unchanged: 0 };
    return undefined;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-05T20:00:00+00:00' };
  return {
    calls,
    signIn: async () => { throw new Error('not used'); },
    signOut: async () => { throw new Error('not used'); },
    resolveSession: async () => session,
    viewer: async () => { throw new Error('not used'); },
    ...itemsNotUsed,
    ...transferPricesNotUsed,
    ...facilitiesNotUsed,
    ...stockNotUsed,
    ...notificationsNotUsed,
    listSuppliers: record('listSuppliers'),
    getSupplier: record('getSupplier'),
    supplierHistory: record('supplierHistory'),
    itemSuppliers: record('itemSuppliers'),
    createSupplier: record('createSupplier'),
    amendSupplier: record('amendSupplier'),
    changeSupplierStatus: record('changeSupplierStatus'),
    setSupplierContact: record('setSupplierContact'),
    addSupplierItem: record('addSupplierItem'),
    amendSupplierItem: record('amendSupplierItem'),
    retireSupplierItem: record('retireSupplierItem'),
    importSuppliers: record('importSuppliers'),
  } as Db & { calls: Call[] };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/suppliers';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const CREATE = {
  decision_id: D1, supplier_id: SUPPLIER, code: 'poultry', name_en: 'Al Waha Poultry', name_ar: 'دواجن الواحة',
  vat_number: '310000000000003', cr_number: '1010000001', payment_terms_days: 30, reason: 'New supplier.',
};
const AMEND = {
  decision_id: D1, expected_decision_id: D2, name_en: 'Al Waha Poultry Co.', name_ar: 'شركة دواجن الواحة',
  vat_number: null, cr_number: '1010000001', payment_terms_days: 45, reason: 'Renamed.',
};
const CONTACT = {
  decision_id: D1, expected_decision_id: D2, contact_person: 'Duty desk', phone: '+966 55 000 0001',
  email: 'orders@example.test', address: null,
};
const SUPPLY_ADD = {
  decision_id: D1, supplier_item_id: SUPPLY, item_unit_id: UNIT, supplier_code: 'WP-10', preferred: true, reason: 'Sells cartons.',
};
const SUPPLY_AMEND = { decision_id: D1, expected_decision_id: D2, supplier_code: null, preferred: false, reason: 'Not preferred.' };

/** Every write route, with a body that is well formed. */
const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['createSupplier', '', CREATE],
  ['amendSupplier', `/${SUPPLIER}/amend`, AMEND],
  ['changeSupplierStatus', `/${SUPPLIER}/status`, { decision_id: D1, expected_decision_id: D2, status: 'retired', reason: 'Closed.' }],
  ['setSupplierContact', `/${SUPPLIER}/contact`, CONTACT],
  ['addSupplierItem', `/${SUPPLIER}/supplies`, SUPPLY_ADD],
  ['amendSupplierItem', `/supplies/${SUPPLY}/amend`, SUPPLY_AMEND],
  ['retireSupplierItem', `/supplies/${SUPPLY}/retire`, { decision_id: D1, reason: 'Pack discontinued.' }],
  ['importSuppliers', '/import', { reason: 'Opening list.', rows: [{ code: 'PACK' }] }],
];

// --- the actor ---------------------------------------------------------------

test('CONTROL: every supplier write acts as the signed-in person, whatever the request names', async () => {
  // A warehouse manager's token, and a body that names the administrator in every way it could.
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await suppliers(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every supplier read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [
    ['listSuppliers', ''], ['getSupplier', `/${SUPPLIER}`], ['supplierHistory', `/${SUPPLIER}/history`],
    ['itemSuppliers', `/items/${ITEM}`],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await suppliers(get(`${path}?facility_id=${FACILITY}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(FACILITY), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a suppliers route', async () => {
  for (const request of [get(''), get(`/items/${ITEM}`, {}), post('', CREATE, {}), post('/import', { reason: 'x', rows: [{}] }, {})]) {
    const db = fakeDb(null);
    const response = await suppliers(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    createSupplier: {
      decisionId: D1, supplierId: SUPPLIER, code: 'poultry', nameEn: 'Al Waha Poultry', nameAr: 'دواجن الواحة',
      vatNumber: '310000000000003', crNumber: '1010000001', paymentTermsDays: 30, reason: 'New supplier.',
    },
    amendSupplier: {
      decisionId: D1, supplierId: SUPPLIER, expectedDecisionId: D2, nameEn: 'Al Waha Poultry Co.', nameAr: 'شركة دواجن الواحة',
      vatNumber: null, crNumber: '1010000001', paymentTermsDays: 45, reason: 'Renamed.',
    },
    changeSupplierStatus: { decisionId: D1, supplierId: SUPPLIER, expectedDecisionId: D2, status: 'retired', reason: 'Closed.' },
    setSupplierContact: {
      decisionId: D1, supplierId: SUPPLIER, expectedDecisionId: D2, contactPerson: 'Duty desk', phone: '+966 55 000 0001',
      email: 'orders@example.test', address: null,
    },
    addSupplierItem: {
      decisionId: D1, supplierItemId: SUPPLY, supplierId: SUPPLIER, itemUnitId: UNIT, supplierCode: 'WP-10',
      preferred: true, reason: 'Sells cartons.',
    },
    amendSupplierItem: { decisionId: D1, supplierItemId: SUPPLY, expectedDecisionId: D2, supplierCode: null, preferred: false, reason: 'Not preferred.' },
    retireSupplierItem: { decisionId: D1, supplierItemId: SUPPLY, reason: 'Pack discontinued.' },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await suppliers(post(path, body), deps(db));
    if (method === 'importSuppliers') {
      assert.deepEqual(db.calls[0]!.args, ['Opening list.', [{ code: 'PACK' }]], method);
      assert.deepEqual(await response.json(), { status: 'ok', created: 1, amended: 0, unchanged: 0 });
      continue;
    }
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('a create may leave out its numbers; nothing else is optional', async () => {
  const db = fakeDb(ADMIN);
  const { vat_number: _v, cr_number: _c, ...bare } = CREATE;
  assert.equal((await suppliers(post('', bare), deps(db))).status, 200);
  const args = db.calls[0]!.args[0] as { vatNumber: unknown; crNumber: unknown };
  assert.deepEqual([args.vatNumber, args.crNumber], [null, null]);
  const add = fakeDb(ADMIN);
  const { supplier_code: _s, ...noCode } = SUPPLY_ADD;
  assert.equal((await suppliers(post(`/${SUPPLIER}/supplies`, noCode), deps(add))).status, 200);
  assert.equal((add.calls[0]!.args[0] as { supplierCode: unknown }).supplierCode, null);
});

test('the reads pass their ids and facility, and the list pages by code', async () => {
  const db = fakeDb(ADMIN);
  await suppliers(get(`/items/${ITEM}?facility_id=${FACILITY}`), deps(db));
  assert.deepEqual(db.calls[0], { method: 'itemSuppliers', actor: ADMIN, args: [FACILITY, ITEM] });
  const history = fakeDb(ADMIN);
  await suppliers(get(`/${SUPPLIER}/history`), deps(history));
  assert.deepEqual(history.calls[0], { method: 'supplierHistory', actor: ADMIN, args: [null, SUPPLIER] });
  const one = fakeDb(ADMIN);
  const got = await json(await suppliers(get(`/${SUPPLIER}`), deps(one)));
  assert.deepEqual(one.calls[0], { method: 'getSupplier', actor: ADMIN, args: [null, SUPPLIER] });
  assert.equal(got['supplier'].code, 'POULTRY');

  const paged = fakeDb(ADMIN, { listSuppliers: async () => [SUPPLIER_ROW, { ...SUPPLIER_ROW, code: 'PACK' }] });
  const response = await suppliers(get(`?facility_id=${FACILITY}&status=all&search=wa&after=A&limit=2`), deps(paged));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: FACILITY, status: null, search: 'wa', afterCode: 'A', limit: 2 }]);
  const body = await json(response);
  assert.equal(body['suppliers'].length, 2);
  assert.equal(body['next_after'], 'PACK', 'a full page names where the next one starts');
  const short = await json(await suppliers(get('?limit=5'), deps(fakeDb(ADMIN))));
  assert.equal(short['next_after'], null, 'a short page is the last');
  const defaults = fakeDb(ADMIN);
  await suppliers(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, status: 'active', search: null, afterCode: null, limit: 100 }]);
});

test('a path that is no route is 404 before any field is read, and there is no delete', async () => {
  for (const request of [
    get('/items'), get('/import'), get('/supplies'), get(`/supplies/${SUPPLY}`), get(`/${SUPPLIER}/supplies`),
    get(`/items/${ITEM}/history`), post(`/${SUPPLIER}/delete`, { decision_id: D1 }), post(`/supplies/${SUPPLY}`, {}),
    post(`/supplies/${SUPPLY}/status`, {}), post('/items/x/amend', {}), post('/import/amend', {}),
    post('/supplies/amend', {}), post(`/${SUPPLIER}`, CREATE),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await suppliers(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await suppliers(new Request(`${base}/${SUPPLIER}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete, here or in the database');
});

// --- shape -------------------------------------------------------------------

test('a malformed supplier field is a 400 naming it, and nothing reaches the database', async () => {
  const { phone: _p, ...noPhone } = CONTACT;
  const { vat_number: _v, ...noVat } = AMEND;
  const { supplier_code: _s, ...noCode } = SUPPLY_AMEND;
  const cases: Array<[Request, string]> = [
    [get('/not-a-uuid'), 'supplier_id'],
    [get('/items/not-a-uuid'), 'item_id'],
    [get('?facility_id=nope'), 'facility_id'],
    [get(`/${SUPPLIER}?facility_id=nope`), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?status=deleted'), 'status'],
    [post('', { ...CREATE, decision_id: 'x' }), 'decision_id'],
    [post('', { ...CREATE, code: 7 }), 'code'],
    [post('', { ...CREATE, name_ar: 'x'.repeat(201) }), 'name_ar'],
    // Terms are an integer, as a number: not text, not a fraction, not absent.
    [post('', { ...CREATE, payment_terms_days: '30' }), 'payment_terms_days'],
    [post('', { ...CREATE, payment_terms_days: 30.5 }), 'payment_terms_days'],
    [post('', { ...CREATE, payment_terms_days: null }), 'payment_terms_days'],
    [post('', { ...CREATE, payment_terms_days: 2 ** 31 }), 'payment_terms_days'],
    [post(`/${SUPPLIER}/status`, { decision_id: D1, expected_decision_id: D2, status: 'deleted', reason: 'r' }), 'status'],
    [post(`/${SUPPLIER}/amend`, { ...AMEND, expected_decision_id: undefined }), 'expected_decision_id'],
    // A field a write overwrites is stated, never cleared by being left out.
    [post(`/${SUPPLIER}/amend`, noVat), 'vat_number'],
    [post(`/${SUPPLIER}/contact`, noPhone), 'phone'],
    [post(`/supplies/${SUPPLY}/amend`, noCode), 'supplier_code'],
    // A contact change takes no reason: refused, not silently dropped (ADR-0026 §2).
    [post(`/${SUPPLIER}/contact`, { ...CONTACT, reason: 'New rep Khalid, 055 000 0001.' }), 'reason'],
    [post(`/${SUPPLIER}/contact`, { ...CONTACT, email: 'x'.repeat(321) }), 'email'],
    [post(`/${SUPPLIER}/supplies`, { ...SUPPLY_ADD, preferred: 'true' }), 'preferred'],
    [post(`/${SUPPLIER}/supplies`, { ...SUPPLY_ADD, preferred: undefined }), 'preferred'],
    [post(`/${SUPPLIER}/supplies`, { ...SUPPLY_ADD, item_unit_id: 'carton' }), 'item_unit_id'],
    [post(`/supplies/${SUPPLY}/amend`, { ...SUPPLY_AMEND, preferred: 1 }), 'preferred'],
    [post('/supplies/not-a-uuid/retire', { decision_id: D1, reason: 'r' }), 'supplier_item_id'],
    [post('/not-a-uuid/amend', AMEND), 'supplier_id'],
    [post('/import', { reason: 'r', rows: [] }), 'rows'],
    [post('/import', { reason: 'r', rows: [['a']] }), 'rows'],
    [post('/import', { rows: [{}] }), 'reason'],
    [post('', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await suppliers(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('terms outside 0–365 are the database\'s to refuse, not the edge\'s', async () => {
  for (const days of [-1, 366]) {
    const db = fakeDb(ADMIN);
    assert.equal((await suppliers(post('', { ...CREATE, payment_terms_days: days }), deps(db))).status, 200);
    assert.equal((db.calls[0]!.args[0] as { paymentTermsDays: number }).paymentTermsDays, days);
  }
});

test('a supplier import of the full 5000 rows fits; a form past 8 KiB is 413', async () => {
  const rows = Array.from({ length: 5000 }, (_, n) => ({
    line: String(n + 1), decision_id: D1, contact_decision_id: D2, supplier_id: SUPPLIER,
    code: `SUPPLIER-${String(n).padStart(5, '0')}`, name_en: `Imported supplier number ${n}`,
    name_ar: `مورد مستورد رقم ${n}`, vat_number: '310000000000003', cr_number: '1010000001', payment_terms_days: '30',
    contact_person: `Sales desk ${n}`, phone: '+966 55 000 0000', email: `sales${n}@example.test`,
    address: `Unit ${n}, Industrial Area, Riyadh`,
  }));
  assert.ok(JSON.stringify({ reason: 'r', rows }).length > 2 * 1024 * 1024, 'the file is a realistic size');
  const db = fakeDb(ADMIN);
  const response = await suppliers(post('/import', { reason: 'Opening list.', rows }), deps(db));
  assert.equal(response.status, 200);
  assert.equal((db.calls[0]!.args[1] as unknown[]).length, 5000);

  const form = await suppliers(post('', { ...CREATE, name_en: 'x'.repeat(9000) }), deps(db));
  assert.equal(form.status, 413);
  assert.deepEqual(await form.json(), { status: 'too_large', limit: 8 * 1024 });
  const file = await suppliers(post('/import', { reason: 'r', rows: [{ code: 'x'.repeat(8 * 1024 * 1024) }] }), deps(db));
  assert.equal(file.status, 413);
  assert.equal(db.calls.length, 1, 'neither reached the database');
});

// --- refusals ------------------------------------------------------------------

test('each kind of supplier refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, Refusal, number, string]> = [
    ['createSupplier', new Refusal('23505', 'decision is already recorded', 'supplier_decision_pkey', null, 'Read erp.supplier_history()'), 409, 'already_recorded'],
    ['createSupplier', new Refusal('23505', 'code POULTRY is already used', 'supplier_code_key', null, null), 409, 'conflict'],
    ['createSupplier', new Refusal('23001', 'capability procurement.suppliers is hidden for this scope (CAP-P02)', null, null, null), 403, 'forbidden'],
    ['createSupplier', new Refusal('23514', 'payment terms are 0 to 365 days', 'supplier_payment_terms_are_days', null, null), 422, 'invalid'],
    ['amendSupplier', new Refusal('23001', 'supplier POULTRY has changed since it was read', 'supplier_stale', null, null), 409, 'stale'],
    ['setSupplierContact', new Refusal('23001', 'supplier POULTRY has changed since it was read', 'supplier_stale', null, null), 409, 'stale'],
    ['amendSupplierItem', new Refusal('23001', 'supply has changed since it was read', 'supplier_item_stale', null, null), 409, 'stale'],
    ['addSupplierItem', new Refusal('23001', 'supplier OLD is retired', 'supplier_is_retired', null, null), 422, 'refused'],
    ['addSupplierItem', new Refusal('23505', 'supplier already sells this conversion', 'supplier_item_one_active', null, null), 409, 'conflict'],
    ['retireSupplierItem', new Refusal('23001', 'supply is already retired', 'supplier_item_already_retired', null, null), 422, 'refused'],
    ['amendSupplier', new Refusal('P0002', 'no supplier', 'supplier_exists', null, null), 404, 'not_found'],
    ['importSuppliers', new Refusal('22023', 'supplier import refused: 2 line(s) failed', 'supplier_import_refused', 'line 3: bad\nline 9: bad', null), 422, 'invalid'],
    ['importSuppliers', new Refusal('23505', 'decision is already recorded', 'supplier_decision_pkey', null, null), 409, 'already_recorded'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await suppliers(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.detail !== null) assert.equal(answer['detail'], refusal.detail, 'an import says which lines failed');
  }
});

test('CONTROL: only a route\'s own supplier retry check is answered as a retry', async () => {
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "supplier_decision_pkey"',
    'supplier_decision_pkey', 'Key (decision_id)=(…) already exists.', null, false);
  const response = await suppliers(post('', CREATE), deps(fakeDb(ADMIN, { createSupplier: async () => { throw native; } })));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'supplier_decision_pkey',
  }, 'a native collision is a conflict, in the edge\'s words, with no row printed');
});

test('a supplier read refused for want of permission is 403, not an error', async () => {
  const gate = new Refusal('23001', 'person may not read on capability procurement.suppliers here', null, null, null);
  const response = await suppliers(get(`/items/${ITEM}`), deps(fakeDb(MANAGER, { itemSuppliers: async () => { throw gate; } })));
  assert.equal(response.status, 403);
  assert.equal((await json(response))['status'], 'forbidden');
});
