import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, type Fetch, type Supplier, type Supply } from '../src/api.ts';
import { parseCsv, prepareSupplierImport, SUPPLIER_IMPORT_COLUMNS, type SupplierImportIds } from '../src/csv.ts';
import { asKey } from '../src/i18n.ts';
import { failureMessage } from '../src/messages.ts';
import { NAVIGATION, itemIsVisible, itemIsWritable } from '../src/navigation.ts';
import { formatRoute, navIdOf, parseRoute, type Route } from '../src/route.ts';
import {
  amendBody, amendSupplyBody, businessProblem, contactBody, contactProblem, crLooksValid, eraseBody, foldDigits,
  phoneLooksValid, suppliablePacks, supplyChange, supplyWarning, termsInput, vatLooksValid,
} from '../src/suppliers.ts';
import { suppliersWritable, toViewer } from '../src/viewer.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const SUPPLIERS_MIGRATION = read('supabase/migrations/20261004000200_suppliers.sql');
const ITEMS_MIGRATION = read('supabase/migrations/20261002000200_items_and_units.sql');

const S = '01936f00-0000-7000-8000-000000005101';
const X = '01936f00-0000-7000-8000-000000005201';
const D = '01936f00-0000-7000-8000-0000000a0001';

const SUPPLIER: Supplier = {
  supplier_id: S, code: 'SUP-POULTRY', name_en: 'Al Waha', name_ar: 'الواحة', vat_number: '310000000000003',
  cr_number: null, payment_terms_days: 30, status: 'active', contact_person: 'Desk', phone: null, email: null,
  address: null, as_of_decision_id: 'stamp',
};
const SUPPLY: Supply = {
  supplier_item_id: X, item_unit_id: 'u1', item_id: 'i1', item_code: 'RM-CHK', item_name_en: 'Chicken',
  item_name_ar: 'دجاج', unit_key: 'carton', factor: '10.000000', supplier_code: 'WP-10', preferred: true,
  status: 'active', as_of_decision_id: 'supply-stamp', conversion_status: 'active', item_status: 'active',
};

/** A fetch that records every request. */
function fake() {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ status: 'ok', decision_id: 'd', created: 1, amended: 0, unchanged: 0, suppliers: [], next_after: null }), { status: 200 });
  };
  return { sent, fetch };
}
const api = (f: ReturnType<typeof fake>) => createApi({ base: 'https://edge.test/functions/v1', fetch: f.fetch, token: () => 'ab'.repeat(32) });
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys)
  : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

// --- the client ----------------------------------------------------------------

test('CONTROL: no supplier write the console sends names an actor, and each goes to its route', async () => {
  const f = fake();
  const a = api(f);
  await a.createSupplier({ decision_id: D, supplier_id: S, code: 'C', name_en: 'n', name_ar: 'ن', vat_number: null, cr_number: null, payment_terms_days: 30, reason: 'r' });
  await a.amendSupplier(S, amendBody(SUPPLIER, D, { nameEn: 'n', nameAr: 'ن', vat: '', cr: '', terms: 30, reason: 'r' }));
  await a.changeSupplierStatus(S, { decision_id: D, expected_decision_id: 'stamp', status: 'retired', reason: 'r' });
  await a.setSupplierContact(S, contactBody(SUPPLIER, D, { person: 'p', phone: '', email: '', address: '' }));
  await a.addSupply(S, { decision_id: D, supplier_item_id: X, item_unit_id: 'u', supplier_code: null, preferred: false, reason: 'r' });
  await a.amendSupply(X, amendSupplyBody(SUPPLY, D, { supplierCode: '', preferred: false, reason: 'r' }));
  await a.retireSupply(X, { decision_id: D, reason: 'r' });
  await a.importSuppliers('r', [{ code: 'C' }]);
  for (const s of f.sent) {
    for (const k of keys(s.body)) assert.doesNotMatch(k, /^(actor|person|employee|user)(_id|_number)?$/i, `${s.url}: ${k}`);
    assert.equal(s.method, 'POST');
  }
  assert.deepEqual(f.sent.map((s) => s.url.replace('https://edge.test/functions/v1', '')), [
    '/suppliers', `/suppliers/${S}/amend`, `/suppliers/${S}/status`, `/suppliers/${S}/contact`, `/suppliers/${S}/supplies`,
    `/suppliers/supplies/${X}/amend`, `/suppliers/supplies/${X}/retire`, '/suppliers/import',
  ]);
});

