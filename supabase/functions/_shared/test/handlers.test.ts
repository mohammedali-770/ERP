import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asSessionAnswer, asSignInAnswer, asSignOutAnswer, asViewerAnswer, UnexpectedAnswer,
  type Db, type SessionAnswer, type SignInAnswer, type SignOutAnswer, type ViewerAnswer,
} from '../db.ts';
import { bearerToken, endpoint, parseAllowedOrigins, type Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { StockDb } from '../stock-db.ts';
import type { NotificationsDb } from '../notifications-db.ts';
import type { StockAlertsDb } from '../stock-alerts-db.ts';
import type { PurchaseOrdersDb } from '../purchase-orders-db.ts';
import { notUsed } from './not-used.ts';
import { session, signIn, signOut, withSession, type Session } from '../handlers.ts';
import type { FacilitiesDb } from '../facilities-db.ts';

const TOKEN = 'ab'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const CASHIER = '01936f00-0000-7000-8000-000000000901';
const ORIGIN = 'https://console.example.test';
const FACILITY = '01936f00-0000-7000-8000-000000000401';
const VIEWER: ViewerAnswer = {
  person: { person_id: CASHIER }, facility_id: null, org_wide: false, facilities: [],
  permissions: ['inventory.items:read'], states: { 'inventory.items': 'pilot' }, brands: [], units: [],
};

/** The items routes, which these tests never reach. */
const itemsNotUsed = notUsed<ItemsDb>('items', {
  listItems: true, getItem: true, itemHistory: true, createItem: true, amendItem: true,
  changeItemStatus: true, addItemUnit: true, retireItemUnit: true, importItems: true,
});

/** The suppliers routes, which these tests never reach either. */
const suppliersNotUsed = notUsed<SuppliersDb>('suppliers', {
  listSuppliers: true, getSupplier: true, supplierHistory: true, itemSuppliers: true, createSupplier: true,
  amendSupplier: true, changeSupplierStatus: true, setSupplierContact: true, addSupplierItem: true,
  amendSupplierItem: true, retireSupplierItem: true, importSuppliers: true,
});

/** The transfer-price routes, which these tests never reach either. */
const transferPricesNotUsed = notUsed<TransferPricesDb>('transfer prices', {
  listTransferPrices: true, itemTransferPrices: true, transferPriceHistory: true, setTransferPrice: true,
  withdrawTransferPrice: true,
});

/** The facilities routes, which these tests never reach either. */
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
const purchaseOrdersNotUsed = notUsed<PurchaseOrdersDb>('purchase orders', {
  purchaseOrders: true, getPurchaseOrder: true, purchaseLimitHistory: true, raisePurchaseOrder: true,
  decidePurchaseOrder: true, receivePurchaseOrder: true, reversePurchaseReceipt: true, setPurchaseLimit: true,
  clearPurchaseLimit: true,
});

/** A database that records what it was asked and answers what it is told to. */
function fakeDb(answers: {
  signIn?: SignInAnswer;
  session?: SessionAnswer;
  signOut?: SignOutAnswer;
} = {}): Db & { calls: string[] } {
  const calls: string[] = [];
  return {
    ...itemsNotUsed,
    ...suppliersNotUsed,
    ...transferPricesNotUsed,
    ...facilitiesNotUsed,
    ...stockNotUsed,
    ...notificationsNotUsed,
    ...stockAlertsNotUsed,
    ...purchaseOrdersNotUsed,
    calls,
    async signIn(n, p) {
      calls.push(`signIn ${n} ${p}`);
      return answers.signIn ?? { status: 'wrong', attempts_left: 4 };
    },
    async resolveSession(t) {
      calls.push(`resolveSession ${t}`);
      return answers.session ?? { status: 'invalid' };
    },
    async signOut(t) {
      calls.push(`signOut ${t}`);
      return answers.signOut ?? { status: 'invalid' };
    },
    async viewer(person, facility) {
      calls.push(`viewer ${person} ${facility}`);
      return VIEWER;
    },
  };
}

const deps = (db: Db, origins: string[] = [ORIGIN]): Deps => ({ db, allowedOrigins: new Set(origins) });

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://edge.example.test/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(headers: Record<string, string> = {}): Request {
  return new Request('https://edge.example.test/session', { method: 'GET', headers });
}

