import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db, SessionAnswer } from '../db.ts';
import type { Deps } from '../http.ts';
import type { ItemsDb } from '../items-db.ts';
import type { SuppliersDb } from '../suppliers-db.ts';
import type { TransferPricesDb } from '../transfer-prices-db.ts';
import type { FacilitiesDb, Facility } from '../facilities-db.ts';
import { facilities } from '../facilities.ts';
import { Refusal } from '../refusal.ts';
import { notUsed } from './not-used.ts';

const TOKEN = 'ef'.repeat(32);
const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACILITY = '01936f00-0000-7000-8000-000000000401';
const UNIT = '01936f00-0000-7000-8000-000000000301';
const NEW = '01936f00-0000-7000-8000-0000000d0501';
const STAMP = '01936f00-0000-7000-8000-000000005601';
const D1 = '01936f00-0000-7000-8000-0000000e0101';

const ROW: Facility = {
  facility_id: FACILITY, operating_unit_id: UNIT, brand_id: '01936f00-0000-7000-8000-000000000101',
  facility_type: 'branch', code: 'BR-001', name_en: 'Olaya', name_ar: 'العليا', address_en: 'Olaya Street',
  address_ar: 'شارع العليا', tz_name: 'Asia/Riyadh', latitude: '24.713600', longitude: '46.675300',
  geofence_radius_m: 150, status: 'open', as_of_decision_id: STAMP,
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

/** A facilities database that records every call, signed in as `person`. */
function fakeDb(person: string | null, override: Partial<FacilitiesDb> = {}): Db & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (method: string) => async (actor: string, ...args: unknown[]) => {
    calls.push({ method, actor, args });
    if (method in override) return (override as Record<string, (...a: unknown[]) => unknown>)[method]!(actor, ...args);
    if (method === 'listFacilities') return [ROW];
    if (method === 'getFacility') return ROW;
    if (method === 'facilityHistory') return [{ decision_id: STAMP, kind: 'facility_recorded' }];
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
    ...transferPricesNotUsed,
    listFacilities: record('listFacilities'),
    getFacility: record('getFacility'),
    facilityHistory: record('facilityHistory'),
    createFacility: record('createFacility'),
    amendFacility: record('amendFacility'),
    setFacilityArea: record('setFacilityArea'),
    changeFacilityStatus: record('changeFacilityStatus'),
  } as Db & { calls: Call[] };
}

const deps = (db: Db): Deps => ({ db, allowedOrigins: new Set() });
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;
const base = 'https://edge.example.test/functions/v1/facilities';
const auth = { authorization: `Bearer ${TOKEN}` };

const get = (path: string, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, { method: 'GET', headers });
const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  new Request(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const CREATE = {
  decision_id: D1, facility_id: NEW, operating_unit_id: UNIT, facility_type: 'branch', code: 'BR-003',
  name_en: 'Malqa', name_ar: 'الملقا', address_en: 'Anas Ibn Malik Road', address_ar: null, reason: 'New branch opens.',
};
const AMEND = {
  decision_id: D1, expected_decision_id: STAMP, name_en: 'Olaya', name_ar: 'العليا', address_en: 'King Fahd Road',
  address_ar: null, reason: 'Moved entrance.',
};
const AREA = {
  decision_id: D1, expected_decision_id: STAMP, latitude: '24.774265', longitude: '46.738586', radius_m: 200,
  reason: 'Measured at the door.',
};
const STATUS = { decision_id: D1, expected_decision_id: STAMP, status: 'closed', reason: 'Lease ended.' };

const WRITES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ['createFacility', '', CREATE],
  ['amendFacility', `/${FACILITY}/amend`, AMEND],
  ['setFacilityArea', `/${FACILITY}/area`, AREA],
  ['changeFacilityStatus', `/${FACILITY}/status`, STATUS],
];

// --- the actor ---------------------------------------------------------------

