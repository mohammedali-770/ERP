-- pgTAP · schema layout, roles and grants
--
-- Run by `supabase test db` against the local stack. tools/db-check asserts the
-- same structural facts against bare Postgres; this suite re-asserts them where
-- the real Supabase roles exist, and then goes further than bare Postgres can.

begin;
select plan(18);

-- Schemas
select has_schema('erp',        'the erp schema exists');
select has_schema('extensions', 'extensions has its own schema');

-- ADR-0018 §1: a relation in public is born writable by the anon key.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m') $$,
  'public holds no relation at all'
);

select is_empty(
  $$ select e.extname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where n.nspname = 'public' and e.extname <> 'plpgsql' $$,
  'no extension is installed in public'
);

-- Roles
select has_role('erp_owner', 'erp_owner exists');
select has_role('erp_app',   'erp_app exists');
select has_role('erp_read',  'erp_read exists');

-- The API roles cannot reach the ERP at all. service_role carries BYPASSRLS,
-- which skips policy evaluation but not aclcheck — USAGE is what binds it.
select ok(not has_schema_privilege('anon',          'erp', 'USAGE'), 'anon has no USAGE on erp');
select ok(not has_schema_privilege('authenticated', 'erp', 'USAGE'), 'authenticated has no USAGE on erp');
select ok(not has_schema_privilege('service_role',  'erp', 'USAGE'), 'service_role has no USAGE on erp');

select ok(has_schema_privilege('erp_app',  'erp', 'USAGE'), 'erp_app has USAGE on erp');
select ok(has_schema_privilege('erp_read', 'erp', 'USAGE'), 'erp_read has USAGE on erp');

-- Default privileges: the safe case is the default, not the remembered one.
select is_empty(
  $$ select n.nspname from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'erp'
       and (array_to_string(d.defaclacl, ',') like '%anon=%'
         or array_to_string(d.defaclacl, ',') like '%authenticated=%') $$,
  'default privileges in erp grant nothing to anon or authenticated'
);

-- Organisation hierarchy — PRG-002, every level present from the first migration.
select has_table('erp', 'company',        'company');
select has_table('erp', 'legal_entity',   'legal_entity');
select has_table('erp', 'facility',       'facility');
select has_table('erp', 'sales_channel',  'sales_channel — an orthogonal dimension, carried early (ADR-0012)');
select has_table('erp', 'device',         'device — the identity that mints event_id and device_seq');

select * from finish();
rollback;
