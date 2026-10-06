import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { FacilitiesDb } from '../facilities-db.ts';
import type { StockDb } from '../stock-db.ts';
import type { Notification, NotificationsDb } from '../notifications-db.ts';
import { notifications } from '../notifications.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'ef'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const N1 = '01936f00-0000-7000-8000-0000000f2101';
const N2 = '01936f00-0000-7000-8000-0000000f2102';
const DECISION = '01936f00-0000-7000-8000-000000005708';

const ROW: Notification = {
  notification_id: N1, seq: '9007199254740993', kind: 'stock_below_zero', facility_id: FACTORY, facility_code: 'FA-001',
  stock_decision_id: DECISION, created_at: '2026-10-06T08:00:00.123Z', read_at: null,
  items: [{
    item_id: '01936f00-0000-7000-8000-000000004102', code: 'SF-CHK-STRIPS', name_en: 'Chicken strips',
    name_ar: 'شرائح دجاج', base_unit_key: 'piece', on_hand: '-28',
  }],
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
  stockOnHand: true, stockHistory: true, getStockDecision: true, recordStockAdjustment: true,
  recordStockCount: true, reverseStockDecision: true,
});

/** A notifications database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<NotificationsDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: keyof NotificationsDb) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'listNotifications') return [ROW];
    if (method === 'countUnreadNotifications') return 3;
    return 2;
  };
  const session: SessionAnswer = person === null
    ? { status: 'invalid' }
    : { status: 'ok', person_id: person, expires_at: '2026-10-06T20:00:00+00:00' };
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
    listNotifications: record('listNotifications') as NotificationsDb['listNotifications'],
    countUnreadNotifications: record('countUnreadNotifications') as NotificationsDb['countUnreadNotifications'],
    markNotificationsRead: record('markNotificationsRead') as NotificationsDb['markNotificationsRead'],
  };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/notifications';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// --- the actor ---------------------------------------------------------------

test('CONTROL: every notification route asks as the signed-in person, whatever the request names', async () => {
  const forged = { actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN, recipient_id: ADMIN };
  const query = new URLSearchParams({ ...forged, facility_id: WAREHOUSE }).toString();
  for (const [method, request] of [
    ['listNotifications', get(`?${query}`, { ...auth, 'x-actor-id': ADMIN })],
    ['countUnreadNotifications', get(`/unread?${query}`, { ...auth, 'x-actor-id': ADMIN })],
    ['markNotificationsRead', post('/read', { ...forged, facility_id: WAREHOUSE, notification_ids: [N1] }, { ...auth, 'x-actor-id': ADMIN })],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await notifications(request, deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} asked as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('without a session nothing reaches a notification route', async () => {
  for (const request of [get('', {}), get('/unread', {}), post('/read', { all: true }, {})]) {
    const db = fakeDb(null);
    const response = await notifications(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('the list pages by seq, as text, 30 at a time unless asked, and says where the next page ends', async () => {
  const db = fakeDb(MANAGER);
  const first = await notifications(get(`?facility_id=${FACTORY}`), deps(db));
  assert.deepEqual(db.calls[0]!.args, [{ facilityId: FACTORY, beforeSeq: null, limit: 30 }]);
  assert.deepEqual(await json(first), { status: 'ok', notifications: [ROW], next_before: null },
    'a short page is the last; the items, balances and seq reach the console as the database answered them');

  const full = fakeDb(MANAGER);
  const page = await notifications(get(`?facility_id=${FACTORY}&limit=1&before=9223372036854775807`), deps(full));
  assert.deepEqual(full.calls[0]!.args, [{ facilityId: FACTORY, beforeSeq: '9223372036854775807', limit: 1 }],
    'the largest int8 travels as text, never through a float');
  assert.equal((await json(page))['next_before'], '9007199254740993', 'a full page ends before its last seq, past 2^53 unrounded');

  const anywhere = fakeDb(ADMIN);
  await notifications(get(''), deps(anywhere));
  assert.deepEqual(anywhere.calls[0]!.args, [{ facilityId: null, beforeSeq: null, limit: 30 }], 'organisation-wide, as any read may ask');
});

test('the count answers a number, at the facility asked', async () => {
  const db = fakeDb(MANAGER);
  const response = await notifications(get(`/unread?facility_id=${WAREHOUSE}`), deps(db));
  assert.deepEqual(db.calls[0]!.args, [WAREHOUSE]);
  assert.deepEqual(await json(response), { status: 'ok', unread: 3 });
});

test('marking names its ids, or says all, and answers how many it marked', async () => {
  const named = fakeDb(MANAGER);
  const one = await notifications(post('/read', { facility_id: FACTORY, notification_ids: [N1, N2] }), deps(named));
  assert.deepEqual(named.calls[0]!.args, [{ facilityId: FACTORY, notificationIds: [N1, N2] }]);
  assert.deepEqual(await json(one), { status: 'ok', marked: 2 });

  const all = fakeDb(MANAGER);
  await notifications(post('/read', { all: true }), deps(all));
  assert.deepEqual(all.calls[0]!.args, [{ facilityId: null, notificationIds: null }], 'all, organisation-wide');

  const again = fakeDb(MANAGER, { markNotificationsRead: async () => 0 });
  const none = await notifications(post('/read', { facility_id: FACTORY, notification_ids: [N1] }), deps(again));
  assert.deepEqual([none.status, await json(none)], [200, { status: 'ok', marked: 0 }],
    'marking one already read marks nothing and is no error: a retry or a second tab asks the same');
});

test('CONTROL: an empty, missing or doubled mark is malformed, never read as "all"', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `01936f00-0000-7000-8000-${String(i).padStart(12, '0')}`);
  for (const [body, field] of [
    [{}, 'notification_ids'],
    [{ notification_ids: [] }, 'notification_ids'],
    [{ notification_ids: null }, 'notification_ids'],
    [{ notification_ids: ids }, 'notification_ids'],
    [{ notification_ids: N1 }, 'notification_ids'],
    [{ notification_ids: [N1, 'nope'] }, 'notification_ids[1]'],
    [{ notification_ids: [N1, 7] }, 'notification_ids[1]'],
    [{ all: false }, 'all'],
    [{ all: 'true' }, 'all'],
    [{ all: true, notification_ids: [N1] }, 'notification_ids'],
    [{ all: true, notification_ids: [] }, 'notification_ids'],
    [{ all: true, facility_id: 'nope' }, 'facility_id'],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await notifications(post('/read', body), deps(db));
    assert.deepEqual([response.status, await json(response)], [400, { status: 'malformed', field }], JSON.stringify(body));
    assert.deepEqual(db.calls, [], JSON.stringify(body));
  }
  const limit = fakeDb(MANAGER);
  const hundred = await notifications(post('/read', { notification_ids: ids.slice(0, 100) }), deps(limit));
  assert.equal(hundred.status, 200, 'a hundred is the most');
});

test('a malformed query is a 400 naming its field, and nothing reaches the database', async () => {
  for (const [path, field] of [
    ['?limit=0', 'limit'], ['?limit=101', 'limit'], ['?limit=2.5', 'limit'], ['?limit=ten', 'limit'],
    ['?before=0', 'before'], ['?before=-1', 'before'], ['?before=1.5', 'before'], ['?before=01', 'before'],
    ['?before=9223372036854775808', 'before'], ['?before=2026-10-06T08:00:00Z', 'before'],
    ['?facility_id=nope', 'facility_id'], ['/unread?facility_id=nope', 'facility_id'],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await notifications(get(path), deps(db));
    assert.deepEqual([response.status, await json(response)], [400, { status: 'malformed', field }], path);
    assert.deepEqual(db.calls, [], path);
  }
});

test('a path that is no route is 404, and nothing is edited or deleted', async () => {
  for (const request of [
    get('/read'), get(`/${N1}`), post('', { all: true }), post('/unread', { all: true }), post(`/${N1}/read`, {}),
    new Request(`${base}/${N1}`, { method: 'DELETE', headers: auth }),
    new Request(`${base}/read`, { method: 'PATCH', headers: auth }),
  ]) {
    const db = fakeDb(MANAGER);
    const response = await notifications(request, deps(db));
    assert.ok(response.status === 404 || response.status === 405, `${request.method} ${request.url}: ${response.status}`);
    assert.deepEqual(db.calls, []);
  }
});

test('a mark body past a form\'s 8 KiB is 413', async () => {
  const db = fakeDb(MANAGER);
  const response = await notifications(post('/read', { all: true, padding: 'x'.repeat(9000) }), deps(db));
  assert.equal(response.status, 413);
  assert.deepEqual(db.calls, []);
});

// --- refusals ------------------------------------------------------------------

test('each kind of refusal is answered as the person can act on it, and an error says nothing', async () => {
  const cases: Array<[keyof NotificationsDb, Request, Refusal, number, string]> = [
    ['listNotifications', get(`?facility_id=${WAREHOUSE}`),
      new Refusal('23001', 'person may not read on capability platform.notifications here', null, null, null), 403, 'forbidden'],
    ['countUnreadNotifications', get('/unread'),
      new Refusal('23001', 'capability platform.notifications is hidden', null, null, null), 403, 'forbidden'],
    ['markNotificationsRead', post('/read', { all: true }),
      new Refusal('23001', 'person may not read on capability platform.notifications here', null, null, null), 403, 'forbidden'],
    ['listNotifications', get('?limit=100'),
      new Refusal('22023', 'a page holds 1 to 100 notifications', 'notification_page_size', null, null), 422, 'invalid'],
    ['markNotificationsRead', post('/read', { notification_ids: [N1] }),
      new Refusal('22023', 'mark 1 to 100 notifications, or all of them', 'notification_page_size', null, null), 422, 'invalid'],
    ['listNotifications', get(`?facility_id=${WAREHOUSE}`),
      new Refusal('P0002', `no facility ${WAREHOUSE}`, 'facility_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, request, refusal, http, status] of cases) {
    const db = fakeDb(MANAGER, { [method]: async () => { throw refusal; } });
    const response = await notifications(request, deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
  }

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.notification" does not exist');
    const response = await notifications(get(''), deps(fakeDb(MANAGER, { listNotifications: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