const bearer = { authorization: `Bearer ${TOKEN}` };

// --- sign-in ---------------------------------------------------------------

test('a correct sign-in returns the database answer, token included, uncached', async () => {
  const answer: SignInAnswer = { status: 'ok', person_id: CASHIER, token: TOKEN, expires_at: '2026-10-03T20:00:00+00:00' };
  const db = fakeDb({ signIn: answer });
  const response = await signIn(post({ employee_number: '1001', pin: '100001' }), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), answer);
  assert.equal(response.headers.get('cache-control'), 'no-store', 'a response carrying a token is never cached');
  assert.deepEqual(db.calls, ['signIn 1001 100001']);
});

test('each refusal maps to its own HTTP status, with the database answer unchanged', async () => {
  const cases: Array<[SignInAnswer, number]> = [
    [{ status: 'wrong', attempts_left: 3 }, 401],
    [{ status: 'locked', locked_until: '2026-10-03T08:15:00+00:00' }, 423],
    [{ status: 'disabled' }, 403],
  ];
  for (const [answer, http] of cases) {
    const response = await signIn(post({ employee_number: '1001', pin: '000000' }), deps(fakeDb({ signIn: answer })));
    assert.equal(response.status, http, answer.status);
    assert.deepEqual(await response.json(), answer);
  }
});

test('a malformed format still reaches the database, which records the attempt', async () => {
  // IAM-008: refusing "12ab" here would answer it without recording it.
  const db = fakeDb();
  const response = await signIn(post({ employee_number: '12ab', pin: '1' }), deps(db));
  assert.equal(response.status, 401);
  assert.deepEqual(db.calls, ['signIn 12ab 1']);
});

test('a body that is not two short strings is refused before the database', async () => {
  for (const body of [
    'not json', '[]', '', { employee_number: 1001, pin: '100001' }, { employee_number: '1001' },
    { employee_number: '1'.repeat(33), pin: '100001' }, 'x'.repeat(2000),
  ]) {
    const db = fakeDb();
    const response = await signIn(post(body), deps(db));
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.deepEqual(await response.json(), { status: 'malformed' });
    assert.deepEqual(db.calls, []);
  }
});

test('CONTROL: an endless body is abandoned at the limit, not buffered', async () => {
  // Sign-in needs no credential, so a body read whole before its size is checked lets
  // anyone make every call hold the platform's largest body (Codex, PR #31).
  let pulled = 0;
  const chunk = new TextEncoder().encode('x'.repeat(256));
  // Endless as far as a reader that does not stop can tell: it fails only past 64 KiB, so a
  // reader that buffers everything gets an error (a 500) instead of hanging the suite.
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= 64 * 1024) return controller.error(new Error('read past 64 KiB'));
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const db = fakeDb();
  const request = new Request('https://edge.example.test/sign-in', {
    method: 'POST', body: endless, duplex: 'half',
  } as RequestInit);
  const response = await signIn(request, deps(db));
  assert.equal(response.status, 400);
  assert.deepEqual(db.calls, []);
  // At most the limit plus the chunk that crossed it, and what the stream pulled ahead.
  assert.ok(pulled <= 1024 + 4 * chunk.byteLength, `read ${pulled} bytes of an endless body`);
});

test('a declared length over the limit is refused without reading the body', async () => {
  // The body itself is a valid sign-in, so only the declared length can refuse it.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('{"employee_number":"1001","pin":"100001"}'));
      controller.close();
    },
  });
  const db = fakeDb();
  const request = new Request('https://edge.example.test/sign-in', {
    method: 'POST', body, duplex: 'half', headers: { 'content-length': '5000' },
  } as RequestInit);
  const response = await signIn(request, deps(db));
  assert.equal(response.status, 400);
  assert.deepEqual(db.calls, [], 'the database is never asked');
});

test('a body that is not UTF-8 is malformed', async () => {
  const request = new Request('https://edge.example.test/sign-in', {
    method: 'POST', body: new Uint8Array([0x7b, 0xff, 0x7d]),
  });
  const response = await signIn(request, deps(fakeDb()));
  assert.equal(response.status, 400);
});

test('sign-in takes POST only', async () => {
  const response = await signIn(get(), deps(fakeDb()));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
});

// --- withSession: the actor comes from the session, never the request ---------

