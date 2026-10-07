-- pgTAP · purchase orders and receipts: an order for one warehouse or factory, approved by
-- someone who did not raise it or within a limit, and received through the stock ledger
--
-- 0023 is module 8: orders as decisions in an append-only log with their lines written once;
-- an approval limit per facility, before VAT; receipts as stock decisions of kind receipt,
-- reversed whole, once (ADR-0032, P1–P4). Cases marked CONTROL are why the suite exists.
--
-- ORDER MATTERS, as in 150 and 170: every stateful case runs inside pg_temp.after() or
-- pg_temp.refusal(), which roll back whatever they did.
--
-- The seed (0080): WH-001 (…0403) has a limit of 5,000.00 (…6101). Its orders: …5901
-- chicken cartons, PENDING; …5902 rice (20 bags of 5 kg, …4226) and cola (10 cartons of 24,
-- …4210) from the local supplier (…5103), APPROVED by the limit; …5903 meal boxes, APPROVED
-- by the accountant; …5904 REJECTED; …5905 CANCELLED. FA-001 (…0404) has no limit; …5906
-- chicken kg, PENDING, raised by the factory manager. The warehouse manager (…0904) raises and
-- receives everywhere; the factory manager (…0908) at FA-001 alone; the accountant (…0907)
-- reads and approves everywhere, and moves no stock; the administrator (…0900) does all of
-- it; a branch worker (…0901) holds nothing here. At WH-001 rice stands at 100 kg.
--
-- Fixture ids are …0e23NN, a range no seed row and no other suite uses.

begin;
select plan(115);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function pg_temp.u(p text) returns uuid language sql immutable as $f$
  select ('01936f00-0000-7000-8000-' || lpad(p, 12, '0'))::uuid
$f$;

create function pg_temp.line(p_unit text, p_qty text, p_price bigint) returns jsonb language sql immutable as $f$
  select jsonb_build_object('item_unit_id', pg_temp.u(p_unit), 'quantity', p_qty, 'price_minor', p_price)
$f$;

