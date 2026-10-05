-- 0019 · Facilities — branches and the other sites, their places and their areas
--
-- Requirements: PRG-002 · PRG-014 · IAM-003 · IAM-006 · IAM-008 · MFG-012 · CAP-P02 · CAP-P04
-- ADR-0012 · ADR-0022 · ADR-0028 (proposed) · invariants I-6, I-8
--
-- Phase 4, module 4. The warehouse kept a `branches` table: a code, a name, a location
-- line, an internal-only flag, and latitude, longitude and a geofence radius (25–2000 m,
-- default 150). The administrator edited it; a delete silently did nothing, and would
-- have cascaded into par levels, month close and POS sales had it worked. Its geofence
-- decided WHICH branch a branch worker was ordering for: whichever branch's area the
-- phone stood in (private.branch_at()), nearest first where areas overlapped. Written
-- fresh here through the process mapping MFG-012 requires
-- (docs/estate/process-mapping-facilities.md).
--
-- erp.facility (0003) already names every branch, warehouse, factory and office, and is
-- what roles, orders, shifts, devices and capability decisions point at. It was
-- reference data with no write path. This migration makes it a master like 0012's items:
--
--   * EDITABLE THROUGH ROUTES, WITH A DECISION LOG. Created, amended, given an area and
--     closed or reopened by a decision with an actor and a reason, in an append-only log;
--     the facility row is the projection, stamped with the decision it equals (I-8).
--   * NEVER DELETED. Closed, which is reversible, as an item is retired (B-11, I-6).
--   * CODE, TYPE, BRAND AND TIME ZONE FIXED once created. A branch moved to another brand
--     would change, after the fact, whose sales and orders it held; a different time zone
--     would move every business date already recorded (Q-22).
--   * BILINGUAL NAMES (PRG-014), and an optional address in each language.
--   * AN AREA: a point and a radius, both or neither, as the warehouse kept them.
--
-- THE AREA DOES NOT DECIDE WHERE A WORKER IS. The owner decided on 2026-10-05: a branch
-- worker is ASSIGNED to their branch, as every role is here (IAM-006, ADR-0022), and the
-- area is a second check at order time — the phone must be inside the area of the branch
-- the worker is ordering for. erp.assert_at_facility() is that check, for module 10's
-- routes. It takes a position and answers with a distance; it stores nothing. No worker's
-- location is kept by this migration (SEC-001; docs/compliance/pdpl-assessment.md). So
-- overlapping areas are harmless here, and there is no nearest-branch lookup: nobody is
-- placed by where they stand.
--
-- The module ships HIDDEN, like 0012, 0016 and 0018: registered here, no decision
-- recorded, so CAP-P02's default-deny holds in every real database until a later
-- migration promotes it.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The decision log (IAM-008, I-8) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.facility_decision (
  decision_id       uuid        primary key,
  -- A total order, as every log here keeps: decided_at ties in the seed.
  seq               bigint      generated always as identity constraint facility_decision_seq_key unique,
  kind              text        not null
    constraint facility_decision_kind_is_known check (kind in (
      'facility_recorded', 'facility_created', 'facility_amended', 'facility_located', 'facility_status_changed')),
  -- No foreign key to the facility: a creation is written before the row it creates, as
  -- 0012's log is. db-check's facilities-match-their-decisions proves each names a real one.
  facility_id       uuid        not null,
  -- The whole facility this decision left. Never a delta.
  operating_unit_id uuid        not null,
  facility_type     text        not null,
  code              text        not null,
  name_en           text        not null,
  name_ar           text        not null,
  address_en        text,
  address_ar        text,
  tz_name           text        not null,
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  geofence_radius_m integer,
  status            text        not null
    constraint facility_decision_status_is_known check (status in ('open', 'closed')),
  reason            text        not null constraint facility_decision_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded. NULL only for 'facility_recorded': a facility that
  -- existed before this log did — 0003's reference data, or the seed — was recorded by no
  -- person, and inventing one would put a name on a decision nobody made.
  actor_id          uuid        constraint facility_decision_actor_is_a_person
                                  references erp.person (person_id) on delete no action,
  decided_at        timestamptz not null,
  recorded_at       timestamptz not null default now(),
  -- Target for the projection's composite stamp: a stamp names a decision about ITS facility.
  constraint facility_decision_about_facility unique (decision_id, facility_id),
  constraint facility_decision_actor_unless_recorded check ((kind = 'facility_recorded') = (actor_id is null))
);

