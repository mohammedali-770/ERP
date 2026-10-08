-- pgTAP · ordering setup: which facility supplies branches with an item, a cut-off per
-- supplying facility, and a par level per branch per item
--
-- 0024 is module 9: three settings, each decisions in an append-only log projected as the
-- setting in force; and erp.order_day(), the seam module 10 dates its orders by (ADR-0033,
-- O1–O5). Cases marked CONTROL are why the suite exists.
--
-- ORDER MATTERS, as in 150 to 180: every stateful case runs inside pg_temp.after() or
-- pg_temp.refusal(), which roll back whatever they did.
--
-- The seed (0085): WH-001 (…0403) supplies chicken breast (RM-CHK-BREAST, …4101: kg …4201,
-- g …4202, cartons of 10 …4203), the cola (…4103: the retired carton of 12 …4209, the
-- carton of 24 …4210), the meal boxes (…4104), the sanitiser (…4105) and the rice (…4111,
-- bags of 5 …4226); FA-001 (…0404) the chicken strips (…4102: trays of 40 …4207). The
-- gloves' (…4106) source was cleared (…6208); the frying oil (…4110) never had one; the old
-- frying oil (…4109) is retired. Cut-offs: WH-001 14:00 (…6211), FA-001 11:00 (…6213, after
-- 10:30). Pars at BR-001 (…0401): chicken 3 cartons (…6221), strips 2 trays (…6222), cola
-- 2 cartons (…6223); at BR-002 (…0402): chicken 20 kg (…6224), rice cleared (…6226).
--
-- Who: the administrator (…0900) sets everything; the warehouse manager (…0904),
-- organisation-wide, sets pars and reads the rest; the factory manager (…0908), at FA-001
-- alone, sets the pars of what FA-001 supplies; branch workers (…0901 at BR-001, …0903 at
-- BR-002) read their own branch; the accountant (…0907) holds nothing here.
--
-- Fixture ids are …0e24NN, a range no seed row and no other suite uses. Riyadh is three
-- hours ahead of UTC.

begin;
select plan(156);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function pg_temp.u(p text) returns uuid language sql immutable as $f$
  select case when p is null then null else ('01936f00-0000-7000-8000-' || lpad(p, 12, '0'))::uuid end
$f$;

