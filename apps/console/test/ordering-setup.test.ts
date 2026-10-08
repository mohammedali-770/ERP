import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createApi, type CutoffDecision, type CutoffRow, type Fetch, type ItemUnit, type ParDecision, type SourceDecision, type ViewerFacility,
} from '../src/api.ts';
import { asKey, STRINGS } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable, type CapabilityState } from '../src/navigation.ts';
import {
  branchAdmits, branchesOf, branchIsHere, clearCutoffBody, clearParBody, clearSourceBody, CUTOFF_KINDS, CUTOFF_PATTERN, cutoffActions,
  cutoffInput, cutoffPageNotice, cutoffReadable, cutoffsListNotice, hiddenRefusal, inForce, matchItems, MAX_PAGES, NO_ORDERING_RIGHTS,
  orderingRights, PAR_CAPABILITY, PAR_KINDS, parActions, parInput, parNotice, parPacks, parPlace, parWriteBanner, readAll, setCutoffBody,
  setParBody,
  setSourceBody, SOURCE_KINDS, sourceActions, sourceOptions, stampOf, suppliedElsewhere, SUPPLYING_TYPES,
} from '../src/ordering-setup.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import { toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const MIGRATION = read('supabase/migrations/20261008000100_ordering_setup.sql');
const SEED = read('supabase/seeds/0035_role_permissions.sql');
const EDGE = read('supabase/functions/_shared/ordering-setup.ts');
const SOURCES = read('apps/console/src/screens/ReplenishmentSources.tsx');
const CUTOFFS = read('apps/console/src/screens/OrderCutoffs.tsx');
const PARS = read('apps/console/src/screens/ParLevels.tsx');
const SCREENS = { 'ReplenishmentSources.tsx': SOURCES, 'OrderCutoffs.tsx': CUTOFFS, 'ParLevels.tsx': PARS };
const APP = read('apps/console/src/App.tsx');
/** One function of 0024, from its `create` to the end of its body: never the next one's. */
const fn = (name: string) => {
  const at = MIGRATION.indexOf(`create or replace function erp.${name}(`);
  assert.ok(at >= 0, `0024 defines erp.${name}()`);
  return MIGRATION.slice(at).split('$$;')[0]!;
};