test('CONTROL: every facility write acts as the signed-in person, whatever the request names', async () => {
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(MANAGER);
    const forged = { ...body, actor_id: ADMIN, p_actor_id: ADMIN, actor: ADMIN, person_id: ADMIN };
    const response = await facilities(post(path, forged, { ...auth, 'x-actor-id': ADMIN }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal(db.calls.length, 1, method);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, `${method} acted as the token's person`);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), `${method} passed no forged id`);
  }
});

test('every facility read asks as the signed-in person, at the facility asked', async () => {
  for (const [method, path] of [
    ['listFacilities', ''], ['getFacility', `/${NEW}`], ['facilityHistory', `/${NEW}/history`],
  ] as const) {
    const db = fakeDb(MANAGER);
    const response = await facilities(get(`${path}?facility_id=${FACILITY}&actor_id=${ADMIN}`), deps(db));
    assert.equal(response.status, 200, path);
    assert.equal(db.calls[0]!.method, method);
    assert.equal(db.calls[0]!.actor, MANAGER, path);
    assert.doesNotMatch(JSON.stringify(db.calls[0]!.args), new RegExp(ADMIN), path);
    assert.match(JSON.stringify(db.calls[0]!.args), new RegExp(FACILITY), `${path} passed the facility`);
  }
});

test('without a session nothing reaches a facility route', async () => {
  for (const request of [
    get('', {}), get(`/${FACILITY}`, {}), get(`/${FACILITY}/history`, {}),
    ...WRITES.map(([, path, body]) => post(path, body, {})),
  ]) {
    const db = fakeDb(null);
    const response = await facilities(request, deps(db));
    assert.equal(response.status, 401);
    assert.deepEqual(db.calls, []);
  }
});

// --- routing and arguments -----------------------------------------------------

test('each write calls its database route with the request\'s fields, each in its place', async () => {
  const expected: Record<string, unknown> = {
    createFacility: {
      decisionId: D1, facilityId: NEW, operatingUnitId: UNIT, facilityType: 'branch', code: 'BR-003',
      nameEn: 'Malqa', nameAr: 'الملقا', addressEn: 'Anas Ibn Malik Road', addressAr: null, reason: 'New branch opens.',
    },
    amendFacility: {
      decisionId: D1, facilityId: FACILITY, expectedDecisionId: STAMP, nameEn: 'Olaya', nameAr: 'العليا',
      addressEn: 'King Fahd Road', addressAr: null, reason: 'Moved entrance.',
    },
    setFacilityArea: {
      decisionId: D1, facilityId: FACILITY, expectedDecisionId: STAMP, latitude: '24.774265', longitude: '46.738586',
      radiusM: 200, reason: 'Measured at the door.',
    },
    changeFacilityStatus: {
      decisionId: D1, facilityId: FACILITY, expectedDecisionId: STAMP, status: 'closed', reason: 'Lease ended.',
    },
  };
  for (const [method, path, body] of WRITES) {
    const db = fakeDb(ADMIN);
    const response = await facilities(post(path, body), deps(db));
    assert.deepEqual(db.calls[0]!.args, [expected[method]], method);
    assert.deepEqual(await response.json(), { status: 'ok', decision_id: D1 }, `${method} answers with its decision id`);
  }
});

test('the facility changed is the one the path names, whatever the body says', async () => {
  for (const [method, path, body] of WRITES.slice(1)) {
    const db = fakeDb(ADMIN);
    const response = await facilities(post(path, { ...body, facility_id: NEW }), deps(db));
    assert.equal(response.status, 200, method);
    assert.equal((db.calls[0]!.args[0] as { facilityId: string }).facilityId, FACILITY, method);
  }
});

