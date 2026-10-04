-- pgTAP · transfer prices, proved by being refused by them
--
-- 0018 is module 3: what a branch is charged for a pack, from a moment. Each rule is
-- proved by colliding with it; cases marked CONTROL are why the suite exists. The
-- message is asserted wherever another refusal shares the SQLSTATE.
--
-- ORDER MATTERS, as in 080 and 110:
--   * throws_ok and lives_ok bodies are replayed alone by tools/db-fixtures against the
--     seed, so none may depend on a plain statement earlier in this file;
--   * plain statements that change state come after every throws_ok that relies on the
--     seeded state;
--   * the lives_ok that COMMIT under db-fixtures are last, with fresh ids, touching
--     nothing an earlier fixture reads.
--
-- Fixture ids are …0e15NN and …0e16NN, a range no seed row and no other suite uses.

begin;
select plan(63);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'transfer_price', 'erp.transfer_price exists');
select has_table('erp', 'transfer_price_decision', 'erp.transfer_price_decision exists');
select has_column('erp', 'transfer_price', 'as_of_decision_id', 'a price carries the decision behind it (I-8)');
select col_is_fk('erp', 'transfer_price_decision', 'actor_id', 'every price decision names a person');
select col_isnt_fk('erp', 'transfer_price_decision', 'price_id', 'the log does not reference the price it creates');
select col_type_is('erp', 'transfer_price', 'price_minor', 'bigint', 'money is integer minor units, never numeric or float');
-- THE SEAM. A price is for one conversion, referenced through all four of 0012's seam
-- columns, so it cannot name a pack at a factor it never had.
select fk_ok('erp', 'transfer_price', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
             'erp', 'item_unit', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
  'a price references its conversion through the seam (INV-005, I-7)');
select is((select pg_get_expr(i.indpred, i.indrelid) from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'transfer_price_one_per_moment'),
  '(status = ''active''::text)', 'one price per pack per moment, among ACTIVE prices only, so a withdrawn one frees its moment');

-- ---------------------------------------------------------------------------
-- Privilege facts
-- ---------------------------------------------------------------------------

select is(has_table_privilege('erp_app', 'erp.transfer_price', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime holds no privilege on erp.transfer_price: it reads and writes through the routes only');
select is(has_table_privilege('erp_app', 'erp.transfer_price_decision', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor on the decision log');
select ok(has_function_privilege('erp_app', 'erp.set_transfer_price(uuid,uuid,uuid,bigint,text,timestamptz,text,uuid,timestamptz)', 'EXECUTE'),
  'the runtime may call the routes');
select is(has_function_privilege('erp_app', 'erp.transfer_price_at(uuid,timestamptz)', 'EXECUTE'), false,
  'but not the seam a branch order calls from its own route');
select is(has_function_privilege('erp_app', 'erp.transfer_price_in_force(uuid,timestamptz)', 'EXECUTE'), false,
  'nor the helper, which filters nothing by permission');

-- ---------------------------------------------------------------------------
-- The gate (CAP-P02, CAP-P04) and permission (IAM-003)
-- ---------------------------------------------------------------------------

-- CONTROL, the left half: hidden refuses even the administrator.
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1501'::uuid, 'inventory.transfer_prices', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1502'::uuid, '01936f00-0000-7000-8000-0000000e1503'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'capability inventory.transfer_prices is hidden for this scope and does not admit new work (CAP-P04)',
  'a hidden capability refuses new work, even to the administrator'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1504'::uuid, 'inventory.transfer_prices', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid) $$,
  '23001', 'capability inventory.transfer_prices is hidden for this scope (CAP-P02)',
  'and hidden hides the data, not only the menu'
);
-- CONTROL, the right half: the warehouse manager reads prices and holds no write.
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1505'::uuid, '01936f00-0000-7000-8000-0000000e1506'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability inventory.transfer_prices here (IAM-003)',
  'reading prices grants no right to set them'
);
select throws_ok(
  $$ select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1507'::uuid, '01936f00-0000-7000-8000-000000005403'::uuid, 'testing', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000904 may not write on capability inventory.transfer_prices here (IAM-003)',
  'withdraw_transfer_price asks for write permission as well'
);
-- A branch worker reads the prices they are charged, at their branch, and nothing
-- organisation-wide, where they hold no role.
select ok((select count(*) from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid)) > 0,
  'a branch worker reads the price list at their branch');
select throws_ok(
  $$ select * from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000901'::uuid) $$,
  '23001', 'person 01936f00-0000-7000-8000-000000000901 may not read on capability inventory.transfer_prices here (IAM-003)',
  'and nothing organisation-wide'
);
-- CONTROL: a price names an item, so every read asks for read on items as well. While
-- items are hidden, the prices are refused too.
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1530'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid) $$,
  '23001', 'capability inventory.items is hidden for this scope (CAP-P02)',
  'CONTROL: the price list asks for read on items too'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1531'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.item_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid) $$,
  '23001', 'capability inventory.items is hidden for this scope (CAP-P02)',
  'so do an item''s prices'
);
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1532'::uuid, 'inventory.items', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.transfer_price_history('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid) $$,
  '23001', 'capability inventory.items is hidden for this scope (CAP-P02)',
  'and their history'
);
-- The accountant sets prices, as in the warehouse (the seed's grant).
select ok(erp.permission_granted('01936f00-0000-7000-8000-000000000907'::uuid, 'inventory.transfer_prices', 'write', null),
  'the accountant may set prices');

-- ---------------------------------------------------------------------------
-- Reads: the price in force, the next, and the brand
-- ---------------------------------------------------------------------------

select is((select price_minor from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid)
            where item_unit_id = '01936f00-0000-7000-8000-000000004203'), 19000::bigint,
  'the price in force is the latest in effect: 19000, which superseded 18500');