const BRANCH = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const CARTON = '01936f00-0000-7000-8000-000000004203';
const SET = '01936f00-0000-7000-8000-000000006201';
const CLEARED = '01936f00-0000-7000-8000-000000006202';
const ME = '01936f00-0000-7000-8000-000000000904';
const D = '01936f00-0000-7000-8000-0000000d0001';

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({
      status: 'ok', decision_id: 'd', sources: [], cutoffs: [], pars: [], decisions: [], next_after: null, next_before: null,
    }), { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

// --- the client ----------------------------------------------------------------

test('CONTROL: no ordering-setup call names an actor; what a setting is about is its path; every set states its stamp, null included', async () => {
  const f = fake();
  const a = api(f);
  await a.setReplenishmentSource(ITEM, setSourceBody({ decision_id: D }, { suppliedBy: WAREHOUSE, expectedDecisionId: null, reason: ' First. ' }));
  await a.clearReplenishmentSource(ITEM, clearSourceBody({ decision_id: D }, { expectedDecisionId: SET, reason: 'Stopped.' }));
  await a.setOrderCutoff(WAREHOUSE, setCutoffBody({ decision_id: D }, { cutoff: '14:00', expectedDecisionId: SET, reason: 'Trucks.' }));
  await a.clearOrderCutoff(WAREHOUSE, clearCutoffBody({ decision_id: D }, { expectedDecisionId: SET, reason: 'None.' }));
  await a.setParLevel(BRANCH, setParBody({ decision_id: D }, {
    from: FACTORY, itemUnitId: CARTON, quantity: '2.5', expectedDecisionId: null, reason: 'Weekend.',
  }));
  await a.setParLevel(BRANCH, setParBody({ decision_id: D }, {
    from: null, itemUnitId: CARTON, quantity: '3', expectedDecisionId: CLEARED, reason: 'Again.',
  }));
  await a.clearParLevel({ branchId: BRANCH, itemId: ITEM }, clearParBody({ decision_id: D }, { from: null, expectedDecisionId: SET, reason: 'Gone.' }));
  await a.replenishmentSources({ facilityId: null, suppliedBy: FACTORY, after: 'A', limit: 5 });
  await a.replenishmentSources({ facilityId: BRANCH });
  await a.replenishmentSourceHistory(null, ITEM, '7');
  await a.orderCutoffs({ facilityId: BRANCH, after: 'WH-001', limit: 2 });
  await a.orderCutoffHistory(WAREHOUSE, '9');
  await a.parLevels({ facilityId: FACTORY, branchId: BRANCH, after: 'B', limit: 3 });
  await a.parLevels({ facilityId: null, branchId: BRANCH });
  await a.parLevelHistory(BRANCH, BRANCH, ITEM, '4');
  for (const s of f.sent) {
    assert.doesNotMatch(s.url, /actor|person/);
    for (const k of keys(s.body)) assert.doesNotMatch(k, /actor|person|branch|item_id|^cutoff_facility/, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    `POST /ordering-setup/sources/${ITEM}`,
    `POST /ordering-setup/sources/${ITEM}/clear`,
    `POST /ordering-setup/cutoffs/${WAREHOUSE}`,
    `POST /ordering-setup/cutoffs/${WAREHOUSE}/clear`,
    `POST /ordering-setup/pars/${BRANCH}`,
    `POST /ordering-setup/pars/${BRANCH}`,
    `POST /ordering-setup/pars/${BRANCH}/items/${ITEM}/clear`,
    `GET /ordering-setup/sources?supplied_by=${FACTORY}&after=A&limit=5`,
    `GET /ordering-setup/sources?facility_id=${BRANCH}`,
    `GET /ordering-setup/sources/${ITEM}?before=7`,
    `GET /ordering-setup/cutoffs?facility_id=${BRANCH}&after=WH-001&limit=2`,
    // Asked at the facility the path names: the edge reads no other, so none is sent.
    `GET /ordering-setup/cutoffs/${WAREHOUSE}?before=9`,
    `GET /ordering-setup/pars/${BRANCH}?facility_id=${FACTORY}&after=B&limit=3`,
    `GET /ordering-setup/pars/${BRANCH}`,
    `GET /ordering-setup/pars/${BRANCH}/items/${ITEM}?facility_id=${BRANCH}&before=4`,
  ]);
  const body = (n: number) => f.sent[n]!.body as Record<string, unknown>;
  assert.deepEqual(body(0), { decision_id: D, supplied_by: WAREHOUSE, expected_decision_id: null, reason: 'First.' });
  assert.ok(Object.hasOwn(body(0), 'expected_decision_id'), 'a first source sends null, stated: the edge refuses one left out');
  assert.deepEqual(body(1), { decision_id: D, expected_decision_id: SET, reason: 'Stopped.' });
  assert.deepEqual(body(2), { decision_id: D, cutoff: '14:00', expected_decision_id: SET, reason: 'Trucks.' });
  assert.deepEqual(body(3), { decision_id: D, expected_decision_id: SET, reason: 'None.' });
  assert.deepEqual(body(4), {
    decision_id: D, facility_id: FACTORY, item_unit_id: CARTON, quantity: '2.5', expected_decision_id: null, reason: 'Weekend.',
  });
  assert.ok(Object.hasOwn(body(5), 'facility_id') && body(5)['facility_id'] === null,
    'organisation-wide is null, stated: the edge refuses a par that leaves where it is set from out');
  assert.equal(body(5)['expected_decision_id'], CLEARED, 'a cleared par is set again against its clearing');
  assert.deepEqual(body(6), { decision_id: D, facility_id: null, expected_decision_id: SET, reason: 'Gone.' });
  assert.equal(typeof body(4)['quantity'], 'string', 'a par travels as text');
  assert.equal(typeof body(2)['cutoff'], 'string', 'a cut-off travels as text');
});

// --- the cut-off ----------------------------------------------------------------

test('CONTROL: a cut-off is sent as \'HH:MM\', by 0024\'s own rule, and never as a number or a moment', () => {
  assert.ok(MIGRATION.includes(`p_cutoff !~ '${CUTOFF_PATTERN.source}'`), '0024\'s pattern, which the console holds');
  const edge = /const CUTOFF = (\/.*\/);/.exec(EDGE)?.[1];
  assert.equal(edge, '/^\\d{2}:\\d{2}$/', 'the edge\'s shape');
  // Three or four digits alone read the same: a phone's number pad has no colon (found in review).
  for (const [typed, sent] of [['14:00', '14:00'], ['9:30', '09:30'], [' 00:00 ', '00:00'], ['23:59', '23:59'], ['٠٩:٣٠', '09:30'],
    ['۱۴:۰۰', '14:00'], ['1400', '14:00'], ['930', '09:30'], ['140', '01:40'], ['0000', '00:00'], ['١٤٠٠', '14:00']]) {
    assert.deepEqual(cutoffInput(typed!), { ok: true, value: sent }, typed);
    assert.match(sent!, /^\d{2}:\d{2}$/, 'and passes the edge');
  }
  for (const typed of ['24:00', '2400', '12:60', '1260', '14', '960', '0960', '12345', '14:0', '', '14:00:00', '-1:00', '14.00', '2:5', '123:00',
    '14 : 00', '1e1:00', ':1400']) {
    assert.equal(cutoffInput(typed).ok, false, typed);
  }
  assert.doesNotMatch(CUTOFFS, /type="time"|Number\(|parseInt|parseFloat|new Date\(/, 'a cut-off is text from the field to the request');
  assert.match(CUTOFFS, /const c = cutoffInput\(cutoff\);/);
  assert.match(CUTOFFS, /<input dir="ltr" inputMode="numeric"/, 'a number pad, which the digits alone fill');
  assert.match(CUTOFFS, /setCutoffBody\(ids, \{ cutoff: c\.value, /, 'the set sends the text cutoffInput checked');
});

// --- the par --------------------------------------------------------------------

test('CONTROL: a par is the decimal text typed, by 0024\'s rule, and more than nothing', () => {
  assert.match(MIGRATION, /p_quantity !~ '\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,6\}\)\?\$'/, '0024\'s pattern, which the console holds');
  assert.match(MIGRATION, /if v_qty = 0 then\s+raise exception 'a par is more than nothing'/, '0024 refuses none');
  for (const [typed, sent] of [['3', '3'], ['2.5', '2.5'], [' 0.25 ', '0.25'], ['١٢٫٥', '12.5'], ['999999999999.999999', '999999999999.999999']]) {
    assert.deepEqual(parInput(typed!), { ok: true, value: sent }, typed);
  }
  for (const typed of ['0', '0.000', '', '-1', '1e3', '1,250', '1.1234567', '1234567890123', '.5', '2.']) {
    assert.equal(parInput(typed).ok, false, typed);
  }
  assert.doesNotMatch(PARS, /Number\(|parseFloat|parseInt|\* 1\b/, 'no par screen does arithmetic on a quantity');
  assert.match(PARS, /quantity: q\.value/, 'the set sends the text parInput checked');
  const unit = (id: string, status: 'active' | 'retired'): ItemUnit => ({ item_unit_id: id, unit_key: id, factor: '1', status, as_of_decision_id: SET });
  assert.deepEqual(parPacks([unit('a', 'active'), unit('b', 'retired'), unit('c', 'active')]).map((u) => u.item_unit_id), ['a', 'c']);
  assert.match(MIGRATION, /constraint = 'par_level_pack_is_retired'/);
  assert.match(PARS, /const packs = parPacks\(item\.units\);/, 'only current packs are offered');
  assert.match(PARS, /if \(unitId !== '' && !packs\.some\(\(u\) => u\.item_unit_id === unitId\)\) setUnitId\(''\);/,
    'a pack retired since the form opened is never left chosen');
});

// --- the stamp -----------------------------------------------------------------

const decided = <K extends string>(kind: K, id: string, current: boolean) => ({ decision_id: id, kind, is_current: current });

test('CONTROL: the stamp is the decision in force, a clearing included; null only for a setting never made', () => {
  for (const [set, cleared] of [[SOURCE_KINDS[0], SOURCE_KINDS[1]], [CUTOFF_KINDS[0], CUTOFF_KINDS[1]], [PAR_KINDS[0], PAR_KINDS[1]]] as const) {
    assert.equal(stampOf([]), null, 'never set');
    assert.equal(inForce([]), null);
    const clearedFirst = [decided(cleared, CLEARED, true), decided(set, SET, false)];
    assert.equal(stampOf(clearedFirst), CLEARED, `${cleared}: set again against its clearing, which 0024 keeps as the stamp`);
    assert.equal(inForce(clearedFirst), null, `${cleared}: nothing in force`);
    const setFirst = [decided(set, SET, true)];
    assert.equal(stampOf(setFirst), SET);
    assert.equal(inForce(setFirst)?.decision_id, SET);
    assert.equal(stampOf([decided(cleared, CLEARED, false), decided(set, SET, false)]), CLEARED,
      'a history is newest first: without a mark, its first row is in force');
  }
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.match(src, /const stamp = stampOf\(history\);/, `${name}: the stamp is read from the history`);
    // ...and handed to both forms as it was read: after a clearing, the clearing's id (found in review).
    const handed = [...src.matchAll(/ stamp=\{([^}]*)\}/g)].map((m) => m[1]);
    assert.deepEqual(handed, ['stamp', 'stamp'], `${name}: both forms are handed the history's stamp`);
    assert.equal([...src.matchAll(/expectedDecisionId: stamp[,\s}]/g)].length, 2, `${name}: set and clear each send the stamp they were handed`);
    assert.doesNotMatch(src, /expectedDecisionId: (null|r\.|current|undefined)|as_of_decision_id/, `${name}: never a list's stamp`);
  }
  // The par list leaves cleared pars out: its stamp is a set's, never a clearing's.
  assert.match(MIGRATION, /where m\.facility_id = b\.facility_id\s+and m\.par is not null/);
});

// --- where, and who --------------------------------------------------------------

const ENTRIES = {
  sources: NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'replenishment_sources')!,
  cutoffs: NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'order_cutoffs')!,
  pars: NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'par_levels')!,
};
const place = (id: string, facility_type: string): ViewerFacility =>
  ({ facility_id: id, code: 'X', facility_type, name_en: 'X', name_ar: 'س', brand_id: 'b' });
