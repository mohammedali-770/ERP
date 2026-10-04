-- pgTAP · an import sent again is a retry; an import that collides with itself is not
--
-- Migration 0017 corrects both imports, erp.import_items() and erp.import_suppliers().
-- An overlapping retry of a whole file needs two sessions, so db:check proves that part.
-- This suite proves the other: the same decision id used twice within one file, or for
-- two decisions of one row, or colliding with the log in a way only PostgreSQL notices,
-- is a line error that names the line — never "already recorded", which would tell the
-- person a file was saved when nothing was (found in module 2 step 2's review).
--
-- Every case here is refused, so nothing is written and nothing needs ordering. Fixture
-- ids are …0e13NN and …0e14NN, a range no seed row and no other suite uses.

begin;
select plan(13);

-- An import's DETAIL carries its failing lines. A test-local function reads the
-- SQLSTATE and the detail; it lives in pg_temp, so it changes nothing in erp.
create function pg_temp.refusal(p_import text, p_rows jsonb) returns text language plpgsql as $f$
declare
  v_state  text;
  v_detail text;
begin
  if p_import = 'items' then
    perform erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), p_rows);
  else
    perform erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), p_rows);
  end if;
  return '(the import was not refused)';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
  return v_state || ' ' || coalesce(v_detail, '');
end
$f$;

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------

-- CONTROL. One decision id on two rows: the second row's retry check would find the
-- first row's decision, recorded a moment earlier by this same call.
select throws_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-S1", "name_en": "Import check ZZ-T120-S1 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S1 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1401", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1402", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}, {"line": "3", "code": "ZZ-T120-S2", "name_en": "Import check ZZ-T120-S2 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S2 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1401", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1403", "supplier_id": "01936f00-0000-7000-8000-0000000e1439"}]'::jsonb) $$,
  '22023', 'supplier import refused: 1 line(s) failed and nothing was saved',
  'CONTROL: a decision id on two rows of a supplier file refuses the file, not answers it as a retry'
);
select matches(pg_temp.refusal('suppliers', '[{"line": "2", "code": "ZZ-T120-S1", "name_en": "Import check ZZ-T120-S1 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S1 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1401", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1402", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}, {"line": "3", "code": "ZZ-T120-S2", "name_en": "Import check ZZ-T120-S2 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S2 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1401", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1403", "supplier_id": "01936f00-0000-7000-8000-0000000e1439"}]'::jsonb),
  '^22023 line 3: decision id 01936f00-0000-7000-8000-0000000e1401 is used twice in the file \(lines 2 and 3\)$',
  'and names the second line, and the first');
select throws_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-S3", "name_en": "Import check ZZ-T120-S3 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S3 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1404", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1404", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}]'::jsonb) $$,
  '22023', 'supplier import refused: 1 line(s) failed and nothing was saved',
  'a row whose contact decision reuses its own decision id is refused too'
);
select matches(pg_temp.refusal('suppliers', '[{"line": "2", "code": "ZZ-T120-S3", "name_en": "Import check ZZ-T120-S3 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S3 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1404", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1404", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}]'::jsonb),
  '^22023 line 2: decision id 01936f00-0000-7000-8000-0000000e1404 is used twice in the file \(lines 2 and 2\)$',
  'naming its line');
