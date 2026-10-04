-- pgTAP · suppliers, proved by being refused by them
--
-- 0016 is module 2, and the first table to stand on 0012's conversion seam. Each rule is
-- proved by colliding with it; cases marked CONTROL are why the suite exists. The message
-- is asserted wherever another refusal shares the SQLSTATE.
--
-- ORDER MATTERS, as in 080:
--   * throws_ok and lives_ok bodies are replayed alone by tools/db-fixtures against the
--     seed, so none may depend on a plain statement earlier in this file;
--   * plain statements that change state come after every throws_ok that relies on the
--     seeded state;
--   * the lives_ok that COMMIT under db-fixtures are last, with fresh ids, touching
--     nothing an earlier fixture reads.
--
-- Fixture ids are …0e11NN and …0e12NN, a range no seed row and no other suite uses.

begin;
select plan(138);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'supplier', 'erp.supplier exists');
select has_table('erp', 'supplier_item', 'erp.supplier_item exists');
select has_table('erp', 'supplier_decision', 'erp.supplier_decision exists');
select has_column('erp', 'supplier',      'as_of_decision_id', 'a supplier carries the decision behind it (I-8)');
select has_column('erp', 'supplier_item', 'as_of_decision_id', 'a supply carries the decision behind it (I-8)');
select col_is_fk('erp', 'supplier_decision', 'actor_id', 'every supplier decision names a person');
select col_isnt_fk('erp', 'supplier_decision', 'supplier_id', 'the log does not reference the supplier it creates');
select col_is_unique('erp', 'supplier', array['code']::name[], 'a code names one supplier, retired ones included');

-- THE SEAM. What a supplier sells is one conversion, referenced through all four of 0012's
-- seam columns, so a supply cannot name a pack at a factor it never had.
select fk_ok('erp', 'supplier_item', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
             'erp', 'item_unit', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
  'a supply references its conversion through the seam (INV-005, I-7)');

-- SEC-008: no contact value can ever be logged, because the log has nowhere to put one.
select hasnt_column('erp', 'supplier_decision', 'contact_person', 'the log has no contact person');
select hasnt_column('erp', 'supplier_decision', 'phone', 'nor a phone');
select hasnt_column('erp', 'supplier_decision', 'email', 'nor an email');
select hasnt_column('erp', 'supplier_decision', 'address', 'nor an address');

select is((select pg_get_expr(i.indpred, i.indrelid) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'supplier_item_one_active'),
  '(status = ''active''::text)', 'a supplier sells a conversion once among ACTIVE supplies only');
select is((select pg_get_expr(i.indpred, i.indrelid) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'supplier_item_one_preferred'),
  '((status = ''active''::text) AND preferred)', 'and an item has one preferred supplier among ACTIVE supplies only');
select is((select pg_get_expr(i.indpred, i.indrelid) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'supplier_active_name_en_key'),
  '(status = ''active''::text)', 'supplier names are unique among ACTIVE suppliers, so a retired one frees its name');

-- ---------------------------------------------------------------------------
-- Privilege facts
-- ---------------------------------------------------------------------------

