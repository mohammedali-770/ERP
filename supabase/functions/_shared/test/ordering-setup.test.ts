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
import type { StockAlertsDb } from '../stock-alerts-db.ts';
import type { PurchaseOrdersDb } from '../purchase-orders-db.ts';
import type { OrderCutoff, OrderingSetupDb, ParLevel, ReplenishmentSource } from '../ordering-setup-db.ts';
import { orderingSetup } from '../ordering-setup.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'ef'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000908';
const BRANCH = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const ITEM = '01936f00-0000-7000-8000-000000004102';
const TRAY = '01936f00-0000-7000-8000-000000004207';
const STAMP = '01936f00-0000-7000-8000-000000006222';
const D1 = '01936f00-0000-7000-8000-0000000f0901';

const SOURCE: ReplenishmentSource = {
  item_id: ITEM, code: 'SF-CHK-STRIPS', item_kind: 'semi_finished', base_unit_key: 'piece', name_en: 'Strips',
  name_ar: 'شرائح', item_status: 'active', facility_id: FACTORY, facility_code: 'FA-001', facility_type: 'factory',
  facility_name_en: 'Factory', facility_name_ar: 'مصنع', as_of_decision_id: STAMP, decided_at: '2026-10-01T06:01:00.000Z',
};
const CUTOFF: OrderCutoff = {
  facility_id: FACTORY, code: 'FA-001', facility_type: 'factory', name_en: 'Factory', name_ar: 'مصنع', status: 'open',
  tz_name: 'Asia/Riyadh', cutoff: '11:00', as_of_decision_id: STAMP, decided_at: '2026-10-03T05:00:00.000Z',
};
const PAR: ParLevel = {
  item_id: ITEM, code: 'SF-CHK-STRIPS', item_kind: 'semi_finished', base_unit_key: 'piece', name_en: 'Strips',
  name_ar: 'شرائح', item_status: 'active', par: '80', source_facility_id: FACTORY, as_of_decision_id: STAMP,
  item_unit_id: TRAY, unit_key: 'tray', factor: '40', quantity: '2', decided_at: '2026-10-02T08:05:00.000Z',
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
const stockAlertsNotUsed = notUsed<StockAlertsDb>('stock alerts', {
  stockMinimums: true, stockMinimumHistory: true, setStockMinimum: true, clearStockMinimum: true,
});
const purchaseOrdersNotUsed = notUsed<PurchaseOrdersDb>('purchase orders', {
  purchaseOrders: true, getPurchaseOrder: true, purchaseLimitHistory: true, raisePurchaseOrder: true,
  decidePurchaseOrder: true, receivePurchaseOrder: true, reversePurchaseReceipt: true, setPurchaseLimit: true,
  clearPurchaseLimit: true,
});

const METHODS: readonly (keyof OrderingSetupDb)[] = [
  'replenishmentSources', 'replenishmentSourceHistory', 'orderCutoffs', 'orderCutoffHistory', 'parLevels',
  'parLevelHistory', 'setReplenishmentSource', 'clearReplenishmentSource', 'setOrderCutoff', 'clearOrderCutoff',
  'setParLevel', 'clearParLevel',
];

/** An ordering-setup database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<OrderingSetupDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: keyof OrderingSetupDb) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'replenishmentSources') return [SOURCE];
    if (method === 'orderCutoffs') return [CUTOFF];
    if (method === 'parLevels') return [PAR];
    if (method.endsWith('History')) return [{ decision_id: STAMP, seq: '3', kind: 'par_set', is_current: true }];
    return undefined;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-08T20:00:00+00:00' };
  const routes = Object.fromEntries(METHODS.map((m) => [m, record(m)])) as unknown as OrderingSetupDb;
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
    ...stockAlertsNotUsed,
    ...purchaseOrdersNotUsed,
    ...routes,
  };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/ordering-setup';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const SET_SOURCE = { decision_id: D1, supplied_by: WAREHOUSE, expected_decision_id: STAMP, reason: 'The warehouse stocks it now.' };
const CLEAR_SOURCE = { decision_id: D1, expected_decision_id: STAMP, reason: 'Bought locally.' };
const SET_CUTOFF = { decision_id: D1, cutoff: '12:30', expected_decision_id: STAMP, reason: 'Picking starts later.' };
const CLEAR_CUTOFF = { decision_id: D1, expected_decision_id: STAMP, reason: 'No cut-off for now.' };
const SET_PAR = {
  decision_id: D1, facility_id: FACTORY, item_unit_id: TRAY, quantity: '1.5', expected_decision_id: STAMP,
  reason: 'A day of strips.',
};
const CLEAR_PAR = { decision_id: D1, facility_id: FACTORY, expected_decision_id: STAMP, reason: 'Off the menu.' };

const WRITES: ReadonlyArray<readonly [keyof OrderingSetupDb, string, Record<string, unknown>]> = [
  ['setReplenishmentSource', `/sources/${ITEM}`, SET_SOURCE],
  ['clearReplenishmentSource', `/sources/${ITEM}/clear`, CLEAR_SOURCE],
  ['setOrderCutoff', `/cutoffs/${FACTORY}`, SET_CUTOFF],
  ['clearOrderCutoff', `/cutoffs/${FACTORY}/clear`, CLEAR_CUTOFF],
  ['setParLevel', `/pars/${BRANCH}`, SET_PAR],
  ['clearParLevel', `/pars/${BRANCH}/items/${ITEM}/clear`, CLEAR_PAR],
];

const READS: ReadonlyArray<readonly [keyof OrderingSetupDb, string]> = [
  ['replenishmentSources', '/sources'],
  ['replenishmentSourceHistory', `/sources/${ITEM}`],
  ['orderCutoffs', '/cutoffs'],
  ['orderCutoffHistory', `/cutoffs/${FACTORY}`],
  ['parLevels', `/pars/${BRANCH}`],
  ['parLevelHistory', `/pars/${BRANCH}/items/${ITEM}`],
];

const without = (body: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));

// --- the actor ---------------------------------------------------------------

test('CONTROL: every ordering-setup write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await orderingSetup(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every ordering-setup read asks as the signed-in person, at the facility asked', async () => {
  const expected: Record<string, unknown> = {
    replenishmentSources: { facilityId: WAREHOUSE, suppliedBy: null, afterCode: null, limit: 100 },
    replenishmentSourceHistory: { facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: null, limit: 100 },
    orderCutoffs: { facilityId: WAREHOUSE, afterCode: null, limit: 100 },
    // A cut-off's history is asked at the facility it is of, which its path names.
    orderCutoffHistory: { facilityId: FACTORY, beforeSeq: null, limit: 100 },
    parLevels: { facilityId: WAREHOUSE, branchId: BRANCH, afterCode: null, limit: 100 },
    parLevelHistory: { facilityId: WAREHOUSE, branchId: BRANCH, itemId: ITEM, beforeSeq: null, limit: 100 },
  };
  for (const [method, path] of READS) {
    const db = fakeDb(MANAGER);
    const response = await orderingSetup(get(`${path}?facility_id=${WAREHOUSE}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.deepEqual(db.calls[0]!.args, [expected[method]], `${method} asks as the request says, and nothing more`);
  }
});

test('CONTROL: a read with no facility asks organisation-wide, never at the path\'s branch or the filter\'s facility', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [`/sources?supplied_by=${FACTORY}`, { facilityId: null, suppliedBy: FACTORY, afterCode: null, limit: 100 }],
    [`/sources/${ITEM}`, { facilityId: null, itemId: ITEM, beforeSeq: null, limit: 100 }],
    ['/cutoffs', { facilityId: null, afterCode: null, limit: 100 }],
    [`/pars/${BRANCH}`, { facilityId: null, branchId: BRANCH, afterCode: null, limit: 100 }],
    [`/pars/${BRANCH}/items/${ITEM}`, { facilityId: null, branchId: BRANCH, itemId: ITEM, beforeSeq: null, limit: 100 }],
  ];
  for (const [path, args] of cases) {
    const db = fakeDb(ADMIN);
    assert.equal((await orderingSetup(get(path), deps(db))).status, 200, path);
    assert.deepEqual(db.calls[0]!.args, [args], path);
  }
});

test('without a session nothing reaches an ordering-setup route', async () => {
  for (const request of [...READS.map(([, path]) => get(path, {})), ...WRITES.map(([, path, body]) => post(path, body, {}))]) {
    const db = fakeDb(null);
    const response = await orderingSetup(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    setReplenishmentSource: {
      decisionId: D1, itemId: ITEM, suppliedBy: WAREHOUSE, expectedDecisionId: STAMP, reason: 'The warehouse stocks it now.',
    },
    clearReplenishmentSource: { decisionId: D1, itemId: ITEM, expectedDecisionId: STAMP, reason: 'Bought locally.' },
    setOrderCutoff: {
      decisionId: D1, facilityId: FACTORY, cutoff: '12:30', expectedDecisionId: STAMP, reason: 'Picking starts later.',
    },
    clearOrderCutoff: { decisionId: D1, facilityId: FACTORY, expectedDecisionId: STAMP, reason: 'No cut-off for now.' },
    setParLevel: {
      decisionId: D1, facilityId: FACTORY, branchId: BRANCH, itemUnitId: TRAY, quantity: '1.5', expectedDecisionId: STAMP,
      reason: 'A day of strips.',
    },
    clearParLevel: {
      decisionId: D1, facilityId: FACTORY, branchId: BRANCH, itemId: ITEM, expectedDecisionId: STAMP, reason: 'Off the menu.',
    },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('what a setting is about is the one its path names, whatever the body or the query says', async () => {
  const other = '01936f00-0000-7000-8000-000000000402';
  const query = `?item_id=${TRAY}&facility_id=${WAREHOUSE}&branch_id=${other}`;
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    [`/sources/${ITEM}`, { ...SET_SOURCE, item_id: TRAY }, 'itemId', ITEM],
    [`/sources/${ITEM}/clear`, { ...CLEAR_SOURCE, item_id: TRAY }, 'itemId', ITEM],
    [`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, facility_id: WAREHOUSE }, 'facilityId', FACTORY],
    [`/cutoffs/${FACTORY}/clear`, { ...CLEAR_CUTOFF, facility_id: WAREHOUSE }, 'facilityId', FACTORY],
    [`/pars/${BRANCH}`, { ...SET_PAR, branch_id: other }, 'branchId', BRANCH],
    [`/pars/${BRANCH}/items/${ITEM}/clear`, { ...CLEAR_PAR, branch_id: other, item_id: TRAY }, 'branchId', BRANCH],
    [`/pars/${BRANCH}/items/${ITEM}/clear`, { ...CLEAR_PAR, item_id: TRAY }, 'itemId', ITEM],
  ];
  for (const [path, body, key, want] of cases) {
    for (const asked of [path, `${path}${query}`]) {
      const db = fakeDb(ADMIN);
      const response = await orderingSetup(post(asked, body), deps(db));
      assert.equal(response.status, 200, asked);
      assert.equal((db.calls[0]!.args[0] as Record<string, unknown>)[key], want, `${asked}: ${key}`);
    }
  }
  // A par is set from where its body says, never from the query.
  const db = fakeDb(ADMIN);
  await orderingSetup(post(`/pars/${BRANCH}?facility_id=${WAREHOUSE}`, SET_PAR), deps(db));
  assert.equal((db.calls[0]!.args[0] as { facilityId: string }).facilityId, FACTORY);
});

test('a first setting states that the form read none: null, sent as null', async () => {
  for (const [method, path, body] of WRITES.filter(([m]) => m.startsWith('set'))) {
    const db = fakeDb(ADMIN);
    assert.equal((await orderingSetup(post(path, { ...body, expected_decision_id: null }), deps(db))).status, 200, method);
    assert.equal((db.calls[0]!.args[0] as { expectedDecisionId: unknown }).expectedDecisionId, null, method);
  }
});

test('a par set or cleared organisation-wide states it: facility_id null, sent as null', async () => {
  for (const [path, body] of [[`/pars/${BRANCH}`, SET_PAR], [`/pars/${BRANCH}/items/${ITEM}/clear`, CLEAR_PAR]] as const) {
    const db = fakeDb(ADMIN);
    assert.equal((await orderingSetup(post(path, { ...body, facility_id: null }), deps(db))).status, 200, path);
    assert.equal((db.calls[0]!.args[0] as { facilityId: unknown }).facilityId, null, path);
  }
});

test('CONTROL: a stamp, or where a par is set from, left out is malformed, never read as none', async () => {
  for (const [, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, without(body, 'expected_decision_id')), deps(db));
    assert.equal(response.status, 400, path);
    assert.deepEqual(await response.json(), { status: 'malformed', field: 'expected_decision_id' });
    assert.deepEqual(db.calls, []);
  }
  for (const [path, body] of [[`/pars/${BRANCH}`, SET_PAR], [`/pars/${BRANCH}/items/${ITEM}/clear`, CLEAR_PAR]] as const) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, without(body, 'facility_id')), deps(db));
    assert.equal(response.status, 400, path);
    assert.deepEqual(await response.json(), { status: 'malformed', field: 'facility_id' },
      'a form that never chose must not pass for one that chose the organisation');
    assert.deepEqual(db.calls, []);
  }
});

test('CONTROL: every write names its decision id and its reason, and every clear its stamp', async () => {
  for (const [method, path, body] of WRITES) {
    for (const [field, bad] of [['decision_id', undefined], ['decision_id', ''], ['reason', undefined],
                                ['reason', 'x'.repeat(501)]] as const) {
      const db = fakeDb(ADMIN);
      const sent = bad === undefined ? without(body, field) : { ...body, [field]: bad };
      const response = await orderingSetup(post(path, sent), deps(db));
      assert.equal(response.status, 400, `${method}: ${field}`);
      assert.deepEqual(await response.json(), { status: 'malformed', field }, `${method}: ${field}`);
      assert.deepEqual(db.calls, [], `${method}: the edge never mints a decision id of its own`);
    }
  }
  for (const [method, path, body] of WRITES.filter(([m]) => m.startsWith('clear'))) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, { ...body, expected_decision_id: null }), deps(db));
    assert.equal(response.status, 400, `${method}: there is something to clear, so a stamp`);
    assert.deepEqual(await response.json(), { status: 'malformed', field: 'expected_decision_id' });
  }
  for (const [path, body] of [[`/pars/${BRANCH}`, SET_PAR], [`/pars/${BRANCH}/items/${ITEM}/clear`, CLEAR_PAR]] as const) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, { ...body, facility_id: '' }), deps(db));
    assert.equal(response.status, 400, `${path}: an empty place is not the organisation`);
    assert.deepEqual(await response.json(), { status: 'malformed', field: 'facility_id' });
  }
});

test('a cut-off and a par travel as the text they were sent, never as numbers', async () => {
  // 24:00 and 99:99 are shaped as times, and 0024's to refuse by name.
  for (const c of ['00:00', '23:59', '11:00', '24:00', '99:99']) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: c }), deps(db));
    assert.equal(response.status, 200, c);
    assert.equal((db.calls[0]!.args[0] as { cutoff: unknown }).cutoff, c);
  }
  for (const q of ['0.1', '1.5', '0', '999999999999.999999', '1234567890123.1234567', '007']) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: q }), deps(db));
    assert.equal(response.status, 200, q);
    assert.equal((db.calls[0]!.args[0] as { quantity: unknown }).quantity, q);
  }
  // And the answers carry them as the database gave them: text.
  const pars = await json(await orderingSetup(get(`/pars/${BRANCH}?facility_id=${BRANCH}`), deps(fakeDb(ADMIN))));
  const row = pars['pars'][0];
  assert.deepEqual([row.par, row.factor, row.quantity], ['80', '40', '2']);
  const cutoffs = await json(await orderingSetup(get('/cutoffs'), deps(fakeDb(ADMIN))));
  assert.equal(cutoffs['cutoffs'][0].cutoff, '11:00');
});

test('the reads pass their ids and facility, and page by code and by seq', async () => {
  const two = <T extends { code: string }>(row: T) => [row, { ...row, code: `${row.code}-2` }];
  const lists: Array<[keyof OrderingSetupDb, string, string, Record<string, unknown>, string, readonly unknown[]]> = [
    ['replenishmentSources', `/sources?facility_id=${WAREHOUSE}&supplied_by=${FACTORY}&after=A&limit=2`, 'sources',
      { facilityId: WAREHOUSE, suppliedBy: FACTORY, afterCode: 'A', limit: 2 }, 'SF-CHK-STRIPS-2', two(SOURCE)],
    ['orderCutoffs', `/cutoffs?facility_id=${BRANCH}&after=A&limit=2`, 'cutoffs',
      { facilityId: BRANCH, afterCode: 'A', limit: 2 }, 'FA-001-2', two(CUTOFF)],
    ['parLevels', `/pars/${BRANCH}?facility_id=${FACTORY}&after=A&limit=2`, 'pars',
      { facilityId: FACTORY, branchId: BRANCH, afterCode: 'A', limit: 2 }, 'SF-CHK-STRIPS-2', two(PAR)],
  ];
  for (const [method, path, key, args, next, rows] of lists) {
    const db = fakeDb(ADMIN, { [method]: async () => rows });
    const page = await json(await orderingSetup(get(path), deps(db)));
    assert.deepEqual(db.calls[0]!.args, [args], method);
    assert.equal(page[key].length, 2, method);
    assert.equal(page['next_after'], next, `${method}: a full page names where the next one starts`);
    const short = await json(await orderingSetup(get(path.replace('limit=2', 'limit=3')),
      deps(fakeDb(ADMIN, { [method]: async () => rows }))));
    assert.equal(short['next_after'], null, `CONTROL: ${method}: a short page has no next one`);
  }

  const defaults = fakeDb(ADMIN);
  await orderingSetup(get('/sources'), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, suppliedBy: null, afterCode: null, limit: 100 }],
    'with no facility the edge asks organisation-wide, which only an organisation-wide reader passes');

  const histories: Array<[keyof OrderingSetupDb, string, Record<string, unknown>]> = [
    ['replenishmentSourceHistory', `/sources/${ITEM}?facility_id=${WAREHOUSE}&before=12&limit=1`,
      { facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: '12', limit: 1 }],
    ['orderCutoffHistory', `/cutoffs/${FACTORY}?facility_id=${WAREHOUSE}&before=12&limit=1`,
      { facilityId: FACTORY, beforeSeq: '12', limit: 1 }],
    ['parLevelHistory', `/pars/${BRANCH}/items/${ITEM}?facility_id=${FACTORY}&before=12&limit=1`,
      { facilityId: FACTORY, branchId: BRANCH, itemId: ITEM, beforeSeq: '12', limit: 1 }],
  ];
  for (const [method, path, args] of histories) {
    const db = fakeDb(ADMIN);
    const h = await json(await orderingSetup(get(path), deps(db)));
    assert.deepEqual(db.calls[0]!.args, [args], method);
    assert.equal(h['decisions'][0].is_current, true);
    assert.equal(h['next_before'], '3', `${method}: a full page names the seq the next one ends before`);
    const first = await json(await orderingSetup(get(path.replace(/[?].*$/, '')), deps(fakeDb(ADMIN))));
    assert.equal(first['next_before'], null, `CONTROL: ${method}: a short page has no older one`);
  }
});

test('a cut-off\'s history is asked at the facility it is of, never at the one the query names', async () => {
  const db = fakeDb(ADMIN);
  await orderingSetup(get(`/cutoffs/${FACTORY}?facility_id=${BRANCH}`), deps(db));
  assert.equal((db.calls[0]!.args[0] as { facilityId: string }).facilityId, FACTORY);
});

test('a path that is no route is 404 before any field is read, and nothing is deleted', async () => {
  for (const request of [
    get(''), get('/sources/x/y'), get(`/sources/${ITEM}/clear`), get(`/cutoffs/${FACTORY}/clear`), get('/pars'),
    get(`/pars/${BRANCH}/items`), get(`/pars/${BRANCH}/items/${ITEM}/clear`), get('/order-day'),
    post('', SET_SOURCE), post('/sources', SET_SOURCE), post(`/sources/${ITEM}/set`, SET_SOURCE),
    post(`/sources/${ITEM}/clear/x`, CLEAR_SOURCE), post('/cutoffs', SET_CUTOFF), post(`/cutoffs/${FACTORY}/x`, SET_CUTOFF),
    post('/pars', SET_PAR), post(`/pars/${BRANCH}/items/${ITEM}`, SET_PAR), post(`/pars/${BRANCH}/items`, SET_PAR),
    post(`/pars/${BRANCH}/clear`, CLEAR_PAR), post(`/pars/${BRANCH}/items/${ITEM}/clear/x`, CLEAR_PAR),
    // A mistyped set must never be read as a clear: a set's body carries every field a clear needs.
    post(`/pars/${BRANCH}/items/${ITEM}/set`, SET_PAR), post(`/pars/${BRANCH}/x/${ITEM}/clear`, CLEAR_PAR),
    post(`/sources/${ITEM}/set`, SET_SOURCE), post(`/cutoffs/${FACTORY}/set`, SET_CUTOFF), get(`/pars/${BRANCH}/x/${ITEM}`),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  for (const path of [`/sources/${ITEM}`, `/cutoffs/${FACTORY}`, `/pars/${BRANCH}`]) {
    const del = await orderingSetup(new Request(`${base}${path}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
    assert.equal(del.status, 405, `${path}: there is no delete: a setting is cleared, by a decision`);
  }
});

// --- shape -------------------------------------------------------------------

test('a malformed ordering-setup field is a 400 naming it, and nothing reaches the database', async () => {
  const cases: Array<[Request, string]> = [
    [get('/sources?facility_id=nope'), 'facility_id'],
    [get('/sources?supplied_by=nope'), 'supplied_by'],
    [get('/sources?limit=0'), 'limit'],
    [get('/sources?limit=501'), 'limit'],
    [get('/sources/not-a-uuid'), 'item_id'],
    [get(`/sources/${ITEM}?before=0`), 'before'],
    [get('/cutoffs?facility_id=nope'), 'facility_id'],
    [get('/cutoffs/not-a-uuid'), 'facility_id'],
    [get(`/cutoffs/${FACTORY}?before=1.5`), 'before'],
    [get('/pars/not-a-uuid'), 'branch_id'],
    [get(`/pars/${BRANCH}?facility_id=nope`), 'facility_id'],
    [get(`/pars/${BRANCH}/items/not-a-uuid`), 'item_id'],
    [get(`/pars/${BRANCH}/items/${ITEM}?before=9223372036854775808`), 'before'],
    [post('/sources/not-a-uuid', SET_SOURCE), 'item_id'],
    [post(`/sources/${ITEM}`, { ...SET_SOURCE, decision_id: 'x' }), 'decision_id'],
    [post(`/sources/${ITEM}`, without(SET_SOURCE, 'supplied_by')), 'supplied_by'],
    [post(`/sources/${ITEM}`, { ...SET_SOURCE, supplied_by: null }), 'supplied_by'],
    [post(`/sources/${ITEM}`, { ...SET_SOURCE, expected_decision_id: '' }), 'expected_decision_id'],
    [post(`/sources/${ITEM}/clear`, { ...CLEAR_SOURCE, expected_decision_id: null }), 'expected_decision_id'],
    [post(`/sources/${ITEM}`, without(SET_SOURCE, 'reason')), 'reason'],
    [post('/cutoffs/not-a-uuid', SET_CUTOFF), 'facility_id'],
    // A cut-off is 'HH:MM' text: not a number, not a moment, not one digit, not empty.
    [post(`/cutoffs/${FACTORY}`, without(SET_CUTOFF, 'cutoff')), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: 14 }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: 1400 }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: null }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '9:30' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '14:00:00' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '14.00' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: ' 14:00' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '14:00\n' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '١٤:٠٠' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}`, { ...SET_CUTOFF, cutoff: '2026-10-08T14:00:00+03:00' }), 'cutoff'],
    [post(`/cutoffs/${FACTORY}/clear`, without(CLEAR_CUTOFF, 'expected_decision_id')), 'expected_decision_id'],
    [post('/pars/not-a-uuid', SET_PAR), 'branch_id'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, facility_id: '' }), 'facility_id'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, facility_id: 'factory' }), 'facility_id'],
    [post(`/pars/${BRANCH}`, without(SET_PAR, 'item_unit_id')), 'item_unit_id'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, item_unit_id: 'tray' }), 'item_unit_id'],
    // A par is decimal text: not a number, not signed, not an exponent, not a comma, not empty.
    [post(`/pars/${BRANCH}`, without(SET_PAR, 'quantity')), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: 1.5 }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: 2 }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '-1' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '1e3' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '1,5' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '.5' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, quantity: '٢' }), 'quantity'],
    [post(`/pars/${BRANCH}`, { ...SET_PAR, reason: 'x'.repeat(501) }), 'reason'],
    [post(`/pars/${BRANCH}/items/not-a-uuid/clear`, CLEAR_PAR), 'item_id'],
    [post(`/pars/${BRANCH}/items/${ITEM}/clear`, { ...CLEAR_PAR, expected_decision_id: '' }), 'expected_decision_id'],
    [post(`/pars/${BRANCH}/items/${ITEM}/clear`, without(CLEAR_PAR, 'decision_id')), 'decision_id'],
    [post(`/pars/${BRANCH}`, 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(request, deps(db));
    const url = new URL(request.url);
    assert.equal(response.status, 400, `${field}: ${request.method} ${url.pathname}${url.search}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field }, `${url.pathname}`);
    assert.deepEqual(db.calls, [], field);
  }
});

test('a write is a form: past 8 KiB is 413', async () => {
  for (const [, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await orderingSetup(post(path, { ...body, reason: 'x'.repeat(9000) }), deps(db));
    assert.equal(response.status, 413, path);
    assert.deepEqual(db.calls, [], path);
  }
});

// --- refusals ------------------------------------------------------------------

test('each kind of ordering-setup refusal is answered as the person can act on it', async () => {
  const r = (state: string, message: string, constraint: string | null, hint: string | null = null) =>
    new Refusal(state, message, constraint, null, hint);
  const cases: Array<[keyof OrderingSetupDb, Refusal, number, string]> = [
    ['setReplenishmentSource', r('23505', 'decision is already recorded', 'replenishment_source_decision_pkey', 'Read erp.replenishment_source_history() to confirm.'), 409, 'already_recorded'],
    ['clearReplenishmentSource', r('23505', 'decision is already recorded', 'replenishment_source_decision_pkey'), 409, 'already_recorded'],
    ['setOrderCutoff', r('23505', 'decision is already recorded', 'order_cutoff_decision_pkey'), 409, 'already_recorded'],
    ['clearOrderCutoff', r('23505', 'decision is already recorded', 'order_cutoff_decision_pkey'), 409, 'already_recorded'],
    ['setParLevel', r('23505', 'decision is already recorded', 'par_level_decision_pkey'), 409, 'already_recorded'],
    ['clearParLevel', r('23505', 'decision is already recorded', 'par_level_decision_pkey'), 409, 'already_recorded'],
    ['setReplenishmentSource', r('23001', 'the source of SF-CHK-STRIPS has changed since it was read', 'replenishment_source_stale', 'Reload it and apply the change again.'), 409, 'stale'],
    ['setOrderCutoff', r('23001', 'the cut-off at FA-001 has changed since it was read', 'order_cutoff_stale'), 409, 'stale'],
    ['clearParLevel', r('23001', 'the par of SF-CHK-STRIPS at BR-001 has changed since it was read', 'par_level_stale'), 409, 'stale'],
    ['setParLevel', r('23001', 'person may not write on capability ordering.par_levels here (IAM-003)', null), 403, 'forbidden'],
    ['setOrderCutoff', r('23001', 'capability ordering.setup is hidden for this scope and does not admit new work (CAP-P04)', null), 403, 'forbidden'],
    ['setReplenishmentSource', r('23001', 'SF-CHK-STRIPS is already supplied by FA-001', 'replenishment_source_unchanged'), 422, 'refused'],
    ['clearReplenishmentSource', r('23001', 'OP-GLOVES is supplied by no facility', 'replenishment_source_not_set'), 422, 'refused'],
    ['setReplenishmentSource', r('23001', 'facility WH-B is of another brand than SF-CHK-STRIPS', 'replenishment_source_brand_differs'), 422, 'refused'],
    ['setReplenishmentSource', r('23001', 'facility BR-001 is a branch, and supplies no branch', 'ordering_facility_supplies_nothing'), 422, 'refused'],
    ['setOrderCutoff', r('23001', 'the cut-off at FA-001 is already 11:00', 'order_cutoff_unchanged'), 422, 'refused'],
    ['clearOrderCutoff', r('23001', 'FA-001 has no cut-off', 'order_cutoff_not_set'), 422, 'refused'],
    ['setParLevel', r('23001', 'RM-CHK-BREAST is supplied by WH-001: its par at BR-001 is set there', 'par_level_not_its_source'), 422, 'refused'],
    ['setParLevel', r('23001', 'RM-FRYING-OIL is supplied by no facility', 'par_level_item_has_no_source', 'Set its source first.'), 422, 'refused'],
    ['setParLevel', r('23001', 'facility WH-001 is a warehouse: a par is set for a branch', 'par_level_at_a_branch'), 422, 'refused'],
    ['setParLevel', r('23001', 'the tray pack of SF-CHK-STRIPS is retired: enter the par in a current one', 'par_level_pack_is_retired'), 422, 'refused'],
    ['setParLevel', r('23001', 'the par of SF-CHK-STRIPS at BR-001 is already 80 piece', 'par_level_unchanged'), 422, 'refused'],
    ['clearParLevel', r('23001', 'RM-RICE has no par at BR-002', 'par_level_not_set'), 422, 'refused'],
    ['setParLevel', r('23001', 'facility BR-002 is closed and admits no new work', 'facility_admits_no_new_work'), 422, 'refused'],
    ['setOrderCutoff', r('23514', 'a cut-off is a time of day, from 00:00 to 23:59: to have none, clear it', 'order_cutoff_is_valid'), 422, 'invalid'],
    ['setParLevel', r('23514', 'a par is more than nothing', 'par_level_is_valid', 'To have no par, clear it.'), 422, 'invalid'],
    ['setParLevel', r('23514', '0.000001 g is past six decimal places', 'par_level_inexact'), 422, 'invalid'],
    ['setReplenishmentSource', r('23514', 'a source states why it was set', 'replenishment_source_reason_is_stated'), 422, 'invalid'],
    ['setOrderCutoff', r('22023', 'a warehouse or a factory supplies branches: choose one', 'ordering_facility_required'), 422, 'invalid'],
    ['setParLevel', r('22023', 'a par is set for a branch: choose one', 'par_level_branch_required'), 422, 'invalid'],
    ['setParLevel', r('P0002', `no conversion ${TRAY}`, 'item_unit_exists'), 404, 'not_found'],
    ['clearParLevel', r('P0002', `no facility ${BRANCH}`, 'facility_exists'), 404, 'not_found'],
    ['setReplenishmentSource', r('P0002', `no item ${ITEM}`, 'item_exists'), 404, 'not_found'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await orderingSetup(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own retry check is answered as a retry', async () => {
  const logs: Record<string, string> = {
    setReplenishmentSource: 'replenishment_source_decision_pkey', clearReplenishmentSource: 'replenishment_source_decision_pkey',
    setOrderCutoff: 'order_cutoff_decision_pkey', clearOrderCutoff: 'order_cutoff_decision_pkey',
    setParLevel: 'par_level_decision_pkey', clearParLevel: 'par_level_decision_pkey',
  };
  for (const [method, path, body] of WRITES) {
    const native = new Refusal('23505', `duplicate key value violates unique constraint "${logs[method]}"`,
      logs[method]!, 'Key (decision_id)=(…) already exists.', null, false);
    const db = fakeDb(ADMIN, { [method]: async () => { throw native; } });
    const response = await orderingSetup(post(path, body), deps(db));
    assert.equal(response.status, 409, method);
    assert.deepEqual(await response.json(), {
      status: 'conflict', message: 'a value that must be unique is already in use', constraint: logs[method],
    }, `${method}: a native collision is a conflict, in the edge's words, with no row printed`);
  }
});

test('a read refused for want of permission, or of a branch it may not see, says so; an error says nothing', async () => {
  const gate = new Refusal('23001', 'person may not read on capability ordering.par_levels here (IAM-003)', null, null, null);
  const refused = await orderingSetup(get(`/pars/${BRANCH}?facility_id=${BRANCH}`),
    deps(fakeDb(MANAGER, { parLevels: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const scope = new Refusal('22023', 'a branch\'s pars are read at the branch, or at a facility that supplies it', 'par_level_read_scope', null, null);
  const other = await orderingSetup(get(`/pars/${BRANCH}?facility_id=${BRANCH}`),
    deps(fakeDb(MANAGER, { parLevels: async () => { throw scope; } })));
  assert.equal(other.status, 422);
  assert.equal((await json(other))['constraint'], 'par_level_read_scope');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.par_level" does not exist');
    const response = await orderingSetup(get(`/pars/${BRANCH}/items/${ITEM}`),
      deps(fakeDb(ADMIN, { parLevelHistory: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
