-- pgTAP · stock, proved by being refused by it
--
-- 0020 is module 5: a ledger of movements at a warehouse or a factory, the balance it adds
-- up to, counts, and reversals. Each rule is proved by colliding with it; cases marked
-- CONTROL are why the suite exists. Most rules share 23001 or 23514, so this suite asserts
-- the CONSTRAINT a refusal names, through pg_temp.refusal() below, wherever two rules share
-- a SQLSTATE.
--
-- ORDER MATTERS, as in 080, 110, 130 and 140:
--   * throws_ok and lives_ok bodies are replayed alone by tools/db-fixtures against the seed
--     and every earlier suite's committed fixtures, so none may depend on a plain statement
--     earlier in this file, and none names a conversion another suite changes (110 retires
--     the gram, …4202; 080 retires the gasket, …4108);
--   * every stateful case runs inside pg_temp.refusal() or pg_temp.after(), which roll back
--     whatever they did, so no case leaves state for the next;
--   * the lives_ok that COMMIT under db-fixtures are last, with fresh ids.
--
-- The seed (0070): WH-001 (…0403) and FA-001 (…0404), counted on 2026-09-25. The warehouse
-- manager (…0904) writes stock everywhere and may not override; the factory manager (…0908)
-- writes and overrides at FA-001 alone.
--
-- Fixture ids are …0e19NN and …0e20NN, a range no seed row and no other suite uses.

begin;
select plan(134);

-- ---------------------------------------------------------------------------
-- Helpers — pgTAP only; db-fixtures never sees them
-- ---------------------------------------------------------------------------

-- A seed or fixture id from its tail: u('4225') is …000000004225, u('e1901') …0000000e1901.
create function pg_temp.u(p text) returns uuid language sql immutable as $f$
  select ('01936f00-0000-7000-8000-' || lpad(p, 12, '0'))::uuid
$f$;

-- A line: a conversion by its tail, a quantity as typed, and a direction or none.
create function pg_temp.l(p_unit text, p_qty text, p_dir text default null) returns jsonb language sql immutable as $f$
  select jsonb_build_object('item_unit_id', pg_temp.u(p_unit), 'quantity', p_qty)
         || case when p_dir is null then '{}'::jsonb else jsonb_build_object('direction', p_dir) end
$f$;

create function pg_temp.adjust(p_id text, p_kind text, p_lines jsonb, p_at timestamptz default null,
                               p_actor text default '904', p_facility text default '403', p_override text default null)
returns void language sql as $f$
  select erp.record_stock_adjustment(pg_temp.u(p_id), pg_temp.u(p_facility), p_kind, p_at, p_lines, 'testing',
                                     p_override, pg_temp.u(p_actor), now())
$f$;

create function pg_temp.count(p_id text, p_lines jsonb, p_at timestamptz default null,
                              p_actor text default '904', p_facility text default '403')
returns void language sql as $f$
  select erp.record_stock_count(pg_temp.u(p_id), pg_temp.u(p_facility), p_at, p_lines, 'testing', pg_temp.u(p_actor), now())
$f$;

create function pg_temp.reverse(p_id text, p_target text, p_actor text default '904', p_facility text default '403',
                                p_override text default null)
returns void language sql as $f$
  select erp.reverse_stock_decision(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_target), 'testing',
                                    p_override, pg_temp.u(p_actor), now())
$f$;

-- What a sequence of statements is refused with — 'SQLSTATE constraint', '-' for none
-- named — or 'none'. Always rolled back. A refusal PostgreSQL raised itself, not a route's
-- RAISE, reads '(native)' after it: the edge answers the two differently (a native
-- 23505 on a log's key is a collision, never a retry), so every case below that expects
-- a route's refusal fails on a native one with the same name.
create function pg_temp.refusal(variadic p_sql text[]) returns text language plpgsql as $f$
declare
  s text;
  v_state text;
  v_constraint text;
  v_context text;
begin
  foreach s in array p_sql loop execute s; end loop;
  raise exception 'no refusal' using errcode = 'P0099';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_context = pg_exception_context;
  if v_state = 'P0099' then return 'none'; end if;
  return v_state || ' ' || coalesce(nullif(v_constraint, ''), '-')
         || case when split_part(v_context, E'\n', 1) like '% at RAISE' then '' else ' (native)' end;
end
$f$;

-- The same, as the words a person would read.
create function pg_temp.refusal_text(variadic p_sql text[]) returns text language plpgsql as $f$
declare
  s text;
  v_message text;
begin
  foreach s in array p_sql loop execute s; end loop;
  raise exception 'no refusal' using errcode = 'P0099';
exception when others then
  get stacked diagnostics v_message = message_text;
  return v_message;
end
$f$;

-- What p_read answers once the statements have run, then all of it rolled back.
create function pg_temp.after(p_read text, variadic p_sql text[]) returns text language plpgsql as $f$
declare
  s text;
  v_out text;
begin
  foreach s in array p_sql loop execute s; end loop;
  execute p_read into v_out;
  raise exception 'roll back' using errcode = 'P0099';
exception when sqlstate 'P0099' then
  return v_out;
end
$f$;

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'stock_decision', 'erp.stock_decision exists');
select has_table('erp', 'stock_ledger', 'erp.stock_ledger exists');
select has_table('erp', 'stock_count_log', 'erp.stock_count_log exists');
select has_table('erp', 'stock_balance', 'erp.stock_balance exists');
select col_not_null('erp', 'stock_balance', 'as_of_decision_id', 'every balance carries the decision behind it (I-8)');
select fk_ok('erp', 'stock_balance', array['as_of_decision_id', 'facility_id']::name[],
             'erp', 'stock_decision', array['decision_id', 'facility_id']::name[],
  'a balance is stamped with a decision at ITS facility, never another''s');
select fk_ok('erp', 'stock_ledger', array['decision_id', 'kind', 'facility_id', 'occurred_at', 'business_date']::name[],
             'erp', 'stock_decision', array['decision_id', 'kind', 'facility_id', 'occurred_at', 'business_date']::name[],
  'an entry is bound to its decision''s kind, facility and moment');