comment on table erp.facility_decision is
  'Append-only record of every decision about a facility (PRG-002, IAM-008, I-8). Each row carries the whole facility it put in force.';
comment on column erp.facility_decision.actor_id is
  'NULL only for facility_recorded: a facility that existed before this log, recorded by no person.';

create index ix_facility_decision_facility on erp.facility_decision (facility_id, seq);

create or replace function erp.facility_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'facility_decision is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. Where a branch was, and who said so, is not unmade by deleting the record of it.';
end;
$$;

create trigger facility_decision_append_only
  before update or delete or truncate on erp.facility_decision
  for each statement
  execute function erp.facility_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- The facility (0003), made a projection of its decisions
-- ---------------------------------------------------------------------------

alter table erp.facility
  add column address_en        text,
  add column address_ar        text,
  -- A point and a radius, both or neither. Six places is about a tenth of a metre.
  add column latitude          numeric(9,6),
  add column longitude         numeric(9,6),
  add column geofence_radius_m integer,
  add column status            text not null default 'open',
  add column updated_at        timestamptz not null default now(),
  add column as_of_decision_id uuid;

-- Every facility that already exists is recorded once, by nobody, as it stands. The id is
-- derived from the facility's, so a rebuild records the same decision.
insert into erp.facility_decision (
  decision_id, kind, facility_id, operating_unit_id, facility_type, code, name_en, name_ar,
  address_en, address_ar, tz_name, latitude, longitude, geofence_radius_m, status,
  reason, actor_id, decided_at, recorded_at
)
select md5('facility_recorded:' || f.facility_id::text)::uuid, 'facility_recorded', f.facility_id, f.operating_unit_id,
       f.facility_type, f.code, f.name_en, f.name_ar, f.address_en, f.address_ar, f.tz_name, f.latitude, f.longitude,
       f.geofence_radius_m, f.status, 'Recorded when facilities became editable (0019).', null, f.created_at, f.created_at
from erp.facility f;

update erp.facility set as_of_decision_id = md5('facility_recorded:' || facility_id::text)::uuid;

