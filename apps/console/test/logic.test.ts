import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Item, ViewerData, ViewerUnit } from '../src/api.ts';
import { factorInput, formatFactor, latinDigits } from '../src/format.ts';
import { formIds, uuidv7 } from '../src/ids.ts';
import { asKey, dir, STRINGS, t } from '../src/i18n.ts';
import { addableUnits, descriptionsPaired, factorIsDerived, isUnanswered, ITEM_KINDS, writeOutcome } from '../src/items.ts';
import { failureMessage, signInMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsWritable } from '../src/navigation.ts';
import { formatRoute, parseRoute, type Route } from '../src/route.ts';
import { storedLang, tokenStore, type StorageLike } from '../src/session.ts';
import { brandsFor, defaultFacility, itemsWritable, toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const ITEMS_MIGRATION = read('supabase/migrations/20261002000200_items_and_units.sql');

// --- ids (ADR-0005) ----------------------------------------------------------

test('uuidv7: the time leads, then version 7 and the RFC 9562 variant', () => {
  const zeros = (b: Uint8Array) => b.fill(0);
  const ones = (b: Uint8Array) => b.fill(0xff);
  assert.equal(uuidv7(0x0193_6f00_0000, zeros), '01936f00-0000-7000-8000-000000000000');
  assert.equal(uuidv7(0x0193_6f00_0000, ones), '01936f00-0000-7fff-bfff-ffffffffffff');
  assert.match(uuidv7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Time-ordered: a later millisecond sorts later, whatever the random bits.
  assert.ok(uuidv7(1_000_001, zeros) > uuidv7(1_000_000, ones));
  assert.throws(() => uuidv7(-1), RangeError);
});

test('a form mints each id once, and every id differs', () => {
  const ids = formIds(['decision_id', 'item_id', 'base_unit_decision_id', 'base_item_unit_id'] as const);
  assert.equal(new Set(Object.values(ids)).size, 4);
  let n = 0;
  const counted = formIds(['a', 'b'] as const, () => `id-${n++}`);
  assert.deepEqual(counted, { a: 'id-0', b: 'id-1' });
});

// --- i18n (PRG-014) ----------------------------------------------------------

test('every string exists in both languages, non-empty, with the same placeholders', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(STRINGS.en) as (keyof typeof STRINGS.en)[]) {
    assert.ok(STRINGS.en[key].trim().length > 0, `en ${key}`);
    assert.ok(STRINGS.ar[key].trim().length > 0, `ar ${key}`);
    assert.deepEqual(placeholders(STRINGS.ar[key]), placeholders(STRINGS.en[key]), key);
  }
  assert.deepEqual(Object.keys(STRINGS.ar).sort(), Object.keys(STRINGS.en).sort());
});

test('the Arabic names the organisation with the facility picker\'s word', () => {
  // A sentence telling someone to work organisation-wide sends them to the picker, which
  // offers «المؤسسة كاملة», as INV-P07's Arabic does. Module 9's said «المنظمة», a word the
  // picker never shows (found writing its staff testing pack). The root, so «للمنظمة» and a
  // bare «منظمة» are caught too (found in its review).
  assert.match(STRINGS.ar.org_wide, /المؤسسة/);
  for (const key of Object.keys(STRINGS.ar) as (keyof typeof STRINGS.ar)[]) {
    assert.doesNotMatch(STRINGS.ar[key], /منظمة/, key);
  }
});

test('every menu label and every item kind has a translation', () => {
  for (const group of NAVIGATION) {
    assert.notEqual(asKey(group.labelKey), null, group.labelKey);
    for (const item of group.items) assert.notEqual(asKey(item.labelKey), null, item.labelKey);
  }
  for (const kind of ITEM_KINDS) assert.notEqual(asKey(`kind_${kind}`), null, kind);
  for (const kind of ['item_created', 'item_amended', 'item_status_changed', 'unit_added', 'unit_retired']) {
    assert.notEqual(asKey(`kind_${kind}`), null, kind);
    assert.match(ITEMS_MIGRATION, new RegExp(`'${kind}'`), `${kind} is a decision kind 0012 records`);
  }
});