test('CONTROL: a contact change carries no reason, and every contact field is stated', async () => {
  // The edge refuses a contact body with a reason (ADR-0026 §2), and reads an absent field
  // as malformed rather than "clear": both rules are the console's to keep.
  const body = contactBody(SUPPLIER, D, { person: ' Desk ', phone: '', email: '', address: '' });
  assert.equal('reason' in body, false);
  assert.deepEqual(Object.keys(body).sort(), ['address', 'contact_person', 'decision_id', 'email', 'expected_decision_id', 'phone']);
  assert.deepEqual([body.contact_person, body.phone, body.expected_decision_id], ['Desk', null, 'stamp']);
  const erased = eraseBody(SUPPLIER, D);
  assert.deepEqual([erased.contact_person, erased.phone, erased.email, erased.address], [null, null, null, null]);
  assert.equal('reason' in erased, false);
});

test('an amendment states every field it overwrites, blank as null, and terms as a number', async () => {
  const body = amendBody(SUPPLIER, D, { nameEn: 'n', nameAr: 'ن', vat: '  ', cr: '1010000001', terms: 45, reason: ' r ' });
  assert.ok('vat_number' in body && body.vat_number === null, 'a cleared VAT number is sent as null, not left out');
  assert.equal(body.cr_number, '1010000001');
  assert.equal(body.payment_terms_days, 45);
  assert.equal(typeof body.payment_terms_days, 'number');
  assert.equal(body.expected_decision_id, 'stamp', 'against the loaded stamp');
  assert.equal(body.reason, 'r');
  const supply = amendSupplyBody(SUPPLY, D, { supplierCode: '', preferred: false, reason: 'r' });
  assert.ok('supplier_code' in supply && supply.supplier_code === null);
  assert.equal(supply.expected_decision_id, 'supply-stamp');
});

// --- the courtesy checks, held to 0016's own rules -------------------------------

test('the field pre-checks are 0016\'s rules, read from the migration', () => {
  assert.match(SUPPLIERS_MIGRATION, /p_vat_number !~ '\^3\[0-9\]\{13\}3\$'/);
  assert.match(SUPPLIERS_MIGRATION, /p_cr_number !~ '\^\[0-9\]\{10\}\$'/);
  assert.match(SUPPLIERS_MIGRATION, /v_phone !~ '\^\\\+\?\[0-9\]\{6,15\}\$'/);
  assert.match(SUPPLIERS_MIGRATION, /payment_terms_days between 0 and 365/);
  assert.equal(vatLooksValid('310000000000003'), true);
  assert.equal(vatLooksValid('٣١٠٠٠٠٠٠٠٠٠٠٠٠٣'), true, 'Arabic-Indic digits, as the database folds them');
  assert.equal(vatLooksValid('310 000 000 000 003'), true, 'spaces are dropped');
  assert.equal(vatLooksValid('210000000000003'), false);
  assert.equal(vatLooksValid(''), true, 'blank is none');
  assert.equal(crLooksValid('١٠١٠٠٠٠٠٠١'), true);
  assert.equal(crLooksValid('101000000'), false);
  assert.equal(phoneLooksValid('+966 55 000 0001'), true);
  assert.equal(phoneLooksValid('12345'), false);
  assert.equal(foldDigits('‎٣١٠-٠٬'), '3100');
  assert.equal(contactProblem({ phone: '12', email: '' }), 'phone');
  assert.equal(contactProblem({ phone: '', email: 'not-an-email' }), 'email');
  assert.equal(contactProblem({ phone: '', email: 'a@b.test' }), null);
});

test('payment terms are a whole number of days in either script; the range is the database\'s', () => {
  assert.deepEqual(termsInput('٤٥'), { ok: true, value: 45 });
  assert.deepEqual(termsInput(' 0 '), { ok: true, value: 0 });
  assert.deepEqual(termsInput('400'), { ok: true, value: 400 }, 'refused by supplier_payment_terms_are_days, not here');
  assert.deepEqual(termsInput('30.5'), { ok: false });
  assert.deepEqual(termsInput(''), { ok: false });
  assert.equal(businessProblem({ vat: '1', cr: '', terms: '30' }), 'vat_number');
  assert.equal(businessProblem({ vat: '', cr: '1', terms: '30' }), 'cr_number');
  assert.equal(businessProblem({ vat: '', cr: '', terms: 'x' }), 'payment_terms_days');
  assert.equal(businessProblem({ vat: '', cr: '', terms: '30' }), null);
});

