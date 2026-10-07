import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Fetch, type LimitDecision, type PurchaseOrder, type ViewerFacility } from '../src/api.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible } from '../src/navigation.ts';
import {
  clearLimitBody, compareQuantity, currentLimit, decideBody, formatVat, LIMIT_KINDS, limitInput, limitStamp, lineAmount,
  MAX_ORDER_LINES, NO_PURCHASE_RIGHTS, ORDER_DECISION_KINDS, ORDER_DECISIONS, ORDER_PROGRESS, ORDER_STATES, orderActions,
  orderLines, orderTotals, purchaseRights, raiseBody, receiptBody, receiptLines, receiptReversalBody, receiptReversible,
  setLimitBody, vatInput, type DraftOrderLine, type PurchaseRights,
} from '../src/purchase-orders.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import { toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const MIGRATION = read('supabase/migrations/20261007000400_purchase_orders.sql');
const EDGE = read('supabase/functions/_shared/purchase-orders.ts');
const SCREEN = read('apps/console/src/screens/PurchaseOrders.tsx');
const APP = read('apps/console/src/App.tsx');

const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const BRANCH = '01936f00-0000-7000-8000-000000000401';
const SUPPLIER = '01936f00-0000-7000-8000-000000005101';
const ORDER = '01936f00-0000-7000-8000-000000005901';
const CARTON = '01936f00-0000-7000-8000-000000004203';
const BAG = '01936f00-0000-7000-8000-000000004211';
const RECEIPT = '01936f00-0000-7000-8000-0000000c0301';
const STAMP = '01936f00-0000-7000-8000-000000006101';
const ME = '01936f00-0000-7000-8000-000000000904';
const SOMEONE = '01936f00-0000-7000-8000-000000000907';
const D = '01936f00-0000-7000-8000-0000000c0001';

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'ok', decision_id: 'd', orders: [], decisions: [], order: {}, next_before: null }),
      { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
const draft = (itemUnitId: string, quantity: string, price: string): DraftOrderLine => ({ itemUnitId, quantity, price });

// --- the client ----------------------------------------------------------------

test('CONTROL: no purchase-orders call names an actor; a decision is its path; an amount is a number and a quantity text', async () => {
  const f = fake();
  const a = api(f);
  const lines = [{ item_unit_id: CARTON, quantity: '2.5', price_minor: 12500 }];
  await a.raisePurchaseOrder(raiseBody({ decision_id: D, purchase_order_id: ORDER }, {
    facilityId: WAREHOUSE, supplierId: SUPPLIER, vatRateBp: 1500, lines, reason: ' The week\'s chicken. ',
  }));
  for (const d of ORDER_DECISIONS) await a.decidePurchaseOrder(ORDER, d, decideBody({ decision_id: D }, { facilityId: WAREHOUSE, reason: 'Why.' }));
  await a.receivePurchaseOrder(ORDER, receiptBody({ decision_id: D }, {
    facilityId: WAREHOUSE, receivedAt: '2026-10-07T09:30:00+03:00', lines: [{ line_no: 1, quantity: '1.5' }], deliveryNote: '  ',
  }));
  await a.reversePurchaseReceipt(RECEIPT, receiptReversalBody({ decision_id: D }, { facilityId: WAREHOUSE, reason: 'Wrong order.', overrideReason: '' }));
  await a.setPurchaseLimit(setLimitBody({ decision_id: D }, { facilityId: WAREHOUSE, limitMinor: 800000, expectedDecisionId: null, reason: 'First.' }));
  await a.clearPurchaseLimit(clearLimitBody({ decision_id: D }, { facilityId: WAREHOUSE, expectedDecisionId: STAMP, reason: 'None.' }));
  await a.purchaseOrders({ facilityId: WAREHOUSE, state: 'pending', before: '42', limit: 5 });
  await a.purchaseOrders({ facilityId: WAREHOUSE });
  await a.getPurchaseOrder(WAREHOUSE, ORDER);
  await a.purchaseLimitHistory(WAREHOUSE, '7');
  for (const s of f.sent) {
    assert.doesNotMatch(s.url, /actor|person/);
    for (const k of keys(s.body)) assert.doesNotMatch(k, /actor|person|kind|state/, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    'POST /purchase-orders',
    `POST /purchase-orders/${ORDER}/approve`,
    `POST /purchase-orders/${ORDER}/reject`,
    `POST /purchase-orders/${ORDER}/cancel`,
    `POST /purchase-orders/${ORDER}/close`,
    `POST /purchase-orders/${ORDER}/receipts`,
    `POST /purchase-orders/receipts/${RECEIPT}/reverse`,
    'POST /purchase-orders/limits',
    'POST /purchase-orders/limits/clear',
    `GET /purchase-orders?facility_id=${WAREHOUSE}&state=pending&before=42&limit=5`,
    `GET /purchase-orders?facility_id=${WAREHOUSE}`,
    `GET /purchase-orders/${ORDER}?facility_id=${WAREHOUSE}`,
    `GET /purchase-orders/limits?facility_id=${WAREHOUSE}&before=7`,
  ]);
  assert.deepEqual(f.sent[0]!.body, {
    decision_id: D, purchase_order_id: ORDER, facility_id: WAREHOUSE, supplier_id: SUPPLIER, vat_rate_bp: 1500,
    lines: [{ item_unit_id: CARTON, quantity: '2.5', price_minor: 12500 }], reason: 'The week\'s chicken.',
  });
  assert.deepEqual(f.sent[1]!.body, { decision_id: D, facility_id: WAREHOUSE, reason: 'Why.' }, 'no decision word in a body');
  assert.deepEqual(f.sent[5]!.body, {
    decision_id: D, facility_id: WAREHOUSE, received_at: '2026-10-07T09:30:00+03:00', lines: [{ line_no: 1, quantity: '1.5' }],
    delivery_note: null,
  }, 'a blank delivery note is none');
  assert.deepEqual(f.sent[6]!.body, { decision_id: D, facility_id: WAREHOUSE, reason: 'Wrong order.', override_reason: null });
  const first = f.sent[7]!.body as Record<string, unknown>;
  assert.deepEqual(first, { decision_id: D, facility_id: WAREHOUSE, limit_minor: 800000, currency: 'SAR', expected_decision_id: null, reason: 'First.' });
  assert.ok(Object.hasOwn(first, 'expected_decision_id'), 'a first limit states null: the edge refuses one left out');
  assert.deepEqual(f.sent[8]!.body, { decision_id: D, facility_id: WAREHOUSE, expected_decision_id: STAMP, reason: 'None.' });
  // The edge's own routes, which the client's paths must be.
  for (const route of ['POST  /purchase-orders/{purchase_order_id}/approve', 'POST  /purchase-orders/receipts/{receipt_id}/reverse',
    'POST  /purchase-orders/limits/clear', 'GET   /purchase-orders/limits ']) {
    assert.ok(EDGE.includes(route), route);
  }
});

// --- money and quantities -------------------------------------------------------

test('CONTROL: a VAT rate is typed as a percentage and sent as 0023\'s whole basis points', () => {
  assert.match(MIGRATION, /check \(vat_rate_bp between 0 and 10000\)/, '0023: 0 to 10000 basis points');
  for (const [typed, bp] of [['15', 1500], ['0', 0], ['15.5', 1550], ['15.05', 1505], ['100', 10000], ['١٥', 1500], ['5%', 500], [' 7.25 ', 725]] as const) {
    assert.deepEqual(vatInput(typed), { ok: true, value: bp }, typed);
  }
  for (const typed of ['', '100.01', '101', '-1', '15.123', '1e1', '15,5', 'x']) assert.equal(vatInput(typed).ok, false, typed);
  assert.deepEqual([1500, 1550, 1505, 0, 10000].map(formatVat), ['15', '15.5', '15.05', '0', '100']);
});

test('CONTROL: a line\'s amount and an order\'s VAT are worked out in whole halalas, rounded half up, as 0023 rounds them', () => {
  assert.match(MIGRATION, /v_amount := round\(v_qty \* v_price\);/, '0023: round(quantity × price)');
  assert.match(MIGRATION, /v_vat := round\(v_subtotal \* p_vat_rate_bp \/ 10000\)::bigint;/, '0023: round(subtotal × rate / 10000)');
  assert.equal(lineAmount('2.5', 12500), 31250n);
  assert.equal(lineAmount('0.005', 100), 1n, 'half a halala rounds up');
  assert.equal(lineAmount('0.004999', 100), 0n);
  assert.equal(lineAmount('0.333333', 100), 33n);
  assert.equal(lineAmount('999999999999.999999', 100000000000), 99999999999999999900000n, 'past 2^53 without a float');
  assert.deepEqual(orderTotals([{ quantity: '2', price_minor: 12500 }], 1500), { subtotal: 25000n, vat: 3750n, total: 28750n });
  assert.deepEqual(orderTotals([{ quantity: '1', price_minor: 1 }], 5000), { subtotal: 1n, vat: 1n, total: 2n }, 'half a halala of VAT rounds up');
  assert.deepEqual(orderTotals([{ quantity: '20', price_minor: 4500 }, { quantity: '10', price_minor: 3600 }], 0),
    { subtotal: 126000n, vat: 0n, total: 126000n }, 'the seed\'s rice and cola, as 0023 recorded them');
  assert.doesNotMatch(SCREEN, /parseFloat|parseInt|\* 1\b|Number\((?!totals\.|orderTotals\()/,
    'no purchase screen turns a quantity or a price into a float; a total is shown from 0023\'s bigint rule');
});

test('the lines of an order: a pack once each, a quantity above nothing, a price in riyals; a problem names its line', () => {
  assert.match(MIGRATION, /v_qty_text !~ '\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,6\}\)\?\$'/, '0023\'s quantity, which quantityInput holds');
  assert.match(MIGRATION, /jsonb_array_length\(p_lines\) > 200 then\s+raise exception 'an order has 1 to 200 lines'/);
  assert.equal(MAX_ORDER_LINES, 200);
  assert.deepEqual(orderLines([draft(CARTON, ' 2.5 ', '125'), draft(BAG, '١٠', '45.5')]), {
    ok: true, value: [{ item_unit_id: CARTON, quantity: '2.5', price_minor: 12500 }, { item_unit_id: BAG, quantity: '10', price_minor: 4550 }],
  });
  assert.deepEqual(orderLines([]), { ok: false, problem: { kind: 'no_lines' } });
  assert.deepEqual(orderLines(Array.from({ length: 201 }, (_, i) => draft(String(i), '1', '1'))), { ok: false, problem: { kind: 'too_many' } });
  assert.deepEqual(orderLines([draft(CARTON, '1', '1'), draft('', '1', '1')]), { ok: false, problem: { kind: 'pack', line: 2 } });
  assert.deepEqual(orderLines([draft(CARTON, '0', '1')]), { ok: false, problem: { kind: 'quantity', line: 1 } }, 'none is not ordered');
  assert.deepEqual(orderLines([draft(CARTON, '1e3', '1')]), { ok: false, problem: { kind: 'quantity', line: 1 } });
  assert.deepEqual(orderLines([draft(CARTON, '1', '1.005')]), { ok: false, problem: { kind: 'price', line: 1 } }, 'a halala is the smallest coin');
  assert.deepEqual(orderLines([draft(CARTON, '1', '')]), { ok: false, problem: { kind: 'price', line: 1 } }, 'a price is stated, never taken as nothing');
  assert.deepEqual(orderLines([draft(CARTON, '1', '0')]), { ok: true, value: [{ item_unit_id: CARTON, quantity: '1', price_minor: 0 }] },
    'a free line is 0023\'s to allow (0 to 100,000,000,000)');
  assert.deepEqual(orderLines([draft(CARTON, '1', '1'), draft(BAG, '1', '1'), draft(CARTON, '2', '1')]),
    { ok: false, problem: { kind: 'repeat', line: 3, first: 1 } }, '0023 refuses a repeated pack (purchase_order_line_pack_once)');
  assert.deepEqual(orderLines([draft(CARTON, '999999999999', '9999999999')]), { ok: false, problem: { kind: 'line_too_much', line: 1 } });
  assert.deepEqual(orderLines(Array.from({ length: 11 }, (_, i) => draft(String(i), '10000', '99999999.99'))),
    { ok: false, problem: { kind: 'order_too_much' } });
});

test('a receipt\'s lines: what arrived, by order line, never more than is still to come, compared as decimal text', () => {
  const order = { lines: [{ line_no: 1, remaining: '15' }, { line_no: 2, remaining: '9.5' }, { line_no: 3, remaining: '0' }] } as unknown as PurchaseOrder;
  assert.deepEqual(receiptLines(order, { 1: '5', 2: ' ' }), { ok: true, value: [{ line_no: 1, quantity: '5' }] }, 'a blank line did not arrive');
  assert.deepEqual(receiptLines(order, { 2: '9.5' }), { ok: true, value: [{ line_no: 2, quantity: '9.5' }] }, 'all that is left');
  assert.deepEqual(receiptLines(order, { 2: '10' }), { ok: false, problem: { kind: 'exceeds', line: 2 } }, '10 > 9.5, not "10" < "9.5"');
  assert.deepEqual(receiptLines(order, { 1: '16' }), { ok: false, problem: { kind: 'exceeds', line: 1 } });
  assert.deepEqual(receiptLines(order, { 1: '0' }), { ok: false, problem: { kind: 'quantity', line: 1 } });
  assert.deepEqual(receiptLines(order, {}), { ok: false, problem: { kind: 'no_lines' } });
  assert.deepEqual([compareQuantity('10', '9.5'), compareQuantity('9.50', '9.5'), compareQuantity('0.000001', '0')], [1, 0, 1]);
  assert.match(MIGRATION, /constraint = 'purchase_receipt_exceeds_order'/);
});

// --- the limit -------------------------------------------------------------------

const limit = (over: Partial<LimitDecision>): LimitDecision => ({
  decision_id: STAMP, seq: '1', kind: 'limit_set', limit_minor: 500000, currency: 'SAR', reason: 'r', actor_id: SOMEONE,
  decided_at: '2026-10-01T08:00:00.000Z', recorded_at: '2026-10-01T08:00:00.000Z', is_current: true, ...over,
});

test('CONTROL: a limit is set against the decision in force, a clearing included; null only where there never was one', () => {
  assert.equal(limitStamp([]), null);
  const cleared = [limit({ decision_id: D, seq: '2', kind: 'limit_cleared', limit_minor: null, currency: null }), limit({ is_current: false })];
  assert.equal(limitStamp(cleared), D);
  assert.equal(currentLimit(cleared), null);
  assert.equal(currentLimit([limit({})])?.limit_minor, 500000);
  assert.equal(limitStamp([limit({ is_current: false, decision_id: D }), limit({ is_current: false })]), D, 'newest first');
  assert.match(SCREEN, /const stamp = limitStamp\(history\)/, 'the stamp is the history\'s, read by the page');
  assert.equal([...SCREEN.matchAll(/expectedDecisionId: stamp[,\s}]/g)].length, 2, 'set and clear each send the stamp they were handed');
  assert.deepEqual(limitInput('5000'), { ok: true, value: 500000 });
  // 0023's whole range, past a price's ten digits of riyals (found in review).
  assert.deepEqual(limitInput('100000000000'), { ok: true, value: 10_000_000_000_000 });
  assert.deepEqual(limitInput('12345678901.5'), { ok: true, value: 1_234_567_890_150 });
  assert.deepEqual(limitInput('٥٠٠٠٫٢٥'), { ok: true, value: 500025 });
  for (const typed of ['0', '0.00', '', '-1', '1.005', '100000000000.01', '1,000']) assert.equal(limitInput(typed).ok, false, typed);
  assert.match(MIGRATION, /check \(limit_minor between 1 and 10000000000000\)/);
  assert.match(SCREEN, /required maxLength=\{15\} value=\{amount\}/, 'the field holds "100000000000.00"');
});

// --- who may do what -------------------------------------------------------------

const ENTRY = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'purchase_orders')!;
const facility = (id: string, facility_type: string): ViewerFacility =>
  ({ facility_id: id, code: 'X', facility_type, name_en: 'X', name_ar: 'س', brand_id: 'b' });
const viewerWith = (permissions: string[], states: Record<string, string> = {}, preview = false) => ({
  ...toViewer({
    person: { person_id: ME, employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: WAREHOUSE, org_wide: false, facilities: [], brands: [], units: [], permissions,
    states: {
      'procurement.purchase_orders': 'pilot', 'procurement.purchase_limits': 'pilot', 'procurement.suppliers': 'pilot',
      'inventory.items': 'pilot', 'inventory.stock': 'pilot', ...states,
    },
  }),
  preview,
});
const READS = ['procurement.purchase_orders:read', 'procurement.suppliers:read', 'inventory.items:read'];
const rights = (f: ViewerFacility | undefined, v: ReturnType<typeof viewerWith>) => purchaseRights(f, v, ENTRY, itemIsVisible);

test('CONTROL: orders are read where all three of 0023\'s reads are held, and changed only AT a warehouse or a factory', () => {
  assert.deepEqual(ENTRY.alsoReads, ['procurement.suppliers', 'inventory.items']);
  for (const gate of ["'procurement.purchase_orders', 'read'", "'procurement.suppliers', 'read'", "'inventory.items', 'read'"]) {
    assert.ok(MIGRATION.includes(`erp.assert_permitted(p_actor_id, ${gate}, p_facility_id)`), gate);
  }
  const manager = viewerWith([...READS, 'procurement.purchase_orders:write', 'inventory.stock:write']);
  const wh = facility(WAREHOUSE, 'warehouse');
  assert.deepEqual(rights(wh, manager), { sees: true, raises: true, approves: false, receives: true, seesLimits: false, setsLimits: false });
  assert.deepEqual(rights(facility('fa', 'factory'), manager).raises, true);
  for (const where of [undefined, facility(BRANCH, 'branch'), facility('of', 'office')]) {
    assert.deepEqual(rights(where, manager), NO_PURCHASE_RIGHTS, `${where?.facility_type ?? 'organisation-wide'}: 0023 asks at a warehouse or factory`);
  }
  for (const missing of READS) {
    assert.equal(rights(wh, viewerWith(READS.filter((p) => p !== missing))).sees, false, missing);
  }
  assert.equal(rights(wh, viewerWith([...READS, 'procurement.purchase_orders:write'])).receives, false,
    'a receipt moves stock: 0023 asks write on stock too');
  assert.ok(MIGRATION.includes("erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id)"));
  const approver = viewerWith([...READS, 'procurement.purchase_orders:approve', 'procurement.purchase_limits:read']);
  assert.deepEqual(rights(wh, approver), { sees: true, raises: false, approves: true, receives: false, seesLimits: true, setsLimits: false });
  const admin = viewerWith([...READS, 'procurement.purchase_orders:write', 'procurement.purchase_orders:approve', 'inventory.stock:write',
    'procurement.purchase_limits:read', 'procurement.purchase_limits:write']);
  assert.deepEqual(rights(wh, admin), { sees: true, raises: true, approves: true, receives: true, seesLimits: true, setsLimits: true });
  assert.deepEqual(rights(wh, { ...admin, preview: true }), { ...NO_PURCHASE_RIGHTS, sees: true, seesLimits: true }, 'a preview changes nothing');
  assert.equal(rights(wh, viewerWith(admin.permissions as unknown as string[], { 'procurement.purchase_orders': 'read_only' })).raises, false,
    'read only admits no new work');
  assert.equal(rights(wh, viewerWith([...admin.permissions], { 'procurement.purchase_orders': 'read_only' })).approves, false);
  assert.match(APP, /purchase: purchaseRights\(workingFacility\(data\.facilities, facilityId\), viewer, PURCHASE_ORDERS, itemIsVisible\)/);
  assert.match(APP, /seesPurchaseOrders: itemIsVisible\(PURCHASE_ORDERS, viewer\)/);
  // The limit: its own entry, gated by limits' read alone, as 0023's limit read asks.
  const LIMITS = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'purchase_limits')!;
  assert.deepEqual([LIMITS.capability, LIMITS.action, LIMITS.alsoReads], ['procurement.purchase_limits', 'read', undefined]);
  assert.match(MIGRATION, /begin\s+perform erp\.assert_permitted\(p_actor_id, 'procurement\.purchase_limits', 'read', p_facility_id\);\s+perform erp\.assert_stock_facility_named\(p_facility_id\);\s+if p_limit is null/,
    'erp.purchase_limit_history() asks read on limits, and nothing else');
  const limitsOnly = viewerWith(['procurement.purchase_limits:read']);
  assert.equal(itemIsVisible(LIMITS, limitsOnly), true, 'a limit reader who reads no orders has the entry');
  assert.equal(itemIsVisible(ENTRY, limitsOnly), false);
  assert.equal(rights(wh, limitsOnly).seesLimits, true);
  assert.match(APP, /seesPurchaseLimits: itemIsVisible\(PURCHASE_LIMITS, viewer\)/);
  assert.match(APP, /if \(navIdOf\(route\) === 'purchase_limits'\) \{\s+return ctx\.seesPurchaseLimits \? <PurchaseLimits ctx=\{ctx\} \/>/);
  // 0023's gates, which these rights mirror.
  assert.match(MIGRATION, /case when p_kind in \('order_approved', 'order_rejected'\) then 'approve' else 'write' end/);
  assert.ok(MIGRATION.includes("erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'write', p_facility_id)"));
});

const ALL: PurchaseRights = { sees: true, raises: true, approves: true, receives: true, seesLimits: true, setsLimits: true };
const order = (state: PurchaseOrder['state'], progress: PurchaseOrder['progress'], raisedBy = SOMEONE) => ({ state, progress, raised_by: raisedBy });

test('CONTROL: nobody is offered approval of an order they raised (PRC-004); each decision is offered where 0023 would take it', () => {
  assert.deepEqual(orderActions(order('pending', 'none'), ME, ALL, true),
    { approve: true, reject: true, cancel: true, close: false, receive: false });
  assert.deepEqual(orderActions(order('pending', 'none', ME), ME, ALL, true),
    { approve: false, reject: false, cancel: true, close: false, receive: false }, 'their own: cancel, never decide');
  assert.match(MIGRATION, /if o\.raised_by = p_actor_id then\s+raise exception[^;]+constraint = 'purchase_order_self_approval'/);
  assert.deepEqual(orderActions(order('approved', 'none'), ME, ALL, true),
    { approve: false, reject: false, cancel: true, close: false, receive: true });
  assert.deepEqual(orderActions(order('approved', 'partial'), ME, ALL, true),
    { approve: false, reject: false, cancel: false, close: true, receive: true }, 'goods arrived: close, not cancel');
  assert.deepEqual(orderActions(order('approved', 'full'), ME, ALL, true),
    { approve: false, reject: false, cancel: false, close: false, receive: false }, 'nothing left to come or to close');
  for (const s of ['rejected', 'cancelled', 'closed'] as const) {
    assert.deepEqual(Object.values(orderActions(order(s, 'none'), ME, ALL, true)).some(Boolean), false, s);
  }
  assert.deepEqual(orderActions(order('pending', 'none'), ME, ALL, false),
    { approve: false, reject: true, cancel: true, close: false, receive: false }, 'a closed facility takes no approval or receipt');
  assert.deepEqual(Object.values(orderActions(order('pending', 'none'), ME, NO_PURCHASE_RIGHTS, true)).some(Boolean), false);
  assert.equal(receiptReversible({ reversed_by_decision_id: null }, ALL), true);
  assert.equal(receiptReversible({ reversed_by_decision_id: D }, ALL), false, 'once');
  assert.equal(receiptReversible({ reversed_by_decision_id: null }, { ...ALL, receives: false }), false);
  assert.match(SCREEN, /const actions = orderActions\(order, data\.person\.person_id, ctx\.purchase, status !== 'closed'\);/,
    'the page asks for the signed-in person, from the session');
});

// --- where -----------------------------------------------------------------------

test('purchase-order routes parse and format both ways, name no facility, and mark their own entry current', () => {
  const routes: Route[] = [
    { screen: 'purchase_orders' }, { screen: 'purchase_order_new' }, { screen: 'purchase_order', purchaseOrderId: ORDER },
  ];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'purchase_orders', r.screen);
    assert.doesNotMatch(formatRoute(r), new RegExp(WAREHOUSE));
  }
  // The limit is its own entry, so someone who reads no orders can reach it (found in review).
  assert.deepEqual(parseRoute('#purchase_limits'), { screen: 'purchase_limits' });
  assert.equal(formatRoute({ screen: 'purchase_limits' }), '#purchase_limits');
  assert.equal(navIdOf({ screen: 'purchase_limits' }), 'purchase_limits');
  assert.equal(parseRoute('#purchase_orders/limits').screen, 'unknown', 'not an order\'s route: no order id is "limits"');
  assert.equal(parseRoute(`#purchase_orders/${ORDER}/x`).screen, 'unknown');
  assert.equal(parseRoute('#purchase_orders/nope').screen, 'unknown');
  assert.equal(parseRoute(`#purchase_orders/${ORDER.toUpperCase()}`).screen, 'purchase_order');
});

