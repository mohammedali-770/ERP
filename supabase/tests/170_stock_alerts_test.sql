-- pgTAP · stock alerts: a minimum per item at a warehouse or a factory, and the bell when a
-- movement takes stock to it
--
-- 0022 is module 7: minimums as decisions in an append-only log, projected per facility and
-- item; a list of what is at or below its minimum; and a second kind of notification, rung
-- once per drop, with the person who moved the stock told too (ADR-0031, A1–A3). Cases
-- marked CONTROL are why the suite exists.
--
-- ORDER MATTERS, as in 150 and 160: every stateful case runs inside pg_temp.after() or
-- pg_temp.refusal(), which roll back whatever they did.
--
-- The seed (0075): at WH-001 (…0403), chicken breast (RM-CHK-BREAST, …4101: kg …4201,
-- cartons of 10 …4203) has 121.5 kg on hand and a minimum of 10 cartons, 100 kg — not low;
-- sanitiser (…4105) 40 l against 50 — low; rice (…4111) a minimum set, then cleared. At
-- FA-001 (…0404), chicken strips (…4102) 172 against 200, and chicken breast -10 against
-- 20 — both low. The administrator (…0900) and the warehouse manager (…0904) read and set
-- minimums everywhere; the factory manager (…0908) at FA-001 alone; a branch worker
-- (…0901) reads stock at their branch and nothing here; the accountant (…0907) reads no
-- stock.
--
-- Fixture ids are …0e22NN, a range no seed row and no other suite uses.

begin;
select plan(65);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function pg_temp.u(p text) returns uuid language sql immutable as $f$
  select ('01936f00-0000-7000-8000-' || lpad(p, 12, '0'))::uuid
$f$;

create function pg_temp.l(p_unit text, p_qty text, p_dir text default null) returns jsonb language sql immutable as $f$
  select jsonb_build_object('item_unit_id', pg_temp.u(p_unit), 'quantity', p_qty)
         || case when p_dir is null then '{}'::jsonb else jsonb_build_object('direction', p_dir) end
$f$;

create function pg_temp.adjust(p_id text, p_kind text, p_lines jsonb, p_actor text, p_facility text,
                               p_override text default null)
returns void language plpgsql as $f$
begin
  perform erp.record_stock_adjustment(pg_temp.u(p_id), pg_temp.u(p_facility), p_kind, null, p_lines, 'testing',
                                      p_override, pg_temp.u(p_actor), now());
end
$f$;

-- Waste at WH-001, by the warehouse manager unless said.
create function pg_temp.waste(p_id text, p_unit text, p_qty text, p_actor text default '904') returns void
language sql as $f$
  select pg_temp.adjust(p_id, 'waste', jsonb_build_array(pg_temp.l(p_unit, p_qty)), p_actor, '403')
$f$;

create function pg_temp.set_min(p_id text, p_facility text, p_unit text, p_qty text, p_expected text,
                                p_actor text default '904', p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.set_stock_minimum(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_unit), p_qty,
                                case when p_expected is null then null else pg_temp.u(p_expected) end,
                                p_reason, pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.clear_min(p_id text, p_facility text, p_item text, p_expected text,
                                  p_actor text default '904')
returns void language plpgsql as $f$
begin
  perform erp.clear_stock_minimum(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_item),
                                  case when p_expected is null then null else pg_temp.u(p_expected) end,
                                  'testing', pg_temp.u(p_actor), now());
end
$f$;

-- Who was told stock was low by a decision: their ids' last three digits, in order.
create function pg_temp.told(p_decision text, p_kind text default 'stock_low') returns text language sql as $f$
  select coalesce(string_agg(right(n.recipient_id::text, 3), ',' order by n.recipient_id), '')
    from erp.notification n where n.stock_decision_id = pg_temp.u(p_decision) and n.kind = p_kind
$f$;

create function pg_temp.low_count() returns integer language sql as $f$
  select count(*)::integer from erp.notification n where n.kind = 'stock_low'
$f$;

