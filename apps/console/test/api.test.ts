import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, sessionEnded, type Fetch } from '../src/api.ts';

const TOKEN = 'ab'.repeat(32);
const ITEM = '01936f00-0000-7000-8000-00000000a001';
const FACILITY = '01936f00-0000-7000-8000-000000000401';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly credentials: string | undefined;
}

/** A fetch that records every request and answers from `reply`. */
function fake(reply: (url: string) => { status: number; body: unknown } | Error = () => ({ status: 200, body: { status: 'ok' } })) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init?.credentials,
    });
    const r = reply(url);
    if (r instanceof Error) throw r;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  };
  return { sent, fetch };
}

const api = (f: ReturnType<typeof fake>, token: string | null = TOKEN) =>
  createApi({ base: 'https://edge.test/functions/v1/', fetch: f.fetch, token: () => token });

test('sign-in sends the number and PIN, and no token', async () => {
  const f = fake(() => ({ status: 200, body: { status: 'ok', person_id: 'p', token: TOKEN, expires_at: 'x' } }));
  const answer = await api(f, null).signIn('1001', '100001');
  assert.deepEqual(answer, { ok: true, value: { status: 'ok', person_id: 'p', token: TOKEN, expires_at: 'x' } });
  assert.equal(f.sent[0]!.url, 'https://edge.test/functions/v1/sign-in');
  assert.deepEqual(f.sent[0]!.body, { employee_number: '1001', pin: '100001' });
  assert.equal(f.sent[0]!.headers['authorization'], undefined);
});

test('a wrong PIN, a lock and a disabled account are answers, not failures', async () => {
  const cases: Array<[number, Record<string, unknown>]> = [
    [401, { status: 'wrong', attempts_left: 2 }],
    [423, { status: 'locked', locked_until: '2026-10-04T10:00:00Z' }],
    [403, { status: 'disabled' }],
    [400, { status: 'malformed' }],
  ];
  for (const [status, body] of cases) {
    const answer = await api(fake(() => ({ status, body })), null).signIn('1', '2');
    assert.deepEqual(answer, { ok: true, value: body }, String(status));
  }
});

test('CONTROL: an origin the edge refuses is a failure, though it shares sign-in\'s 403', async () => {
  const answer = await api(fake(() => ({ status: 403, body: { status: 'origin_refused' } })), null).signIn('1', '2');
  assert.equal(answer.ok, false);
  assert.equal(!answer.ok && answer.status, 'origin_refused');
  // A status on the wrong HTTP code is a failure too: 'ok' only ever arrives as 200.
  const odd = await api(fake(() => ({ status: 401, body: { status: 'ok', token: TOKEN } })), null).signIn('1', '2');
  assert.equal(odd.ok, false);
});

test('the token travels in Authorization, never in a URL, and no cookie goes with any call', async () => {
  const f = fake((url) => ({
    status: 200,
    body: url.includes('/history') ? { status: 'ok', decisions: [] }
      : url.includes('/session') ? { status: 'ok', person_id: 'p', expires_at: 'x', viewer: {} }
      : url.endsWith(`/items/${ITEM}?facility_id=${FACILITY}`) ? { status: 'ok', item: {} }
      : { status: 'ok', items: [], next_after: null, decision_id: 'd', created: 0, amended: 0, unchanged: 0 },
  }));
  const a = api(f);
  await a.session(FACILITY);
  await a.listItems({ facilityId: FACILITY, search: 'rice' });
  await a.getItem(FACILITY, ITEM);
  await a.itemHistory(FACILITY, ITEM);
  await a.signOut(TOKEN);
  for (const s of f.sent) {
    assert.equal(s.headers['authorization'], `Bearer ${TOKEN}`, s.url);
    assert.equal(s.url.includes(TOKEN), false, s.url);
    assert.equal(s.credentials, 'omit', s.url);
  }
});

