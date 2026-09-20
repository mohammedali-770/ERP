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

-- The migration runner connects as `postgres`, which on hosted Supabase is NOT
-- a superuser. Transferring ownership and setting default privileges FOR ROLE
-- erp_owner both require membership in it, so take that membership explicitly.
-- On a bare Postgres the runner is a superuser and this is a no-op — which is
-- exactly why this was invisible until CI ran the real stack.
do $$
begin
  if not pg_has_role(current_user, 'erp_owner', 'MEMBER') then
    execute format('grant erp_owner to %I', current_user);
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
--
-- ALTER DEFAULT PRIVILEGES applies only to objects created BY THE NAMED ROLE.
-- Setting it for erp_owner alone would be inert, because the migration runner
-- creates these tables as itself — protection that reads correctly and does
-- nothing. Both roles are covered, and tests/010 plus db-check verify the
-- effect on a real new table rather than trusting the catalogue.
do $$
declare
  r text;
begin
  foreach r in array array['erp_owner', current_user] loop
    execute format(
      'alter default privileges for role %I in schema erp revoke all on tables from public, anon, authenticated, service_role', r);
    execute format(
      'alter default privileges for role %I in schema erp revoke all on sequences from public, anon, authenticated, service_role', r);
    execute format(
      'alter default privileges for role %I in schema erp revoke all on functions from public, anon, authenticated', r);
    -- erp_app gets nothing by default. Every write privilege is stated per
    -- table, in the migration that creates it, in the diff a human reviews.
    execute format(
      'alter default privileges for role %I in schema erp grant select on tables to erp_read', r);
  end loop;
end
$$;

grant usage on schema extensions to erp_app, erp_read;