test('no bearer token, or a malformed one, is refused without asking the database', async () => {
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer short' },
    { authorization: `Bearer ${TOKEN.toUpperCase()}` }, { authorization: `Bearer ${TOKEN} extra` }]) {
    const db = fakeDb();
    const response = await session(get(headers), deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { status: 'unauthenticated' });
    assert.deepEqual(db.calls, []);
  }
});

test('each refusal the database gives is passed on, and the handler never runs', async () => {
  for (const status of ['invalid', 'ended', 'expired', 'idle', 'disabled'] as const) {
    let ran = false;
    const handler = endpoint(['POST'], withSession(async () => {
      ran = true;
      return { http: 200, body: {} };
    }));
    const response = await handler(post({}, bearer), deps(fakeDb({ session: { status } })));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { status });
    assert.equal(ran, false, status);
  }
});

test('CONTROL: the actor is the person the session names, whatever the body says', async () => {
  // A module handler records decisions with session.personId as the actor. If
  // withSession ever read an actor from the request, a branch worker could name the
  // administrator and act as them.
  let seen: Session | undefined;
  const handler = endpoint(['POST'], withSession(async (_request, s) => {
    seen = s;
    return { http: 200, body: { actor: s.personId } };
  }));
  const db = fakeDb({ session: { status: 'ok', person_id: CASHIER, expires_at: '2026-10-03T20:00:00+00:00' } });
  const response = await handler(
    post({ actor_id: ADMIN, person_id: ADMIN, personId: ADMIN }, { ...bearer, 'x-actor-id': ADMIN }),
    deps(db),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actor: CASHIER });
  assert.equal(seen?.personId, CASHIER);
  assert.ok(Object.isFrozen(seen), 'a handler cannot swap the person it was given');
  assert.deepEqual(db.calls, [`resolveSession ${TOKEN}`]);
});

test('the session endpoint names the signed-in person, and what the console should show them', async () => {
  const db = fakeDb({ session: { status: 'ok', person_id: CASHIER, expires_at: '2026-10-03T20:00:00+00:00' } });
  const response = await session(get(bearer), deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok', person_id: CASHIER, expires_at: '2026-10-03T20:00:00+00:00', viewer: VIEWER,
  });
  assert.deepEqual(db.calls, [`resolveSession ${TOKEN}`, `viewer ${CASHIER} null`], 'organisation-wide when no facility is named');
});

test('CONTROL: the viewer is always the session\'s person, at the facility the query names', async () => {
  const db = fakeDb({ session: { status: 'ok', person_id: CASHIER, expires_at: '2026-10-03T20:00:00+00:00' } });
  const request = new Request(`https://edge.example.test/session?facility_id=${FACILITY}&person_id=${ADMIN}`, {
    headers: { ...bearer, 'x-person-id': ADMIN },
  });
  const response = await session(request, deps(db));
  assert.equal(response.status, 200);
  assert.deepEqual(db.calls.at(-1), `viewer ${CASHIER} ${FACILITY}`);
});

test('a malformed facility is refused before the database is asked for a viewer', async () => {
  const db = fakeDb({ session: { status: 'ok', person_id: CASHIER, expires_at: '2026-10-03T20:00:00+00:00' } });
  const response = await session(new Request('https://edge.example.test/session?facility_id=BR-001', { headers: bearer }), deps(db));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: 'malformed', field: 'facility_id' });
  assert.equal(db.calls.some((c) => c.startsWith('viewer')), false);
});

test('a viewer of the wrong shape is an error, not a menu', () => {
  assert.deepEqual(asViewerAnswer(VIEWER), VIEWER);
  assert.throws(() => asViewerAnswer({ ...VIEWER, permissions: [1] }), UnexpectedAnswer);
  assert.throws(() => asViewerAnswer({ ...VIEWER, states: [] }), UnexpectedAnswer);
  assert.throws(() => asViewerAnswer(null), UnexpectedAnswer);
});

// --- sign-out --------------------------------------------------------------

test('sign-out ends the caller\'s own session, and needs its token', async () => {
  const db = fakeDb({ signOut: { status: 'ok' } });
  const ok = await signOut(post({}, bearer), deps(db));
  assert.equal(ok.status, 200);
  assert.deepEqual(db.calls, [`signOut ${TOKEN}`]);

  const none = await signOut(post({}), deps(fakeDb()));
  assert.equal(none.status, 401);
  const unknown = await signOut(post({}, bearer), deps(fakeDb({ signOut: { status: 'invalid' } })));
  assert.equal(unknown.status, 401);
});

