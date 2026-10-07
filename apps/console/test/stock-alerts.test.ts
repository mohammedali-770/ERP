import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Fetch, type ItemUnit, type MinimumDecision, type Notification } from '../src/api.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible } from '../src/navigation.ts';
import { openTarget } from '../src/notifications.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import {
  clearMinimumBody, currentMinimum, MINIMUM_KINDS, minimumInput, minimumPacks, setMinimumBody, stampOf,
} from '../src/stock-alerts.ts';
import { toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const MIGRATION = read('supabase/migrations/20261007000200_stock_minimums.sql');
const EDGE = read('supabase/functions/_shared/stock-alerts.ts');
const SCREEN = read('apps/console/src/screens/StockAlerts.tsx');
const APP = read('apps/console/src/App.tsx');

const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const KG = '01936f00-0000-7000-8000-000000004201';
const CARTON = '01936f00-0000-7000-8000-000000004203';
const SET = '01936f00-0000-7000-8000-000000005801';
const CLEARED = '01936f00-0000-7000-8000-000000005804';
const D = '01936f00-0000-7000-8000-0000000b0701';

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'ok', decision_id: 'd', minimums: [], decisions: [], next_after: null, next_before: null }),
      { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

const decision = (over: Partial<MinimumDecision>): MinimumDecision => ({
  decision_id: SET, seq: '1', kind: 'minimum_set', item_unit_id: CARTON, unit_key: 'carton', factor: '10', quantity: '10',
  minimum: '100', reason: 'r', actor_id: D, decided_at: '2026-09-26T08:00:00.000Z', recorded_at: '2026-09-26T08:00:00.000Z',
  is_current: true, ...over,
});

// --- the client ----------------------------------------------------------------

test('CONTROL: no stock-alerts call names an actor; a set states its stamp, null included; a clear names its item in the path only', async () => {
  const f = fake();
  const a = api(f);
  await a.setStockMinimum(setMinimumBody({ decision_id: D }, {
    facilityId: WAREHOUSE, itemUnitId: CARTON, quantity: '12', expectedDecisionId: SET, reason: ' Two days. ',
  }));
  await a.setStockMinimum(setMinimumBody({ decision_id: D }, {
    facilityId: WAREHOUSE, itemUnitId: KG, quantity: '5', expectedDecisionId: null, reason: 'First.',
  }));
  await a.clearStockMinimum(ITEM, clearMinimumBody({ decision_id: D }, { facilityId: WAREHOUSE, expectedDecisionId: SET, reason: 'Weekly.' }));
  await a.stockMinimums({ facilityId: WAREHOUSE, lowOnly: true, after: 'A', limit: 5 });
  await a.stockMinimums({ facilityId: WAREHOUSE });
  await a.stockMinimumHistory(WAREHOUSE, ITEM, '42');
  for (const s of f.sent) {
    assert.doesNotMatch(s.url, /actor|person/);
    for (const k of keys(s.body)) assert.doesNotMatch(k, /actor|person/, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    'POST /stock-alerts/minimums',
    'POST /stock-alerts/minimums',
    `POST /stock-alerts/items/${ITEM}/clear`,
    `GET /stock-alerts?facility_id=${WAREHOUSE}&low=true&after=A&limit=5`,
    `GET /stock-alerts?facility_id=${WAREHOUSE}`,
    `GET /stock-alerts/items/${ITEM}?facility_id=${WAREHOUSE}&before=42`,
  ]);
  assert.deepEqual(f.sent[0]!.body, {
    decision_id: D, facility_id: WAREHOUSE, item_unit_id: CARTON, quantity: '12', expected_decision_id: SET, reason: 'Two days.',
  });
  const first = f.sent[1]!.body as Record<string, unknown>;
  assert.ok(Object.hasOwn(first, 'expected_decision_id') && first['expected_decision_id'] === null,
    'a first minimum sends null, stated: the edge refuses one left out');
  assert.deepEqual(f.sent[2]!.body, { decision_id: D, facility_id: WAREHOUSE, expected_decision_id: SET, reason: 'Weekly.' });
  assert.equal(typeof (f.sent[0]!.body as { quantity: unknown }).quantity, 'string', 'a minimum travels as text');
});

// --- the quantity --------------------------------------------------------------

test('CONTROL: a minimum is the decimal text typed, by 0022\'s rule, and more than nothing', () => {
  assert.match(MIGRATION, /p_quantity !~ '\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,6\}\)\?\$'/, '0022\'s pattern, which the console holds');
  assert.match(MIGRATION, /if v_qty = 0 then/, '0022 refuses none');
  for (const [typed, sent] of [['12', '12'], ['2.5', '2.5'], [' 0.25 ', '0.25'], ['١٢٫٥', '12.5'], ['999999999999.999999', '999999999999.999999']]) {
    assert.deepEqual(minimumInput(typed!), { ok: true, value: sent }, typed);
  }
  for (const typed of ['0', '0.000', '', '-1', '1e3', '1,250', '1.1234567', '1234567890123', '.5', '2.']) {
    assert.equal(minimumInput(typed).ok, false, typed);
  }
  assert.doesNotMatch(SCREEN, /Number\(|parseFloat|parseInt|\* 1\b/, 'no stock-alert screen does arithmetic on a quantity');
  assert.match(SCREEN, /quantity: q\.value/, 'the set sends the text minimumInput checked');
});

// --- the stamp -----------------------------------------------------------------

test('CONTROL: the stamp is the decision in force, a clearing included; null only for an item that never had one', () => {
  assert.equal(stampOf([]), null, 'never had a minimum here');
  const cleared = [decision({ decision_id: CLEARED, seq: '2', kind: 'minimum_cleared', item_unit_id: null, unit_key: null,
    factor: null, quantity: null, minimum: null }), decision({ is_current: false })];
  assert.equal(stampOf(cleared), CLEARED, 'a cleared minimum is set again against its clearing (0022 keeps its row)');
  assert.equal(currentMinimum(cleared), null, 'and has no minimum in force');
  const set = [decision({})];
  assert.equal(stampOf(set), SET);
  assert.equal(currentMinimum(set)?.minimum, '100');
  assert.equal(stampOf([decision({ is_current: false, decision_id: CLEARED }), decision({ is_current: false })]), CLEARED,
    'the history is newest first: without a mark, its first row is in force');
  assert.match(SCREEN, /const stamp = stampOf\(history\)/, 'the page reads the stamp from the history, never the list');
  assert.match(SCREEN, /<SetMinimum ctx=\{ctx\} item=\{item\} facilityId=\{place\.facility\.facility_id\} stamp=\{stamp\}/);
  assert.match(SCREEN, /<ClearMinimum ctx=\{ctx\} item=\{item\} facilityId=\{place\.facility\.facility_id\} stamp=\{stamp\}/);
  assert.equal([...SCREEN.matchAll(/expectedDecisionId: stamp[,\s}]/g)].length, 2, 'set and clear each send the stamp they were handed');
  assert.doesNotMatch(SCREEN, /expectedDecisionId: (null|r\.|current|undefined)/);
});

test('a minimum is entered only in a current pack', () => {
  const unit = (id: string, status: 'active' | 'retired'): ItemUnit => ({ item_unit_id: id, unit_key: id, factor: '1', status, as_of_decision_id: SET });
  assert.deepEqual(minimumPacks([unit('a', 'active'), unit('b', 'retired'), unit('c', 'active')]).map((u) => u.item_unit_id), ['a', 'c']);
  assert.match(MIGRATION, /constraint = 'stock_minimum_pack_is_retired'/);
});

// --- refusals ------------------------------------------------------------------

test('every constraint 0022 raises for a person to act on is worded, and its retry key is not', () => {
  const raised = [...MIGRATION.matchAll(/constraint = '(stock_minimum_\w+)'/g)].map((m) => m[1]!)
    // Not the retry key, and not the guard's: no route reaches a delete or a move of a minimum.
    .filter((c) => !['stock_minimum_decision_pkey', 'stock_minimum_never_deleted', 'stock_minimum_fixed'].includes(c));
  assert.ok(raised.length >= 6, raised.join(', '));
  const generic = failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: null, detail: null, field: null }).text;
  for (const c of new Set(raised)) {
    const m = failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: c, detail: null, field: null });
    assert.notEqual(m.text, generic, c);
  }
  assert.doesNotMatch(read('apps/console/src/messages.ts'), /stock_minimum_decision_pkey:/, 'a native collision is no "already saved"');
  for (const k of MINIMUM_KINDS) assert.notEqual(asKey(`kind_${k}`), null, k);
  assert.match(MIGRATION, new RegExp(`kind in \\(${MINIMUM_KINDS.map((k) => `'${k}'`).join(', ')}\\)`), '0022\'s kinds');
});