create function pg_temp.set_state(p_capability text, p_facility text, p_state text, p_decision text)
returns void language sql as $f$
  insert into erp.capability_decision (decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at)
  values (pg_temp.u(p_decision), p_capability, pg_temp.u(p_facility), p_state, 'testing', pg_temp.u('900'), 'administrator', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values (p_capability, pg_temp.u(p_facility), p_state, pg_temp.u(p_decision))
  on conflict (capability_key, facility_id) do update set state = excluded.state, as_of_decision_id = excluded.as_of_decision_id;
$f$;

-- The minimum in force for an item at a facility, as text, or 'none'.
create function pg_temp.minimum(p_facility text, p_item text) returns text language sql as $f$
  select coalesce((select coalesce(trim_scale(m.minimum)::text, 'cleared') from erp.stock_minimum m
                    where m.facility_id = pg_temp.u(p_facility) and m.item_id = pg_temp.u(p_item)), 'none')
$f$;

create function pg_temp.refusal(variadic p_sql text[]) returns text language plpgsql as $f$
declare
  s text;
  v_state text;
  v_constraint text;
begin
  foreach s in array p_sql loop execute s; end loop;
  raise exception 'no refusal' using errcode = 'P0099';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
  if v_state = 'P0099' then return 'none'; end if;
  return v_state || ' ' || coalesce(nullif(v_constraint, ''), '-');
end
$f$;

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
-- Structure and privilege
-- ---------------------------------------------------------------------------

select has_table('erp', 'stock_minimum_decision', 'erp.stock_minimum_decision exists');
select has_table('erp', 'stock_minimum', 'erp.stock_minimum exists');
select fk_ok('erp', 'stock_minimum', 'as_of_decision_id', 'erp', 'stock_minimum_decision', 'decision_id',
  'a minimum names the decision that set it (I-8)');
select is(has_table_privilege('erp_app', 'erp.stock_minimum_decision', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('erp_app', 'erp.stock_minimum', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime has no privilege on either table');
select ok(has_function_privilege('erp_app', 'erp.set_stock_minimum(uuid,uuid,uuid,text,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.clear_stock_minimum(uuid,uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.stock_minimums(uuid,uuid,boolean,text,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.stock_minimum_history(uuid,uuid,uuid,bigint,integer)', 'EXECUTE'),
  'the runtime calls the four routes');
select is(has_function_privilege('erp_app', 'erp.notify_stock_low()', 'EXECUTE')
       or has_function_privilege('erp_app', 'erp.assert_stock_minimum_decision_is_new(uuid)', 'EXECUTE')
       or has_function_privilege('erp_app', 'erp.assert_stock_minimum_facility(uuid)', 'EXECUTE')
       or has_function_privilege('erp_app', 'erp.stock_minimum_is_fixed()', 'EXECUTE'), false,
  'CONTROL: not the producer, the guard or the helpers');
select ok(exists (select 1 from erp.capability where capability_key = 'inventory.stock_alerts')
      and (select count(*) from erp.role_permission
            where role_key = 'administrator' and capability_key = 'inventory.stock_alerts') = 2,
  'the capability is registered, and the administrator reads and sets minimums');
select is((select count(*)::int from erp.notification), 0, 'the seed makes no notification');

-- ---------------------------------------------------------------------------
-- The list (A2): what has a minimum, and what is at or below it
-- ---------------------------------------------------------------------------

select is((select string_agg(code || ':' || trim_scale(minimum) || ':' || trim_scale(on_hand) || ':' || is_low, ' ' order by code)
             from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403'))),
  'CL-SANITISER:50:40:true RM-CHK-BREAST:100:121.5:false',
  'at the warehouse: sanitiser is low, chicken is not, and rice, whose minimum was cleared, is not listed');
select is((select string_agg(code, ' ' order by code) from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403'), true)),
  'CL-SANITISER', 'the low ones alone');
select is((select string_agg(code || ':' || is_low, ' ' order by code) from erp.stock_minimums(pg_temp.u('908'), pg_temp.u('404'))),
  'RM-CHK-BREAST:true SF-CHK-STRIPS:true', 'at the factory, to its manager: both low, one below zero');
select is((select unit_key || ':' || quantity from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403')) where code = 'RM-CHK-BREAST'),
  'carton:10', 'a minimum is shown as entered, in its pack (I-7)');
select is(pg_temp.after($$select (select trim_scale(on_hand) || ':' || is_low from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403'))
                                   where code = 'OP-GLOVES')$$,
                        $$select pg_temp.set_min('e2201', '403', '4217', '3', null)$$),
  '0:true', 'an item never moved here has none on hand, so a minimum makes it low at once');
select is(pg_temp.refusal($$select * from erp.stock_minimums(pg_temp.u('907'), pg_temp.u('403'))$$), '23001 -',
  'CONTROL: the accountant, who reads no stock, reads no minimums');
select is(pg_temp.refusal($$select * from erp.stock_minimums(pg_temp.u('900'), null)$$), '22023 stock_facility_required',
  'CONTROL: the list is for one facility, even to the administrator');

-- ---------------------------------------------------------------------------
-- The log and the projection hold
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$update erp.stock_minimum_decision set reason = 'x'$$), '23001 -', 'the log refuses UPDATE');
select is(pg_temp.refusal($$delete from erp.stock_minimum_decision$$), '23001 -', 'the log refuses DELETE');
select is(pg_temp.refusal($$truncate erp.stock_minimum_decision cascade$$), '23001 -', 'the log refuses TRUNCATE');
select is(pg_temp.refusal($$delete from erp.stock_minimum$$), '23001 stock_minimum_never_deleted',
  'a minimum is never deleted: it is cleared');
select is(pg_temp.refusal($$truncate erp.stock_minimum$$), '23001 -', 'nor truncated');
select is(pg_temp.refusal($$update erp.stock_minimum set item_id = pg_temp.u('4105') where item_id = pg_temp.u('4101')
                                                     and facility_id = pg_temp.u('404')$$),
  '23001 stock_minimum_fixed', 'a minimum stays the minimum of its facility and item');

-- ---------------------------------------------------------------------------
-- Setting a minimum
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select pg_temp.minimum('403', '4101') || ' ' || d.unit_key || ' ' || trim_scale(d.quantity) || ' ' || d.actor_id::text
      from erp.stock_minimum_decision d where d.decision_id = pg_temp.u('e2202')$$,
  $$select pg_temp.set_min('e2202', '403', '4203', '2.5', '5801')$$),
  '25 carton 2.5 01936f00-0000-7000-8000-000000000904',
  'a minimum is kept as entered and in the base unit: 2.5 cartons of 10 kg is 25 kg, with who set it');
select is(pg_temp.refusal($$select pg_temp.set_min('e2203', '403', '4201', '0', '5801')$$), '23514 stock_minimum_is_valid',
  'CONTROL: a minimum is more than nothing — in the warehouse 0 meant none; here, none is cleared');
select is(pg_temp.refusal($$select pg_temp.set_min('e2204', '403', '4201', '80', null)$$), '23001 stock_minimum_stale',
  'CONTROL: a form that read no minimum where one has since been set is stale');
select is(pg_temp.refusal($$select pg_temp.set_min('e2205', '403', '4201', '80', '5802')$$), '23001 stock_minimum_stale',
  'a stamp of another item''s minimum is stale too');
select is(pg_temp.refusal($$select pg_temp.set_min('e2206', '403', '4201', '100', '5801')$$), '23001 stock_minimum_unchanged',
  'CONTROL: 100 kg is the 10 cartons already in force: nothing is recorded');
select is(pg_temp.refusal($$select pg_temp.set_min('e2207', '403', '4201', '80', '5801')$$,
                          $$select pg_temp.set_min('e2207', '403', '4201', '80', '5801')$$),
  '23505 stock_minimum_decision_pkey', 'a retry is answered as a retry');
select is(pg_temp.refusal($$select pg_temp.set_min('e2208', '403', '4201', '80', '5801')$$,
                          $$select pg_temp.set_min('e2208', '403', '4201', '70', '5801')$$),
  '23505 stock_minimum_decision_pkey', 'CONTROL: before the stale check its own first attempt would now fail');
select is(pg_temp.refusal($$select pg_temp.set_min('e2209', '403', '4227', '5', null)$$), 'P0002 item_unit_exists',
  'CONTROL: another brand''s pack answers as a missing one (ADR-0012)');
select is(pg_temp.refusal($$select pg_temp.set_min('e2210', '403', '4209', '5', null)$$), '23001 stock_minimum_pack_is_retired',
  'a minimum is entered in a current pack: the retired carton of 12 is refused');
select is(pg_temp.refusal($$select pg_temp.set_min('e2211', '403', '4222', '5', null)$$), '23001 item_admits_no_new_work',
  'a retired item takes no new minimum');
select is(pg_temp.refusal($$select pg_temp.set_min('e2212', '403', '4201', '-1', '5801')$$),
  '23514 stock_minimum_is_valid', 'a minimum is not negative');
select is(pg_temp.refusal($$select pg_temp.set_min('e2213', '403', '4201', '1.1234567', '5801')$$),
  '23514 stock_minimum_is_valid', 'nor past six places');
select is(pg_temp.refusal($$select pg_temp.set_min('e2214', '403', '4202', '0.000001', '5801')$$),
  '23514 stock_minimum_inexact', 'nor past six places in the base unit: a millionth of a gram');
select is(pg_temp.refusal($$select pg_temp.set_min('e2215', '403', '4201', '80', '5801', '904', ' ')$$),
  '23514 stock_minimum_reason_is_stated', 'a minimum states why');
select is(pg_temp.refusal($$select pg_temp.set_min('e2216', '401', '4201', '80', null, '900')$$),
  '23001 stock_branch_business_day_undecided', 'CONTROL: a branch holds no stock record, so no minimum (Q-06)');
select is(pg_temp.refusal($$select pg_temp.set_min('e2217', '403', '4201', '80', '5801', '908')$$), '23001 -',
  'CONTROL: the factory manager sets minimums at the factory, not at the warehouse (IAM-006)');
select is(pg_temp.refusal($$select pg_temp.set_min('e2218', '401', '4201', '80', null, '901')$$), '23001 -',
  'a branch worker, who reads stock, sets no minimum');
select is(pg_temp.after($$select pg_temp.minimum('404', '4102')$$, $$select pg_temp.set_min('e2219', '404', '4207', '4', '5805', '908')$$),
  '160', 'the factory manager sets one at the factory: 4 trays of 40');

-- ---------------------------------------------------------------------------
-- Clearing one, and the history
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select pg_temp.minimum('403', '4101') || ' ' || (select count(*) from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403'))
                                                     where code = 'RM-CHK-BREAST')$$,
  $$select pg_temp.clear_min('e2220', '403', '4101', '5801')$$),
  'cleared 0', 'a cleared minimum stays a row, stamped, and is no longer listed');
select is(pg_temp.refusal($$select pg_temp.clear_min('e2221', '403', '4111', '5804')$$), '23001 stock_minimum_not_set',
  'rice''s minimum is already cleared');
select is(pg_temp.refusal($$select pg_temp.clear_min('e2222', '403', '4101', null)$$), '23001 stock_minimum_stale',
  'clearing is checked against what was read, too');
select is(pg_temp.refusal($$select pg_temp.clear_min('e2223', '403', '4112', null)$$), 'P0002 item_exists',
  'CONTROL: another brand''s item answers as a missing one');
select is((select string_agg(kind || ':' || coalesce(trim_scale(minimum)::text, '-') || ':' || is_current, ' ' order by seq desc)
             from erp.stock_minimum_history(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('4111'))),
  'minimum_cleared:-:true minimum_set:100:false', 'rice''s history, newest first: cleared, after 20 bags');
select is(pg_temp.refusal($$select * from erp.stock_minimum_history(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('4112'))$$),
  'P0002 item_exists', 'nor is its history read');

-- ---------------------------------------------------------------------------
-- The bell (A2, A3): once per drop, the actor told
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$select pg_temp.told('e2230')$$, $$select pg_temp.waste('e2230', '4203', '3')$$),
  '900,904',
  'CONTROL: 3 cartons out takes chicken from 121.5 kg to 91.5, past its 100: the administrator, and the warehouse manager who moved it (A3)');
