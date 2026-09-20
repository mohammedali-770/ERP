-- 0001 · Extensions and schemas
--
-- Requirements: PRG-002 · SEC-004
-- ADR-0003 (accepted 2026-09-20) · ADR-0018
--
-- Extensions never live in `public`. In the estate's WhatsApp inbox project
-- pg_trgm was installed there, which pinned three SECURITY DEFINER functions to
-- `search_path = public` and coupled the whole system to a schema it should not
-- have depended on. Supabase's own advisor flags that every day. Starting them
-- in `extensions` costs nothing now and cannot be undone cheaply later.

create schema if not exists extensions;
create schema if not exists erp;

comment on schema erp is
  'All ERP objects. Nothing ERP-owned may be created in public — see ADR-0018.';

create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists pgcrypto    schema extensions;
create extension if not exists citext      schema extensions;

-- `public` stays empty of ERP objects and nobody may add to it. A table created
-- in public inherits default privileges granting anon and authenticated full
-- rights, with RLS off — the trap that has already fired four times in this
-- estate (ADR-0018 §1).
revoke create on schema public from public;