select is(has_table_privilege('erp_app', 'erp.supplier', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime holds no privilege on erp.supplier: it reads and writes through the routes only');
select is(has_table_privilege('erp_app', 'erp.supplier_item', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor on erp.supplier_item');
select is(has_table_privilege('erp_app', 'erp.supplier_decision', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor on the decision log');
select ok(has_function_privilege('erp_app', 'erp.create_supplier(uuid,uuid,text,text,text,text,text,integer,text,uuid,timestamptz)', 'EXECUTE'),
  'the runtime may call the routes');
select is(has_function_privilege('erp_app', 'erp.assert_supplier_active(uuid)', 'EXECUTE'), false,
  'but not the seam later modules call from their own routes');
select is(has_function_privilege('erp_app', 'erp.supplier_items_json(uuid,uuid)', 'EXECUTE'), false,
  'nor the helper the reads use, which filters nothing by permission');
select is(has_function_privilege('erp_read', 'erp.list_suppliers(uuid,uuid,text,text,text,integer)', 'EXECUTE'), false,
  'the reporting role reads the tables, not the routes');

-- ---------------------------------------------------------------------------
-- The gate (CAP-P02, CAP-P04) and permission (IAM-003)
-- ---------------------------------------------------------------------------

-- CONTROL, the left half: hidden refuses even the administrator.
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1101'::uuid, 'procurement.suppliers', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.create_supplier('01936f00-0000-7000-8000-0000000e1102'::uuid, '01936f00-0000-7000-8000-0000000e1103'::uuid, 'ZZ-HIDDEN',
       'Hidden supplier (synthetic)', 'مورد مخفي (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'capability procurement.suppliers is hidden for this scope and does not admit new work (CAP-P04)',
  'a hidden capability refuses new work, even to the administrator'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1104'::uuid, 'procurement.suppliers', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.list_suppliers('01936f00-0000-7000-8000-000000000900'::uuid) $$,
  '23001', 'capability procurement.suppliers is hidden for this scope (CAP-P02)',
  'and hidden hides the data, not only the menu'
);
-- CONTROL, the right half: the warehouse manager reads suppliers and holds no write.
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1105'::uuid, '01936f00-0000-7000-8000-0000000e1106'::uuid, 'ZZ-NOPE',
       'Nope supplier (synthetic)', 'مورد مرفوض (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'reading suppliers grants no right to write them'
);
select throws_ok(
  $$ select * from erp.list_suppliers('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability procurement.suppliers here (IAM-003)',
  'a branch worker reads no supplier, even at their own branch'
);
-- Every route asks; db-check's every-runtime-definer-route-is-gated is the backstop.
select throws_ok(
  $$ select erp.amend_supplier('01936f00-0000-7000-8000-0000000e1107'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid,
       'Gulf Packaging Co. (synthetic)', 'الخليج للتغليف (تجريبي)', '310000000000103', '1010000002', 60, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'amend_supplier asks for write permission as well'
);
select throws_ok(
  $$ select erp.change_supplier_status('01936f00-0000-7000-8000-0000000e1108'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, 'retired', 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'change_supplier_status asks for write permission as well'
);
select throws_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1109'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, 'Someone', null, null, null, '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'set_supplier_contact asks for write permission as well'
);
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1110'::uuid, '01936f00-0000-7000-8000-0000000e1111'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'add_supplier_item asks for write permission as well'
);
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1112'::uuid, '01936f00-0000-7000-8000-000000005202'::uuid, '01936f00-0000-7000-8000-000000005312'::uuid, 'X', false, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'amend_supplier_item asks for write permission as well'
);
select throws_ok(
  $$ select erp.retire_supplier_item('01936f00-0000-7000-8000-0000000e1113'::uuid, '01936f00-0000-7000-8000-000000005202'::uuid, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'retire_supplier_item asks for write permission as well'
);
select throws_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, 'testing', now(), '[{"code": "X"}]'::jsonb) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability procurement.suppliers here (IAM-003)',
  'import_suppliers asks for write permission as well'
);
select throws_ok(
  $$ select * from erp.get_supplier('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability procurement.suppliers here (IAM-003)',
  'get_supplier asks for read permission'
);
select throws_ok(
  $$ select * from erp.supplier_history('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability procurement.suppliers here (IAM-003)',
  'supplier_history asks for read permission'
);
select throws_ok(
  $$ select * from erp.item_suppliers('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000004101'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability procurement.suppliers here (IAM-003)',
  'item_suppliers asks for read permission on suppliers, though the cashier may read the item'
);

-- ---------------------------------------------------------------------------
-- A supplier's business record (PRC-005)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1114'::uuid, '01936f00-0000-7000-8000-0000000e1115'::uuid, 'not a code!',
       'Bad code (synthetic)', 'رمز سيئ (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'supplier code NOT A CODE! is not valid: 1 to 24 characters of A-Z, 0-9, ".", "_" or "-", beginning with a letter or digit',
  'a code has one alphabet, as an item code does'
);
-- CONTROL. Trimmed and upper-cased first, so ' sup-poultry ' IS SUP-POULTRY.
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1116'::uuid, '01936f00-0000-7000-8000-0000000e1117'::uuid, ' sup-poultry ',
       'Another poultry (synthetic)', 'دواجن أخرى (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'supplier code SUP-POULTRY is already used: a code names one supplier, for good',
  'a code is reserved for good, in any spelling'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1118'::uuid, '01936f00-0000-7000-8000-0000000e1119'::uuid, 'SUP-OLD',
       'A new oil trader (synthetic)', 'تاجر زيوت جديد (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'supplier code SUP-OLD is already used: a code names one supplier, for good',
  'a retired supplier keeps its code'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1120'::uuid, '01936f00-0000-7000-8000-0000000e1121'::uuid, 'ZZ-ONE-NAME',
       'English only (synthetic)', '   ', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a supplier is named in both English and Arabic (PRG-014)',
  'a supplier is named in both languages'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1122'::uuid, '01936f00-0000-7000-8000-0000000e1123'::uuid, 'ZZ-BAD-VAT',
       'Bad VAT (synthetic)', 'ضريبة خاطئة (تجريبي)', '310000000000004', null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'VAT number 310000000000004 is not valid: fifteen digits, beginning and ending with 3',
  'a VAT number is fifteen digits, beginning and ending with 3'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1124'::uuid, '01936f00-0000-7000-8000-0000000e1125'::uuid, 'ZZ-BAD-CR',
       'Bad CR (synthetic)', 'سجل خاطئ (تجريبي)', null, '12345', 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'commercial registration 12345 is not valid: ten digits',
  'a commercial registration is ten digits'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1126'::uuid, '01936f00-0000-7000-8000-0000000e1127'::uuid, 'ZZ-TERMS',
       'Long terms (synthetic)', 'شروط طويلة (تجريبي)', null, null, 400, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'payment terms are 0 to 365 days',
  'payment terms are 0 to 365 days, as the warehouse kept them'
);
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1128'::uuid, '01936f00-0000-7000-8000-0000000e1129'::uuid, 'ZZ-NO-TERMS',
       'No terms (synthetic)', 'بلا شروط (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'payment terms are 0 to 365 days',
  'and are stated: never a silent default'
);
-- Native: the active-name index. Its name is what the edge reads.
select throws_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1130'::uuid, '01936f00-0000-7000-8000-0000000e1131'::uuid, 'ZZ-DUP-NAME',
       'al waha poultry (synthetic)', 'دواجن مكررة (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'duplicate key value violates unique constraint "supplier_active_name_en_key"',
  'two active suppliers cannot share a name, in any case'
);
select throws_ok(
  $$ select erp.amend_supplier('01936f00-0000-7000-8000-0000000e1132'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005301'::uuid,
       'Gulf Packaging Co. (synthetic)', 'الخليج للتغليف (تجريبي)', '310000000000103', '1010000002', 60, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-PACK has changed since it was read',
  'an amendment against a stale stamp is refused, never applied over the newer change'
);
select throws_ok(
  $$ select erp.amend_supplier('01936f00-0000-7000-8000-0000000e1133'::uuid, '01936f00-0000-7000-8000-000000005104'::uuid, '01936f00-0000-7000-8000-000000005308'::uuid,
       'Revived oil trader (synthetic)', 'تاجر زيوت عائد (تجريبي)', null, null, 30, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-OLD is retired: reinstate it before changing it',
  'a retired supplier is reinstated before it is changed'
);
select throws_ok(
  $$ select erp.change_supplier_status('01936f00-0000-7000-8000-0000000e1134'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, 'active', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-PACK is already active',
  'a status change that changes nothing records nothing'
);
select throws_ok(
  $$ select erp.change_supplier_status('01936f00-0000-7000-8000-0000000e1135'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, 'deleted', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '22023', 'a supplier is active or retired',
  'there is no deleted status'
);

-- ---------------------------------------------------------------------------
-- Contacts (SEC-008)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1136'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, null, 'call me', null, null, '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'phone number is not valid: 6 to 15 digits, optionally after +',
  'a phone number is digits'
);
select throws_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1137'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000005303'::uuid, null, null, 'not an email', null, '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'email address is not valid',
  'an email address has an @ and a domain'
);
select throws_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1138'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid, '01936f00-0000-7000-8000-000000005301'::uuid, null, null, null, null, '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-POULTRY has changed since it was read',
  'contacts are changed against the loaded stamp too'
);

-- ---------------------------------------------------------------------------
-- What a supplier sells (INV-005, I-7)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1139'::uuid, '01936f00-0000-7000-8000-0000000e1140'::uuid, '01936f00-0000-7000-8000-000000005104'::uuid, '01936f00-0000-7000-8000-000000004222'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-OLD is retired: reinstate it before changing it',
  'a retired supplier is sold nothing new'
);
-- CONTROL, I-7. The cola carton of 12 was retired when 24 replaced it.
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1141'::uuid, '01936f00-0000-7000-8000-0000000e1142'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000004209'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004209 is retired: a supplier sells an active pack (I-7)',
  'a supplier sells an active pack, never a retired one'
);
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1143'::uuid, '01936f00-0000-7000-8000-0000000e1144'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000004222'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-FRYING-OIL-OLD is retired and admits no new work',
  'nor a pack of a retired item, though the pack itself is still active'
);
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1145'::uuid, '01936f00-0000-7000-8000-0000000e1146'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid, '01936f00-0000-7000-8000-000000004203'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'supplier SUP-POULTRY already sells this conversion; retire that supply first',
  'a supplier sells one conversion once at a time'
);
-- CONTROL. Chicken breast's preferred supplier is SUP-POULTRY (by the carton).
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1147'::uuid, '01936f00-0000-7000-8000-0000000e1148'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000004201'::uuid, null, true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'this item already has a preferred supplier; make that supply not preferred first',
  'an item has at most one preferred supplier, across every pack of it'
);
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1149'::uuid, '01936f00-0000-7000-8000-0000000e1150'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-0000000e1199'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'P0002', 'no conversion 01936f00-0000-7000-8000-0000000e1199',
  'a supply names a conversion that exists'
);
select throws_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1151'::uuid, '01936f00-0000-7000-8000-0000000e1152'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23502', 'say whether this is the item''s preferred supplier',
  'whether a supply is preferred is stated, never assumed'
);
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1153'::uuid, '01936f00-0000-7000-8000-000000005201'::uuid, '01936f00-0000-7000-8000-000000005310'::uuid, 'WP-CB-10', false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005201 has changed since it was read',
  'a supply is amended against the loaded stamp'
);
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1154'::uuid, '01936f00-0000-7000-8000-000000005204'::uuid, '01936f00-0000-7000-8000-000000005315'::uuid, 'C12', true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005204 is retired for good; add a new one (I-6)',
  'a retired supply is not amended back to life'
);
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1155'::uuid, '01936f00-0000-7000-8000-000000005202'::uuid, '01936f00-0000-7000-8000-000000005312'::uuid, null, true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'this item already has a preferred supplier; make that supply not preferred first',
  'nor made a second preferred supply by amendment'
);
select throws_ok(
  $$ select erp.retire_supplier_item('01936f00-0000-7000-8000-0000000e1156'::uuid, '01936f00-0000-7000-8000-000000005204'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005204 is already retired',
  'a supply is retired once'
);

-- ---------------------------------------------------------------------------
-- Guards that bind the owner (B-11, I-6, I-7, IAM-008)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ delete from erp.supplier where supplier_id = '01936f00-0000-7000-8000-000000005103'::uuid $$,
  '23001', 'supplier SUP-LOCAL is retired, never deleted (B-11)',
  'CONTROL: not even the owner deletes a supplier'
);
select throws_ok(
  $$ update erp.supplier set code = 'SUP-RENAMED' where supplier_id = '01936f00-0000-7000-8000-000000005103'::uuid $$,
  '23001', 'supplier SUP-LOCAL: the code is fixed once the supplier exists',
  'nor changes its code'
);
select throws_ok(
  $$ truncate erp.supplier cascade $$,
  '23001', 'supplier is retired, never deleted (B-11): TRUNCATE denied',
  'nor truncates the suppliers'
);
select throws_ok(
  $$ delete from erp.supplier_item where supplier_item_id = '01936f00-0000-7000-8000-000000005202'::uuid $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005202 is retired, never deleted (B-11)',
  'nor deletes a supply'
);
select throws_ok(
  $$ update erp.supplier_item set unit_key = 'g', item_unit_id = '01936f00-0000-7000-8000-000000004202'::uuid, factor = 0.001
      where supplier_item_id = '01936f00-0000-7000-8000-000000005202'::uuid $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005202: supplier and conversion are fixed once recorded (I-7)',
  'CONTROL: nor points a supply at another pack, even a valid one'
);
select throws_ok(
  $$ update erp.supplier_item set status = 'active' where supplier_item_id = '01936f00-0000-7000-8000-000000005204'::uuid $$,
  '23001', 'supply 01936f00-0000-7000-8000-000000005204 is retired for good; add a new one (I-6)',
  'nor brings a retired supply back'
);
select throws_ok(
  $$ truncate erp.supplier_item $$,
  '23001', 'supplier_item is retired, never deleted (B-11): TRUNCATE denied',
  'nor truncates the supplies'
);
select throws_ok(
  $$ update erp.supplier_decision set reason = 'rewritten' where decision_id = '01936f00-0000-7000-8000-000000005301'::uuid $$,
  '23001', 'supplier_decision is append-only (IAM-008): UPDATE denied on supplier_decision',
  'the log is never rewritten'
);
select throws_ok(
  $$ delete from erp.supplier_decision where decision_id = '01936f00-0000-7000-8000-000000005301'::uuid $$,
  '23001', 'supplier_decision is append-only (IAM-008): DELETE denied on supplier_decision',
  'nor shortened'
);
select throws_ok(
  $$ truncate erp.supplier_decision cascade $$,
  '23001', 'supplier_decision is append-only (IAM-008): TRUNCATE denied on supplier_decision',
  'nor emptied'
);

