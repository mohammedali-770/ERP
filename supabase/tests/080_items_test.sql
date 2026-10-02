-- pgTAP · items and units, proved by being refused by them
--
-- 0012 is the first Phase 4 module, and every later table copies its conventions, so
-- this suite proves each rule by colliding with it. Cases marked CONTROL are why the
-- suite exists: if one passes without its mechanism, the mechanism is decoration. The
-- message is asserted wherever another refusal shares the SQLSTATE — 23001 is raised by
-- the capability gate, the permission check and half the rules below.
--
-- ORDER MATTERS, as in 060 and 070:
--   * throws_ok and lives_ok bodies are replayed alone by tools/db-fixtures against the
--     seed, so none may depend on a plain statement earlier in this file;
--   * plain statements that change state (the read_only round trip, the derived g, the
--     amendment and the imports) come after every throws_ok that relies on the seeded
--     state;
--   * the two lives_ok that COMMIT under db-fixtures are last, with fresh ids, touching
--     nothing an earlier fixture reads. Committed rows cannot be reset: the log is
--     append-only and items are never deleted.
--
-- Fixture ids are …0e08NN and …0e09NN, so tools/db-fixtures recognises them.

begin;
select plan(95);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'unit', 'erp.unit exists');
select has_table('erp', 'item', 'erp.item exists');
select has_table('erp', 'item_unit', 'erp.item_unit exists');
select has_table('erp', 'item_decision', 'erp.item_decision exists');
select has_column('erp', 'item',      'as_of_decision_id', 'an item carries the decision behind it (I-8)');
select has_column('erp', 'item_unit', 'as_of_decision_id', 'a conversion carries the decision behind it (I-8)');
select col_is_fk('erp', 'item_decision', 'actor_id', 'every item decision names a person');
-- Deliberately NOT a foreign key: the decision is written before the row it creates.
-- Asserted so that adding one is a decision someone takes on purpose.
select col_isnt_fk('erp', 'item_decision', 'item_id', 'the log does not reference the item it creates');

-- ---------------------------------------------------------------------------
-- The seam and the partial indexes
-- ---------------------------------------------------------------------------

-- THE I-7 SEAM. Every later quantity-bearing row references these four columns together.
select col_is_unique('erp', 'item_unit', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
  'the conversion seam is a unique key later rows can reference');
select col_is_unique('erp', 'item', array['code']::name[], 'a code names one item, retired items included');
select ok((select indpred is not null from pg_index where indexrelid = 'erp.ux_item_active_name_en'::regclass),
  'English names are unique among ACTIVE items only, so a retired item frees its name');
select ok((select indpred is not null from pg_index where indexrelid = 'erp.ux_item_active_name_ar'::regclass),
  'and so are Arabic names');
select ok((select indpred is not null from pg_index where indexrelid = 'erp.ux_item_unit_one_active'::regclass),
  'a unit word means one thing per item among ACTIVE conversions only');

-- ---------------------------------------------------------------------------
-- Privilege facts — what the runtime cannot do at all
-- ---------------------------------------------------------------------------