-- Raised at WH-001 by the warehouse manager, from the poultry supplier, at 15%, unless said.
create function pg_temp.raise(p_id text, p_order text, p_lines jsonb, p_actor text default '904',
                              p_facility text default '403', p_supplier text default '5101', p_vat integer default 1500,
                              p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.raise_purchase_order(pg_temp.u(p_id), pg_temp.u(p_order), pg_temp.u(p_facility), pg_temp.u(p_supplier),
                                   p_vat, p_lines, p_reason, pg_temp.u(p_actor), now());
end
$f$;

-- Two cartons of chicken at 125.00: 250.00, within WH-001's limit.
create function pg_temp.small(p_id text, p_order text, p_actor text default '904') returns void language sql as $f$
  select pg_temp.raise(p_id, p_order, jsonb_build_array(pg_temp.line('4203', '2', 12500)), p_actor)
$f$;

-- Fifty cartons at 125.00: 6,250.00, over it.
create function pg_temp.large(p_id text, p_order text, p_actor text default '904') returns void language sql as $f$
  select pg_temp.raise(p_id, p_order, jsonb_build_array(pg_temp.line('4203', '50', 12500)), p_actor)
$f$;

create function pg_temp.decide(p_id text, p_order text, p_kind text, p_actor text default '907',
                               p_facility text default '403', p_reason text default 'testing')
returns void language plpgsql as $f$
begin
  perform erp.decide_purchase_order(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_order), p_kind, p_reason,
                                    pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.rl(p_line integer, p_qty text) returns jsonb language sql immutable as $f$
  select jsonb_build_object('line_no', p_line, 'quantity', p_qty)
$f$;

create function pg_temp.receive(p_id text, p_order text, p_lines jsonb, p_actor text default '904',
                                p_facility text default '403', p_at timestamptz default null, p_note text default null)
returns void language plpgsql as $f$
begin
  perform erp.receive_purchase_order(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_order), p_at, p_lines, p_note,
                                     pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.reverse(p_id text, p_receipt text, p_actor text default '904', p_facility text default '403')
returns void language plpgsql as $f$
begin
  perform erp.reverse_purchase_receipt(pg_temp.u(p_id), pg_temp.u(p_facility), pg_temp.u(p_receipt), 'testing', null,
                                       pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.set_limit(p_id text, p_facility text, p_minor bigint, p_expected text,
                                  p_actor text default '900', p_currency text default 'SAR')
returns void language plpgsql as $f$
begin
  perform erp.set_purchase_limit(pg_temp.u(p_id), pg_temp.u(p_facility), p_minor, p_currency,
                                 case when p_expected is null then null else pg_temp.u(p_expected) end,
                                 'testing', pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.clear_limit(p_id text, p_facility text, p_expected text, p_actor text default '900')
returns void language plpgsql as $f$
begin
  perform erp.clear_purchase_limit(pg_temp.u(p_id), pg_temp.u(p_facility),
                                   case when p_expected is null then null else pg_temp.u(p_expected) end,
                                   'testing', pg_temp.u(p_actor), now());
end
$f$;

create function pg_temp.state(p_order text) returns text language sql as $f$
  select o.state from erp.purchase_order o where o.purchase_order_id = pg_temp.u(p_order)
$f$;

-- What the order shows: its state, how much has arrived, and each line's received/remaining.
create function pg_temp.shown(p_order text, p_actor text default '907', p_facility text default '403') returns text
language sql as $f$
  select g.state || ' ' || g.progress || ' ' ||
         (select string_agg((l ->> 'received') || '/' || (l ->> 'remaining'), ',' order by (l ->> 'line_no')::integer)
            from jsonb_array_elements(g.lines) l)
    from erp.get_purchase_order(pg_temp.u(p_actor), pg_temp.u(p_facility), pg_temp.u(p_order)) g
$f$;

create function pg_temp.on_hand(p_item text, p_facility text default '403') returns text language sql as $f$
  select coalesce((select trim_scale(b.on_hand)::text from erp.stock_balance b
                    where b.facility_id = pg_temp.u(p_facility) and b.item_id = pg_temp.u(p_item)), 'none')
$f$;

create function pg_temp.set_state(p_capability text, p_facility text, p_state text, p_decision text)
returns void language sql as $f$
  insert into erp.capability_decision (decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at)
  values (pg_temp.u(p_decision), p_capability, pg_temp.u(p_facility), p_state, 'testing', pg_temp.u('900'), 'administrator', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values (p_capability, pg_temp.u(p_facility), p_state, pg_temp.u(p_decision))
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

select ok(to_regclass('erp.purchase_order_decision') is not null and to_regclass('erp.purchase_order') is not null
      and to_regclass('erp.purchase_order_line') is not null and to_regclass('erp.purchase_receipt') is not null
      and to_regclass('erp.purchase_receipt_line') is not null and to_regclass('erp.purchase_limit_decision') is not null
      and to_regclass('erp.purchase_limit') is not null,
  'the seven tables exist');
select fk_ok('erp', 'purchase_order', 'as_of_decision_id', 'erp', 'purchase_order_decision', 'decision_id',
  'an order names the decision that put its state in force (I-8)');
select fk_ok('erp', 'purchase_limit', 'as_of_decision_id', 'erp', 'purchase_limit_decision', 'decision_id',
  'a limit names the decision that set it (I-8)');
select is((select count(*)::integer from unnest(array['purchase_limit_decision', 'purchase_limit', 'purchase_order_decision',
                                                      'purchase_order', 'purchase_order_line', 'purchase_receipt',
                                                      'purchase_receipt_line']) t
            where has_table_privilege('erp_app', 'erp.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 0,
  'the runtime has no privilege on any of them');
select ok(has_function_privilege('erp_app', 'erp.raise_purchase_order(uuid,uuid,uuid,uuid,integer,jsonb,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.decide_purchase_order(uuid,uuid,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.receive_purchase_order(uuid,uuid,uuid,timestamptz,jsonb,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.reverse_purchase_receipt(uuid,uuid,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.set_purchase_limit(uuid,uuid,bigint,text,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.clear_purchase_limit(uuid,uuid,uuid,text,uuid,timestamptz)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.purchase_orders(uuid,uuid,text,bigint,integer)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.get_purchase_order(uuid,uuid,uuid)', 'EXECUTE')
      and has_function_privilege('erp_app', 'erp.purchase_limit_history(uuid,uuid,bigint,integer)', 'EXECUTE'),
  'the runtime may call the six routes and the three reads');
select ok(not has_function_privilege('erp_app', 'erp.post_stock(uuid,text,uuid,timestamptz,jsonb,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
      and not has_function_privilege('erp_app', 'erp.lock_purchase_order(uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('erp_app', 'erp.purchase_order_received(uuid)', 'EXECUTE')
      and not has_function_privilege('erp_app', 'erp.assert_purchase_order_decision_is_new(uuid)', 'EXECUTE'),
  'and not the seam or the helpers');
select is((select array_agg(c.capability_key::text order by c.capability_key) from erp.capability c
            where c.capability_key in ('procurement.purchase_orders', 'procurement.purchase_limits')),
  array['procurement.purchase_limits', 'procurement.purchase_orders'], 'both capabilities are registered');
select is((select string_agg(rp.capability_key || ':' || rp.action, ',' order by rp.capability_key, rp.action)
             from erp.role_permission rp where rp.role_key = 'administrator' and rp.capability_key like 'procurement.purchase%'),
  'procurement.purchase_limits:read,procurement.purchase_limits:write,procurement.purchase_orders:approve,procurement.purchase_orders:read,procurement.purchase_orders:write',
  'a real database grants the administrator both, and nobody else (0023)');

-- ---------------------------------------------------------------------------
-- Raising an order (P1, P2, P3)
-- ---------------------------------------------------------------------------

select is(pg_temp.after(
  $$ select o.state || ' ' || o.number || ' ' || (o.as_of_decision_id = o.raised_decision_id)::text || ' '
            || (d.limit_decision_id = pg_temp.u('6101'))::text
       from erp.purchase_order o join erp.purchase_order_decision d on d.decision_id = o.raised_decision_id
      where o.purchase_order_id = pg_temp.u('e2301') $$,
  $$ select pg_temp.small('e2321', 'e2301') $$),
  'approved WH-001-PO-' || to_char((clock_timestamp() at time zone 'Asia/Riyadh')::date, 'YYYYMMDD') || '-0001 true true',
  'an order within the limit, before VAT, is approved when raised, by the limit in force, numbered by its facility and day');
select is(pg_temp.after(
  $$ select o.subtotal_minor || ' ' || o.vat_minor || ' ' || o.total_minor || ' ' || l.amount_minor
       from erp.purchase_order o join erp.purchase_order_line l on l.purchase_order_id = o.purchase_order_id
      where o.purchase_order_id = pg_temp.u('e2301') $$,
  $$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4201', '2.5', 1999))) $$),
  '4998 750 5748 4998',
  'P2: 2.5 kg at 19.99 is 49.98, rounded half away from zero to the halala; VAT 15% of that, 7.497, is 7.50');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$, $$ select pg_temp.large('e2321', 'e2301') $$),
  'pending', 'CONTROL: over the limit before VAT, an order waits for an approver (P3)');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$,
  $$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4203', '39', 12500)), '904', '403', '5101', 10000) $$),
  'approved', 'compared BEFORE VAT: 4,875.00 at 100% VAT is still within 5,000.00 — VAT cannot be set to dodge it');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$,
  $$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4201', '1', 100)), '908', '404') $$),
  'pending', 'at a facility with no limit, every order waits, however small');
select is(pg_temp.after(
  $$ select string_agg(o.day_seq::text, ',' order by o.day_seq) from erp.purchase_order o
      where o.purchase_order_id in (pg_temp.u('e2301'), pg_temp.u('e2302')) $$,
  $$ select pg_temp.small('e2321', 'e2301') $$, $$ select pg_temp.small('e2322', 'e2302') $$),
  '1,2', 'the next order that day is the facility''s next number');
select is(pg_temp.after(
  $$ select l.supplier_item_id = pg_temp.u('5201') and l.unit_key = 'carton' and l.factor = 10 and l.base_quantity = 20
       from erp.purchase_order_line l where l.purchase_order_id = pg_temp.u('e2301') $$,
  $$ select pg_temp.small('e2321', 'e2301') $$),
  'true', 'a line copies the supply it orders, and its pack whole (ADR-0026, I-7)');

select is(pg_temp.refusal($$ select pg_temp.small('e2321', 'e2301', '907') $$), '23001 -',
  'the accountant, who approves, does not raise (IAM-003)');
select is(pg_temp.refusal($$ select pg_temp.small('e2321', 'e2301', '901') $$), '23001 -',
  'nor does a branch worker');
select is(pg_temp.refusal($$ select pg_temp.small('e2321', 'e2301', '908') $$), '23001 -',
  'the factory manager raises at the factory, and not at the warehouse (IAM-006)');
select is(pg_temp.refusal($$ select pg_temp.set_state('procurement.purchase_orders', '403', 'hidden', 'e2391') $$,
                          $$ select pg_temp.small('e2321', 'e2301') $$), '23001 -',
  'CONTROL: hidden at the warehouse, no order is raised there (CAP-P02)');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4203', '2', 12500)), '900', '401') $$),
  '23001 stock_branch_business_day_undecided', 'a branch holds no stock, so nothing is delivered to one yet (Q-06)');
select is(pg_temp.refusal($$ select erp.raise_purchase_order(pg_temp.u('e2321'), pg_temp.u('e2301'), erp.org_scope(),
                                pg_temp.u('5101'), 1500, jsonb_build_array(pg_temp.line('4203', '2', 12500)), 'testing',
                                pg_temp.u('900'), now()) $$),
  '22023 stock_facility_required', 'an order names the facility it goes to');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4224', '1', 9000)),
                                                  '904', '403', '5104') $$),
  '23001 supplier_admits_no_new_work', 'a retired supplier takes no new order, though its supply is active (ADR-0026)');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4213', '1', 500)),
                                                  '904', '403', '5102') $$),
  '23001 purchase_order_line_not_supplied', 'CONTROL: a line orders only a pack the supplier supplies');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4209', '1', 3000)),
                                                  '904', '403', '5103') $$),
  '23001 purchase_order_line_pack_is_retired', 'a retired pack is not ordered (I-7)');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4227', '1', 300)),
                                                  '904', '403', '5105') $$),
  'P0002 item_unit_exists', 'another brand''s pack answers as a missing one (ADR-0012)');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301',
                                jsonb_build_array(pg_temp.line('4203', '2', 12500), pg_temp.line('4203', '1', 12500))) $$),
  '23514 purchase_order_line_pack_once', 'one line per pack');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4203', '0', 12500))) $$),
  '23514 purchase_order_line_quantity_is_exact', 'nothing is not ordered');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(
                                jsonb_build_object('item_unit_id', pg_temp.u('4203'), 'quantity', '2', 'price_minor', '12500'))) $$),
  '23514 purchase_order_line_price_is_minor_units', 'CONTROL: a price sent as text is refused, never guessed at');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(
                                jsonb_build_object('item_unit_id', pg_temp.u('4203'), 'quantity', '2', 'price_minor', 125.5))) $$),
  '23514 purchase_order_line_price_is_minor_units', 'a price is a whole number of halalas');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(
                                pg_temp.line('4203', '2', 12500) || jsonb_build_object('supplier_item_id', pg_temp.u('5201')))) $$),
  '23514 purchase_order_lines_are_stated', 'a line carries its pack, its quantity and its price, and nothing else');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4203', '2', 12500)),
                                                  '904', '403', '5101', 10001) $$),
  '23514 purchase_order_vat_rate_is_known', 'VAT is 0 to 100%');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', '[]'::jsonb) $$),
  '23514 purchase_order_lines_are_stated', 'an order has a line');