const viewerWith = (permissions: string[], states: Record<string, string> = {}, preview = false) => ({
  ...toViewer({
    person: { person_id: ME, employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: null, org_wide: false, facilities: [], brands: [], units: [], permissions,
    states: { 'ordering.setup': 'pilot', 'ordering.par_levels': 'pilot', 'inventory.items': 'pilot', ...states },
  }),
  preview,
});
const rights = (facilityId: string | null, f: ViewerFacility | undefined, v: ReturnType<typeof viewerWith>) =>
  orderingRights(facilityId, f, v, ENTRIES, itemIsVisible, itemIsWritable);
const ADMIN = ['ordering.setup:read', 'ordering.setup:write', 'ordering.par_levels:read', 'ordering.par_levels:write', 'inventory.items:read'];
const MANAGER = ['ordering.setup:read', 'ordering.par_levels:read', 'ordering.par_levels:write', 'inventory.items:read'];
const BRANCH_STAFF = ['ordering.setup:read', 'ordering.par_levels:read', 'inventory.items:read'];

test('CONTROL: sources change organisation-wide, a cut-off at its own facility, and a par from where it is supplied or the organisation', () => {
  // 0024's gates, which the rights mirror.
  // Each route's own body, the gates first and then the retry key: never the next route's,
  // which repeats them (found in review: the set routes were read through their clears).
  for (const route of ['set_replenishment_source', 'clear_replenishment_source']) {
    assert.match(fn(route), /\bbegin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'write', null\);\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'read', null\);\s+perform erp\.assert_permitted\(p_actor_id, 'inventory\.items', 'read', null\);\s+perform erp\.assert_replenishment_source_decision_is_new\(p_decision_id\);/, route);
  }
  for (const route of ['set_order_cutoff', 'clear_order_cutoff']) {
    assert.match(fn(route), /\bbegin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'write', p_facility_id\);\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'read', p_facility_id\);\s+perform erp\.assert_order_cutoff_decision_is_new\(p_decision_id\);/, route);
  }
  for (const route of ['set_par_level', 'clear_par_level']) {
    assert.match(fn(route), /\bbegin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.par_levels', 'write', p_facility_id\);\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.par_levels', 'read', p_facility_id\);\s+perform erp\.assert_permitted\(p_actor_id, 'inventory\.items', 'read', p_facility_id\);\s+perform erp\.assert_par_level_decision_is_new\(p_decision_id\);/, route);
  }

  const admin = viewerWith(ADMIN);
  const wh = place(WAREHOUSE, 'warehouse');
  const fa = place(FACTORY, 'factory');
  assert.deepEqual(rights(null, undefined, admin), {
    seesSources: true, setsSources: true, seesCutoffs: true, setsCutoffs: false, writesCutoffs: true, seesPars: true, setsPars: true, parFrom: null,
  }, 'organisation-wide: sources, and pars from the organisation; no cut-off, which is asked at its facility');
  assert.deepEqual(rights(WAREHOUSE, wh, admin), {
    seesSources: true, setsSources: false, seesCutoffs: true, setsCutoffs: true, writesCutoffs: true, seesPars: true, setsPars: true, parFrom: WAREHOUSE,
  }, 'at the warehouse: its cut-off, and pars set from it');
  const manager = viewerWith(MANAGER);
  assert.deepEqual(rights(FACTORY, fa, manager), {
    seesSources: true, setsSources: false, seesCutoffs: true, setsCutoffs: false, writesCutoffs: false, seesPars: true, setsPars: true, parFrom: FACTORY,
  }, 'the factory\'s manager sets the factory\'s pars, at any branch, and no cut-off (O5)');
  const staff = viewerWith(BRANCH_STAFF);
  assert.deepEqual(rights(BRANCH, place(BRANCH, 'branch'), staff), {
    seesSources: true, setsSources: false, seesCutoffs: true, setsCutoffs: false, writesCutoffs: false, seesPars: true, setsPars: false, parFrom: null,
  }, 'a branch\'s staff read their pars and their suppliers\' cut-offs, and set nothing');
  for (const [where, f] of [[BRANCH, place(BRANCH, 'branch')], ['of', place('of', 'office')]] as const) {
    const r = rights(where, f, admin);
    assert.equal(r.setsPars || r.setsCutoffs || r.setsSources, false, `${f.facility_type}: supplies nothing, so sets nothing`);
    assert.equal(r.parFrom, null);
  }
  assert.equal(rights(FACTORY, undefined, admin).setsPars, false, 'a facility the session does not name is no place to set anything');
  assert.equal(rights(FACTORY, wh, admin).setsCutoffs, false, 'nor one the session names under another id');
  assert.deepEqual(rights(null, undefined, { ...admin, preview: true }),
    { ...NO_ORDERING_RIGHTS, seesSources: true, seesCutoffs: true, seesPars: true }, 'a preview changes nothing');
  assert.equal(rights(null, undefined, viewerWith(ADMIN, { 'ordering.setup': 'read_only' })).setsSources, false, 'read only admits no new work');
  assert.equal(rights(WAREHOUSE, wh, viewerWith(ADMIN, { 'ordering.par_levels': 'withdrawn' })).setsPars, false);
  assert.equal(rights(null, undefined, viewerWith(ADMIN.filter((p) => p !== 'inventory.items:read'))).setsSources, false,
    'a source write asks read on items too');
  assert.equal(rights(FACTORY, fa, viewerWith(MANAGER.filter((p) => p !== 'ordering.par_levels:read'))).setsPars, false,
    'a par write asks read on pars too');
  assert.match(APP, /ordering: orderingRights\(facilityId, workingFacility\(data\.facilities, facilityId\), viewer, ORDERING, itemIsVisible, itemIsWritable\),/);

  // The seed's roles, as O5 gives them.
  for (const grant of ["('factory_manager',   'ordering.par_levels', 'write')", "('warehouse_manager', 'ordering.par_levels', 'write')",
    "('branch_worker',     'ordering.par_levels', 'read')", "('branch_worker',     'ordering.setup',      'read')"]) {
    assert.ok(SEED.includes(grant), grant);
  }
  assert.doesNotMatch(SEED, /'(factory|warehouse)_manager', +'ordering\.setup', +'write'/, 'a manager moves no cut-off');
});

test('the entries open only to one who holds every read their lists ask, where none is hidden', () => {
  assert.deepEqual([ENTRIES.sources.capability, ENTRIES.sources.alsoReads], ['ordering.setup', ['inventory.items']]);
  assert.deepEqual([ENTRIES.cutoffs.capability, ENTRIES.cutoffs.alsoReads], ['ordering.setup', undefined]);
  assert.deepEqual([ENTRIES.pars.capability, ENTRIES.pars.alsoReads], ['ordering.par_levels', ['inventory.items']]);
  for (const name of ['replenishment_sources', 'replenishment_source_history']) {
    assert.match(fn(name), /begin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'read', p_facility_id\);\s+perform erp\.assert_permitted\(p_actor_id, 'inventory\.items', 'read', p_facility_id\);\s+if p_limit/, name);
  }
  assert.match(fn('order_cutoffs'), /begin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'read', p_facility_id\);\s+if p_limit/,
    'the cut-off list asks the setup alone');
  for (const name of ['par_levels', 'par_level_history']) {
    assert.match(fn(name), /begin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.par_levels', 'read', p_facility_id\);\s+perform erp\.assert_permitted\(p_actor_id, 'inventory\.items', 'read', p_facility_id\);/, name);
  }
  assert.equal(itemIsVisible(ENTRIES.cutoffs, viewerWith(['ordering.setup:read'])), true);
  assert.equal(itemIsVisible(ENTRIES.sources, viewerWith(['ordering.setup:read'])), false, 'sources ask items too');
  assert.equal(itemIsVisible(ENTRIES.pars, viewerWith(['ordering.par_levels:read'])), false, 'pars ask items too');
  assert.equal(itemIsVisible(ENTRIES.pars, viewerWith(BRANCH_STAFF, { 'inventory.items': 'hidden' })), false, 'items hidden');
  for (const [entry, flag] of [['replenishment_sources', 'seesSources'], ['order_cutoffs', 'seesCutoffs'], ['par_levels', 'seesPars']]) {
    assert.match(APP, new RegExp(`if \\(navIdOf\\(route\\) === '${entry}'\\) \\{\\s+if \\(!ctx\\.ordering\\.${flag}\\) return <Notice tone="info" text=\\{t\\(lang, 'refusal_forbidden'\\)\\} />;`),
      `a typed URL for ${entry} meets the answer the menu would have`);
  }
});