test('an area is removed only on purpose: all three null, never by leaving a field out', async () => {
  const db = fakeDb(ADMIN);
  const cleared = { ...AREA, latitude: null, longitude: null, radius_m: null };
  assert.equal((await facilities(post(`/${FACILITY}/area`, cleared), deps(db))).status, 200);
  assert.deepEqual(db.calls[0]!.args[0], {
    decisionId: D1, facilityId: FACILITY, expectedDecisionId: STAMP, latitude: null, longitude: null, radiusM: null,
    reason: 'Measured at the door.',
  });
  // A point with the radius left null is the route's to default to 150 m.
  const defaulted = fakeDb(ADMIN);
  assert.equal((await facilities(post(`/${FACILITY}/area`, { ...AREA, radius_m: null }), deps(defaulted))).status, 200);
  assert.equal((defaulted.calls[0]!.args[0] as { radiusM: unknown }).radiusM, null);
});

test('a coordinate travels as the decimal text it was sent, never as a float', async () => {
  // A phone's reading, with more places than 0019 keeps, is the route's to round.
  for (const [lat, lng] of [['24.7136', '46.6753'], ['-33.868820', '151.209296'], ['0', '-0.5'], ['90', '-180'],
    ['24.774265491827364', '46.73858551']]) {
    const db = fakeDb(ADMIN);
    const response = await facilities(post(`/${FACILITY}/area`, { ...AREA, latitude: lat, longitude: lng }), deps(db));
    assert.equal(response.status, 200, `${lat},${lng}`);
    const args = db.calls[0]!.args[0] as { latitude: unknown; longitude: unknown };
    assert.equal(args.latitude, lat);
    assert.equal(args.longitude, lng);
  }
  // And the answer carries them as the database gave them: six places, as text.
  const answer = await json(await facilities(get(`/${FACILITY}`), deps(fakeDb(ADMIN))));
  assert.equal(answer['facility'].latitude, '24.713600');
  assert.equal(answer['facility'].geofence_radius_m, 150);
});

test('the reads pass their ids and facility, and the list pages by code', async () => {
  const db = fakeDb(ADMIN);
  const one = await json(await facilities(get(`/${NEW}?facility_id=${FACILITY}`), deps(db)));
  assert.deepEqual(db.calls[0], { method: 'getFacility', actor: ADMIN, args: [FACILITY, NEW] });
  assert.equal(one['facility'].code, 'BR-001');
  const history = fakeDb(ADMIN);
  const body = await json(await facilities(get(`/${NEW}/history`), deps(history)));
  assert.deepEqual(history.calls[0], { method: 'facilityHistory', actor: ADMIN, args: [null, NEW] });
  assert.equal(body['decisions'][0].kind, 'facility_recorded');

  const rows = [ROW, { ...ROW, facility_id: NEW, code: 'BR-002' }];
  const paged = fakeDb(ADMIN, { listFacilities: async () => rows });
  const page = await json(await facilities(get(`?facility_id=${FACILITY}&status=closed&search=ola&after=A&limit=2`), deps(paged)));
  assert.deepEqual(paged.calls[0]!.args, [{ facilityId: FACILITY, status: 'closed', search: 'ola', afterCode: 'A', limit: 2 }]);
  assert.equal(page['facilities'].length, 2);
  assert.equal(page['next_after'], 'BR-002', 'a full page names where the next one starts');
  const short = await json(await facilities(get('?limit=3'), deps(fakeDb(ADMIN, { listFacilities: async () => rows }))));
  assert.equal(short['next_after'], null, 'CONTROL: a short page has no next one');

  const defaults = fakeDb(ADMIN);
  await facilities(get(''), deps(defaults));
  assert.deepEqual(defaults.calls[0]!.args, [{ facilityId: null, status: 'open', search: null, afterCode: null, limit: 100 }],
    'a list shows open facilities unless asked otherwise');
  const all = fakeDb(ADMIN);
  await facilities(get('?status=all'), deps(all));
  assert.equal((all.calls[0]!.args[0] as { status: unknown }).status, null, 'all lists both');
});