select fk_ok('erp', 'stock_ledger', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
             'erp', 'item_unit', array['item_unit_id', 'item_id', 'unit_key', 'factor']::name[],
  'an entry names its conversion through 0012''s seam (I-7)');
select fk_ok('erp', 'stock_decision', array['reverses_decision_id', 'facility_id', 'occurred_at', 'business_date']::name[],
             'erp', 'stock_decision', array['decision_id', 'facility_id', 'occurred_at', 'business_date']::name[],
  'a reversal is at its target''s facility and moment');
select col_is_fk('erp', 'stock_decision', 'actor_id', 'every stock decision names a person');

-- ---------------------------------------------------------------------------
-- Privilege facts
-- ---------------------------------------------------------------------------

select is(has_table_privilege('erp_app', 'erp.stock_decision', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_table_privilege('erp_app', 'erp.stock_ledger', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_table_privilege('erp_app', 'erp.stock_count_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_table_privilege('erp_app', 'erp.stock_balance', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  false, 'the runtime holds no privilege on the four stock tables');
select ok(has_function_privilege('erp_app', 'erp.record_stock_count(uuid,uuid,timestamptz,jsonb,text,uuid,timestamptz)', 'EXECUTE'),
  'the runtime may call the routes');
select is(has_function_privilege('erp_app', 'erp.post_stock(uuid,text,uuid,timestamptz,jsonb,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
          or has_function_privilege('erp_app', 'erp.lock_stock(uuid[],uuid[])', 'EXECUTE'), false,
  'but not the posting seam or its lock, which later modules call from their own routes');

-- ---------------------------------------------------------------------------
-- The seed's position
-- ---------------------------------------------------------------------------

select is((select on_hand from erp.stock_balance where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4101')), -10::numeric,
  'D1: the factory''s chicken shows -10 kg after an override, until a count');
select is((select override_reason from erp.stock_decision where decision_id = pg_temp.u('5708')),
  'The morning delivery is not entered yet (synthetic).', 'and the override carries its own reason');
select is((select (occurred_at, business_date)::text from erp.stock_decision where decision_id = pg_temp.u('5706')),
          (select (occurred_at, business_date)::text from erp.stock_decision where decision_id = pg_temp.u('5705')),
  'the seeded reversal is dated at the moment it undoes');

-- ---------------------------------------------------------------------------
-- The gate (CAP-P02, CAP-P04) and permission at a facility (IAM-003, IAM-006)
-- ---------------------------------------------------------------------------

-- inventory.stock is a dependency of factory.production (0030), which is pilot, so hiding
-- stock alone is refused by CAP-P07 with the same SQLSTATE. Each control withdraws
-- production first, and asserts CAP-P04's own words.
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1901'::uuid, 'factory.production', null, 'withdrawn', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.decide_capability('01936f00-0000-7000-8000-0000000e1902'::uuid, 'inventory.stock', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.record_stock_count('01936f00-0000-7000-8000-0000000e1903'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": "1"}]'::jsonb, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'capability inventory.stock is hidden for this scope and does not admit new work (CAP-P04)',
  'CONTROL: a hidden capability refuses even the administrator'
);
select is(pg_temp.refusal_text(
  $$select erp.decide_capability(pg_temp.u('e1904'), 'inventory.stock', null, 'hidden', 'testing', pg_temp.u('900'), 'administrator', now())$$),
  'capability inventory.stock cannot be set hidden because factory.production depends on it and is still open (CAP-P07)',
  'CONTROL: without withdrawing production first, CAP-P07 refuses the hiding itself, which is why each control does');
select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1905'::uuid, 'factory.production', null, 'withdrawn', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.decide_capability('01936f00-0000-7000-8000-0000000e1906'::uuid, 'inventory.stock', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select * from erp.stock_on_hand('01936f00-0000-7000-8000-000000000904'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid) $$,
  '23001', 'capability inventory.stock is hidden for this scope (CAP-P02)',
  'and hides its reads'
);
select throws_like(
  $$ select erp.record_stock_count('01936f00-0000-7000-8000-0000000e1907'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": "1"}]'::jsonb, 'testing', '01936f00-0000-7000-8000-000000000901'::uuid, now()) $$,
  '%may not write on capability inventory.stock%',
  'CONTROL: a branch worker reads stock and may not write it, at their own branch (IAM-003)'
);
select throws_like(
  $$ select erp.record_stock_count('01936f00-0000-7000-8000-0000000e1908'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": "1"}]'::jsonb, 'testing', '01936f00-0000-7000-8000-000000000908'::uuid, now()) $$,
  '%may not write on capability inventory.stock%',
  'CONTROL: the factory manager, assigned to the factory, may not count at the warehouse (IAM-006)'
);
select is(pg_temp.refusal($$select pg_temp.count('e1909', jsonb_build_array(pg_temp.l('4205', '172')), null, '908', '404')$$),
  'none', 'and counts at the factory');
select throws_like(
  $$ select * from erp.stock_on_hand('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid) $$,
  '%may not read on capability inventory.stock%',
  'a branch worker reads stock at their own branch only'
);
select is((select count(*)::int from erp.stock_on_hand('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid)),
  0, 'where there is none to read: no branch holds stock yet');

-- ---------------------------------------------------------------------------
-- The facility (D3, D4, ADR-0028)
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$select pg_temp.count('e1910', jsonb_build_array(pg_temp.l('4225', '1')), null, '900', null)$$),
  '22023 stock_facility_required', 'stock is held at a facility: the administrator, organisation-wide, must name one');
select is(pg_temp.refusal($$select erp.record_stock_count(pg_temp.u('e1911'), erp.org_scope(), null, jsonb_build_array(pg_temp.l('4225', '1')), 'testing', pg_temp.u('900'), now())$$),
  '22023 stock_facility_required', 'and the organisation is not one');
select is(pg_temp.refusal($$select pg_temp.count('e1912', jsonb_build_array(pg_temp.l('4225', '1')), null, '900', 'e1999')$$),
  'P0002 facility_exists', 'a facility that does not exist is answered as missing');
select throws_ok(
  $$ select erp.record_stock_count('01936f00-0000-7000-8000-0000000e1913'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": "1"}]'::jsonb, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'branch BR-001 holds no stock record yet: a branch''s business day opens with its shift, and is still to be decided (Q-06)',
  'CONTROL: no branch holds stock until its business day is decided — D3 covers warehouses and factories only'
);
select is(pg_temp.refusal($$select pg_temp.adjust('e1914', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), null, '904', '401')$$),
  '23001 stock_branch_business_day_undecided', 'not even a write-off by the organisation-wide warehouse manager');
select is(pg_temp.refusal(
  $$select erp.create_facility(pg_temp.u('e1915'), pg_temp.u('e1916'), pg_temp.u('301'), 'office', 'OF-T01', 'Test office', 'مكتب تجريبي', null, null, 'testing', pg_temp.u('900'), now())$$,
  $$select pg_temp.count('e1917', jsonb_build_array(pg_temp.l('4225', '1')), null, '900', 'e1916')$$),
  '23001 stock_facility_holds_no_stock', 'an office holds no stock');
select is(pg_temp.refusal(
  $$select erp.create_facility(pg_temp.u('e1918'), pg_temp.u('e1919'), pg_temp.u('301'), 'warehouse', 'WH-T01', 'Test warehouse', 'مستودع تجريبي', null, null, 'testing', pg_temp.u('900'), now())$$,
  $$select erp.change_facility_status(pg_temp.u('e1920'), pg_temp.u('e1919'), pg_temp.u('e1918'), 'closed', 'testing', pg_temp.u('900'), now())$$,
  $$select pg_temp.count('e1921', jsonb_build_array(pg_temp.l('4225', '1')), null, '900', 'e1919')$$),
  '23001 facility_admits_no_new_work', 'a closed warehouse admits no new stock decision (ADR-0028)');
select is(pg_temp.refusal(
  $$select erp.create_facility(pg_temp.u('e1922'), pg_temp.u('e1923'), pg_temp.u('301'), 'warehouse', 'WH-T02', 'Test warehouse two', 'مستودع تجريبي ٢', null, null, 'testing', pg_temp.u('900'), now())$$,
  $$select pg_temp.count('e1924', jsonb_build_array(pg_temp.l('4225', '1')), null, '900', 'e1923')$$),
  'none', 'CONTROL: the same warehouse, open, takes its first count');

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$select pg_temp.adjust('e1925', 'count', jsonb_build_array(pg_temp.l('4225', '1')))$$),
  '23514 stock_decision_kind_is_known', 'the adjustment route records an adjustment or a write-off, never a count');
select is(pg_temp.refusal($$select pg_temp.adjust('e1926', 'waste', '[]'::jsonb)$$),
  '23514 stock_lines_are_stated', 'a decision has lines');
select is(pg_temp.refusal($$select pg_temp.count('e1927', null)$$),
  '23514 stock_lines_are_stated', 'a count too');
select is(pg_temp.refusal($$select pg_temp.adjust('e1928', 'waste', '[{"item_unit_id": "carton", "quantity": "1"}]'::jsonb)$$),
  '23514 stock_lines_are_stated', 'a line names its conversion by id');
select is(pg_temp.refusal($$select pg_temp.adjust('e1929', 'waste', jsonb_build_array(pg_temp.l('e1998', '1')))$$),
  'P0002 item_unit_exists', 'a conversion that does not exist is refused');
select is(pg_temp.refusal_text($$select pg_temp.adjust('e1930', 'waste', jsonb_build_array(pg_temp.l('4227', '1')))$$),
  'no conversion 01936f00-0000-7000-8000-000000004227',
  'CONTROL: another brand''s conversion is answered in exactly the words for a missing one (ADR-0012)');
select is(pg_temp.refusal($$select pg_temp.count('e1931', jsonb_build_array(pg_temp.l('4227', '0.0000001')))$$),
  'P0002 item_unit_exists', 'before any other rule could tell that it exists');
select is(pg_temp.refusal($$select pg_temp.adjust('e1932', 'waste', jsonb_build_array(pg_temp.l('4225', '-1')))$$),
  '23514 stock_quantity_is_valid', 'a quantity is not negative: the direction says which way');
select is(pg_temp.refusal($$select pg_temp.adjust('e1933', 'waste', jsonb_build_array(pg_temp.l('4225', '1.0000001')))$$),
  '23514 stock_quantity_is_valid', 'nor past six decimal places');
select is(pg_temp.refusal($$select pg_temp.adjust('e1934', 'waste', '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": true}]'::jsonb)$$),
  '23514 stock_quantity_is_valid', 'nor anything but a number');
select is(pg_temp.refusal($$select pg_temp.adjust('e1935', 'waste', '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": 2.5}]'::jsonb)$$),
  'none', 'a JSON number is read exactly, as a decimal');
select is(pg_temp.refusal($$select pg_temp.adjust('e1936', 'waste', jsonb_build_array(pg_temp.l('4225', '0')))$$),
  '23514 stock_quantity_is_valid', 'nothing moves none');
select is(pg_temp.refusal($$select pg_temp.count('e1937', jsonb_build_array(pg_temp.l('4225', '0')))$$),
  'none', 'CONTROL: but a count may find none');
select is(pg_temp.refusal($$select pg_temp.adjust('e1938', 'adjustment', jsonb_build_array(pg_temp.l('4215', '0.0005', 'in')))$$),
  '23514 stock_quantity_inexact', '0.0005 ml is 0.0000005 l, past six places: refused, never rounded (INV-005)');
select is(pg_temp.refusal($$select pg_temp.adjust('e1939', 'adjustment', jsonb_build_array(pg_temp.l('4215', '0.5', 'in')))$$),
  'none', 'CONTROL: 0.5 ml is 0.0005 l, and exact');
select is(pg_temp.refusal($$select pg_temp.adjust('e1940', 'waste', jsonb_build_array(pg_temp.l('4226', '1'), pg_temp.l('4226', '2')))$$),
  '23514 stock_line_repeats', 'one line per pack');
select is(pg_temp.refusal($$select pg_temp.adjust('e1941', 'waste', jsonb_build_array(pg_temp.l('4226', '1'), pg_temp.l('4225', '2')))$$),
  'none', 'CONTROL: two packs of one item are two lines');
select is(pg_temp.refusal($$select pg_temp.adjust('e1942', 'adjustment', jsonb_build_array(pg_temp.l('4225', '1')))$$),
  '23514 stock_direction_is_known', 'an adjustment line says in or out');
select is(pg_temp.refusal($$select pg_temp.adjust('e1943', 'waste', jsonb_build_array(pg_temp.l('4225', '1', 'in')))$$),
  '23514 stock_direction_is_known', 'a waste takes stock out, never in');
select is(pg_temp.refusal($$select pg_temp.count('e1944', jsonb_build_array(pg_temp.l('4225', '1', 'in')))$$),
  '23514 stock_direction_is_known', 'a count line is what was found, and has no direction');
select is(pg_temp.refusal($$select erp.record_stock_adjustment(pg_temp.u('e1945'), pg_temp.u('403'), 'waste', null, jsonb_build_array(pg_temp.l('4225', '1')), '  ', null, pg_temp.u('904'), now())$$),
  '23514 stock_decision_reason_is_stated', 'a decision states why');

-- ---------------------------------------------------------------------------
-- What a posting records
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select (on_hand, as_of_decision_id = pg_temp.u('e1946'))::text from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4111')$$,
  $$select pg_temp.adjust('e1946', 'waste', jsonb_build_array(pg_temp.l('4226', '2')))$$),
  '(90,t)', 'two bags of 5 kg wasted take 10 kg of rice, and the balance names the waste');
select is(pg_temp.after(
  $$select (line_no, kind, direction, unit_key, factor, quantity, base_quantity, reverses_entry_id is null)::text from erp.stock_ledger where decision_id = pg_temp.u('e1947')$$,
  $$select pg_temp.adjust('e1947', 'waste', jsonb_build_array(pg_temp.l('4226', '2')))$$),
  '(1,waste,out,bag,5,2,10,t)', 'the entry keeps the pack it was entered in and its base quantity (I-7)');
select is(pg_temp.after(
  $$select on_hand::text from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4111')$$,
  $$select pg_temp.adjust('e1948', 'adjustment', jsonb_build_array(pg_temp.l('4225', '10', 'in'), pg_temp.l('4226', '22', 'out')))$$),
  '0', 'an adjustment in and out nets per item: 100 + 10 - 110 is 0, and nothing is refused');
select is(pg_temp.after(
  $$select (business_date, occurred_at = timestamptz '2026-10-01 23:30:00+00')::text from erp.stock_decision where decision_id = pg_temp.u('e1949')$$,
  $$select pg_temp.adjust('e1949', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), timestamptz '2026-10-01 23:30:00+00')$$),
  '(2026-10-02,t)', 'D3: 23:30 UTC on the 1st is 02:30 on the 2nd in Riyadh, and that is its business day');
select is(pg_temp.after(
  $$select (occurred_at >= now() and occurred_at <= clock_timestamp())::text from erp.stock_decision where decision_id = pg_temp.u('e1950')$$,
  $$select pg_temp.adjust('e1950', 'waste', jsonb_build_array(pg_temp.l('4225', '1')))$$),
  'true', 'a movement with no moment stated happened now, by the clock');
select is(pg_temp.refusal($$select pg_temp.adjust('e1951', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), now() + interval '1 hour')$$),
  '23514 stock_not_in_future', 'nothing is recorded before it has moved');
select is(pg_temp.after(
  $$select (on_hand, last_counted_at is not null)::text from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4106')$$,
  $$select pg_temp.adjust('e1952', 'adjustment', jsonb_build_array(pg_temp.l('4218', '3', 'in')))$$),
  '(30,f)', 'the first movement of an item creates its balance: 3 cartons of 10 boxes of gloves, never counted');
select is(pg_temp.refusal($$select pg_temp.adjust('e1953', 'adjustment', jsonb_build_array(pg_temp.l('4222', '5', 'in')))$$),
  'none', 'stock already held of a RETIRED item can be put back on the book: correcting it acquires nothing');
select is(pg_temp.refusal($$select pg_temp.adjust('e1954', 'waste', jsonb_build_array(pg_temp.l('4209', '1')))$$),
  'none', 'nor is a retired pack refused for what is in it: a carton of the old 12 is written off as one');

-- ---------------------------------------------------------------------------
-- D1: never negative without an override, and only by a person allowed to
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal_text($$select pg_temp.adjust('e1955', 'waste', jsonb_build_array(pg_temp.l('4226', '21')))$$),
  'RM-RICE has 100 kg on hand; this takes out 105, which would leave -5',
  'CONTROL: taking 105 kg of rice from 100 is refused, in words that say why');