-- ---------------------------------------------------------------------------
-- The reads (IAM-006, ADR-0012) — the warehouse manager, organisation-wide
-- ---------------------------------------------------------------------------

select is((select array_agg(code order by code) from erp.list_suppliers('01936f00-0000-7000-8000-000000000904'::uuid)),
  array['SUP-B2', 'SUP-LOCAL', 'SUP-PACK', 'SUP-POULTRY'], 'the list holds the active suppliers, in code order');
select is((select array_agg(code) from erp.list_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, 'retired')),
  array['SUP-OLD'], 'and the retired ones on request');
select is((select array_agg(code) from erp.list_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, 'active', 'الواحة')),
  array['SUP-POULTRY'], 'a supplier is found by part of its Arabic name');
select is((select array_agg(code) from erp.list_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, 'active', '٣١٠٠٠٠٠٠٠٠٠٠١٠٣')),
  array['SUP-PACK'], 'and by its VAT number, typed in Arabic digits');
select is((select array_agg(code order by code) from erp.list_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, null, null, 'SUP-LOCAL', 2)),
  array['SUP-OLD', 'SUP-PACK'], 'pages run by code');
select is((select jsonb_array_length(supplies) from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005101'::uuid)),
  2, 'a supplier is read with what it sells');
select is((select phone from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005101'::uuid)),
  '+966550000001', 'and its contacts, for a person who may read suppliers');
-- CONTROL, ADR-0012. SUP-B2 sells only brand SECOND's meal box; at BR-001 (the first
-- brand) that supply is not shown, though the supplier is.
select is((select jsonb_array_length(supplies) from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000005105'::uuid)),
  0, 'at a facility, what a supplier sells to another brand is not revealed');
select is((select jsonb_array_length(supplies) from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005105'::uuid)),
  1, 'organisation-wide, it is');
select is((select count(*)::int from erp.supplier_history('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005104'::uuid)),
  4, 'the history holds every decision about the supplier and what it sells');
select is((select array_agg(kind order by seq) from erp.supplier_history('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005104'::uuid)),
  array['supplier_created', 'supplier_amended', 'supply_added', 'supplier_status_changed'], 'in order');
select is((select array_agg(supplier_code order by preferred desc, unit_key) from erp.item_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid)),
  array['SUP-POULTRY', 'SUP-POULTRY'], 'who sells an item, preferred first');
select is((select preferred from erp.item_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid) limit 1),
  true, 'the preferred supply leads');
select throws_ok(
  $$ select * from erp.item_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000004112'::uuid) $$,
  'P0002', 'no item 01936f00-0000-7000-8000-000000004112',
  'an item of another brand answers exactly as a missing one'
);
-- The retired supplier's supply stays active: retiring a supplier stops new work through
-- the seam, and leaves what it sold alone.
select is((select status from erp.supplier_item where supplier_item_id = '01936f00-0000-7000-8000-000000005207'::uuid),
  'active', 'a retired supplier''s supplies are left as they were');
select throws_ok(
  $$ select erp.assert_supplier_active('01936f00-0000-7000-8000-000000005104'::uuid) $$,
  '23001', 'supplier SUP-OLD is retired and admits no new work',
  'and the seam refuses new work with it'
);

-- ---------------------------------------------------------------------------
-- State changes, after every fixture that reads the seed. Each is a lives_ok, so a route
-- that refuses fails a named case; db-fixtures replays them in this order and commits
-- them, which nothing after them in this file reads differently.
-- ---------------------------------------------------------------------------

-- A VAT number typed in Arabic digits with spaces is stored as fifteen ASCII digits.
select lives_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1201'::uuid, '01936f00-0000-7000-8000-0000000e1202'::uuid, 'sup-dates',
    '  Date   Farm (synthetic) ', 'مزرعة التمور (تجريبي)', '٣١٠ ٠٠٠ ٠٠٠ ٠٠٠ ٤٠٣', '١٠١٠٠٠٠٠٠٣', 15, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a supplier is created from digits typed on an Arabic keyboard'
);
select is((select (code, name_en, vat_number, cr_number)::text from erp.supplier where supplier_id = '01936f00-0000-7000-8000-0000000e1202'::uuid),
  '(SUP-DATES,"Date Farm (synthetic)",310000000000403,1010000003)', 'a supplier is stored canonical: code, name, and digits from any keyboard');

