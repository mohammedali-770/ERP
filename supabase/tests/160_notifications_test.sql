-- pgTAP · notifications, and the first thing that rings the bell
--
-- 0021 is module 6: one row per recipient, read once, kept 90 days; three routes for the
-- bell; and stock taken below zero by an override (D1) telling that facility's readers of
-- stock (ADR-0030, N1–N4). Cases marked CONTROL are why the suite exists.
--
-- ORDER MATTERS, as in 150: every stateful case runs inside pg_temp.after() or
-- pg_temp.refusal(), which roll back whatever they did. The producer is an ordinary
-- trigger on the balance, so it fires inside the posting, and the suite needs no commit.
--
-- The seed: the administrator (…0900) and the warehouse manager (…0904) read stock
-- everywhere; the factory manager (…0908) reads and overrides at FA-001 (…0404) alone;
-- branch workers (…0901) read stock at their branch; the accountant (…0907) reads no stock.
-- FA-001 holds 172 chicken strips (SF-CHK-STRIPS, …4102: trays of 40, …4207; pieces,
-- …4205); WH-001 (…0403) holds 100 kg of rice (RM-RICE, …4111: bags of 5 kg, …4226).
--
-- Fixture ids are …0e21NN, a range no seed row and no other suite uses.

begin;
select plan(50);

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

-- A movement.
create function pg_temp.adjust(p_id text, p_kind text, p_lines jsonb, p_actor text, p_facility text,
                               p_override text default null)
returns void language plpgsql as $f$
begin
  perform erp.record_stock_adjustment(pg_temp.u(p_id), pg_temp.u(p_facility), p_kind, null, p_lines, 'testing',
                                      p_override, pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.reverse(p_id text, p_target text, p_actor text, p_facility text, p_override text default null)
returns void language plpgsql as $f$
begin
  perform erp.reverse_stock_decision(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_target), 'testing',
                                     p_override, pg_temp.u(p_actor), now());
end
$f$;

-- 908 overrides at FA-001: five trays of strips, 200 where 172 are held.
create function pg_temp.override_at_factory(p_id text) returns void language sql as $f$
  select pg_temp.adjust(p_id, 'waste', jsonb_build_array(pg_temp.l('4207', '5')), '908', '404', 'Delivery not entered.')
$f$;

-- Who was told of a decision: their ids' last three digits, in order.
create function pg_temp.told(p_decision text) returns text language sql as $f$
  select coalesce(string_agg(right(n.recipient_id::text, 3), ',' order by n.recipient_id), '')
    from erp.notification n where n.stock_decision_id = pg_temp.u(p_decision)
$f$;

