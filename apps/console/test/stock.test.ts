import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createApi, type Fetch, type ViewerFacility } from '../src/api.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable } from '../src/navigation.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import { leaveGuard } from '../src/leave.ts';
import {
  adjustmentBody, ADJUSTMENT_KINDS, countBody, findBalance, formatQuantity, holdsOverride, isNegative, isZero, MAX_BALANCE_PAGES,
  MAX_LINES, quantityInput, reversalBody, reversible, STOCK_KINDS, stockLines, stockMoment, stockWritable, workingFacility,
  writableHere, type DraftLine,
} from '../src/stock.ts';
import type { Answer, StockBalance, StockList } from '../src/api.ts';
import { toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const STOCK_MIGRATION = read('supabase/migrations/20261005000200_stock.sql');
const EDGE_STOCK = read('supabase/functions/_shared/stock.ts');
const EDGE_FIELDS = read('supabase/functions/_shared/fields.ts');

const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const BRANCH = '01936f00-0000-7000-8000-000000000401';
const ITEM = '01936f00-0000-7000-8000-000000004101';
const KG = '01936f00-0000-7000-8000-000000004201';
const CARTON = '01936f00-0000-7000-8000-000000004203';
const TARGET = '01936f00-0000-7000-8000-000000005705';
const D = '01936f00-0000-7000-8000-0000000b0001';

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({
      status: 'ok', decision_id: 'd', balances: [], decisions: [], decision: {}, next_after: null, next_before: null,
    }), { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
const line = (itemUnitId: string, quantity: string, direction: DraftLine['direction'] = ''): DraftLine => ({ itemUnitId, quantity, direction });

// --- the client ----------------------------------------------------------------

test('CONTROL: no stock call names an actor; every write names its facility; a reversal names its target in the path only', async () => {
  const f = fake();
  const a = api(f);
  const lines = [{ item_unit_id: KG, quantity: '2.5' }];
  await a.recordStockAdjustment(adjustmentBody({ decision_id: D }, {
    facilityId: WAREHOUSE, kind: 'waste', occurredAt: null, lines, reason: ' Spoiled. ', overrideReason: '  ',
  }));
  await a.recordStockCount(countBody({ decision_id: D }, { facilityId: WAREHOUSE, countedAt: '2026-10-01T09:00:00+03:00', lines, reason: 'Weekly.' }));
  await a.reverseStockDecision(TARGET, reversalBody({ decision_id: D }, { facilityId: WAREHOUSE, reason: 'Twice.', overrideReason: 'Recount due.' }));
  await a.stockOnHand({ facilityId: WAREHOUSE, search: 'chk', after: 'A', limit: 5, negativeOnly: true });
  await a.stockOnHand({ facilityId: WAREHOUSE });
  await a.stockCard(WAREHOUSE, ITEM, '42');
  await a.getStockDecision(WAREHOUSE, TARGET);
  for (const s of f.sent) {
    for (const k of keys(s.body)) assert.doesNotMatch(k, /^(actor|person|employee|user)(_id|_number)?$/i, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    'POST /stock/adjustments', 'POST /stock/counts', `POST /stock/decisions/${TARGET}/reverse`,
    `GET /stock?facility_id=${WAREHOUSE}&search=chk&after=A&limit=5&negative=true`, `GET /stock?facility_id=${WAREHOUSE}`,
    `GET /stock/items/${ITEM}?facility_id=${WAREHOUSE}&before=42`, `GET /stock/decisions/${TARGET}?facility_id=${WAREHOUSE}`,
  ]);
  assert.deepEqual(f.sent[0]!.body, {
    decision_id: D, facility_id: WAREHOUSE, kind: 'waste', occurred_at: null, lines, reason: 'Spoiled.', override_reason: null,
  }, 'the facility worked at, "now" as null, a blank override as none');
  assert.deepEqual(f.sent[1]!.body, {
    decision_id: D, facility_id: WAREHOUSE, counted_at: '2026-10-01T09:00:00+03:00', lines, reason: 'Weekly.',
  });
  assert.deepEqual(f.sent[2]!.body, { decision_id: D, facility_id: WAREHOUSE, reason: 'Twice.', override_reason: 'Recount due.' },
    'the decision reversed is in the path, never the body');
});

// --- quantities -------------------------------------------------------------------

test('CONTROL: a quantity is the decimal text typed, never a float', () => {
  const ok: Array<[string, string]> = [
    ['12', '12'], ['2.5', '2.5'], ['0.29', '0.29'], [' 7 ', '7'], ['١٢٫٥', '12.5'], ['۳', '3'],
    ['999999999999.999999', '999999999999.999999'], ['0.000001', '0.000001'], ['007', '007'],
  ];
  for (const [raw, value] of ok) assert.deepEqual(quantityInput(raw, false), { ok: true, value }, raw);
  for (const raw of ['', '-1', '+1', '1e3', '1,250', '2.', '.5', '1.1234567', '1234567890123', 'abc', '1 2', '0', '0.000']) {
    assert.equal(quantityInput(raw, false).ok, false, raw);
  }
  assert.deepEqual(quantityInput('0', true), { ok: true, value: '0' }, 'a count may find none');
  assert.deepEqual(quantityInput('0.0', true), { ok: true, value: '0.0' });
  // Nothing on the way to the edge parses a quantity: not the logic, not a screen.
  const sources = [read('apps/console/src/stock.ts'),
    ...readdirSync(new URL('../src/screens/', import.meta.url)).filter((f) => f.startsWith('Stock'))
      .map((f) => readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8'))];
  for (const src of sources) assert.doesNotMatch(src, /parseFloat|Number\(|toFixed|\+\s*quantity|Math\./, 'no arithmetic on a quantity');
});

test('the quantity rule is 0020\'s, and everything the console accepts the edge accepts', () => {
  assert.match(STOCK_MIGRATION, /v_qty_text !~ '\^\[0-9\]\{1,12\}\(\\\.\[0-9\]\{1,6\}\)\?\$'/, '0020: twelve digits and six places');
  const edge = new RegExp(/const QUANTITY = \/(.*)\/;/.exec(EDGE_STOCK)![1]!);
  for (const raw of ['12', '2.5', '١٢٫٥', '999999999999.999999', '0']) {
    const q = quantityInput(raw, true);
    assert.ok(q.ok && edge.test(q.value), raw);
  }
});

test('a quantity is shown from its text: trailing zeros dropped, the sign kept', () => {
  assert.equal(formatQuantity('12.500'), '12.5');
  assert.equal(formatQuantity('120.000000'), '120');
  assert.equal(formatQuantity('-10'), '-10');
  assert.equal(formatQuantity('100'), '100', 'an integer keeps its zeros');
  assert.equal(formatQuantity(null), '');
  assert.equal(isNegative('-10'), true);
  assert.equal(isNegative('-0.5'), true);
  assert.equal(isNegative('-0'), false, 'minus nothing is nothing');
  assert.equal(isNegative('10'), false);
  assert.equal(isZero('0.000'), true);
  assert.equal(isZero('0.001'), false);
});

// --- lines ------------------------------------------------------------------------

test('lines: one per pack, each with a quantity; a direction on an adjustment only; a problem names its line', () => {
  assert.deepEqual(stockLines('waste', [line(KG, '2.5', 'in')]), { ok: true, value: [{ item_unit_id: KG, quantity: '2.5' }] },
    'a write-off sends no direction: it goes out');
  assert.deepEqual(stockLines('adjustment', [line(KG, '1', 'in'), line(CARTON, '2', 'out')]),
    { ok: true, value: [{ item_unit_id: KG, quantity: '1', direction: 'in' }, { item_unit_id: CARTON, quantity: '2', direction: 'out' }] });
  assert.deepEqual(stockLines('count', [line(KG, '0'), line(CARTON, '١٢')]),
    { ok: true, value: [{ item_unit_id: KG, quantity: '0' }, { item_unit_id: CARTON, quantity: '12' }] }, 'a count may find none');
  assert.deepEqual(stockLines('waste', []), { ok: false, problem: { kind: 'no_lines' } });
  assert.deepEqual(stockLines('count', Array.from({ length: MAX_LINES + 1 }, () => line(KG, '1'))), { ok: false, problem: { kind: 'too_many' } });
  assert.deepEqual(stockLines('waste', [line(KG, '1'), line('', '1')]), { ok: false, problem: { kind: 'pack', line: 2 } });
  assert.deepEqual(stockLines('waste', [line(KG, '1'), line(CARTON, '0')]), { ok: false, problem: { kind: 'quantity', line: 2 } },
    'a write-off of nothing');
  assert.deepEqual(stockLines('adjustment', [line(KG, '1', '')]), { ok: false, problem: { kind: 'direction', line: 1 } });
  assert.deepEqual(stockLines('count', [line(KG, '1'), line(CARTON, '1'), line(KG, '3')]),
    { ok: false, problem: { kind: 'repeat', line: 3, first: 1 } }, '0020 refuses a repeated pack (stock_line_repeats)');
  assert.match(STOCK_MIGRATION, /jsonb_array_length\(p_lines\) > 500/);
  assert.equal(MAX_LINES, 500);
});

test('CONTROL: a moment stated late carries Riyadh\'s offset and matches the edge\'s own pattern; a blank one is refused, never "now"', () => {
  const edge = new RegExp(/const MOMENT = \/(.*)\/;/.exec(EDGE_FIELDS)![1]!);
  const stated = stockMoment('stated', '2026-10-01', '09:00');
  assert.deepEqual(stated, { ok: true, value: '2026-10-01T09:00:00+03:00' });
  assert.ok(stated.ok && stated.value !== null && edge.test(stated.value));
  assert.deepEqual(stockMoment('now', '', ''), { ok: true, value: null });
  for (const [date, time, bad] of [['', '09:00', false], ['2026-10-01', '', false], ['2026-02-30', '09:00', false], ['2026-10-01', '09:00', true]] as const) {
    assert.equal(stockMoment('stated', date, time, bad).ok, false, `${date} ${time} ${bad}`);
  }
});

// --- where, and who --------------------------------------------------------------

const facility = (id: string, facility_type: string): ViewerFacility =>
  ({ facility_id: id, code: 'X', facility_type, name_en: 'X', name_ar: 'س', brand_id: 'b' });
const viewerWith = (permissions: string[], preview = false) => ({
  ...toViewer({
    person: { person_id: 'p', employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: WAREHOUSE, org_wide: false, facilities: [], brands: [], units: [], permissions,
    states: { 'inventory.stock': 'pilot', 'inventory.items': 'pilot' },
  }),
  preview,
});
const STOCK = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'current_stock')!;
const writes = (v: ReturnType<typeof viewerWith>) => itemIsWritable(STOCK, v);

test('CONTROL: stock changes are offered only AT a warehouse or a factory, the masters\' inverse, where 0020 checks them', () => {
  const writer = viewerWith(['inventory.stock:read', 'inventory.stock:write', 'inventory.items:read']);
  const facilities = [facility(WAREHOUSE, 'warehouse'), facility('fa', 'factory'), facility(BRANCH, 'branch'), facility('of', 'office')];
  assert.equal(stockWritable(workingFacility(facilities, WAREHOUSE), writer, writes), true);
  assert.equal(stockWritable(workingFacility(facilities, 'fa'), writer, writes), true);
  assert.equal(stockWritable(workingFacility(facilities, null), writer, writes), false, 'organisation-wide there is no one facility');
  assert.equal(stockWritable(workingFacility(facilities, BRANCH), writer, writes), false, 'a branch holds no stock yet (Q-06)');
  assert.equal(stockWritable(workingFacility(facilities, 'of'), writer, writes), false, 'an office holds none');
  assert.equal(stockWritable(workingFacility(facilities, 'elsewhere'), writer, writes), false, 'a facility not in the session');
  const reader = viewerWith(['inventory.stock:read', 'inventory.items:read']);
  assert.equal(stockWritable(workingFacility(facilities, WAREHOUSE), reader, writes), false, 'read alone records nothing');
  assert.equal(stockWritable(workingFacility(facilities, WAREHOUSE), { ...writer, preview: true }, writes), false, 'a preview records nothing');
  // Every write route asks write AT the facility; if one ever asks with none, this rule and its screens need revisiting.
  const gates = [...STOCK_MIGRATION.matchAll(/assert_permitted\(p_actor_id, 'inventory\.stock', 'write', ([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(gates, ['p_facility_id', 'p_facility_id', 'p_facility_id']);
  // And only a warehouse or a factory holds stock: the types STOCK_FACILITY_TYPES names.
  assert.match(STOCK_MIGRATION, /if f\.facility_type = 'branch' then\s+raise exception[^;]+constraint = 'stock_branch_business_day_undecided'/);
  assert.match(STOCK_MIGRATION, /elsif f\.facility_type not in \('warehouse', 'factory'\) then\s+raise exception[^;]+constraint = 'stock_facility_holds_no_stock'/);
});

test('the override (D1) is offered only to those who hold approve here, and never in a preview', () => {
  assert.equal(holdsOverride(viewerWith(['inventory.stock:approve'])), true);
  assert.equal(holdsOverride(viewerWith(['inventory.stock:write'])), false);
  assert.equal(holdsOverride(viewerWith(['inventory.stock:approve'], true)), false);
  assert.match(STOCK_MIGRATION, /assert_permitted\(p_actor_id, 'inventory\.stock', 'approve', f\.facility_id\)/, '0020 asks approve at the facility');
});

test('CONTROL: stock is shown, in the menu and on screen, only where items may be read too, as every 0020 read asks', () => {
  assert.deepEqual(STOCK.alsoReads, ['inventory.items']);
  assert.equal(STOCK.capability, 'inventory.stock');
  assert.match(STOCK_MIGRATION, /\('inventory\.stock', 'Stock and movements'/, 'the key 0020 registers');
  assert.equal(itemIsVisible(STOCK, viewerWith(['inventory.stock:read', 'inventory.items:read'])), true);
  assert.equal(itemIsVisible(STOCK, viewerWith(['inventory.stock:read'])), false, 'an entry that would lead to "forbidden" is not shown');
  const app = read('apps/console/src/App.tsx');
  assert.match(app, /seesStock: itemIsVisible\(STOCK, viewer\)/, 'the screens use the same rule as the menu');
  assert.match(app, /stockWritable: stockWritable\(workingFacility\(data\.facilities, facilityId\), viewer, \(v\) => itemIsWritable\(STOCK, v\)\)/);
  const reads = [...STOCK_MIGRATION.matchAll(/assert_permitted\(p_actor_id, '([\w.]+)', 'read', p_facility_id\)/g)].map((m) => m[1]);
  assert.deepEqual(reads, Array(3).fill(['inventory.stock', 'inventory.items']).flat());
});

// --- 0020's words ------------------------------------------------------------------

test('the kinds are 0020\'s, a write-off form offers only what its route records, and every kind has a label', () => {
  const known = /constraint stock_decision_kind_is_known check \(kind in \(([^)]+)\)\)/.exec(STOCK_MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual([...STOCK_KINDS].sort(), known.sort());
  const route = /p_kind not in \(([^)]+)\) then\s+raise exception 'this records an adjustment/.exec(STOCK_MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual([...ADJUSTMENT_KINDS].sort(), route.sort());
  for (const kind of known) assert.notEqual(asKey(`stock_kind_${kind}`), null, kind);
});

test('every constraint the console words for stock is one 0020 raises, and the commonest refusals are worded', () => {
  const messages = read('apps/console/src/messages.ts');
  const worded = [...messages.matchAll(/^\s+(stock_\w+): '/gm)].map((m) => m[1]!);
  assert.ok(worded.length >= 15);
  for (const c of worded) assert.match(STOCK_MIGRATION, new RegExp(`constraint = '${c}'`), c);
  assert.doesNotMatch(messages, /stock_decision_pkey:/, 'a native collision is no "already saved"');
  for (const c of ['stock_would_go_negative', 'stock_backdated_before_count', 'stock_reversal_counted_since', 'stock_already_reversed']) {
    const m = failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: c, detail: null, field: null });
    assert.notEqual(m.text, failureMessage('en', { ok: false, http: 422, status: 'refused', message: 'm', constraint: null, detail: null, field: null }).text, c);
  }
});

test('a movement is offered for reversal once; a count and a reversal never', () => {
  for (const kind of ADJUSTMENT_KINDS) assert.equal(reversible({ kind, reversed_by_decision_id: null }), true, kind);
  assert.equal(reversible({ kind: 'waste', reversed_by_decision_id: TARGET }), false, 'already reversed');
  assert.equal(reversible({ kind: 'count', reversed_by_decision_id: null }), false);
  assert.equal(reversible({ kind: 'reversal', reversed_by_decision_id: null }), false);
});

// --- routes ------------------------------------------------------------------------

test('stock routes parse and format both ways, name no facility, and mark Stock current', () => {
  const routes: Route[] = [
    { screen: 'current_stock' }, { screen: 'stock_adjust' }, { screen: 'stock_count' },
    { screen: 'stock_item', itemId: ITEM }, { screen: 'stock_decision', decisionId: TARGET },
  ];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'current_stock');
  }
  assert.deepEqual(parseRoute(`#current_stock/items/${ITEM.toUpperCase()}`), { screen: 'stock_item', itemId: ITEM });
  for (const bad of ['current_stock/items/RM-CHK', 'current_stock/items', `current_stock/${WAREHOUSE}`, `current_stock/items/${ITEM}/x`, 'current_stock/edit']) {
    assert.deepEqual(parseRoute(`#${bad}`), { screen: 'unknown', id: bad }, bad);
  }
});

test('CONTROL: the stock screens read and write at the facility worked at, never one a URL names', () => {
  for (const f of readdirSync(new URL('../src/screens/', import.meta.url)).filter((x) => x.startsWith('Stock'))) {
    const src = readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /ctx\.facilityId/, `${f}: the facility comes from stockPlace(), which checks it holds stock`);
    for (const m of src.matchAll(/api\.(stockOnHand|stockCard|getStockDecision)\(\{?\s*(facilityId)?/g)) {
      assert.ok(m[0].includes('facilityId') || /\(facilityId/.test(src.slice(m.index!, m.index! + 60)), `${f}: ${m[0]}`);
    }
  }
});

// --- found in review ----------------------------------------------------------------

const balance = (item_id: string, code: string): StockBalance => ({
  item_id, code, item_kind: 'raw_ingredient', base_unit_key: 'kg', name_en: 'n', name_ar: 'ن', item_status: 'active',
  on_hand: '1', last_counted_at: null, as_of_decision_id: D, units: [],
});

test('CONTROL: an item\'s balance is found however many name matches come first; past its code it has none; never a guess', async () => {
  const pages: StockList[] = [
    { balances: [balance('a', 'AA-001'), balance('b', 'AB-002')], next_after: 'AB-002' },
    { balances: [balance('c', 'AC-003'), balance(ITEM, 'RM-CHK-BREAST')], next_after: 'RM-CHK-BREAST' },
  ];
  const asked: Array<string | null> = [];
  const pager = (list: StockList[]) => async (after: string | null): Promise<Answer<StockList>> => {
    asked.push(after);
    return { ok: true, value: list[asked.length - 1] ?? { balances: [], next_after: null } };
  };
  assert.deepEqual(await findBalance(pager(pages), ITEM, 'RM-CHK-BREAST'), { ok: true, value: pages[1]!.balances[1] },
    'found on the second page, behind name matches that sort first');
  assert.deepEqual(asked, [null, 'AB-002']);
  asked.length = 0;
  const past = [{ balances: [balance('a', 'AA-001'), balance('z', 'ZZ-999')], next_after: 'ZZ-999' }];
  assert.deepEqual(await findBalance(pager(past), ITEM, 'RM-CHK-BREAST'), { ok: true, value: null }, 'a code past its own: it has none');
  assert.equal(asked.length, 1, 'and no further page is read');
  const failed = await findBalance(async () => ({ ok: false, http: 403, status: 'forbidden', message: null, constraint: null, detail: null, field: null }), ITEM, 'X');
  assert.equal(failed.ok, false, 'a refusal is passed on');
  let n = 0;
  const endless = await findBalance(async () => ({ ok: true, value: { balances: [balance(`x${n}`, `AA-${n++}`)], next_after: 'AA' } }), ITEM, 'ZZ');
  assert.equal(endless.ok, false, `past ${MAX_BALANCE_PAGES} pages is a failure, never "nothing recorded"`);
  assert.equal(n, MAX_BALANCE_PAGES);
  assert.match(read('apps/console/src/screens/StockItem.tsx'), /findBalance\(\(after\) => api\.stockOnHand\(/);
});

test('CONTROL: a closed facility is offered no stock change; the screens that offer one read its status', () => {
  assert.equal(writableHere(true, 'open'), true);
  assert.equal(writableHere(true, null), true, 'unknown: the database still refuses, in words the console has');
  assert.equal(writableHere(true, 'closed'), false);
  assert.equal(writableHere(false, 'open'), false);
  for (const f of ['StockList.tsx', 'StockEntry.tsx', 'StockDecision.tsx']) {
    const src = readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8');
    assert.match(src, /useFacilityStatus\(ctx, /, f);
    assert.match(src, /writableHere\(ctx\.stockWritable, status\)/, f);
  }
  assert.match(read('apps/console/src/messages.ts'), /facility_admits_no_new_work: 'rule_facility_no_new_work'/);
});

test('CONTROL: leaving with lines typed asks first, by every way out; a save\'s own way out asks nothing', () => {
  let asked = 0;
  let answer = false;
  const g = leaveGuard(() => { asked++; return answer; });
  assert.equal(g.allows(), true, 'nothing registered: nothing to lose');
  let lines = 0;
  g.set(() => lines > 0);
  assert.equal(g.allows(), true, 'no lines yet');
  assert.equal(asked, 0);
  lines = 3;
  assert.equal(g.clean(), false);
  assert.equal(g.allows(), false, 'lines typed, and the person stays');
  answer = true;
  assert.equal(g.allows(), true, 'lines typed, and the person leaves');
  assert.equal(asked, 2);
  g.bypassOnce();
  assert.equal(g.allows(), true, 'a save leaving');
  assert.equal(asked, 2, 'asks nothing');
  answer = false;
  assert.equal(g.allows(), false, 'the pass is used once');
  g.set(null);
  assert.equal(g.allows(), true, 'the form gone: nothing to lose');

  const app = read('apps/console/src/App.tsx');
  assert.match(app, /if \(!guard\.allows\(\)\) \{\s+reverting\.current = true;/, 'a hash change asks, and puts the hash back');
  assert.match(app, /onChange=\{\(e\) => \{\s+if \(!guard\.allows\(\)\) return;/, 'the facility picker asks');
  assert.match(app, /function signOut\(\) \{\s+if \(!guard\.allows\(\)\) return;/, 'signing out asks');
  assert.match(app, /if \(guard\.clean\(\)\) return;\s+e\.preventDefault\(\);\s+e\.returnValue = '';/, 'closing the tab asks');
  assert.match(app, /guard\.bypassOnce\(\);\s+window\.location\.hash = formatRoute\(r\);/, 'a save\'s navigate passes');
  const entry = readFileSync(new URL('../src/screens/StockEntry.tsx', import.meta.url), 'utf8');
  assert.equal([...entry.matchAll(/setLeaveGuard\(\(\) => lines\.length > 0\);\s+return \(\) => setLeaveGuard\(null\);/g)].length, 2, 'both stock forms register');
  assert.equal([...entry.matchAll(/sent\.current = body;\s+if \(out\.current\) return;\s+out\.current = true;/g)].length, 2, 'one request at a time');
});