create function pg_temp.set_source(p_id text, p_item text, p_facility text, p_expected text,
                                   p_actor text default '900', p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.set_replenishment_source(pg_temp.u(p_id), pg_temp.u(p_item), pg_temp.u(p_facility),
                                       pg_temp.u(p_expected), p_reason, pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.clear_source(p_id text, p_item text, p_expected text, p_actor text default '900')
returns void language plpgsql as $f$
begin
  perform erp.clear_replenishment_source(pg_temp.u(p_id), pg_temp.u(p_item), pg_temp.u(p_expected),
                                         'testing', pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.set_cutoff(p_id text, p_facility text, p_cutoff text, p_expected text,
                                   p_actor text default '900', p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.set_order_cutoff(pg_temp.u(p_id), pg_temp.u(p_facility), p_cutoff, pg_temp.u(p_expected),
                               p_reason, pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.clear_cutoff(p_id text, p_facility text, p_expected text, p_actor text default '900')
returns void language plpgsql as $f$
begin
  perform erp.clear_order_cutoff(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_expected),
                                 'testing', pg_temp.u(p_actor), now());
end
$f$;

-- p_from is where the par is set from: the supplying facility, or NULL for the organisation.
create function pg_temp.set_par(p_id text, p_from text, p_branch text, p_unit text, p_qty text, p_expected text,
                                p_actor text default '904', p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.set_par_level(pg_temp.u(p_id), pg_temp.u(p_from), pg_temp.u(p_branch), pg_temp.u(p_unit), p_qty,
                            pg_temp.u(p_expected), p_reason, pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.clear_par(p_id text, p_from text, p_branch text, p_item text, p_expected text,
                                  p_actor text default '904')
returns void language plpgsql as $f$
begin
  perform erp.clear_par_level(pg_temp.u(p_id), pg_temp.u(p_from), pg_temp.u(p_branch), pg_temp.u(p_item),
                              pg_temp.u(p_expected), 'testing', pg_temp.u(p_actor), now());
end
$f$;

-- The setting in force, as text: 'none' with no row, 'cleared' with an empty one.
create function pg_temp.source(p_item text) returns text language sql as $f$
  select coalesce((select coalesce(f.code, 'cleared') from erp.replenishment_source s
                     left join erp.facility f on f.facility_id = s.facility_id
                    where s.item_id = pg_temp.u(p_item)), 'none')
$f$;

create function pg_temp.cutoff(p_facility text) returns text language sql as $f$
  select coalesce((select coalesce(left(c.cutoff::text, 5), 'cleared') from erp.order_cutoff c
                    where c.facility_id = pg_temp.u(p_facility)), 'none')
$f$;

create function pg_temp.par(p_branch text, p_item text) returns text language sql as $f$
  select coalesce((select coalesce(trim_scale(m.par)::text, 'cleared') from erp.par_level m
                    where m.facility_id = pg_temp.u(p_branch) and m.item_id = pg_temp.u(p_item)), 'none')
$f$;

-- The rule alone: the day an order placed at p_at, at a facility in Riyadh, is for.
create function pg_temp.rule(p_at timestamptz, p_cutoff text, p_tz text default 'Asia/Riyadh') returns text
language sql as $f$
  select erp.order_day_for(p_at, p_tz, p_cutoff::time)::text
$f$;

-- What erp.order_day() gives now, as 'offset:decision': how many days after the date in
-- Riyadh at the moment it placed the order, and the last four digits of the cut-off
-- decision it names. Its moment must be the clock, read after the transaction began: never
-- now(), the transaction's start, which an order that waited behind a cut-off change would
-- be dated by.
create function pg_temp.day(p_facility text) returns text language sql as $f$
  select case when d.placed_at > now() then '' else 'placed at the transaction''s start:' end
         || (d.for_date - (d.placed_at at time zone 'Asia/Riyadh')::date)::text || ':'
         || coalesce(right(d.cutoff_decision_id::text, 4), 'none')
    from erp.order_day(pg_temp.u(p_facility)) d
$f$;

-- A second brand's operating unit, warehouse and branch, the branch closed: the seed's second
-- brand owns no facility (0010).
create function pg_temp.second_brand() returns void language plpgsql as $f$
begin
  insert into erp.operating_unit (operating_unit_id, brand_id, code, name_en, name_ar)
  values (pg_temp.u('e2491'), pg_temp.u('202'), 'OU-E24', 'Probe region', 'منطقة تجريبية');
  perform erp.create_facility(pg_temp.u('e2492'), pg_temp.u('e2493'), pg_temp.u('e2491'), 'warehouse',
                              'WH-E24B', 'Probe warehouse', 'مستودع تجريبي', null, null, 'testing', pg_temp.u('900'), now());
  perform erp.create_facility(pg_temp.u('e2494'), pg_temp.u('e2495'), pg_temp.u('e2491'), 'branch',
                              'BR-E24B', 'Probe branch', 'فرع تجريبي', null, null, 'testing', pg_temp.u('900'), now());
  perform erp.change_facility_status(pg_temp.u('e2496'), pg_temp.u('e2495'), pg_temp.u('e2494'), 'closed',
                                     'testing', pg_temp.u('900'), now());
end
$f$;

-- A capability's state at a facility, or organisation-wide when p_facility is NULL.
create function pg_temp.set_state(p_capability text, p_facility text, p_state text, p_decision text)
returns void language sql as $f$
  insert into erp.capability_decision (decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at)
  values (pg_temp.u(p_decision), p_capability, pg_temp.u(p_facility), p_state, 'testing', pg_temp.u('900'), 'administrator', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values (p_capability, coalesce(pg_temp.u(p_facility), erp.capability_org_scope()), p_state, pg_temp.u(p_decision))
  on conflict (capability_key, facility_id) do update set state = excluded.state, as_of_decision_id = excluded.as_of_decision_id;
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

-- A refusal on the way is the case's answer, so it fails that case by name rather than
-- aborting the suite.
create function pg_temp.after(p_read text, variadic p_sql text[]) returns text language plpgsql as $f$
declare
  s text;
  v_out text;
  v_state text;
  v_constraint text;
begin
  foreach s in array p_sql loop execute s; end loop;
  execute p_read into v_out;
  raise exception 'roll back' using errcode = 'P0099';
exception
  when sqlstate 'P0099' then
    return v_out;
  when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    return 'refused ' || v_state || ' ' || coalesce(nullif(v_constraint, ''), '-');
end
$f$;

-- ---------------------------------------------------------------------------
-- Structure and privilege
-- ---------------------------------------------------------------------------

select has_table('erp', 'replenishment_source_decision', 'erp.replenishment_source_decision exists');
select has_table('erp', 'replenishment_source', 'erp.replenishment_source exists');
select has_table('erp', 'order_cutoff_decision', 'erp.order_cutoff_decision exists');
select has_table('erp', 'order_cutoff', 'erp.order_cutoff exists');
select has_table('erp', 'par_level_decision', 'erp.par_level_decision exists');
select has_table('erp', 'par_level', 'erp.par_level exists');
select fk_ok('erp', 'replenishment_source', 'as_of_decision_id', 'erp', 'replenishment_source_decision', 'decision_id',
  'a source names the decision that set it (I-8)');
select fk_ok('erp', 'order_cutoff', 'as_of_decision_id', 'erp', 'order_cutoff_decision', 'decision_id',
  'a cut-off names the decision that set it (I-8)');
select fk_ok('erp', 'par_level', 'as_of_decision_id', 'erp', 'par_level_decision', 'decision_id',
  'a par names the decision that set it (I-8)');
select is((select count(*)::int from unnest(array['replenishment_source_decision', 'replenishment_source',
                                                  'order_cutoff_decision', 'order_cutoff',
                                                  'par_level_decision', 'par_level']) t
            where has_table_privilege('erp_app', 'erp.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 0,
  'the runtime has no privilege on any of the six tables');
select ok(has_function_privilege('erp_app', 'erp.set_replenishment_source(uuid,uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.clear_replenishment_source(uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.set_order_cutoff(uuid,uuid,text,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.clear_order_cutoff(uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.set_par_level(uuid,uuid,uuid,uuid,text,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.clear_par_level(uuid,uuid,uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.replenishment_sources(uuid,uuid,uuid,text,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.replenishment_source_history(uuid,uuid,uuid,bigint,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.order_cutoffs(uuid,uuid,text,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.order_cutoff_history(uuid,uuid,bigint,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.par_levels(uuid,uuid,uuid,text,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.par_level_history(uuid,uuid,uuid,uuid,bigint,integer)', 'EXECUTE'),
  'the runtime calls the twelve routes');
select is((select coalesce(string_agg(p.proname, ' ' order by p.proname), '') from pg_proc p
            where p.pronamespace = 'erp'::regnamespace
              and p.proname in ('order_day', 'order_day_for', 'assert_supplying_facility', 'assert_par_branch',
                                'assert_par_read', 'assert_par_set_from', 'apply_par_level',
                                'assert_replenishment_source_decision_is_new', 'assert_order_cutoff_decision_is_new',
                                'assert_par_level_decision_is_new', 'ordering_setting_is_fixed', 'ordering_log_is_append_only')
              and has_function_privilege('erp_app', p.oid, 'EXECUTE')), '',
  'CONTROL: not the seam, the helpers or the guards, in any overload — module 10 calls erp.order_day() from its own route');
select ok((select count(*) from erp.capability where capability_key in ('ordering.setup', 'ordering.par_levels')) = 2
      and (select count(*) from erp.role_permission
            where role_key = 'administrator' and capability_key in ('ordering.setup', 'ordering.par_levels')) = 4,
  'both capabilities are registered, and the administrator reads and writes both');

-- ---------------------------------------------------------------------------
-- The logs and the projections hold
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$update erp.replenishment_source_decision set reason = 'x'$$), '23001 -',
  'the source log refuses UPDATE');
select is(pg_temp.refusal($$delete from erp.replenishment_source_decision$$), '23001 -', 'and DELETE');
select is(pg_temp.refusal($$truncate erp.replenishment_source_decision cascade$$), '23001 -', 'and TRUNCATE');
select is(pg_temp.refusal($$update erp.order_cutoff_decision set reason = 'x'$$), '23001 -',
  'the cut-off log refuses UPDATE');
select is(pg_temp.refusal($$delete from erp.order_cutoff_decision$$), '23001 -', 'and DELETE');
select is(pg_temp.refusal($$truncate erp.order_cutoff_decision cascade$$), '23001 -', 'and TRUNCATE');
select is(pg_temp.refusal($$update erp.par_level_decision set reason = 'x'$$), '23001 -',
  'the par log refuses UPDATE');
select is(pg_temp.refusal($$delete from erp.par_level_decision$$), '23001 -', 'and DELETE');
select is(pg_temp.refusal($$truncate erp.par_level_decision cascade$$), '23001 -', 'and TRUNCATE');
select is(pg_temp.refusal($$delete from erp.replenishment_source$$), '23001 ordering_setting_never_deleted',
  'a source is never deleted: it is cleared');
select is(pg_temp.refusal($$truncate erp.replenishment_source$$), '23001 -', 'nor truncated');
select is(pg_temp.refusal($$update erp.replenishment_source set item_id = pg_temp.u('4110') where item_id = pg_temp.u('4101')$$),
  '23001 ordering_setting_fixed', 'a source stays the source of its item');
select is(pg_temp.refusal($$delete from erp.order_cutoff$$), '23001 ordering_setting_never_deleted',
  'a cut-off is never deleted: it is cleared');
select is(pg_temp.refusal($$truncate erp.order_cutoff$$), '23001 -', 'nor truncated');
select is(pg_temp.refusal($$update erp.order_cutoff set facility_id = pg_temp.u('402') where facility_id = pg_temp.u('403')$$),
  '23001 ordering_setting_fixed', 'a cut-off stays the cut-off of its facility');
select is(pg_temp.refusal($$delete from erp.par_level$$), '23001 ordering_setting_never_deleted',
  'a par is never deleted: it is cleared');
select is(pg_temp.refusal($$truncate erp.par_level$$), '23001 -', 'nor truncated');
select is(pg_temp.refusal($$update erp.par_level set facility_id = pg_temp.u('402')
                              where facility_id = pg_temp.u('401') and item_id = pg_temp.u('4103')$$),
  '23001 ordering_setting_fixed', 'a par stays the par of its branch and item');

-- ---------------------------------------------------------------------------
-- Sources (O1): which facility supplies branches with an item
-- ---------------------------------------------------------------------------

select is((select string_agg(code || ':' || coalesce(facility_code, '-'), ' ' order by code collate "C")
             from erp.replenishment_sources(pg_temp.u('901'), pg_temp.u('401'))),
  'CL-SANITISER:WH-001 EQ-FRYER-BASKET:- FP-COLA-330:WH-001 OP-GLOVES:- PK-MEAL-BOX-M:WH-001 RM-CHK-BREAST:WH-001 '
  'RM-FRYING-OIL:- RM-FRYING-OIL-OLD:- RM-RICE:WH-001 SF-CHK-STRIPS:FA-001 SP-FRYER-GASKET:-',
  'a branch worker reads which facility supplies each of their brand''s items, and none of the second brand''s');
select is((select string_agg(code, ' ' order by code collate "C")
             from erp.replenishment_sources(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('404'))),
  'SF-CHK-STRIPS', 'narrowed to what one facility supplies: the factory''s screen');
select is(pg_temp.after($$select pg_temp.source('4110') || ' ' || d.kind || ' ' || right(d.actor_id::text, 3)
                            from erp.replenishment_source_decision d where d.decision_id = pg_temp.u('e2401')$$,
                        $$select pg_temp.set_source('e2401', '4110', '403', null)$$),
  'WH-001 source_set 900', 'the administrator gives the frying oil a source: recorded with who');
select is(pg_temp.after($$select pg_temp.source('4101')$$, $$select pg_temp.set_source('e2402', '4101', '404', '6201')$$),
  'FA-001', 'and moves the chicken to the factory, from the decision they read');
select is(pg_temp.after($$select pg_temp.source('4101') || ' ' || right(s.as_of_decision_id::text, 5)
                            from erp.replenishment_source s where s.item_id = pg_temp.u('4101')$$,
                        $$select pg_temp.clear_source('e2403', '4101', '6201')$$),
  'cleared e2403', 'a cleared source keeps its row, stamped with the clearing');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4101', '404', null)$$),
  '23001 replenishment_source_stale', 'CONTROL: a change made against a stamp that has moved is refused');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4101', '403', '6201')$$),
  '23001 replenishment_source_unchanged', 'a source set to what it already is is refused');
select is(pg_temp.refusal($$select pg_temp.clear_source('e2404', '4106', '6208')$$),
  '23001 replenishment_source_not_set', 'a cleared source cannot be cleared again');
select is(pg_temp.refusal($$select pg_temp.clear_source('e2409', '4101', null)$$),
  '23001 replenishment_source_stale', 'CONTROL: clearing a source is checked against what was read, too');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'administrator'
                              and capability_key = 'ordering.setup' and action = 'read'$$,
                          $$select pg_temp.set_source('e2404', '4110', '403', null)$$), '23001 -',
  'CONTROL: one who could not read a source back sets none: a write asks the reads its retry is confirmed by');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'administrator'
                              and capability_key = 'inventory.items' and action = 'read'$$,
                          $$select pg_temp.set_source('e2404', '4110', '403', null)$$), '23001 -',
  'nor one who reads no items');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'administrator'
                              and capability_key = 'inventory.items' and action = 'read'$$,
                          $$select pg_temp.clear_source('e2404', '4101', '6201')$$), '23001 -',
  'and clears none');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4109', '403', null)$$),
  '23001 item_admits_no_new_work', 'a retired item is given no source');
