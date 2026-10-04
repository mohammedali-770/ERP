import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brandLookup, decodeCsv, IMPORT_COLUMNS, MAX_ROWS, parseCsv, prepareImport, type ImportIds } from '../src/csv.ts';

const ITEMS_MIGRATION = readFileSync(new URL('../../../supabase/migrations/20261002000200_items_and_units.sql', import.meta.url), 'utf8');
const BRANDS = brandLookup([{ brand_id: 'b-spicy', code: 'SPICY' }, { brand_id: 'b-second', code: 'SECOND' }]);
let n = 0;
const mint = (): ImportIds => ({ decision_id: `d${n}`, item_id: `i${n}`, base_unit_decision_id: `bd${n}`, base_item_unit_id: `bu${n++}` });
const HEADER = 'code,item_kind,base_unit_key,brand,name_en,name_ar';

test('UTF-8 is read, a BOM dropped, and anything else refused rather than guessed', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('code\nأرز')]);
  assert.deepEqual(decodeCsv(bom), { ok: true, text: 'code\nأرز' });
  // "أرز" in Windows-1256, as Excel's plain CSV writes it on an Arabic Windows.
  assert.deepEqual(decodeCsv(new Uint8Array([0x63, 0x0a, 0xc3, 0xd1, 0xd2])), { ok: false, reason: 'not_utf8' });
});

test('quotes, doubled quotes, delimiters and newlines inside a field; CRLF; blank lines', () => {
  const text = 'a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,,3\n';
  assert.deepEqual(parseCsv(text), [
    { line: 1, fields: ['a', 'b', 'c'] },
    { line: 2, fields: ['x, y', 'say "hi"', 'two\nlines'] },
    { line: 5, fields: ['1', '', '3'] },
  ]);
});

test('CONTROL: a quote inside an unquoted field is a character, and never merges two rows', () => {
  // Found in review: an inch mark opened a quoted field, so PK-2 vanished into PK-1's name
  // at exactly the header's width, and the database accepted the result.
  const records = parseCsv(`${HEADER}\nPK-1,packaging,piece,SPICY,12" plate,صحن\nPK-2,packaging,piece,SPICY,9" plate,صحن ٢\n`);
  assert.deepEqual(records.slice(1).map((r) => r.fields[4]), ['12" plate', '9" plate']);
  const p = prepareImport(records, BRANDS, mint);
  assert.ok(p.ok);
  assert.deepEqual(p.rows.map((r) => r['code']), ['PK-1', 'PK-2']);
});

test('text after a closing quote, or a quote never closed, refuses its line', () => {
  assert.deepEqual(parseCsv('a,b\n"x"y,z'), [{ line: 1, fields: ['a', 'b'] }, { line: 2, fields: ['xy', 'z'], malformed: true }]);
  assert.deepEqual(parseCsv('a,b\n"x,z').at(-1)!.malformed, true);
  const p = prepareImport(parseCsv(`${HEADER}\n"A"B,raw_ingredient,g,SPICY,a,أ`), BRANDS, mint);
  assert.deepEqual(p.ok ? [] : p.problems, [{ kind: 'quote', line: 2 }]);
});

test('rows of bare delimiters, as Excel writes below the data, are skipped', () => {
  const p = prepareImport(parseCsv(`${HEADER}\nA,raw_ingredient,g,SPICY,a,أ\n,,,,,\n,,,,,\n`), BRANDS, mint);
  assert.ok(p.ok);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(prepareImport(parseCsv(`${HEADER}\n,,,,,`), BRANDS, mint), { ok: false, problems: [{ kind: 'empty' }] });
});

test('a semicolon header means semicolons, as a European or Arabic Excel writes', () => {
  assert.deepEqual(parseCsv('code;name_en\nRM-1;Rice, long'), [
    { line: 1, fields: ['code', 'name_en'] },
    { line: 2, fields: ['RM-1', 'Rice, long'] },
  ]);
});