select is(pg_temp.after(
  $$select n.data::text from erp.notification n where n.stock_decision_id = pg_temp.u('e2231') and n.recipient_id = pg_temp.u('904')$$,
  $$select pg_temp.waste('e2231', '4203', '3')$$),
  '{"items": [{"item_id": "01936f00-0000-7000-8000-000000004101", "minimum": "100", "on_hand": "91.5"}]}',
  'it holds the item, the balance left and the minimum crossed: ids and quantities only');
select is(pg_temp.after($$select pg_temp.told('e2233')$$,
                        $$select pg_temp.waste('e2232', '4203', '3')$$, $$select pg_temp.waste('e2233', '4203', '1')$$),
  '', 'CONTROL: once per drop — a second movement while low tells nobody');
select is(pg_temp.after($$select pg_temp.told('e2236')$$,
                        $$select pg_temp.waste('e2234', '4203', '3')$$,
                        $$select pg_temp.adjust('e2235', 'adjustment', jsonb_build_array(pg_temp.l('4203', '4', 'in')), '904', '403')$$,
                        $$select pg_temp.waste('e2236', '4203', '4')$$),
  '900,904', 'back above, then down again: it rings again');
select is(pg_temp.after($$select pg_temp.told('e2237')$$, $$select pg_temp.waste('e2237', '4201', '21.5')$$),
  '900,904', 'to exactly the minimum is at it, and rings');
