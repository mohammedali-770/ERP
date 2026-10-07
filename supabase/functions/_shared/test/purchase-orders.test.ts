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
import type { PurchaseOrderRow, PurchaseOrdersDb } from '../purchase-orders-db.ts';
import { purchaseOrders } from '../purchase-orders.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'ab'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const SUPPLIER = '01936f00-0000-7000-8000-000000005101';
const ORDER = '01936f00-0000-7000-8000-000000005901';
const CARTON = '01936f00-0000-7000-8000-000000004203';
const RECEIPT = '01936f00-0000-7000-8000-0000000f0301';
const STAMP = '01936f00-0000-7000-8000-000000006101';
const D1 = '01936f00-0000-7000-8000-0000000f0302';

const ROW: PurchaseOrderRow = {
  purchase_order_id: ORDER, seq: '7', number: 'PO-1', business_date: '2026-09-30', state: 'pending', progress: 'none',
  supplier_id: SUPPLIER, supplier_code: 'SUP-POULTRY', supplier_name_en: 'Poultry', supplier_name_ar: 'دواجن',
  currency: 'SAR', vat_rate_bp: 1500, subtotal_minor: 750000, vat_minor: 112500, total_minor: 862500, line_count: 1,
  raised_by: MANAGER, raised_at: '2026-09-30T05:00:00.000Z', as_of_decision_id: STAMP,
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

const METHODS: readonly (keyof PurchaseOrdersDb)[] = [
  'purchaseOrders', 'getPurchaseOrder', 'purchaseLimitHistory', 'raisePurchaseOrder', 'decidePurchaseOrder',
  'receivePurchaseOrder', 'reversePurchaseReceipt', 'setPurchaseLimit', 'clearPurchaseLimit',
];

/** A purchase-orders database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<PurchaseOrdersDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: keyof PurchaseOrdersDb) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'purchaseOrders') return [ROW];
    if (method === 'getPurchaseOrder') return { ...ROW, lines: [], decisions: [], receipts: [] };
    if (method === 'purchaseLimitHistory') return [{ decision_id: STAMP, seq: '3', kind: 'limit_set', limit_minor: 500000, is_current: true }];
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
    ...stockAlertsNotUsed,
    ...Object.fromEntries(METHODS.map((m) => [m, record(m)])) as unknown as PurchaseOrdersDb,
  };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/purchase-orders';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const RAISE = {
  decision_id: D1, purchase_order_id: ORDER, facility_id: WAREHOUSE, supplier_id: SUPPLIER, vat_rate_bp: 1500,
  lines: [{ item_unit_id: CARTON, quantity: '2.5', price_minor: 12500 }], reason: 'The week\'s chicken.',
};
const DECIDE = { decision_id: D1, facility_id: WAREHOUSE, reason: 'Within the month\'s budget.' };
const RECEIVE = {
  decision_id: D1, facility_id: WAREHOUSE, received_at: '2026-10-07T09:30:00+03:00',
  lines: [{ line_no: 1, quantity: '1.5' }], delivery_note: 'DN-1001',
};
const REVERSE = { decision_id: D1, facility_id: WAREHOUSE, reason: 'Received against the wrong order.', override_reason: null };
const SET_LIMIT = {
  decision_id: D1, facility_id: WAREHOUSE, limit_minor: 800000, currency: 'SAR', expected_decision_id: STAMP,
  reason: 'A busier month.',
};
const CLEAR_LIMIT = { decision_id: D1, facility_id: WAREHOUSE, expected_decision_id: STAMP, reason: 'Every order to the manager.' };

const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['raisePurchaseOrder', '', RAISE],
  ['decidePurchaseOrder', `/${ORDER}/approve`, DECIDE],
  ['decidePurchaseOrder', `/${ORDER}/reject`, DECIDE],
  ['decidePurchaseOrder', `/${ORDER}/cancel`, DECIDE],
  ['decidePurchaseOrder', `/${ORDER}/close`, DECIDE],
  ['receivePurchaseOrder', `/${ORDER}/receipts`, RECEIVE],
  ['reversePurchaseReceipt', `/receipts/${RECEIPT}/reverse`, REVERSE],
  ['setPurchaseLimit', '/limits', SET_LIMIT],
  ['clearPurchaseLimit', '/limits/clear', CLEAR_LIMIT],
];

const without = (body: Record<string, unknown>, field: string) =>
  Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));

// --- the actor ---------------------------------------------------------------

test('CONTROL: every purchase-orders write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN, raised_by: ADMIN };
    const response = await purchaseOrders(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal(db.calls.length, 1, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${path} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${path} passed no forged id`);
  }
});

test('every purchase-orders read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [['purchaseOrders', ''], ['getPurchaseOrder', `/${ORDER}`], ['purchaseLimitHistory', '/limits']] as const) {
    const db = fakeDb(MANAGER);
    const response = await purchaseOrders(get(`${path}?facility_id=${WAREHOUSE}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(WAREHOUSE), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a purchase-orders route', async () => {
  for (const request of [get('', {}), get(`/${ORDER}`, {}), get('/limits', {}), ...WRITES.map(([, path, body]) => post(path, body, {}))]) {
    const db = fakeDb(null);
    const response = await purchaseOrders(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const decide = (kind: string) => ({ decisionId: D1, facilityId: WAREHOUSE, purchaseOrderId: ORDER, kind, reason: DECIDE.reason });
  const expected: Record<string, unknown> = {
    '': {
      decisionId: D1, purchaseOrderId: ORDER, facilityId: WAREHOUSE, supplierId: SUPPLIER, vatRateBp: 1500,
      lines: [{ item_unit_id: CARTON, quantity: '2.5', price_minor: 12500 }], reason: RAISE.reason,
    },
    [`/${ORDER}/approve`]: decide('order_approved'),
    [`/${ORDER}/reject`]: decide('order_rejected'),
    [`/${ORDER}/cancel`]: decide('order_cancelled'),
    [`/${ORDER}/close`]: decide('order_closed'),
    [`/${ORDER}/receipts`]: {
      decisionId: D1, facilityId: WAREHOUSE, purchaseOrderId: ORDER, receivedAt: '2026-10-07T09:30:00+03:00',
      lines: [{ line_no: 1, quantity: '1.5' }], deliveryNote: 'DN-1001',
    },
    [`/receipts/${RECEIPT}/reverse`]: {
      decisionId: D1, facilityId: WAREHOUSE, receiptDecisionId: RECEIPT, reason: REVERSE.reason, overrideReason: null,
    },
    '/limits': {
      decisionId: D1, facilityId: WAREHOUSE, limitMinor: 800000, currency: 'SAR', expectedDecisionId: STAMP,
      reason: SET_LIMIT.reason,
    },
    '/limits/clear': { decisionId: D1, facilityId: WAREHOUSE, expectedDecisionId: STAMP, reason: CLEAR_LIMIT.reason },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await purchaseOrders(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[path]], `${method} ${path}`);
    const answer = await json(response);
    assert.equal(answer['status'], 'ok');
    assert.equal(answer['decision_id'], D1, `${path} answers with its decision id`);
  }
  const raised = await json(await purchaseOrders(post('', RAISE), deps(fakeDb(ADMIN))));
  assert.equal(raised['purchase_order_id'], ORDER, 'a raise answers with the order\'s id too');
});

test('CONTROL: the decision is the path, never the body', async () => {
  const db = fakeDb(ADMIN);
  await purchaseOrders(post(`/${ORDER}/cancel`, { ...DECIDE, kind: 'order_approved', state: 'approved' }), deps(db));
  assert.equal((db.calls[0]!.args[0] as { kind: string }).kind, 'order_cancelled');
});

test('CONTROL: a line carries on only its pack, quantity and price; a receipt line only its line and quantity', async () => {
  const raise = fakeDb(ADMIN);
  await purchaseOrders(post('', {
    ...RAISE,
    lines: [{ item_unit_id: CARTON, quantity: '2', price_minor: 100, supplier_item_id: STAMP, amount_minor: 1, state: 'approved' }],
  }), deps(raise));
  assert.deepEqual((raise.calls[0]!.args[0] as { lines: unknown }).lines, [{ item_unit_id: CARTON, quantity: '2', price_minor: 100 }]);
  const receive = fakeDb(ADMIN);
  await purchaseOrders(post(`/${ORDER}/receipts`, {
    ...RECEIVE, lines: [{ line_no: 1, quantity: '1', item_unit_id: CARTON, direction: 'out' }],
  }), deps(receive));
  assert.deepEqual((receive.calls[0]!.args[0] as { lines: unknown }).lines, [{ line_no: 1, quantity: '1' }],
    'no receipt line can name a pack: it arrives in the one ordered');
});

test('a receipt with no moment is now, and a limit set where none ever was states null', async () => {
  const now = fakeDb(ADMIN);
  await purchaseOrders(post(`/${ORDER}/receipts`, without(without(RECEIVE, 'received_at'), 'delivery_note')), deps(now));
  const r = now.calls[0]!.args[0] as { receivedAt: unknown; deliveryNote: unknown };
  assert.deepEqual([r.receivedAt, r.deliveryNote], [null, null]);
  const first = fakeDb(ADMIN);
  assert.equal((await purchaseOrders(post('/limits', { ...SET_LIMIT, expected_decision_id: null }), deps(first))).status, 200);
  assert.equal((first.calls[0]!.args[0] as { expectedDecisionId: unknown }).expectedDecisionId, null);
});

test('an amount travels as the whole number sent, and a quantity as its text', async () => {
  for (const q of ['0.1', '0.29', '2.5', '0', '999999999999.999999', '007']) {
    const db = fakeDb(ADMIN);
    await purchaseOrders(post('', { ...RAISE, lines: [{ item_unit_id: CARTON, quantity: q, price_minor: 1999 }] }), deps(db));
    assert.deepEqual((db.calls[0]!.args[0] as { lines: unknown }).lines, [{ item_unit_id: CARTON, quantity: q, price_minor: 1999 }], q);
  }
  // A price above 0023's cap is still a whole number here, and 0023's to refuse.
  const big = fakeDb(ADMIN);
  await purchaseOrders(post('', { ...RAISE, lines: [{ item_unit_id: CARTON, quantity: '1', price_minor: 9007199254740991 }] }), deps(big));
  assert.equal(big.calls.length, 1);
  const answer = await json(await purchaseOrders(get(`?facility_id=${WAREHOUSE}`), deps(fakeDb(ADMIN))));
  const row = answer['orders'][0];
  assert.deepEqual([row.subtotal_minor, row.vat_minor, row.total_minor, row.vat_rate_bp], [750000, 112500, 862500, 1500],
    'the answer carries amounts as numbers');
});

test('the reads pass their ids, state and facility, and page by seq', async () => {
  const rows = [ROW, { ...ROW, purchase_order_id: RECEIPT, seq: '5' }];
  const paged = fakeDb(ADMIN, { purchaseOrders: async () => rows });
  const page = await json(await purchaseOrders(get(`?facility_id=${WAREHOUSE}&state=pending&before=9&limit=2`), deps(paged)));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: WAREHOUSE, state: 'pending', beforeSeq: '9', limit: 2 }]);
  assert.equal(page['next_before'], '5', 'a full page names the seq the next one ends before');
  const short = await json(await purchaseOrders(get(`?facility_id=${WAREHOUSE}&limit=3`),
    deps(fakeDb(ADMIN, { purchaseOrders: async () => rows }))));
  assert.equal(short['next_before'], null, 'CONTROL: a short page has no older one');

  const defaults = fakeDb(ADMIN);
  await purchaseOrders(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, state: null, beforeSeq: null, limit: 100 }],
    'with no facility the edge asks with none, and 0023 refuses it');

  const one = fakeDb(ADMIN);
  const o = await json(await purchaseOrders(get(`/${ORDER}?facility_id=${WAREHOUSE}`), deps(one)));
  assert.deepEqual(one.calls[0]!.args, [WAREHOUSE, ORDER]);
  assert.equal(o['order'].purchase_order_id, ORDER);

  const limits = fakeDb(ADMIN);
  const l = await json(await purchaseOrders(get(`/limits?facility_id=${WAREHOUSE}&limit=1`), deps(limits)));
  assert.deepEqual(limits.calls[0]!.args, [{ facilityId: WAREHOUSE, beforeSeq: null, limit: 1 }]);
  assert.deepEqual([l['decisions'][0].limit_minor, l['next_before']], [500000, '3']);
});

test('a path that is no route is 404 before any field is read, and nothing is deleted', async () => {
  for (const request of [
    get(`/${ORDER}/approve`), get(`/${ORDER}/receipts`), get('/receipts'), get(`/limits/clear`), get(`/${ORDER}/x`),
    post(`/${ORDER}`, RAISE), post(`/${ORDER}/approve/x`, DECIDE), post(`/${ORDER}/pay`, DECIDE), post(`/${ORDER}/decide`, DECIDE),
    post(`/${ORDER}/paid`, DECIDE), post(`/${ORDER}/hold`, DECIDE), post('/receipts', REVERSE), post(`/receipts/${RECEIPT}`, REVERSE),
    post(`/receipts/${RECEIPT}/cancel`, REVERSE), post('/limits/x', SET_LIMIT), post('/limits/clear/x', CLEAR_LIMIT),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await purchaseOrders(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await purchaseOrders(new Request(`${base}/${ORDER}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete: an order is cancelled, rejected or closed, by a decision');
});

// --- shape -------------------------------------------------------------------

test('a malformed purchase-orders field is a 400 naming it, and nothing reaches the database', async () => {
  const line = (l: Record<string, unknown>) => ({ ...RAISE, lines: [{ item_unit_id: CARTON, quantity: '1', price_minor: 100, ...l }] });
  const rline = (l: Record<string, unknown>) => ({ ...RECEIVE, lines: [{ line_no: 1, quantity: '1', ...l }] });
  const cases: Array<[Request, string]> = [
    [get('?facility_id=nope'), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?before=0'), 'before'],
    [get('?before=9223372036854775808'), 'before'],
    [get(`?state=${'x'.repeat(17)}`), 'state'],
    [get('/not-a-uuid'), 'purchase_order_id'],
    [get(`/${ORDER}?facility_id=nope`), 'facility_id'],
    [get('/limits?before=1.5'), 'before'],
    [post('', { ...RAISE, decision_id: 'x' }), 'decision_id'],
    [post('', without(RAISE, 'purchase_order_id')), 'purchase_order_id'],
    // A write names its facility: an order goes to one, and 0023 asks permission there.
    [post('', without(RAISE, 'facility_id')), 'facility_id'],
    [post('', without(RAISE, 'supplier_id')), 'supplier_id'],
    // An amount and a rate are whole numbers sent as numbers: never text, never a fraction.
    [post('', { ...RAISE, vat_rate_bp: '1500' }), 'vat_rate_bp'],
    [post('', { ...RAISE, vat_rate_bp: 15.5 }), 'vat_rate_bp'],
    [post('', without(RAISE, 'vat_rate_bp')), 'vat_rate_bp'],
    // The driver casts a rate to integer: past int4, PostgreSQL's own cast names no field.
    [post('', { ...RAISE, vat_rate_bp: 3000000000 }), 'vat_rate_bp'],
    [post('', { ...RAISE, vat_rate_bp: -2147483649 }), 'vat_rate_bp'],
    [post('', { ...RAISE, lines: [] }), 'lines'],
    [post('', { ...RAISE, lines: 'x' }), 'lines'],
    [post('', { ...RAISE, lines: [null] }), 'lines[0]'],
    [post('', line({ item_unit_id: 'carton' })), 'lines[0].item_unit_id'],
    [post('', line({ quantity: 2 })), 'lines[0].quantity'],
    [post('', line({ quantity: '1e3' })), 'lines[0].quantity'],
    [post('', line({ quantity: '-1' })), 'lines[0].quantity'],
    [post('', line({ quantity: '2,5' })), 'lines[0].quantity'],
    [post('', line({ price_minor: '12500' })), 'lines[0].price_minor'],
    [post('', line({ price_minor: 125.5 })), 'lines[0].price_minor'],
    [post('', line({ price_minor: null })), 'lines[0].price_minor'],
    [post('', line({ price_minor: 2 ** 53 })), 'lines[0].price_minor'],
    [post('', without(RAISE, 'reason')), 'reason'],
    [post(`/${ORDER}/approve`, without(DECIDE, 'facility_id')), 'facility_id'],
    [post(`/${ORDER}/reject`, without(DECIDE, 'reason')), 'reason'],
    [post('/not-a-uuid/approve', DECIDE), 'purchase_order_id'],
    [post('/not-a-uuid/receipts', RECEIVE), 'purchase_order_id'],
    [post(`/${ORDER}/receipts`, { ...RECEIVE, received_at: '2026-10-07T09:30:00' }), 'received_at'],
    // The edge bounds a note's size; that it is 64 characters once trimmed is 0023's rule.
    [post(`/${ORDER}/receipts`, { ...RECEIVE, delivery_note: 'x'.repeat(501) }), 'delivery_note'],
    [post(`/${ORDER}/receipts`, { ...RECEIVE, delivery_note: 7 }), 'delivery_note'],
    [post(`/${ORDER}/receipts`, rline({ line_no: '1' })), 'lines[0].line_no'],
    [post(`/${ORDER}/receipts`, rline({ line_no: 0 })), 'lines[0].line_no'],
    [post(`/${ORDER}/receipts`, rline({ line_no: 1.5 })), 'lines[0].line_no'],
    [post(`/${ORDER}/receipts`, rline({ quantity: 1 })), 'lines[0].quantity'],
    [post(`/${ORDER}/receipts`, without(RECEIVE, 'facility_id')), 'facility_id'],
    [post('/receipts/not-a-uuid/reverse', REVERSE), 'receipt_id'],
    [post(`/receipts/${RECEIPT}/reverse`, without(REVERSE, 'reason')), 'reason'],
    [post('/limits', { ...SET_LIMIT, limit_minor: '800000' }), 'limit_minor'],
    [post('/limits', { ...SET_LIMIT, limit_minor: 8000.5 }), 'limit_minor'],
    [post('/limits', without(SET_LIMIT, 'currency')), 'currency'],
    [post('/limits', { ...SET_LIMIT, currency: 'SARS' }), 'currency'],
    // Empty is not none: a stamp field never filled must not pass for a read absence.
    [post('/limits', without(SET_LIMIT, 'expected_decision_id')), 'expected_decision_id'],
    [post('/limits', { ...SET_LIMIT, expected_decision_id: '' }), 'expected_decision_id'],
    [post('/limits/clear', { ...CLEAR_LIMIT, expected_decision_id: null }), 'expected_decision_id'],
    [post('', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await purchaseOrders(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('an order or a receipt is a document of up to 200 lines; a decision or a limit is a form', async () => {
  const full = Array.from({ length: 200 }, (_, i) => ({
    item_unit_id: `01936f00-0000-7000-8000-${String(i).padStart(12, '0')}`, quantity: '999999999999.999999', price_minor: 100000000000,
  }));
  const db = fakeDb(ADMIN);
  assert.equal((await purchaseOrders(post('', { ...RAISE, lines: full, reason: 'ب'.repeat(500) }), deps(db))).status, 200,
    'a full order of 200 lines fits');
  const over = await purchaseOrders(post('', { ...RAISE, lines: [...full, full[0]] }), deps(fakeDb(ADMIN)));
  assert.deepEqual([over.status, (await json(over))['field']], [400, 'lines'], '201 lines is too many');
  // A receipt is a document too: 200 lines of long quantities are past the 8 KiB a form may be.
  const received = Array.from({ length: 200 }, (_, i) => ({ line_no: i + 1, quantity: '999999999999.999999' }));
  const receiptBody = { ...RECEIVE, lines: received };
  assert.ok(JSON.stringify(receiptBody).length > 8 * 1024, 'the receipt is past a form\'s limit');
  const receipt = fakeDb(ADMIN);
  assert.equal((await purchaseOrders(post(`/${ORDER}/receipts`, receiptBody), deps(receipt))).status, 200,
    'a full receipt of 200 lines fits');
  assert.equal(receipt.calls.length, 1);
  // And a document has a limit: past 64 KiB is 413, before anything is read.
  for (const [path, body] of [['', RAISE], [`/${ORDER}/receipts`, RECEIVE]] as const) {
    const big = fakeDb(ADMIN);
    const response = await purchaseOrders(post(path, { ...body, padding: 'x'.repeat(64 * 1024) }), deps(big));
    assert.equal(response.status, 413, `document ${path}`);
    assert.deepEqual(big.calls, [], path);
  }
  for (const [, path, body] of WRITES.filter(([m]) => m !== 'raisePurchaseOrder' && m !== 'receivePurchaseOrder')) {
    const big = fakeDb(ADMIN);
    const response = await purchaseOrders(post(path, { ...body, reason: 'x'.repeat(9000) }), deps(big));
    assert.equal(response.status, 413, path);
    assert.deepEqual(big.calls, [], path);
  }
});

// --- refusals ------------------------------------------------------------------

test('each kind of purchase-orders refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, string, Refusal, number, string]> = [
    ['raisePurchaseOrder', '', new Refusal('23505', 'decision is already recorded', 'purchase_order_decision_pkey', null, 'Read erp.get_purchase_order() to confirm.'), 409, 'already_recorded'],
    [`decidePurchaseOrder`, `/${ORDER}/approve`, new Refusal('23505', 'decision is already recorded', 'purchase_order_decision_pkey', null, null), 409, 'already_recorded'],
    ['receivePurchaseOrder', `/${ORDER}/receipts`, new Refusal('23505', 'decision is already recorded', 'stock_decision_pkey', null, null), 409, 'already_recorded'],
    ['reversePurchaseReceipt', `/receipts/${RECEIPT}/reverse`, new Refusal('23505', 'decision is already recorded', 'stock_decision_pkey', null, null), 409, 'already_recorded'],
    ['setPurchaseLimit', '/limits', new Refusal('23505', 'decision is already recorded', 'purchase_limit_decision_pkey', null, null), 409, 'already_recorded'],
    ['clearPurchaseLimit', '/limits/clear', new Refusal('23505', 'decision is already recorded', 'purchase_limit_decision_pkey', null, null), 409, 'already_recorded'],
    ['raisePurchaseOrder', '', new Refusal('23505', `purchase order ${ORDER} is already raised`, 'purchase_order_raised_once', null, null), 409, 'conflict'],
    ['reversePurchaseReceipt', `/receipts/${RECEIPT}/reverse`, new Refusal('23505', 'stock decision is already reversed', 'stock_already_reversed', null, null), 409, 'conflict'],
    ['setPurchaseLimit', '/limits', new Refusal('23001', 'the approval limit at WH-001 has changed since it was read', 'purchase_limit_stale', null, 'Reload it and apply the change again.'), 409, 'stale'],
    ['decidePurchaseOrder', `/${ORDER}/approve`, new Refusal('23001', 'person may not approve on capability procurement.purchase_orders here', null, null, null), 403, 'forbidden'],
    ['decidePurchaseOrder', `/${ORDER}/approve`, new Refusal('23001', 'purchase order PO-1 was raised by you: someone else approves or rejects it', 'purchase_order_self_approval', null, 'To withdraw your own order, cancel it.'), 422, 'refused'],
    ['decidePurchaseOrder', `/${ORDER}/approve`, new Refusal('23001', 'purchase order PO-1 is approved, not waiting for approval', 'purchase_order_not_pending', null, null), 422, 'refused'],
    ['decidePurchaseOrder', `/${ORDER}/cancel`, new Refusal('23001', 'purchase order PO-1 has goods received against it, and is not cancelled', 'purchase_order_has_receipts', null, null), 422, 'refused'],
    ['decidePurchaseOrder', `/${ORDER}/approve`, new Refusal('23001', 'supplier SUP-OLD is retired and admits no new work', 'supplier_admits_no_new_work', null, null), 422, 'refused'],
    ['raisePurchaseOrder', '', new Refusal('23001', 'line 1: SUP-PACK does not supply PK-MEAL-BOX-M in the pack pack', 'purchase_order_line_not_supplied', null, null), 422, 'refused'],
    ['receivePurchaseOrder', `/${ORDER}/receipts`, new Refusal('23001', 'line 1: 0.5 carton of line 1 is still to come; 1 is more', 'purchase_receipt_exceeds_order', null, null), 422, 'refused'],
    ['receivePurchaseOrder', `/${ORDER}/receipts`, new Refusal('23001', 'purchase order PO-1 is pending: goods are received against an approved order', 'purchase_order_not_approved', null, null), 422, 'refused'],
    ['reversePurchaseReceipt', `/receipts/${RECEIPT}/reverse`, new Refusal('23001', 'RM-RICE was counted since the decision being reversed', 'stock_reversal_counted_since', null, null), 422, 'refused'],
    ['raisePurchaseOrder', '', new Refusal('23514', 'a VAT rate is 0 to 10000 basis points: 1500 is 15%', 'purchase_order_vat_rate_is_known', null, null), 422, 'invalid'],
    ['receivePurchaseOrder', `/${ORDER}/receipts`, new Refusal('23514', 'purchase order PO-1 was raised at 2026-09-30 08:00:00: goods are received against it after that', 'purchase_receipt_before_order', null, null), 422, 'invalid'],
    ['setPurchaseLimit', '/limits', new Refusal('23514', 'a limit is a whole number of halalas, more than nothing: to have none, clear it', 'purchase_limit_is_minor_units', null, null), 422, 'invalid'],
    ['raisePurchaseOrder', '', new Refusal('22023', 'stock is held at a facility: choose one', 'stock_facility_required', null, null), 422, 'invalid'],
    ['decidePurchaseOrder', `/${ORDER}/close`, new Refusal('P0002', `no purchase order ${ORDER}`, 'purchase_order_exists', null, null), 404, 'not_found'],
    ['reversePurchaseReceipt', `/receipts/${RECEIPT}/reverse`, new Refusal('P0002', `no receipt ${RECEIPT}`, 'purchase_receipt_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, path, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, , body] = WRITES.find(([, p]) => p === path)!;
    const response = await purchaseOrders(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own retry check is answered as a retry', async () => {
  for (const [constraint, path] of [['purchase_order_decision_pkey', ''], ['purchase_limit_decision_pkey', '/limits']] as const) {
    const native = new Refusal('23505', `duplicate key value violates unique constraint "${constraint}"`, constraint,
      'Key (decision_id)=(…) already exists.', null, false);
    const method = path === '' ? 'raisePurchaseOrder' : 'setPurchaseLimit';
    const db = fakeDb(ADMIN, { [method]: async () => { throw native; } });
    const [, , body] = WRITES.find(([, p]) => p === path)!;
    const response = await purchaseOrders(post(path, body), deps(db));
    assert.equal(response.status, 409, constraint);
    assert.deepEqual(await response.json(), {
      status: 'conflict', message: 'a value that must be unique is already in use', constraint,
    }, `${constraint}: a native collision is a conflict, in the edge's words, with no row printed`);
  }
});

test('a read without a facility, or refused for want of permission, says so; an error says nothing', async () => {
  const unnamed = new Refusal('22023', 'stock is held at a facility: choose one', 'stock_facility_required', null, null);
  const none = await purchaseOrders(get(''), deps(fakeDb(ADMIN, { purchaseOrders: async () => { throw unnamed; } })));
  assert.equal(none.status, 422);
  assert.equal((await json(none))['constraint'], 'stock_facility_required');

  const gate = new Refusal('23001', 'person may not read on capability procurement.purchase_limits here', null, null, null);
  const refused = await purchaseOrders(get(`/limits?facility_id=${WAREHOUSE}`),
    deps(fakeDb(MANAGER, { purchaseLimitHistory: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.purchase_order" does not exist');
    const response = await purchaseOrders(get(`/${ORDER}?facility_id=${WAREHOUSE}`),
      deps(fakeDb(ADMIN, { getPurchaseOrder: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