test('pars are read at a branch, a facility that supplies it, or the organisation; a branch reads its own alone', () => {
  assert.deepEqual(parPlace(null, undefined), { kind: 'org' });
  const fa = place(FACTORY, 'factory');
  const br = place(BRANCH, 'branch');
  assert.deepEqual(parPlace(FACTORY, fa), { kind: 'source', facility: fa });
  assert.deepEqual(parPlace(WAREHOUSE, place(WAREHOUSE, 'warehouse')).kind, 'source');
  assert.deepEqual(parPlace(BRANCH, br), { kind: 'branch', facility: br });
  assert.deepEqual(parPlace('of', place('of', 'office')), { kind: 'none' }, '0024 refuses an office (par_level_read_scope)');
  assert.deepEqual(parPlace(FACTORY, undefined), { kind: 'none' });
  assert.deepEqual(parPlace(FACTORY, br), { kind: 'none' }, 'a facility under another id is not where the person works');
  assert.match(MIGRATION, /if v_type not in \('warehouse', 'factory'\) then\s+raise exception 'a branch''s pars are read at the branch, or at a facility that supplies it'/);
  assert.deepEqual([...SUPPLYING_TYPES].sort(), ['factory', 'warehouse']);
  assert.match(MIGRATION, /if f\.facility_type not in \('warehouse', 'factory'\) then\s+raise exception 'facility % is a %, and supplies no branch'/);
  assert.match(PARS, /if \(place\.kind === 'branch'\) return <ParBranch ctx=\{ctx\} branchId=\{place\.facility\.facility_id\} \/>;/,
    'at a branch, the entry is its own pars: no other branch is offered');
  // Every read is asked where the person works, which the gate checks: never at the branch
  // shown, and never organisation-wide for someone who is not (found in review).
  assert.match(PARS, /return parPlace\(ctx\.facilityId, workingFacility\(ctx\.data\.facilities, ctx\.facilityId\)\);/);
  assert.match(PARS, /api\.parLevels\(\{ facilityId, branchId \}\)/);
  assert.match(PARS, /api\.parLevels\(\{ facilityId, branchId, after: next \}\)/);
  assert.match(PARS, /api\.parLevelHistory\(facilityId, branchId, itemId\),/);
  assert.match(PARS, /api\.parLevelHistory\(facilityId, branchId, itemId, next\)/);
  assert.match(PARS, /seesSources \? api\.replenishmentSourceHistory\(facilityId, itemId\) : Promise\.resolve\(null\)/);
  assert.match(PARS, /api\.getItem\(facilityId, itemId\)/);
  assert.match(PARS, /api\.getFacility\(facilityId, branchId\)/);
  assert.match(PARS, /api\.listFacilities\(\{ facilityId, status: 'all', after, limit: 500 \}\)/);
  assert.match(SOURCES, /api\.replenishmentSources\(\{ facilityId, suppliedBy: suppliedBy === '' \? null : suppliedBy \}\)/);
  assert.match(SOURCES, /api\.replenishmentSources\(\{ facilityId, suppliedBy: suppliedBy === '' \? null : suppliedBy, after: next \}\)/);
  assert.match(SOURCES, /api\.getItem\(facilityId, itemId\), api\.replenishmentSourceHistory\(facilityId, itemId\)/);
  assert.match(SOURCES, /api\.replenishmentSourceHistory\(facilityId, itemId, next\)/);
  assert.match(SOURCES, /api\.orderCutoffs\(\{ facilityId, after, limit: 500 \}\)/);
  assert.match(CUTOFFS, /api\.orderCutoffs\(\{ facilityId \}\)/);
  assert.match(CUTOFFS, /api\.orderCutoffs\(\{ facilityId, after: next \}\)/);
  assert.match(CUTOFFS, /readAll<CutoffRow>\(\(after\) => api\.orderCutoffs\(\{ facilityId, after, limit: 500 \}\)/);
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.doesNotMatch(src, /facilityId: null|\(null, (item|branch)/, `${name}: no read asked organisation-wide by itself`);
    assert.match(src, /const \{[^}]*\bfacilityId\b[^}]*\} = ctx;/, `${name}: facilityId is the context's`);
  }
  assert.deepEqual(branchesOf([place('b2', 'branch'), place(WAREHOUSE, 'warehouse'), { ...place('b1', 'branch'), code: 'A' }])
    .map((b) => b.facility_id), ['b1', 'b2']);
  assert.deepEqual(branchesOf([place('b2', 'branch'), { ...place('b3', 'branch'), brand_id: 'other' }], 'b').map((b) => b.facility_id), ['b2'],
    'at a warehouse or factory, its own brand\'s branches: 0024 reads no other brand\'s from there (found in review)');
  assert.match(PARS, /setBranches\(branchesOf\(data\.facilities, brandId\)\);/);
  assert.match(PARS, /const brandId = place\.kind === 'source' \? place\.facility\.brand_id : null;/);
  assert.match(PARS, /t\(lang, seesFacilities \? 'par_no_branches' : 'par_needs_facilities'\)/, 'an empty fallback says what is missing');
});

test('a source is offered only among the open warehouses and factories of the item\'s brand, never the one in force', () => {
  const row = (facility_id: string, over: Partial<CutoffRow> = {}): CutoffRow => ({
    facility_id, code: facility_id, facility_type: 'warehouse', name_en: 'W', name_ar: 'م', status: 'open', tz_name: 'Asia/Riyadh',
    cutoff: null, as_of_decision_id: null, decided_at: null, ...over,
  });
  const facilities: ViewerFacility[] = [
    { ...place(WAREHOUSE, 'warehouse'), brand_id: 'ft' }, { ...place(FACTORY, 'factory'), brand_id: 'ft' },
    { ...place('w2', 'warehouse'), brand_id: 'other' }, { ...place('w3', 'warehouse'), brand_id: 'ft' },
  ];
  const offered = (current: string | null) => sourceOptions(
    [row(WAREHOUSE), row(FACTORY, { facility_type: 'factory' }), row('w2'), row('w3', { status: 'closed' }), row('unknown')],
    facilities, 'ft', current).map((c) => c.facility_id);
  assert.deepEqual(offered(null), [WAREHOUSE, FACTORY], 'another brand\'s, a closed one and one of no known brand are not offered');
  assert.deepEqual(offered(WAREHOUSE), [FACTORY], 'setting the source in force again is refused (replenishment_source_unchanged)');
  assert.match(MIGRATION, /constraint = 'replenishment_source_unchanged'/);
  assert.match(MIGRATION, /constraint = 'replenishment_source_brand_differs'/);
  assert.match(SOURCES, /sourceOptions\(supplying\.rows, ctx\.data\.facilities, item\.brand_id, current\?\.facility_id \?\? null\)/);
  assert.deepEqual(sourceActions({ setsSources: true, itemActive: true, inForce: false }), { set: true, clear: false });
  assert.deepEqual(sourceActions({ setsSources: true, itemActive: false, inForce: true }), { set: false, clear: true },
    'a retired item takes no source, and its source can still be cleared (0024)');
  assert.deepEqual(sourceActions({ setsSources: false, itemActive: true, inForce: true }), { set: false, clear: false });
});