select is(pg_temp.after($$select pg_temp.low_count()::text$$, $$select pg_temp.waste('e2238', '4201', '21.4')$$),
  '0', 'CONTROL: a tenth of a kilogram above it rings nothing');
select is(pg_temp.after($$select pg_temp.low_count()::text || ' ' || (select is_low from erp.stock_minimums(pg_temp.u('904'), pg_temp.u('403')) where code = 'RM-CHK-BREAST')$$,
                        $$select pg_temp.set_min('e2239', '403', '4201', '150', '5801')$$),
  '0 true', 'a minimum raised above the balance rings nothing, and lists it low at once (A2)');
select is(pg_temp.after($$select pg_temp.told('e2240')$$,
                        $$select pg_temp.set_min('e2239', '403', '4201', '50', '5801')$$, $$select pg_temp.waste('e2240', '4203', '3')$$),
  '', 'a movement is judged against the minimum in force: 91.5 kg is above a lowered 50');
select is(pg_temp.after($$select pg_temp.told('e2242')$$,
                        $$select pg_temp.adjust('e2241', 'adjustment', jsonb_build_array(pg_temp.l('4201', '30', 'in')), '904', '403')$$,
                        $$select erp.reverse_stock_decision(pg_temp.u('e2242'), pg_temp.u('403'), pg_temp.u('e2241'), 'testing', null, pg_temp.u('904'), now())$$,
                        $$select pg_temp.waste('e2243', '4203', '3')$$),
  '', 'a reversal back to where it was crosses nothing');