-- An amendment that changes nothing records nothing.
select lives_ok(
  $$ select erp.amend_supplier('01936f00-0000-7000-8000-0000000e1203'::uuid, '01936f00-0000-7000-8000-0000000e1202'::uuid, '01936f00-0000-7000-8000-0000000e1201'::uuid,
    'Date Farm (synthetic)', 'مزرعة التمور (تجريبي)', '310000000000403', '1010000003', 15, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'an amendment that changes nothing is accepted'
);
select is((select count(*)::int from erp.supplier_decision where supplier_id = '01936f00-0000-7000-8000-0000000e1202'::uuid),
  1, 'a form saved without a change records no decision');

-- CONTROL, SEC-008. A contact change is logged with no contact value in it, and the
-- business record carried unchanged.
select lives_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1204'::uuid, '01936f00-0000-7000-8000-0000000e1202'::uuid, '01936f00-0000-7000-8000-0000000e1201'::uuid,
    ' Sales Desk (synthetic) ', '+966 55 000 0003', 'Sales@Dates.Example.Test', 'Synthetic farm road', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'contacts are set'
);
select is((select (contact_person, phone, email)::text from erp.supplier where supplier_id = '01936f00-0000-7000-8000-0000000e1202'::uuid),
  '("Sales Desk (synthetic)",+966550000003,sales@dates.example.test)', 'contacts are stored canonical');