select is(pg_temp.after($$select pg_temp.source('4103')$$,
                        $$select erp.change_item_status(pg_temp.u('e2405'), pg_temp.u('4103'),
                            (select as_of_decision_id from erp.item where item_id = pg_temp.u('4103')),
                            'retired', 'testing', pg_temp.u('900'), now())$$,
                        $$select pg_temp.clear_source('e2406', '4103', '6203')$$),
  'cleared', 'a retired item''s source can still be cleared');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4110', '401', null)$$),
  '23001 ordering_facility_supplies_nothing', 'a branch supplies no branch');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4110', null, null)$$),
  '22023 ordering_facility_required', 'a source names its facility');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4112', '403', null)$$),
  '23001 replenishment_source_brand_differs', 'CONTROL: the second brand''s item is not supplied from this brand''s warehouse');
select is(pg_temp.refusal($$select erp.change_facility_status(pg_temp.u('e2407'), pg_temp.u('403'), pg_temp.u('5603'),
                              'closed', 'testing', pg_temp.u('900'), now())$$,
                          $$select pg_temp.set_source('e2404', '4110', '403', null)$$),
  '23001 facility_admits_no_new_work', 'a closed warehouse is made no item''s source');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4110', '403', null, '900', '  ')$$),
  '23514 replenishment_source_reason_is_stated', 'a source states why');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4110', '403', null)$$,
                          $$select pg_temp.set_source('e2404', '4110', '403', null)$$),
  '23505 replenishment_source_decision_pkey', 'a retry is answered as one, before the stamp it moved is checked');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4110', '403', null, '904')$$), '23001 -',
  'CONTROL: the warehouse manager, who reads sources, sets none');