alter table erp.facility
  alter column as_of_decision_id set not null,
  -- I-8. The single-column key is what db-check's projection-stamp-is-a-foreign-key-where-
  -- it-can-be finds; the composite one makes it impossible to stamp this facility with
  -- ANOTHER facility's decision.
  add constraint facility_as_of_decision_id_fkey
    foreign key (as_of_decision_id) references erp.facility_decision (decision_id),
  add constraint facility_stamp_is_this_facilitys_decision
    foreign key (as_of_decision_id, facility_id) references erp.facility_decision (decision_id, facility_id),
  add constraint facility_status_is_known check (status in ('open', 'closed')),
  add constraint facility_code_is_canonical check (code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  add constraint facility_names_are_canonical check (
    name_en = erp.normalise_label(name_en) and name_ar = erp.normalise_label(name_ar)
    and length(name_en) <= 120 and length(name_ar) <= 120),
  add constraint facility_addresses_are_canonical check (
    (address_en is null or (address_en = btrim(address_en) and length(address_en) between 1 and 500))
    and (address_ar is null or (address_ar = btrim(address_ar) and length(address_ar) between 1 and 500))),
  add constraint facility_area_is_whole check (
    (latitude is null) = (longitude is null) and (latitude is null) = (geofence_radius_m is null)),
  add constraint facility_area_is_on_earth check (
    latitude between -90 and 90 and longitude between -180 and 180),
  add constraint facility_radius_is_metres check (geofence_radius_m between 25 and 2000),
  -- The all-zero id is erp.org_scope(): "organisation-wide" to every role and capability
  -- decision. A facility holding it would let a grant recorded at one facility act
  -- organisation-wide, the log saying one thing and the projection another (found in review).
  add constraint facility_is_not_the_organisation check (facility_id <> '00000000-0000-0000-0000-000000000000'::uuid);

comment on table erp.facility is
  'Every branch, warehouse, factory and office (PRG-002). A projection of erp.facility_decision since 0019: code, type, brand and time zone fixed once created; closed, never deleted.';
comment on column erp.facility.geofence_radius_m is
  'With latitude and longitude, the area a branch worker''s phone must be inside to order for this facility (erp.assert_at_facility, ADR-0028). It places nobody: workers are assigned (IAM-006).';

-- ---------------------------------------------------------------------------
-- Guard triggers — they bind every writer, the owner and the seed included
-- ---------------------------------------------------------------------------

create or replace function erp.facility_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'facility % is closed, never deleted (B-11)', old.code
      using errcode = 'restrict_violation', constraint = 'facility_never_deleted',
            hint = 'Close it through erp.change_facility_status().';
  end if;
  if (new.facility_id, new.operating_unit_id, new.facility_type, new.code, new.tz_name)
     is distinct from (old.facility_id, old.operating_unit_id, old.facility_type, old.code, old.tz_name) then
    raise exception 'facility %: its code, type, brand and time zone are fixed once created', old.code
      using errcode = 'restrict_violation', constraint = 'facility_fixed',
            hint = 'Close it and create another.';
  end if;
  return new;
end;
$$;

create trigger facility_is_fixed
  before update or delete on erp.facility
  for each row
  execute function erp.facility_is_fixed();

-- Row triggers do not fire for TRUNCATE.
create or replace function erp.facilities_are_never_truncated()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is never deleted (B-11): TRUNCATE denied', tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Close a facility through erp.change_facility_status().';
end;
$$;

create trigger facility_never_truncated
  before truncate on erp.facility
  for each statement
  execute function erp.facilities_are_never_truncated();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- A retried call carries the decision id it was first sent with: 0012's
-- assert_item_decision_is_new(), for this log.
create or replace function erp.assert_facility_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.facility_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.facility_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'facility_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.facility_history() to confirm.';
  end if;
end;
$$;

-- The great-circle distance in metres between two points, by the haversine formula on a
-- sphere of the earth's mean radius: the warehouse's private.distance_m(). Within a
-- branch's area, a few hundred metres, its error is far below a phone's.
create or replace function erp.distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns double precision
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians((p_lat2 - p_lat1)::double precision) / 2), 2)
    + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
      * power(sin(radians((p_lng2 - p_lng1)::double precision) / 2), 2)));
$$;

-- The decision a route records, from the facility as it will stand. One copy of the
-- column list, so the routes cannot drift from each other.
create or replace function erp.record_facility_decision(
  p_decision_id uuid, p_kind text, f erp.facility, p_reason text, p_actor_id uuid, p_decided_at timestamptz
)
returns void
language sql
volatile
set search_path = pg_catalog, pg_temp
as $$
  insert into erp.facility_decision (
    decision_id, kind, facility_id, operating_unit_id, facility_type, code, name_en, name_ar,
    address_en, address_ar, tz_name, latitude, longitude, geofence_radius_m, status,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, f.facility_id, f.operating_unit_id, f.facility_type, f.code, f.name_en, f.name_ar,
    f.address_en, f.address_ar, f.tz_name, f.latitude, f.longitude, f.geofence_radius_m, f.status,
    p_reason, p_actor_id, p_decided_at
  );
$$;