select is((select (next_price_minor, next_effective_from)::text from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid)
            where item_unit_id = '01936f00-0000-7000-8000-000000004203'), '(19500,"2099-01-01 00:00:00+00")',
  'and the next is the earliest set ahead, never the withdrawn one');
select is((select price_id from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid)
            where item_unit_id = '01936f00-0000-7000-8000-000000004213'), null,
  'an unpriced pack is listed with no price, not with 0');
select is((select price_minor from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid)
            where item_unit_id = '01936f00-0000-7000-8000-000000004211'), 0::bigint,
  'a price of 0 is a price: free, because somebody decided it');
select is((select count(*)::int from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid)
            where item_unit_id = '01936f00-0000-7000-8000-000000004209'), 0,
  'a retired pack is not on the price list');
select is((select count(*)::int from erp.list_transfer_prices('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid)
            where item_id = '01936f00-0000-7000-8000-000000004112'), 0,
  'CONTROL: at a first-brand branch, the second brand''s prices are not listed');
select is((select array_agg(price_id::text || ':' || in_force order by effective_from)
            from erp.item_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid)),
  array['01936f00-0000-7000-8000-000000005401:false', '01936f00-0000-7000-8000-000000005402:true',
        '01936f00-0000-7000-8000-000000005403:false', '01936f00-0000-7000-8000-000000005404:false'],
  'an item''s prices, every one ever set, with only the one in force now marked');
select throws_ok(
  $$ select * from erp.item_transfer_prices('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-000000004112'::uuid) $$,
  'P0002', 'no item 01936f00-0000-7000-8000-000000004112',
  'another brand''s item answers exactly as a missing one'
);
select is((select array_agg(kind order by seq) from erp.transfer_price_history('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000004101'::uuid)),
  array['price_set', 'price_set', 'price_set', 'price_set', 'price_withdrawn'],
  'the history holds every decision about the item''s prices, in order');

-- ---------------------------------------------------------------------------
-- The seam a branch order will call (I-7)
-- ---------------------------------------------------------------------------

select is((erp.transfer_price_at('01936f00-0000-7000-8000-000000004203'::uuid, timestamptz '2026-09-10 00:00:00+00')).price_minor, 18500::bigint,
  'an order on the 10th is charged the price in force on the 10th');
select is((erp.transfer_price_at('01936f00-0000-7000-8000-000000004203'::uuid, timestamptz '2026-09-15 00:00:00+00')).price_minor, 19000::bigint,
  'a price takes effect at its moment exactly');
select is((erp.transfer_price_at('01936f00-0000-7000-8000-000000004203'::uuid, timestamptz '2099-02-15 00:00:00+00')).price_minor, 19500::bigint,
  'CONTROL: a withdrawn price never takes effect: after its moment the price is still the one before it');