select is(pg_temp.refusal($$select pg_temp.set_source('e2404', '4102', '404', '6202', '908')$$), '23001 -',
  'CONTROL: the factory manager sets no source, not even its own items''');
select is(pg_temp.refusal($$select pg_temp.set_state('ordering.setup', null, 'hidden', 'e2408')$$,
                          $$select pg_temp.set_source('e2404', '4110', '403', null)$$), '23001 -',
  'CONTROL: a hidden capability refuses even the administrator (CAP-P02)');
select is((select string_agg(kind || ':' || coalesce(facility_code, '-') || ':' || is_current, ' ' order by seq desc)
             from erp.replenishment_source_history(pg_temp.u('900'), null, pg_temp.u('4106'))),
  'source_cleared:-:true source_set:WH-001:false', 'an item''s sources, newest first, the one in force marked');
select is(pg_temp.refusal($$select * from erp.replenishment_source_history(pg_temp.u('901'), pg_temp.u('401'), pg_temp.u('4112'))$$),
  'P0002 item_exists', 'CONTROL: the second brand''s item answers, at a branch, as a missing one (ADR-0012)');
select is(pg_temp.refusal($$select * from erp.replenishment_sources(pg_temp.u('907'), null)$$), '23001 -',
  'CONTROL: the accountant reads no sources');

-- ---------------------------------------------------------------------------
-- Cut-offs (O2): one per supplying facility, the administrator's
-- ---------------------------------------------------------------------------

select is((select string_agg(code || ':' || coalesce(cutoff, '-'), ' ' order by code collate "C")
             from erp.order_cutoffs(pg_temp.u('901'), pg_temp.u('401'))),
  'FA-001:11:00 WH-001:14:00', 'a branch worker reads the cut-offs of the facilities that supply them');
select is(pg_temp.after($$select pg_temp.cutoff('403') || ' ' || d.kind || ' ' || right(d.actor_id::text, 3)
                            from erp.order_cutoff_decision d where d.decision_id = pg_temp.u('e2411')$$,
                        $$select pg_temp.set_cutoff('e2411', '403', '15:30', '6211')$$),
  '15:30 cutoff_set 900', 'the administrator moves the warehouse''s cut-off: recorded with who');
select is(pg_temp.after($$select pg_temp.cutoff('403')$$, $$select pg_temp.set_cutoff('e2411', '403', '00:00', '6211')$$),
  '00:00', '00:00 is a cut-off: every order is for the next day');
select is(pg_temp.after($$select pg_temp.cutoff('404') || ' ' || coalesce((select cutoff from erp.order_cutoffs(pg_temp.u('900'))
                                                                             where code = 'FA-001'), '-')$$,
                        $$select pg_temp.clear_cutoff('e2412', '404', '6213')$$),
  'cleared -', 'a cleared cut-off keeps its row, and is listed as none');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '15:00', null)$$),
  '23001 order_cutoff_stale', 'CONTROL: a change made against a stamp that has moved is refused');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '14:00', '6211')$$),
  '23001 order_cutoff_unchanged', 'a cut-off set to what it already is is refused');
select is(pg_temp.refusal($$select pg_temp.clear_cutoff('e2412', '404', '6213')$$,
                          $$select pg_temp.clear_cutoff('e2413', '404', 'e2412')$$),
  '23001 order_cutoff_not_set', 'a cleared cut-off cannot be cleared again');