test('a path that is no route is 404 before any field is read, and there is no delete', async () => {
  for (const request of [
    get(`/${FACILITY}/area`), get(`/${FACILITY}/history/x`), get(`/${FACILITY}/amend`),
    post(`/${FACILITY}`, AMEND), post(`/${FACILITY}/delete`, STATUS), post(`/${FACILITY}/close`, STATUS),
    post(`/${FACILITY}/history`, AMEND), post(`/${FACILITY}/area/x`, AREA), post('/amend', AMEND),
  ]) {
    const db = fakeDb(ADMIN);
    const response = await facilities(request, deps(db));
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'no_such_route' });
    assert.deepEqual(db.calls, []);
  }
  const del = await facilities(new Request(`${base}/${FACILITY}`, { method: 'DELETE', headers: auth }), deps(fakeDb(ADMIN)));
  assert.equal(del.status, 405, 'there is no delete, here or in the database');
});

// --- shape -------------------------------------------------------------------

test('a malformed facility field is a 400 naming it, and nothing reaches the database', async () => {
  const without = (body: Record<string, unknown>, field: string) =>
    Object.fromEntries(Object.entries(body).filter(([k]) => k !== field));
  const cases: Array<[Request, string]> = [
    [get('/not-a-uuid'), 'facility_id'],
    [get('/not-a-uuid/history'), 'facility_id'],
    [get('?facility_id=nope'), 'facility_id'],
    [get(`/${NEW}?facility_id=nope`), 'facility_id'],
    [get('?status=retired'), 'status'],
    [get('?limit=0'), 'limit'],
    [get('?limit=501'), 'limit'],
    [post('', { ...CREATE, decision_id: 'x' }), 'decision_id'],
    [post('', without(CREATE, 'facility_id')), 'facility_id'],
    [post('', { ...CREATE, operating_unit_id: 'olaya' }), 'operating_unit_id'],
    [post('', without(CREATE, 'facility_type')), 'facility_type'],
    [post('', { ...CREATE, code: 7 }), 'code'],
    [post('', { ...CREATE, code: 'x'.repeat(65) }), 'code'],
    [post('', without(CREATE, 'name_en')), 'name_en'],
    [post('', { ...CREATE, name_ar: null }), 'name_ar'],
    [post('', { ...CREATE, address_en: 12 }), 'address_en'],
    [post('', { ...CREATE, address_ar: 'x'.repeat(501) }), 'address_ar'],
    [post('', without(CREATE, 'reason')), 'reason'],
    [post('/not-a-uuid/amend', AMEND), 'facility_id'],
    [post(`/${FACILITY}/amend`, without(AMEND, 'expected_decision_id')), 'expected_decision_id'],
    // An amendment overwrites an address, so it states one: absent would clear it by omission.
    [post(`/${FACILITY}/amend`, without(AMEND, 'address_en')), 'address_en'],
    [post(`/${FACILITY}/amend`, without(AMEND, 'address_ar')), 'address_ar'],
    // A coordinate is decimal text: not a number, not sixteen places, not an exponent, not absent.
    [post(`/${FACILITY}/area`, { ...AREA, latitude: 24.774265 }), 'latitude'],
    [post(`/${FACILITY}/area`, { ...AREA, longitude: 46.7 }), 'longitude'],
    [post(`/${FACILITY}/area`, { ...AREA, latitude: '24.7742651234567891' }), 'latitude'],
    [post(`/${FACILITY}/area`, { ...AREA, latitude: '2.4e1' }), 'latitude'],
    [post(`/${FACILITY}/area`, { ...AREA, longitude: '1046.5' }), 'longitude'],
    [post(`/${FACILITY}/area`, { ...AREA, latitude: ' 24.7' }), 'latitude'],
    [post(`/${FACILITY}/area`, { ...AREA, latitude: '24.' }), 'latitude'],
    [post(`/${FACILITY}/area`, { ...AREA, latitude: '' }), 'latitude'],
    [post(`/${FACILITY}/area`, without(AREA, 'latitude')), 'latitude'],
    [post(`/${FACILITY}/area`, without(AREA, 'longitude')), 'longitude'],
    // An area is stated whole: a radius left out is not "no change".
    [post(`/${FACILITY}/area`, without(AREA, 'radius_m')), 'radius_m'],
    [post(`/${FACILITY}/area`, { ...AREA, radius_m: '200' }), 'radius_m'],
    [post(`/${FACILITY}/area`, { ...AREA, radius_m: 150.5 }), 'radius_m'],
    [post(`/${FACILITY}/area`, { ...AREA, radius_m: 2 ** 31 }), 'radius_m'],
    [post(`/${FACILITY}/status`, { ...STATUS, status: 'retired' }), 'status'],
    [post(`/${FACILITY}/status`, without(STATUS, 'status')), 'status'],
    [post(`/${FACILITY}/status`, without(STATUS, 'reason')), 'reason'],
    [post(`/${FACILITY}/status`, { ...STATUS, decision_id: undefined }), 'decision_id'],
    [post('', 'not json'), 'body'],
  ];
  for (const [request, field] of cases) {
    const db = fakeDb(ADMIN);
    const response = await facilities(request, deps(db));
    assert.equal(response.status, 400, `${field}: ${new URL(request.url).pathname}`);
    assert.deepEqual(await response.json(), { status: 'malformed', field });
    assert.deepEqual(db.calls, [], field);
  }
});