-- The facility a change is about, locked, checked against the stamp the form was read
-- from, and open. Every amending route starts here.
create or replace function erp.facility_for_change(p_facility_id uuid, p_expected_decision_id uuid, p_must_be_open boolean)
returns erp.facility
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  -- NO KEY UPDATE, not UPDATE: it still waits for, and holds off, the seams' FOR SHARE, so a
  -- closure and an order serialise; but it does not block the key-share lock every foreign
  -- key insert takes, so an order, a shift or a device added at the facility meanwhile is
  -- not held up by an edit to its name (found in review).
  select * into f from erp.facility x where x.facility_id = p_facility_id for no key update;
  if not found then
    raise exception 'no facility %', p_facility_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  if f.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'facility % has changed since it was read', f.code
      using errcode = 'restrict_violation', constraint = 'facility_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if p_must_be_open and f.status = 'closed' then
    raise exception 'facility % is closed: reopen it before changing it', f.code
      using errcode = 'restrict_violation', constraint = 'facility_is_closed';
  end if;
  return f;
end;
$$;

-- ---------------------------------------------------------------------------
-- The seams for later modules — owner-only, called from their own definer routes
-- ---------------------------------------------------------------------------

-- New work at a facility — an order, a receipt, a count — needs it open. Taken under the
-- facility's share lock, which every route below takes for no key update, so a facility closed
-- while the work is in flight is seen, and the closure waits for the work to finish.
create or replace function erp.assert_facility_open(p_facility_id uuid)
returns erp.facility
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  select * into f from erp.facility x where x.facility_id = p_facility_id for share;
  if not found then
    raise exception 'no facility %', p_facility_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  if f.status <> 'open' then
    raise exception 'facility % is closed and admits no new work', f.code
      using errcode = 'restrict_violation', constraint = 'facility_admits_no_new_work';
  end if;
  return f;
end;
$$;

-- The check a branch order (module 10) makes after erp.assert_permitted() has found the
-- worker assigned to the branch: is the phone inside the branch's area? Answers with the
-- distance from the branch's point, in metres, for the order to keep if it chooses.
-- Stores nothing: the position it is handed is gone when the call returns.
--
-- Refused, as the warehouse refused, when the position is missing or vaguer than 100 m
-- (LOCATION_REQUIRED, LOCATION_INACCURATE there), when the facility has no area
-- (BRANCH_NO_LOCATION: its workers cannot order until it is given one), and when the
-- phone is outside it (OUTSIDE_BRANCH). Also when the facility is closed.
create or replace function erp.assert_at_facility(
  p_facility_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_m numeric
)
returns double precision
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
  v_distance double precision;