select is(pg_temp.refusal($$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4203', '2', 12500)),
                                                  '904', '403', '5101', 1500, '  ') $$),
  '23514 purchase_order_reason_is_stated', 'an order states why it is raised');
select is(pg_temp.refusal($$ select pg_temp.small('e2321', 'e2301') $$, $$ select pg_temp.small('e2322', 'e2301') $$),
  '23505 purchase_order_raised_once', 'one id, one order: the same id under another decision is refused');
select is(pg_temp.refusal($$ select pg_temp.small('e2321', 'e2301') $$, $$ select pg_temp.small('e2321', 'e2302') $$),
  '23505 purchase_order_decision_pkey', 'a retry is answered as one');

-- ---------------------------------------------------------------------------
-- Deciding (P3, PRC-004)
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$ select pg_temp.state('5901') $$, $$ select pg_temp.decide('e2331', '5901', 'order_approved') $$),
  'approved', 'someone holding approve, who did not raise it, approves a pending order');
select is(pg_temp.after($$ select pg_temp.state('5901') $$, $$ select pg_temp.decide('e2331', '5901', 'order_rejected') $$),
  'rejected', 'or rejects it');
select is(pg_temp.after($$ select pg_temp.state('5906') $$, $$ select pg_temp.decide('e2331', '5906', 'order_approved', '907', '404') $$),
  'approved', 'the accountant approves at the factory too: their role reaches every facility');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_approved', '904') $$), '23001 -',
  'the warehouse manager, who raises, does not approve (IAM-003)');