-- A capability's state at a facility, set inside the block that reads it.
create function pg_temp.set_state(p_capability text, p_facility text, p_state text, p_decision text)
returns void language sql as $f$
  insert into erp.capability_decision (decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at)
  values (pg_temp.u(p_decision), p_capability, pg_temp.u(p_facility), p_state, 'testing', pg_temp.u('900'), 'administrator', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values (p_capability, pg_temp.u(p_facility), p_state, pg_temp.u(p_decision))
  on conflict (capability_key, facility_id) do update set state = excluded.state, as_of_decision_id = excluded.as_of_decision_id;
$f$;

-- A notification written directly, as old as asked: the routes never make one by hand.
-- Each names a seed decision of its own, as one person is told once per decision.
create function pg_temp.aged(p_id text, p_days integer, p_decision text default '5708') returns void language sql as $f$
  insert into erp.notification (notification_id, kind, recipient_id, facility_id, stock_decision_id, data, created_at)
  select pg_temp.u(p_id), 'stock_below_zero', pg_temp.u('904'), d.facility_id, d.decision_id,
         '{"items": []}'::jsonb, now() - make_interval(days => p_days)
    from erp.stock_decision d where d.decision_id = pg_temp.u(p_decision)
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

select has_table('erp', 'notification', 'erp.notification exists');
select col_is_fk('erp', 'notification', 'recipient_id', 'a notification names a person');
select fk_ok('erp', 'notification', 'stock_decision_id', 'erp', 'stock_decision', 'decision_id',
  'a stock notification names the decision it is about');
select is(has_table_privilege('erp_app', 'erp.notification', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime has no privilege on the table: the bell is three routes');
select ok(has_function_privilege('erp_app', 'erp.list_notifications(uuid,uuid,bigint,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.count_unread_notifications(uuid,uuid)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.mark_notifications_read(uuid,uuid,uuid[])', 'EXECUTE'),
  'the runtime calls the three routes');
select is(has_function_privilege('erp_app', 'erp.purge_notifications()', 'EXECUTE')
       or has_function_privilege('erp_app', 'erp.notify_stock_below_zero()', 'EXECUTE')
       or has_function_privilege('erp_app', 'erp.notification_is_open_to(uuid,text,uuid)', 'EXECUTE'), false,
  'CONTROL: not the purge, the producer or the rule');
select is((select count(*)::int from erp.notification), 0, 'the seed makes no notification');

-- ---------------------------------------------------------------------------
-- The producer (N2, N4)
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$select pg_temp.told('e2101')$$, $$select pg_temp.override_at_factory('e2101')$$),
  '900,904',
  'CONTROL: an override at the factory tells those who read stock there — the administrator and the warehouse manager');
select is(pg_temp.after(
  $$select (position('908' in pg_temp.told('e2102')) = 0 and position('901' in pg_temp.told('e2102')) = 0
            and position('907' in pg_temp.told('e2102')) = 0)::text$$,
  $$select pg_temp.override_at_factory('e2102')$$),
  'true', 'not the person who overrode, not a branch worker at another facility, not the accountant who reads no stock');
select is(pg_temp.after(
  $$select (data -> 'items')::text from erp.notification where stock_decision_id = pg_temp.u('e2103') and recipient_id = pg_temp.u('904')$$,
  $$select pg_temp.override_at_factory('e2103')$$),
  '[{"item_id": "01936f00-0000-7000-8000-000000004102", "on_hand": "-28"}]',
  'it holds the item and the balance left, 172 - 200, as ids and decimal text: no name, no reason');
select is(pg_temp.after(
  $$select pg_temp.told('e2104')$$,
  $$select pg_temp.adjust('e2104', 'waste', jsonb_build_array(pg_temp.l('4226', '2')), '904', '403')$$),
  '', 'CONTROL: a movement that leaves stock at or above zero tells nobody');
select is(pg_temp.after(
  $$select pg_temp.told('e2105') || ' ' || (select (data -> 'items')::text from erp.notification where stock_decision_id = pg_temp.u('e2105'))$$,
  $$select pg_temp.adjust('e2105', 'waste', jsonb_build_array(pg_temp.l('4226', '30'), pg_temp.l('4223', '1')), '900', '403', 'Spoiled stock found.')$$),
  '904 [{"item_id": "01936f00-0000-7000-8000-000000004111", "on_hand": "-50"}]',
  'at the warehouse: the warehouse manager is told, the factory manager scoped elsewhere is not, and only the item left below zero is named');
select is(pg_temp.after(
  $$select pg_temp.told('e2108')$$,
  $$select pg_temp.adjust('e2106', 'adjustment', jsonb_build_array(pg_temp.l('4205', '10', 'in')), '908', '404')$$,
  $$select pg_temp.adjust('e2107', 'waste', jsonb_build_array(pg_temp.l('4205', '182')), '908', '404')$$,
  $$select pg_temp.reverse('e2108', 'e2106', '908', '404', 'Found it was never delivered.')$$),
  '900,904', 'a reversal that takes stock below zero by an override is told as any movement is');
select is(pg_temp.after(
  $$select (select data -> 'items' -> 0 ->> 'on_hand' from erp.notification where stock_decision_id = pg_temp.u('e2110') and recipient_id = pg_temp.u('904'))
        || ' ' ||
           (select data -> 'items' -> 0 ->> 'on_hand' from erp.notification where stock_decision_id = pg_temp.u('e2111') and recipient_id = pg_temp.u('904'))$$,
  $$select pg_temp.override_at_factory('e2110')$$,
  $$select pg_temp.adjust('e2111', 'waste', jsonb_build_array(pg_temp.l('4205', '40')), '908', '404', 'Delivery not entered.')$$),
  '-28 -68', 'CONTROL: two overrides in one transaction each name the balance their own decision left (found in review)');
select is(pg_temp.after(
  $$select pg_temp.told('e2112')$$,
  $$set constraints all immediate$$,
  $$select pg_temp.override_at_factory('e2112')$$),
  '900,904', 'CONTROL: no setting of the session stops it: SET CONSTRAINTS ALL IMMEDIATE told nobody (found in review)');
select is(pg_temp.after(
  $$select (select data -> 'items' from erp.notification where stock_decision_id = pg_temp.u('e2113') and recipient_id = pg_temp.u('904'))::text$$,
  $$select pg_temp.adjust('e2113', 'adjustment',
      jsonb_build_array(pg_temp.l('4201', '1', 'in'), pg_temp.l('4205', '200', 'out')), '908', '404', 'Delivery not entered.')$$),
  '[{"item_id": "01936f00-0000-7000-8000-000000004102", "on_hand": "-28"}]',
  'CONTROL: an item the decision only put back, still below zero (chicken breast, -10 to -9), is not named');
select is(pg_temp.after(
  $$select (select count(*) from erp.notification where stock_decision_id = pg_temp.u('e2115'))::text || ' ' ||
           (select (data -> 'items')::text from erp.notification where stock_decision_id = pg_temp.u('e2115') and recipient_id = pg_temp.u('904'))$$,
  $$select pg_temp.adjust('e2115', 'waste', jsonb_build_array(pg_temp.l('4207', '5'), pg_temp.l('4226', '1')), '908', '404', 'Delivery not entered.')$$),
  '2 [{"item_id": "01936f00-0000-7000-8000-000000004111", "on_hand": "-5"}, {"item_id": "01936f00-0000-7000-8000-000000004102", "on_hand": "-28"}]',
  'CONTROL: one notification per person names every item, a new balance and an updated one alike, in code order');
select is(pg_temp.after(
  $$select (select count(*) from erp.notification)::text$$,
  $$update erp.stock_balance set updated_at = now()
     where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4101')$$),
  '0', 'CONTROL: a balance touched without a new decision, such as the seed''s freeze, tells nobody');
select is(pg_temp.after(
  $$select pg_temp.told('e2114') || '|' || (select (on_hand < 0)::text from erp.stock_balance
                                             where facility_id = pg_temp.u('404') and item_id = pg_temp.u('4102'))$$,
  $$select erp.record_stock_count(pg_temp.u('e2114'), pg_temp.u('404'), timestamptz '2026-09-29 04:00:00+00',
      jsonb_build_array(pg_temp.l('4205', '0')), 'testing', pg_temp.u('908'), now())$$),
  '|true', 'CONTROL: a late count that leaves stock below zero is no override, and tells nobody (N4)');
select is(pg_temp.refusal(
  $$insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id, data)
    values ('stock_below_zero', pg_temp.u('904'), pg_temp.u('403'), pg_temp.u('5708'), '{}')$$),
  '23503 notification_at_its_decisions_facility', 'a notification is at its decision''s facility');
select is(pg_temp.after(
  $$select pg_temp.told('e2109')$$,
  $$select pg_temp.set_state('inventory.items', '404', 'hidden', 'e2181')$$,
  $$select pg_temp.override_at_factory('e2109')$$),
  '', 'CONTROL: where what it is about cannot be opened — items hidden at the factory — nobody is told (SUP-007)');

-- ---------------------------------------------------------------------------
-- The bell's routes
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$select string_agg((kind, facility_code, stock_decision_id = pg_temp.u('e2110'), read_at is null,
                       items -> 0 ->> 'code', items -> 0 ->> 'name_en', items -> 0 ->> 'on_hand', items -> 0 ->> 'base_unit_key')::text, ';')
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'))$$,
  $$select pg_temp.override_at_factory('e2110')$$),
  '(stock_below_zero,FA-001,t,t,SF-CHK-STRIPS,"Chicken strips (synthetic)",-28,piece)',
  'the warehouse manager reads it from where they work: the facility, the decision, and the item named now');
