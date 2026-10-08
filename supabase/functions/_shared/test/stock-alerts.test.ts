import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { FacilitiesDb } from '../facilities-db.ts';
import type { StockDb } from '../stock-db.ts';
import type { NotificationsDb } from '../notifications-db.ts';
import type { StockAlertsDb, StockMinimum } from '../stock-alerts-db.ts';
import type { PurchaseOrdersDb } from '../purchase-orders-db.ts';
import type { OrderingSetupDb } from '../ordering-setup-db.ts';
import { stockAlerts } from '../stock-alerts.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'ef'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const ITEM = '01936f00-0000-7000-8000-000000000501';
const CARTON = '01936f00-0000-7000-8000-000000000602';
const STAMP = '01936f00-0000-7000-8000-000000005801';
const D1 = '01936f00-0000-7000-8000-0000000f0201';

const ROW: StockMinimum = {
  item_id: ITEM, code: 'ITM-001', item_kind: 'raw_ingredient', base_unit_key: 'kg', name_en: 'Chicken', name_ar: 'دجاج',
  item_status: 'active', minimum: '100', on_hand: '91.5', is_low: true, as_of_decision_id: STAMP,
  item_unit_id: CARTON, unit_key: 'carton', factor: '10', quantity: '10', decided_at: '2026-09-26T08:00:00.000Z',
};

type Call = { method: string; actor: string; args: unknown[] };

const itemsNotUsed = notUsed<ItemsDb>('items', {
  listItems: true, getItem: true, itemHistory: true, createItem: true, amendItem: true,
  changeItemStatus: true, addItemUnit: true, retireItemUnit: true, importItems: true,
});
const suppliersNotUsed = notUsed<SuppliersDb>('suppliers', {
  listSuppliers: true, getSupplier: true, supplierHistory: true, itemSuppliers: true, createSupplier: true,
  amendSupplier: true, changeSupplierStatus: true, setSupplierContact: true, addSupplierItem: true,
  amendSupplierItem: true, retireSupplierItem: true, importSuppliers: true,
});
const transferPricesNotUsed = notUsed<TransferPricesDb>('transfer prices', {
  listTransferPrices: true, itemTransferPrices: true, transferPriceHistory: true, setTransferPrice: true,
  withdrawTransferPrice: true,
});
const facilitiesNotUsed = notUsed<FacilitiesDb>('facilities', {
  listFacilities: true, getFacility: true, facilityHistory: true, createFacility: true, amendFacility: true,
  setFacilityArea: true, changeFacilityStatus: true,
});
const stockNotUsed = notUsed<StockDb>('stock', {
  stockOnHand: true, stockHistory: true, getStockDecision: true, recordStockAdjustment: true, recordStockCount: true,
  reverseStockDecision: true,
});
const notificationsNotUsed = notUsed<NotificationsDb>('notifications', {
  listNotifications: true, countUnreadNotifications: true, markNotificationsRead: true,
});
const purchaseOrdersNotUsed = notUsed<PurchaseOrdersDb>('purchase orders', {
  purchaseOrders: true, getPurchaseOrder: true, purchaseLimitHistory: true, raisePurchaseOrder: true,
  decidePurchaseOrder: true, receivePurchaseOrder: true, reversePurchaseReceipt: true, setPurchaseLimit: true,
  clearPurchaseLimit: true,
});
const orderingSetupNotUsed = notUsed<OrderingSetupDb>('ordering setup', {
  replenishmentSources: true, replenishmentSourceHistory: true, orderCutoffs: true, orderCutoffHistory: true,
  parLevels: true, parLevelHistory: true, setReplenishmentSource: true, clearReplenishmentSource: true,
  setOrderCutoff: true, clearOrderCutoff: true, setParLevel: true, clearParLevel: true,
});