select is(pg_temp.refusal($$ select pg_temp.large('e2321', 'e2301', '900') $$,
                          $$ select pg_temp.decide('e2331', 'e2301', 'order_approved', '900') $$),
  '23001 purchase_order_self_approval', 'CONTROL: the administrator, who holds both, does not approve an order they raised (PRC-004)');
select is(pg_temp.refusal($$ select pg_temp.large('e2321', 'e2301', '900') $$,
                          $$ select pg_temp.decide('e2331', 'e2301', 'order_rejected', '900') $$),
  '23001 purchase_order_self_approval', 'nor rejects it: they cancel it');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$, $$ select pg_temp.large('e2321', 'e2301', '900') $$,
                        $$ select pg_temp.decide('e2331', 'e2301', 'order_cancelled', '900') $$),
  'cancelled', 'whoever raised an order may cancel it');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$,
  $$ select pg_temp.set_limit('e2371', '404', 300000, null, '900') $$,
  $$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4201', '1', 100)), '900', '404') $$),
  'pending', 'CONTROL: a limit set by whoever raises the order does not approve it, or they would approve their own (PRC-004)');
select is(pg_temp.refusal($$ select erp.change_supplier_status(pg_temp.u('e2381'), pg_temp.u('5101'),
                               (select s.as_of_decision_id from erp.supplier s where s.supplier_id = pg_temp.u('5101')),
                               'retired', 'testing', pg_temp.u('900'), now()) $$,
                          $$ select pg_temp.decide('e2331', '5901', 'order_approved') $$),
  '23001 supplier_admits_no_new_work', 'an order from a supplier retired since is not approved: that commits to buy from it');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5903', 'order_approved') $$),
  '23001 purchase_order_not_pending', 'an order already approved is not approved again');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5904', 'order_cancelled', '904') $$),
  '23001 purchase_order_is_finished', 'a rejected order is finished: it is not cancelled');
