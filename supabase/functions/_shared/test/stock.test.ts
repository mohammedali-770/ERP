import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { FacilitiesDb } from '../facilities-db.ts';
import type { StockBalance, StockDb } from '../stock-db.ts';
import type { NotificationsDb } from '../notifications-db.ts';
import type { StockAlertsDb } from '../stock-alerts-db.ts';
import type { PurchaseOrdersDb } from '../purchase-orders-db.ts';
import { stock } from '../stock.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'cd'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const ITEM = '01936f00-0000-7000-8000-000000000501';
const KG = '01936f00-0000-7000-8000-000000000601';
const BOX = '01936f00-0000-7000-8000-000000000602';
const STAMP = '01936f00-0000-7000-8000-000000005701';
const TARGET = '01936f00-0000-7000-8000-000000005705';
const D1 = '01936f00-0000-7000-8000-0000000f0101';

const ROW: StockBalance = {
  item_id: ITEM, code: 'ITM-001', item_kind: 'raw', base_unit_key: 'kg', name_en: 'Chicken', name_ar: 'دجاج',
  item_status: 'active', on_hand: '123.5', last_counted_at: '2026-10-01T06:00:00+00:00', as_of_decision_id: STAMP,
  units: [{ item_unit_id: KG, unit_key: 'kg', factor: '1', status: 'active' }],
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

/** A stock database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<StockDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: keyof StockDb) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'stockOnHand') return [ROW];
    if (method === 'stockHistory') return [{ decision_id: STAMP, seq: '7', kind: 'count', counted: '123.5' }];
    if (method === 'getStockDecision') return { decision_id: STAMP, kind: 'waste', entries: [], counted: null };
    return undefined;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-06T20:00:00+00:00' };
  const db: Db & { calls: Call[] } = {
    calls,
    signIn: async () => { throw new Error('not used'); },
    signOut: async () => { throw new Error('not used'); },
    resolveSession: async () => session,
    viewer: async () => { throw new Error('not used'); },
    ...itemsNotUsed,
    ...suppliersNotUsed,
    ...transferPricesNotUsed,
    ...facilitiesNotUsed,
    stockOnHand: record('stockOnHand') as StockDb['stockOnHand'],
    stockHistory: record('stockHistory') as StockDb['stockHistory'],
    getStockDecision: record('getStockDecision') as StockDb['getStockDecision'],
    recordStockAdjustment: record('recordStockAdjustment') as StockDb['recordStockAdjustment'],
    recordStockCount: record('recordStockCount') as StockDb['recordStockCount'],
    reverseStockDecision: record('reverseStockDecision') as StockDb['reverseStockDecision'],
    ...notificationsNotUsed,
    ...stockAlertsNotUsed,
    ...purchaseOrdersNotUsed,
  };
  return db;
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/stock';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const ADJUST = {
  decision_id: D1, facility_id: WAREHOUSE, kind: 'waste', occurred_at: '2026-10-06T09:15:00+03:00',
  lines: [{ item_unit_id: BOX, quantity: '2.5' }], reason: 'Dropped in the cold room.', override_reason: null,
};
const COUNT = {
  decision_id: D1, facility_id: WAREHOUSE, counted_at: null,
  lines: [{ item_unit_id: KG, quantity: '0' }, { item_unit_id: BOX, quantity: '12' }], reason: 'Weekly count.',
};
const REVERSE = { decision_id: D1, facility_id: WAREHOUSE, reason: 'Entered twice.', override_reason: null };

const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['recordStockAdjustment', '/adjustments', ADJUST],
  ['recordStockCount', '/counts', COUNT],
  ['reverseStockDecision', `/decisions/${TARGET}/reverse`, REVERSE],
];

// --- the actor ---------------------------------------------------------------

test('CONTROL: every stock write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await stock(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('CONTROL: a line carries on only its conversion, quantity and direction', async () => {
  const db = fakeDb(MANAGER);
  const line = { item_unit_id: BOX, quantity: '1', direction: 'in', actor_id: ADMIN, factor: '1000', item_id: ITEM };
  const response = await stock(post('/adjustments', { ...ADJUST, kind: 'adjustment', lines: [line] }), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual((db.calls[0]!.args[0] as { lines: unknown }).lines, [{ item_unit_id: BOX, quantity: '1', direction: 'in' }]);
  assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN));
});

test('every stock read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [
    ['stockOnHand', ''], ['stockHistory', `/items/${ITEM}`], ['getStockDecision', `/decisions/${STAMP}`],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await stock(get(`${path}?facility_id=${WAREHOUSE}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(WAREHOUSE), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a stock route', async () => {
  for (const request of [
    get('', {}), get(`/items/${ITEM}`, {}), get(`/decisions/${STAMP}`, {}),
    ...WRITES.map(([, path, body]) => post(path, body, {})),
  ]) {
    const db = fakeDb(null);
    const response = await stock(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    recordStockAdjustment: {
      decisionId: D1, facilityId: WAREHOUSE, kind: 'waste', occurredAt: '2026-10-06T09:15:00+03:00',
      lines: [{ item_unit_id: BOX, quantity: '2.5' }], reason: 'Dropped in the cold room.', overrideReason: null,
    },
    recordStockCount: {
      decisionId: D1, facilityId: WAREHOUSE, countedAt: null,
      lines: [{ item_unit_id: KG, quantity: '0' }, { item_unit_id: BOX, quantity: '12' }], reason: 'Weekly count.',
    },
    reverseStockDecision: {
      decisionId: D1, facilityId: WAREHOUSE, targetDecisionId: TARGET, reason: 'Entered twice.', overrideReason: null,
    },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await stock(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('an override reason, a stated moment and a direction reach the route as sent', async () => {
  const db = fakeDb(ADMIN);
  const body = {
    ...ADJUST, kind: 'adjustment', occurred_at: '2026-10-05T23:59:59.5Z', override_reason: 'Delivery not yet entered.',
    lines: [{ item_unit_id: KG, quantity: '10', direction: 'out' }, { item_unit_id: BOX, quantity: '1', direction: 'in' }],
  };
  assert.equal((await stock(post('/adjustments', body), deps(db))).status, 200);
  assert.deepEqual(db.calls[0]!.args[0], {
    decisionId: D1, facilityId: WAREHOUSE, kind: 'adjustment', occurredAt: '2026-10-05T23:59:59.5Z',
    lines: [{ item_unit_id: KG, quantity: '10', direction: 'out' }, { item_unit_id: BOX, quantity: '1', direction: 'in' }],
    reason: 'Dropped in the cold room.', overrideReason: 'Delivery not yet entered.',
  });

  // Left out, a moment is now, and an override is none: both are the route's null.
  const bare = fakeDb(ADMIN);
  const { occurred_at: _o, override_reason: _r, ...rest } = ADJUST;
  assert.equal((await stock(post('/adjustments', rest), deps(bare))).status, 200);
  const a = bare.calls[0]!.args[0] as Record<string, unknown>;
  assert.equal(a['occurredAt'], null);
  assert.equal(a['overrideReason'], null);

  const reversal = fakeDb(ADMIN);
  await stock(post(`/decisions/${TARGET}/reverse`, { ...REVERSE, override_reason: 'Recount tomorrow.' }), deps(reversal));
  assert.equal((reversal.calls[0]!.args[0] as Record<string, unknown>)['overrideReason'], 'Recount tomorrow.');
});

test('the decision reversed is the one the path names, whatever the body says', async () => {
  const db = fakeDb(ADMIN);
  const response = await stock(post(`/decisions/${TARGET}/reverse`, { ...REVERSE, target_decision_id: STAMP }), deps(db));
  assert.equal(response.status, 200);
  assert.equal((db.calls[0]!.args[0] as { targetDecisionId: string }).targetDecisionId, TARGET);
});

test('a quantity travels as the decimal text it was sent, never as a float', async () => {
  // Past 0020's twelve digits and six places is still text here, and 0020's to refuse.
  for (const q of ['0.1', '0.29', '123.5', '0', '999999999999.999999', '1234567890123.1234567', '007']) {
    const db = fakeDb(ADMIN);
    const response = await stock(post('/counts', { ...COUNT, lines: [{ item_unit_id: KG, quantity: q }] }), deps(db));
    assert.equal(response.status, 200, q);
    assert.equal((db.calls[0]!.args[0] as { lines: Array<{ quantity: unknown }> }).lines[0]!.quantity, q);
  }
  // And the answer carries them as the database gave them: text.
  const answer = await json(await stock(get(`?facility_id=${WAREHOUSE}`), deps(fakeDb(ADMIN))));
  assert.equal(answer['balances'][0].on_hand, '123.5');
  assert.equal(answer['balances'][0].units[0].factor, '1');
});

test('the reads pass their ids and facility, and page by code and by seq', async () => {
  const db = fakeDb(ADMIN);
  const one = await json(await stock(get(`/decisions/${STAMP}?facility_id=${FACTORY}`), deps(db)));
  assert.deepEqual(db.calls[0], { method: 'getStockDecision', actor: ADMIN, args: [FACTORY, STAMP] });
  assert.equal(one['decision'].kind, 'waste');

  const rows = [ROW, { ...ROW, item_id: KG, code: 'ITM-002' }];
  const paged = fakeDb(ADMIN, { stockOnHand: async () => rows });
  const page = await json(await stock(get(`?facility_id=${WAREHOUSE}&search=chi&after=A&limit=2&negative=true`), deps(paged)));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: WAREHOUSE, search: 'chi', afterCode: 'A', limit: 2, negativeOnly: true }]);
  assert.equal(page['balances'].length, 2);
  assert.equal(page['next_after'], 'ITM-002', 'a full page names where the next one starts');
  const short = await json(await stock(get(`?facility_id=${WAREHOUSE}&limit=3`), deps(fakeDb(ADMIN, { stockOnHand: async () => rows }))));
  assert.equal(short['next_after'], null, 'CONTROL: a short page has no next one');

  const defaults = fakeDb(ADMIN);
  await stock(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, search: null, afterCode: null, limit: 100, negativeOnly: false }],
    'with no facility the edge asks with none, and 0020 refuses it');

  const history = fakeDb(ADMIN);
  const h = await json(await stock(get(`/items/${ITEM}?facility_id=${WAREHOUSE}&before=12&limit=1`), deps(history)));
  assert.deepEqual(history.calls[0]!.args, [{ facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: '12', limit: 1 }]);
  assert.equal(h['decisions'][0].counted, '123.5');
  assert.equal(h['next_before'], '7', 'a full page names the seq the next one ends before');
  // The largest int8 is a seq like any other.
  const last = fakeDb(ADMIN);
  assert.equal((await stock(get(`/items/${ITEM}?before=9223372036854775807`), deps(last))).status, 200);
  assert.equal((last.calls[0]!.args[0] as { beforeSeq: unknown }).beforeSeq, '9223372036854775807');
  const first = fakeDb(ADMIN);
  const f = await json(await stock(get(`/items/${ITEM}?facility_id=${WAREHOUSE}`), deps(first)));
  assert.deepEqual(first.calls[0]!.args, [{ facilityId: WAREHOUSE, itemId: ITEM, beforeSeq: null, limit: 100 }]);
  assert.equal(f['next_before'], null, 'CONTROL: a short page has no older one');
});

test('a path that is no route is 404 before any field is read, and nothing is edited or deleted', async () => {
  for (const request of [
    get('/items'), get(`/items/${ITEM}/x`), get('/decisions'), get(`/decisions/${STAMP}/reverse`), get('/adjustments'),
    get('/counts'), post('', ADJUST), post(`/adjustments/${STAMP}`, ADJUST), post(`/decisions/${STAMP}`, REVERSE),
    post(`/decisions/${STAMP}/amend`, REVERSE), post(`/decisions/${STAMP}/reverse/x`, REVERSE), post('/reverse', REVERSE),
    post(`/items/${ITEM}`, COUNT), post('/balances', COUNT),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await stock(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await stock(new Request(`${base}/decisions/${STAMP}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete, here or in the database');
});

// --- shape -------------------------------------------------------------------

test('a malformed stock field is a 400 naming it, and nothing reaches the database', async () => {
  const without = (body: Record<string, unknown>, field: string) =>
    Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));
  const line = (l: unknown) => ({ ...ADJUST, lines: [{ item_unit_id: KG, quantity: '1' }, l] });
  const cases: Array<[Request, string]> = [
    [get('?facility_id=nope'), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?limit=501'), 'limit'],
    [get('?negative=yes'), 'negative'],
    [get('?negative=1'), 'negative'],
    [get('/items/not-a-uuid'), 'item_id'],
    [get(`/items/${ITEM}?facility_id=nope`), 'facility_id'],
    [get(`/items/${ITEM}?before=0`), 'before'],
    [get(`/items/${ITEM}?before=-1`), 'before'],
    [get(`/items/${ITEM}?before=1.5`), 'before'],
    [get(`/items/${ITEM}?before=9223372036854775808`), 'before'],
    [get(`/items/${ITEM}?before=12345678901234567890`), 'before'],
    [get('/decisions/not-a-uuid'), 'decision_id'],
    [get(`/decisions/${STAMP}?facility_id=nope`), 'facility_id'],
    [post('/adjustments', { ...ADJUST, decision_id: 'x' }), 'decision_id'],
    // A write names its facility: stock is held at one, and 0020 asks permission there.
    [post('/adjustments', without(ADJUST, 'facility_id')), 'facility_id'],
    [post('/adjustments', { ...ADJUST, facility_id: null }), 'facility_id'],
    [post('/counts', without(COUNT, 'facility_id')), 'facility_id'],
    [post(`/decisions/${TARGET}/reverse`, without(REVERSE, 'facility_id')), 'facility_id'],
    [post('/adjustments', without(ADJUST, 'kind')), 'kind'],
    [post('/adjustments', { ...ADJUST, kind: 3 }), 'kind'],
    [post('/adjustments', without(ADJUST, 'reason')), 'reason'],
    [post('/adjustments', { ...ADJUST, reason: 'x'.repeat(501) }), 'reason'],
    [post('/adjustments', { ...ADJUST, override_reason: 7 }), 'override_reason'],
    [post('/adjustments', { ...ADJUST, override_reason: 'x'.repeat(501) }), 'override_reason'],
    // A moment names its offset: one without would be read as UTC, three hours from Riyadh.
    [post('/adjustments', { ...ADJUST, occurred_at: '2026-10-06T09:15:00' }), 'occurred_at'],
    [post('/adjustments', { ...ADJUST, occurred_at: '2026-10-06' }), 'occurred_at'],
    [post('/adjustments', { ...ADJUST, occurred_at: '2026-02-30T09:15:00+03:00' }), 'occurred_at'],
    [post('/adjustments', { ...ADJUST, occurred_at: 1790000000000 }), 'occurred_at'],
    [post('/counts', { ...COUNT, counted_at: '2026-10-06 09:15+03' }), 'counted_at'],
    // The lines: 1 to 500 objects.
    [post('/adjustments', without(ADJUST, 'lines')), 'lines'],
    [post('/adjustments', { ...ADJUST, lines: [] }), 'lines'],
    [post('/adjustments', { ...ADJUST, lines: { item_unit_id: KG, quantity: '1' } }), 'lines'],
    [post('/counts', { ...COUNT, lines: Array.from({ length: 501 }, () => ({ item_unit_id: KG, quantity: '1' })) }), 'lines'],
    [post('/adjustments', line('x')), 'lines[1]'],
    [post('/adjustments', line(null)), 'lines[1]'],
    [post('/adjustments', line([KG, '1'])), 'lines[1]'],
    [post('/adjustments', line({ quantity: '1' })), 'lines[1].item_unit_id'],
    [post('/adjustments', line({ item_unit_id: 'kg', quantity: '1' })), 'lines[1].item_unit_id'],
    // A quantity is decimal text: not a number, not signed, not an exponent, not a comma, not empty.
    [post('/adjustments', line({ item_unit_id: KG, quantity: 1 })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: 2.5 })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '-1' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '+1' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '1e3' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '2,5' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '2.' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '.5' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: ' 1' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '٢' })), 'lines[1].quantity'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '1', direction: 'up' })), 'lines[1].direction'],
    [post('/adjustments', line({ item_unit_id: KG, quantity: '1', direction: 1 })), 'lines[1].direction'],
    [post('/counts', { ...COUNT, decision_id: undefined }), 'decision_id'],
    [post('/counts', without(COUNT, 'reason')), 'reason'],
    [post('/decisions/not-a-uuid/reverse', REVERSE), 'target_decision_id'],
    [post(`/decisions/${TARGET}/reverse`, without(REVERSE, 'decision_id')), 'decision_id'],
    [post(`/decisions/${TARGET}/reverse`, without(REVERSE, 'reason')), 'reason'],
    [post('/adjustments', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await stock(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('a kind, a direction or a quantity the route refuses is the route\'s to refuse, not the edge\'s', async () => {
  // An unknown kind, a count passed as an adjustment, a waste going in, a count with a direction,
  // a moved quantity of none, past 0020's places, a repeated pack, a moment in the future: well formed, and 0020's rules.
  for (const [path, body] of [
    ['/adjustments', { ...ADJUST, kind: 'theft' }], ['/adjustments', { ...ADJUST, kind: 'count' }],
    ['/adjustments', { ...ADJUST, lines: [{ item_unit_id: KG, quantity: '1', direction: 'in' }] }],
    ['/counts', { ...COUNT, lines: [{ item_unit_id: KG, quantity: '1', direction: 'in' }] }],
    ['/adjustments', { ...ADJUST, lines: [{ item_unit_id: KG, quantity: '0' }] }],
    ['/adjustments', { ...ADJUST, lines: [{ item_unit_id: KG, quantity: '1.1234567' }] }],
    ['/adjustments', { ...ADJUST, lines: [{ item_unit_id: KG, quantity: '1' }, { item_unit_id: KG, quantity: '2' }] }],
    ['/adjustments', { ...ADJUST, occurred_at: '2099-01-01T00:00:00+03:00' }],
    ['/adjustments', { ...ADJUST, override_reason: '' }],
  ] as const) {
    const db = fakeDb(ADMIN);
    assert.equal((await stock(post(path, body), deps(db))).status, 200, JSON.stringify(body));
    assert.equal(db.calls.length, 1);
  }
});

test('a full count of 500 lines fits; a document past 128 KiB is 413, and a reversal is a form', async () => {
  const full = Array.from({ length: 500 }, () => ({
    item_unit_id: KG, quantity: '999999999999.999999', direction: 'out',
  }));
  const db = fakeDb(ADMIN);
  const response = await stock(post('/adjustments', { ...ADJUST, kind: 'adjustment', lines: full, reason: 'ع'.repeat(500) }), deps(db));
  assert.equal(response.status, 200, 'the longest adjustment the route accepts reaches it');
  assert.equal((db.calls[0]!.args[0] as { lines: unknown[] }).lines.length, 500);
  const count = fakeDb(ADMIN);
  const counted = await stock(post('/counts', {
    ...COUNT, lines: full.map(({ item_unit_id, quantity }) => ({ item_unit_id, quantity })), reason: 'ع'.repeat(500),
  }), deps(count));
  assert.equal(counted.status, 200, 'and the longest count');
  assert.equal((count.calls[0]!.args[0] as { lines: unknown[] }).lines.length, 500);

  for (const [path, body] of [
    ['/adjustments', { ...ADJUST, reason: 'x'.repeat(140 * 1024) }],
    ['/counts', { ...COUNT, reason: 'x'.repeat(140 * 1024) }],
    [`/decisions/${TARGET}/reverse`, { ...REVERSE, reason: 'x'.repeat(9000) }],
  ] as const) {
    const big = fakeDb(ADMIN);
    const answer = await stock(post(path, body), deps(big));
    assert.equal(answer.status, 413, path);
    assert.deepEqual(big.calls, [], path);
  }
});

// --- refusals ------------------------------------------------------------------

test('each kind of stock refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, Refusal, number, string]> = [
    ['recordStockAdjustment', new Refusal('23505', 'decision is already recorded', 'stock_decision_pkey', null, 'Read erp.get_stock_decision()'), 409, 'already_recorded'],
    ['recordStockCount', new Refusal('23505', 'decision is already recorded', 'stock_decision_pkey', null, null), 409, 'already_recorded'],
    ['reverseStockDecision', new Refusal('23505', 'decision is already recorded', 'stock_decision_pkey', null, null), 409, 'already_recorded'],
    ['reverseStockDecision', new Refusal('23505', 'stock decision is already reversed', 'stock_already_reversed', null, null), 409, 'conflict'],
    ['recordStockAdjustment', new Refusal('23001', 'person may not write on capability inventory.stock here', null, null, null), 403, 'forbidden'],
    ['recordStockAdjustment', new Refusal('23001', 'person may not approve on capability inventory.stock here', null, null, null), 403, 'forbidden'],
    ['recordStockAdjustment', new Refusal('23001', 'ITM-001 would stand at -10 kg at WH-001', 'stock_would_go_negative', null, 'Count it, or record an override with a reason.'), 422, 'refused'],
    ['recordStockAdjustment', new Refusal('23001', 'a movement is not dated at or before the last count', 'stock_backdated_before_count', null, null), 422, 'refused'],
    ['recordStockCount', new Refusal('23001', 'a movement is recorded at that moment', 'stock_count_moment_taken', null, null), 422, 'refused'],
    ['reverseStockDecision', new Refusal('23001', 'the item has been counted since', 'stock_reversal_counted_since', null, null), 422, 'refused'],
    ['reverseStockDecision', new Refusal('23001', 'a count is not reversed', 'stock_decision_is_not_reversible', null, 'A count is corrected by counting again.'), 422, 'refused'],
    ['recordStockAdjustment', new Refusal('23001', 'a branch holds no stock yet', 'stock_branch_business_day_undecided', null, null), 422, 'refused'],
    ['recordStockAdjustment', new Refusal('23001', 'an office holds no stock', 'stock_facility_holds_no_stock', null, null), 422, 'refused'],
    ['recordStockAdjustment', new Refusal('23001', 'facility WH-001 is closed and admits no new work', 'facility_admits_no_new_work', null, null), 422, 'refused'],
    ['recordStockAdjustment', new Refusal('23514', 'this records an adjustment, a waste, a damage or an expiry', 'stock_decision_kind_is_known', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'line 1: a quantity is a number with up to twelve digits and six decimal places', 'stock_quantity_is_valid', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'line 1: 1.5 g is past six decimal places', 'stock_quantity_inexact', null, 'Enter it in a larger unit, or in the base unit.'), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'line 2: that conversion is already on line 1', 'stock_line_repeats', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'line 1: an adjustment line is in or out', 'stock_direction_is_known', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'a moment is not in the future', 'stock_not_in_future', null, null), 422, 'invalid'],
    ['recordStockCount', new Refusal('23514', 'a moment is not before the facility was recorded', 'stock_moment_before_facility', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('23514', 'an override states its reason', 'stock_override_reason_is_stated', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('22023', 'stock is held at one facility: name it', 'stock_facility_required', null, null), 422, 'invalid'],
    ['recordStockAdjustment', new Refusal('P0002', `no conversion ${BOX}`, 'item_unit_exists', null, null), 404, 'not_found'],
    ['reverseStockDecision', new Refusal('P0002', `no stock decision ${TARGET} at WH-001`, 'stock_decision_exists', null, null), 404, 'not_found'],
    ['recordStockCount', new Refusal('P0002', `no facility ${WAREHOUSE}`, 'facility_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await stock(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own stock retry check is answered as a retry', async () => {
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "stock_decision_pkey"',
    'stock_decision_pkey', 'Key (decision_id)=(…) already exists.', null, false);
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw native; } });
    const response = await stock(post(path, body), deps(db));
    assert.equal(response.status, 409, method);
    assert.deepEqual(await response.json(), {
      status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'stock_decision_pkey',
    }, `${method}: a native collision is a conflict, in the edge's words, with no row printed`);
  }
});

test('a stock read without a facility, or refused for want of permission, says so; another facility\'s decision is 404; an error says nothing', async () => {
  const unnamed = new Refusal('22023', 'stock is held at one facility: name it', 'stock_facility_required', null, null);
  const none = await stock(get(''), deps(fakeDb(ADMIN, { stockOnHand: async () => { throw unnamed; } })));
  assert.equal(none.status, 422);
  assert.equal((await json(none))['constraint'], 'stock_facility_required');

  const gate = new Refusal('23001', 'person may not read on capability inventory.stock here', null, null, null);
  const refused = await stock(get(`?facility_id=${FACTORY}`), deps(fakeDb(MANAGER, { stockOnHand: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const elsewhere = new Refusal('P0002', `no stock decision ${STAMP} at FA`, 'stock_decision_exists', null, null);
  const other = await stock(get(`/decisions/${STAMP}?facility_id=${FACTORY}`),
    deps(fakeDb(ADMIN, { getStockDecision: async () => { throw elsewhere; } })));
  assert.equal(other.status, 404);
  assert.equal((await json(other))['status'], 'not_found');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.stock_balance" does not exist');
    const response = await stock(get(`/items/${ITEM}`), deps(fakeDb(ADMIN, { stockHistory: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
