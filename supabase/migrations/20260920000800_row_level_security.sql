-- 0008 · Row-level security
--
-- Requirements: SEC-004 · SEC-005 · SEC-006
--
-- RLS is enabled on every ERP table. Note what this is and is not doing:
-- nothing outside the erp schema can reach these tables at all, because 0002
-- withheld USAGE from anon, authenticated and service_role. RLS is the second
-- layer, for when a future migration grants a role access on purpose.
--
-- Enabling RLS with no policy denies everything to non-owner roles. That is the
-- intended posture here, and it is the opposite of the estate's inbox project,
-- where four tables have RLS switched OFF and are writable with the anon key.

set local search_path = erp, extensions, pg_catalog;

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'erp'
      and c.relkind in ('r', 'p')          -- ordinary and partitioned tables
      and c.relispartition = false          -- a partition inherits its parent
  loop
    execute format('alter table erp.%I enable row level security', t.relname);
    execute format('alter table erp.%I force row level security', t.relname);
  end loop;
end
$$;

-- erp_read reports across the ERP and is the one role with a policy today.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'erp'
      and c.relkind in ('r', 'p')
      and c.relispartition = false
  loop
    execute format(
      'create policy erp_read_all on erp.%I for select to erp_read using (true)',
      t.relname
    );
  end loop;
end
$$;

-- erp_app reads and writes what 0003..0006 granted it, and the policies mirror
-- those grants rather than widening them.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'erp'
      and c.relkind in ('r', 'p')
      and c.relispartition = false
  loop
    execute format(
      'create policy erp_app_all on erp.%I for all to erp_app using (true) with check (true)',
      t.relname
    );
  end loop;
end
$$;