-- Facts rather than role-switch collisions, for 060's reason: db-fixtures replays each
-- body alone, where a `set local role` would be missing.
select is(has_table_privilege('erp_app', 'erp.item', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'the runtime holds no privilege of any kind on erp.item, so hidden hides the data');
select is(has_table_privilege('erp_app', 'erp.item_unit', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'the runtime holds no privilege of any kind on erp.item_unit, so hidden hides the data');
select is(has_table_privilege('erp_app', 'erp.item_decision', 'SELECT,INSERT,UPDATE,DELETE'), false,
  'the runtime holds no privilege of any kind on erp.item_decision, so hidden hides the data');
select is(has_table_privilege('erp_app', 'erp.unit', 'INSERT,UPDATE,DELETE'), false,
  'the unit register changes by migration only');
select is(has_function_privilege('erp_read', 'erp.create_item(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE'), false,
  'the reporting role cannot create an item');
select is(has_function_privilege('erp_app', 'erp.assert_item_active(uuid,text[])', 'EXECUTE'), false,
  'the seams are for later modules'' own definer routes, not the runtime');
select is(has_function_privilege('erp_app', 'erp.active_item_unit(uuid,text)', 'EXECUTE'), false,
  'nor the conversion seam');
-- The controls for the facts above: the same functions return true where a grant exists.
select ok(has_table_privilege('erp_app', 'erp.unit', 'SELECT'), 'the runtime reads the unit vocabulary');
select ok(has_function_privilege('erp_app', 'erp.create_item(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE'), 'the runtime may call the admitted route');
select ok(has_table_privilege('erp_read', 'erp.item', 'SELECT'), 'the reporting role still reads items');

-- ---------------------------------------------------------------------------
-- The capability gate (CAP-P02, CAP-P04, CAP-P06) and permission (IAM-003, IAM-006)
-- ---------------------------------------------------------------------------

-- CONTROL, the left half. Hidden refuses even the administrator. No capability edge
-- points at inventory.items in the seed, so a CAP-P07 refusal cannot pass for this one.
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e0801'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.create_item('01936f00-0000-7000-8000-0000000e0802'::uuid, '01936f00-0000-7000-8000-0000000e0803'::uuid, '01936f00-0000-7000-8000-0000000e0804'::uuid, '01936f00-0000-7000-8000-0000000e0805'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-HIDDEN', 'packaging', 'piece',
       'Hidden lid (synthetic)', 'غطاء مخفي (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'capability inventory.items is hidden for this scope and does not admit new work (CAP-P04)',
  'a hidden capability refuses new work, even to the administrator'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e0806'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.list_items('01936f00-0000-7000-8000-000000000900'::uuid) $$,
  '23001', 'capability inventory.items is hidden for this scope (CAP-P02)',
  'and hidden hides the data, not only the menu'
);
-- CONTROL, the right half. The warehouse manager reads items organisation-wide and holds
-- no write.
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0814'::uuid, '01936f00-0000-7000-8000-0000000e0815'::uuid, '01936f00-0000-7000-8000-0000000e0816'::uuid, '01936f00-0000-7000-8000-0000000e0817'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-NOPE', 'packaging', 'piece',
       'Nope lid (synthetic)', 'غطاء مرفوض (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability inventory.items here (IAM-003)',
  'an open capability grants nobody the right to write'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e0807'::uuid, 'inventory.items', null, 'read_only', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.create_item('01936f00-0000-7000-8000-0000000e0818'::uuid, '01936f00-0000-7000-8000-0000000e0819'::uuid, '01936f00-0000-7000-8000-0000000e0820'::uuid, '01936f00-0000-7000-8000-0000000e0821'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-RO', 'packaging', 'piece',
       'Read only lid (synthetic)', 'غطاء للقراءة (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'capability inventory.items is read_only for this scope and does not admit new work (CAP-P04)',
  'read_only refuses new work'
);
select throws_ok(
  $$ select * from erp.list_items('01936f00-0000-7000-8000-000000000901'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability inventory.items here (IAM-003)',
  'a branch worker cannot read organisation-wide'
);
select throws_ok(
  $$ select * from erp.list_items('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000402'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability inventory.items here (IAM-003)',
  'nor at a branch that is not theirs (IAM-006)'
);

-- ---------------------------------------------------------------------------
-- Brand-private reads (ADR-0012) and paging
-- ---------------------------------------------------------------------------

select is((select count(*) from erp.list_items('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid) where code = 'B2-PKG-MEAL-BOX-M'), 0::bigint,
  'at their own branch, a branch worker sees none of another brand''s items');
select is((select count(*) from erp.list_items('01936f00-0000-7000-8000-000000000900'::uuid) where code = 'B2-PKG-MEAL-BOX-M'), 1::bigint,
  'the control: the organisation-wide administrator does see it');
select throws_ok(
  $$ select * from erp.get_item('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000004112'::uuid) $$,
  'P0002', 'no item 01936f00-0000-7000-8000-000000004112',
  'another brand''s item answers exactly as a missing one'
);
select throws_ok(
  $$ select * from erp.list_items('01936f00-0000-7000-8000-000000000900'::uuid, null, null, 'active', null, null, null, 501) $$,
  '22023', 'a page holds 1 to 500 items',
  'a page is bounded — the warehouse loaded every list unpaged'
);
select is(array(select code from erp.list_items('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000000201'::uuid, 'active', null, null, 'PK-MEAL-BOX-M', 3)),
  array['RM-CHK-BREAST', 'RM-FRYING-OIL', 'RM-RICE'],
  'keyset paging in C collation, retired items excluded');

-- ---------------------------------------------------------------------------
-- Codes, names, kinds (INV-002, PRG-014)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0822'::uuid, '01936f00-0000-7000-8000-0000000e0823'::uuid, '01936f00-0000-7000-8000-0000000e0824'::uuid, '01936f00-0000-7000-8000-0000000e0825'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, ' rm-chk-breast ', 'packaging', 'piece',
       'Breast twin (synthetic)', 'توأم الصدر (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'item code RM-CHK-BREAST is already used: a code names one item, for good (INV-002)',
  'CONTROL: a code is canonical — trimmed and upper-cased — and names one item'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0826'::uuid, '01936f00-0000-7000-8000-0000000e0827'::uuid, '01936f00-0000-7000-8000-0000000e0828'::uuid, '01936f00-0000-7000-8000-0000000e0829'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'fp-cola-٣٣٠', 'packaging', 'piece',
       'Cola twin (synthetic)', 'توأم الكولا (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'item code FP-COLA-330 is already used: a code names one item, for good (INV-002)',
  'Arabic-Indic digits typed on an Arabic keyboard are folded'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0830'::uuid, '01936f00-0000-7000-8000-0000000e0831'::uuid, '01936f00-0000-7000-8000-0000000e0832'::uuid, '01936f00-0000-7000-8000-0000000e0833'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'RM-FRYING-OIL-OLD', 'packaging', 'piece',
       'Oil twin (synthetic)', 'توأم الزيت (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'item code RM-FRYING-OIL-OLD is already used: a code names one item, for good (INV-002)',
  'a retired item keeps its code for good'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0834'::uuid, '01936f00-0000-7000-8000-0000000e0835'::uuid, '01936f00-0000-7000-8000-0000000e0836'::uuid, '01936f00-0000-7000-8000-0000000e0837'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'RM CHK', 'packaging', 'piece',
       'Space code (synthetic)', 'رمز بمسافة (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'item code RM CHK is not valid: 1 to 24 characters of A-Z, 0-9, ".", "_" or "-", beginning with a letter or digit',
  'a code holds no space'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0838'::uuid, '01936f00-0000-7000-8000-0000000e0839'::uuid, '01936f00-0000-7000-8000-0000000e0840'::uuid, '01936f00-0000-7000-8000-0000000e0841'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'صنف-1', 'packaging', 'piece',
       'Arabic code (synthetic)', 'رمز عربي (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'item code صنف-1 is not valid: 1 to 24 characters of A-Z, 0-9, ".", "_" or "-", beginning with a letter or digit',
  'nor letters a scanner or a lot code cannot carry'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0842'::uuid, '01936f00-0000-7000-8000-0000000e0843'::uuid, '01936f00-0000-7000-8000-0000000e0844'::uuid, '01936f00-0000-7000-8000-0000000e0845'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-NOAR', 'packaging', 'piece',
       'No Arabic (synthetic)', '   ', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'an item is named in both English and Arabic (PRG-014)',
  'an item is named in both languages'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0846'::uuid, '01936f00-0000-7000-8000-0000000e0847'::uuid, '01936f00-0000-7000-8000-0000000e0848'::uuid, '01936f00-0000-7000-8000-0000000e0849'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-HALF', 'packaging', 'piece',
       'Half described (synthetic)', 'نصف موصوف (تجريبي)', 'Only in English', null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'new row for relation "item" violates check constraint "item_description_is_bilingual"',
  'descriptions come in pairs, or not at all'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0850'::uuid, '01936f00-0000-7000-8000-0000000e0851'::uuid, '01936f00-0000-7000-8000-0000000e0852'::uuid, '01936f00-0000-7000-8000-0000000e0853'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-KIND', 'raw_material', 'piece',
       'Wrong kind (synthetic)', 'نوع خاطئ (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'raw_material is not an item kind (INV-002)',
  'the warehouse''s word is not a kind: raw materials are items of kind raw_ingredient'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0854'::uuid, '01936f00-0000-7000-8000-0000000e0855'::uuid, '01936f00-0000-7000-8000-0000000e0856'::uuid, '01936f00-0000-7000-8000-0000000e0857'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-UNIT', 'packaging', 'kilo',
       'Wrong unit (synthetic)', 'وحدة خاطئة (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23503', 'unit kilo is not in the register (INV-005)',
  'a unit is from the register, never free text'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0858'::uuid, '01936f00-0000-7000-8000-0000000e0859'::uuid, '01936f00-0000-7000-8000-0000000e0860'::uuid, '01936f00-0000-7000-8000-0000000e0861'::uuid, '01936f00-0000-7000-8000-0000000e0899'::uuid, 'ZZ-BRAND', 'packaging', 'piece',
       'Wrong brand (synthetic)', 'علامة خاطئة (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23503', 'brand 01936f00-0000-7000-8000-0000000e0899 does not exist (ADR-0012)',
  'and a brand is one that exists'
);
select throws_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0862'::uuid, '01936f00-0000-7000-8000-0000000e0863'::uuid, '01936f00-0000-7000-8000-0000000e0864'::uuid, '01936f00-0000-7000-8000-0000000e0865'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-DUP', 'packaging', 'piece',
       'meal box MEDIUM (synthetic)', 'علبة مكررة (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'duplicate key value violates unique constraint "ux_item_active_name_en"',
  'CONTROL: two active items of one brand cannot share a name, whatever its case'
);

-- ---------------------------------------------------------------------------
-- Fixed identity, retired-never-deleted, concurrency (INV-002, B-11)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update erp.item set item_kind = 'packaging' where code = 'RM-CHK-BREAST' $$,
  '23001', 'item RM-CHK-BREAST: code, kind, base unit and brand are fixed once the item exists (INV-002, INV-005)',
  'CONTROL: an item''s item_kind is fixed, even for the owner'
);
select throws_ok(
  $$ update erp.item set base_unit_key = 'g' where code = 'RM-CHK-BREAST' $$,
  '23001', 'item RM-CHK-BREAST: code, kind, base unit and brand are fixed once the item exists (INV-002, INV-005)',
  'CONTROL: an item''s base_unit_key is fixed, even for the owner'
);
select throws_ok(
  $$ update erp.item set code = 'RM-X' where code = 'RM-CHK-BREAST' $$,
  '23001', 'item RM-CHK-BREAST: code, kind, base unit and brand are fixed once the item exists (INV-002, INV-005)',
  'CONTROL: an item''s code is fixed, even for the owner'
);
select throws_ok(
  $$ update erp.item set brand_id = '01936f00-0000-7000-8000-000000000202'::uuid where code = 'RM-CHK-BREAST' $$,
  '23001', 'item RM-CHK-BREAST: code, kind, base unit and brand are fixed once the item exists (INV-002, INV-005)',
  'CONTROL: an item''s brand_id is fixed, even for the owner'
);
select throws_ok(
  $$ delete from erp.item where code = 'SP-FRYER-GASKET' $$,
  '23001', 'item SP-FRYER-GASKET is retired, never deleted (B-11)',
  'CONTROL: an item is retired, never deleted'
);
select throws_ok(
  $$ select erp.amend_item('01936f00-0000-7000-8000-0000000e0866'::uuid, '01936f00-0000-7000-8000-000000004111'::uuid, '01936f00-0000-7000-8000-000000004321'::uuid, 'Rice (synthetic)', 'أرز (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-RICE has changed since it was read',
  'an edit made from a stale form is refused, not silently last-writer-wins'
);
select throws_ok(
  $$ select erp.amend_item('01936f00-0000-7000-8000-0000000e0867'::uuid, '01936f00-0000-7000-8000-000000004109'::uuid, '01936f00-0000-7000-8000-000000004341'::uuid, 'Old oil (synthetic)', 'زيت قديم (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-FRYING-OIL-OLD is retired: reinstate it before changing it',
  'a retired item is frozen'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0868'::uuid, '01936f00-0000-7000-8000-0000000e0869'::uuid, '01936f00-0000-7000-8000-000000004109'::uuid, 'ml', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-FRYING-OIL-OLD is retired: reinstate it before changing it',
  'including its conversions'
);
select throws_ok(
  $$ select erp.change_item_status('01936f00-0000-7000-8000-0000000e0870'::uuid, '01936f00-0000-7000-8000-000000004109'::uuid, '01936f00-0000-7000-8000-000000004341'::uuid, 'deleted', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '22023', 'an item is active or retired',
  'there is no deleted status'
);
select throws_ok(
  $$ select erp.change_item_status('01936f00-0000-7000-8000-0000000e0871'::uuid, '01936f00-0000-7000-8000-000000004109'::uuid, '01936f00-0000-7000-8000-000000004341'::uuid, 'retired', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-FRYING-OIL-OLD is already retired',
  'a no-op is not a decision'
);
select throws_ok(
  $$ select erp.change_item_status('01936f00-0000-7000-8000-0000000e0872'::uuid, '01936f00-0000-7000-8000-000000004109'::uuid, '01936f00-0000-7000-8000-000000004341'::uuid, 'active', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'duplicate key value violates unique constraint "ux_item_active_name_en"',
  'reinstating is refused while another active item holds the name'
);

-- ---------------------------------------------------------------------------
-- Conversions (INV-005, I-7)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select * from erp.active_item_unit('01936f00-0000-7000-8000-000000004107'::uuid, 'carton') $$,
  'P0002', 'item EQ-FRYER-BASKET has no active conversion for unit carton (INV-005)',
  'CONTROL: a missing conversion is never taken to be 1'
);
select is((select item_unit_id from erp.active_item_unit('01936f00-0000-7000-8000-000000004101'::uuid, 'kg')), '01936f00-0000-7000-8000-000000004201'::uuid,
  'the base unit resolves like any other conversion');
select is((select factor from erp.active_item_unit('01936f00-0000-7000-8000-000000004101'::uuid, 'kg')), 1::numeric, 'at factor 1');
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0873'::uuid, '01936f00-0000-7000-8000-0000000e0874'::uuid, '01936f00-0000-7000-8000-000000004111'::uuid, 'g', 0.002, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'one g of RM-RICE is 0.001 kg, not 0.002 (INV-005)',
  'CONTROL: a unit in the base''s dimension cannot contradict it'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0875'::uuid, '01936f00-0000-7000-8000-0000000e0876'::uuid, '01936f00-0000-7000-8000-000000004102'::uuid, 'g', 0.009, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'one g of SF-CHK-STRIPS is 0.008 piece, not 0.009 (INV-005)',
  'CONTROL: nor contradict a cross-dimension anchor (1 kg = 8 piece)'
);
select throws_ok(
  $$ insert into erp.item_unit (item_unit_id, item_id, unit_key, factor, status, as_of_decision_id)
     values ('01936f00-0000-7000-8000-0000000e0877'::uuid, '01936f00-0000-7000-8000-000000004111'::uuid, 'g', 0.002, 'active', '01936f00-0000-7000-8000-000000004322'::uuid) $$,
  '23514', 'one g of RM-RICE is 0.001 kg, not 0.002 (INV-005)',
  'the dimension rule binds the owner too, not only the route'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0878'::uuid, '01936f00-0000-7000-8000-0000000e0879'::uuid, '01936f00-0000-7000-8000-000000004104'::uuid, 'bag', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'the size of one bag of PK-MEAL-BOX-M in piece must be stated (INV-005)',
  'a pack''s size is stated, never assumed'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0880'::uuid, '01936f00-0000-7000-8000-0000000e0881'::uuid, '01936f00-0000-7000-8000-000000004104'::uuid, 'case', 0.1234567, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a conversion factor is above 0, at most 1000000000, with at most six decimal places (INV-005)',
  'a factor is refused, not rounded, past six decimal places'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0882'::uuid, '01936f00-0000-7000-8000-0000000e0883'::uuid, '01936f00-0000-7000-8000-000000004104'::uuid, 'case', 0, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a conversion factor is above 0, at most 1000000000, with at most six decimal places (INV-005)',
  'and is above zero'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0884'::uuid, '01936f00-0000-7000-8000-0000000e0885'::uuid, '01936f00-0000-7000-8000-000000004101'::uuid, 'kg', 1, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'kg is the base unit of RM-CHK-BREAST and converts at 1 (INV-005)',
  'the base cannot be declared twice'
);
select throws_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0886'::uuid, '01936f00-0000-7000-8000-0000000e0887'::uuid, '01936f00-0000-7000-8000-000000004103'::uuid, 'carton', 12, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item FP-COLA-330 already has an active conversion for carton; retire it first, so carton never means two things at once (INV-005)',
  'a unit word means one thing per item at a time'
);
select throws_ok(
  $$ update erp.item_unit set factor = 12 where item_unit_id = '01936f00-0000-7000-8000-000000004210'::uuid $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004210: item, unit and factor are fixed once recorded (INV-005, I-7)',
  'CONTROL: a conversion is immutable, even for the owner — the warehouse''s ratio was editable'
);
select throws_ok(
  $$ update erp.item_unit set status = 'active' where item_unit_id = '01936f00-0000-7000-8000-000000004209'::uuid $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004209 is retired for good; add a new one (I-6)',
  'retirement is final'
);
select throws_ok(
  $$ select erp.retire_item_unit('01936f00-0000-7000-8000-0000000e0888'::uuid, '01936f00-0000-7000-8000-000000004201'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'the base unit of an item is never retired (INV-005)',
  'the base unit never goes'
);
select throws_ok(
  $$ delete from erp.item_unit where item_unit_id = '01936f00-0000-7000-8000-000000004203'::uuid $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004203 is retired, never deleted (INV-005)',
  'and nothing is deleted'
);
-- CONTROL, the I-7 seam. The probe is the foreign key a PO line will carry. An ordinary
-- table, not a temporary one: PostgreSQL refuses a temporary table's foreign key to a
-- permanent table. The failing insert rolls the CREATE back with it.
select throws_ok(
  $$ create table erp.seam_probe (item_id uuid, item_unit_id uuid, unit_key text, unit_factor numeric,
       foreign key (item_unit_id, item_id, unit_key, unit_factor)
       references erp.item_unit (item_unit_id, item_id, unit_key, factor));
     insert into erp.seam_probe values ('01936f00-0000-7000-8000-000000004111'::uuid, '01936f00-0000-7000-8000-000000004203'::uuid, 'carton', 10) $$,
  '23503', null,
  'a line cannot use another item''s carton'
);
select throws_ok(
  $$ create table erp.seam_probe (item_id uuid, item_unit_id uuid, unit_key text, unit_factor numeric,
       foreign key (item_unit_id, item_id, unit_key, unit_factor)
       references erp.item_unit (item_unit_id, item_id, unit_key, factor));
     insert into erp.seam_probe values ('01936f00-0000-7000-8000-000000004103'::uuid, '01936f00-0000-7000-8000-000000004210'::uuid, 'carton', 12) $$,
  '23503', null,
  'nor copy a factor the conversion does not have'
);
select is((select factor from erp.active_item_unit('01936f00-0000-7000-8000-000000004103'::uuid, 'carton')), 24::numeric, 'the new pack size is in force');
select is((select factor::text || ' ' || status from erp.item_unit where item_unit_id = '01936f00-0000-7000-8000-000000004209'::uuid), '12 retired',
  'and the old one is still a row a document can name (I-7)');
select is((select kind from erp.item_decision where decision_id = '01936f00-0000-7000-8000-000000004339'::uuid), 'unit_retired', 'with its retirement recorded');

-- ---------------------------------------------------------------------------
-- Seams for later modules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.assert_item_active('01936f00-0000-7000-8000-000000004109'::uuid) $$,
  '23001', 'item RM-FRYING-OIL-OLD is retired and admits no new work',
  'CONTROL: a retired item cannot be ordered — the warehouse''s stayed orderable forever'
);
select throws_ok(
  $$ select erp.assert_item_active('01936f00-0000-7000-8000-000000004101'::uuid, array['packaging']) $$,
  '23001', 'item RM-CHK-BREAST is a raw_ingredient and cannot be used here (INV-002). Allowed: packaging',
  'a consumer can restrict kinds'
);
select is((select item_kind from erp.assert_item_active('01936f00-0000-7000-8000-000000004101'::uuid, array['raw_ingredient'])), 'raw_ingredient',
  'and a permitted kind passes');

-- ---------------------------------------------------------------------------
-- IAM-008 — the item log is append-only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update erp.item_decision set reason = 'rewritten' $$,
  '23001', 'item_decision is append-only (IAM-008): UPDATE denied on item_decision',
  'an item decision cannot be removed by UPDATE'
);
select throws_ok(
  $$ delete from erp.item_decision $$,
  '23001', 'item_decision is append-only (IAM-008): DELETE denied on item_decision',
  'an item decision cannot be removed by DELETE'
);
select throws_ok(
  $$ truncate erp.item_decision cascade $$,
  '23001', 'item_decision is append-only (IAM-008): TRUNCATE denied on item_decision',
  'an item decision cannot be removed by TRUNCATE'
);

-- ---------------------------------------------------------------------------
-- The import is all-or-nothing
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line":2,"code":"ZZ-IMP-1","item_kind":"packaging","base_unit_key":"piece","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Import lid (synthetic)","name_ar":"غطاء مستورد (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0889","item_id":"01936f00-0000-7000-8000-0000000e0890","base_unit_decision_id":"01936f00-0000-7000-8000-0000000e0891","base_item_unit_id":"01936f00-0000-7000-8000-0000000e0892"},{"line":3,"code":"rm-rice","item_kind":"packaging","base_unit_key":"kg","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Basmati rice (synthetic)","name_ar":"أرز بسمتي (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0893"}]'::jsonb) $$,
  '22023', 'item import refused: 1 line(s) failed and nothing was saved',
  'CONTROL: one bad line refuses the whole file — and an import cannot change a kind'
);
select is((select count(*) from erp.item where code = 'ZZ-IMP-1'), 0::bigint, 'the valid line was not saved either');

-- ---------------------------------------------------------------------------
-- Plain statements — pgTAP only, after every case that reads the seeded state
-- ---------------------------------------------------------------------------

-- CAP-P06's other half: read_only stops new work and leaves the data readable.
select erp.decide_capability('01936f00-0000-7000-8000-0000000e0808'::uuid, 'inventory.items', null, 'read_only', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
select ok((select count(*) from erp.list_items('01936f00-0000-7000-8000-000000000900'::uuid)) > 0, 'a read_only capability is still readable');
select erp.decide_capability('01936f00-0000-7000-8000-0000000e0809'::uuid, 'inventory.items', null, 'pilot', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
-- Names are stored collapsed and trimmed.
select erp.create_item('01936f00-0000-7000-8000-0000000e0810'::uuid, '01936f00-0000-7000-8000-0000000e0811'::uuid, '01936f00-0000-7000-8000-0000000e0812'::uuid, '01936f00-0000-7000-8000-0000000e0813'::uuid, '01936f00-0000-7000-8000-000000000201'::uuid, 'ZZ-WINGS', 'raw_ingredient', 'kg',
       '  Chicken   wings (synthetic) ', 'أجنحة دجاج (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now());
select is((select name_en from erp.item where code = 'ZZ-WINGS'), 'Chicken wings (synthetic)', 'a name is stored collapsed and trimmed');
-- A unit in an anchored dimension is DERIVED, never typed.
select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0894'::uuid, '01936f00-0000-7000-8000-0000000e0895'::uuid, '01936f00-0000-7000-8000-000000004102'::uuid, 'g', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now());
select is((select factor from erp.item_unit where item_unit_id = '01936f00-0000-7000-8000-0000000e0895'::uuid), 0.008::numeric,
  'g on a piece item is derived through its 1 kg = 8 piece anchor');
-- The import is idempotent: a resubmitted file finds nothing to change and records nothing.
select is(erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line":2,"code":"ZZ-IMP-2","item_kind":"packaging","base_unit_key":"piece","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Imported cup (synthetic)","name_ar":"كوب مستورد (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0896","item_id":"01936f00-0000-7000-8000-0000000e0897","base_unit_decision_id":"01936f00-0000-7000-8000-0000000e0898","base_item_unit_id":"01936f00-0000-7000-8000-0000000e0900"},{"line":3,"code":"ZZ-IMP-3","item_kind":"cleaning_supply","base_unit_key":"l","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Imported soap (synthetic)","name_ar":"صابون مستورد (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0901","item_id":"01936f00-0000-7000-8000-0000000e0902","base_unit_decision_id":"01936f00-0000-7000-8000-0000000e0903","base_item_unit_id":"01936f00-0000-7000-8000-0000000e0904"}]'::jsonb),
  '{"created": 2, "amended": 0, "unchanged": 0}'::jsonb, 'an import creates new codes');
select is(erp.import_items('01936f00-0000-7000-8000-000000000900'::uuid, 'testing', now(), '[{"line":2,"code":"ZZ-IMP-2","item_kind":"packaging","base_unit_key":"piece","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Imported cup (synthetic)","name_ar":"كوب مستورد (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0896","item_id":"01936f00-0000-7000-8000-0000000e0897","base_unit_decision_id":"01936f00-0000-7000-8000-0000000e0898","base_item_unit_id":"01936f00-0000-7000-8000-0000000e0900"},{"line":3,"code":"ZZ-IMP-3","item_kind":"cleaning_supply","base_unit_key":"l","brand_id":"01936f00-0000-7000-8000-000000000201","name_en":"Imported soap (synthetic)","name_ar":"صابون مستورد (تجريبي)","decision_id":"01936f00-0000-7000-8000-0000000e0901","item_id":"01936f00-0000-7000-8000-0000000e0902","base_unit_decision_id":"01936f00-0000-7000-8000-0000000e0903","base_item_unit_id":"01936f00-0000-7000-8000-0000000e0904"}]'::jsonb),
  '{"created": 0, "amended": 0, "unchanged": 2}'::jsonb, 'and the same file again changes nothing');
-- I-8: a row EQUALS the latest decision about it — db-check's assertion, run here over
-- everything the statements above changed.
select erp.amend_item('01936f00-0000-7000-8000-0000000e0905'::uuid, '01936f00-0000-7000-8000-000000004105'::uuid, '01936f00-0000-7000-8000-000000004309'::uuid, 'Surface sanitiser 5 l (synthetic)', 'معقم أسطح ٥ لتر (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now());
select is((select as_of_decision_id from erp.item where item_id = '01936f00-0000-7000-8000-000000004105'::uuid), '01936f00-0000-7000-8000-0000000e0905'::uuid, 'an amendment restamps the item');
select is_empty(
  $$ select 'item ' || i.code from erp.item i
     left join erp.item_decision d on d.decision_id = i.as_of_decision_id
     where d.decision_id is null
        or (d.code, d.item_kind, d.base_unit_key, d.brand_id, d.name_en, d.name_ar,
            d.description_en, d.description_ar, d.picture_path, d.status)
           is distinct from (i.code, i.item_kind, i.base_unit_key, i.brand_id, i.name_en, i.name_ar,
            i.description_en, i.description_ar, i.picture_path, i.status)
        or exists (select 1 from erp.item_decision l where l.item_id = i.item_id and l.item_unit_id is null and l.seq > d.seq)
     union all
     select 'conversion ' || u.item_unit_id from erp.item_unit u
     left join erp.item_decision d on d.decision_id = u.as_of_decision_id
     where d.decision_id is null
        or (d.item_id, d.unit_key, d.factor, d.status) is distinct from (u.item_id, u.unit_key, u.factor, u.status)
        or exists (select 1 from erp.item_decision l where l.item_unit_id = u.item_unit_id and l.seq > d.seq) $$,
  'every item and conversion equals the latest decision about it (I-8)'
);

-- ---------------------------------------------------------------------------
-- LAST — the only fixtures that commit under db-fixtures
-- ---------------------------------------------------------------------------

-- The same names as RM-RICE, in brand SECOND: names are unique per brand. Then g, derived
-- from the kg base. Fresh ids, touching nothing an earlier fixture reads.
select lives_ok(
  $$ select erp.create_item('01936f00-0000-7000-8000-0000000e0906'::uuid, '01936f00-0000-7000-8000-0000000e0907'::uuid, '01936f00-0000-7000-8000-0000000e0908'::uuid, '01936f00-0000-7000-8000-0000000e0909'::uuid, '01936f00-0000-7000-8000-000000000202'::uuid, 'B2-RICE', 'raw_ingredient', 'kg',
       'Basmati rice (synthetic)', 'أرز بسمتي (تجريبي)', null, null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'an open, permitted create works, and names are unique per brand only'
);
select lives_ok(
  $$ select erp.add_item_unit('01936f00-0000-7000-8000-0000000e0910'::uuid, '01936f00-0000-7000-8000-0000000e0911'::uuid, '01936f00-0000-7000-8000-0000000e0907'::uuid, 'g', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a same-dimension unit is added without stating its factor'
);
select is((select factor from erp.item_unit where item_unit_id = '01936f00-0000-7000-8000-0000000e0911'::uuid), 0.001::numeric, 'and its factor is derived from the register');
select is((select count(*) from erp.item_decision where item_id = '01936f00-0000-7000-8000-0000000e0907'::uuid), 3::bigint, 'every step was recorded');

select * from finish();
rollback;
