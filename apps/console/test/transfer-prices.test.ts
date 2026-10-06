import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Fetch, type ItemPrice } from '../src/api.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable } from '../src/navigation.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import {
  byPack, CURRENCY, formatMinor, formatRiyadh, MAX_MINOR, momentInput, priceablePacks, priceInput, priceStates,
  setPriceBody, withdrawable,
} from '../src/transfer-prices.ts';
import { toViewer, transferPricesWritable } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const PRICES_MIGRATION = read('supabase/migrations/20261004000400_transfer_prices.sql');
const EDGE = read('supabase/functions/_shared/fields.ts');

const ITEM = '01936f00-0000-7000-8000-000000004101';
const UNIT = '01936f00-0000-7000-8000-000000004203';
const PRICE = '01936f00-0000-7000-8000-000000005403';
const D = '01936f00-0000-7000-8000-0000000a0001';

function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'ok', decision_id: 'd', prices: [], decisions: [], next_after: null }), { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

// --- the client ----------------------------------------------------------------

test('CONTROL: no transfer-price call names an actor, and each goes to its route', async () => {
  const f = fake();
  const a = api(f);
  await a.setTransferPrice(setPriceBody({ decision_id: D, price_id: PRICE }, { itemUnitId: UNIT, priceMinor: 18550, effectiveFrom: null, reason: ' r ' }));
  await a.withdrawTransferPrice(PRICE, { decision_id: D, reason: 'r' });
  await a.listTransferPrices({ facilityId: 'f', search: 'chi', after: 'A', limit: 5 });
  await a.itemTransferPrices(null, ITEM);
  await a.transferPriceHistory('f', ITEM);
  for (const s of f.sent) {
    for (const k of keys(s.body)) assert.doesNotMatch(k, /^(actor|person|employee|user)(_id|_number)?$/i, `${s.url}: ${k}`);
  }
  assert.deepEqual(f.sent.map((s) => `${s.method} ${s.url.replace('https://edge.test/functions/v1', '')}`), [
    'POST /transfer-prices', `POST /transfer-prices/${PRICE}/withdraw`, 'GET /transfer-prices?facility_id=f&search=chi&after=A&limit=5',
    `GET /transfer-prices/items/${ITEM}`, `GET /transfer-prices/items/${ITEM}/history?facility_id=f`,
  ]);
  assert.deepEqual(f.sent[0]!.body, {
    decision_id: D, price_id: PRICE, item_unit_id: UNIT, price_minor: 18550, currency: 'SAR', effective_from: null, reason: 'r',
  }, 'the amount is a JSON integer of halalas, the currency stated, "now" sent as null');
  assert.equal(typeof (f.sent[0]!.body as { price_minor: unknown }).price_minor, 'number');
  assert.deepEqual(f.sent[1]!.body, { decision_id: D, reason: 'r' }, 'a withdrawal names its price in the path only');
});

// --- money ---------------------------------------------------------------------

test('CONTROL: a price typed in riyals becomes whole halalas by string arithmetic, never a float', () => {
  const cases: Array<[string, number]> = [
    ['185', 18500], ['185.5', 18550], ['185.50', 18550], ['0.05', 5], ['0', 0], ['١٨٥٫٥٠', 18550], [' 12.3 ', 1230],
    // 0.29 * 100 is 28.999999999999996 in floating point: the classic halala lost.
    ['0.29', 29], ['1.15', 115], ['4.35', 435], ['1000000000', MAX_MINOR],
  ];
  for (const [raw, minor] of cases) assert.deepEqual(priceInput(raw), { ok: true, value: minor }, raw);
  for (const raw of ['', '185.555', '1,850', '-5', '1e3', '18 5', 'abc', '.5', '5.', '12345678901']) {
    assert.equal(priceInput(raw).ok, false, raw);
  }
});

test('the cap and the currency the console uses are 0018\'s', () => {
  assert.match(PRICES_MIGRATION, /check \(price_minor between 0 and 100000000000\)/);
  assert.equal(MAX_MINOR, 100000000000);
  assert.match(PRICES_MIGRATION, /check \(currency = 'SAR'\)/);
  assert.equal(CURRENCY, 'SAR');
});

test('an amount is shown from the integer, in either language', () => {
  assert.equal(formatMinor('en', 18500), 'SAR 185.00');
  assert.equal(formatMinor('en', 5), 'SAR 0.05');
  assert.equal(formatMinor('en', 123456789012), 'SAR 1,234,567,890.12');
  assert.equal(formatMinor('ar', 18550), '185.50 ر.س');
  assert.equal(formatMinor('en', 0), 'SAR 0.00', 'zero is a price, shown as one');
});

// --- time ----------------------------------------------------------------------

test('CONTROL: a moment is sent with Riyadh\'s offset written out, never left to the browser\'s zone', () => {
  assert.deepEqual(momentInput('later', '2026-11-01', '00:00'), { ok: true, value: '2026-11-01T00:00:00+03:00' });
  assert.deepEqual(momentInput('later', '2026-11-01', '06:30'), { ok: true, value: '2026-11-01T06:30:00+03:00' });
  assert.deepEqual(momentInput('later', '٢٠٢٦-١١-٠١', '٠٦:٣٠'), { ok: true, value: '2026-11-01T06:30:00+03:00' });
  assert.deepEqual(momentInput('now', '', ''), { ok: true, value: null }, '"now" is chosen, and sent as null');
  assert.deepEqual(momentInput('now', '2026-11-01', '06:30'), { ok: true, value: null }, 'a date left in a hidden field is not sent');
  for (const [d, tm] of [['2026-02-30', '00:00'], ['2027-02-29', '00:00'], ['2026-11-01', '24:00'], ['2026-11-1', '00:00'], ['01/11/2026', '00:00']]) {
    assert.equal(momentInput('later', d!, tm!).ok, false, `${d} ${tm}`);
  }
  assert.equal(momentInput('later', '2028-02-29', '00:00').ok, true, 'a leap day exists');
  // What the console sends, the edge accepts: its own pattern, read from its source.
  const edgePattern = /const MOMENT = (\/.*\/);/.exec(EDGE)![1]!;
  const re = new RegExp(edgePattern.slice(1, -1));
  assert.match((momentInput('later', '2026-11-01', '06:30') as { value: string }).value, re);
});

test('CONTROL: a date or time half typed is refused, never read as "now" or as midnight', () => {
  // A date input reports '' for "05/11/20" with the year unfinished; read as now, a price
  // meant for November went into effect at once, for good (found in review).
  assert.equal(momentInput('later', '', '00:00').ok, false, 'no date, though "from a date" is chosen');
  assert.equal(momentInput('later', '', '00:00', true).ok, false, 'a date half typed');
  assert.equal(momentInput('later', '2026-11-05', '').ok, false, 'a time cleared is not midnight');
  assert.equal(momentInput('later', '2026-11-05', '', true).ok, false, 'a time half typed');
  assert.equal(momentInput('later', '2026-11-05', '00:00', true).ok, false, 'an input that says it is unfinished is believed, whatever value it last held');
  const page = readFileSync(new URL('../src/screens/ItemPrices.tsx', import.meta.url), 'utf8');
  assert.match(page, /validity\.badInput/, 'the form reads the inputs\' own word that they are unfinished');
  assert.match(page, /type="radio" name="when"/, 'now or later is an explicit choice');
});

test('a moment is shown on Riyadh\'s clock, whatever the browser\'s zone', () => {
  assert.match(formatRiyadh('en', '2099-05-31T21:00:00+00:00'), /1 Jun 2099, 00:00/);
});

// --- the page's rules ------------------------------------------------------------

const P = (over: Partial<ItemPrice>): ItemPrice => ({
  price_id: PRICE, item_unit_id: UNIT, unit_key: 'carton', factor: '10', price_minor: 19000, currency: 'SAR',
  effective_from: '2026-09-15T00:00:00+00:00', status: 'active', in_force: false, conversion_status: 'active',
  as_of_decision_id: D, ...over,
});

test('CONTROL: what a price is, and whether it may be withdrawn, is judged by the database\'s clock, never the browser\'s', () => {
  // The route marks the one in force at its now(); the rest are placed around it.
  const pack = [
    P({ price_id: 'w', status: 'withdrawn', effective_from: '2099-02-01T00:00:00Z' }),
    P({ price_id: 'a', effective_from: '2099-01-01T00:00:00Z' }),
    P({ price_id: 'n', effective_from: '2026-09-15T00:00:00Z', in_force: true }),
    P({ price_id: 'p', effective_from: '2026-09-01T00:00:00Z' }),
  ];
  const states = priceStates(pack);
  assert.deepEqual([...states.entries()], [['w', 'withdrawn'], ['a', 'ahead'], ['n', 'in_force'], ['p', 'past']]);
  // A price whose moment has just passed, on a page loaded before it: still "ahead" as of
  // that load, and the database refuses the withdrawal by its own clock. Its predecessor
  // stays "in force" until the next load, which every write brings.
  const justPassed = priceStates([P({ price_id: 'x', effective_from: new Date(Date.now() - 60_000).toISOString() }),
    P({ price_id: 'y', effective_from: '2026-09-01T00:00:00Z', in_force: true })]);
  assert.equal(justPassed.get('x'), 'ahead');
  assert.equal(priceStates([P({ price_id: 'z', effective_from: '2099-01-01T00:00:00Z' })]).get('z'), 'ahead', 'none in force: set ahead');
  assert.deepEqual(['ahead', 'in_force', 'past', 'withdrawn', undefined].map((s) => withdrawable(s as never)), [true, false, false, false, false]);
  for (const s of ['in_force', 'ahead', 'past', 'withdrawn']) assert.notEqual(asKey(`price_${s}`), null, s);
  const logic = readFileSync(new URL('../src/transfer-prices.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(logic.slice(logic.indexOf('export function priceStates')), /Date\.now\(\)/, 'no browser clock');
});

test('prices group by pack in the route\'s order, and only active packs are offered a price', () => {
  const grouped = byPack([P({ price_id: 'a' }), P({ price_id: 'b', item_unit_id: 'other' }), P({ price_id: 'c' })]);
  assert.deepEqual([...grouped.entries()].map(([k, v]) => [k, v.map((p) => p.price_id)]), [[UNIT, ['a', 'c']], ['other', ['b']]]);
  assert.deepEqual(priceablePacks([{ item_unit_id: 'x', status: 'active' }, { item_unit_id: 'y', status: 'retired' }]).map((u) => u.item_unit_id), ['x']);
});

// --- routes, menu, gate ----------------------------------------------------------

test('transfer-price routes parse and format both ways, and mark Transfer prices current', () => {
  const routes: Route[] = [{ screen: 'transfer_prices' }, { screen: 'item_prices', itemId: ITEM }];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'transfer_prices', r.screen);
  }
  assert.deepEqual(parseRoute(`#transfer_prices/${ITEM.toUpperCase()}`), { screen: 'item_prices', itemId: ITEM });
  assert.deepEqual(parseRoute('#transfer_prices/RM-CHICKEN'), { screen: 'unknown', id: 'transfer_prices/RM-CHICKEN' });
  assert.deepEqual(parseRoute(`#transfer_prices/${ITEM}/edit`), { screen: 'unknown', id: `transfer_prices/${ITEM}/edit` });
});

test('the Transfer prices entry is behind 0018\'s capability, and every 0018 decision kind has a label', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'transfer_prices')!;
  assert.equal(entry.capability, 'inventory.transfer_prices');
  assert.match(PRICES_MIGRATION, /\('inventory\.transfer_prices', 'Transfer prices'/, 'the key 0018 registers');
  const kinds = /check \(kind in \(([^)]+)\)\)/.exec(PRICES_MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual(kinds, ['price_set', 'price_withdrawn']);
  for (const kind of kinds) assert.notEqual(asKey(`kind_${kind}`), null, kind);
});