select is(pg_temp.after(
  $$select count(*)::text from erp.list_notifications(pg_temp.u('901'), pg_temp.u('401'))$$,
  $$select pg_temp.override_at_factory('e2111')$$),
  '0', 'a branch worker reads none of it');
select is(pg_temp.after(
  $$select erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text$$,
  $$select pg_temp.override_at_factory('e2112')$$,
  $$select pg_temp.adjust('e2113', 'waste', jsonb_build_array(pg_temp.l('4226', '30')), '900', '403', 'Spoiled.')$$),
  '2', 'two unread, from two facilities');
select is(pg_temp.after(
  $$select (select n from pg_temp.marked)::text || ' '
           || erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text || ' '
           || erp.mark_notifications_read(pg_temp.u('904'), pg_temp.u('403'), null)::text$$,
  $$select pg_temp.override_at_factory('e2114')$$,
  $$create temp table marked as select erp.mark_notifications_read(pg_temp.u('904'), pg_temp.u('403'), null) as n$$),
  '1 0 0', 'marking all read marks one, leaves none unread, and marking again marks nothing and is no error');
select is(pg_temp.after(
  $$select erp.mark_notifications_read(pg_temp.u('900'), null,
             array(select notification_id from erp.notification where recipient_id = pg_temp.u('904')))::text || ' '
           || erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text$$,
  $$select pg_temp.override_at_factory('e2115')$$),
  '0 1', 'CONTROL: nobody marks another person''s notification read, even naming it');
