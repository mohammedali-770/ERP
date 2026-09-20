-- pgTAP · the event log is append-only, proved by trying
--
-- ADR-0003 requires TWO protections. Reading the catalogue proves they are
-- configured; only attempting the write proves they work, and a trigger that
-- exists and does not fire is precisely the failure worth catching.

begin;
select plan(9);

select has_table('erp', 'event_log', 'event_log exists');
select is_partitioned('erp', 'event_log', 'event_log is partitioned by business_date');

-- Protection one: the grant is absent, not revoked.
select ok(not has_table_privilege('erp_app', 'erp.event_log', 'UPDATE'), 'erp_app holds no UPDATE');
select ok(not has_table_privilege('erp_app', 'erp.event_log', 'DELETE'), 'erp_app holds no DELETE');
select ok(has_table_privilege('erp_app', 'erp.event_log', 'INSERT'),     'erp_app may append');
select ok(has_table_privilege('erp_app', 'erp.event_log', 'SELECT'),     'erp_app may read');

-- Protection two: attempted, not inspected.
insert into erp.event_log (
  event_id, device_id, device_seq, hlc, occurred_at, tz_name, business_date, branch_id,
  aggregate_type, aggregate_id, event_type, schema_version, payload, payload_hash, prev_hash,
  actor_type, ingested_at
) values (
  '01936f00-0000-7000-8000-0000000f0001', '01936f00-0000-7000-8000-0000000f0002', 1,
  'test-hlc', now(), 'Asia/Riyadh', current_date, '01936f00-0000-7000-8000-0000000f0003',
  'test', '01936f00-0000-7000-8000-0000000f0004', 'TestEvent', 1,
  '{}'::jsonb, decode('00','hex'), decode('00','hex'), 'system', now()
);

-- 23001 is restrict_violation, which migration 0004 names explicitly via
-- `using errcode = 'restrict_violation'`. P0001 is what a bare RAISE EXCEPTION
-- would give; asserting it here expected a trigger the migration does not have.
select throws_ok(
  $$ update erp.event_log set event_type = 'tampered'
     where event_id = '01936f00-0000-7000-8000-0000000f0001' $$,
  '23001', null,
  'UPDATE on event_log raises restrict_violation'
);

select throws_ok(
  $$ delete from erp.event_log where event_id = '01936f00-0000-7000-8000-0000000f0001' $$,
  '23001', null,
  'DELETE on event_log raises restrict_violation'
);

-- The trigger's own function must pin its search_path, or it is hijackable.
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'erp'
       and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') $$,
  'every erp function pins its search_path'
);

select * from finish();
rollback;