const viewerWith = (permissions: string[]) => toViewer({
  person: { person_id: 'p', employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
  facility_id: null, org_wide: true, facilities: [], brands: [], units: [], permissions,
  states: { 'inventory.transfer_prices': 'pilot', 'inventory.items': 'pilot' },
});

test('CONTROL: price changes are offered only organisation-wide, where 0018 checks them', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'transfer_prices')!;
  const v = viewerWith(['inventory.transfer_prices:read', 'inventory.transfer_prices:write', 'inventory.items:read']);
  assert.equal(transferPricesWritable(v, null, (x) => itemIsWritable(entry, x)), true);
  assert.equal(transferPricesWritable(v, 'a-branch', (x) => itemIsWritable(entry, x)), false);
  const reader = viewerWith(['inventory.transfer_prices:read', 'inventory.items:read']);
  assert.equal(transferPricesWritable(reader, null, (x) => itemIsWritable(entry, x)), false, 'read alone sets nothing');
  // Both write routes ask for write with no facility; if one ever takes a facility, this
  // rule and its screens need revisiting.
  const writes = [...PRICES_MIGRATION.matchAll(/assert_permitted\(p_actor_id, 'inventory\.transfer_prices', 'write', ([^)]+)\)/g)];
  assert.equal(writes.length, 2);
  for (const w of writes) assert.equal(w[1], 'null');
});