// --- where, and who --------------------------------------------------------------

test('stock-alert routes parse and format both ways, name no facility, and mark their own entry current', () => {
  const routes: Route[] = [{ screen: 'stock_alerts' }, { screen: 'stock_alert_item', itemId: ITEM }];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'stock_alerts', `${r.screen} is not marked as stock`);
    assert.doesNotMatch(formatRoute(r), new RegExp(WAREHOUSE));
  }
  assert.equal(parseRoute(`#stock_alerts/items/${ITEM}/x`).screen, 'unknown');
  assert.equal(parseRoute('#stock_alerts/items/nope').screen, 'unknown');
  assert.equal(parseRoute(`#stock_alerts/${WAREHOUSE}`).screen, 'unknown', 'no route names a facility');
});

test('CONTROL: the entry opens only to one who reads alerts, stock and items, where none is hidden; changes only where stock changes', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'stock_alerts')!;
  const viewer = (permissions: string[], states: Record<string, string> = {}) => toViewer({
    person: { person_id: D, employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: WAREHOUSE, org_wide: false, facilities: [], permissions, brands: [], units: [],
    states: { 'inventory.stock_alerts': 'pilot', 'inventory.stock': 'pilot', 'inventory.items': 'pilot', ...states },
  });
  const all = ['inventory.stock_alerts:read', 'inventory.stock:read', 'inventory.items:read'];
  assert.equal(itemIsVisible(entry, viewer(all)), true);
  for (const missing of all) assert.equal(itemIsVisible(entry, viewer(all.filter((p) => p !== missing))), false, missing);
  assert.equal(itemIsVisible(entry, viewer(all, { 'inventory.stock': 'hidden' })), false, 'stock hidden');
  for (const gate of ["'inventory.stock_alerts', 'read'", "'inventory.stock', 'read'", "'inventory.items', 'read'"]) {
    assert.ok(MIGRATION.includes(`erp.assert_permitted(p_actor_id, ${gate}, p_facility_id)`), gate);
  }
  assert.match(APP, /stockAlertsWritable: itemIsVisible\(STOCK_ALERTS, viewer\)\s+&& stockWritable\(workingFacility\(data\.facilities, facilityId\), viewer, \(v\) => itemIsWritable\(STOCK_ALERTS, v\)\)/,
    'changes are offered at a warehouse or factory, as stock\'s are, to one who may read the list');
});