test('CONTROL: no write the console sends names an actor', async () => {
  // The edge takes the actor from the session (ADR-0025). A body that named one would be
  // ignored there — and a client that sent one would be a client that believed it counted.
  const f = fake(() => ({ status: 200, body: { status: 'ok', decision_id: 'd', created: 1, amended: 0, unchanged: 0 } }));
  const a = api(f);
  await a.createItem({
    decision_id: 'd', item_id: 'i', base_unit_decision_id: 'b', base_item_unit_id: 'u', brand_id: 'br', code: 'C',
    item_kind: 'raw_ingredient', base_unit_key: 'g', name_en: 'n', name_ar: 'ن', description_en: null, description_ar: null, reason: 'r',
  });
  await a.amendItem(ITEM, { decision_id: 'd', expected_decision_id: 'e', name_en: 'n', name_ar: 'ن', description_en: null, description_ar: null, picture_path: null, reason: 'r' });
  await a.changeStatus(ITEM, { decision_id: 'd', expected_decision_id: 'e', status: 'retired', reason: 'r' });
  await a.addUnit(ITEM, { decision_id: 'd', item_unit_id: 'u', unit_key: 'kg', factor: '1000', reason: 'r' });
  await a.retireUnit('u', { decision_id: 'd', reason: 'r' });
  await a.importItems('r', [{ code: 'C' }]);
  assert.equal(f.sent.length, 6);
  const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
  for (const s of f.sent) {
    for (const k of keys(s.body)) assert.doesNotMatch(k, /^(actor|person|employee|user)(_id|_number)?$/i, `${s.url}: ${k}`);
    assert.equal(s.method, 'POST');
    assert.equal(s.headers['content-type'], 'application/json');
  }
  assert.deepEqual(f.sent.map((s) => s.url.replace('https://edge.test/functions/v1', '')), [
    '/items', `/items/${ITEM}/amend`, `/items/${ITEM}/status`, `/items/${ITEM}/units`, '/items/units/u/retire', '/items/import',
  ]);
});

test('sign-out sends the token it is given, after the console has already forgotten it', async () => {
  const f = fake(() => ({ status: 200, body: { status: 'ok' } }));
  await api(f, null).signOut(TOKEN);
  assert.equal(f.sent[0]!.headers['authorization'], `Bearer ${TOKEN}`);
  assert.equal(f.sent[0]!.url, 'https://edge.test/functions/v1/sign-out');
});

test('a factor is sent as text, never as a number', async () => {
  const f = fake(() => ({ status: 200, body: { status: 'ok', decision_id: 'd' } }));
  await api(f).addUnit(ITEM, { decision_id: 'd', item_unit_id: 'u', unit_key: 'bag', factor: '25000.5', reason: 'r' });
  assert.equal((f.sent[0]!.body as Record<string, unknown>)['factor'], '25000.5');
});

test('the list query carries only what was set', async () => {
  const f = fake(() => ({ status: 200, body: { status: 'ok', items: [], next_after: 'RM-RICE' } }));
  const answer = await api(f).listItems({ facilityId: null, brandId: null, status: 'all', itemKind: 'packaging', search: '', after: 'B', limit: 50 });
  assert.equal(f.sent[0]!.url, 'https://edge.test/functions/v1/items?status=all&item_kind=packaging&after=B&limit=50');
  assert.deepEqual(answer, { ok: true, value: { items: [], next_after: 'RM-RICE' } });
});

test('a refusal is a failure carrying the edge\'s words', async () => {
  const f = fake(() => ({ status: 409, body: { status: 'conflict', message: 'item code X is already used', constraint: 'item_code_key' } }));
  const answer = await api(f).createItem({} as never);
  assert.deepEqual(answer, {
    ok: false, http: 409, status: 'conflict', message: 'item code X is already used', constraint: 'item_code_key', detail: null, field: null,
  });
});

test('no answer at all is http 0, and a body that is not JSON is an error, never a throw', async () => {
  const lost = await api(fake(() => new TypeError('Failed to fetch'))).getItem(null, ITEM);
  assert.deepEqual(lost, { ok: false, http: 0, status: 'network', message: null, constraint: null, detail: null, field: null });
  const html = await api(fake(() => ({ status: 502, body: '<html>bad gateway</html>' }))).getItem(null, ITEM);
  assert.equal(!html.ok && html.status, 'error');
  assert.equal(!html.ok && html.http, 502);
});

test('only a session the database ended signs the person out', () => {
  const f = (http: number, status: string) => ({ ok: false as const, http, status, message: null, constraint: null, detail: null, field: null });
  for (const s of ['unauthenticated', 'invalid', 'ended', 'expired', 'idle', 'disabled']) assert.equal(sessionEnded(f(401, s)), true, s);
  assert.equal(sessionEnded(f(403, 'forbidden')), false, 'a refusal is not a sign-out');
  assert.equal(sessionEnded(f(0, 'network')), false, 'a lost connection is not a sign-out');
  assert.equal(sessionEnded({ ok: true, value: 1 }), false);
});