select is(pg_temp.refusal($$select pg_temp.adjust('e1956', 'waste', jsonb_build_array(pg_temp.l('4226', '21')))$$),
  '23001 stock_would_go_negative', 'as a rule the console can name');
select is(pg_temp.refusal($$select pg_temp.adjust('e1957', 'waste', jsonb_build_array(pg_temp.l('4226', '20')))$$),
  'none', 'CONTROL: taking exactly what is held leaves nothing, and is not refused');
select throws_like(
  $$ select erp.record_stock_adjustment('01936f00-0000-7000-8000-0000000e1958'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid, 'waste', null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004226", "quantity": "21"}]'::jsonb, 'testing', 'Delivery not entered yet', '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '%may not approve on capability inventory.stock%',
  'CONTROL: the warehouse manager writes stock and may not override (IAM-003)'
);
select is(pg_temp.after(
  $$select (b.on_hand, d.override_reason)::text from erp.stock_balance b join erp.stock_decision d on d.decision_id = b.as_of_decision_id where b.facility_id = pg_temp.u('404') and b.item_id = pg_temp.u('4102')$$,
  $$select pg_temp.adjust('e1959', 'waste', jsonb_build_array(pg_temp.l('4207', '5')), null, '908', '404', 'Count was wrong')$$),
  '(-28,"Count was wrong")', 'the factory manager overrides at the factory, and the decision keeps the reason (D1)');
select throws_like(
  $$ select erp.record_stock_adjustment('01936f00-0000-7000-8000-0000000e1960'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid, 'waste', null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004201", "quantity": "200"}]'::jsonb, 'testing', 'Count was wrong', '01936f00-0000-7000-8000-000000000908'::uuid, now()) $$,
  '%may not write on capability inventory.stock%',
  'and nowhere else: the override follows where the role is held'
);
select is(pg_temp.after(
  $$select (override_reason is null)::text from erp.stock_decision where decision_id = pg_temp.u('e1961')$$,
  $$select pg_temp.adjust('e1961', 'waste', jsonb_build_array(pg_temp.l('4207', '1')), null, '908', '404', 'Just in case')$$),
  'true', 'an override that was not needed is not recorded: only a decision that would have been refused carries one');
select is(pg_temp.refusal($$select pg_temp.adjust('e1962', 'waste', jsonb_build_array(pg_temp.l('4207', '5')), null, '908', '404', '   ')$$),
  '23514 stock_override_reason_is_stated', 'an override states its reason');
select is(pg_temp.after(
  $$select on_hand::text from erp.stock_balance where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4101')$$,
  $$select pg_temp.adjust('e1963', 'adjustment', jsonb_build_array(pg_temp.l('4201', '4', 'in')), null, '908', '404')$$),
  '-6', 'what goes in never needs an override, even where the balance stays below nothing');

-- ---------------------------------------------------------------------------
-- D3: nothing at or before a count, and a count never shares a moment
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$select pg_temp.adjust('e1964', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), timestamptz '2026-09-24 10:00:00+03')$$),
  '23001 stock_backdated_before_count', 'a late entry dated before the item''s last count is refused: the count includes it');