select is(pg_temp.after($$ select pg_temp.state('5903') $$, $$ select pg_temp.decide('e2331', '5903', 'order_cancelled', '904') $$),
  'cancelled', 'an approved order with nothing received is cancelled, which withdraws it');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5902', 'order_closed', '904') $$),
  '23001 purchase_order_nothing_received', 'an order with nothing received is cancelled, not closed');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_closed', '904') $$),
  '23001 purchase_order_not_approved', 'nor is a pending one closed');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_paid') $$),
  '23514 purchase_order_decision_kind_is_known', 'an order is approved, rejected, cancelled or closed — nothing about payment');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5906', 'order_approved') $$),
  'P0002 purchase_order_exists', 'an order at another facility answers as a missing one');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_approved', '907', '403', '') $$),
  '23514 purchase_order_reason_is_stated', 'a decision states why');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_approved') $$,
                          $$ select pg_temp.decide('e2331', '5901', 'order_rejected') $$),
  '23505 purchase_order_decision_pkey', 'a retry is answered as one');

-- ---------------------------------------------------------------------------
-- Receiving (PRC-006, INV-006) — through 0020's seam
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$ select pg_temp.on_hand('4111') || ' ' || pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$),
  '125 approved partial 5/15,0/10', 'five bags of rice in: 25 kg on the shelf, and the order shows what is still to come');
select is(pg_temp.after(
  $$ select d.kind || ' ' || d.reason || ' ' || r.delivery_note || ' ' || e.direction
       from erp.stock_decision d join erp.purchase_receipt r on r.decision_id = d.decision_id
       join erp.stock_ledger e on e.decision_id = d.decision_id
      where d.decision_id = pg_temp.u('e2341') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5')), '904', '403', null, 'DN-1001') $$),
  'receipt Received against a purchase order DN-1001 in',
  'a receipt is a stock decision of kind receipt, inward; its reason names no order, which a stock reader need not read');
select is(pg_temp.after(
  $$ select (r.order_decision_id = pg_temp.u('6006'))::text from erp.purchase_receipt r where r.decision_id = pg_temp.u('e2341') $$,
  $$ select pg_temp.receive('e2341', '5903', jsonb_build_array(pg_temp.rl(1, '1'))) $$),
  'true', 'a receipt names the order''s decision in force when it arrived: the approval');
select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '20'), pg_temp.rl(2, '10'))) $$),
  'approved full 20/0,10/0', 'every line in full: received in full, still approved');