test('placeholders are filled, an unknown one stays visible, and Arabic is right to left', () => {
  assert.equal(t('en', 'import_done', { created: 2, amended: 1, unchanged: 0 }), 'Done: 2 created, 1 updated, 0 unchanged.');
  assert.equal(t('en', 'signin_attempts_left'), 'Attempts left before the account locks: {n}.');
  assert.equal(dir('ar'), 'rtl');
  assert.equal(dir('en'), 'ltr');
});

// --- items logic (INV-002, INV-005) ------------------------------------------

test('the item kinds are 0012\'s, in its order', () => {
  const check = /constraint item_kind_is_known check \(item_kind in \(([^)]*)\)\)/.exec(ITEMS_MIGRATION);
  assert.ok(check, 'item_kind_is_known found in 0012');
  const kinds = [...check[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(kinds, [...ITEM_KINDS]);
});

const UNITS: ViewerUnit[] = [
  { unit_key: 'piece', dimension: 'count', name_en: 'Piece', name_ar: 'حبة', symbol_en: 'pc', symbol_ar: 'حبة' },
  { unit_key: 'g', dimension: 'mass', name_en: 'Gram', name_ar: 'غرام', symbol_en: 'g', symbol_ar: 'غ' },
  { unit_key: 'kg', dimension: 'mass', name_en: 'Kilogram', name_ar: 'كيلوغرام', symbol_en: 'kg', symbol_ar: 'كغ' },
  { unit_key: 'bag', dimension: 'pack', name_en: 'Bag', name_ar: 'كيس', symbol_en: 'bag', symbol_ar: 'كيس' },
];
const unit = (unit_key: string, status: 'active' | 'retired' = 'active') =>
  ({ item_unit_id: `u-${unit_key}`, unit_key, factor: '1', status, as_of_decision_id: 'd' });
const FLOUR: Item = {
  item_id: 'i', brand_id: 'b', code: 'RM-FLOUR', item_kind: 'raw_ingredient', base_unit_key: 'g',
  name_en: 'Flour', name_ar: 'دقيق', description_en: null, description_ar: null, picture_path: null,
  status: 'active', as_of_decision_id: 'd', units: [unit('g'), unit('bag', 'retired')],
};

test('add unit offers every unit without an active conversion, never the base', () => {
  assert.deepEqual(addableUnits(FLOUR, UNITS).map((u) => u.unit_key), ['piece', 'kg', 'bag'],
    'a retired bag can be added again: a pack-size change is retire plus add');
  assert.deepEqual(addableUnits({ ...FLOUR, units: [unit('g'), unit('kg')] }, UNITS).map((u) => u.unit_key), ['piece', 'bag']);
});

test('a factor is derived where 0012 derives it, and asked everywhere else', () => {
  assert.equal(factorIsDerived(FLOUR, UNITS, 'kg'), true, 'same dimension as the base');
  assert.equal(factorIsDerived(FLOUR, UNITS, 'bag'), false, 'a pack is always stated');
  const box: ViewerUnit = { unit_key: 'box', dimension: 'pack', name_en: 'Box', name_ar: 'علبة', symbol_en: 'box', symbol_ar: 'علبة' };
  assert.equal(factorIsDerived({ ...FLOUR, units: [unit('g'), unit('bag')] }, [...UNITS, box], 'box'), false,
    'even beside an active pack: what a box holds is never what a bag holds');
  assert.equal(factorIsDerived(FLOUR, UNITS, 'piece'), false, 'no active count conversion yet');
  assert.equal(factorIsDerived({ ...FLOUR, units: [unit('g'), unit('piece')] }, UNITS, 'piece'), true);
  assert.equal(factorIsDerived(FLOUR, UNITS, 'tonne'), false, 'not in the register');
  assert.match(ITEMS_MIGRATION, /where u\.unit_key = p_unit_key and u\.dimension <> 'pack'/,
    'erp.item_unit_derived_factor() still refuses to derive a pack');
});

test('a write is saved, already recorded, stale or failed', () => {
  const f = (status: string) => ({ ok: false as const, http: 409, status, message: null, constraint: null, detail: null, field: null });
  assert.equal(writeOutcome({ ok: true, value: {} }), 'saved');
  assert.equal(writeOutcome(f('already_recorded')), 'already');
  assert.equal(writeOutcome(f('stale')), 'stale');
  assert.equal(writeOutcome(f('conflict')), 'failed');
  assert.equal(writeOutcome({ ...f('network'), http: 0 }), 'failed');
});

test('an import already recorded is shown as saved, not as an error', () => {
  // 0017: an items file sent again while its first sending still runs is answered
  // already_recorded. The screen is .tsx, which Node cannot load, so its source is read.
  const screen = readFileSync(new URL('../src/screens/ItemImport.tsx', import.meta.url), 'utf8');
  assert.match(screen, /if \(writeOutcome\(answer\) === 'already'\) \{\s+setAlready\(true\);\s+setRows\(null\);\s+return;/,
    'the upload screen treats already_recorded as the file saved, and clears the rows');
  assert.match(screen, /<Notice tone="ok" text=\{t\(lang, 'import_already'\)\} \/>/, 'and says so as good news');
});

test('an unanswered write is one with no answer to trust: none at all, or a server failure', () => {
  const f = (http: number, status: string) => ({ ok: false as const, http, status, message: null, constraint: null, detail: null, field: null });
  assert.equal(isUnanswered(f(0, 'network')), true);
  assert.equal(isUnanswered(f(502, 'error')), true);
  assert.equal(isUnanswered(f(409, 'conflict')), false, 'a refusal is an answer: nothing was recorded');
  assert.equal(isUnanswered(f(401, 'idle')), false);
  assert.equal(isUnanswered({ ok: true, value: {} }), false);
});

test('descriptions are both or neither, as item_description_is_bilingual says', () => {
  assert.equal(descriptionsPaired('', ''), true);
  assert.equal(descriptionsPaired('Bakery flour', 'دقيق للمخابز'), true);
  assert.equal(descriptionsPaired('Bakery flour', '  '), false);
  assert.equal(descriptionsPaired('', 'دقيق'), false);
  assert.match(ITEMS_MIGRATION, /constraint item_description_is_bilingual check \(\(description_en is null\) = \(description_ar is null\)\)/);
});

// --- format ------------------------------------------------------------------

test('a factor reads without trailing zeros, and stays text', () => {
  assert.equal(formatFactor('12.000000'), '12');
  assert.equal(formatFactor('0.250000'), '0.25');
  assert.equal(formatFactor(1000), '1000');
  assert.equal(formatFactor('1000'), '1000');
  assert.equal(formatFactor(null), '');
});

test('a typed factor is checked exactly as the edge checks it', () => {
  const edge = read('supabase/functions/_shared/items.ts');
  assert.match(edge, /const DECIMAL = \/\^\\d\{1,12\}\(\\\.\\d\{1,6\}\)\?\$\/;/, 'the edge\'s rule is unchanged');
  assert.deepEqual(factorInput(' 25000 '), { ok: true, value: '25000' });
  assert.deepEqual(factorInput('0.000001'), { ok: true, value: '0.000001' });
  assert.deepEqual(factorInput(''), { ok: true, value: null });
  for (const bad of ['1.0000001', '-1', '1e3', '1,5', '1.']) assert.deepEqual(factorInput(bad), { ok: false }, bad);
  assert.deepEqual(factorInput('٢٥٫٥'), { ok: true, value: '25.5' }, 'typed on an Arabic keyboard');
});

test('CONTROL: Arabic-Indic and Persian digits reach the database as the digits erp.verify_pin() reads', () => {
  // Found in review: a correct PIN typed on an Arabic keyboard counted as a miss.
  assert.equal(latinDigits('١٠٠٠٠١'), '100001');
  assert.equal(latinDigits('۱۲۳۴۵۶'), '123456');
  assert.equal(latinDigits('1001'), '1001');
  assert.equal(latinDigits('٫'), '.');
  const identity = read('supabase/migrations/20261002000100_identity.sql');
  assert.match(identity, /\^\[0-9\]\{6\}\$/, 'verify_pin still reads ASCII digits only');
  const signIn = readFileSync(new URL('../src/screens/SignIn.tsx', import.meta.url), 'utf8');
  assert.match(signIn, /api\.signIn\(latinDigits\(number\)\.trim\(\), latinDigits\(pin\)\)/, 'sign-in sends them converted');
});

// --- routes ------------------------------------------------------------------

test('routes parse and format both ways, and an id must be a UUID', () => {
  const id = '01936f00-0000-7000-8000-00000000a001';
  const routes: Route[] = [
    { screen: 'home' }, { screen: 'items' }, { screen: 'item_new' }, { screen: 'item_import' },
    { screen: 'item', itemId: id }, { screen: 'item_edit', itemId: id },
  ];
  for (const r of routes) assert.deepEqual(parseRoute(formatRoute(r)), r);
  assert.deepEqual(parseRoute(`#items/${id.toUpperCase()}`), { screen: 'item', itemId: id });
  assert.deepEqual(parseRoute('#items/ITM-001'), { screen: 'unknown', id: 'items/ITM-001' });
  assert.deepEqual(parseRoute('#production'), { screen: 'unknown', id: 'production' }, 'a menu entry whose module has no screens yet');
  assert.deepEqual(parseRoute(''), { screen: 'home' });
  assert.deepEqual(parseRoute('#items/%E0'), { screen: 'unknown', id: 'items/%E0' }, 'a malformed escape blanks nothing');
});

// --- viewer (CAP-P02, CAP-P04) -----------------------------------------------

const FAC_A = '01936f00-0000-7000-8000-000000000401';
const FAC_B = '01936f00-0000-7000-8000-000000000402';
const DATA: ViewerData = {
  person: { person_id: 'p', employee_number: '1001', full_name_en: 'C', full_name_ar: 'ك', primary_facility_id: FAC_B, status: 'active' },
  facility_id: null,
  org_wide: false,
  facilities: [
    { facility_id: FAC_A, code: 'BR-001', facility_type: 'branch', name_en: 'A', name_ar: 'أ', brand_id: 'spicy' },
    { facility_id: FAC_B, code: 'BR-002', facility_type: 'branch', name_en: 'B', name_ar: 'ب', brand_id: 'second' },
  ],
  permissions: ['inventory.items:read', 'inventory.items:write'],
  states: { 'inventory.items': 'pilot', 'inventory.stock': 'some_future_state' },
  brands: [{ brand_id: 'second', code: 'SECOND', name_en: 'S', name_ar: 'س' }, { brand_id: 'spicy', code: 'SPICY', name_en: 'P', name_ar: 'ب' }],
  units: [],
};

test('CONTROL: a state the console does not know is hidden, not passed on', () => {
  const v = toViewer(DATA);
  assert.equal(v.states.get('inventory.items'), 'pilot');
  assert.equal(v.states.get('inventory.stock'), 'hidden');
  assert.equal(v.preview, false);
});

test('a person starts at their primary facility; someone organisation-wide starts organisation-wide', () => {
  assert.equal(defaultFacility(DATA), FAC_B);
  assert.equal(defaultFacility({ ...DATA, person: { ...DATA.person, primary_facility_id: null } }), FAC_A);
  assert.equal(defaultFacility({ ...DATA, person: { ...DATA.person, primary_facility_id: 'elsewhere' } }), FAC_A,
    'a primary facility they cannot work at is not chosen');
  assert.equal(defaultFacility({ ...DATA, org_wide: true }), null);
  assert.equal(defaultFacility({ ...DATA, facilities: [] }), null);
});

test('CONTROL: item changes are offered only organisation-wide, where 0012 checks them', () => {
  const items = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'items')!;
  const v = toViewer(DATA);
  assert.equal(itemIsWritable(items, v), true, 'the viewer holds write, and pilot admits work');
  assert.equal(itemsWritable(v, FAC_A, (x) => itemIsWritable(items, x)), false, 'but not at a facility');
  assert.equal(itemsWritable(v, null, (x) => itemIsWritable(items, x)), true);
  // Every write route asks for write with no facility; if one ever takes a facility, this
  // rule and its screens need revisiting.
  const writes = [...ITEMS_MIGRATION.matchAll(/assert_permitted\(p_actor_id, 'inventory\.items', 'write', ([^)]+)\)/g)];
  assert.equal(writes.length, 6);
  for (const w of writes) assert.equal(w[1], 'null');
});