select is(pg_temp.refusal_text($$select pg_temp.adjust('e1965', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), timestamptz '2026-09-25 03:00:00+00')$$),
  'RM-RICE was counted at exactly 2026-09-25 06:00:00: say whether this was before or after the count',
  'one dated AT the count is refused too, asking which side it was on, in Riyadh time');
select is(pg_temp.refusal($$select pg_temp.adjust('e1966', 'waste', jsonb_build_array(pg_temp.l('4225', '1')), timestamptz '2026-09-25 03:01:00+00')$$),
  'none', 'CONTROL: a minute after the count is recorded');
select is(pg_temp.refusal($$select pg_temp.adjust('e1968', 'adjustment', jsonb_build_array(pg_temp.l('4220', '1', 'in')), timestamptz '2026-01-01 00:00:00+00')$$),
  'none', 'an item never counted here takes a late entry of any past moment');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e1969', 'waste', jsonb_build_array(pg_temp.l('4223', '1')), now() - interval '2 hours')$$,
  $$select pg_temp.count('e1970', jsonb_build_array(pg_temp.l('4224', '6')), now() - interval '2 hours')$$),
  '23001 stock_count_moment_taken', 'a count at the very moment a movement of the item was recorded must say which side it was on');
select is(pg_temp.refusal(
  $$select pg_temp.count('e1971', jsonb_build_array(pg_temp.l('4224', '6')), now() - interval '2 hours')$$,
  $$select pg_temp.adjust('e1972', 'waste', jsonb_build_array(pg_temp.l('4223', '1')), now() - interval '2 hours')$$),
  '23001 stock_backdated_before_count', 'and the other way about');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e1973', 'waste', jsonb_build_array(pg_temp.l('4216', '1')), now() - interval '2 hours')$$,
  $$select pg_temp.count('e1974', jsonb_build_array(pg_temp.l('4224', '6')), now() - interval '2 hours')$$),
  'none', 'CONTROL: a movement of ANOTHER item at that moment is no tie');