/** A stock-alerts database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<StockAlertsDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: keyof StockAlertsDb) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'stockMinimums') return [ROW];
    if (method === 'stockMinimumHistory') return [{ decision_id: STAMP, seq: '3', kind: 'minimum_set', minimum: '100', is_current: true }];
    return undefined;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-07T20:00:00+00:00' };
  return {
    calls,
    signIn: async () => { throw new Error('not used'); },
    signOut: async () => { throw new Error('not used'); },
    resolveSession: async () => session,
    viewer: async () => { throw new Error('not used'); },
    ...itemsNotUsed,
    ...suppliersNotUsed,
    ...transferPricesNotUsed,
    ...facilitiesNotUsed,
    ...stockNotUsed,
    ...notificationsNotUsed,
    ...purchaseOrdersNotUsed,
    ...orderingSetupNotUsed,
    stockMinimums: record('stockMinimums') as StockAlertsDb['stockMinimums'],
    stockMinimumHistory: record('stockMinimumHistory') as StockAlertsDb['stockMinimumHistory'],
    setStockMinimum: record('setStockMinimum') as StockAlertsDb['setStockMinimum'],
    clearStockMinimum: record('clearStockMinimum') as StockAlertsDb['clearStockMinimum'],
  };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/stock-alerts';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const SET = {
  decision_id: D1, facility_id: WAREHOUSE, item_unit_id: CARTON, quantity: '2.5', expected_decision_id: STAMP,
  reason: 'Two days of orders.',
};
const CLEAR = { decision_id: D1, facility_id: WAREHOUSE, expected_decision_id: STAMP, reason: 'Ordered weekly now.' };

const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['setStockMinimum', '/minimums', SET],
  ['clearStockMinimum', `/items/${ITEM}/clear`, CLEAR],
];

const without = (body: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));

// --- the actor ---------------------------------------------------------------

test('CONTROL: every stock-alerts write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await stockAlerts(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every stock-alerts read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [['stockMinimums', ''], ['stockMinimumHistory', `/items/${ITEM}`]] as const) {
    const db = fakeDb(MANAGER);
    const response = await stockAlerts(get(`${path}?facility_id=${WAREHOUSE}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(WAREHOUSE), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a stock-alerts route', async () => {
  for (const request of [get('', {}), get(`/items/${ITEM}`, {}), ...WRITES.map(([, path, body]) => post(path, body, {}))]) {
    const db = fakeDb(null);
    const response = await stockAlerts(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    setStockMinimum: {
      decisionId: D1, facilityId: WAREHOUSE, itemUnitId: CARTON, quantity: '2.5', expectedDecisionId: STAMP,
      reason: 'Two days of orders.',
    },
    clearStockMinimum: {
      decisionId: D1, facilityId: WAREHOUSE, itemId: ITEM, expectedDecisionId: STAMP, reason: 'Ordered weekly now.',
    },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await stockAlerts(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('a first minimum states that the form read none: null, sent as null', async () => {
  const db = fakeDb(ADMIN);
  assert.equal((await stockAlerts(post('/minimums', { ...SET, expected_decision_id: null }), deps(db))).status, 200);
  assert.equal((db.calls[0]!.args[0] as { expectedDecisionId: unknown }).expectedDecisionId, null);
});

test('CONTROL: a stamp left out is malformed, never read as "the item had none"', async () => {
  const db = fakeDb(ADMIN);
  const response = await stockAlerts(post('/minimums', without(SET, 'expected_decision_id')), deps(db));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: 'malformed', field: 'expected_decision_id' });
  assert.deepEqual(db.calls, []);
});

test('the item cleared is the one the path names, whatever the body says', async () => {
  const db = fakeDb(ADMIN);
  const response = await stockAlerts(post(`/items/${ITEM}/clear`, { ...CLEAR, item_id: CARTON }), deps(db));
  assert.equal(response.status, 200);
  assert.equal((db.calls[0]!.args[0] as { itemId: string }).itemId, ITEM);
});

test('a quantity travels as the decimal text it was sent, never as a float', async () => {
  // Past 0022's twelve digits and six places, or none at all, is still text here, and 0022's to refuse.
  for (const q of ['0.1', '0.29', '2.5', '0', '999999999999.999999', '1234567890123.1234567', '007']) {
    const db = fakeDb(ADMIN);
    const response = await stockAlerts(post('/minimums', { ...SET, quantity: q }), deps(db));
    assert.equal(response.status, 200, q);
    assert.equal((db.calls[0]!.args[0] as { quantity: unknown }).quantity, q);
  }
  // And the answer carries them as the database gave them: text.
  const answer = await json(await stockAlerts(get(`?facility_id=${WAREHOUSE}`), deps(fakeDb(ADMIN))));
  const row = answer['minimums'][0];
  assert.deepEqual([row.minimum, row.on_hand, row.factor, row.quantity, row.is_low], ['100', '91.5', '10', '10', true]);
});

test('the reads pass their ids and facility, and page by code and by seq', async () => {
  const rows = [ROW, { ...ROW, item_id: CARTON, code: 'ITM-002' }];
  const paged = fakeDb(ADMIN, { stockMinimums: async () => rows });
  const page = await json(await stockAlerts(get(`?facility_id=${WAREHOUSE}&low=true&after=A&limit=2`), deps(paged)));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: WAREHOUSE, lowOnly: true, afterCode: 'A', limit: 2 }]);
  assert.equal(page['minimums'].length, 2);
  assert.equal(page['next_after'], 'ITM-002', 'a full page names where the next one starts');
  const short = await json(await stockAlerts(get(`?facility_id=${WAREHOUSE}&limit=3`),
    deps(fakeDb(ADMIN, { stockMinimums: async () => rows }))));
  assert.equal(short['next_after'], null, 'CONTROL: a short page has no next one');

  const defaults = fakeDb(ADMIN);
  await stockAlerts(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, lowOnly: false, afterCode: null, limit: 100 }],
    'with no facility the edge asks with none, and 0022 refuses it');
  const notLow = fakeDb(ADMIN);
  await stockAlerts(get(`?facility_id=${WAREHOUSE}&low=false`), deps(notLow));
  assert.equal((notLow.calls[0]!.args[0] as { lowOnly: boolean }).lowOnly, false);

  const history = fakeDb(ADMIN);
  const h = await json(await stockAlerts(get(`/items/${ITEM}?facility_id=${WAREHOUSE}&before=12&limit=1`), deps(history)));
  assert.deepEqual(history.calls[0]!.args, [{ facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: '12', limit: 1 }]);
  assert.equal(h['decisions'][0].is_current, true);
  assert.equal(h['next_before'], '3', 'a full page names the seq the next one ends before');
  const first = fakeDb(ADMIN);
  const f = await json(await stockAlerts(get(`/items/${ITEM}?facility_id=${WAREHOUSE}`), deps(first)));
  assert.deepEqual(first.calls[0]!.args, [{ facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: null, limit: 100 }]);
  assert.equal(f['next_before'], null, 'CONTROL: a short page has no older one');
});

test('a path that is no route is 404 before any field is read, and nothing is deleted', async () => {
  for (const request of [
    get('/items'), get(`/items/${ITEM}/clear`), get('/minimums'), get(`/items/${ITEM}/x`),
    post('', SET), post(`/minimums/${STAMP}`, SET), post(`/items/${ITEM}`, CLEAR), post(`/items/${ITEM}/set`, SET),
    post(`/items/${ITEM}/clear/x`, CLEAR), post('/clear', CLEAR), post('/items', SET),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await stockAlerts(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await stockAlerts(new Request(`${base}/items/${ITEM}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete: a minimum is cleared, by a decision');
});

// --- shape -------------------------------------------------------------------

test('a malformed stock-alerts field is a 400 naming it, and nothing reaches the database', async () => {
  const cases: Array<[Request, string]> = [
    [get('?facility_id=nope'), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?limit=501'), 'limit'],
    [get('?low=yes'), 'low'],
    [get('?low=1'), 'low'],
    [get('/items/not-a-uuid'), 'item_id'],
    [get(`/items/${ITEM}?facility_id=nope`), 'facility_id'],
    [get(`/items/${ITEM}?before=0`), 'before'],
    [get(`/items/${ITEM}?before=1.5`), 'before'],
    [get(`/items/${ITEM}?before=9223372036854775808`), 'before'],
    [post('/minimums', { ...SET, decision_id: 'x' }), 'decision_id'],
    // A write names its facility: a minimum is held at one, and 0022 asks permission there.
    [post('/minimums', without(SET, 'facility_id')), 'facility_id'],
    [post('/minimums', { ...SET, facility_id: null }), 'facility_id'],
    [post(`/items/${ITEM}/clear`, without(CLEAR, 'facility_id')), 'facility_id'],
    [post('/minimums', without(SET, 'item_unit_id')), 'item_unit_id'],
    [post('/minimums', { ...SET, item_unit_id: 'carton' }), 'item_unit_id'],
    [post('/minimums', { ...SET, expected_decision_id: 'x' }), 'expected_decision_id'],
    // Empty is not none: a stamp field never filled must not pass for a read absence.
    [post('/minimums', { ...SET, expected_decision_id: '' }), 'expected_decision_id'],
    [post(`/items/${ITEM}/clear`, { ...CLEAR, expected_decision_id: '' }), 'expected_decision_id'],
    [post(`/items/${ITEM}/clear`, without(CLEAR, 'expected_decision_id')), 'expected_decision_id'],
    [post(`/items/${ITEM}/clear`, { ...CLEAR, expected_decision_id: null }), 'expected_decision_id'],
    [post('/minimums', without(SET, 'reason')), 'reason'],
    [post('/minimums', { ...SET, reason: 'x'.repeat(501) }), 'reason'],
    [post(`/items/${ITEM}/clear`, without(CLEAR, 'reason')), 'reason'],
    // A quantity is decimal text: not a number, not signed, not an exponent, not a comma, not empty.
    [post('/minimums', without(SET, 'quantity')), 'quantity'],
    [post('/minimums', { ...SET, quantity: 2.5 }), 'quantity'],
    [post('/minimums', { ...SET, quantity: 10 }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '-1' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '+1' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '1e3' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '2,5' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '2.' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '.5' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '' }), 'quantity'],
    [post('/minimums', { ...SET, quantity: '٢' }), 'quantity'],
    [post('/items/not-a-uuid/clear', CLEAR), 'item_id'],
    [post(`/items/${ITEM}/clear`, without(CLEAR, 'decision_id')), 'decision_id'],
    [post('/minimums', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await stockAlerts(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('a write is a form: past 8 KiB is 413', async () => {
  for (const [, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await stockAlerts(post(path, { ...body, reason: 'x'.repeat(9000) }), deps(db));
    assert.equal(response.status, 413, path);
    assert.deepEqual(db.calls, [], path);
  }
});

// --- refusals ------------------------------------------------------------------

test('each kind of stock-alerts refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, Refusal, number, string]> = [
    ['setStockMinimum', new Refusal('23505', 'decision is already recorded', 'stock_minimum_decision_pkey', null, 'Read erp.stock_minimum_history() to confirm.'), 409, 'already_recorded'],
    ['clearStockMinimum', new Refusal('23505', 'decision is already recorded', 'stock_minimum_decision_pkey', null, null), 409, 'already_recorded'],
    ['setStockMinimum', new Refusal('23001', 'the minimum of RM-CHK-BREAST at WH-001 has changed since it was read', 'stock_minimum_stale', null, 'Reload it and apply the change again.'), 409, 'stale'],
    ['clearStockMinimum', new Refusal('23001', 'the minimum of RM-CHK-BREAST at WH-001 has changed since it was read', 'stock_minimum_stale', null, null), 409, 'stale'],
    ['setStockMinimum', new Refusal('23001', 'person may not write on capability inventory.stock_alerts here', null, null, null), 403, 'forbidden'],
    ['setStockMinimum', new Refusal('23001', 'the minimum of RM-CHK-BREAST at WH-001 is already 100', 'stock_minimum_unchanged', null, null), 422, 'refused'],
    ['clearStockMinimum', new Refusal('23001', 'RM-RICE has no minimum at WH-001', 'stock_minimum_not_set', null, null), 422, 'refused'],
    ['setStockMinimum', new Refusal('23001', 'the carton pack of COLA is retired: enter the minimum in a current one', 'stock_minimum_pack_is_retired', null, null), 422, 'refused'],
    ['setStockMinimum', new Refusal('23001', 'item OIL-OLD is retired and admits no new work', 'item_admits_no_new_work', null, null), 422, 'refused'],
    ['setStockMinimum', new Refusal('23001', 'a branch holds no stock record yet', 'stock_branch_business_day_undecided', null, null), 422, 'refused'],
    ['setStockMinimum', new Refusal('23001', 'an office holds no stock', 'stock_facility_holds_no_stock', null, null), 422, 'refused'],
    ['clearStockMinimum', new Refusal('23001', 'facility WH-001 is closed and admits no new work', 'facility_admits_no_new_work', null, null), 422, 'refused'],
    ['setStockMinimum', new Refusal('23514', 'a minimum is more than nothing', 'stock_minimum_is_valid', null, 'To have no minimum, clear it.'), 422, 'invalid'],
    ['setStockMinimum', new Refusal('23514', '0.000001 g is past six decimal places', 'stock_minimum_inexact', null, 'Enter it in a larger unit, or in the base unit.'), 422, 'invalid'],
    ['setStockMinimum', new Refusal('23514', 'a minimum states why it was set or cleared', 'stock_minimum_reason_is_stated', null, null), 422, 'invalid'],
    ['setStockMinimum', new Refusal('22023', 'stock is held at a facility: choose one', 'stock_facility_required', null, null), 422, 'invalid'],
    ['setStockMinimum', new Refusal('P0002', `no conversion ${CARTON}`, 'item_unit_exists', null, null), 404, 'not_found'],
    ['clearStockMinimum', new Refusal('P0002', `no item ${ITEM}`, 'item_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await stockAlerts(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own stock-minimum retry check is answered as a retry', async () => {
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "stock_minimum_decision_pkey"',
    'stock_minimum_decision_pkey', 'Key (decision_id)=(…) already exists.', null, false);
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw native; } });
    const response = await stockAlerts(post(path, body), deps(db));
    assert.equal(response.status, 409, method);
    assert.deepEqual(await response.json(), {
      status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'stock_minimum_decision_pkey',
    }, `${method}: a native collision is a conflict, in the edge's words, with no row printed`);
  }
});

test('a read without a facility, or refused for want of permission, says so; an error says nothing', async () => {
  const unnamed = new Refusal('22023', 'stock is held at a facility: choose one', 'stock_facility_required', null, null);
  const none = await stockAlerts(get(''), deps(fakeDb(ADMIN, { stockMinimums: async () => { throw unnamed; } })));
  assert.equal(none.status, 422);
  assert.equal((await json(none))['constraint'], 'stock_facility_required');

  const gate = new Refusal('23001', 'person may not read on capability inventory.stock_alerts here', null, null, null);
  const refused = await stockAlerts(get(`?facility_id=${FACTORY}`),
    deps(fakeDb(MANAGER, { stockMinimums: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.stock_minimum" does not exist');
    const response = await stockAlerts(get(`/items/${ITEM}`),
      deps(fakeDb(ADMIN, { stockMinimumHistory: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