test('at a facility, only its brand is offered', () => {
  assert.deepEqual(brandsFor(DATA, FAC_A).map((b) => b.code), ['SPICY']);
  assert.deepEqual(brandsFor(DATA, null).map((b) => b.code), ['SECOND', 'SPICY']);
});

// --- messages ----------------------------------------------------------------

const failure = (http: number, status: string, extra: Record<string, string> = {}) =>
  ({ ok: false as const, http, status, message: null, constraint: null, detail: null, field: null, ...extra });

test('a refusal reads as a sentence, with the database\'s words and the rule under it', () => {
  const m = failureMessage('en', failure(409, 'conflict', { message: 'item code X is already used', constraint: 'item_code_key' }));
  assert.equal(m.text, 'That item code is already in use.');
  assert.equal(m.detail, 'item code X is already used\n[item_code_key]');
  const native = failureMessage('ar', failure(422, 'invalid', { message: 'a value breaks a rule of the record', constraint: 'item_description_is_bilingual' }));
  assert.equal(native.text, t('ar', 'rule_descriptions_paired'));
  assert.equal(failureMessage('en', failure(403, 'forbidden')).text, t('en', 'refusal_forbidden'));
  assert.equal(failureMessage('en', failure(400, 'malformed', { field: 'factor' })).text, 'A field is missing or not valid: “How many storage units”.');
  assert.equal(failureMessage('ar', failure(400, 'malformed', { field: 'factor' })).text, 'حقل ناقص أو غير صحيح: «كم وحدة تخزين».',
    'the field in the reader\'s language, not the wire name');
});