select is(pg_temp.refusal($$select pg_temp.clear_cutoff('e2414', '403', null)$$),
  '23001 order_cutoff_stale', 'CONTROL: clearing a cut-off is checked against what was read, too');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'administrator'
                              and capability_key = 'ordering.setup' and action = 'read'$$,
                          $$select pg_temp.set_cutoff('e2413', '403', '15:00', '6211')$$), '23001 -',
  'CONTROL: one who could not read a cut-off back sets none');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'administrator'
                              and capability_key = 'ordering.setup' and action = 'read'$$,
                          $$select pg_temp.clear_cutoff('e2413', '403', '6211')$$), '23001 -',
  'and clears none');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '24:00', '6211')$$),
  '23514 order_cutoff_is_valid', 'a cut-off is a time of day, up to 23:59');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '9:30', '6211')$$),
  '23514 order_cutoff_is_valid', 'written HH:MM, two digits each');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '14:00:30', '6211')$$),
  '23514 order_cutoff_is_valid', 'to the minute, never the second');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '', '6211')$$),
  '23514 order_cutoff_is_valid', 'CONTROL: an empty cut-off is refused, never read as none: to have none, clear it');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '401', '14:00', null)$$),
  '23001 ordering_facility_supplies_nothing', 'a branch has no cut-off');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '15:00', '6211', '900', '')$$),
  '23514 order_cutoff_reason_is_stated', 'a cut-off states why');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '15:00', '6211')$$,
                          $$select pg_temp.set_cutoff('e2413', '403', '15:00', '6211')$$),
  '23505 order_cutoff_decision_pkey', 'a retry is answered as one, before the stamp it moved is checked');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '404', '12:00', '6213', '908')$$), '23001 -',
  'CONTROL: the factory manager, who sets the factory''s pars, does not move its cut-off');
select is(pg_temp.refusal($$select pg_temp.set_cutoff('e2413', '403', '15:00', '6211', '904')$$), '23001 -',
  'CONTROL: nor does the warehouse manager move the warehouse''s');
select is((select string_agg(kind || ':' || coalesce(cutoff, '-') || ':' || is_current, ' ' order by seq desc)
             from erp.order_cutoff_history(pg_temp.u('908'), pg_temp.u('404'))),
  'cutoff_set:11:00:true cutoff_set:10:30:false', 'the factory''s cut-offs, newest first, read by its manager');
select is(pg_temp.refusal($$select * from erp.order_cutoff_history(pg_temp.u('901'), pg_temp.u('404'))$$), '23001 -',
  'CONTROL: a branch worker reads no cut-off''s history: it is read at the facility it belongs to');

-- ---------------------------------------------------------------------------
-- The day an order is for (O3) — erp.order_day(), module 10's seam
-- ---------------------------------------------------------------------------

-- The rule, at stated moments.
select is(pg_temp.rule(timestamptz '2026-10-08 10:59:59.999999+00', '14:00'), '2026-10-08',
  'a microsecond before 14:00 in Riyadh: today');
select is(pg_temp.rule(timestamptz '2026-10-08 11:00:00+00', '14:00'), '2026-10-09',
  'CONTROL: 14:00 itself is at the cut-off, so tomorrow, as in the warehouse');
select is(pg_temp.rule(timestamptz '2026-10-08 20:59:00+00', '14:00'), '2026-10-09',
  '23:59 in Riyadh: tomorrow');
select is(pg_temp.rule(timestamptz '2026-10-08 21:30:00+00', '14:00'), '2026-10-09',
  'CONTROL: 00:30 in Riyadh is already the 9th there, and before the cut-off, though the 8th in UTC');
select is(pg_temp.rule(timestamptz '2026-10-08 21:00:00+00', '00:00') || ' '
          || pg_temp.rule(timestamptz '2026-10-08 20:59:00+00', '00:00'),
  '2026-10-10 2026-10-09', 'at 00:00, every order is for the next day: midnight itself included');
select is(pg_temp.rule(timestamptz '2026-10-08 20:59:00+00', null), '2026-10-08',
  'with no cut-off, 23:59 is still today');
select is(pg_temp.rule(timestamptz '2026-10-08 13:30:00+00', '14:00', 'Europe/London'), '2026-10-09',
  'read in the facility''s own zone: 14:30 in London is after its 14:00, though 16:30 in Riyadh');
select is(pg_temp.after($$select pg_temp.rule(timestamptz '2026-10-08 12:00:00+00', '14:00')$$,
                        $$set local TimeZone = 'America/New_York'$$),
  '2026-10-09', 'CONTROL: the session''s own time zone changes nothing: 15:00 in Riyadh is after its 14:00, though 08:00 in New York');

-- The seam: now, under the cut-off's lock.
select is(pg_temp.day('403'),
  ((now() at time zone 'Asia/Riyadh')::time >= time '14:00')::int::text || ':6211',
  'the warehouse''s order placed now: dated by its 14:00, the decision named, the moment the clock''s');
select is(pg_temp.day('404'),
  ((now() at time zone 'Asia/Riyadh')::time >= time '11:00')::int::text || ':6213',
  'the factory''s own cut-off dates an order to the factory');
select is(pg_temp.after($$select pg_temp.day('403')$$, $$select pg_temp.set_cutoff('e2421', '403', '00:00', '6211')$$),
  '1:2421', 'at 00:00, an order placed now is for tomorrow, by the new decision');
select is(pg_temp.after($$select pg_temp.day('404')$$, $$select pg_temp.clear_cutoff('e2422', '404', '6213')$$),
  '0:2422', 'with the cut-off cleared, today, and the clearing is what dated it');
select is(pg_temp.after($$select pg_temp.day('e2424')$$,
                        $$select erp.create_facility(pg_temp.u('e2423'), pg_temp.u('e2424'), pg_temp.u('301'), 'warehouse',
                            'WH-E24', 'Probe warehouse', 'مستودع تجريبي', null, null, 'testing', pg_temp.u('900'), now())$$),
  '0:none', 'a facility that never had a cut-off dates every order today, by no decision');
select is(pg_temp.refusal($$select pg_temp.day('401')$$), '23001 ordering_facility_supplies_nothing',
  'a branch is not ordered from');
