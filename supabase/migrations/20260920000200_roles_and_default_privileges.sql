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

-- Ownership, and the privilege needed to hand it over.
--
-- The migration runner connects as `postgres`, which on hosted and local
-- Supabase is NOT a superuser. Both `ALTER SCHEMA ... OWNER TO erp_owner` and
-- `ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner` require membership in that role
-- that carries the SET option — and since PostgreSQL 16 the membership a role
-- creator receives carries ADMIN but not SET. `pg_has_role(..., 'MEMBER')` is
-- true in that state, so guarding on it skips the grant and the next statement
-- still fails. The option has to be named.
--
-- On a bare Postgres the runner is a superuser and none of this is needed,
-- which is why only the real stack found it.
do $$
begin
  execute format('grant erp_owner to %I with set true', current_user);
exception when others then
  -- Not fatal: schema ownership is defence in depth, and the protection that
  -- matters is the schema-level revoke below plus RLS. Reported rather than
  -- swallowed, and tests/010 and db-check probe the actual outcome on a real
  -- new table rather than trusting either path.
  raise notice 'could not take SET on erp_owner (%) — schema stays owned by %', sqlerrm, current_user;
end
$$;

do $$
begin
  if pg_has_role(current_user, 'erp_owner', 'USAGE') then
    execute 'alter schema erp owner to erp_owner';
  end if;
end
$$;

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
  -- erp_owner only when this role can actually act as it; otherwise the
  -- statement fails and the migration stops for a mechanism that is optional.
  foreach r in array (
    case when pg_has_role(current_user, 'erp_owner', 'USAGE')
         then array['erp_owner', current_user]
         else array[current_user] end
  ) loop
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