select is(pg_temp.after(
  $$select (select n from pg_temp.marked)::text || ' ' || erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text$$,
  $$select pg_temp.override_at_factory('e2116')$$,
  $$select pg_temp.adjust('e2117', 'waste', jsonb_build_array(pg_temp.l('4226', '30')), '900', '403', 'Spoiled.')$$,
  $$create temp table marked as select erp.mark_notifications_read(pg_temp.u('904'), pg_temp.u('403'),
      array(select notification_id from erp.notification where stock_decision_id = pg_temp.u('e2116'))) as n$$),
  '1 1', 'marking the ones named marks those alone');
select is(pg_temp.after(
  $$select (select read_at >= created_at from erp.notification where stock_decision_id = pg_temp.u('e2118') and recipient_id = pg_temp.u('904'))::text$$,
  $$select pg_temp.override_at_factory('e2118')$$,
  $$select erp.mark_notifications_read(pg_temp.u('904'), pg_temp.u('403'), null)$$),
  'true', 'it is read at a moment, not before it was made');
select is(pg_temp.after(
  $$select count(*)::text || ' ' || erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))::text
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'))$$,
  $$select pg_temp.override_at_factory('e2119')$$,
  $$select pg_temp.set_state('inventory.stock', '404', 'hidden', 'e2182')$$),
  '0 0', 'CONTROL: once what it is about can no longer be opened — stock hidden at the factory — it is no longer shown or counted');
select is(pg_temp.after(
  $$select count(*)::text from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'))$$,
  $$select pg_temp.aged('e2120', 91)$$, $$select pg_temp.aged('e2121', 89, '5707')$$),
  '1', 'past 90 days a notification is not shown, younger it is (N3)');
-- Newest first is the order made: seq, which a client cannot round.
select is(pg_temp.after(
  $$select string_agg(right(notification_id::text, 5), ',')
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('404'), null, 1)$$,
  $$select pg_temp.aged('e2122', 2)$$, $$select pg_temp.aged('e2123', 1, '5707')$$),
  'e2123', 'the newest first, a page at a time');
select is(pg_temp.after(
  $$select string_agg(right(notification_id::text, 5), ',' order by seq desc)
      from erp.list_notifications(pg_temp.u('904'), pg_temp.u('404'),
           (select seq from erp.notification where notification_id = pg_temp.u('e2125')), 30)$$,
  $$select pg_temp.aged('e2126', 2, '5706')$$, $$select pg_temp.aged('e2124', 1)$$,
  $$select pg_temp.aged('e2125', 1, '5707')$$),
  'e2124,e2126', 'the next page ends before the last one shown');