select is(pg_temp.refusal($$select pg_temp.day(null)$$), '22023 ordering_facility_required',
  'an order names the facility it is placed with');

-- ---------------------------------------------------------------------------
-- Pars (O4, O5): read
-- ---------------------------------------------------------------------------

select is((select string_agg(code || ':' || trim_scale(par) || ':' || unit_key || ':' || quantity, ' ' order by code collate "C")
             from erp.par_levels(pg_temp.u('901'), pg_temp.u('401'), pg_temp.u('401'))),
  'FP-COLA-330:48:carton:2 RM-CHK-BREAST:30:carton:3 SF-CHK-STRIPS:80:tray:2',
  'a branch worker reads their branch''s pars, as entered and in the base unit (I-7)');
select is((select string_agg(code || ':' || trim_scale(par), ' ' order by code collate "C")
             from erp.par_levels(pg_temp.u('903'), pg_temp.u('402'), pg_temp.u('402'))),
  'RM-CHK-BREAST:20', 'the other branch''s worker reads theirs: a cleared par is not listed');
select is(pg_temp.refusal($$select * from erp.par_levels(pg_temp.u('901'), pg_temp.u('401'), pg_temp.u('402'))$$),
  '22023 par_level_read_scope', 'CONTROL: a branch worker reads no other branch''s pars from their own (IAM-006)');
select is(pg_temp.refusal($$select * from erp.par_levels(pg_temp.u('901'), pg_temp.u('402'), pg_temp.u('402'))$$),
  '23001 -', 'CONTROL: nor at the other branch, where they hold nothing');
select is((select string_agg(code, ' ' order by code collate "C")
             from erp.par_levels(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('401'))),
  'SF-CHK-STRIPS', 'at the factory, its manager reads a branch''s pars of what the factory supplies');
select is((select string_agg(code, ' ' order by code collate "C")
             from erp.par_levels(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('401'))),
  'FP-COLA-330 RM-CHK-BREAST', 'at the warehouse, of what the warehouse supplies');
select is((select string_agg(code, ' ' order by code collate "C")
             from erp.par_levels(pg_temp.u('900'), null, pg_temp.u('401'))),
  'FP-COLA-330 RM-CHK-BREAST SF-CHK-STRIPS', 'organisation-wide, all of them');
select is(pg_temp.refusal($$select * from erp.par_levels(pg_temp.u('907'), null, pg_temp.u('401'))$$), '23001 -',
  'CONTROL: the accountant reads no pars');
select is(pg_temp.refusal($$select * from erp.par_levels(pg_temp.u('900'), null, pg_temp.u('403'))$$),
  '23001 par_level_at_a_branch', 'a warehouse has no pars');
select is((select string_agg(kind || ':' || coalesce(trim_scale(par)::text, '-') || ':' || is_current, ' ' order by seq desc)
             from erp.par_level_history(pg_temp.u('903'), pg_temp.u('402'), pg_temp.u('402'), pg_temp.u('4111'))),
  'par_cleared:-:true par_set:10:false', 'an item''s pars at a branch, newest first, the one in force marked');
select is(pg_temp.refusal($$select * from erp.par_level_history(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('401'), pg_temp.u('4101'))$$),
  'P0002 item_exists', 'CONTROL: at the factory, the history of an item the factory does not supply answers as a missing one');

-- ---------------------------------------------------------------------------
-- Pars: set and cleared
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$select pg_temp.par('402', '4102') || ' ' || d.unit_key || ' ' || trim_scale(d.quantity) || ' '
                                 || right(d.actor_id::text, 3)
                            from erp.par_level_decision d where d.decision_id = pg_temp.u('e2431')$$,
                        $$select pg_temp.set_par('e2431', '404', '402', '4207', '1.5', null, '908')$$),
  '60 tray 1.5 908', 'the factory manager, at the factory, sets a branch''s par of strips: 1.5 trays, 60 pieces');
select is(pg_temp.refusal($$select pg_temp.set_par('e2432', '404', '402', '4203', '2', '6224', '908')$$),
  '23001 par_level_not_its_source', 'CONTROL: but not the chicken, which the warehouse supplies (O5)');
select is(pg_temp.refusal($$select pg_temp.set_par('e2432', '403', '402', '4203', '2', '6224', '908')$$), '23001 -',
  'CONTROL: nor by asking at the warehouse, where they hold nothing');
select is(pg_temp.refusal($$select pg_temp.set_par('e2432', '401', '401', '4203', '5', '6221', '901')$$), '23001 -',
  'CONTROL: a branch worker sets no par, not even their own branch''s');
select is(pg_temp.refusal($$select pg_temp.set_par('e2432', '401', '401', '4203', '5', '6221', '900')$$),
  '23001 par_level_not_its_source', 'CONTROL: a par is set from the facility that supplies the item, not from the branch');
select is(pg_temp.after($$select pg_temp.par('401', '4101')$$, $$select pg_temp.set_par('e2433', '403', '401', '4203', '5', '6221')$$),
  '50', 'the warehouse manager, at the warehouse, raises the chicken''s par to 5 cartons, from the decision they read');