test('a code, a type, a point or a radius the route refuses is the route\'s to refuse, not the edge\'s', async () => {
  // Lower case, an unknown type, an empty name, off the earth, half an area, a radius out of range: well formed, and 0019's rules.
  for (const [path, body] of [
    ['', { ...CREATE, code: 'br-003' }], ['', { ...CREATE, facility_type: 'kiosk' }], ['', { ...CREATE, name_ar: '' }],
    [`/${FACILITY}/area`, { ...AREA, latitude: '91' }], [`/${FACILITY}/area`, { ...AREA, longitude: '-181.5' }],
    [`/${FACILITY}/area`, { ...AREA, longitude: null }], [`/${FACILITY}/area`, { ...AREA, radius_m: 10 }],
    [`/${FACILITY}/area`, { ...AREA, latitude: null, longitude: null }],
  ] as const) {
    const db = fakeDb(ADMIN);
    assert.equal((await facilities(post(path, body), deps(db))).status, 200, JSON.stringify(body));
    assert.equal(db.calls.length, 1);
  }
});

test('a form past 8 KiB is 413', async () => {
  const db = fakeDb(ADMIN);
  const response = await facilities(post('', { ...CREATE, reason: 'x'.repeat(9000) }), deps(db));
  assert.equal(response.status, 413);
  assert.deepEqual(db.calls, []);
});

// --- refusals ------------------------------------------------------------------