select is((select kind from erp.supplier_decision where decision_id = '01936f00-0000-7000-8000-0000000e1204'::uuid),
  'supplier_contact_changed', 'the change is recorded: who, when and why');
select is((select count(*)::int from erp.supplier_decision d
            where d.decision_id = '01936f00-0000-7000-8000-0000000e1204'::uuid
              and strpos(row_to_json(d)::text, '550000003') + strpos(lower(row_to_json(d)::text), 'sales desk')
                + strpos(lower(row_to_json(d)::text), 'farm road') > 0),
  0, 'and no contact value is anywhere in it');
select is((select reason from erp.supplier_decision where decision_id = '01936f00-0000-7000-8000-0000000e1204'::uuid),
  'Contact details changed.', 'CONTROL: its reason is fixed text, so nobody can type a contact into the log');

-- Erasure works on a retired supplier: it does not wait for a reinstatement.
select lives_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1205'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid, '01936f00-0000-7000-8000-000000005302'::uuid,
    null, null, null, null, '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'contacts are erased on request'
);
select is((select num_nonnulls(contact_person, phone, email, address) from erp.supplier where supplier_id = '01936f00-0000-7000-8000-000000005101'::uuid),
  0, 'an erasure clears every contact field');
select is((select reason from erp.supplier_decision where decision_id = '01936f00-0000-7000-8000-0000000e1205'::uuid),
  'Contact details erased.', 'and the log says it was an erasure, and nothing else');