select is(pg_temp.refusal($$select * from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'), null, 0)$$),
  '22023 notification_page_size', 'a page holds 1 to 100');
select is(pg_temp.refusal($$select * from erp.list_notifications(pg_temp.u('904'), pg_temp.u('403'), null, 101)$$),
  '22023 notification_page_size', 'and no more than 100');
select is(pg_temp.refusal($$select erp.mark_notifications_read(pg_temp.u('904'), pg_temp.u('403'), array[]::uuid[])$$),
  '22023 notification_page_size', 'mark 1 to 100, or all: an empty list is a mistake, not "all"');
select is(pg_temp.refusal(
  $$select pg_temp.set_state('platform.notifications', '403', 'hidden', 'e2183')$$,
  $$select erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))$$),
  '23001 -', 'CONTROL: where the bell is hidden, its routes are refused (CAP-P02)');
select is(pg_temp.refusal(
  $$delete from erp.role_permission where role_key = 'warehouse_manager' and capability_key = 'platform.notifications'$$,
  $$select erp.count_unread_notifications(pg_temp.u('904'), pg_temp.u('403'))$$),
  '23001 -', 'and to a person whose role holds no bell');
select is(pg_temp.after(
  $$select count(*)::text from erp.list_notifications(pg_temp.u('907'), null)$$,
  $$select pg_temp.override_at_factory('e2126')$$),
  '0', 'the accountant has a bell that stock never rings');

-- ---------------------------------------------------------------------------
-- Read once, kept 90 days (N3) — binding the owner too
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal(
  $$select pg_temp.aged('e2130', 1)$$,
  $$update erp.notification set data = '{"items": [{"item_id": "x"}]}', read_at = now() where notification_id = pg_temp.u('e2130')$$),
  '23001 notification_is_read_once', 'CONTROL: what a notification says never changes');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2131', 1)$$,
  $$update erp.notification set recipient_id = pg_temp.u('900'), read_at = now() where notification_id = pg_temp.u('e2131')$$),
  '23001 notification_is_read_once', 'nor whom it is for, even while being read');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2132', 1)$$,
  $$update erp.notification set read_at = now() where notification_id = pg_temp.u('e2132')$$,
  $$update erp.notification set read_at = now() + interval '1 hour' where notification_id = pg_temp.u('e2132')$$),
  '23001 notification_is_read_once', 'it is read once');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2133', 1)$$,
  $$update erp.notification set read_at = now() where notification_id = pg_temp.u('e2133')$$,
  $$update erp.notification set read_at = null where notification_id = pg_temp.u('e2133')$$),
  '23001 notification_is_read_once', 'and never unread again');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2134', 89)$$,
  $$delete from erp.notification where notification_id = pg_temp.u('e2134')$$),
  '23001 notification_is_kept_90_days', 'CONTROL: one younger than 90 days is not deleted, by the owner either');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2135', 91)$$,
  $$delete from erp.notification where notification_id = pg_temp.u('e2135')$$),
  'none', 'one past 90 days is');
select is(pg_temp.refusal($$truncate erp.notification$$),
  '23001 -', 'notifications are never truncated');
select is(pg_temp.after(
  $$select (select n from purged)::text || ' ' || (select string_agg(right(notification_id::text, 5), ',') from erp.notification)$$,
  $$select pg_temp.aged('e2136', 91)$$, $$select pg_temp.aged('e2137', 30, '5707')$$,
  $$create temp table purged as select erp.purge_notifications() as n$$),
  '1 e2137', 'the purge deletes what is past 90 days and keeps the rest');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2138', 1)$$,
  $$update erp.notification set read_at = created_at - interval '1 second' where notification_id = pg_temp.u('e2138')$$),
  '23514 notification_read_after_it_was_made', 'a notification is not read before it was made');
select is(pg_temp.refusal(
  $$insert into erp.notification (kind, recipient_id, facility_id, data) values ('stock_below_zero', pg_temp.u('904'), pg_temp.u('404'), '{}')$$),
  '23514 notification_names_its_source', 'a stock notification names its decision');
select is(pg_temp.refusal(
  $$insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id) values ('order_new', pg_temp.u('904'), pg_temp.u('404'), pg_temp.u('5708'))$$),
  '23514 notification_kind_is_known', 'a kind no module has built is refused');
select is(pg_temp.refusal(
  $$select pg_temp.aged('e2139', 1)$$,
  $$insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id) values ('stock_below_zero', pg_temp.u('904'), pg_temp.u('404'), pg_temp.u('5708'))$$),
  '23505 notification_once_per_person', 'one per person per decision');

select * from finish();
rollback;
