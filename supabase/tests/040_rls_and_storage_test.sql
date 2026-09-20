-- pgTAP · row-level security and storage policies
--
-- This is the suite bare Postgres cannot run: the storage schema exists only in
-- the Supabase stack, and requirement 4 names storage policies explicitly.

begin;
select plan(10);

-- Every ERP table has RLS enabled AND forced. Enabled alone still exempts the
-- table owner, which is how an owner-connected migration silently bypasses it.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind in ('r','p')
       and c.relispartition = false and c.relrowsecurity = false $$,
  'every erp table has row-level security enabled'
);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind in ('r','p')
       and c.relispartition = false and c.relforcerowsecurity = false $$,
  'row-level security is forced, so the owner is not exempt'
);

-- Four tables in the estate's inbox project have RLS off and are anon-writable.
-- Enabled-with-no-policy denies; disabled exposes. This asserts the good case.
select ok(
  (select count(*) from pg_policies where schemaname = 'erp') > 0,
  'erp tables carry policies rather than relying on absence of grants alone'
);

-- Storage
select has_schema('storage', 'the storage schema exists in the local stack');
select has_table('storage', 'buckets', 'storage.buckets');
select has_table('storage', 'objects', 'storage.objects');

select is(
  (select count(*)::int from storage.buckets where id like 'erp-%'), 3,
  'the three ERP buckets exist'
);

-- Private by default: a public bucket is a deliberate, reviewed act.
select is_empty(
  $$ select id from storage.buckets where id like 'erp-%' and public is true $$,
  'no ERP bucket is public'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row-level security enabled'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'storage.objects carries at least one policy'
);

select * from finish();
rollback;