select is(pg_temp.after($$select pg_temp.par('402', '4103')$$, $$select pg_temp.set_par('e2434', null, '402', '4210', '1', null, '900')$$),
  '24', 'the administrator sets a par organisation-wide');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '5', null)$$),
  '23001 par_level_stale', 'CONTROL: a change made against a stamp that has moved is refused');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4201', '30', '6221')$$),
  '23001 par_level_unchanged', 'CONTROL: 30 kg is the 3 cartons already set: unchanged, in whichever pack it is entered');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '0', '6221')$$),
  '23514 par_level_is_valid', 'a par is more than nothing: to have none, clear it');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '1,5', '6221')$$),
  '23514 par_level_is_valid', 'CONTROL: a decimal comma is refused, never read as 15 or as 1.5');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '-2', '6221')$$),
  '23514 par_level_is_valid', 'and a negative one');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4202', '0.000001', '6221')$$),
  '23514 par_level_inexact', 'a millionth of a gram is past six places in kilograms');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '999999999999', '6221')$$),
  '23514 par_level_is_valid', 'and nothing is a par of a trillion kilograms');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4209', '2', '6223')$$),
  '23001 par_level_pack_is_retired', 'a par is entered in a current pack');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', null, '401', '4222', '2', null, '900')$$),
  '23001 item_admits_no_new_work', 'a retired item is given no par');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', null, '401', '4223', '2', null, '900')$$),
  '23001 par_level_item_has_no_source', 'an item no facility supplies is given no par, even organisation-wide');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4217', '2', null)$$),
  '23001 par_level_item_has_no_source', 'nor from the warehouse that used to supply it');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '403', '4203', '2', null)$$),
  '23001 par_level_at_a_branch', 'a par is for a branch, never the warehouse');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', null, '4203', '2', null)$$),
  '22023 par_level_branch_required', 'a par names its branch');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4227', '2', null)$$),
  'P0002 item_unit_exists', 'CONTROL: the second brand''s pack answers as a missing one (ADR-0012)');
select is(pg_temp.refusal($$select erp.change_facility_status(pg_temp.u('e2436'), pg_temp.u('402'), pg_temp.u('5602'),
                              'closed', 'testing', pg_temp.u('900'), now())$$,
                          $$select pg_temp.set_par('e2435', '403', '402', '4203', '2', '6224')$$),
  '23001 facility_admits_no_new_work', 'a closed branch is given no par');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '5', '6221', '904', ' ')$$),
  '23514 par_level_reason_is_stated', 'a par states why');
select is(pg_temp.refusal($$select pg_temp.set_par('e2435', '403', '401', '4203', '5', '6221')$$,
                          $$select pg_temp.set_par('e2435', '403', '401', '4203', '5', '6221')$$),
  '23505 par_level_decision_pkey', 'a retry is answered as one, before the stamp it moved is checked');
select is(pg_temp.refusal($$select pg_temp.set_state('ordering.par_levels', '404', 'hidden', 'e2437')$$,
                          $$select pg_temp.set_par('e2435', '404', '401', '4207', '3', '6222', '908')$$), '23001 -',
  'CONTROL: hidden at the factory, the factory manager sets no par there, though it is open elsewhere (CAP-P02)');
select is(pg_temp.after($$select (select count(*) from erp.stock_balance b join erp.facility f on f.facility_id = b.facility_id
                                   where f.facility_type = 'branch')::text$$,
                        $$select pg_temp.set_par('e2438', '403', '401', '4203', '5', '6221')$$),
  '0', 'a par is not a stock record: the branch holds no stock because of it (ADR-0029 §8)');
select is(pg_temp.after($$select pg_temp.par('402', '4101') || ' ' || right(m.as_of_decision_id::text, 5)
                            from erp.par_level m where m.facility_id = pg_temp.u('402') and m.item_id = pg_temp.u('4101')$$,
                        $$select pg_temp.clear_par('e2441', '403', '402', '4101', '6224')$$),
  'cleared e2441', 'the warehouse manager clears a par: the row stays, stamped with the clearing');
select is(pg_temp.refusal($$select pg_temp.clear_par('e2442', '403', '402', '4111', '6226')$$),
  '23001 par_level_not_set', 'a cleared par cannot be cleared again');
select is(pg_temp.refusal($$select pg_temp.clear_par('e2443', '403', '401', '4101', null)$$),
  '23001 par_level_stale', 'CONTROL: clearing a par is checked against what was read, too');
select is(pg_temp.refusal($$select pg_temp.clear_par('e2443', null, '401', '4112', null, '900')$$),
  'P0002 item_exists', 'CONTROL: clearing another brand''s item''s par answers as a missing one, never as "not set" (ADR-0012)');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'factory_manager'
                              and capability_key = 'ordering.par_levels' and action = 'read'$$,
                          $$select pg_temp.set_par('e2443', '404', '401', '4207', '3', '6222', '908')$$), '23001 -',
  'CONTROL: one who could not read a par back sets none');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'warehouse_manager'
                              and capability_key = 'ordering.par_levels' and action = 'read'$$,
                          $$select pg_temp.clear_par('e2443', '403', '402', '4101', '6224')$$), '23001 -',
  'and clears none');
select is(pg_temp.refusal($$select erp.change_facility_status(pg_temp.u('e2444'), pg_temp.u('403'), pg_temp.u('5603'),
                              'closed', 'testing', pg_temp.u('900'), now())$$,
                          $$select pg_temp.set_par('e2445', null, '401', '4203', '5', '6221', '900')$$),
  '23001 facility_admits_no_new_work', 'CONTROL: while its source is closed, an item is given no par, even organisation-wide');
select is(pg_temp.after($$select pg_temp.par('401', '4101')$$,
                        $$select erp.change_facility_status(pg_temp.u('e2444'), pg_temp.u('403'), pg_temp.u('5603'),
                            'closed', 'testing', pg_temp.u('900'), now())$$,
                        $$select pg_temp.clear_par('e2445', '403', '401', '4101', '6221')$$),
  'cleared', 'but its par can still be cleared');
select is(pg_temp.refusal($$select pg_temp.clear_par('e2442', '404', '401', '4101', '6221', '908')$$),
  '23001 par_level_not_its_source', 'CONTROL: the factory manager clears no par of what the warehouse supplies');

-- ---------------------------------------------------------------------------
-- Pars follow their item's source (O5)
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$select pg_temp.set_source('e2451', '4102', '403', '6202')$$,
                          $$select pg_temp.set_par('e2452', '404', '401', '4207', '3', '6222', '908')$$),
  '23001 par_level_not_its_source', 'CONTROL: once the strips come from the warehouse, the factory manager no longer sets their par');
