import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Facility, type Fetch } from '../src/api.ts';
import {
  amendFacilityBody, areaBody, areaProblem, areaWarning, COORDINATE, coordinateInput, FACILITY_TYPES, formatCoordinate,
  mapLink, MAX_FACILITY_PAGES, operatingUnits, RADIUS_DEFAULT, readAllFacilities, RADIUS_MAX, RADIUS_MIN, radiusInput, removeAreaBody, splitPoint,
} from '../src/facilities.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable } from '../src/navigation.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import { facilitiesWritable, toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const MIGRATION = read('supabase/migrations/20261005000100_facilities.sql');
const EDGE = read('supabase/functions/_shared/facilities.ts');
const screen = (name: string) => readFileSync(new URL(`../src/screens/${name}`, import.meta.url), 'utf8');

const TARGET = '01936f00-0000-7000-8000-000000000402';
const UNIT = '01936f00-0000-7000-8000-000000000301';
const STAMP = '01936f00-0000-7000-8000-000000005602';
const D = '01936f00-0000-7000-8000-0000000a0001';

const F = (over: Partial<Facility> = {}): Facility => ({
  facility_id: TARGET, operating_unit_id: UNIT, brand_id: 'b1', facility_type: 'branch', code: 'BR-002',
  name_en: 'Test Branch Two', name_ar: 'الفرع التجريبي الثاني', address_en: null, address_ar: null, tz_name: 'Asia/Riyadh',
  latitude: null, longitude: null, geofence_radius_m: null, status: 'open', as_of_decision_id: STAMP, ...over,
});

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'ok', decision_id: 'd', facilities: [], decisions: [], facility: F(), next_after: null }), { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

// --- the client ----------------------------------------------------------------

test('CONTROL: no facility call names an actor, and each goes to its route with the target in the path', async () => {
  const f = fake();
  const a = api(f);
  await a.listFacilities({ facilityId: 'here', status: 'all', search: 'ola', after: 'BR-001', limit: 5 });
  await a.getFacility('here', TARGET);
  await a.facilityHistory(null, TARGET);
  await a.createFacility({
    decision_id: D, facility_id: TARGET, operating_unit_id: UNIT, facility_type: 'branch', code: 'BR-003',
    name_en: 'N', name_ar: 'ن', address_en: null, address_ar: null, reason: 'r',
  });
  await a.amendFacility(TARGET, amendFacilityBody(F(), D, { nameEn: 'N', nameAr: 'ن', addressEn: ' ', addressAr: 'ع', reason: ' r ' }));
  await a.setFacilityArea(TARGET, areaBody(F(), D, { latitude: '24.7136', longitude: '46.6753', radius: '', reason: 'r' }));
  await a.changeFacilityStatus(TARGET, { decision_id: D, expected_decision_id: STAMP, status: 'closed', reason: 'r' });
  for (const s of f.sent) {
    for (const k of keys(s.body)) assert.doesNotMatch(k, /^(actor|person|employee|user)(_id|_number)?$/i, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    'GET /facilities?facility_id=here&status=all&search=ola&after=BR-001&limit=5',
    `GET /facilities/${TARGET}?facility_id=here`, `GET /facilities/${TARGET}/history`, 'POST /facilities',
    `POST /facilities/${TARGET}/amend`, `POST /facilities/${TARGET}/area`, `POST /facilities/${TARGET}/status`,
  ]);
  assert.deepEqual(f.sent[4]!.body, {
    decision_id: D, expected_decision_id: STAMP, name_en: 'N', name_ar: 'ن', address_en: null, address_ar: 'ع', reason: 'r',
  }, 'both addresses stated, a blank one as null, never left out');
  assert.ok(Object.hasOwn(f.sent[4]!.body as object, 'address_en'));
  assert.deepEqual(f.sent[5]!.body, {
    decision_id: D, expected_decision_id: STAMP, latitude: '24.7136', longitude: '46.6753', radius_m: null, reason: 'r',
  }, 'a point as text, and a blank radius sent as null for 0019 to default');
  for (const k of ['facility_id', 'operating_unit_id'] as const) {
    assert.ok(!Object.hasOwn(f.sent[4]!.body as object, k), `an amendment names its facility in the path only: ${k}`);
  }
});

// --- coordinates -----------------------------------------------------------------

test('CONTROL: a coordinate stays the text the person entered, never a float', () => {
  const cases: Array<[string, string | null]> = [
    ['24.713600', '24.713600'], ['24.7136', '24.7136'], [' 46.6753 ', '46.6753'], ['-33.868820', '-33.868820'],
    ['+24.5', '24.5'], ['−33.8', '-33.8'], ['٢٤٫٧١٣٦', '24.7136'], ['24', '24'], ['', null],
    // More places than 0019 keeps: sent as typed, for the route to round.
    ['24.774264951827364', '24.774264951827364'],
  ];
  for (const [raw, value] of cases) assert.deepEqual(coordinateInput(raw), { ok: true, value }, raw);
  for (const raw of ['24,7136', '1e1', 'abc', '24.', '.5', '1000.5', '24.7.1', '24 7']) {
    assert.equal(coordinateInput(raw).ok, false, raw);
  }
  // The edge's own pattern, read from its source: what the console sends, the edge accepts.
  const edge = /const COORDINATE = (\/.*\/);/.exec(EDGE)![1]!;
  assert.equal(COORDINATE.source, edge.slice(1, -1), 'the console checks a coordinate exactly as the edge does');
  const logic = readFileSync(new URL('../src/facilities.ts', import.meta.url), 'utf8');
  const coordinateCode = logic.slice(logic.indexOf('export function coordinateInput'), logic.indexOf('export function radiusInput'))
    + logic.slice(logic.indexOf('export function areaBody'), logic.indexOf('export function removeAreaBody'));
  assert.doesNotMatch(coordinateCode, /parseFloat|Number\(|\+v\b|Math\./, 'no coordinate is parsed into a number');
});

test('a point pasted whole fills both fields; a decimal comma is never split into two', () => {
  assert.deepEqual(splitPoint('24.713600, 46.675300'), { latitude: '24.713600', longitude: '46.675300' });
  assert.deepEqual(splitPoint('24.7136،46.6753'), { latitude: '24.7136', longitude: '46.6753' });
  assert.deepEqual(splitPoint(' -33.8688 151.2093 '), { latitude: '-33.8688', longitude: '151.2093' });
  assert.deepEqual(splitPoint('٢٤٫٧١٣٦، ٤٦٫٦٧٥٣'), { latitude: '24.7136', longitude: '46.6753' });
  for (const raw of ['46,67', '24.7136', '24.7136, 46.6753, 3.1', '24.7136, abc', '24, 46']) {
    assert.equal(splitPoint(raw), null, raw);
  }
});

test('a radius is whole metres or blank; its range is 0019\'s', () => {
  assert.deepEqual(radiusInput(''), { ok: true, value: null });
  assert.deepEqual(radiusInput('200'), { ok: true, value: 200 });
  assert.deepEqual(radiusInput('٢٠٠'), { ok: true, value: 200 });
  assert.deepEqual(radiusInput('10'), { ok: true, value: 10 }, 'out of range is the database\'s to refuse, in its words');
  for (const raw of ['150.5', '-5', '1e3', 'abc']) assert.equal(radiusInput(raw).ok, false, raw);
  assert.match(MIGRATION, new RegExp(`check \\(geofence_radius_m between ${RADIUS_MIN} and ${RADIUS_MAX}\\)`));
  assert.match(MIGRATION, new RegExp(`coalesce\\(p_radius_m, ${RADIUS_DEFAULT}\\)`));
});

test('an area is a point or nothing: a half point is caught before it is sent', () => {
  assert.equal(areaProblem({ latitude: '24.7', longitude: '46.6', radius: '' }), null);
  assert.equal(areaProblem({ latitude: '', longitude: '46.6', radius: '' }), 'latitude');
  assert.equal(areaProblem({ latitude: '24.7', longitude: '', radius: '' }), 'longitude');
  assert.equal(areaProblem({ latitude: '24.7', longitude: '46.6', radius: '1.5' }), 'radius_m');
  assert.throws(() => areaBody(F(), D, { latitude: '', longitude: '46.6', radius: '', reason: 'r' }));
  assert.deepEqual(removeAreaBody(F(), D, ' gone '), {
    decision_id: D, expected_decision_id: STAMP, latitude: null, longitude: null, radius_m: null, reason: 'gone',
  }, 'removal is all three null, on purpose');
});

test('an open branch with no area is flagged; nothing else is', () => {
  assert.equal(areaWarning(F()), 'no_area');
  assert.equal(areaWarning(F({ latitude: '24.7', longitude: '46.6', geofence_radius_m: 150 })), null);
  assert.equal(areaWarning(F({ status: 'closed' })), null);
  for (const type of ['warehouse', 'factory', 'office'] as const) assert.equal(areaWarning(F({ facility_type: type })), null, type);
});

test('a coordinate is shown without trailing zeros, and a map link is built from the stored text', () => {
  assert.equal(formatCoordinate('24.713600'), '24.7136');
  assert.equal(formatCoordinate('46.000000'), '46');
  assert.equal(formatCoordinate(null), '');
  assert.equal(mapLink('24.713600', '46.675300'), 'https://www.openstreetmap.org/?mlat=24.7136&mlon=46.6753#map=18/24.7136/46.6753');
  const page = screen('FacilityDetail.tsx');
  assert.match(page, /target="_blank" rel="noopener noreferrer"/, 'the map opens apart from the console, with no referrer');
});

// --- operating units ------------------------------------------------------------

test('the operating units offered are those the facilities read belong to, with their brand and codes', () => {
  const brands = [{ brand_id: 'b1', code: 'A', name_en: 'A', name_ar: 'أ' }, { brand_id: 'b2', code: 'B', name_en: 'B', name_ar: 'ب' }];
  const units = operatingUnits([
    F({ operating_unit_id: 'u2', brand_id: 'b2', code: 'WH-9' }), F({ code: 'BR-002' }), F({ code: 'BR-001' }),
  ], brands);
  assert.deepEqual(units, [
    { operating_unit_id: UNIT, brand_id: 'b1', codes: ['BR-001', 'BR-002'] },
    { operating_unit_id: 'u2', brand_id: 'b2', codes: ['WH-9'] },
  ]);
  assert.deepEqual(operatingUnits([], brands), []);
  const form = screen('FacilityForm.tsx');
  assert.match(form, /listFacilities\(\{ facilityId: null, status: 'all'/, 'closed facilities\' units count too, read organisation-wide');
});

test('every page of facilities is read for the choice of unit; a failure or an endless list is never a partial answer', async () => {
  const pages: Record<string, { facilities: Facility[]; next_after: string | null }> = {
    '': { facilities: [F({ code: 'A' })], next_after: 'A' },
    A: { facilities: [F({ code: 'B', operating_unit_id: 'u2' })], next_after: null },
  };
  const asked: (string | null)[] = [];
  const all = await readAllFacilities(async (after) => {
    asked.push(after);
    return { ok: true, value: pages[after ?? '']! };
  });
  assert.deepEqual(asked, [null, 'A']);
  assert.ok(all.ok && all.value.map((f) => f.code).join() === 'A,B', 'both pages, so the second page\'s unit is offered');

  const broken = { ok: false as const, http: 0, status: 'network', message: null, constraint: null, detail: null, field: null };
  let n = 0;
  const failed = await readAllFacilities(async () => (n++ === 0 ? { ok: true, value: pages['']! } : broken));
  assert.deepEqual(failed, broken, 'a page that fails fails the whole read');

  let calls = 0;
  const endless = await readAllFacilities(async () => {
    calls++;
    return { ok: true, value: { facilities: [F()], next_after: 'again' } };
  });
  assert.equal(endless.ok, false, 'past the cap is a failure, not the pages read so far');
  assert.equal(calls, MAX_FACILITY_PAGES);
  assert.match(screen('FacilityForm.tsx'), /setAttempt\(\(n\) => n \+ 1\)/, 'a failed load offers Retry');
});

// --- the rules read from 0019 -----------------------------------------------------

test('the facility types, decision kinds and status words are 0019\'s, and each has a label', () => {
  const types = /p_facility_type not in \(([^)]+)\)/.exec(MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual(types, [...FACILITY_TYPES]);
  for (const type of types) assert.notEqual(asKey(`type_${type}`), null, type);
  const kinds = /facility_decision_kind_is_known check \(kind in \(([^)]+)\)\)/.exec(MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual(kinds, ['facility_recorded', 'facility_created', 'facility_amended', 'facility_located', 'facility_status_changed']);
  for (const kind of kinds) assert.notEqual(asKey(`kind_${kind}`), null, kind);
  assert.match(MIGRATION, /facility_status_is_known check \(status in \('open', 'closed'\)\)/);
  for (const s of ['open', 'closed']) assert.notEqual(asKey(`status_${s}`), null, s);
  for (const field of ['latitude', 'longitude', 'radius_m', 'address_en', 'address_ar']) {
    assert.notEqual(asKey(field), null, `a malformed ${field} is named in the reader's language`);
  }
});

test('every constraint the console words for facilities is one 0019 raises or declares', () => {
  const source = readFileSync(new URL('../src/messages.ts', import.meta.url), 'utf8');
  const mapped = [...source.matchAll(/^\s+((?:facility|operating_unit)_\w+): '/gm)].map((m) => m[1]!);
  assert.ok(mapped.length >= 14);
  // Raised or declared in 0019's code, not only named in one of its comments.
  const code = MIGRATION.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  for (const c of mapped) assert.match(code, new RegExp(`\\b${c}\\b`), c);
  for (const c of ['facility_stale', 'facility_is_closed', 'facility_status_unchanged', 'facility_code_key',
    'facility_area_is_on_earth', 'facility_radius_is_metres', 'facility_area_is_whole', 'operating_unit_exists']) {
    assert.ok(mapped.includes(c), c);
  }
  assert.doesNotMatch(source, /^\s+facility_decision_pkey:/m, 'a native collision never reads "already saved"');
  const f = { ok: false as const, http: 422, status: 'invalid', message: 'an area\'s radius is …', constraint: 'facility_radius_is_metres', detail: null, field: null };
  assert.match(failureMessage('en', f).text, /25 to 2000/);
  assert.match(failureMessage('en', { ...f, status: 'stale', http: 409, constraint: 'facility_stale' }).text, /facility/, 'not the supplier wording');
});

// --- routes, menu, gate ----------------------------------------------------------

test('facility routes parse and format both ways, and mark Branches and facilities current', () => {
  const routes: Route[] = [
    { screen: 'facilities' }, { screen: 'facility_new' }, { screen: 'facility', targetId: TARGET }, { screen: 'facility_edit', targetId: TARGET },
  ];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'facilities', r.screen);
  }
  assert.deepEqual(parseRoute(`#facilities/${TARGET.toUpperCase()}`), { screen: 'facility', targetId: TARGET });
  assert.deepEqual(parseRoute('#facilities/BR-001'), { screen: 'unknown', id: 'facilities/BR-001' });
  assert.deepEqual(parseRoute(`#facilities/${TARGET}/area`), { screen: 'unknown', id: `facilities/${TARGET}/area` });
});

const viewerWith = (permissions: string[]) => toViewer({
  person: { person_id: 'p', employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
  facility_id: null, org_wide: true, facilities: [], brands: [], units: [], permissions,
  states: { 'org.facilities': 'pilot' },
});

test('the Branches and facilities entry is behind 0019\'s capability', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'facilities')!;
  assert.equal(entry.capability, 'org.facilities');
  assert.match(MIGRATION, /\('org\.facilities', 'Branches and facilities'/, 'the key 0019 registers');
  assert.equal(itemIsVisible(entry, viewerWith(['org.facilities:read'])), true);
  assert.equal(itemIsVisible(entry, viewerWith([])), false);
  // Every read asks for read on org.facilities alone, at the facility asked.
  const reads = [...MIGRATION.matchAll(/assert_permitted\(p_actor_id, '([\w.]+)', 'read', p_facility_id\)/g)].map((m) => m[1]);
  assert.deepEqual(reads, ['org.facilities', 'org.facilities', 'org.facilities']);
  assert.equal(entry.alsoReads, undefined);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /seesFacilities: itemIsVisible\(FACILITIES, viewer\)/, 'the screens use the same rule as the menu');
});

test('CONTROL: facility changes are offered only organisation-wide, where 0019 checks them', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'facilities')!;
  const admin = viewerWith(['org.facilities:read', 'org.facilities:write']);
  assert.equal(facilitiesWritable(admin, null, (x) => itemIsWritable(entry, x)), true);
  assert.equal(facilitiesWritable(admin, 'a-branch', (x) => itemIsWritable(entry, x)), false);
  assert.equal(facilitiesWritable(viewerWith(['org.facilities:read']), null, (x) => itemIsWritable(entry, x)), false, 'read alone changes nothing');
  // All four write routes ask for write with no facility; if one ever takes a facility,
  // this rule and its screens need revisiting.
  const writes = [...MIGRATION.matchAll(/assert_permitted\(p_actor_id, 'org\.facilities', 'write', ([^)]+)\)/g)];
  assert.equal(writes.length, 4);
  for (const w of writes) assert.equal(w[1], 'null');
});

