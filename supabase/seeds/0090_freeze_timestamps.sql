-- Freeze the audit timestamps.
--
-- Every table defaults created_at / ingested_at / applied_at to now(), which is
-- correct for real rows and fatal for a seed: two builds from identical files
-- would differ, and LAB-005 requires a regression run to start from an identical
-- state. tools/db-check compares two builds and fails without this.
--
-- Runs last, so it also catches timestamps in fixtures added later without
-- anyone having to remember.
--
-- erp.event_log is deliberately NOT in scope: it is append-only, and the
-- BEFORE UPDATE OR DELETE trigger rejects this statement — as it rejected the
-- first version of this file. Its ingested_at is set explicitly at insert
-- instead, which is the only way to put a value there and is the point.

do $$
declare
  t record;
  frozen constant timestamptz := timestamptz '2026-09-20 00:00:00+00';
begin
  for t in
    select c.relname, a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    join pg_type ty on ty.oid = a.atttypid
    where n.nspname = 'erp'
      -- 'p' as well as 'r': event_log is partitioned, and updating the parent
      -- reaches its partitions. Matching only 'r' silently skipped it, which is
      -- what the two-build comparison caught.
      and c.relkind in ('r', 'p')
      and c.relispartition = false
      and a.attnum > 0
      and not a.attisdropped
      and ty.typname = 'timestamptz'
      and c.relname <> 'event_log'
      and a.attname in ('created_at', 'enrolled_at', 'ingested_at', 'applied_at', 'updated_at')
  loop
    execute format('update erp.%I set %I = $1 where %I is not null', t.relname, t.attname, t.attname)
      using frozen;
  end loop;
end
$$;
