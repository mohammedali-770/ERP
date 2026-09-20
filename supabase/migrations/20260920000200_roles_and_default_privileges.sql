-- 0002 · Roles, grants and default privileges
--
-- Requirements: SEC-003 · SEC-004 · SEC-006
--
-- The safe case must be the DEFAULT, not the remembered one. The inbox project
-- protects its tables with a hand-written `revoke` in every migration; that
-- discipline failed four times out of nineteen. Here the default privileges
-- grant anon and authenticated nothing, so forgetting a line is harmless and
-- granting access is the deliberate act.

do $$
begin
  -- Supabase provides these. Created here only when absent, so the migration
  -- also applies to a bare Postgres (tools/db-check).
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  -- ERP roles. erp_owner owns the objects and never logs in; erp_app is the
  -- runtime; erp_read is for reporting and holds no write anywhere.
  if not exists (select 1 from pg_roles where rolname = 'erp_owner') then
    create role erp_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_read') then
    create role erp_read nologin noinherit;
  end if;
end
$$;

alter schema erp owner to erp_owner;

-- No API role reaches the ERP schema. service_role carries BYPASSRLS, which
-- skips policy evaluation but NOT aclcheck — so withholding USAGE is what
-- actually binds it (ADR-0018 §3).
revoke all on schema erp from public, anon, authenticated, service_role;
grant usage on schema erp to erp_app, erp_read;

-- The default that matters.
alter default privileges for role erp_owner in schema erp
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role erp_owner in schema erp
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role erp_owner in schema erp
  revoke all on functions from public, anon, authenticated;

-- erp_app gets nothing by default either. Every write privilege is stated per
-- table, in the migration that creates it, in the diff a human reviews.
alter default privileges for role erp_owner in schema erp
  grant select on tables to erp_read;

grant usage on schema extensions to erp_app, erp_read;