select is(pg_temp.refusal(
  $$select pg_temp.count('e1975', jsonb_build_array(pg_temp.l('4224', '6')), now() - interval '2 hours')$$,
  $$select pg_temp.count('e1976', jsonb_build_array(pg_temp.l('4224', '6')), now() - interval '3 hours')$$),
  '23001 stock_backdated_before_count', 'a count stated before the last count of the item is refused');

-- ---------------------------------------------------------------------------
-- Counts (INV-009)
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select (b.on_hand, l.direction, l.unit_key, l.factor, l.base_quantity, b.last_counted_at = now() - interval '1 hour')::text
      from erp.stock_balance b join erp.stock_ledger l on l.decision_id = b.as_of_decision_id
     where b.facility_id = pg_temp.u('403') and b.item_id = pg_temp.u('4101')$$,
  $$select pg_temp.count('e1977', jsonb_build_array(pg_temp.l('4203', '12'), pg_temp.l('4201', '3.5')), now() - interval '1 hour')$$),
  '(123.5,in,kg,1,2,t)', 'full cartons and loose kilograms are summed: 123.5 found against 121.5 posts 2 kg in, in the base unit');
select is(pg_temp.after(
  $$select (select count(*) from erp.stock_count_log where decision_id = pg_temp.u('e1978'))::text || ' lines, '
        || (select count(*) from erp.stock_ledger where decision_id = pg_temp.u('e1978'))::text || ' entries, stamped '
        || (select (as_of_decision_id = pg_temp.u('e1978'))::text from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4111'))$$,
  $$select pg_temp.count('e1978', jsonb_build_array(pg_temp.l('4226', '20')))$$),
  '1 lines, 0 entries, stamped true', 'a count that matches the book keeps what was found, posts nothing, and still stamps the balance');
select is(pg_temp.after(
  $$select (b.on_hand, l.direction, l.base_quantity)::text from erp.stock_balance b join erp.stock_ledger l on l.decision_id = b.as_of_decision_id
     where b.facility_id = pg_temp.u('403') and b.item_id = pg_temp.u('4110')$$,
  $$select pg_temp.count('e1979', jsonb_build_array(pg_temp.l('4224', '5')))$$),
  '(90,out,18)', 'a shortfall posts out: 5 buckets of 18 l found against 108 l');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4103'))::text$$,
  $$select pg_temp.count('e1980', jsonb_build_array(pg_temp.l('4226', '20')))$$),
  '1014', 'a partial count changes only the items it lists');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4103'))::text$$,
  $$select pg_temp.count('e1981', jsonb_build_array(pg_temp.l('4210', '40'), pg_temp.l('4209', '2'), pg_temp.l('4208', '6')))$$),
  '990', 'old cartons of 12 are counted as what they are: 40 of 24, 2 of 12 and 6 cans');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4109'))::text$$,
  $$select pg_temp.count('e1982', jsonb_build_array(pg_temp.l('4222', '7')))$$),
  '7', 'a retired item''s stock is counted');