select is(pg_temp.after($$select pg_temp.told('e2245')$$,
                        $$select pg_temp.adjust('e2244', 'adjustment', jsonb_build_array(pg_temp.l('4203', '3', 'out')), '904', '403')$$,
                        $$select pg_temp.adjust('e2246', 'adjustment', jsonb_build_array(pg_temp.l('4203', '3', 'in')), '904', '403')$$,
                        $$select erp.reverse_stock_decision(pg_temp.u('e2245'), pg_temp.u('403'), pg_temp.u('e2246'), 'testing', null, pg_temp.u('904'), now())$$),
  '900,904', 'a reversal that takes it back down rings, as any movement out');
select is(pg_temp.after($$select pg_temp.told('e2247')$$,
                        $$select erp.record_stock_count(pg_temp.u('e2247'), pg_temp.u('403'), null,
                                   jsonb_build_array(pg_temp.l('4201', '60')), 'testing', pg_temp.u('904'), now())$$),
  '900,904', 'a count that finds less than the minimum rings');
select is(pg_temp.after($$select pg_temp.told('e2248') || ' / ' || pg_temp.told('e2248', 'stock_below_zero')$$,
                        $$select pg_temp.adjust('e2248', 'waste', jsonb_build_array(pg_temp.l('4201', '130')), '900', '403', 'Delivery not entered.')$$),
  '900,904 / 904',
  'CONTROL: an override past zero tells the actor it is low, and everyone else that it is below zero too (A3, 0021)');
