-- pgTAP · the event log is append-only, proved by trying
--
-- ADR-0003 requires TWO protections. Reading the catalogue proves they are
-- configured; only attempting the write proves they work, and a trigger that
-- exists and does not fire is precisely the failure worth catching.
--
-- That happened. 0004's trigger is a STATEMENT trigger on the partitioned parent,
-- and PostgreSQL fires those only for statements that name the parent: until 0013,
-- `delete from erp.event_log_default` deleted every event. So each write is tried
-- through the partition too, and TRUNCATE on both.

begin;
select plan(13);

select has_table('erp', 'event_log', 'event_log exists');
select is_partitioned('erp', 'event_log', 'event_log is partitioned by business_date');

-- Protection one: the grant is absent, not revoked.
-- has_any_column_privilege, because a column-level UPDATE grant rewrites a row as well.
select ok(not has_any_column_privilege('erp_app', 'erp.event_log', 'UPDATE'), 'erp_app holds no UPDATE, not even on one column');
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

-- Through the partition, by name. `where true` rather than one event id: these bodies
-- are replayed alone by tools/db-fixtures, where the event inserted above does not
-- exist, and a row trigger needs a row. The seed puts its events in this partition.
select throws_ok(
  $$ update erp.event_log_default set event_type = 'tampered' where true $$,
  '23001', 'event_log is append-only (ADR-0003): UPDATE denied on event_log_default',
  'CONTROL: UPDATE through a partition is refused too'
);
select throws_ok(
  $$ delete from erp.event_log_default where true $$,
  '23001', 'event_log is append-only (ADR-0003): DELETE denied on event_log_default',
  'CONTROL: and so is DELETE through a partition'
);

-- TRUNCATE, which no UPDATE or DELETE trigger sees: on the parent, and on the
-- partition, whose statement triggers are its own.
select throws_ok(
  $$ truncate erp.event_log $$,
  '23001', 'event_log is append-only (ADR-0003): TRUNCATE denied on event_log',
  'TRUNCATE on event_log raises restrict_violation'
);
select throws_ok(
  $$ truncate erp.event_log_default $$,
  '23001', 'event_log is append-only (ADR-0003): TRUNCATE denied on event_log_default',
  'CONTROL: and so does TRUNCATE on a partition'
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