select throws_ok(
  $$ select erp.transfer_price_at('01936f00-0000-7000-8000-000000004213'::uuid, now()) $$,
  'P0002', null,
  'CONTROL: an unpriced pack is refused, never charged a silent 0 as in the warehouse'
);
select throws_ok(
  $$ select erp.transfer_price_at('01936f00-0000-7000-8000-000000004203'::uuid, timestamptz '2026-08-01 00:00:00+00') $$,
  'P0002', null,
  'and so is a moment before any price took effect'
);

-- ---------------------------------------------------------------------------
-- Setting and withdrawing: the rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1510'::uuid, '01936f00-0000-7000-8000-0000000e1511'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'SAR', now() - interval '1 day', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a transfer price takes effect now or later, never before it was set (MNU-015)',
  'CONTROL: a price is never backdated: an order already placed keeps its price'
);
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1512'::uuid, '01936f00-0000-7000-8000-0000000e1513'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       -1, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a transfer price is a whole number of minor units (halalas), 0 or more',
  'a price is never negative'
);
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1514'::uuid, '01936f00-0000-7000-8000-0000000e1515'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'USD', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'transfer prices are in SAR',
  'one currency, stated'
);
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1516'::uuid, '01936f00-0000-7000-8000-0000000e1517'::uuid, '01936f00-0000-7000-8000-000000004209'::uuid,
       3200, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'conversion 01936f00-0000-7000-8000-000000004209 is retired: a price is set for an active pack (I-7)',
  'a retired pack is never priced again'
);
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1518'::uuid, '01936f00-0000-7000-8000-0000000e1519'::uuid, '01936f00-0000-7000-8000-000000004222'::uuid,
       900, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'item RM-FRYING-OIL-OLD is retired and admits no new work',
  'nor a pack of a retired item, though the pack itself is still active'
);
select throws_like(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1520'::uuid, '01936f00-0000-7000-8000-0000000e1521'::uuid, '01936f00-0000-7000-8000-000000004203'::uuid,
       19900, 'SAR', timestamptz '2099-01-01 00:00:00+00', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '%already has a price from%withdraw that one first',
  'one price per pack per moment: a second is refused, not recorded beside it'
);
select throws_like(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1522'::uuid, '01936f00-0000-7000-8000-0000000e1523'::uuid, '01936f00-0000-7000-8000-000000004203'::uuid,
       19000, 'SAR', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'that price is already in force from %',
  'the price already in force is refused rather than recorded twice'
);
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1524'::uuid, '01936f00-0000-7000-8000-0000000e1525'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'SAR', null, '  ', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', null,
  'every price states a reason'
);
select throws_ok(
  $$ select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1526'::uuid, '01936f00-0000-7000-8000-000000005402'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005402 is in effect: set a new price instead of withdrawing it',
  'CONTROL: a price in effect is never withdrawn: an order may already have been charged it'
);
-- The route judges "in effect" at the decision's own moment, not only at the clock's:
-- a withdrawal decided after a price's moment is refused even while the trigger, which
-- reads now(), would let it through.
select throws_ok(
  $$ select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1533'::uuid, '01936f00-0000-7000-8000-000000005403'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid,
       timestamptz '2099-01-02 00:00:00+00') $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005403 is in effect: set a new price instead of withdrawing it',
  'a withdrawal is judged at the moment it is decided'
);
select throws_ok(
  $$ select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1527'::uuid, '01936f00-0000-7000-8000-000000005404'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005404 is already withdrawn',
  'a withdrawal is final'
);
select throws_ok(
  $$ select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1528'::uuid, '01936f00-0000-7000-8000-0000000e1529'::uuid, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'P0002', 'no transfer price 01936f00-0000-7000-8000-0000000e1529',
  'a price that does not exist is not found'
);