-- A count entered late, dated between two movements: the movement after it is not counted
-- twice. 108 l; 4 l wasted an hour ago; a count stated two hours ago finds 100 l. The book
-- then was 108, so 8 l out, and the waste after it still stands: 96.
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4110'))::text$$,
  $$select pg_temp.adjust('e1983', 'waste', jsonb_build_array(pg_temp.l('4223', '4')), now() - interval '1 hour')$$,
  $$select pg_temp.count('e1984', jsonb_build_array(pg_temp.l('4223', '100')), now() - interval '2 hours')$$),
  '96', 'D3: a count stated before a movement already recorded is judged against the book at its own moment');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4110'))::text$$,
  $$select pg_temp.adjust('e1985', 'waste', jsonb_build_array(pg_temp.l('4223', '50')), now() - interval '1 hour')$$,
  $$select pg_temp.count('e1986', jsonb_build_array(pg_temp.l('4223', '10')), now() - interval '2 hours')$$),
  '-40', 'a count is never refused for the balance it leaves: 10 l found, 50 l since, shows -40');
select is(pg_temp.after(
  $$select (select (on_hand, last_counted_at is not null) from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4102'))::text$$,
  $$select pg_temp.count('e1987', jsonb_build_array(pg_temp.l('4207', '2')))$$),
  '(80,t)', 'a first count of an item never held here posts all it found');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4101'))::text$$,
  $$select pg_temp.count('e1988', jsonb_build_array(pg_temp.l('4203', '3')), null, '908', '404')$$),
  '30', 'and a count settles a negative balance at what was found');

-- ---------------------------------------------------------------------------
-- Reversals (I-6)
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select (b.on_hand, d.occurred_at = t.occurred_at, d.business_date, d.decided_at > t.decided_at)::text
      from erp.stock_decision d join erp.stock_decision t on t.decision_id = d.reverses_decision_id
      join erp.stock_balance b on b.facility_id = d.facility_id and b.item_id = pg_temp.u('4103')
     where d.decision_id = pg_temp.u('e1989')$$,
  $$select pg_temp.reverse('e1989', '5704')$$),
  '(990,t,2026-09-27,t)', 'a reversal undoes the found carton, dated at the moment it undoes, decided now');
select is(pg_temp.after(
  $$select (r.direction, r.item_unit_id = t.item_unit_id, r.factor, r.quantity, r.base_quantity, r.reverses_entry_id = t.entry_id)::text
      from erp.stock_ledger r join erp.stock_ledger t on t.decision_id = pg_temp.u('5704')
     where r.decision_id = pg_temp.u('e1990')$$,
  $$select pg_temp.reverse('e1990', '5704')$$),
  '(out,t,24,1,24,t)', 'its entry mirrors the one it undoes, pack and quantity copied whole');
select is(pg_temp.refusal($$select pg_temp.reverse('e1991', '5704')$$, $$select pg_temp.reverse('e1992', '5704')$$),
  '23505 stock_already_reversed', 'a decision is reversed once (I-6)');
select is(pg_temp.refusal($$select pg_temp.reverse('e1993', '5701')$$),
  '23001 stock_decision_is_not_reversible', 'a count is not reversed: it is corrected by counting again');
select is(pg_temp.refusal($$select pg_temp.reverse('e1994', '5706')$$),
  '23001 stock_decision_is_not_reversible', 'nor is a reversal');
select is(pg_temp.refusal($$select pg_temp.reverse('e1995', '5707')$$),
  'P0002 stock_decision_exists', 'a decision at another facility is answered as a missing one');
select is(pg_temp.refusal($$select pg_temp.reverse('e1996', 'e1997')$$),
  'P0002 stock_decision_exists', 'as is one that does not exist');
-- The review's case: a waste recorded by mistake, a count that found the stock still there,
-- then the reversal. The count already put it back; a reversal dated "now" put it back twice.
select is(pg_temp.refusal(
  $$select pg_temp.count('e2001', jsonb_build_array(pg_temp.l('4203', '12'), pg_temp.l('4201', '3.5')))$$,
  $$select pg_temp.reverse('e2002', '5703')$$),
  '23001 stock_reversal_counted_since', 'CONTROL: a reversal after a count that covered its target is refused — the count corrected it');
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4101'))::text$$,
  $$select pg_temp.count('e2003', jsonb_build_array(pg_temp.l('4201', '123.5')), timestamptz '2026-09-25 12:00:00+00')$$,
  $$select pg_temp.reverse('e2004', '5703')$$),
  '123.5', 'CONTROL: a count dated BEFORE the target does not cover it, and the reversal stands');