select is(pg_temp.after(
  $$select (select string_agg(x ->> 'item_id', ' ' order by o) from erp.notification n,
              jsonb_array_elements(n.data -> 'items') with ordinality as e(x, o)
             where n.stock_decision_id = pg_temp.u('e2250') and n.recipient_id = pg_temp.u('904'))
           || ' ' || pg_temp.low_count()$$,
  $$select pg_temp.set_min('e2249', '403', '4211', '450', null)$$,
  $$select pg_temp.adjust('e2250', 'waste', jsonb_build_array(pg_temp.l('4203', '3'), pg_temp.l('4211', '60')), '904', '403')$$),
  '01936f00-0000-7000-8000-000000004104 01936f00-0000-7000-8000-000000004101 2',
  'one decision taking two items across tells each person once, naming both by code');
select is(pg_temp.after($$select pg_temp.told('e2252')$$,
                        $$delete from erp.role_permission where role_key = 'warehouse_manager'
                            and capability_key = 'inventory.stock_alerts' and action = 'read'$$,
                        $$select pg_temp.waste('e2252', '4203', '3')$$),
  '900', 'CONTROL: the warehouse manager, still reading stock but not its alerts, is not told');
select is(pg_temp.after($$select pg_temp.low_count()::text$$,
                        $$select pg_temp.set_state('inventory.stock_alerts', '403', 'hidden', 'e2253')$$,
                        $$select pg_temp.waste('e2254', '4203', '3')$$),
  '0', 'stock alerts hidden at the warehouse: nobody is told');
select is(pg_temp.after($$select pg_temp.told('e2255')$$,
                        $$select pg_temp.adjust('e2255', 'waste', jsonb_build_array(pg_temp.l('4207', '1')), '908', '404')$$),
  '', 'the factory''s strips are already low: a further drop tells nobody');

-- ---------------------------------------------------------------------------
-- On the bell
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select kind || ' ' || (items -> 0 ->> 'code') || ' ' || (items -> 0 ->> 'on_hand') || ' ' || (items -> 0 ->> 'minimum')
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'))$$,
  $$select pg_temp.waste('e2256', '4203', '3')$$),
  'stock_low RM-CHK-BREAST 91.5 100', 'the bell names the item now, the balance it was left at and the minimum it crossed');
select is(pg_temp.after(
  $$select string_agg(kind || ':' || ((items -> 0) ? 'minimum')::text, ' ' order by kind)
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'))$$,
  $$select pg_temp.adjust('e2257', 'waste', jsonb_build_array(pg_temp.l('4201', '130')), '900', '403', 'Delivery not entered.')$$),
  'stock_below_zero:false stock_low:true', 'a below-zero notification reads as it did before: no minimum');
select is(pg_temp.after(
  $$select erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text || ' '
        || (select count(*) from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403')))$$,
  $$select pg_temp.waste('e2258', '4203', '3')$$,
  $$delete from erp.role_permission where role_key = 'warehouse_manager'
      and capability_key = 'inventory.stock_alerts' and action = 'read'$$),
  '0 0', 'one who can no longer read stock alerts is no longer shown or counted it (SUP-007)');
select is(pg_temp.refusal($$insert into erp.notification (kind, recipient_id, facility_id, data)
                            values ('stock_low', pg_temp.u('904'), pg_temp.u('403'), '{}')$$),
  '23514 notification_names_its_source', 'a low-stock notification names the decision it is about');

select * from finish();
rollback;