begin
  f := erp.assert_facility_open(p_facility_id);
  if f.latitude is null then
    raise exception 'facility % has no area: give it one before its workers can order', f.code
      using errcode = 'restrict_violation', constraint = 'facility_has_no_area';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'a position is needed to act for facility %', f.code
      using errcode = 'check_violation', constraint = 'position_required',
            hint = 'Allow the device to share its location, then try again.';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 100 then
    raise exception 'the position is not precise enough (within 100 m needed)'
      using errcode = 'check_violation', constraint = 'position_too_vague',
            hint = 'Step outside or wait for a better fix, then try again.';
  end if;
  v_distance := erp.distance_m(f.latitude, f.longitude, p_latitude, p_longitude);
  if v_distance > f.geofence_radius_m then
    -- Rounded up: 150.4 m rounded down read "150 m … outside its 150 m area" (found in review).
    raise exception 'this device is % m from facility %, outside its % m area', ceil(v_distance::numeric), f.code, f.geofence_radius_m
      using errcode = 'restrict_violation', constraint = 'position_outside_facility';
  end if;
  return v_distance;
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- A new facility, open, with no area. Its id is minted by the console (I-1).
create or replace function erp.create_facility(
  p_decision_id       uuid,
  p_facility_id       uuid,
  p_operating_unit_id uuid,
  p_facility_type     text,
  p_code              text,
  p_name_en           text,
  p_name_ar           text,
  p_address_en        text,
  p_address_ar        text,
  p_reason            text,
  p_actor_id          uuid,
  p_decided_at        timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'write', null);
  perform erp.assert_facility_decision_is_new(p_decision_id);

  if not exists (select 1 from erp.operating_unit o where o.operating_unit_id = p_operating_unit_id) then
    raise exception 'no operating unit %', p_operating_unit_id
      using errcode = 'no_data_found', constraint = 'operating_unit_exists';
  end if;
  if p_facility_id is null or p_facility_id = erp.org_scope() then
    raise exception 'that id means the whole organisation, and is never a facility''s'
      using errcode = 'check_violation', constraint = 'facility_is_not_the_organisation';
  end if;
  if p_facility_type is null or p_facility_type not in ('branch', 'warehouse', 'factory', 'office') then
    raise exception 'a facility is a branch, a warehouse, a factory or an office'
      using errcode = 'check_violation', constraint = 'facility_type_is_known';
  end if;

  f.facility_id := p_facility_id;
  f.operating_unit_id := p_operating_unit_id;
  f.facility_type := p_facility_type;
  f.code := erp.normalise_item_code(p_code);
  f.name_en := erp.normalise_label(p_name_en);
  f.name_ar := erp.normalise_label(p_name_ar);
  f.address_en := nullif(btrim(p_address_en), '');
  f.address_ar := nullif(btrim(p_address_ar), '');
  f.tz_name := 'Asia/Riyadh';
  f.status := 'open';
  f.as_of_decision_id := p_decision_id;

  if f.code is null or f.code !~ '^[A-Z0-9][A-Z0-9-]{0,31}$' then
    raise exception 'a facility code is 1 to 32 letters, digits and hyphens, starting with a letter or digit'
      using errcode = 'check_violation', constraint = 'facility_code_is_canonical';
  end if;
  if exists (select 1 from erp.facility x where x.code = f.code) then
    raise exception 'facility code % is already used', f.code
      using errcode = 'unique_violation', constraint = 'facility_code_key';
  end if;
  if f.name_en is null or f.name_ar is null then
    raise exception 'a facility is named in both English and Arabic (PRG-014)'
      using errcode = 'check_violation', constraint = 'facility_names_are_bilingual';
  end if;

  perform erp.record_facility_decision(p_decision_id, 'facility_created', f, p_reason, p_actor_id, p_decided_at);
  insert into erp.facility (
    facility_id, operating_unit_id, facility_type, code, name_en, name_ar, address_en, address_ar, tz_name, status,
    as_of_decision_id
  ) values (
    f.facility_id, f.operating_unit_id, f.facility_type, f.code, f.name_en, f.name_ar, f.address_en, f.address_ar,
    f.tz_name, f.status, f.as_of_decision_id
  );
end;
$$;

-- Its names and addresses, stated whole. A form saved without a change records nothing.
create or replace function erp.amend_facility(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_expected_decision_id uuid,
  p_name_en              text,
  p_name_ar              text,
  p_address_en           text,
  p_address_ar           text,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
  v_name_en text := erp.normalise_label(p_name_en);
  v_name_ar text := erp.normalise_label(p_name_ar);
  v_addr_en text := nullif(btrim(p_address_en), '');
  v_addr_ar text := nullif(btrim(p_address_ar), '');
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'write', null);
  perform erp.assert_facility_decision_is_new(p_decision_id);
  f := erp.facility_for_change(p_facility_id, p_expected_decision_id, true);
  if v_name_en is null or v_name_ar is null then
    raise exception 'a facility is named in both English and Arabic (PRG-014)'
      using errcode = 'check_violation', constraint = 'facility_names_are_bilingual';
  end if;
  if (v_name_en, v_name_ar, v_addr_en, v_addr_ar) is not distinct from (f.name_en, f.name_ar, f.address_en, f.address_ar) then
    return;
  end if;

  f.name_en := v_name_en;
  f.name_ar := v_name_ar;
  f.address_en := v_addr_en;
  f.address_ar := v_addr_ar;
  perform erp.record_facility_decision(p_decision_id, 'facility_amended', f, p_reason, p_actor_id, p_decided_at);
  update erp.facility
     set name_en = f.name_en, name_ar = f.name_ar, address_en = f.address_en, address_ar = f.address_ar,
         as_of_decision_id = p_decision_id, updated_at = now()
   where facility_id = f.facility_id;