test('what may change about a supply is what amend_supplier_item() allows', () => {
  assert.equal(supplyChange(SUPPLY, true), 'any');
  assert.equal(supplyChange({ ...SUPPLY, status: 'retired' }, true), 'none', 'retirement is final (I-6)');
  assert.equal(supplyChange(SUPPLY, false), 'unprefer', 'a retired supplier may give up the preferred slot');
  assert.equal(supplyChange({ ...SUPPLY, preferred: false }, false), 'none', 'and nothing else');
  assert.equal(supplyChange({ ...SUPPLY, conversion_status: 'retired' }, true), 'no_prefer');
  assert.equal(supplyChange({ ...SUPPLY, item_status: 'retired' }, true), 'no_prefer');
  assert.match(SUPPLIERS_MIGRATION, /if s\.status = 'retired' and not \(p_preferred = false and v_code is not distinct from x\.supplier_code\)/,
    'the retired-supplier rule this mirrors');
  assert.equal(supplyWarning(SUPPLY), null);
  assert.equal(supplyWarning({ ...SUPPLY, item_status: 'retired', conversion_status: 'retired' }), 'item_retired');
  assert.equal(supplyWarning({ ...SUPPLY, conversion_status: 'retired' }), 'pack_retired');
});

test('add supply offers active packs the supplier does not already sell', () => {
  const units = [
    { item_unit_id: 'u1', status: 'active' }, { item_unit_id: 'u2', status: 'active' }, { item_unit_id: 'u3', status: 'retired' },
  ];
  assert.deepEqual(suppliablePacks(units, [SUPPLY]).map((u) => u.item_unit_id), ['u2']);
  assert.deepEqual(suppliablePacks(units, [{ ...SUPPLY, status: 'retired' }]).map((u) => u.item_unit_id), ['u1', 'u2'],
    'a retired supply frees its pack for a new one');
  assert.deepEqual(suppliablePacks(units, null).map((u) => u.item_unit_id), ['u1', 'u2']);
});

// --- routes, menu, gate --------------------------------------------------------

test('supplier routes parse and format both ways, and mark Suppliers current', () => {
  const routes: Route[] = [
    { screen: 'suppliers' }, { screen: 'supplier_new' }, { screen: 'supplier_import' },
    { screen: 'supplier', supplierId: S }, { screen: 'supplier_edit', supplierId: S }, { screen: 'supplier_contact', supplierId: S },
  ];
  for (const r of routes) {
    assert.deepEqual(parseRoute(formatRoute(r)), r);
    assert.equal(navIdOf(r), 'suppliers', r.screen);
  }
  assert.deepEqual(parseRoute(`#suppliers/${S.toUpperCase()}`), { screen: 'supplier', supplierId: S });
  assert.deepEqual(parseRoute('#suppliers/SUP-POULTRY'), { screen: 'unknown', id: 'suppliers/SUP-POULTRY' });
  assert.deepEqual(parseRoute(`#suppliers/${S}/delete`), { screen: 'unknown', id: `suppliers/${S}/delete` });
  assert.equal(navIdOf({ screen: 'item', itemId: S }), 'items');
});

test('the Suppliers entry is behind 0016\'s capability, and every 0016 decision kind has a label', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'suppliers')!;
  assert.equal(entry.capability, 'procurement.suppliers');
  assert.match(SUPPLIERS_MIGRATION, /\('procurement\.suppliers', 'Suppliers'/, 'the key 0016 registers');
  const kinds = /check \(kind in \(([^)]+)\)\)/.exec(SUPPLIERS_MIGRATION)![1]!.match(/'(\w+)'/g)!.map((k) => k.slice(1, -1));
  assert.equal(kinds.length, 7);
  for (const kind of kinds) assert.notEqual(asKey(`kind_${kind}`), null, kind);
});

test('CONTROL: supplier changes are offered only organisation-wide, where 0016 checks them', () => {
  const entry = NAVIGATION.flatMap((g) => g.items).find((i) => i.id === 'suppliers')!;
  const v = toViewer({
    person: { person_id: 'p', employee_number: '1', full_name_en: null, full_name_ar: null, primary_facility_id: null, status: 'active' },
    facility_id: null, org_wide: true, facilities: [], brands: [], units: [],
    permissions: ['procurement.suppliers:read', 'procurement.suppliers:write'], states: { 'procurement.suppliers': 'pilot' },
  });
  assert.equal(itemIsVisible(entry, v), true);
  assert.equal(suppliersWritable(v, null, (x) => itemIsWritable(entry, x)), true);
  assert.equal(suppliersWritable(v, 'a-branch', (x) => itemIsWritable(entry, x)), false);
  // Every write route and the import ask for write with no facility; if one ever takes
  // a facility, this rule and its screens need revisiting.
  const writes = [...SUPPLIERS_MIGRATION.matchAll(/assert_permitted\(p_actor_id, 'procurement\.suppliers', 'write', ([^)]+)\)/g)];
  assert.equal(writes.length, 8);
  for (const w of writes) assert.equal(w[1], 'null');
});

