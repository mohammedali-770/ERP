-- 0007 · Storage buckets and their policies
--
-- Requirements: SEC-004 · SEC-005 · SEC-008
--
-- Supabase Storage keeps its objects in the `storage` schema, which exists only
-- in the Supabase stack. On a bare Postgres (tools/db-check) this migration is
-- a no-op rather than an error, so the same file applies in both places and
-- there is no second, divergent copy of the truth.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent (bare Postgres) — skipping bucket setup';
    return;
  end if;

  -- Private by default. A public bucket is a deliberate, reviewed act.
  insert into storage.buckets (id, name, public)
  values
    ('erp-documents',  'erp-documents',  false),
    ('erp-receipts',   'erp-receipts',   false),
    ('erp-menu-media', 'erp-menu-media', false)
  on conflict (id) do nothing;
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  -- No anon or authenticated policy is created at all. Access is through the
  -- service path, which is the least-privilege default SEC-004 asks for; a
  -- narrower per-role policy is added when a real consumer exists, not before.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'erp_buckets_deny_anonymous'
  ) then
    execute $p$
      create policy erp_buckets_deny_anonymous on storage.objects
        for select to anon
        using (false)
    $p$;
  end if;
end
$$;