select lives_ok(
  $$ select erp.change_supplier_status('01936f00-0000-7000-8000-0000000e1206'::uuid, '01936f00-0000-7000-8000-0000000e1202'::uuid, '01936f00-0000-7000-8000-0000000e1204'::uuid,
    'retired', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a supplier is retired'
);
select lives_ok(
  $$ select erp.set_supplier_contact('01936f00-0000-7000-8000-0000000e1207'::uuid, '01936f00-0000-7000-8000-0000000e1202'::uuid, '01936f00-0000-7000-8000-0000000e1206'::uuid,
    null, null, null, null, '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'and its contacts erased while it is retired'
);
select is((select (status, num_nonnulls(contact_person, phone, email, address))::text from erp.supplier where supplier_id = '01936f00-0000-7000-8000-0000000e1202'::uuid),
  '(retired,0)', 'and it works on a retired supplier too');

-- A supply: added, amended to preferred once the old preferred one steps down, retired.
select lives_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1208'::uuid, '01936f00-0000-7000-8000-0000000e1209'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid,
    '01936f00-0000-7000-8000-000000004213'::uuid, ' GP-MB-50 ', false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a supply is added'
);
select is((select (item_id, unit_key, factor, supplier_code)::text from erp.supplier_item where supplier_item_id = '01936f00-0000-7000-8000-0000000e1209'::uuid),
  '(01936f00-0000-7000-8000-000000004104,pack,50,GP-MB-50)', 'a supply copies its conversion whole');
select lives_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1210'::uuid, '01936f00-0000-7000-8000-000000005203'::uuid, '01936f00-0000-7000-8000-000000005313'::uuid,
    'GP-MB-M', false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'the old preferred supply steps down'
);
select lives_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1211'::uuid, '01936f00-0000-7000-8000-0000000e1209'::uuid, '01936f00-0000-7000-8000-0000000e1208'::uuid,
    'GP-MB-50', true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'and the new one becomes preferred'
);
select is((select array_agg(supplier_item_id) from erp.supplier_item where item_id = '01936f00-0000-7000-8000-000000004104'::uuid and preferred and status = 'active'),
  array['01936f00-0000-7000-8000-0000000e1209'::uuid], 'the preferred supplier moves in two decisions, never two at once');