test('a cut-off\'s page is read organisation-wide or at its facility, and changed only there, while it is open', () => {
  assert.equal(cutoffReadable(null, WAREHOUSE), true);
  assert.equal(cutoffReadable(WAREHOUSE, WAREHOUSE), true);
  assert.equal(cutoffReadable(BRANCH, WAREHOUSE), false, '0024 asks its history at the facility');
  assert.match(MIGRATION, /create or replace function erp\.order_cutoff_history\([\s\S]*?begin\s+perform erp\.assert_permitted\(p_actor_id, 'ordering\.setup', 'read', p_facility_id\);/);
  const at = (over: Partial<Parameters<typeof cutoffActions>[0]>) => cutoffActions({
    setsCutoffs: true, facilityId: WAREHOUSE, shown: WAREHOUSE, status: 'open', inForce: true, ...over,
  });
  assert.deepEqual(at({}), { set: true, clear: true });
  assert.deepEqual(at({ inForce: false }), { set: true, clear: false });
  assert.deepEqual(at({ shown: FACTORY }), { set: false, clear: false }, 'another facility\'s, even to one who sets cut-offs');
  assert.deepEqual(at({ facilityId: null }), { set: false, clear: false }, 'organisation-wide');
  assert.deepEqual(at({ status: 'closed' }), { set: false, clear: false }, '0024 asks it open for both');
  assert.deepEqual(at({ setsCutoffs: false }), { set: false, clear: false });
  assert.match(CUTOFFS, /cutoffReadable\(facilityId, r\.facility_id\)/, 'the list links only to a page that can be read');
  assert.match(CUTOFFS, /api\.orderCutoffHistory\(targetId\)/);
  // The page asks the logic, with the facility shown and where the person works (found in review).
  assert.match(CUTOFFS, /const actions = cutoffActions\(\{\s+setsCutoffs: ctx\.ordering\.setsCutoffs, facilityId, shown: facility\.facility_id, status: facility\.status, inForce: current !== null,\s+\}\);/);
  assert.match(CUTOFFS, /const notice = cutoffPageNotice\(\{ rights: ctx\.ordering, facilityId, shown: facility\.facility_id, status: facility\.status \}\);/);
  assert.match(CUTOFFS, /\{notice !== null \? <Notice tone="info" text=\{t\(lang, notice, \{ code: facility\.code \}\)\} \/> : null\}/, 'said, with its facility named');
  assert.match(CUTOFFS, /<Notice tone="info" text=\{t\(lang, cutoffsListNotice\(ctx\.ordering\)\)\} \/>/);
  // Who is told what: a reason, never an invitation that leads nowhere (found in review).
  const sets = { setsCutoffs: true, writesCutoffs: true };
  const writes = { setsCutoffs: false, writesCutoffs: true };
  const reads = { setsCutoffs: false, writesCutoffs: false };
  assert.equal(cutoffsListNotice(sets), 'cutoff_change_here');
  assert.equal(cutoffsListNotice(writes), 'cutoffs_change_at_facility', 'the administrator, elsewhere: change it at its facility');
  assert.equal(cutoffsListNotice(reads), 'read_only_cutoffs', 'a manager at their own facility is not told to work there');
  const page = (rights: typeof sets, facilityId: string | null, status: 'open' | 'closed' = 'open') =>
    cutoffPageNotice({ rights, facilityId, shown: WAREHOUSE, status });
  assert.equal(page(sets, WAREHOUSE), null, 'its own page, to one who sets it: the forms say it all');
  assert.equal(page(sets, WAREHOUSE, 'closed'), 'rule_facility_no_new_work');
  assert.equal(page(writes, null), 'cutoff_elsewhere');
  assert.equal(page(sets, FACTORY), 'cutoff_elsewhere');
  assert.equal(page(reads, WAREHOUSE), 'read_only_cutoffs');
  assert.equal(page(reads, null), 'read_only_cutoffs');
  for (const k of ['cutoff_change_here', 'cutoffs_change_at_facility', 'read_only_cutoffs', 'cutoff_elsewhere']) assert.notEqual(asKey(k), null, k);
});

test('a par\'s page offers set and clear as 0024 would take them', () => {
  const org = { setsPars: true, parFrom: null };
  const fa = { setsPars: true, parFrom: FACTORY };
  const base = { branchStatus: 'open' as const, branchState: 'pilot' as CapabilityState | null, itemActive: true, inForce: true,
    source: FACTORY as string | null | undefined, sourceStatus: 'open' as const };
  assert.deepEqual(parActions({ rights: org, ...base }), { set: true, clear: true });
  assert.deepEqual(parActions({ rights: fa, ...base }), { set: true, clear: true });
  assert.deepEqual(parActions({ rights: fa, ...base, source: WAREHOUSE }), { set: false, clear: false },
    'from a facility, only the items it supplies (par_level_not_its_source)');
  assert.deepEqual(parActions({ rights: fa, ...base, source: undefined }), { set: true, clear: true }, 'a source unread is left to 0024');
  assert.deepEqual(parActions({ rights: org, ...base, source: null }), { set: false, clear: true },
    'no source: no new par, and the one it has cleared organisation-wide (0024)');
  assert.deepEqual(parActions({ rights: fa, ...base, source: null }), { set: false, clear: false });
  assert.deepEqual(parActions({ rights: org, ...base, branchStatus: 'closed' }), { set: false, clear: false }, '0024 asks the branch open for both');
  assert.deepEqual(parActions({ rights: org, ...base, branchStatus: null }), { set: true, clear: true }, 'a branch whose state is unread is left to 0024');
  assert.deepEqual(parActions({ rights: org, ...base, sourceStatus: 'closed' }), { set: false, clear: true }, 'a closed source takes no new par');
  assert.deepEqual(parActions({ rights: org, ...base, itemActive: false }), { set: false, clear: true });
  assert.deepEqual(parActions({ rights: org, ...base, inForce: false }), { set: true, clear: false });
  assert.deepEqual(parActions({ rights: { setsPars: false, parFrom: null }, ...base }), { set: false, clear: false });
  // Par levels' state at the branch, which 0024 asks again there (found in review).
  for (const state of ['hidden', 'read_only', 'withdrawn'] as const) {
    assert.deepEqual(parActions({ rights: fa, ...base, branchState: state }), { set: false, clear: false }, `par levels ${state} at the branch`);
  }
  assert.deepEqual(parActions({ rights: fa, ...base, branchState: 'enabled' }), { set: true, clear: true });
  assert.deepEqual(parActions({ rights: fa, ...base, branchState: null }), { set: true, clear: true }, 'a state unread is left to 0024');
  assert.deepEqual([branchAdmits('pilot'), branchAdmits('enabled'), branchAdmits('read_only'), branchAdmits('withdrawn'), branchAdmits('hidden'),
    branchAdmits(null)], [true, true, false, false, false, null]);
  assert.match(fn('assert_par_branch'), /perform erp\.assert_capability_admits\('ordering\.par_levels', f\.facility_id\);/);
  assert.match(fn('assert_par_read'), /if erp\.capability_state_for\('ordering\.par_levels', b\.facility_id\) = 'hidden' then/);
  assert.match(MIGRATION, /perform erp\.assert_facility_open\(v_source\);/);
  assert.match(MIGRATION, /f := erp\.assert_facility_open\(p_branch_id\);/);
  // The page asks the logic with what it read, the branch's state included (found in review).
  assert.match(PARS, /const actions = parActions\(\{\s+rights: ctx\.ordering, branchStatus: branch\?\.status \?\? null, branchState, itemActive: item\.status === 'active',\s+inForce: current !== null, source: source === undefined \? undefined : source\.id, sourceStatus,\s+\}\);/);
  assert.match(PARS, /const sets = ctx\.ordering\.setsPars && branch\?\.status !== 'closed' && branchAdmits\(branchState\) !== false;/);
  assert.match(SOURCES, /const actions = sourceActions\(\{ setsSources: ctx\.ordering\.setsSources, itemActive: item\.status === 'active', inForce: current !== null \}\);/);
  assert.equal([...PARS.matchAll(/const branchState = useBranchState\(ctx, place, branchId\);/g)].length, 2, 'both par pages read the branch\'s state');
  assert.match(PARS, /void api\.session\(branchId\)\.then/, 'read as the viewer reads it, at the branch');
  // How the state is read, not only that it is (found in the second review).
  assert.match(PARS, /const own = branchIsHere\(place, branchId\);/);
  assert.match(PARS, /if \(answer\.ok\) setState\(stateOf\(toViewer\(answer\.value\.viewer\), PAR_CAPABILITY\)\);/);
  assert.match(PARS, /return own \? stateOf\(viewer, PAR_CAPABILITY\) : state;/, 'the session\'s own at the branch worked at');
  assert.equal(PAR_CAPABILITY, 'ordering.par_levels');
  assert.ok(fn('assert_par_branch').includes(`erp.assert_capability_admits('${PAR_CAPABILITY}', f.facility_id)`), '0024 asks this capability at the branch');
  const wh = place(WAREHOUSE, 'warehouse');
  const br = place(BRANCH, 'branch');
  assert.equal(branchIsHere({ kind: 'branch', facility: br }, BRANCH), true, 'its own branch: the session\'s state');
  assert.equal(branchIsHere({ kind: 'branch', facility: br }, '01936f00-0000-7000-8000-000000000402'), false, 'another branch, typed: read there');
  assert.equal(branchIsHere({ kind: 'source', facility: wh }, BRANCH), false, 'from a warehouse: read at the branch, never the warehouse\'s');
  assert.equal(branchIsHere({ kind: 'org' }, BRANCH), false);
  assert.match(PARS, /\{sets && place\.kind !== 'branch' && place\.kind !== 'none'\s+\? <ParItemChooser /, 'no item is offered where pars take no change');
  // Where a par is set from is the rights', and stated on both writes.
  assert.equal([...PARS.matchAll(/from: ctx\.ordering\.parFrom,/g)].length, 2);
  assert.doesNotMatch(PARS, /from: (facilityId|ctx\.facilityId|null|here)/);
});

// --- refusals ------------------------------------------------------------------

test('every constraint 0024 raises for a person to act on is worded, and its retry keys are not', () => {
  const raised = [...new Set([...MIGRATION.matchAll(/constraint = '((?:ordering|replenishment_source|order_cutoff|par_level)_\w+)'/g)].map((m) => m[1]!))]
    // Not the retry keys, nor the guards' (no route reaches a delete or a move), nor the page size, which no screen sends wrong.
    .filter((c) => !c.endsWith('_decision_pkey') && !['ordering_setting_never_deleted', 'ordering_setting_fixed', 'ordering_page_size'].includes(c));
  assert.ok(raised.length >= 20, raised.join(', '));
  const generic = (status: string) => failureMessage('en', { ok: false, http: 422, status, message: 'm', constraint: null, detail: null, field: null }).text;
  // And the shared ones 0024 raises through the helpers it calls, other than item_exists,
  // whose words are the generic not-found's own (found in review: facility_is_closed is not
  // among them; a closed facility is facility_admits_no_new_work).
  for (const [helper, constraint] of [['assert_facility_open', 'facility_admits_no_new_work'], ['assert_item_active', 'item_admits_no_new_work']]) {
    assert.ok(MIGRATION.includes(`erp.${helper}(`), `0024 calls erp.${helper}()`);
    assert.ok(read('supabase/migrations/' + (helper === 'assert_item_active' ? '20261002000200_items_and_units.sql' : '20261005000100_facilities.sql'))
      .includes(`constraint = '${constraint}'`), `${helper} raises ${constraint}`);
  }
  for (const c of [...raised, 'item_unit_exists', 'facility_exists', 'facility_admits_no_new_work', 'item_admits_no_new_work']) {
    for (const status of ['refused', 'invalid', 'stale', 'not_found']) {
      const m = failureMessage('en', { ok: false, http: 422, status, message: 'm', constraint: c, detail: null, field: null });
      assert.notEqual(m.text, generic(status), `${c} as ${status}`);
    }
  }
  const messages = read('apps/console/src/messages.ts');
  for (const pkey of ['replenishment_source_decision_pkey', 'order_cutoff_decision_pkey', 'par_level_decision_pkey']) {
    assert.ok(MIGRATION.includes(`constraint = '${pkey}'`), pkey);
    assert.doesNotMatch(messages, new RegExp(`${pkey}:`), 'a native collision is no "already saved"');
  }
  for (const [kinds, log] of [[SOURCE_KINDS, 'replenishment_source'], [CUTOFF_KINDS, 'order_cutoff'], [PAR_KINDS, 'par_level']] as const) {
    assert.match(MIGRATION, new RegExp(`${log}_decision_kind_is_known check \\(kind in \\(${kinds.map((k) => `'${k}'`).join(', ')}\\)\\)`), log);
    for (const k of kinds) assert.notEqual(asKey(`kind_${k}`), null, k);
  }
});

// --- routes ---------------------------------------------------------------------

test('ordering-setup routes parse and format both ways, and mark their own entry current', () => {
  const routes: [Route, string][] = [
    [{ screen: 'replenishment_sources' }, 'replenishment_sources'],
    [{ screen: 'replenishment_source', itemId: ITEM }, 'replenishment_sources'],
    [{ screen: 'order_cutoffs' }, 'order_cutoffs'],
    [{ screen: 'order_cutoff', targetId: WAREHOUSE }, 'order_cutoffs'],
    [{ screen: 'par_levels' }, 'par_levels'],
    [{ screen: 'par_branch', branchId: BRANCH }, 'par_levels'],
    [{ screen: 'par_item', branchId: BRANCH, itemId: ITEM }, 'par_levels'],
  ];
  for (const [r, nav] of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), nav, r.screen);
  }
  assert.deepEqual(parseRoute(`#par_levels/${BRANCH.toUpperCase()}/items/${ITEM.toUpperCase()}`),
    { screen: 'par_item', branchId: BRANCH, itemId: ITEM });
  for (const bad of [`#par_levels/${BRANCH}/items`, `#par_levels/${BRANCH}/items/${ITEM}/x`, `#par_levels/${BRANCH}/${ITEM}`, `#par_levels/nope`, `#par_levels/${BRANCH}/items/nope`,
    `#order_cutoffs/${WAREHOUSE}/x`, '#order_cutoffs/nope', `#replenishment_sources/${ITEM}/edit`]) {
    assert.equal(parseRoute(bad).screen, 'unknown', bad);
  }
});