test('the screens read and write only at the facility worked at, and every write goes through the shared lifecycle', () => {
  assert.doesNotMatch(SCREEN, /ctx\.facilityId|facilityId: ctx\.|data\.facility_id/, 'the facility is stockPlace\'s, never read raw');
  assert.equal([...SCREEN.matchAll(/const place = stockPlace\(ctx\)/g)].length, 2, 'both pages ask stockPlace');
  assert.equal([...SCREEN.matchAll(/useWrite\(ctx,/g)].length, 2, 'set and clear');
  assert.equal([...SCREEN.matchAll(/void w\.run\(\(\) => api\.(setStockMinimum|clearStockMinimum)\(/g)].length, 2,
    'each built once and handed to run(), so Retry sends it as first sent');
  assert.match(SCREEN, /writableHere\(ctx\.stockAlertsWritable, status\)/, 'a closed facility offers no change');
  assert.match(SCREEN, /status: 'active', search: q/, 'only an active item is offered a minimum');
  assert.match(SCREEN, /\{writable && !reloading && item\.status === 'active'\s+\? <SetMinimum/, 'Set: an active item, once the page has read what the last write left');
  assert.match(SCREEN, /\{writable && !reloading && current !== null && stamp !== null\s+\? <ClearMinimum/, 'Clear: only while a minimum is in force');
  assert.match(SCREEN, /const packs = minimumPacks\(item\.units\);/, 'only current packs are offered');
  assert.match(SCREEN, /if \(unitId !== '' && !packs\.some\(\(u\) => u\.item_unit_id === unitId\)\) setUnitId\(''\);/,
    'a pack retired since the form opened is never left chosen');
  assert.match(SCREEN, /setReloading\(true\);\s+void load\(\);/, 'after a write the forms wait for the reload');
  assert.match(SCREEN, /if \(mine !== generation\.current\) return;/, 'an older page asked before a reload is dropped');
  assert.match(EDGE, /POST  \/stock-alerts\/minimums/);
});

test('a low-stock notification opens the decision that took the item across, at its facility', () => {
  const n: Notification = {
    notification_id: D, seq: '9', kind: 'stock_low', facility_id: WAREHOUSE, facility_code: 'WH-001', stock_decision_id: SET,
    created_at: '2026-10-07T06:00:00.000Z', read_at: null,
    items: [{ item_id: ITEM, code: 'RM-CHK-BREAST', name_en: 'Chicken', name_ar: 'دجاج', base_unit_key: 'kg', on_hand: '91.5', minimum: '100' }],
  };
  assert.deepEqual(openTarget(n, WAREHOUSE, []), { kind: 'here', route: { screen: 'stock_decision', decisionId: SET } });
  assert.notEqual(asKey('notif_stock_low'), null);
  assert.match(read('apps/console/src/screens/Notifications.tsx'), /i\.minimum !== undefined/, 'the minimum is shown where it is carried');
});