test('a file with no final newline, and a lone quoted empty field, are records', () => {
  assert.deepEqual(parseCsv('a\n""'), [{ line: 1, fields: ['a'] }, { line: 2, fields: [''] }]);
});

test('rows become erp.import_items() rows: line, ids, brand id, blank as null', () => {
  const records = parseCsv(`${HEADER},description_en,description_ar\nRM-RICE,raw_ingredient,kg,spicy,Rice,أرز,,\n`);
  const prepared = prepareImport(records, BRANDS, mint);
  assert.equal(prepared.ok, true);
  const row = prepared.ok ? prepared.rows[0]! : {};
  assert.equal(row['line'], '2');
  assert.equal(row['brand_id'], 'b-spicy', 'a brand code in any case');
  assert.equal(row['description_en'], null);
  assert.equal(row['code'], 'RM-RICE');
  assert.match(String(row['decision_id']), /^d\d+$/);
});

test('CONTROL: every column the upload sends is one erp.import_items() reads', () => {
  const prepared = prepareImport(parseCsv(`${IMPORT_COLUMNS.join(',')}\nC,raw_ingredient,g,SPICY,n,ن,d,و`), BRANDS, mint);
  assert.ok(prepared.ok);
  for (const key of Object.keys(prepared.rows[0]!)) {
    assert.match(ITEMS_MIGRATION, new RegExp(`r\\.row ->> '${key}'`), `import_items reads ${key}`);
  }
});

test('the ids are minted once per row, so a retry of the same file sends the same ids', () => {
  const records = parseCsv(`${HEADER}\nA,raw_ingredient,g,SPICY,a,أ\nB,raw_ingredient,g,SPICY,b,ب`);
  const prepared = prepareImport(records, BRANDS, mint);
  assert.ok(prepared.ok);
  const ids = prepared.rows.flatMap((r) => [r['decision_id'], r['item_id'], r['base_unit_decision_id'], r['base_item_unit_id']]);
  assert.equal(new Set(ids).size, 8);
});

test('a header with a missing, unknown or repeated column is refused before anything is sent', () => {
  const problems = (csv: string) => {
    const p = prepareImport(parseCsv(csv), BRANDS, mint);
    return p.ok ? [] : p.problems;
  };
  assert.deepEqual(problems('code,item_kind,base_unit_key,brand,name_en\nA,b,c,SPICY,e'), [{ kind: 'missing_column', column: 'name_ar' }]);
  assert.deepEqual(problems(`${HEADER},serial\nA,b,c,SPICY,e,f,g`), [{ kind: 'unknown_column', column: 'serial' }]);
  assert.deepEqual(problems(`${HEADER},code\nA,b,c,SPICY,e,f,A`), [{ kind: 'duplicate_column', column: 'code' }]);
  assert.deepEqual(problems(HEADER), [{ kind: 'empty' }]);
  assert.deepEqual(problems(''), [{ kind: 'empty' }]);
});

test('a short line and an unknown brand name their line', () => {
  const p = prepareImport(parseCsv(`${HEADER}\nA,b,c,SPICY,e\nB,b,c,OTHER,e,f`), BRANDS, mint);
  assert.deepEqual(p.ok ? [] : p.problems, [
    { kind: 'width', line: 2, expected: 6, found: 5 },
    { kind: 'unknown_brand', line: 3, brand: 'OTHER' },
  ]);
});

test('more rows than one import holds is refused, at the database\'s own limit', () => {
  const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `C${i},raw_ingredient,g,SPICY,n,ن`).join('\n');
  const p = prepareImport(parseCsv(`${HEADER}\n${body}`), BRANDS, mint);
  assert.deepEqual(p.ok ? [] : p.problems, [{ kind: 'too_many', rows: MAX_ROWS + 1 }]);
  assert.match(ITEMS_MIGRATION, new RegExp(`jsonb_array_length\\(p_rows\\) not between 1 and ${MAX_ROWS}`));
});