-- The other order: the reversal first, then a count entered late, stated between the waste
-- and the reversal. The waste and its reversal both lie before the count, and cancel.
select is(pg_temp.after(
  $$select (select on_hand from erp.stock_balance where facility_id = pg_temp.u('403') and item_id = pg_temp.u('4111'))::text$$,
  $$select pg_temp.adjust('e2005', 'waste', jsonb_build_array(pg_temp.l('4226', '2')), now() - interval '3 hours')$$,
  $$select pg_temp.reverse('e2006', 'e2005')$$,
  $$select pg_temp.count('e2007', jsonb_build_array(pg_temp.l('4226', '20')), now() - interval '2 hours')$$),
  '100', 'a count stated between a waste and its reversal finds 100 kg against a book of 100: no variance, none counted twice');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e2008', 'adjustment', jsonb_build_array(pg_temp.l('4226', '1', 'out'), pg_temp.l('4224', '1', 'out')), now() - interval '3 hours')$$,
  $$select pg_temp.count('e2009', jsonb_build_array(pg_temp.l('4224', '5')), now() - interval '2 hours')$$,
  $$select pg_temp.reverse('e2010', 'e2008')$$),
  '23001 stock_reversal_counted_since', 'a reversal is whole: one item counted since refuses it all');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e2011', 'adjustment', jsonb_build_array(pg_temp.l('4225', '10', 'in')))$$,
  $$select pg_temp.adjust('e2012', 'waste', jsonb_build_array(pg_temp.l('4225', '110')))$$,
  $$select pg_temp.reverse('e2013', 'e2011')$$),
  '23001 stock_would_go_negative', 'a reversal that would take stock below nothing is held to D1 like any other');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e2014', 'waste', jsonb_build_array(pg_temp.l('4209', '1')))$$,
  $$select pg_temp.reverse('e2015', 'e2014')$$),
  'none', 'a write-off in a retired pack is reversed in that pack');
select is(pg_temp.after(
  $$select (item_unit_id = pg_temp.u('4210') and direction = 'in' and quantity = 1)::text from erp.stock_ledger where decision_id = pg_temp.u('e2017')$$,
  $$select pg_temp.adjust('e2016', 'waste', jsonb_build_array(pg_temp.l('4210', '1')))$$,
  $$select erp.retire_item_unit(pg_temp.u('e2018'), pg_temp.u('4210'), 'testing', pg_temp.u('900'), now())$$,
  $$select pg_temp.reverse('e2017', 'e2016')$$),
  'true', 'and one whose pack was retired since is reversed in the pack it named, never re-resolved (I-7)');

-- ---------------------------------------------------------------------------
-- A retry is answered as one, first (ADR-0005)
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal(
  $$select pg_temp.adjust('e2020', 'waste', jsonb_build_array(pg_temp.l('4225', '1')))$$,
  $$select pg_temp.adjust('e2020', 'waste', jsonb_build_array(pg_temp.l('4225', '1')))$$),
  '23505 stock_decision_pkey', 'an adjustment sent again is answered as already recorded');
select is(pg_temp.refusal(
  $$select pg_temp.count('e2021', jsonb_build_array(pg_temp.l('4225', '1')), now() - interval '1 hour')$$,
  $$select pg_temp.count('e2021', jsonb_build_array(pg_temp.l('4225', '1')), now() - interval '1 hour')$$),
  '23505 stock_decision_pkey', 'a count sent again too — before the rule its own first sending would now break');
select is(pg_temp.refusal(
  $$select pg_temp.reverse('e2022', '5703')$$,
  $$select pg_temp.reverse('e2022', '5703')$$),
  '23505 stock_decision_pkey', 'and a reversal — not "already reversed"');
select is(pg_temp.refusal(
  $$select pg_temp.adjust('e2023', 'waste', jsonb_build_array(pg_temp.l('4225', '1')))$$,
  $$select erp.decide_capability(pg_temp.u('e2024'), 'factory.production', null, 'withdrawn', 'testing', pg_temp.u('900'), 'administrator', now())$$,
  $$select erp.decide_capability(pg_temp.u('e2025'), 'inventory.stock', null, 'read_only', 'testing', pg_temp.u('900'), 'administrator', now())$$,
  $$select pg_temp.adjust('e2023', 'waste', jsonb_build_array(pg_temp.l('4225', '1')))$$),
  '23001 -', 'CONTROL: the gate comes before the retry check — a closed capability answers no one');

-- ---------------------------------------------------------------------------
-- The reads (CAP-P02, IAM-006): one facility at a time
-- ---------------------------------------------------------------------------

select is((select string_agg(code, ',' order by code) from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('403'))),
  'CL-SANITISER,FP-COLA-330,PK-MEAL-BOX-M,RM-CHK-BREAST,RM-FRYING-OIL,RM-RICE', 'the warehouse''s stock, by item code');
select is((select string_agg(code || '=' || on_hand, ',' order by code) from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('404'))),
  'RM-CHK-BREAST=-10,SF-CHK-STRIPS=172', 'CONTROL: the factory''s is its own: the same item, another balance');
select is((select string_agg(code, ',') from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('404'), null, null, 100, true)),
  'RM-CHK-BREAST', 'what stands below nothing, for the screen that lists it');
select is((select string_agg(code, ',' order by code) from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('403'), null, 'PK-MEAL-BOX-M', 2)),
  'RM-CHK-BREAST,RM-FRYING-OIL', 'paged by item code');
select is((select string_agg(code, ',') from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('403'), 'صدر')),
  'RM-CHK-BREAST', 'searched by an Arabic name');
select is((select u ->> 'factor' from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('403'), 'FP-COLA') s, jsonb_array_elements(s.units) u
            where u ->> 'status' = 'retired'), '12', 'with every pack, the retired one marked, factors as text');
select is(pg_temp.refusal($$select * from erp.stock_on_hand(pg_temp.u('900'), null)$$),
  '22023 stock_facility_required', 'CONTROL: an organisation-wide reader names a facility, or every one would mix');
select is(pg_temp.refusal($$select * from erp.stock_on_hand(pg_temp.u('904'), pg_temp.u('403'), null, null, 0)$$),
  '22023 stock_page_size', 'a page holds 1 to 500');