select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '12'))) $$,
  $$ select pg_temp.receive('e2342', '5902', jsonb_build_array(pg_temp.rl(1, '8'), pg_temp.rl(2, '3'))) $$),
  'approved partial 20/0,3/7', 'receipts add up, line by line');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '12'))) $$,
                          $$ select pg_temp.receive('e2342', '5902', jsonb_build_array(pg_temp.rl(1, '9'))) $$),
  '23001 purchase_receipt_exceeds_order', 'CONTROL: never more than is still to come');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '20.5'))) $$),
  '23001 purchase_receipt_exceeds_order', 'nor more than was ordered, by a half');
select is(pg_temp.refusal($$ select pg_temp.decide('e2331', '5901', 'order_approved') $$,
                          $$ select pg_temp.receive('e2341', '5904', jsonb_build_array(pg_temp.rl(1, '1'))) $$),
  '23001 purchase_order_not_approved', 'nothing arrives against a rejected order');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5901', jsonb_build_array(pg_temp.rl(1, '1'))) $$),
  '23001 purchase_order_not_approved', 'CONTROL: nor against one still waiting for approval');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5905', jsonb_build_array(pg_temp.rl(1, '1'))) $$),
  '23001 purchase_order_not_approved', 'nor against a cancelled one');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(3, '1'))) $$),
  'P0002 purchase_order_line_exists', 'a receipt line names a line of the order');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1'), pg_temp.rl(1, '2'))) $$),
  '23514 purchase_receipt_line_once', 'one receipt line per order line');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '0'))) $$),
  '23514 stock_quantity_is_valid', 'nothing does not arrive');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902',
                               jsonb_build_array(pg_temp.rl(1, '1') || jsonb_build_object('item_unit_id', pg_temp.u('4225')))) $$),
  '23514 purchase_receipt_lines_are_stated', 'a receipt line carries no pack: it arrives in the one ordered');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(jsonb_build_object('line_no', '1', 'quantity', '1'))) $$),
  '23514 purchase_receipt_lines_are_stated', 'a line number is a number');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '907') $$),
  '23001 -', 'the accountant, who moves no stock, does not receive (IAM-003)');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '908') $$),
  '23001 -', 'nor does the factory manager, at the warehouse');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '904', '403',
                                                    timestamptz '2026-09-30 05:00:00+00') $$),
  '23514 purchase_receipt_before_order', 'goods are received after the order was raised');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '904', '403',
                                                    now() + interval '1 hour') $$),
  '23514 stock_not_in_future', 'and not before they arrive: 0020''s own rule');
select is(pg_temp.after(
  $$ select (d.occurred_at = timestamptz '2026-10-01 07:30:00+00')::text || ' ' || d.moment_stated || ' ' || d.business_date
       from erp.stock_decision d where d.decision_id = pg_temp.u('e2341') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '904', '403',
                            timestamptz '2026-10-01 07:30:00+00') $$),
  'true true 2026-10-01', 'entered late, a receipt states when the goods arrived, dated by the facility''s calendar (D3)');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1')), '904', '403', null,
                                                    repeat('9', 65)) $$),
  '23514 purchase_receipt_delivery_note_is_canonical', 'a delivery note number is at most 64 characters');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '1'))) $$,
                          $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '2'))) $$),
  '23505 stock_decision_pkey', 'a retry is answered as one, on the stock log');

-- ---------------------------------------------------------------------------
-- Reversing a receipt (P4)
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$ select pg_temp.on_hand('4111') || ' ' || pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
  $$ select pg_temp.reverse('e2351', 'e2341') $$),
  '100 approved none 0/20,0/10', 'CONTROL: reversed, the stock goes back out and the order''s lines reopen');