select lives_ok(
  $$ select erp.retire_supplier_item('01936f00-0000-7000-8000-0000000e1212'::uuid, '01936f00-0000-7000-8000-0000000e1209'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a supply is retired'
);
select is((select status from erp.supplier_item where supplier_item_id = '01936f00-0000-7000-8000-0000000e1209'::uuid),
  'retired', 'a supply is retired');

-- Import: one new supplier, two existing suppliers amended (one in its record and its
-- contacts both), one unchanged. A lives_ok, so a refused file fails a named case.
select lives_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing: opening list', now(),
  '[{"line": "2", "code": "SUP-SPICE", "name_en": "Spice House (synthetic)", "name_ar": "دار البهارات (تجريبي)", "payment_terms_days": "٣٠",
     "phone": "+966550000004", "decision_id": "01936f00-0000-7000-8000-0000000e1213", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1214", "supplier_id": "01936f00-0000-7000-8000-0000000e1215"},
    {"line": "3", "code": "sup-local", "name_en": "Corner Grocer (synthetic)", "name_ar": "بقالة الزاوية (تجريبي)", "payment_terms_days": "7",
     "decision_id": "01936f00-0000-7000-8000-0000000e1216", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1217"},
    {"line": "4", "code": "SUP-B2", "name_en": "Second Brand Boxes (synthetic)", "name_ar": "علب العلامة الثانية (تجريبي)", "vat_number": "310000000000303", "payment_terms_days": "30",
     "decision_id": "01936f00-0000-7000-8000-0000000e1218", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1219"},
    {"line": "5", "code": "SUP-PACK", "name_en": "Gulf Packaging (synthetic)", "name_ar": "الخليج للتغليف (تجريبي)", "vat_number": "310000000000103", "cr_number": "1010000002",
     "payment_terms_days": "75", "email": "orders@pack.example.test",
     "decision_id": "01936f00-0000-7000-8000-0000000e1230", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1231"}]'::jsonb) $$,
  'an import creates, amends and leaves alone, matching by code'
);
-- Sent again, it finds nothing to do: the same rows match by code, so a file re-sent
-- after a lost answer creates nothing twice.
select is(erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing: sent again', now(),
  '[{"line": "2", "code": "SUP-SPICE", "name_en": "Spice House (synthetic)", "name_ar": "دار البهارات (تجريبي)", "payment_terms_days": "٣٠",
     "phone": "+966550000004", "decision_id": "01936f00-0000-7000-8000-0000000e1213", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1214", "supplier_id": "01936f00-0000-7000-8000-0000000e1215"},
    {"line": "3", "code": "sup-local", "name_en": "Corner Grocer (synthetic)", "name_ar": "بقالة الزاوية (تجريبي)", "payment_terms_days": "7",
     "decision_id": "01936f00-0000-7000-8000-0000000e1216", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1217"},
    {"line": "4", "code": "SUP-B2", "name_en": "Second Brand Boxes (synthetic)", "name_ar": "علب العلامة الثانية (تجريبي)", "vat_number": "310000000000303", "payment_terms_days": "30",
     "decision_id": "01936f00-0000-7000-8000-0000000e1218", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1219"},
    {"line": "5", "code": "SUP-PACK", "name_en": "Gulf Packaging (synthetic)", "name_ar": "الخليج للتغليف (تجريبي)", "vat_number": "310000000000103", "cr_number": "1010000002",
     "payment_terms_days": "75", "email": "orders@pack.example.test",
     "decision_id": "01936f00-0000-7000-8000-0000000e1230", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1231"}]'::jsonb),
  '{"amended": 0, "created": 0, "unchanged": 4}'::jsonb, 'a file sent again changes nothing');
select is((select (payment_terms_days, phone)::text from erp.supplier where code = 'SUP-SPICE'),
  '(30,+966550000004)', 'a new supplier from the file has its contacts set, and terms typed in Arabic digits read');
-- The record and the contacts both changed: two decisions, the second against the
-- stamp the first left (the import re-reads it between them).
select is((select (payment_terms_days, email, as_of_decision_id)::text from erp.supplier where code = 'SUP-PACK'),
  '(75,orders@pack.example.test,01936f00-0000-7000-8000-0000000e1231)', 'an existing supplier''s record and contacts both change in one row');
-- CONTROL. One bad line refuses the whole file, and each failing line is named.
select throws_ok(
  $$ select erp.import_suppliers('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(),
       '[{"line": "2", "code": "SUP-NEW", "name_en": "New (synthetic)", "name_ar": "جديد (تجريبي)", "payment_terms_days": "30",
          "decision_id": "01936f00-0000-7000-8000-0000000e1220", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1221", "supplier_id": "01936f00-0000-7000-8000-0000000e1222"},
         {"line": "3", "code": "SUP-BAD", "name_en": "Bad (synthetic)", "name_ar": "سيئ (تجريبي)", "payment_terms_days": "thirty",
          "decision_id": "01936f00-0000-7000-8000-0000000e1223", "contact_decision_id": "01936f00-0000-7000-8000-0000000e1224", "supplier_id": "01936f00-0000-7000-8000-0000000e1225"}]'::jsonb) $$,
  '22023', 'supplier import refused: 1 line(s) failed and nothing was saved',
  'a file with a bad line saves nothing'
);
select is((select count(*)::int from erp.supplier where code = 'SUP-NEW'), 0, 'not even its good lines');

-- Digits pasted from right-to-left text carry invisible marks; they are dropped.
select is(erp.normalise_digits(E'\u200e310\u00a0000 000\u066c000 103\u200f'), '310000000000103',
  'direction marks, no-break spaces and the Arabic thousands separator are dropped from digits');

-- At a facility, a supplier's history leaves out what it sells to another brand.
select is((select count(*)::int from erp.supplier_history('01936f00-0000-7000-8000-000000000904'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000005105'::uuid)),
  1, 'at a facility, the history of a supplier hides its supplies to another brand');
select is((select count(*)::int from erp.supplier_history('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005105'::uuid)),
  2, 'organisation-wide, it shows them');

-- A retired supplier keeps an item's preferred slot only until it gives it up, and a
-- purchase order form is offered live suppliers first.
select lives_ok(
  $$ select erp.change_supplier_status('01936f00-0000-7000-8000-0000000e1240'::uuid, '01936f00-0000-7000-8000-000000005101'::uuid, '01936f00-0000-7000-8000-0000000e1205'::uuid,
    'retired', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'the preferred supplier of chicken breast is retired'
);
select lives_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1241'::uuid, '01936f00-0000-7000-8000-0000000e1242'::uuid, '01936f00-0000-7000-8000-000000005102'::uuid,
    '01936f00-0000-7000-8000-000000004203'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'another supplier is added for the same carton'
);
select is((select supplier_code from erp.item_suppliers('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid) limit 1),
  'SUP-PACK', 'CONTROL: a live supplier is offered before a retired one, even its preferred one');
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1243'::uuid, '01936f00-0000-7000-8000-000000005201'::uuid, '01936f00-0000-7000-8000-000000005311'::uuid,
       'WP-CB-10-NEW', true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'supplier SUP-POULTRY is retired: reinstate it before changing it',
  'a retired supplier''s supply is not otherwise changed'
);
select lives_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1244'::uuid, '01936f00-0000-7000-8000-000000005201'::uuid, '01936f00-0000-7000-8000-000000005311'::uuid,
       'WP-CB-10', false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'CONTROL: but it can give up the preferred slot'
);
select lives_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1245'::uuid, '01936f00-0000-7000-8000-0000000e1242'::uuid, '01936f00-0000-7000-8000-0000000e1241'::uuid,
       null, true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'so the live supplier can take it'
);

-- A supply on a retired pack stays 'active' itself; the reads say the pack is retired,
-- and it cannot be made preferred.
select lives_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1246'::uuid, '01936f00-0000-7000-8000-0000000e1247'::uuid, '01936f00-0000-7000-8000-000000005103'::uuid,
       '01936f00-0000-7000-8000-000000004202'::uuid, null, false, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now());
     select erp.retire_item_unit('01936f00-0000-7000-8000-0000000e1248'::uuid, '01936f00-0000-7000-8000-000000004202'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a supply is added for grams, and then the gram conversion is retired'
);
select is((select s ->> 'conversion_status' from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005103'::uuid) g,
                  jsonb_array_elements(g.supplies) s
            where s ->> 'supplier_item_id' = '01936f00-0000-7000-8000-0000000e1247'),
  'retired', 'the read shows the supply''s pack is retired');
select throws_ok(
  $$ select erp.amend_supplier_item('01936f00-0000-7000-8000-0000000e1249'::uuid, '01936f00-0000-7000-8000-0000000e1247'::uuid, '01936f00-0000-7000-8000-0000000e1246'::uuid,
       null, true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004202 is retired: a supplier sells an active pack (I-7)',
  'a supply on a retired pack is never made preferred'
);

-- What a supplier sells names items, so it is shown only to someone who may read items
-- (found in review). Plain statements, so db-fixtures never commits them; the
-- suite's rollback undoes them.
select erp.decide_capability('01936f00-0000-7000-8000-0000000e1250'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
select is((select supplies from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005102'::uuid)),
  null, 'CONTROL: while items are hidden, a supplier is read without its supplies (CAP-P02)');
select is((select count(*)::int from erp.supplier_history('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005104'::uuid)),
  3, 'and its history without its supply decisions');
select erp.decide_capability('01936f00-0000-7000-8000-0000000e1251'::uuid, 'inventory.items', null, 'pilot', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
delete from erp.role_permission where role_key = 'accountant' and capability_key = 'inventory.items';
select is((select supplies from erp.get_supplier('01936f00-0000-7000-8000-000000000907'::uuid, null, '01936f00-0000-7000-8000-000000005102'::uuid)),
  null, 'CONTROL: and so it is for a person who may read suppliers but not items (IAM-003)');
select isnt((select supplies from erp.get_supplier('01936f00-0000-7000-8000-000000000904'::uuid, null, '01936f00-0000-7000-8000-000000005102'::uuid)),
  null, 'while a person who may read both sees them');

-- I-8: every supplier and supply equals the latest decision about it, after all of this.
select is_empty(
  $$ select 'supplier ' || s.code from erp.supplier s
     left join erp.supplier_decision d on d.decision_id = s.as_of_decision_id
     where d.decision_id is null
        or (d.code, d.name_en, d.name_ar, d.vat_number, d.cr_number, d.payment_terms_days, d.status)
           is distinct from (s.code, s.name_en, s.name_ar, s.vat_number, s.cr_number, s.payment_terms_days, s.status)
        or exists (select 1 from erp.supplier_decision l where l.supplier_id = s.supplier_id and l.supplier_item_id is null and l.seq > d.seq)
     union all
     select 'supply ' || x.supplier_item_id from erp.supplier_item x
     left join erp.supplier_decision d on d.decision_id = x.as_of_decision_id
     where d.decision_id is null
        or (d.supplier_id, d.item_unit_id, d.unit_key, d.factor, d.supplier_code, d.preferred, d.status)
           is distinct from (x.supplier_id, x.item_unit_id, x.unit_key, x.factor, x.supplier_code, x.preferred, x.status)
        or exists (select 1 from erp.supplier_decision l where l.supplier_item_id = x.supplier_item_id and l.seq > d.seq) $$,
  'every supplier and supply equals the latest decision about it (I-8)'
);

-- ---------------------------------------------------------------------------
-- LAST — the only fixtures that commit under db-fixtures
-- ---------------------------------------------------------------------------

-- Fresh ids, touching nothing an earlier fixture reads: a supplier, and what it sells.
select lives_ok(
  $$ select erp.create_supplier('01936f00-0000-7000-8000-0000000e1226'::uuid, '01936f00-0000-7000-8000-0000000e1227'::uuid, 'SUP-OILS',
       'Oil Mill (synthetic)', 'معصرة الزيوت (تجريبي)', '310000000000503', null, 45, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'an open, permitted create works'
);
select lives_ok(
  $$ select erp.add_supplier_item('01936f00-0000-7000-8000-0000000e1228'::uuid, '01936f00-0000-7000-8000-0000000e1229'::uuid, '01936f00-0000-7000-8000-0000000e1227'::uuid,
       '01936f00-0000-7000-8000-000000004224'::uuid, null, true, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'and the new supplier can sell an active pack, as the item''s first preferred supplier'
);
select is((select count(*)::int from erp.supplier_decision where supplier_id = '01936f00-0000-7000-8000-0000000e1227'::uuid),
  2, 'every step was recorded');

select * from finish();
rollback;