test('each kind of facility refusal is answered as the person can act on it', async () => {
  const cases: Array<[string, Refusal, number, string]> = [
    ['createFacility', new Refusal('23505', 'decision is already recorded', 'facility_decision_pkey', null, 'Read erp.facility_history()'), 409, 'already_recorded'],
    ['setFacilityArea', new Refusal('23505', 'decision is already recorded', 'facility_decision_pkey', null, null), 409, 'already_recorded'],
    ['createFacility', new Refusal('23505', 'facility code BR-001 is already used', 'facility_code_key', null, null), 409, 'conflict'],
    ['amendFacility', new Refusal('23001', 'facility has changed since it was read', 'facility_stale', null, 'Reload it and make the change again.'), 409, 'stale'],
    ['setFacilityArea', new Refusal('23001', 'facility has changed since it was read', 'facility_stale', null, null), 409, 'stale'],
    ['changeFacilityStatus', new Refusal('23001', 'facility has changed since it was read', 'facility_stale', null, null), 409, 'stale'],
    ['createFacility', new Refusal('23001', 'person may not write on capability org.facilities here', null, null, null), 403, 'forbidden'],
    ['amendFacility', new Refusal('23001', 'facility is closed: reopen it first', 'facility_is_closed', null, null), 422, 'refused'],
    ['changeFacilityStatus', new Refusal('23001', 'facility is already closed', 'facility_status_unchanged', null, null), 422, 'refused'],
    ['createFacility', new Refusal('23514', 'a facility code is capitals, digits and hyphens', 'facility_code_is_canonical', null, null), 422, 'invalid'],
    ['createFacility', new Refusal('23514', 'a facility is a branch, warehouse, factory or office', 'facility_type_is_known', null, null), 422, 'invalid'],
    ['createFacility', new Refusal('23514', 'a facility is named in English and Arabic (PRG-014)', 'facility_names_are_bilingual', null, null), 422, 'invalid'],
    ['createFacility', new Refusal('23514', 'the organisation-wide id is not a facility', 'facility_is_not_the_organisation', null, null), 422, 'invalid'],
    ['setFacilityArea', new Refusal('23514', 'an area is a latitude, a longitude and a radius together, or none', 'facility_area_is_whole', null, null), 422, 'invalid'],
    ['setFacilityArea', new Refusal('23514', 'a latitude is from -90 to 90 and a longitude from -180 to 180', 'facility_area_is_on_earth', null, null), 422, 'invalid'],
    ['setFacilityArea', new Refusal('23514', 'an area\'s radius is from 25 to 2000 metres', 'facility_radius_is_metres', null, null), 422, 'invalid'],
    ['createFacility', new Refusal('P0002', 'no operating unit', 'operating_unit_exists', null, null), 404, 'not_found'],
    ['amendFacility', new Refusal('P0002', 'no facility', 'facility_exists', null, null), 404, 'not_found'],
  ];
  for (const [method, refusal, http, status] of cases) {
    const db = fakeDb(ADMIN, { [method]: async () => { throw refusal; } });
    const [, path, body] = WRITES.find(([m]) => m === method)!;
    const response = await facilities(post(path, body), deps(db));
    assert.equal(response.status, http, `${method}: ${refusal.message}`);
    const answer = await json(response);
    assert.equal(answer['status'], status, `${method}: ${refusal.message}`);
    assert.equal(answer['message'], refusal.message, 'the route\'s words reach the person');
    if (refusal.constraint !== null) assert.equal(answer['constraint'], refusal.constraint);
    if (refusal.hint !== null) assert.equal(answer['hint'], refusal.hint);
  }
});

test('CONTROL: only a route\'s own facility retry check is answered as a retry', async () => {
  const native = new Refusal('23505', 'duplicate key value violates unique constraint "facility_decision_pkey"',
    'facility_decision_pkey', 'Key (decision_id)=(…) already exists.', null, false);
  const response = await facilities(post('', CREATE), deps(fakeDb(ADMIN, { createFacility: async () => { throw native; } })));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    status: 'conflict', message: 'a value that must be unique is already in use', constraint: 'facility_decision_pkey',
  }, 'a native collision is a conflict, in the edge\'s words, with no row printed');
});

test('a facility read refused for want of permission is 403, another brand\'s is 404, and an error is a 500 that says nothing', async () => {
  const gate = new Refusal('23001', 'person may not read on capability org.facilities here', null, null, null);
  const refused = await facilities(get(`/${FACILITY}`), deps(fakeDb(MANAGER, { getFacility: async () => { throw gate; } })));
  assert.equal(refused.status, 403);
  assert.equal((await json(refused))['status'], 'forbidden');

  const missing = new Refusal('P0002', `no facility ${NEW}`, 'facility_exists', null, null);
  const other = await facilities(get(`/${NEW}?facility_id=${FACILITY}`), deps(fakeDb(MANAGER, { getFacility: async () => { throw missing; } })));
  assert.equal(other.status, 404);
  assert.equal((await json(other))['status'], 'not_found');

  const original = console.error;
  console.error = () => {};
  try {
    const broken = new Error('relation "erp.facility" does not exist');
    const response = await facilities(get(''), deps(fakeDb(ADMIN, { listFacilities: async () => { throw broken; } })));
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /relation|erp\./, 'PostgreSQL\'s words never reach the person');
  } finally {
    console.error = original;
  }
});