-- ---------------------------------------------------------------------------
-- The triggers bind the owner too
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ delete from erp.transfer_price where price_id = '01936f00-0000-7000-8000-000000005401' $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005401 is withdrawn or superseded, never deleted (B-11)',
  'CONTROL: not even the owner deletes a price'
);
select throws_ok(
  $$ update erp.transfer_price set price_minor = 1 where price_id = '01936f00-0000-7000-8000-000000005402' $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005402: the pack, the amount and the moment are fixed once set (I-7)',
  'CONTROL: nor changes what a price was'
);
select throws_ok(
  $$ update erp.transfer_price set effective_from = timestamptz '2026-09-20 00:00:00+00' where price_id = '01936f00-0000-7000-8000-000000005402' $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005402: the pack, the amount and the moment are fixed once set (I-7)',
  'nor when it took effect'
);
select throws_ok(
  $$ update erp.transfer_price set status = 'withdrawn' where price_id = '01936f00-0000-7000-8000-000000005402' $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005402 is in effect: set a new price instead of withdrawing it',
  'nor withdraws a price in effect behind the routes'' backs'
);
select throws_ok(
  $$ update erp.transfer_price set status = 'active' where price_id = '01936f00-0000-7000-8000-000000005404' $$,
  '23001', 'transfer price 01936f00-0000-7000-8000-000000005404 is withdrawn for good; set it again (I-6)',
  'nor revives a withdrawn one'
);
select throws_ok(
  $$ truncate erp.transfer_price cascade $$,
  '23001', null,
  'nor truncates the prices'
);
select throws_ok(
  $$ update erp.transfer_price_decision set price_minor = 1 where decision_id = '01936f00-0000-7000-8000-000000005502' $$,
  '23001', null,
  'the log is never rewritten'
);

-- ---------------------------------------------------------------------------
-- What a successful decision records — last, because under db-fixtures they commit
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1601'::uuid, '01936f00-0000-7000-8000-0000000e1602'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1200, 'SAR', null, 'testing: first price', '01936f00-0000-7000-8000-000000000907'::uuid, now()) $$,
  'the accountant prices the unpriced pack, from now'
);
select is((erp.transfer_price_at('01936f00-0000-7000-8000-000000004213'::uuid, now())).price_minor, 1200::bigint,
  'and it is in force at once');
select throws_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1601'::uuid, '01936f00-0000-7000-8000-0000000e1603'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1300, 'SAR', timestamptz '2099-05-01 00:00:00+00', 'testing: retry', '01936f00-0000-7000-8000-000000000907'::uuid, now()) $$,
  '23505', 'decision 01936f00-0000-7000-8000-0000000e1601 is already recorded',
  'a retry under the same decision id is answered as a retry, whatever it carries'
);
select lives_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1604'::uuid, '01936f00-0000-7000-8000-0000000e1605'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1400, 'SAR', timestamptz '2099-06-01 00:00:00+00', 'testing: set ahead', '01936f00-0000-7000-8000-000000000907'::uuid, now());
     select erp.withdraw_transfer_price('01936f00-0000-7000-8000-0000000e1606'::uuid, '01936f00-0000-7000-8000-0000000e1605'::uuid, 'testing: taken back', '01936f00-0000-7000-8000-000000000907'::uuid, now()) $$,
  'a price set ahead can be withdrawn before its moment'
);
select is((select status from erp.item_transfer_prices('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-000000004104'::uuid)
            where price_id = '01936f00-0000-7000-8000-0000000e1605'), 'withdrawn',
  'and stays on record as withdrawn');
select lives_ok(
  $$ select erp.set_transfer_price('01936f00-0000-7000-8000-0000000e1607'::uuid, '01936f00-0000-7000-8000-0000000e1608'::uuid, '01936f00-0000-7000-8000-000000004213'::uuid,
       1500, 'SAR', timestamptz '2099-06-01 00:00:00+00', 'testing: set again', '01936f00-0000-7000-8000-000000000907'::uuid, now()) $$,
  'its moment is free again for a new price'
);

-- I-8: every price equals the latest decision about it, after all of this.
select is_empty(
  $$ select p.price_id from erp.transfer_price p
     left join erp.transfer_price_decision d on d.decision_id = p.as_of_decision_id
     where d.decision_id is null
        or (d.price_minor, d.effective_from, d.status) is distinct from (p.price_minor, p.effective_from, p.status)
        or exists (select 1 from erp.transfer_price_decision l where l.price_id = p.price_id and l.seq > d.seq) $$,
  'every price equals the latest decision about it'
);

select * from finish();
rollback;