test('the screens read and write only at the facility worked at, and every write is built once', () => {
  assert.doesNotMatch(SCREEN, /ctx\.facilityId|facilityId: ctx\.|data\.facility_id/, 'the facility is stockPlace\'s, never read raw');
  assert.equal([...SCREEN.matchAll(/const place = stockPlace\(ctx\)/g)].length, 4, 'every page asks stockPlace');
  // Sub-forms through the shared lifecycle: decide, receive, reverse, set, clear.
  assert.equal([...SCREEN.matchAll(/useWrite\(ctx,/g)].length, 5);
  assert.equal([...SCREEN.matchAll(/void w\.run\(\(\) => api\.(decidePurchaseOrder|receivePurchaseOrder|reversePurchaseReceipt|setPurchaseLimit|clearPurchaseLimit)\(/g)].length, 5,
    'each built once and handed to run(), so Retry sends it as first sent');
  assert.match(SCREEN, /void w\.run\(\(\) => api\.decidePurchaseOrder\(id, decision, body\)\)/, 'the decision is the path the button names');
  // The new order: sent as built, Retry resends that, Start over looks for the order before minting new ids.
  assert.match(SCREEN, /onRetry=\{\(\) => void send\(sent\.current!\)\}/);
  assert.match(SCREEN, /const found = await api\.getPurchaseOrder\(facilityId, ids\.purchase_order_id\);/);
  assert.match(SCREEN, /formIds\(\['decision_id', 'purchase_order_id'\] as const\)/, 'an order\'s id is minted with its decision (I-1)');
  assert.match(SCREEN, /<fieldset className="plain" disabled=\{locked\}>/, 'locked while a request is out or in doubt');
  assert.match(SCREEN, /writableHere\(ctx\.purchase\.raises, status\)/, 'a closed facility raises nothing');
  assert.match(SCREEN, /x\.status === 'active' && x\.conversion_status === 'active' && x\.item_status === 'active'/,
    'only a current supply, of a current pack and item, is offered');
  assert.match(SCREEN, /api\.listSuppliers\(\{ facilityId, status: 'active', search: q, limit: 20 \}\)/, 'only an active supplier');
  assert.match(SCREEN, /\{!reloading \? \(\s+<div className="actions order-decisions">/, 'after a write the decisions wait for the reload');
  assert.match(SCREEN, /\{!reloading && actions\.receive/);
  assert.match(SCREEN, /maxLength=\{MAX_DELIVERY_NOTE\}/);
  assert.match(MIGRATION, /length\(delivery_note\) between 1 and 64/);
});

// --- words -----------------------------------------------------------------------

test('every constraint 0023 raises for a person to act on is worded, and neither retry key is', () => {
  const unreachable = new Set([
    // Retry keys: a route's is already_recorded; PostgreSQL's own is no "already saved".
    'purchase_order_decision_pkey', 'purchase_limit_decision_pkey',
    // Guards no route reaches: a delete, a change of what is fixed, a state moved back.
    'purchase_order_fixed', 'purchase_order_never_deleted', 'purchase_order_state_moves_forward',
    'purchase_limit_fixed', 'purchase_limit_never_deleted',
    // What the console never sends: a decision word in a body, an unknown state, an odd page size, no order id.
    'purchase_order_decision_kind_is_known', 'purchase_order_state_is_known', 'purchase_page_size', 'purchase_order_id_is_stated',
  ]);
  const raised = [...new Set([...MIGRATION.matchAll(/constraint = '(purchase_\w+)'/g)].map((m) => m[1]!))].filter((c) => !unreachable.has(c));
  assert.ok(raised.length >= 30, raised.join(', '));
  const generic = failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: null, detail: null, field: null }).text;
  for (const c of [...raised, 'stock_receipt_reversed_through_its_order']) {
    const m = failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: c, detail: null, field: null });
    assert.notEqual(m.text, generic, c);
  }
  const messages = read('apps/console/src/messages.ts');
  assert.doesNotMatch(messages, /purchase_(order|limit)_decision_pkey:/, 'a native collision is no "already saved"');
  for (const c of [...messages.matchAll(/^\s+(purchase_\w+): '/gm)].map((m) => m[1]!)) {
    assert.match(MIGRATION, new RegExp(`constraint = '${c}'`), `${c} is one 0023 raises`);
  }
});

test('the states, progress and decision kinds are 0023\'s, and each has a label in both languages', () => {
  const list = (re: RegExp) => re.exec(MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual([...ORDER_STATES], list(/purchase_order_state_is_known check \(state in \(([^)]+)\)\)/));
  assert.deepEqual([...ORDER_DECISION_KINDS], list(/purchase_order_decision_kind_is_known\s+check \(kind in \(([^)]+)\)\)/));
  assert.deepEqual([...LIMIT_KINDS], list(/purchase_limit_decision_kind_is_known check \(kind in \(([^)]+)\)\)/));
  for (const p of ORDER_PROGRESS) assert.match(MIGRATION, new RegExp(`'${p}'`), p);
  const labels = [...ORDER_STATES.map((s) => `po_state_${s}`), ...ORDER_PROGRESS.map((p) => `po_progress_${p}`),
    ...ORDER_DECISION_KINDS.map((k) => `kind_${k}`), ...LIMIT_KINDS.map((k) => `kind_${k}`), 'stock_kind_receipt', 'purchase_orders'];
  for (const l of labels) assert.notEqual(asKey(l), null, l);
});