test('every constraint the console words for suppliers is one 0016 or 0012 names', () => {
  // A mapped constraint that no migration names is a sentence nobody will ever read.
  const source = readFileSync(new URL('../src/messages.ts', import.meta.url), 'utf8');
  const mapped = [...source.matchAll(/^\s+(supplier_\w+|item_admits_no_new_work): '/gm)].map((m) => m[1]!);
  assert.ok(mapped.length >= 20);
  for (const c of mapped) {
    assert.ok(new RegExp(`\\b${c}\\b`).test(SUPPLIERS_MIGRATION) || new RegExp(`\\b${c}\\b`).test(ITEMS_MIGRATION), c);
  }
  const f = { ok: false as const, http: 409, status: 'stale', message: 'supplier X has changed', constraint: 'supplier_stale', detail: null, field: null };
  assert.match(failureMessage('en', f).text, /supplier/, 'a stale supplier is not "this item"');
  assert.match(failureMessage('en', { ...f, status: 'conflict', constraint: 'supplier_item_one_preferred' }).text, /preferred supplier/);
});

// --- the upload ------------------------------------------------------------------

let n = 0;
const mint = (): SupplierImportIds => ({ decision_id: `d${n}`, contact_decision_id: `c${n}`, supplier_id: `s${n++}` });

test('CONTROL: every column the supplier upload sends is one erp.import_suppliers() reads', () => {
  const header = SUPPLIER_IMPORT_COLUMNS.join(',');
  const prepared = prepareSupplierImport(parseCsv(`${header}\nSUP-A,A,أ,,,30,Desk,+966550000001,a@b.test,Riyadh`), mint);
  assert.ok(prepared.ok);
  for (const key of Object.keys(prepared.rows[0]!)) {
    if (key === 'line') continue;
    assert.match(SUPPLIERS_MIGRATION, new RegExp(`r\\.row ->> '${key}'`), `import_suppliers reads ${key}`);
  }
  assert.equal(prepared.rows[0]!['payment_terms_days'], '30', 'terms travel as text: the database checks the cell');
  assert.equal(prepared.rows[0]!['vat_number'], null, 'a blank cell is null');
});

test('a supplier file needs code, names and terms; ids are minted once per row and never shared', () => {
  const missing = prepareSupplierImport(parseCsv('code,name_en,name_ar\nA,a,أ'), mint);
  assert.deepEqual(missing, { ok: false, problems: [{ kind: 'missing_column', column: 'payment_terms_days' }] });
  const prepared = prepareSupplierImport(parseCsv('code,name_en,name_ar,payment_terms_days\nA,a,أ,30\nB,b,ب,٤٥'), mint);
  assert.ok(prepared.ok);
  const ids = prepared.rows.flatMap((r) => [r['decision_id'], r['contact_decision_id'], r['supplier_id']]);
  assert.equal(new Set(ids).size, 6, 'no id is used twice in a file, which 0017 refuses as a line error');
  assert.equal(prepared.rows[1]!['payment_terms_days'], '٤٥', 'Arabic digits are the database\'s to fold');
  const unknown = prepareSupplierImport(parseCsv('code,name_en,name_ar,payment_terms_days,type\nA,a,أ,30,both'), mint);
  assert.deepEqual(unknown, { ok: false, problems: [{ kind: 'unknown_column', column: 'type' }] }, 'the warehouse\'s type is gone');
});

test('both uploads read the same file twice: the input is cleared once the file is read', () => {
  // An unchanged file input fires no change event, so "upload the same file again" (items
  // UAT 6.2) did nothing until the input was cleared. The screens are .tsx, which Node
  // cannot load, so their source is read.
  for (const screen of ['ItemImport.tsx', 'SupplierImport.tsx']) {
    const src = readFileSync(new URL(`../src/screens/${screen}`, import.meta.url), 'utf8');
    assert.match(src, /const file = e\.target\.files\?\.\[0\];[\s\S]{0,400}?e\.target\.value = '';/, `${screen} clears the input`);
    assert.match(src, /import_file/, `${screen} shows the chosen file's name instead`);
  }
});