// --- the screens' write discipline (.tsx, read as source) ---------------------------

test('CONTROL: Retry on the facility pages resends the request first sent; ids are minted once per form', () => {
  const page = screen('FacilityDetail.tsx');
  assert.doesNotMatch(page, /onRetry=\{\(\) => submit/, 'no Retry rebuilds the body');
  assert.equal([...page.matchAll(/onRetry=\{w\.retry\}/g)].length, 2, 'both write forms on the page retry the pending request');
  assert.match(page, /import \{ useWrite \} from '\.\/useWrite\.tsx';/, 'the shared write lifecycle (test/write.test.ts)');
  for (const form of ['AreaForm', 'StatusChange']) {
    const body = page.slice(page.indexOf(`function ${form}`));
    assert.match(body.slice(0, 800), /useState\(\(\) => formIds\(\['decision_id'\] as const\)\)/, `${form} mints its ids once, kept until a success`);
  }
  const edit = screen('FacilityForm.tsx');
  assert.match(edit, /onRetry=\{\(\) => void send\(sent\)\}/, 'the amendment retries the body it sent');
  assert.match(edit, /onRetry=\{\(\) => void send\(sent\.current!\)\}/, 'the create form retries the body it sent');
  assert.doesNotMatch(edit, /onRetry=\{\(\) => void send\(\)\}/, 'no Retry rebuilds a body from the fields as they are now');
  assert.equal([...edit.matchAll(/disabled=\{inDoubt \|\| busy\}/g)].length, 2, 'both forms lock their fields while a request is out');
  assert.match(edit, /useState\(\(\) => formIds\(CREATE_IDS\)\)/);
  // Never minted at send time: no submit or send body mints an id, wherever in it.
  const senders = [...(page + edit).matchAll(/(?:function submit|async function send)\([^)]*\)[^{]*\{([\s\S]*?)\n  \}\n/g)];
  assert.equal(senders.length, 6, 'the area and status forms\' submit, and the create and amendment forms\' submit and send');
  for (const m of senders) assert.doesNotMatch(m[1]!, /formIds\(/, 'an id minted when the request is sent');
});

test('CONTROL: a form opened on the page starts from the facility as shown, and a status change is fixed when opened', () => {
  const page = screen('FacilityDetail.tsx');
  assert.match(page, /function openAs\(mode: 'set' \| 'remove'\) \{\n\s+setLatitude\(formatCoordinate\(facility\.latitude\)\)/,
    'an area form opens with the area as it is now, not what an earlier opening left');
  assert.match(page, /const target = opened \?\? /, 'a reload while the form is open cannot turn a close into a reopen');
  // A point is split only on a paste. Split as typed, "24.7136, 46.6" already read as a
  // point and the rest of the longitude landed in Latitude, 7.6 km away (found in review).
  assert.match(page, /onChange=\{\(e\) => setLatitude\(e\.target\.value\)\} onPaste=\{onLatitudePaste\}/, 'a pasted point fills both fields');
  const onChange = [...page.matchAll(/onChange=\{([^}]*\})?[^}]*\}/g)].map((m) => m[0]);
  assert.ok(onChange.length >= 4, 'the handlers were found');
  for (const handler of onChange) assert.doesNotMatch(handler, /splitPoint|onLatitude\(/, `never split as typed: ${handler}`);
  const paste = page.slice(page.indexOf('function onLatitudePaste'), page.indexOf('function submit', page.indexOf('function onLatitudePaste')));
  assert.match(paste, /splitPoint\(e\.clipboardData\.getData\('text'\)\)/, 'the pasted text, not the field, is split');
  assert.match(paste, /e\.preventDefault\(\);/, 'and the paste itself does not also land in Latitude');
});

test('a closed facility offers no change but reopening, and a branch without an area says so', () => {
  const page = screen('FacilityDetail.tsx');
  assert.match(page, /\{writable && open \? <AreaForm/, 'no area change on a closed facility (0019 refuses it)');
  assert.match(page, /\{writable && open \? \(\n\s+<div className="actions">\n\s+<a className="button primary" href=\{`#facilities\/\$\{facility\.facility_id\}\/edit`\}/);
  assert.match(page, /\{writable \? <StatusChange/, 'reopening is offered when closed');
  const edit = screen('FacilityForm.tsx');
  assert.match(edit, /if \(facility\.status === 'closed'\)/, 'a typed edit URL for a closed facility shows why, not a form 0019 refuses');
  assert.match(page, /text=\{writable \? `\$\{t\(lang, 'area_missing_explained'\)\} \$\{t\(lang, 'area_set_below'\)\}` : t\(lang, 'area_missing_explained'\)\}/,
    'only someone shown the area form is told to set one below (found in review)');
});