// --- origins ---------------------------------------------------------------

test('an origin not on the list is refused before anything runs', async () => {
  const db = fakeDb();
  const response = await signIn(post({ employee_number: '1001', pin: '100001' }, { origin: 'https://evil.example.test' }), deps(db));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { status: 'origin_refused' });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(db.calls, [], 'the database is never asked for a refused origin');
});

test('a listed origin is echoed exactly, never as a wildcard, and preflight is answered', async () => {
  const preflight = await signIn(new Request('https://edge.example.test/sign-in', {
    method: 'OPTIONS', headers: { origin: ORIGIN },
  }), deps(fakeDb()));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization, content-type');

  const response = await signIn(post({ employee_number: '1001', pin: '0' }, { origin: ORIGIN }), deps(fakeDb()));
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('vary'), 'Origin');
});

test('a caller that sends no origin is not a browser and is not refused for it', async () => {
  const response = await signIn(post({ employee_number: '1001', pin: '0' }), deps(fakeDb(), []));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('the allowlist admits exact origins only', () => {
  assert.deepEqual([...parseAllowedOrigins(' https://a.example.test, http://localhost:5173 ,')],
    ['https://a.example.test', 'http://localhost:5173']);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
  assert.equal(parseAllowedOrigins('').size, 0);
  for (const bad of ['*', 'https://a.example.test/', 'https://a.example.test/path', 'a.example.test', 'null']) {
    assert.throws(() => parseAllowedOrigins(bad), /ERP_ALLOWED_ORIGINS/, bad);
  }
});

// --- failures say nothing --------------------------------------------------

test('a database failure is a 500 that names nothing', async () => {
  const db = fakeDb();
  db.signIn = async () => {
    throw Object.assign(new Error('relation "erp.person_credential" does not exist'), { code: '42P01' });
  };
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    const response = await signIn(post({ employee_number: '1001', pin: '100001' }), deps(db));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { status: 'error' });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.doesNotMatch(String(logged[0]), /100001/, 'the PIN is never logged');
});

test('bearerToken reads the scheme case-insensitively and nothing else', () => {
  const r = (h: string) => new Request('https://edge.example.test/', { headers: { authorization: h } });
  assert.equal(bearerToken(r(`bearer ${TOKEN}`)), TOKEN);
  assert.equal(bearerToken(r(`Bearer  ${TOKEN}`)), TOKEN);
  assert.equal(bearerToken(r(`Token ${TOKEN}`)), null);
});

// --- answers from the database are checked ---------------------------------

test('an answer the edge does not know is an error, not a response', () => {
  assert.throws(() => asSignInAnswer({ status: 'ok', person_id: CASHIER }), UnexpectedAnswer, 'ok without a token');
  assert.throws(() => asSignInAnswer({ status: 'maybe' }), UnexpectedAnswer);
  assert.throws(() => asSignInAnswer(null), UnexpectedAnswer);
  assert.throws(() => asSessionAnswer({ status: 'ok' }), UnexpectedAnswer, 'ok without a person');
  assert.throws(() => asSessionAnswer({ status: 'revoked' }), UnexpectedAnswer);
  assert.throws(() => asSignOutAnswer({ status: 'ended' }), UnexpectedAnswer);
});

test('a known answer is passed on with only the fields the edge knows', () => {
  assert.deepEqual(
    asSignInAnswer({ status: 'ok', person_id: CASHIER, token: TOKEN, expires_at: 'x', session_id: 'leak' }),
    { status: 'ok', person_id: CASHIER, token: TOKEN, expires_at: 'x' },
  );
  assert.deepEqual(asSignInAnswer({ status: 'wrong' }), { status: 'wrong' });
  assert.deepEqual(asSignInAnswer({ status: 'wrong', attempts_left: 2 }), { status: 'wrong', attempts_left: 2 });
  assert.deepEqual(asSessionAnswer({ status: 'idle' }), { status: 'idle' });
  assert.deepEqual(asSignOutAnswer({ status: 'ok' }), { status: 'ok' });
});