select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
  $$ select pg_temp.reverse('e2351', 'e2341') $$,
  $$ select pg_temp.receive('e2342', '5902', jsonb_build_array(pg_temp.rl(1, '20'))) $$),
  'approved partial 20/0,0/10', 'and what was reversed may be received again');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select erp.reverse_stock_decision(pg_temp.u('e2351'), pg_temp.u('403'), pg_temp.u('e2341'),
                                                               'testing', null, pg_temp.u('904'), now()) $$),
  '23001 stock_receipt_reversed_through_its_order', 'CONTROL: the stock route does not reverse a receipt, so no order is left believing it arrived');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select pg_temp.reverse('e2351', 'e2341') $$, $$ select pg_temp.reverse('e2352', 'e2341') $$),
  '23505 stock_already_reversed', 'a receipt is reversed once');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select erp.record_stock_count(pg_temp.u('e2361'), pg_temp.u('403'), null,
                               jsonb_build_array(jsonb_build_object('item_unit_id', pg_temp.u('4225'), 'quantity', '125')),
                               'testing', pg_temp.u('904'), now()) $$,
                          $$ select pg_temp.reverse('e2351', 'e2341') $$),
  '23001 stock_reversal_counted_since', 'nor once a count has covered it (ADR-0029 §5)');
select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
  $$ select pg_temp.decide('e2331', '5902', 'order_closed', '904') $$,
  $$ select pg_temp.reverse('e2351', 'e2341') $$),
  'closed none 0/20,0/10', 'a closed order''s receipt is reversed too, and the order stays closed: the rest still will not come');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select pg_temp.reverse('e2351', 'e2341', '904', '404') $$),
  'P0002 purchase_receipt_exists', 'a receipt at another facility answers as a missing one');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select pg_temp.reverse('e2351', 'e2341', '907') $$),
  '23001 -', 'whoever moves no stock does not reverse a receipt');

-- ---------------------------------------------------------------------------
-- Closing and cancelling around receipts
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
  $$ select pg_temp.decide('e2331', '5902', 'order_closed', '904') $$),
  'closed partial 5/15,0/10', 'part received, the rest not coming: closed short');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select pg_temp.decide('e2331', '5902', 'order_closed', '904') $$,
                          $$ select pg_temp.receive('e2342', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$),
  '23001 purchase_order_not_approved', 'nothing more arrives against a closed order');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '20'), pg_temp.rl(2, '10'))) $$,
                          $$ select pg_temp.decide('e2331', '5902', 'order_closed', '904') $$),
  '23001 purchase_order_received_in_full', 'an order received in full has nothing left to close');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ select pg_temp.decide('e2331', '5902', 'order_cancelled', '904') $$),
  '23001 purchase_order_has_receipts', 'CONTROL: an order with goods received is not cancelled');
select is(pg_temp.after($$ select pg_temp.shown('5902') $$,
  $$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
  $$ select pg_temp.reverse('e2351', 'e2341') $$,
  $$ select pg_temp.decide('e2331', '5902', 'order_cancelled', '904') $$),
  'cancelled none 0/20,0/10', 'once its receipts are reversed, it is');

-- ---------------------------------------------------------------------------
-- Guards — they bind the owner too
-- ---------------------------------------------------------------------------

select is(pg_temp.refusal($$ update erp.purchase_order set total_minor = 1 where purchase_order_id = pg_temp.u('5901') $$),
  '23001 purchase_order_fixed', 'an order''s amounts never change, by anyone');
select is(pg_temp.refusal($$ update erp.purchase_order set state = 'pending' where purchase_order_id = pg_temp.u('5903') $$),
  '23001 purchase_order_state_moves_forward', 'an order''s state moves only forward');
select is(pg_temp.refusal($$ delete from erp.purchase_order where purchase_order_id = pg_temp.u('5905') $$),
  '23001 purchase_order_never_deleted', 'an order is never deleted');
select is(pg_temp.refusal($$ truncate erp.purchase_order cascade $$), '23001 -', 'nor truncated');
select is(pg_temp.refusal($$ update erp.purchase_order_line set price_minor = 1 where purchase_order_id = pg_temp.u('5901') $$),
  '23001 -', 'an order''s lines are written once');
select is(pg_temp.refusal($$ select pg_temp.receive('e2341', '5902', jsonb_build_array(pg_temp.rl(1, '5'))) $$,
                          $$ delete from erp.purchase_receipt_line where decision_id = pg_temp.u('e2341') $$),
  '23001 -', 'a receipt''s lines too');
select is(pg_temp.refusal($$ update erp.purchase_order_decision set reason = 'x' where purchase_order_id = pg_temp.u('5901') $$),
  '23001 -', 'the order log is append-only');
select is(pg_temp.refusal($$ delete from erp.purchase_limit $$), '23001 purchase_limit_never_deleted',
  'a limit is cleared, never deleted');

-- ---------------------------------------------------------------------------
-- Limits (P3, PRC-002)
-- ---------------------------------------------------------------------------

