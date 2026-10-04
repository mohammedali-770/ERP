-- 0015 · The viewer — what the console needs to know about the person signed in
--
-- Requirements: IAM-003 · IAM-006 · CAP-P02 · CAP-P04 · CAP-P06 · PRG-014 · INV-005
-- ADR-0025 · ADR-0021 · apps/console/src/navigation.ts
--
-- The console decides what its menu shows from two things: the state of each capability
-- where the person is working, and what the person may do there (navigation.ts). Until
-- now it had neither, so it showed nothing. erp.viewer() answers both for one person at
-- one facility, with the reference data the items screens need to fill a form: the
-- facilities the person can work at, the brands, and the register of units.
--
-- THIS IS NOT A CONTROL. Every route asks erp.assert_permitted() itself; a menu built
-- from this answer can show a person a door, never open one (CAP-P04).
--
-- SECURITY INVOKER, deliberately. Everything it reads, erp_app already reads, by grant
-- and by policy: people, roles and permissions (0011), capabilities (0010), the
-- organisation (0003) and the units (0012). So it runs with the caller's privileges,
-- reaches nothing new, and is no definer route for
-- every-runtime-definer-route-is-gated to account for. The edge passes only the person
-- the caller's session resolves to (ADR-0025).
--
-- PERMISSIONS MIRROR erp.permission_granted(): an active person, a role held
-- organisation-wide or at this facility. STATES are erp.capability_state_for() at this
-- facility, for every registered capability, so an absent key stays hidden in the
-- console exactly as it is in the database (CAP-P02).

create or replace function erp.viewer(p_person_id uuid, p_facility_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with me as (
    select p.* from erp.person p where p.person_id = p_person_id
  ),
  roles as (
    select pr.role_key, pr.scope_facility_id
    from erp.person_role pr
    where pr.person_id = p_person_id
  ),
  org_wide as (
    select exists (select 1 from roles r where r.scope_facility_id = erp.org_scope()) as yes
  )
  select jsonb_build_object(
    'person', (select jsonb_build_object(
                 'person_id', m.person_id, 'employee_number', m.employee_number,
                 'full_name_en', m.full_name_en, 'full_name_ar', m.full_name_ar,
                 'primary_facility_id', m.primary_facility_id, 'status', m.status)
               from me m),
    'facility_id', p_facility_id,
    'org_wide', (select yes from org_wide),
    -- Where the person can work: every facility for an organisation-wide role, otherwise
    -- the facilities their roles name.
    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'facility_id', f.facility_id, 'code', f.code, 'facility_type', f.facility_type,
               'name_en', f.name_en, 'name_ar', f.name_ar, 'brand_id', ou.brand_id)
             order by f.code collate "C")
      from erp.facility f
      join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
      where (select yes from org_wide)
         or f.facility_id in (select r.scope_facility_id from roles r)), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(g.permission order by g.permission collate "C")
      from (
        select distinct rp.capability_key || ':' || rp.action as permission
        from me m
        join roles r on true
        join erp.role_permission rp on rp.role_key = r.role_key
        where m.status = 'active'
          and (r.scope_facility_id = erp.org_scope() or r.scope_facility_id = p_facility_id)
      ) g), '[]'::jsonb),
    'states', coalesce((
      select jsonb_object_agg(c.capability_key, erp.capability_state_for(c.capability_key, p_facility_id))
      from erp.capability c), '{}'::jsonb),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object('brand_id', b.brand_id, 'code', b.code, 'name_en', b.name_en, 'name_ar', b.name_ar)
             order by b.code collate "C")
      from erp.brand b), '[]'::jsonb),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unit_key', u.unit_key, 'dimension', u.dimension,
               'name_en', u.name_en, 'name_ar', u.name_ar, 'symbol_en', u.symbol_en, 'symbol_ar', u.symbol_ar)
             order by u.dimension, u.per_reference nulls last, u.unit_key)
      from erp.unit u), '[]'::jsonb)
  );
$$;

comment on function erp.viewer(uuid, uuid) is
  'What the console shows one person at one facility: their capabilities'' states, their permissions there, where they can work, and the brands and units its forms need. Security invoker: reads only what erp_app already reads. Not a control (CAP-P04).';

-- Every new function, closed to PUBLIC (0011), then given to the runtime.
revoke execute on all functions in schema erp from public;
grant execute on function erp.viewer(uuid, uuid) to erp_app;
