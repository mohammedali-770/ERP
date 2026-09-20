-- pgTAP · the three partial unique indexes, proved by colliding with them
--
-- Invariant I-3: no financial fact is ever merged. Under a partition two devices
-- CAN both create an intent; the design guarantees DETECTION rather than
-- prevention, so the thing to test is that the second writer actually fails.
--
-- A full unique index would also make these throw — and would wrongly forbid
-- history. Each test therefore checks BOTH: the collision raises, and the
-- historical row is still permitted.

begin;
select plan(9);

select has_index('erp', 'payment_intents',    'ux_one_live_intent', 'one live intent per order');
select has_index('erp', 'shifts',             'ux_one_open_shift',  'one open shift per branch and cashier');
select has_index('erp', 'drawer_assignments', 'ux_one_open_drawer', 'one open assignment per drawer');

-- Every one of the three must be PARTIAL. Without the WHERE clause the index
-- forbids the closed rows too, and the seed's history would be illegal.
select is(
  (select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp'
     and c.relname in ('ux_one_live_intent','ux_one_open_shift','ux_one_open_drawer')
     and i.indisunique and i.indpred is not null),
  3, 'all three are partial unique indexes, not plain unique constraints'
);

-- A second OPEN shift for the same cashier in the same branch must fail.
select throws_ok(
  $$ insert into erp.shifts (shift_id, branch_id, cashier_id, status, business_date, opened_at)
     values ('01936f00-0000-7000-8000-0000000e0001',
             '01936f00-0000-7000-8000-000000000401',
             '01936f00-0000-7000-8000-000000000901',
             'open', current_date, now()) $$,
  '23505', null,
  'a second open shift for the same cashier collides'
);

-- …while a CLOSED one does not, which is what makes the index partial.
select lives_ok(
  $$ insert into erp.shifts (shift_id, branch_id, cashier_id, status, business_date, opened_at, closed_at)
     values ('01936f00-0000-7000-8000-0000000e0002',
             '01936f00-0000-7000-8000-000000000401',
             '01936f00-0000-7000-8000-000000000901',
             'closed', current_date, now(), now()) $$,
  'a closed shift for the same cashier is permitted — history is not forbidden'
);

-- A second LIVE intent on an order that already has one must fail. Order
-- ...2006 carries the seed's single unknown intent.
select throws_ok(
  $$ insert into erp.payment_intents (payment_intent_id, order_id, state, amount_minor, currency, created_at)
     values ('01936f00-0000-7000-8000-0000000e0003',
             '01936f00-0000-7000-8000-000000002006',
             'initiated', 5000, 'SAR', now()) $$,
  '23505', null,
  'a second live intent on one order collides — NFR-004'
);

-- Split tender: two SETTLED intents on one order are legal and must stay so.
select lives_ok(
  $$ insert into erp.payment_intents (payment_intent_id, order_id, state, amount_minor, currency, created_at)
     values ('01936f00-0000-7000-8000-0000000e0004',
             '01936f00-0000-7000-8000-000000002003',
             'captured', 100, 'SAR', now()) $$,
  'a further captured intent is permitted — split tender is not a conflict'
);

select throws_ok(
  $$ insert into erp.drawer_assignments (drawer_assignment_id, drawer_id, shift_id, assigned_at)
     values ('01936f00-0000-7000-8000-0000000e0005',
             '01936f00-0000-7000-8000-000000000a01',
             '01936f00-0000-7000-8000-000000001002', now()) $$,
  '23505', null,
  'a second open assignment for one drawer collides'
);

select * from finish();
rollback;