test('a lost connection, a server failure and an unknown word never show the server\'s text', () => {
  assert.deepEqual(failureMessage('en', failure(0, 'network')), { text: t('en', 'network_error'), detail: null });
  assert.deepEqual(failureMessage('en', failure(500, 'error', { message: 'stack trace' })), { text: t('en', 'unexpected_error'), detail: null });
  assert.deepEqual(failureMessage('en', failure(418, 'teapot', { message: 'x' })), { text: t('en', 'unexpected_error'), detail: null });
  assert.equal(failureMessage('en', failure(401, 'invalid')).text, t('en', 'session_ended'), 'a 401 invalid is a session, not a field');
  assert.equal(failureMessage('en', failure(401, 'idle')).text, t('en', 'session_idle'));
});

test('sign-in: a wrong PIN and an unknown number read the same (IAM-P02)', () => {
  const at = (iso: string) => `at ${iso}`;
  assert.equal(signInMessage('en', { status: 'wrong' }, at), t('en', 'signin_wrong_pin'));
  assert.equal(signInMessage('en', { status: 'wrong', attempts_left: 1 }, at), 'Wrong employee number or PIN. Attempts left before the account locks: 1.');
  assert.equal(signInMessage('en', { status: 'locked', locked_until: 'T' }, at), 'Too many wrong attempts. Try again after at T.');
  assert.equal(signInMessage('ar', { status: 'disabled' }, at), t('ar', 'signin_account_disabled'));
  assert.equal(signInMessage('en', { status: 'ok', person_id: 'p', token: 't', expires_at: 'x' }, at), null);
});

// --- the token store ---------------------------------------------------------

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

test('the token is kept in the tab\'s storage, and cleared on sign-out', () => {
  const s = memoryStorage();
  const store = tokenStore(s);
  store.set('ab'.repeat(32));
  assert.equal(tokenStore(s).get(), 'ab'.repeat(32), 'a reload finds it');
  store.clear();
  assert.equal(tokenStore(s).get(), null);
});

test('CONTROL: a stored value that is not a token is cleared, never sent', () => {
  const s = memoryStorage();
  s.setItem('erp.console.session', 'abc"; alert(1)');
  assert.equal(tokenStore(s).get(), null);
  assert.equal(s.map.size, 0);
});

test('storage that throws costs a reload, never the console', () => {
  const broken: StorageLike = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  const store = tokenStore(broken);
  assert.equal(store.get(), null);
  store.set('cd'.repeat(32));
  assert.equal(store.get(), 'cd'.repeat(32), 'held in memory for this page');
  store.clear();
  assert.equal(tokenStore(null).get(), null);
  assert.equal(storedLang(broken), 'ar');
});