end;
$$;

-- Its area: a point and a radius, or none (all three null), which leaves its workers
-- unable to order until it is given one again. A radius left out with a point is the
-- warehouse's default, 150 m.
create or replace function erp.set_facility_area(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_expected_decision_id uuid,
  p_latitude             numeric,
  p_longitude            numeric,
  p_radius_m             integer,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
  v_lat numeric;
  v_lng numeric;
  v_radius integer := case when p_latitude is null then null else coalesce(p_radius_m, 150) end;
begin
  -- Nothing is converted before the gate: a value past numeric(9,6)'s range raised
  -- PostgreSQL's own overflow, to someone with no permission at all (found in review).
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'write', null);
  perform erp.assert_facility_decision_is_new(p_decision_id);
  f := erp.facility_for_change(p_facility_id, p_expected_decision_id, true);
  if (p_latitude is null) <> (p_longitude is null) or (p_latitude is null and p_radius_m is not null) then
    raise exception 'an area is a latitude, a longitude and a radius together, or none'
      using errcode = 'check_violation', constraint = 'facility_area_is_whole';
  end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'a latitude is from -90 to 90 and a longitude from -180 to 180'
      using errcode = 'check_violation', constraint = 'facility_area_is_on_earth';
  end if;
  v_lat := round(p_latitude, 6);
  v_lng := round(p_longitude, 6);
  if v_radius is not null and v_radius not between 25 and 2000 then
    raise exception 'an area''s radius is from 25 to 2000 metres'
      using errcode = 'check_violation', constraint = 'facility_radius_is_metres';
  end if;
  if (v_lat, v_lng, v_radius) is not distinct from (f.latitude, f.longitude, f.geofence_radius_m) then
    return;
  end if;

  f.latitude := v_lat;
  f.longitude := v_lng;
  f.geofence_radius_m := v_radius;
  perform erp.record_facility_decision(p_decision_id, 'facility_located', f, p_reason, p_actor_id, p_decided_at);
  update erp.facility
     set latitude = f.latitude, longitude = f.longitude, geofence_radius_m = f.geofence_radius_m,
         as_of_decision_id = p_decision_id, updated_at = now()
   where facility_id = f.facility_id;
end;
$$;