select is(pg_temp.after($$ select pg_temp.state('e2301') $$,
  $$ select pg_temp.set_limit('e2371', '404', 300000, null) $$,
  $$ select pg_temp.raise('e2321', 'e2301', jsonb_build_array(pg_temp.line('4201', '200', 1250)), '908', '404') $$),
  'approved', 'a limit set at the factory approves what is within it there');
select is(pg_temp.after($$ select pg_temp.state('e2301') $$,
  $$ select pg_temp.clear_limit('e2371', '403', '6101') $$, $$ select pg_temp.small('e2321', 'e2301') $$),
  'pending', 'cleared, every order waits, however small');
select is(pg_temp.after(
  $$ select string_agg(h.kind || ':' || coalesce(h.limit_minor::text, '-') || ':' || h.is_current, ',' order by h.seq desc)
       from erp.purchase_limit_history(pg_temp.u('907'), pg_temp.u('403')) h $$,
  $$ select pg_temp.set_limit('e2371', '403', 800000, '6101') $$),
  'limit_set:800000:true,limit_set:500000:false', 'every limit is kept, newest first, the current one marked');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '403', 800000, '6101', '907') $$), '23001 -',
  'CONTROL: the accountant, who approves, does not set the limit that approves without them');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '403', 800000, '6101', '904') $$), '23001 -',
  'nor does the warehouse manager, who raises');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '403', 800000, null) $$), '23001 purchase_limit_stale',
  'a limit is set against the one read');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '403', 500000, '6101') $$), '23001 purchase_limit_unchanged',
  'a limit unchanged is not recorded again');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '404', 0, null) $$), '23514 purchase_limit_is_minor_units',
  'a limit is more than nothing: to have none, clear it');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '404', 100, null, '900', 'USD') $$),
  '23514 purchase_limit_currency_is_known', 'a limit is in riyals');
select is(pg_temp.refusal($$ select pg_temp.clear_limit('e2371', '404', null) $$), '23001 purchase_limit_not_set',
  'a facility with no limit has none to clear');
select is(pg_temp.refusal($$ select pg_temp.set_limit('e2371', '404', 100, null) $$,
                          $$ select pg_temp.clear_limit('e2371', '404', 'e2371') $$),
  '23505 purchase_limit_decision_pkey', 'a retry is answered as one');

-- ---------------------------------------------------------------------------
-- Reads (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

select is((select string_agg(o.number || ':' || o.state || ':' || o.progress, ',' order by o.seq desc)
             from erp.purchase_orders(pg_temp.u('907'), pg_temp.u('403')) o),
  'WH-001-PO-20261002-0001:cancelled:none,WH-001-PO-20261001-0002:rejected:none,WH-001-PO-20261001-0001:approved:none,WH-001-PO-20260930-0002:approved:none,WH-001-PO-20260930-0001:pending:none',
  'the warehouse''s orders, newest first, and only the warehouse''s');
select is((select count(*)::integer from erp.purchase_orders(pg_temp.u('907'), pg_temp.u('403'), 'approved')), 2,
  'narrowed to one state');
select is((select count(*)::integer from erp.purchase_orders(pg_temp.u('908'), pg_temp.u('404'))), 1,
  'the factory manager reads the factory''s');
select is(pg_temp.refusal($$ select * from erp.purchase_orders(pg_temp.u('908'), pg_temp.u('403')) $$), '23001 -',
  'and not the warehouse''s (IAM-006)');
select is(pg_temp.refusal($$ select * from erp.purchase_orders(pg_temp.u('901'), pg_temp.u('401')) $$), '23001 -',
  'a branch worker reads none');
select is(pg_temp.refusal($$ select * from erp.purchase_orders(pg_temp.u('907'), erp.org_scope()) $$),
  '22023 stock_facility_required', 'CONTROL: every read names one facility, so no list mixes them');
select is(pg_temp.refusal($$ select * from erp.get_purchase_order(pg_temp.u('907'), pg_temp.u('403'), pg_temp.u('5906')) $$),
  'P0002 purchase_order_exists', 'the factory''s order, asked for at the warehouse, answers as a missing one');
select is(pg_temp.refusal($$ select * from erp.purchase_limit_history(pg_temp.u('904'), pg_temp.u('403')) $$), '23001 -',
  'the warehouse manager does not read the limits');

select * from finish();
rollback;
