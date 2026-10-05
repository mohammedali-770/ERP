import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnexpectedAnswer, type Db, type SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import { asMinor, withMinor, type PriceListRow, type TransferPricesDb } from '../transfer-prices-db.ts';
import { transferPrices } from '../transfer-prices.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'cd'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const ACCOUNTANT = '01936f00-0000-7000-8000-000000000907';
const FACILITY = '01936f00-0000-7000-8000-000000000401';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const UNIT = '01936f00-0000-7000-8000-000000004203';
const PRICE = '01936f00-0000-7000-8000-000000005403';
const D1 = '01936f00-0000-7000-8000-0000000e0101';

const ROW: PriceListRow = {
  item_id: ITEM, code: 'RM-CHICKEN', name_en: 'Chicken', name_ar: 'دجاج', base_unit_key: 'kg',
  item_unit_id: UNIT, unit_key: 'carton', factor: '10', price_id: PRICE, price_minor: 19000, currency: 'SAR',
  effective_from: '2026-09-15T00:00:00+00:00', next_price_id: null, next_price_minor: null, next_effective_from: null,
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

/** A transfer-prices database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<TransferPricesDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'listTransferPrices') return [ROW];
    if (method === 'itemTransferPrices') return [{ price_id: PRICE, price_minor: 19000, in_force: true }];
    if (method === 'transferPriceHistory') return [{ decision_id: D1, kind: 'price_set' }];
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
    ...suppliersNotUsed,
    listTransferPrices: record('listTransferPrices'),
    itemTransferPrices: record('itemTransferPrices'),
    transferPriceHistory: record('transferPriceHistory'),
    setTransferPrice: record('setTransferPrice'),
    withdrawTransferPrice: record('withdrawTransferPrice'),
  } as Db & { calls: Call[] };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/transfer-prices';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const SET = {
  decision_id: D1, price_id: PRICE, item_unit_id: UNIT, price_minor: 19500, currency: 'SAR',
  effective_from: '2026-11-01T00:00:00+03:00', reason: 'Supplier price rise passed on.',
};
const WITHDRAW = { decision_id: D1, reason: 'Entered in error.' };

const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['setTransferPrice', '', SET],
  ['withdrawTransferPrice', `/${PRICE}/withdraw`, WITHDRAW],
];

// --- the actor ---------------------------------------------------------------

test('CONTROL: every transfer-price write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ACCOUNTANT);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await transferPrices(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, ACCOUNTANT, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every transfer-price read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [
    ['listTransferPrices', ''], ['itemTransferPrices', `/items/${ITEM}`], ['transferPriceHistory', `/items/${ITEM}/history`],
  ] as const) {
    const db = fakeDb(ACCOUNTANT);
    const response = await transferPrices(get(`${path}?facility_id=${FACILITY}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, ACCOUNTANT, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(FACILITY), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a transfer-price route', async () => {
  for (const request of [get('', {}), get(`/items/${ITEM}`, {}), post('', SET, {}), post(`/${PRICE}/withdraw`, WITHDRAW, {})]) {
    const db = fakeDb(null);
    const response = await transferPrices(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    setTransferPrice: {
      decisionId: D1, priceId: PRICE, itemUnitId: UNIT, priceMinor: 19500, currency: 'SAR',
      effectiveFrom: '2026-11-01T00:00:00+03:00', reason: 'Supplier price rise passed on.',
    },
    withdrawTransferPrice: { decisionId: D1, priceId: PRICE, reason: 'Entered in error.' },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await transferPrices(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('the price withdrawn is the one the path names, whatever the body says', async () => {
  const other = '01936f00-0000-7000-8000-000000005404';
  const db = fakeDb(ADMIN);
  const response = await transferPrices(post(`/${PRICE}/withdraw`, { ...WITHDRAW, price_id: other }), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls[0]!.args, [{ decisionId: D1, priceId: PRICE, reason: 'Entered in error.' }]);
});

test('a price left without a moment takes effect now: absent or null, never a guess', async () => {
  for (const body of [{ ...SET, effective_from: null }, (({ effective_from: _e, ...rest }) => rest)(SET)]) {
    const db = fakeDb(ADMIN);
    assert.equal((await transferPrices(post('', body), deps(db))).status, 200);
    assert.equal((db.calls[0]!.args[0] as { effectiveFrom: unknown }).effectiveFrom, null);
  }
});

test('the reads pass their ids and facility, and the list pages by item, not by row', async () => {
  const db = fakeDb(ADMIN);
  await transferPrices(get(`/items/${ITEM}?facility_id=${FACILITY}`), deps(db));
  assert.deepEqual(db.calls[0], { method: 'itemTransferPrices', actor: ADMIN, args: [FACILITY, ITEM] });
  const history = fakeDb(ADMIN);
  const body = await json(await transferPrices(get(`/items/${ITEM}/history`), deps(history)));
  assert.deepEqual(history.calls[0], { method: 'transferPriceHistory', actor: ADMIN, args: [null, ITEM] });
  assert.equal(body['decisions'][0].kind, 'price_set');

  // Two items, the first with two packs: three rows, but a full page of two items.
  const rows = [ROW, { ...ROW, item_unit_id: PRICE, unit_key: 'kg', factor: '1' }, { ...ROW, code: 'RM-RICE' }];
  const paged = fakeDb(ADMIN, { listTransferPrices: async () => rows });
  const page = await json(await transferPrices(get(`?facility_id=${FACILITY}&search=chi&after=A&limit=2`), deps(paged)));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: FACILITY, search: 'chi', afterCode: 'A', limit: 2 }]);
  assert.equal(page['prices'].length, 3);
  assert.equal(page['next_after'], 'RM-RICE', 'a page full of items names where the next one starts');
  const twoRowsOneItem = fakeDb(ADMIN, { listTransferPrices: async () => rows.slice(0, 2) });
  const short = await json(await transferPrices(get('?limit=2'), deps(twoRowsOneItem)));
  assert.equal(short['next_after'], null, 'CONTROL: two rows of one item are not a full page of two');
  const defaults = fakeDb(ADMIN);
  await transferPrices(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, search: null, afterCode: null, limit: 100 }]);
});

test('a path that is no route is 404 before any field is read, and there is no delete', async () => {
  for (const request of [
    get('/items'), get(`/${PRICE}`), get(`/items/${ITEM}/prices`), get(`/items/${ITEM}/history/x`),
    get(`/${PRICE}/withdraw`), post('/items', SET), post(`/items/${ITEM}`, SET), post('/items/withdraw', WITHDRAW),
    post(`/${PRICE}`, WITHDRAW), post(`/${PRICE}/delete`, WITHDRAW), post(`/${PRICE}/withdraw/x`, WITHDRAW),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await transferPrices(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await transferPrices(new Request(`${base}/${PRICE}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete, here or in the database');
});

// --- shape -------------------------------------------------------------------

test('a malformed transfer-price field is a 400 naming it, and nothing reaches the database', async () => {
  const cases: Array<[Request, string]> = [
    [get('/items/not-a-uuid'), 'item_id'],
    [get('/items/not-a-uuid/history'), 'item_id'],
    [get('?facility_id=nope'), 'facility_id'],
    [get(`/items/${ITEM}?facility_id=nope`), 'facility_id'],
    [get('?limit=0'), 'limit'],
    [get('?limit=501'), 'limit'],
    [post('', { ...SET, decision_id: 'x' }), 'decision_id'],
    [post('', { ...SET, price_id: undefined }), 'price_id'],
    [post('', { ...SET, item_unit_id: 'carton' }), 'item_unit_id'],
    // An amount is whole minor units, as a JSON number: not text, not riyals, not absent.
    [post('', { ...SET, price_minor: '19500' }), 'price_minor'],
    [post('', { ...SET, price_minor: 195.5 }), 'price_minor'],
    [post('', { ...SET, price_minor: null }), 'price_minor'],
    [post('', { ...SET, price_minor: undefined }), 'price_minor'],
    [post('', { ...SET, price_minor: 2 ** 53 }), 'price_minor'],
    [post('', { ...SET, currency: undefined }), 'currency'],
    [post('', { ...SET, currency: 'RIYAL' }), 'currency'],
    // A moment names its offset: without one, it would be read as UTC.
    [post('', { ...SET, effective_from: '2026-11-01T00:00:00' }), 'effective_from'],
    [post('', { ...SET, effective_from: '2026-11-01' }), 'effective_from'],
    [post('', { ...SET, effective_from: '1 November 2026' }), 'effective_from'],
    [post('', { ...SET, effective_from: '2026-13-01T00:00:00Z' }), 'effective_from'],
    [post('', { ...SET, effective_from: 1793480400000 }), 'effective_from'],
    [post('', { ...SET, reason: undefined }), 'reason'],
    [post('', { ...SET, reason: 'x'.repeat(501) }), 'reason'],
    [post('/not-a-uuid/withdraw', WITHDRAW), 'price_id'],
    [post(`/${PRICE}/withdraw`, { reason: 'r' }), 'decision_id'],
    [post(`/${PRICE}/withdraw`, { decision_id: D1 }), 'reason'],
    [post('', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await transferPrices(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('an amount, a currency or a moment the route refuses is the route\'s to refuse, not the edge\'s', async () => {
  // Negative, past the cap, another currency, a moment in the past: well formed, and 0018's rules.
  for (const body of [
    { ...SET, price_minor: -1 }, { ...SET, price_minor: 100000000001 }, { ...SET, currency: 'USD' },
    { ...SET, effective_from: '2020-01-01T00:00:00Z' }, { ...SET, price_minor: 0 },
  ]) {
    const db = fakeDb(ADMIN);
    assert.equal((await transferPrices(post('', body), deps(db))).status, 200, JSON.stringify(body));
    assert.equal(db.calls.length, 1);
  }
});

test('a form past 8 KiB is 413', async () => {
  const db = fakeDb(ADMIN);
  const response = await transferPrices(post('', { ...SET, reason: 'x'.repeat(9000) }), deps(db));
  assert.equal(response.status, 413);
  assert.deepEqual(db.calls, []);
});

// --- refusals ------------------------------------------------------------------

test('each kind of transfer-price refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, Refusal, number, string]> = [
    ['setTransferPrice', new Refusal('23505', 'decision is already recorded', 'transfer_price_decision_pkey', null, 'Read erp.transfer_price_history()'), 409, 'already_recorded'],
    ['withdrawTransferPrice', new Refusal('23505', 'decision is already recorded', 'transfer_price_decision_pkey', null, null), 409, 'already_recorded'],
    ['setTransferPrice', new Refusal('23505', 'conversion already has a price from 2099-01-01; withdraw that one first', 'transfer_price_one_per_moment', null, null), 409, 'conflict'],
    ['setTransferPrice', new Refusal('23001', 'person may not write on capability inventory.transfer_prices here', null, null, null), 403, 'forbidden'],
    ['setTransferPrice', new Refusal('23514', 'a transfer price takes effect now or later, never before it was set (MNU-015)', 'transfer_price_not_backdated', null, 'An order already placed keeps the price it was placed at.'), 422, 'invalid'],
    ['setTransferPrice', new Refusal('23514', 'transfer prices are in SAR', 'transfer_price_currency_is_known', null, null), 422, 'invalid'],
    ['setTransferPrice', new Refusal('23001', 'that price is already in force from …', 'transfer_price_unchanged', null, null), 422, 'refused'],
    ['setTransferPrice', new Refusal('23001', 'that price is already set from 2099-01-01; withdraw that one first', 'transfer_price_same_as_next', null, null), 422, 'refused'],
    ['setTransferPrice', new Refusal('23001', 'conversion is retired: a price is set for an active pack (I-7)', 'transfer_price_conversion_is_active', null, null), 422, 'refused'],
    ['setTransferPrice', new Refusal('P0002', 'no conversion', 'item_unit_exists', null, null), 404, 'not_found'],
    ['withdrawTransferPrice', new Refusal('23001', 'transfer price is in effect: set a new price instead of withdrawing it', 'transfer_price_in_effect', null, null), 422, 'refused'],
    ['withdrawTransferPrice', new Refusal('23001', 'transfer price is already withdrawn', 'transfer_price_already_withdrawn', null, null), 422, 'refused'],
    ['withdrawTransferPrice', new Refusal('23001', 'withdrawing transfer price leaves the price from … the same as the one before it; withdraw that one first', 'transfer_price_withdrawal_repeats', null, null), 422, 'refused'],
    ['withdrawTransferPrice', new Refusal('P0002', 'no transfer price', 'transfer_price_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await transferPrices(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own transfer-price retry check is answered as a retry', async () => {
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "transfer_price_decision_pkey"',
    'transfer_price_decision_pkey', 'Key (decision_id)=(…) already exists.', null, false);
  const response = await transferPrices(post('', SET), deps(fakeDb(ADMIN, { setTransferPrice: async () => { throw native; } })));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'transfer_price_decision_pkey',
  }, 'a native collision is a conflict, in the edge\'s words, with no row printed');
});

test('a transfer-price read refused for want of permission is 403, and an error is a 500 that says nothing', async () => {
  const gate = new Refusal('23001', 'person may not read on capability inventory.transfer_prices here', null, null, null);
  const refused = await transferPrices(get(`/items/${ITEM}`), deps(fakeDb(ACCOUNTANT, { itemTransferPrices: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.transfer_price" does not exist');
    const response = await transferPrices(get(''), deps(fakeDb(ADMIN, { listTransferPrices: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});

// --- amounts on the way out ------------------------------------------------------

test('an amount answered as int8 text leaves as a whole number, and nothing else is accepted', () => {
  assert.equal(asMinor('r', '18500'), 18500);
  assert.equal(asMinor('r', 0n), 0);
  assert.equal(asMinor('r', 100000000000), 100000000000);
  assert.equal(asMinor('r', null), null);
  for (const bad of ['185.00', '1e5', '', 'NaN', 185.5, '9007199254740993', undefined, {}]) {
    assert.throws(() => asMinor('erp.list_transfer_prices', bad), UnexpectedAnswer, `CONTROL: ${String(bad)} is never guessed at`);
  }
  const row = withMinor<PriceListRow>('r', { ...ROW, price_minor: '19000', next_price_minor: null }, ['price_minor', 'next_price_minor']);
  assert.equal(row.price_minor, 19000);
  assert.equal(row.next_price_minor, null);
  assert.equal(row.factor, '10', 'only the amount fields are touched');
});