select is((select string_agg(kind || ':' || quantity_in || '/' || quantity_out || '/' || coalesce(counted::text, '-')
                             || ':' || coalesce(reversed_by_decision_id::text, '-'), ' ' order by seq desc)
             from erp.stock_history(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('4105'))),
  'reversal:5/0/-:- damage:0/5/-:01936f00-0000-7000-8000-000000005706 count:40/0/40:-',
  'an item''s stock card: newest first, what each moved and found, and what reversed what');
select is((select count(*)::int from erp.stock_history(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('4105'), null, 1)), 1,
  'paged');
select is(pg_temp.refusal($$select * from erp.stock_history(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('4112'))$$),
  'P0002 item_exists', 'another brand''s item is answered as a missing one');
select is((select jsonb_array_length(entries) || '/' || jsonb_array_length(counted) || '/' || (counted -> 0 ->> 'quantity')
             from erp.get_stock_decision(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('5701'))),
  '6/9/12', 'a decision whole: the opening count''s six variances and nine lines, quantities as text');
select is(pg_temp.refusal($$select * from erp.get_stock_decision(pg_temp.u('904'), pg_temp.u('404'), pg_temp.u('5701'))$$),
  'P0002 stock_decision_exists', 'CONTROL: read at another facility, it is answered as a missing one');

-- ---------------------------------------------------------------------------
-- Append-only, and the balance guard — they bind the owner too
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update erp.stock_decision set reason = 'rewritten' where decision_id = '01936f00-0000-7000-8000-000000005701' $$,
  '23001', 'stock_decision is append-only (INV-007): UPDATE denied on stock_decision',
  'a stock decision is never rewritten'
);
select throws_ok(
  $$ delete from erp.stock_ledger where decision_id = '01936f00-0000-7000-8000-000000005703' $$,
  '23001', 'stock_ledger is append-only (INV-007): DELETE denied on stock_ledger',
  'an entry is never deleted'
);
select throws_ok(
  $$ truncate erp.stock_count_log $$,
  '23001', 'stock_count_log is append-only (INV-007): TRUNCATE denied on stock_count_log',
  'nor what a count found'
);
select throws_ok(
  $$ delete from erp.stock_balance where facility_id = '01936f00-0000-7000-8000-000000000403' $$,
  '23001', 'a stock balance is never deleted: it is the sum of its ledger (I-8)',
  'a balance is never deleted'
);
select throws_ok(
  $$ update erp.stock_balance set facility_id = '01936f00-0000-7000-8000-000000000404'
     where facility_id = '01936f00-0000-7000-8000-000000000403' and item_id = '01936f00-0000-7000-8000-000000004111' $$,
  '23001', 'a stock balance stays the balance of its facility and item',
  'nor moved to another facility'
);
select throws_ok(
  $$ truncate erp.stock_balance $$,
  '23001', 'stock_balance is never deleted: it is the sum of its ledger (I-8). TRUNCATE denied',
  'nor truncated'
);
-- Structure, not code: what a seed or a later route could write is bound by keys and checks.
select throws_ok(
  $$ insert into erp.stock_ledger (decision_id, line_no, kind, facility_id, occurred_at, business_date, item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity)
     values ('01936f00-0000-7000-8000-000000005703', 2, 'waste', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-26 08:00:00+00', date '2026-09-26',
       '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004225', 'kg', 1, 'out', 1, 1) $$,
  '23503', null,
  'an entry dated otherwise than its decision is refused by the key that binds them'
);
select throws_ok(
  $$ insert into erp.stock_ledger (decision_id, line_no, kind, facility_id, occurred_at, business_date, item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity)
     values ('01936f00-0000-7000-8000-000000005703', 2, 'waste', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-26 07:00:00+00', date '2026-09-26',
       '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004225', 'kg', 1, 'in', 1, 1) $$,
  '23514', null,
  'a waste entry that puts stock in is refused by the table'
);
select throws_ok(
  $$ insert into erp.stock_ledger (decision_id, line_no, kind, facility_id, occurred_at, business_date, item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity)
     values ('01936f00-0000-7000-8000-000000005703', 2, 'waste', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-26 07:00:00+00', date '2026-09-26',
       '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004226', 'bag', 5, 'out', 1, 1) $$,
  '23514', null,
  'as is a base quantity that is not the quantity times the factor'
);
select throws_ok(
  $$ insert into erp.stock_decision (decision_id, kind, facility_id, occurred_at, business_date, reverses_decision_id, reason, actor_id, decided_at)
     values ('01936f00-0000-7000-8000-0000000e2026', 'reversal', '01936f00-0000-7000-8000-000000000403', now(),
       (now() at time zone 'Asia/Riyadh')::date, '01936f00-0000-7000-8000-000000005703', 'testing', '01936f00-0000-7000-8000-000000000900', now()) $$,
  '23503', null,
  'a reversal dated "now" rather than at its target''s moment is refused by the key that binds them'
);

-- ---------------------------------------------------------------------------
-- LAST: the cases that COMMIT under db-fixtures. Fresh ids; nothing above reads them.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select erp.record_stock_count('01936f00-0000-7000-8000-0000000e2027'::uuid, '01936f00-0000-7000-8000-000000000404'::uuid, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004203", "quantity": "3"}]'::jsonb, 'Settling the negative after the delivery.', '01936f00-0000-7000-8000-000000000908'::uuid, now()) $$,
  'the factory manager counts the chicken at the factory'
);
select is((select on_hand from erp.stock_balance where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4101')), 30::numeric,
  'and the count settles the negative at what was found');
select lives_ok(
  $$ select erp.record_stock_adjustment('01936f00-0000-7000-8000-0000000e2028'::uuid, '01936f00-0000-7000-8000-000000000403'::uuid, 'damage', null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004226", "quantity": "1"}]'::jsonb, 'Torn bag.', null, '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  'the warehouse manager records a damaged bag of rice'
);
select is((select (kind, override_reason is null, business_date = (occurred_at at time zone 'Asia/Riyadh')::date)::text
             from erp.stock_decision where decision_id = pg_temp.u('e2028')),
  '(damage,t,t)', 'recorded directly, with no second person (D2), on its Riyadh business day');

select * from finish();
rollback;