-- Closed, or open again. A closed facility keeps everything it held, and admits no new
-- work (erp.assert_facility_open()).
create or replace function erp.change_facility_status(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_expected_decision_id uuid,
  p_status               text,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'write', null);
  perform erp.assert_facility_decision_is_new(p_decision_id);
  f := erp.facility_for_change(p_facility_id, p_expected_decision_id, false);
  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'a facility is open or closed'
      using errcode = 'check_violation', constraint = 'facility_status_is_known';
  end if;
  if p_status = f.status then
    raise exception 'facility % is already %', f.code, p_status
      using errcode = 'restrict_violation', constraint = 'facility_status_unchanged';
  end if;

  f.status := p_status;
  perform erp.record_facility_decision(p_decision_id, 'facility_status_changed', f, p_reason, p_actor_id, p_decided_at);
  update erp.facility
     set status = f.status, as_of_decision_id = p_decision_id, updated_at = now()
   where facility_id = f.facility_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads — the runtime's only view of facilities' places (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- Read at a facility, a person sees that facility's brand's facilities only (ADR-0012),
-- and another brand's answers exactly as a missing one; organisation-wide, all of them.
-- (erp.viewer() still lists to everyone the facilities they may work at, by code and
-- name, as before: this capability is for their places and their areas.)

create or replace function erp.list_facilities(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_status      text    default 'open',
  p_search      text    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  facility_id uuid, operating_unit_id uuid, brand_id uuid, facility_type text, code text, name_en text, name_ar text,
  address_en text, address_ar text, tz_name text, latitude numeric, longitude numeric, geofence_radius_m integer,
  status text, as_of_decision_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_brand  uuid;
  v_search text := erp.normalise_label(p_search);
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 facilities'
      using errcode = 'invalid_parameter_value', constraint = 'facility_page_size';
  end if;
  if p_status is not null and p_status not in ('open', 'closed') then
    raise exception 'a facility is open or closed'
      using errcode = 'check_violation', constraint = 'facility_status_is_known';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select f.facility_id, f.operating_unit_id, ou.brand_id, f.facility_type, f.code, f.name_en, f.name_ar,
         f.address_en, f.address_ar, f.tz_name, f.latitude, f.longitude, f.geofence_radius_m, f.status,
         f.as_of_decision_id
  from erp.facility f
  join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
  where (v_brand is null or ou.brand_id = v_brand)
    and (p_status is null or f.status = p_status)
    and (p_after_code is null or f.code collate "C" > p_after_code collate "C")
    and (v_search is null
         or starts_with(f.code, upper(v_search))
         or strpos(lower(f.name_en), lower(v_search)) > 0
         or strpos(f.name_ar, v_search) > 0)
  order by f.code collate "C"
  limit p_limit;
end;
$$;

create or replace function erp.get_facility(p_actor_id uuid, p_facility_id uuid, p_target_id uuid)
returns table (
  facility_id uuid, operating_unit_id uuid, brand_id uuid, facility_type text, code text, name_en text, name_ar text,
  address_en text, address_ar text, tz_name text, latitude numeric, longitude numeric, geofence_radius_m integer,
  status text, as_of_decision_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  return query
  select f.facility_id, f.operating_unit_id, ou.brand_id, f.facility_type, f.code, f.name_en, f.name_ar,
         f.address_en, f.address_ar, f.tz_name, f.latitude, f.longitude, f.geofence_radius_m, f.status,
         f.as_of_decision_id
  from erp.facility f
  join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
  where f.facility_id = p_target_id and (v_brand is null or ou.brand_id = v_brand);
  if not found then
    raise exception 'no facility %', p_target_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
end;
$$;

-- Every decision about a facility, in order (IAM-008).
create or replace function erp.facility_history(p_actor_id uuid, p_facility_id uuid, p_target_id uuid)
returns setof erp.facility_decision
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'org.facilities', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.facility f join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
                  where f.facility_id = p_target_id and (v_brand is null or ou.brand_id = v_brand)) then
    raise exception 'no facility %', p_target_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  return query
  select d.* from erp.facility_decision d where d.facility_id = p_target_id order by d.seq;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('org.facilities', 'Branches and facilities', 'الفروع والمنشآت',
   array['PRG-002', 'IAM-006', 'PRG-014', 'MFG-012'], false, timestamptz '2026-10-05 00:00:00+00');

-- In the warehouse, branches were the administrator's to edit. The readers are the seed's
-- business (0035), as for every module.
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'org.facilities', 'read'),
  ('administrator', 'org.facilities', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app keeps 0003's SELECT on erp.facility, which erp.viewer() and every module's
-- facility lookups were written against; its new columns are a branch's place and area,
-- not anyone's personal data. It gets nothing on the log, and writes only through the
-- routes. No EXECUTE on the seams or the helpers.
grant execute on function
  erp.create_facility(uuid, uuid, uuid, text, text, text, text, text, text, text, uuid, timestamptz),
  erp.amend_facility(uuid, uuid, uuid, text, text, text, text, text, uuid, timestamptz),
  erp.set_facility_area(uuid, uuid, uuid, numeric, numeric, integer, text, uuid, timestamptz),
  erp.change_facility_status(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.list_facilities(uuid, uuid, text, text, text, integer),
  erp.get_facility(uuid, uuid, uuid),
  erp.facility_history(uuid, uuid, uuid)
to erp_app;

-- ---------------------------------------------------------------------------
-- Row-level security — the log is new; erp.facility kept 0008's
-- ---------------------------------------------------------------------------

alter table erp.facility_decision enable row level security;
alter table erp.facility_decision force row level security;
create policy erp_read_all on erp.facility_decision for select to erp_read using (true);