select is(pg_temp.after($$select pg_temp.par('401', '4102')$$,
                        $$select pg_temp.set_source('e2451', '4102', '403', '6202')$$,
                        $$select pg_temp.set_par('e2452', '403', '401', '4207', '3', '6222')$$),
  '120', 'and the warehouse manager does, at the warehouse: the par stayed, and its gate moved');
select is(pg_temp.refusal($$select pg_temp.clear_source('e2453', '4101', '6201')$$,
                          $$select pg_temp.clear_par('e2454', '403', '401', '4101', '6221')$$),
  '23001 par_level_item_has_no_source', 'with its source cleared, an item''s par is not cleared from the warehouse');
select is(pg_temp.after($$select pg_temp.par('401', '4101')$$,
                        $$select pg_temp.clear_source('e2453', '4101', '6201')$$,
                        $$select pg_temp.clear_par('e2454', null, '401', '4101', '6221', '900')$$),
  'cleared', 'but organisation-wide');
select is(pg_temp.after($$select coalesce((select string_agg(code, ' ' order by code collate "C")
                                             from erp.par_levels(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('401'))), '') || ' / '
                                 || coalesce((select string_agg(code, ' ' order by code collate "C")
                                             from erp.par_levels(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('401'))), '')$$,
                        $$select pg_temp.set_source('e2455', '4102', '403', '6202')$$),
  'FP-COLA-330 RM-CHK-BREAST SF-CHK-STRIPS / ', 'and a supplying facility''s read follows the source: the strips move to the warehouse''s list, and leave the factory''s');

-- ---------------------------------------------------------------------------
-- The capability at the branch, and the brand before anything else
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$select pg_temp.set_state('ordering.par_levels', '401', 'withdrawn', 'e2461')$$,
                          $$select pg_temp.set_par('e2462', '404', '401', '4207', '3', '6222', '908')$$), '23001 -',
  'CONTROL: withdrawn at the branch, a par for it is refused, though asked at the factory, where it is open');
select is(pg_temp.after($$select pg_temp.par('402', '4102')$$,
                        $$select pg_temp.set_state('ordering.par_levels', '401', 'withdrawn', 'e2461')$$,
                        $$select pg_temp.set_par('e2462', '404', '402', '4207', '3', null, '908')$$),
  '120', 'while the other branch, where it is open, still takes one');
select is(pg_temp.refusal($$select pg_temp.set_state('ordering.par_levels', '401', 'hidden', 'e2463')$$,
                          $$select * from erp.par_levels(pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('401'))$$), '23001 -',
  'CONTROL: hidden at the branch, its pars are not read from the warehouse either');
select is(pg_temp.after($$select count(*)::text || ' ' || coalesce(string_agg(kind, ' '), '')
                            from erp.par_level_history(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('401'), pg_temp.u('4102'))$$,
                        $$select pg_temp.set_state('ordering.par_levels', '404', 'read_only', 'e2464')$$),
  '1 par_set', 'read-only at the factory, its manager still reads the history (CAP-P06)');
select is(pg_temp.refusal($$select pg_temp.set_state('ordering.par_levels', '404', 'read_only', 'e2464')$$,
                          $$select pg_temp.set_par('e2465', '404', '401', '4207', '3', '6222', '908')$$), '23001 -',
  'and sets no par there');
select is(pg_temp.refusal($$delete from erp.role_permission where role_key = 'factory_manager'
                              and capability_key = 'inventory.items' and action = 'read'$$,
                          $$select pg_temp.set_par('e2465', '404', '401', '4207', '3', '6222', '908')$$), '23001 -',
  'CONTROL: one who sets pars but reads no items sets none: they could not read it back');
select is(pg_temp.refusal($$select pg_temp.second_brand()$$,
                          $$select pg_temp.set_par('e2466', '404', 'e2493', '4207', '3', null, '908')$$),
  'P0002 facility_exists', 'CONTROL: the second brand''s warehouse answers as missing, never as a warehouse (ADR-0012)');
select is(pg_temp.refusal($$select pg_temp.second_brand()$$,
                          $$select pg_temp.clear_par('e2466', '404', 'e2495', '4102', null, '908')$$),
  'P0002 facility_exists', 'CONTROL: and its closed branch as missing, never as closed');
select is(pg_temp.refusal($$select pg_temp.second_brand()$$,
                          $$select pg_temp.clear_par('e2466', null, 'e2495', '4102', null, '900')$$),
  '23001 facility_admits_no_new_work', 'organisation-wide, where every brand is seen, it is closed');
select is(pg_temp.refusal($$select pg_temp.second_brand()$$,
                          $$select * from erp.par_levels(pg_temp.u('908'), pg_temp.u('404'), pg_temp.u('e2495'))$$),
  'P0002 facility_exists', 'CONTROL: and its branch''s pars, read from the factory, answer as missing too');
select is(pg_temp.after($$select pg_temp.par('401', '4102')$$,
                        $$select pg_temp.set_state('ordering.par_levels', null, 'hidden', 'e2471')$$,
                        $$select pg_temp.set_state('ordering.par_levels', '404', 'pilot', 'e2472')$$,
                        $$select pg_temp.set_state('ordering.par_levels', '401', 'pilot', 'e2473')$$,
                        $$select pg_temp.set_par('e2474', '404', '401', '4207', '3', '6222', '908')$$),
  '120', 'a pilot names its supplier and its branches: hidden elsewhere, the factory sets a par at the branch it covers');
select is(pg_temp.refusal($$select pg_temp.set_state('ordering.par_levels', null, 'hidden', 'e2471')$$,
                          $$select pg_temp.set_state('ordering.par_levels', '404', 'pilot', 'e2472')$$,
                          $$select pg_temp.set_state('ordering.par_levels', '401', 'pilot', 'e2473')$$,
                          $$select pg_temp.set_par('e2474', '404', '402', '4207', '3', null, '908')$$), '23001 -',
  'CONTROL: and none at a branch it does not');

select * from finish();
rollback;