// --- the screens ----------------------------------------------------------------

test('every write goes through the shared lifecycle, and Start over looks for the lost request in the history it reads', () => {
  for (const [name, src] of Object.entries(SCREENS)) {
    assert.equal([...src.matchAll(/= useWrite\(ctx, /g)].length, 2, `${name}: set and clear`);
    // A write lost in doubt: Start over reads the history, and says "already saved" when the request is there.
    assert.equal([...src.matchAll(/\(seen\) => \(seen as (Source|Cutoff|Par)History\)\.decisions\.some\(\(d\) => d\.decision_id === ids\.decision_id\)(, notSuppliedHere\(ctx\))?\);/g)].length, 2,
      `${name}: both forms ask whether what Start over read holds the lost request`);
    assert.match(src, /setReloading\(true\);\s+void load\(\);/, `${name}: after a write the forms wait for the reload`);
    assert.match(src, /\{reloading && failure !== null\s+\? <button type="button" onClick=\{\(\) => \{ setFailure\(null\); void load\(\); \}\}>/,
      `${name}: a reload that failed can be asked again, the forms still withdrawn`);
    assert.match(src, /if \(mine !== generation\.current\) return;/, `${name}: an older page asked before a reload is dropped`);
  }
  assert.match(SOURCES, /void w\.run\(\(\) => api\.setReplenishmentSource\(id, body\)\);/);
  assert.match(SOURCES, /void w\.run\(\(\) => api\.clearReplenishmentSource\(id, body\)\);/);
  assert.match(CUTOFFS, /void w\.run\(\(\) => api\.setOrderCutoff\(id, body\)\);/);
  assert.match(CUTOFFS, /void w\.run\(\(\) => api\.clearOrderCutoff\(id, body\)\);/);
  assert.match(PARS, /void w\.run\(\(\) => api\.setParLevel\(id, body\)\);/);
  assert.match(PARS, /const par = \{ branchId, itemId: item\.item_id \};\s+const body = clearParBody\(/, 'a clear names its branch and item in the path');
  assert.match(PARS, /void w\.run\(\(\) => api\.clearParLevel\(par, body\)\);/);
  // Each form's Start over reads the history its write would be confirmed by, asked as the write was.
  assert.equal([...SOURCES.matchAll(/useWrite\(ctx, \(\) => ctx\.api\.replenishmentSourceHistory\(ctx\.facilityId, item\.item_id\), onDone,/g)].length, 2);
  assert.equal([...CUTOFFS.matchAll(/useWrite\(ctx, \(\) => ctx\.api\.orderCutoffHistory\(facility\.facility_id\), onDone,/g)].length, 2);
  assert.equal([...PARS.matchAll(/useWrite\(ctx, \(\) => ctx\.api\.parLevelHistory\(ctx\.facilityId, branchId, item\.item_id\), onDone,/g)].length, 2);
  // What each page offers is the logic's, tested above.
  assert.match(SOURCES, /\{actions\.set && !reloading && supplying\.failure === null\s+\? <SetSource /);
  assert.match(SOURCES, /\{actions\.clear && !reloading && stamp !== null\s+\? <ClearSource /);
  assert.match(CUTOFFS, /\{actions\.set && !reloading \? <SetCutoff /);
  assert.match(CUTOFFS, /\{actions\.clear && !reloading && stamp !== null \? <ClearCutoff /);
  assert.match(PARS, /\{actions\.set && !reloading \? <SetPar /);
  assert.match(PARS, /\{actions\.clear && !reloading && stamp !== null\s+\? <ClearPar /);
});

test('from a supplying facility, the items offered a par are those it supplies', async () => {
  assert.match(PARS, /api\.replenishmentSources\(\{ facilityId: here, suppliedBy: here, after, limit: 500 \}\)/);
  assert.match(PARS, /matchItems\(rows\.filter\(\(r\) => r\.item_status === 'active'\), q\)/, 'an active item only: a par is new work');
  assert.match(PARS, /api\.listItems\(\{ facilityId, brandId, status: 'active', search: q, limit: 20 \}\)/,
    'organisation-wide, any active item of the branch\'s brand');
  const rows = [
    { code: 'RM-CHK-BREAST', name_en: 'Chicken breast', name_ar: 'صدر دجاج' },
    { code: 'PK-BOX', name_en: 'Meal box', name_ar: 'علبة وجبة' },
  ];
  assert.deepEqual(matchItems(rows, 'rm-chk').map((r) => r.code), ['RM-CHK-BREAST'], 'a code from its start, case aside');
  assert.deepEqual(matchItems(rows, 'BOX').map((r) => r.code), ['PK-BOX'], 'any part of a name');
  assert.deepEqual(matchItems(rows, 'chicken').map((r) => r.code), ['RM-CHK-BREAST'], 'a name, whatever its case (found in review)');
  assert.deepEqual(matchItems(rows, 'MEAL').map((r) => r.code), ['PK-BOX']);
  assert.deepEqual(matchItems(rows, 'دجاج').map((r) => r.code), ['RM-CHK-BREAST'], 'in Arabic too');
  assert.deepEqual(matchItems(rows, 'CHK'), [], 'a code is matched from its start');
  assert.deepEqual(matchItems(rows, '  '), []);
});

test('a list read whole stops at MAX_PAGES and says so, never showing part of it as all', async () => {
  let asked = 0;
  const page = async (after: string | null) => {
    asked++;
    return { ok: true as const, value: { rows: [after ?? 'first'], next: `p${asked}` } };
  };
  const capped = await readAll(page);
  assert.equal(capped.ok, false);
  assert.equal(asked, MAX_PAGES);
  let n = 0;
  const done = await readAll(async (after: string | null) => ({ ok: true as const, value: { rows: [after ?? 'a'], next: ++n < 3 ? `c${n}` : null } }));
  assert.deepEqual(done, { ok: true, value: ['a', 'c1', 'c2'] });
  const refused = await readAll(async () => ({ ok: false as const, http: 403, status: 'forbidden', message: null, constraint: null, detail: null, field: null }));
  assert.equal(refused.ok, false);
});

test('a cut-off is shown at its own facility\'s time, and the history reads 0024\'s HH:MM', () => {
  const h: CutoffDecision[] = [{ decision_id: SET, seq: '2', kind: 'cutoff_set', cutoff: '11:00', reason: 'r', actor_id: ME,
    decided_at: '2026-10-08T06:00:00.000Z', recorded_at: '2026-10-08T06:00:00.000Z', is_current: true }];
  assert.equal(inForce(h)?.cutoff, '11:00');
  assert.match(MIGRATION, /left\(d\.cutoff::text, 5\)/, 'the history answers HH:MM');
  assert.match(MIGRATION, /left\(c\.cutoff::text, 5\)/, 'and the list');
  assert.match(CUTOFFS, /t\(lang, 'set_cutoff_hint', \{ tz: facility\.tz_name \}\)/, 'the form names the time zone it is read in');
  const p: ParDecision = { decision_id: SET, seq: '1', kind: 'par_set', item_unit_id: CARTON, unit_key: 'carton', factor: '10', quantity: '3',
    par: '30', reason: 'r', actor_id: ME, decided_at: '2026-10-08T06:00:00.000Z', recorded_at: '2026-10-08T06:00:00.000Z', is_current: true };
  assert.equal(inForce([p])?.par, '30');
  const s: SourceDecision = { decision_id: SET, seq: '1', kind: 'source_set', facility_id: WAREHOUSE, facility_code: 'WH-001', reason: 'r',
    actor_id: ME, decided_at: '2026-10-08T06:00:00.000Z', recorded_at: '2026-10-08T06:00:00.000Z', is_current: true };
  assert.equal(inForce([s])?.facility_code, 'WH-001');
});

test('every form a par page withholds has a stated reason, first reason first', () => {
  const fa = { setsPars: true, parFrom: FACTORY };
  const org = { setsPars: true, parFrom: null };
  const item = (over: Partial<{ active: boolean; source: string | null | undefined; sourceStatus: 'open' | 'closed' | null }> = {}) =>
    ({ active: true, source: FACTORY as string | null | undefined, sourceStatus: 'open' as 'open' | 'closed' | null, ...over });
  const at = (over: Partial<Parameters<typeof parNotice>[0]> = {}) =>
    parNotice({ rights: fa, branchStatus: 'open', branchState: 'pilot', item: item(), ...over });
  assert.equal(at(), null);
  assert.equal(at({ branchState: 'hidden', branchStatus: 'closed' }), 'par_branch_hidden', 'not switched on at the branch: 0024 reads none');
  assert.equal(at({ branchStatus: 'closed' }), 'par_branch_closed');
  assert.equal(at({ branchState: 'read_only' }), 'par_branch_not_open');
  assert.equal(at({ branchState: 'withdrawn' }), 'par_branch_not_open');
  assert.equal(at({ rights: { setsPars: false, parFrom: null } }), 'read_only_pars');
  assert.equal(at({ item: item({ source: WAREHOUSE }) }), 'par_set_elsewhere');
  assert.equal(at({ rights: org, item: item({ source: WAREHOUSE }) }), null, 'organisation-wide sets any source\'s item');
  assert.equal(at({ rights: org, item: item({ source: null }) }), 'par_no_source');
  assert.equal(at({ item: item({ active: false }) }), 'par_item_retired', 'found in review: Set went without a word');
  assert.equal(at({ item: item({ sourceStatus: 'closed' }) }), 'par_source_closed', 'found in review: Set went without a word');
  assert.equal(at({ item: item({ source: undefined }) }), null, 'a source unread is left to 0024');
  assert.equal(parNotice({ rights: fa, branchStatus: 'open', branchState: 'pilot' }), null, 'a branch\'s page gives only the branch\'s reasons');
  // Every reason parActions has for withholding Set is one parNotice says.
  for (const over of [{ branchState: 'hidden' as const }, { branchStatus: 'closed' as const }, { branchState: 'read_only' as const },
    { item: item({ source: WAREHOUSE }) }, { item: item({ active: false }) }, { item: item({ sourceStatus: 'closed' }) }]) {
    const f = { rights: fa, branchStatus: 'open' as const, branchState: 'pilot' as const, item: item(), ...over };
    const a = parActions({ rights: f.rights, branchStatus: f.branchStatus, branchState: f.branchState, itemActive: f.item.active,
      inForce: true, source: f.item.source, sourceStatus: f.item.sourceStatus });
    assert.equal(a.set, false, JSON.stringify(over));
    assert.notEqual(parNotice(f), null, JSON.stringify(over));
  }
  for (const k of ['par_branch_hidden', 'par_branch_closed', 'par_branch_not_open', 'read_only_pars', 'par_set_elsewhere', 'par_no_source',
    'par_item_retired', 'par_source_closed', 'par_needs_facilities']) {
    assert.notEqual(asKey(k), null, k);
  }
  assert.match(PARS, /const notice = parNotice\(\{\s+rights: ctx\.ordering, branchStatus: branch\?\.status \?\? null, branchState,\s+item: \{ active: item\.status === 'active', source: source === undefined \? undefined : source\.id, sourceStatus \},\s+\}\);/);
  assert.match(PARS, /const notice = parNotice\(\{ rights: ctx\.ordering, branchStatus: branch\?\.status \?\? null, branchState \}\);/);
  assert.equal([...PARS.matchAll(/notice !== null \? <Notice tone="info" text=\{t\(lang, notice/g)].length, 2, 'both pages say it');
  assert.match(PARS, /\{hiddenRefusal\(branchState, failure\) \? <Notice tone="info" text=\{t\(lang, 'par_branch_hidden'\)\} \/>/,
    'hidden at the branch, the reason, not the refusal, on the item page');
  assert.match(PARS, /const hiddenSaid = hiddenRefusal\(branchState, failure\);/);
  assert.match(PARS, /const showNotice = notice !== null && !\(notice === 'par_branch_hidden' && failure !== null && !hiddenSaid\);/);
  assert.match(PARS, /\{failure && !hiddenSaid \? <FailureNotice /, '...and on the branch page (found in the second review)');
  assert.match(PARS, /\{showNotice && notice !== null \? <Notice tone="info" text=\{t\(lang, notice\)\} \/> : null\}/);
  // Only 0024's own "hidden" refusal is said as such: a branch it does not know is its to say.
  const forbidden = { status: 'forbidden' };
  assert.equal(hiddenRefusal('hidden', forbidden), true);
  assert.equal(hiddenRefusal('hidden', { status: 'not_found' }), false, 'another brand\'s branch, or none: missing, as 0024 says');
  assert.equal(hiddenRefusal('hidden', { status: 'refused' }), false, 'a facility that is no branch');
  assert.equal(hiddenRefusal('pilot', forbidden), false);
  assert.equal(hiddenRefusal('hidden', null), false);
  // A reason that names a facility is given it.
  assert.match(PARS, /\{notice !== null \? <Notice tone="info" text=\{t\(lang, notice, \{ code: source\?\.code \?\? '' \}\)\} \/> : null\}/);
});

test('from a warehouse or factory, an item supplied elsewhere is said to be, and a par write in doubt there can settle', () => {
  // 0024 answers a par's history as missing at a facility that does not supply the item...
  assert.match(fn('par_level_history'), /p_facility_id is null or p_facility_id = b\.facility_id or s\.facility_id = p_facility_id\)\) then\s+raise exception 'no item %'/);
  // ...so the page says where it is set, from the item's source history (found in review).
  assert.match(PARS, /const fromSupplier = place\.kind === 'source' \? place\.facility\.facility_id : null;/);
  assert.match(PARS, /if \(!h\.ok && i\.ok && suppliedElsewhere\(fromSupplier, h, supplied === undefined \? undefined : supplied\.id\)\) \{\s+setItem\(i\.value\);\s+setHistory\(null\);\s+setSource\(supplied\);\s+setNotHere\(true\);/);
  assert.match(PARS, /if \(item !== null && notHere\) \{/);
  assert.match(PARS, /\{banner \? <Notice tone=\{banner\.tone\} text=\{banner\.text\} \/> : null\}\s+<Notice tone="info" text=\{source === undefined \? t\(lang, 'par_not_supplied_here', \{ code: here \}\)/,
    'a write\'s answer is said there too (found in the second review)');
  assert.match(PARS, /source\.id === null \? t\(lang, 'par_no_source'\) : t\(lang, 'par_set_elsewhere', \{ code: source\.code \?\? shortId\(source\.id\) \}\)/);
  assert.match(PARS, /const here = place\.kind === 'source' \? place\.facility\.code : '';/, 'the facility it names is where the person works');
  // A write's outcome, said as the page that follows can: never "shown as it is now" where
  // no par is shown (found in the third review).
  assert.match(PARS, /if \(item !== null && notHere\) \{\s+const here = [^;]+;\s+const banner = said\(false\);/);
  assert.match(PARS, /const banner = said\(true\);/);
  assert.match(PARS, /const afterWrite: Done = \(done\) => \{\s+setOutcome\(done\);/);
  assert.match(PARS, /const key = parWriteBanner\(outcome, shown\);/);
  assert.deepEqual([parWriteBanner('already', true), parWriteBanner('already', false)], ['par_already_recorded', 'par_already_recorded_elsewhere']);
  assert.deepEqual([parWriteBanner('stale', true), parWriteBanner('stale', false)], ['par_changed', 'par_changed_elsewhere']);
  assert.deepEqual([parWriteBanner('saved', false), parWriteBanner('checked', false), parWriteBanner(null, true)], ['saved', null, null]);
  for (const k of ['par_already_recorded_elsewhere', 'par_changed_elsewhere']) {
    for (const lang of ['en', 'ar'] as const) {
      assert.doesNotMatch(STRINGS[lang][k as 'par_changed_elsewhere'], /shown|يُعرض/, `${lang} ${k}: no par is shown there`);
    }
  }
  // item_exists alone: a branch 0024 does not know is facility_exists, and its to say.
  const missingItem = { status: 'not_found', constraint: 'item_exists' };
  assert.equal(suppliedElsewhere(FACTORY, missingItem, WAREHOUSE), true);
  assert.equal(suppliedElsewhere(FACTORY, missingItem, null), true, 'supplied by nothing');
  assert.equal(suppliedElsewhere(FACTORY, missingItem, undefined), true, 'the source unread: still not known to be here');
  assert.equal(suppliedElsewhere(FACTORY, missingItem, FACTORY), false);
  assert.equal(suppliedElsewhere(FACTORY, { status: 'not_found', constraint: 'facility_exists' }, WAREHOUSE), false, 'a branch 0024 does not know');
  assert.equal(suppliedElsewhere(FACTORY, { status: 'forbidden', constraint: null }, WAREHOUSE), false);
  assert.equal(suppliedElsewhere(null, missingItem, WAREHOUSE), false, 'organisation-wide, every par is read');
  assert.equal(suppliedElsewhere(FACTORY, null, WAREHOUSE), false);
  assert.match(fn('par_level_history'), /raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';/);
  // A write in doubt whose Start over is answered "missing" there cannot be repeated from
  // there, as 0024 takes no par of that item from there: it settles (write.ts, `settled`).
  assert.match(PARS, /const notSuppliedHere = \(ctx: Ctx\) => \(f: Failure\): boolean => suppliedElsewhere\(ctx\.ordering\.parFrom, f, undefined\);/);
  assert.equal([...PARS.matchAll(/\(seen\) => \(seen as ParHistory\)\.decisions\.some\(\(d\) => d\.decision_id === ids\.decision_id\), notSuppliedHere\(ctx\)\);/g)].length, 2,
    'both par forms');
  assert.match(fn('set_par_level'), /perform erp\.assert_par_level_decision_is_new\(p_decision_id\);[\s\S]*v_source := erp\.assert_par_set_from\(p_facility_id, v_item, b\);/,
    'and 0024 checks a retry\'s id before where the par is set from');
});

test('a source page shows a failed read of the facilities, and promises a clear only where one is offered', () => {
  assert.match(SOURCES, /\{supplying\.failure !== null \? \(\s+<>\s+<FailureNotice lang=\{lang\} failure=\{supplying\.failure\} \/>\s+<button type="button" onClick=\{supplying\.reload\}>/,
    'found in review: the set form loaded for ever, saying nothing');
  assert.match(SOURCES, /\{actions\.set && !reloading && supplying\.failure === null\s+\? <SetSource /);
  assert.match(SOURCES, /\}, \[api, facilityId, seesCutoffs, onFailure, asked\]\);/, 'asked again on Reload');
  assert.match(SOURCES, /return \{ rows, failure, reload: \(\) => setAsked\(\(n\) => n \+ 1\) \};/, 'and Reload asks (found in the second review)');
  assert.match(SOURCES, /actions\.clear\s+\? `\$\{t\(lang, 'source_item_retired'\)\} \$\{t\(lang, 'source_item_retired_clear'\)\}` : t\(lang, 'source_item_retired'\)/);
});