test('CONTROL: prices are shown, in the menu and on screen, only where items may be read too, as every 0018 read asks', () => {
  const prices = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'transfer_prices')!;
  const both = viewerWith(['inventory.transfer_prices:read', 'inventory.items:read']);
  const pricesOnly = viewerWith(['inventory.transfer_prices:read']);
  assert.equal(itemIsVisible(prices, both), true);
  assert.equal(itemIsVisible(prices, pricesOnly), false, 'an entry that would lead to "forbidden" is not shown');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /seesTransferPrices: itemIsVisible\(TRANSFER_PRICES, viewer\)/, 'the screens use the same rule as the menu');
  const reads = [...PRICES_MIGRATION.matchAll(/assert_permitted\(p_actor_id, '([\w.]+)', 'read', p_facility_id\)/g)].map((m) => m[1]);
  assert.deepEqual(reads, Array(3).fill(['inventory.transfer_prices', 'inventory.items']).flat());
});

test('every constraint the console words for prices is one 0018 raises or declares', () => {
  const source = readFileSync(new URL('../src/messages.ts', import.meta.url), 'utf8');
  const mapped = [...source.matchAll(/^\s+(transfer_price_\w+): '/gm)].map((m) => m[1]!);
  assert.ok(mapped.length >= 10);
  for (const c of mapped) assert.match(PRICES_MIGRATION, new RegExp(`\\b${c}\\b`), c);
  // Every rule a set or withdrawal can raise in its own words has a sentence.
  for (const c of ['transfer_price_not_backdated', 'transfer_price_one_per_moment', 'transfer_price_unchanged',
    'transfer_price_same_as_next', 'transfer_price_in_effect', 'transfer_price_withdrawal_repeats']) {
    assert.ok(mapped.includes(c), c);
  }
  assert.doesNotMatch(source, /^\s+transfer_price_decision_pkey:/m, 'a native collision never reads "already saved"');
  const f = { ok: false as const, http: 422, status: 'refused', message: 'transfer price … is in effect', constraint: 'transfer_price_in_effect', detail: null, field: null };
  assert.match(failureMessage('en', f).text, /in effect/);
  assert.match(failureMessage('en', { ...f, constraint: 'transfer_price_conversion_is_active' }).text, /priced/, 'not the supplier wording');
});

// --- the screens' write discipline (.tsx, read as source) ---------------------------

const screen = (name: string) => readFileSync(new URL(`../src/screens/${name}`, import.meta.url), 'utf8');

test('CONTROL: Retry on the prices page resends the request first sent; ids are minted once per form', () => {
  const page = screen('ItemPrices.tsx');
  assert.doesNotMatch(page, /onRetry=\{\(\) => submit/, 'no Retry rebuilds the body');
  assert.equal([...page.matchAll(/onRetry=\{w\.retry\}/g)].length, 2, 'both write forms retry the pending request');
  assert.match(page, /import \{ useWrite \} from '\.\/useWrite\.tsx';/, 'the shared write lifecycle (test/write.test.ts)');
  assert.match(page, /useState\(\(\) => formIds\(PRICE_IDS\)\)/, 'a price form mints its ids when it opens');
  assert.doesNotMatch(page, /formIds\([^)]*\)[^;]*\n[^\n]*api\.setTransferPrice/, 'never minted at send time');
});