-- Ids are compared as ids, not as spellings: braced, hyphenless and in capitals is
-- the same uuid (found by Codex on PR #35).
select matches(pg_temp.refusal('suppliers', '[{"line": "2", "code": "ZZ-T120-S4", "name_en": "Import check ZZ-T120-S4 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S4 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-0000000e1405", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1406", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}, {"line": "3", "code": "ZZ-T120-S5", "name_en": "Import check ZZ-T120-S5 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S5 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "{01936F000000700080000000000E1405}", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1407", "supplier_id": "01936f00-0000-7000-8000-0000000e1439"}]'::jsonb),
  '^22023 line 3: decision id 01936f00-0000-7000-8000-0000000e1405 is used twice',
  'an id spelled another way is the same id');
-- CONTROL, the other way. A decision id recorded by ANOTHER call is still a retry, the
-- answer the edge reads back through the supplier's history.
select throws_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-S6", "name_en": "Import check ZZ-T120-S6 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-S6 (تجريبي)", "payment_terms_days": "30", "contact_person": "Desk", "decision_id": "01936f00-0000-7000-8000-000000005301", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1408", "supplier_id": "01936f00-0000-7000-8000-0000000e1429"}]'::jsonb) $$,
  '23505', 'decision 01936f00-0000-7000-8000-000000005301 is already recorded',
  'CONTROL: a decision another call recorded is answered as a retry, as the routes answer it'
);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-I1", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I1 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I1 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1301", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1322", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}, {"line": "3", "code": "ZZ-T120-I2", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I2 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I2 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1301", "item_id": "01936f00-0000-7000-8000-0000000e1331", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1332", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1333"}]'::jsonb) $$,
  '22023', 'item import refused: 1 line(s) failed and nothing was saved',
  'CONTROL: a decision id on two rows of an items file refuses the file, not answers it as a retry'
);
select matches(pg_temp.refusal('items', '[{"line": "2", "code": "ZZ-T120-I1", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I1 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I1 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1301", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1322", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}, {"line": "3", "code": "ZZ-T120-I2", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I2 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I2 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1301", "item_id": "01936f00-0000-7000-8000-0000000e1331", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1332", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1333"}]'::jsonb),
  '^22023 line 3: decision id 01936f00-0000-7000-8000-0000000e1301 is used twice in the file \(lines 2 and 3\)$',
  'and names the second line, and the first');
select matches(pg_temp.refusal('items', '[{"line": "2", "code": "ZZ-T120-I3", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I3 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I3 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1304", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1304", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}]'::jsonb),
  '^22023 line 2: decision id 01936f00-0000-7000-8000-0000000e1304 is used twice in the file \(lines 2 and 2\)$',
  'a row whose base unit decision reuses its own decision id is refused, naming its line');
select matches(pg_temp.refusal('items', '[{"line": "2", "code": "ZZ-T120-I7", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I7 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I7 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1310", "item_id": "01936f00-0000-7000-8000-0000000e1327", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1328", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1329"}, {"line": "3", "code": "ZZ-T120-I8", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I8 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I8 (تجريبي)", "decision_id": "01936f000000700080000000000e1310", "item_id": "01936f00-0000-7000-8000-0000000e1337", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1338", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1339"}]'::jsonb),
  '^22023 line 3: decision id 01936f00-0000-7000-8000-0000000e1310 is used twice',
  'an items file''s ids are compared as ids too, hyphenless or not');
-- CONTROL. A base-unit decision id already in the log is a collision erp.create_item()
-- does not check, so PostgreSQL raises it. It is a line error, as in 0012, and every
-- other failing line is still named — not re-raised whole as an anonymous conflict.
select throws_ok(
  $$ select erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-I4", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I4 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I4 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1305", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-000000004307", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}, {"line": "3", "code": "ZZ-T120-I5", "item_kind": "gadget", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I5 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I5 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1306", "item_id": "01936f00-0000-7000-8000-0000000e1331", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1332", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1333"}]'::jsonb) $$,
  '22023', 'item import refused: 2 line(s) failed and nothing was saved',
  'CONTROL: a collision PostgreSQL raises is a line error, and every failing line is still counted'
);
select matches(pg_temp.refusal('items', '[{"line": "2", "code": "ZZ-T120-I4", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I4 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I4 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1305", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-000000004307", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}, {"line": "3", "code": "ZZ-T120-I5", "item_kind": "gadget", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I5 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I5 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-0000000e1306", "item_id": "01936f00-0000-7000-8000-0000000e1331", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1332", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1333"}]'::jsonb),
  '^22023 line 2: duplicate key value violates unique constraint "item_decision_pkey"\nline 3: ',
  'both lines named, the collision first');
select throws_ok(
  $$ select erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line": "2", "code": "ZZ-T120-I6", "item_kind": "packaging", "base_unit_key": "piece", "brand_id": "01936f00-0000-7000-8000-000000000201", "name_en": "Import check ZZ-T120-I6 (synthetic)", "name_ar": "فحص الاستيراد ZZ-T120-I6 (تجريبي)", "decision_id": "01936f00-0000-7000-8000-000000004307", "item_id": "01936f00-0000-7000-8000-0000000e1321", "base_unit_decision_id": "01936f00-0000-7000-8000-0000000e1322", "base_item_unit_id": "01936f00-0000-7000-8000-0000000e1323"}]'::jsonb) $$,
  '23505', 'decision 01936f00-0000-7000-8000-000000004307 is already recorded',
  'CONTROL: a decision another call recorded is answered as a retry, as the routes answer it'
);

select * from finish();
rollback;
