-- 0024 · Ordering setup — which facility supplies branches with an item, when each one stops
-- taking today's orders, and how much of an item a branch should hold after a delivery
--
-- Requirements: INV-014 · INV-P05 · INV-P06 · INV-P07 · MFG-001 · IAM-006 · CAP-P02 · CAP-P04 · PRG-014
-- ADR-0012 · ADR-0027 · ADR-0029 · ADR-0031 · ADR-0033 (proposed) · invariants I-7, I-8
--
-- Phase 4, module 9. The warehouse's OrderingSetup screen kept four sections. Two are here:
-- the order cut-off times (public.order_cutoffs, one per category, overwritten in place) and
-- the branch par levels (public.branch_par_levels, one number per branch and item, no unit,
-- cascaded away with its item). Neither kept why, or any change but the last. The other two are not:
-- module 8 already carries the approval limits (0023), and the supplier-invoice tolerance is
-- read only by supplier-invoice matching, which is payment-adjacent and stays with frozen
-- module 21 (CLAUDE.md §6). Written fresh here (docs/estate/process-mapping-ordering-setup.md).
--
-- The warehouse chose everything by items.category, 'warehouse' or 'factory': which site sent
-- the item, which cut-off dated its order, and which manager set its par. The ERP splits
-- category (docs/estate/process-mapping-items-and-units.md); "which facility replenishes
-- branches with it" is this module's.
--
-- The owner's decisions of 2026-10-08 (ADR-0033):
--   O1  ONE SUPPLYING FACILITY PER ITEM, a warehouse or a factory, organisation-wide, as
--       category was. A decision, with who, when and why.
--   O2  ONE CUT-OFF PER SUPPLYING FACILITY, a time of day read in that facility's own time
--       zone. To have no cut-off, it is cleared; no time of day means none.
--   O3  AN ORDER AT OR AFTER THE CUT-OFF IS FOR THE NEXT DAY, never refused. Its day is fixed
--       when it is first placed and kept if the waiting order is changed. 00:00 makes every
--       order next-day. Module 10 asks erp.order_day() and copies its answer (I-7).
--   O4  A PAR IS AN ORDER-UP-TO LEVEL per branch per item, entered in a pack and kept in the
--       item's base unit, as 0022's minimum is. No suggestion is worked out or stored here: module 10
--       suggests the par less the on-hand figure a worker types, rounded up to whole packs.
--       Module 7's minimum is a different thing, and unchanged.
--   O5  AS THE WAREHOUSE: the administrator sets sources and cut-offs; a par is set by the
--       administrator, or by the manager of the facility that supplies the item, asked at that
--       facility, for any branch; a branch's staff read their own branch's pars and its
--       suppliers' cut-offs.
--
-- A PAR IS STORED AT A BRANCH, the first per-item setting that is. It is not a stock record:
-- it carries no business day and no balance, so Q-06 (when a branch's business day opens) is
-- untouched, and no branch holds stock because of it (ADR-0029 §8).
--
-- Each setting is a decision, as every master here is: an append-only log, and the setting in
-- force as a projection stamped with the latest decision about it (I-8). Clearing one is a
-- decision too. Both capabilities ship HIDDEN, as every module's do.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- Which facility supplies branches with an item (O1) — a log and its projection
-- ---------------------------------------------------------------------------

create table erp.replenishment_source_decision (
  -- UUIDv7, minted by the console (I-1, ADR-0005): the idempotency key.
  decision_id  uuid        primary key,
  seq          bigint      generated always as identity constraint replenishment_source_decision_seq_key unique,
  kind         text        not null
    constraint replenishment_source_decision_kind_is_known check (kind in ('source_set', 'source_cleared')),
  item_id      uuid        not null constraint replenishment_source_decision_item_exists
                             references erp.item (item_id) on delete no action,
  -- A warehouse or a factory of the item's brand; empty when cleared.
  facility_id  uuid        constraint replenishment_source_decision_facility_exists
                             references erp.facility (facility_id) on delete no action,
  reason       text        not null constraint replenishment_source_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id     uuid        not null constraint replenishment_source_decision_actor_is_a_person
                             references erp.person (person_id) on delete no action,
  decided_at   timestamptz not null,
  recorded_at  timestamptz not null default now(),
  constraint replenishment_source_decision_shape check (
    case kind when 'source_set' then facility_id is not null else facility_id is null end),
  -- The target for the projection's stamp: a source names a decision about ITS item.
  constraint replenishment_source_decision_about unique (decision_id, item_id)
);

comment on table erp.replenishment_source_decision is
  'Append-only record of every decision about which warehouse or factory replenishes branches with an item (INV-P05, ADR-0033 O1): who, when, why.';

create index ix_replenishment_source_decision_item on erp.replenishment_source_decision (item_id, seq);

create table erp.replenishment_source (
  item_id           uuid        primary key constraint replenishment_source_item_exists
                                  references erp.item (item_id) on delete no action,
  -- Empty once cleared; the row stays, so its stamp still names the decision that cleared it.
  facility_id       uuid        constraint replenishment_source_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  as_of_decision_id uuid        not null constraint replenishment_source_as_of_decision_id_fkey
                                  references erp.replenishment_source_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint replenishment_source_stamp_is_its_decision foreign key (as_of_decision_id, item_id)
    references erp.replenishment_source_decision (decision_id, item_id)
);

comment on table erp.replenishment_source is
  'The facility that replenishes branches with each item: the latest erp.replenishment_source_decision about it (I-8, db-check replenishment-sources-match-their-decisions). No row, or an empty one, means no facility does.';

-- A supplying facility's par screen lists the items it supplies.
create index ix_replenishment_source_facility on erp.replenishment_source (facility_id);

-- ---------------------------------------------------------------------------
-- A cut-off per supplying facility (O2, O3) — a log and its projection
-- ---------------------------------------------------------------------------

create table erp.order_cutoff_decision (
  decision_id  uuid        primary key,
  seq          bigint      generated always as identity constraint order_cutoff_decision_seq_key unique,
  kind         text        not null
    constraint order_cutoff_decision_kind_is_known check (kind in ('cutoff_set', 'cutoff_cleared')),
  facility_id  uuid        not null constraint order_cutoff_decision_facility_exists
                             references erp.facility (facility_id) on delete no action,
  -- A time of day at the facility, to the minute. An order placed at or after it is for the
  -- next day; 00:00 makes every order next-day, as it did in the warehouse. To have none,
  -- clear it. Empty when cleared.
  cutoff       time(0)
    constraint order_cutoff_is_valid check (extract(second from cutoff) = 0),
  reason       text        not null constraint order_cutoff_reason_is_stated check (length(btrim(reason)) > 0),
  actor_id     uuid        not null constraint order_cutoff_decision_actor_is_a_person
                             references erp.person (person_id) on delete no action,
  decided_at   timestamptz not null,
  recorded_at  timestamptz not null default now(),
  constraint order_cutoff_decision_shape check (
    case kind when 'cutoff_set' then cutoff is not null else cutoff is null end),
  -- The target for the projection's stamp, and for the day module 10 copies onto an order.
  constraint order_cutoff_decision_at_facility unique (decision_id, facility_id)
);

comment on table erp.order_cutoff_decision is
  'Append-only record of every order cut-off set or cleared at a supplying facility (INV-P06, ADR-0033 O2): who, when, why. An order at or after the cut-off in force, in the facility''s time zone, is for the next day.';

create index ix_order_cutoff_decision_facility on erp.order_cutoff_decision (facility_id, seq);

create table erp.order_cutoff (
  facility_id       uuid        primary key constraint order_cutoff_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  -- Empty once cleared; the row stays, so its stamp still names the decision that cleared it.
  cutoff            time(0),
  as_of_decision_id uuid        not null constraint order_cutoff_as_of_decision_id_fkey
                                  references erp.order_cutoff_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint order_cutoff_stamp_is_its_decision foreign key (as_of_decision_id, facility_id)
    references erp.order_cutoff_decision (decision_id, facility_id)
);

comment on table erp.order_cutoff is
  'The order cut-off in force per supplying facility: the latest erp.order_cutoff_decision about it (I-8, db-check order-cutoffs-match-their-decisions). No row, or an empty one, means every order is for the day it is placed.';

-- ---------------------------------------------------------------------------
-- A par level per branch per item (O4) — a log and its projection
-- ---------------------------------------------------------------------------

create table erp.par_level_decision (
  decision_id   uuid        primary key,
  seq           bigint      generated always as identity constraint par_level_decision_seq_key unique,
  kind          text        not null
    constraint par_level_decision_kind_is_known check (kind in ('par_set', 'par_cleared')),
  -- The branch the par is for.
  facility_id   uuid        not null constraint par_level_decision_facility_exists
                              references erp.facility (facility_id) on delete no action,
  item_id       uuid        not null constraint par_level_decision_item_exists
                              references erp.item (item_id) on delete no action,
  -- As entered, for a par set: the conversion it was entered in, copied whole under a
  -- composite key to it, as 0012's seam lays out (I-7), and the quantity in that pack.
  -- Empty when cleared.
  item_unit_id  uuid,
  unit_key      text,
  factor        numeric,
  quantity      numeric,
  -- In the item's base unit: quantity × factor, exact to six places. Empty when cleared.
  -- More than nothing: the warehouse stored 0 as a row apart from "no par", which showed
  -- "Par 0" and an optional on-hand field on that branch's New Order and suggested nothing.
  -- Requiring the on-hand figure was items.stock_level_required, module 10's now. To have
  -- none, clear it.
  par           numeric
    constraint par_level_is_valid check (par > 0 and par < 1e12 and par = round(par, 6)),
  reason        text        not null constraint par_level_reason_is_stated check (length(btrim(reason)) > 0),
  actor_id      uuid        not null constraint par_level_decision_actor_is_a_person
                              references erp.person (person_id) on delete no action,
  decided_at    timestamptz not null,
  recorded_at   timestamptz not null default now(),
  constraint par_level_decision_states_its_pack check (
    case kind
      when 'par_set' then item_unit_id is not null and unit_key is not null and factor is not null
                          and quantity is not null and par is not null and par = quantity * factor
      else item_unit_id is null and unit_key is null and factor is null and quantity is null and par is null
    end),
  constraint par_level_decision_pack_is_the_items foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor),
  -- The target for the projection's stamp: a par names a decision about ITS branch and item.
  constraint par_level_decision_about unique (decision_id, facility_id, item_id)
);

comment on table erp.par_level_decision is
  'Append-only record of every par level set or cleared for an item at a branch (INV-P07, ADR-0033 O4): who, when, why, in the pack it was entered in. Not a stock record: it carries no business day.';

create index ix_par_level_decision_facility_item on erp.par_level_decision (facility_id, item_id, seq);

create table erp.par_level (
  facility_id       uuid        not null constraint par_level_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  item_id           uuid        not null constraint par_level_item_exists
                                  references erp.item (item_id) on delete no action,
  -- In the item's base unit; empty once cleared. The row stays, so its stamp still names
  -- the decision that cleared it.
  par               numeric
    constraint par_level_is_more_than_nothing check (par > 0),
  as_of_decision_id uuid        not null constraint par_level_as_of_decision_id_fkey
                                  references erp.par_level_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint par_level_pkey primary key (facility_id, item_id),
  constraint par_level_stamp_is_its_decision foreign key (as_of_decision_id, facility_id, item_id)
    references erp.par_level_decision (decision_id, facility_id, item_id)
);

comment on table erp.par_level is
  'The par level in force per branch and item, in the item''s base unit: the latest erp.par_level_decision about it (I-8, db-check par-levels-match-their-decisions).';

-- ---------------------------------------------------------------------------
-- The guards — binding the owner too
-- ---------------------------------------------------------------------------

-- In the words db-check's runtime probe reads, as 0020's.
create or replace function erp.ordering_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    '% is append-only (INV-007): % denied on %',
    tg_table_name, tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Record a further decision. Who set a source, a cut-off or a par, and why, is not unmade by deleting the record of it.';
end;
$$;

create trigger replenishment_source_decision_append_only
  before update or delete or truncate on erp.replenishment_source_decision
  for each statement
  execute function erp.ordering_log_is_append_only();
create trigger order_cutoff_decision_append_only
  before update or delete or truncate on erp.order_cutoff_decision
  for each statement
  execute function erp.ordering_log_is_append_only();
create trigger par_level_decision_append_only
  before update or delete or truncate on erp.par_level_decision
  for each statement
  execute function erp.ordering_log_is_append_only();

-- The three projections: each row stays the setting of what it is about, and is cleared,
-- never deleted.
create or replace function erp.ordering_setting_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is never truncated: a setting is cleared, by a decision', tg_table_name
      using errcode = 'restrict_violation';
  elsif tg_op = 'DELETE' then
    raise exception '% is never deleted: a setting is cleared, by a decision', tg_table_name
      using errcode = 'restrict_violation', constraint = 'ordering_setting_never_deleted';
  end if;
  if tg_table_name = 'replenishment_source' then
    if new.item_id is distinct from old.item_id then
      raise exception 'a source stays the source of its item'
        using errcode = 'restrict_violation', constraint = 'ordering_setting_fixed';
    end if;
  elsif tg_table_name = 'order_cutoff' then
    if new.facility_id is distinct from old.facility_id then
      raise exception 'a cut-off stays the cut-off of its facility'
        using errcode = 'restrict_violation', constraint = 'ordering_setting_fixed';
    end if;
  elsif (new.facility_id, new.item_id) is distinct from (old.facility_id, old.item_id) then
    raise exception 'a par stays the par of its branch and item'
      using errcode = 'restrict_violation', constraint = 'ordering_setting_fixed';
  end if;
  return new;
end;
$$;

create trigger replenishment_source_is_fixed
  before update or delete on erp.replenishment_source
  for each row
  execute function erp.ordering_setting_is_fixed();
create trigger replenishment_source_never_truncated
  before truncate on erp.replenishment_source
  for each statement
  execute function erp.ordering_setting_is_fixed();
create trigger order_cutoff_is_fixed
  before update or delete on erp.order_cutoff
  for each row
  execute function erp.ordering_setting_is_fixed();
create trigger order_cutoff_never_truncated
  before truncate on erp.order_cutoff
  for each statement
  execute function erp.ordering_setting_is_fixed();
create trigger par_level_is_fixed
  before update or delete on erp.par_level
  for each row
  execute function erp.ordering_setting_is_fixed();
create trigger par_level_never_truncated
  before truncate on erp.par_level
  for each statement
  execute function erp.ordering_setting_is_fixed();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- A retried call carries the decision id it was first sent with: 0012's pattern, one per log.
-- Called straight after the gate, before any rule a committed first attempt would itself now
-- break (the stale check, "unchanged"), so a retry always answers 23505 on the log's key.
create or replace function erp.assert_replenishment_source_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.replenishment_source_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.replenishment_source_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'replenishment_source_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.replenishment_source_history() to confirm.';
  end if;
end;
$$;

create or replace function erp.assert_order_cutoff_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.order_cutoff_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.order_cutoff_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'order_cutoff_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.order_cutoff_history() to confirm.';
  end if;
end;
$$;

create or replace function erp.assert_par_level_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.par_level_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.par_level_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'par_level_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.par_level_history() to confirm.';
  end if;
end;
$$;

-- A facility that supplies branches: named, and a warehouse or a factory. With p_open, also
-- open, under its share lock, so a closure waits (0019's erp.assert_facility_open()).
create or replace function erp.assert_supplying_facility(p_facility_id uuid, p_open boolean)
returns erp.facility
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  if p_facility_id is null or p_facility_id = erp.org_scope() then
    raise exception 'a warehouse or a factory supplies branches: choose one'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_facility_required';
  end if;
  if p_open then
    f := erp.assert_facility_open(p_facility_id);
  else
    select * into f from erp.facility x where x.facility_id = p_facility_id;
    if not found then
      raise exception 'no facility %', p_facility_id using errcode = 'no_data_found', constraint = 'facility_exists';
    end if;
  end if;
  if f.facility_type not in ('warehouse', 'factory') then
    raise exception 'facility % is a %, and supplies no branch', f.code, f.facility_type
      using errcode = 'restrict_violation', constraint = 'ordering_facility_supplies_nothing';
  end if;
  return f;
end;
$$;

-- The branch a par is for, set from p_from (a supplying facility, or NULL for the
-- organisation): named; of the brand of where it is set from; open (its share lock, so a
-- closure waits); a branch; and one the capability admits new work at. A branch is accepted
-- here on purpose: a par is not a stock record, and carries no business day, so Q-06 is not
-- reached (ADR-0033). Warehouses, factories and offices have no par.
--
-- The brand fence comes before anything is said of the facility: checked after, another
-- brand's warehouse answered "is a warehouse" and its closed branch "is closed", naming them
-- (found in review). A facility's operating unit never changes (0019), so it is read
-- unlocked.
--
-- The capability is asked here as well as where the par is set from: a par is FOR the
-- branch, so a branch where ordering.par_levels is withdrawn, read-only or hidden takes no
-- new par, and a pilot can name the branches it covers (found in review).
create or replace function erp.assert_par_branch(p_branch_id uuid, p_from uuid)
returns erp.facility
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  if p_branch_id is null or p_branch_id = erp.org_scope() then
    raise exception 'a par is set for a branch: choose one'
      using errcode = 'invalid_parameter_value', constraint = 'par_level_branch_required';
  end if;
  if p_from is not null and erp.item_facility_brand(p_branch_id) is distinct from erp.item_facility_brand(p_from) then
    raise exception 'no facility %', p_branch_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  f := erp.assert_facility_open(p_branch_id);
  if f.facility_type <> 'branch' then
    raise exception 'facility % is a %: a par is set for a branch', f.code, f.facility_type
      using errcode = 'restrict_violation', constraint = 'par_level_at_a_branch';
  end if;
  perform erp.assert_capability_admits('ordering.par_levels', f.facility_id);
  return f;
end;
$$;

-- Where a par may be set from (O5): the facility that supplies the item, or the organisation
-- (p_facility_id NULL, which the gate admits only to an organisation-wide writer). Read under
-- the source's lock, SHARED; every source decision about the item takes it exclusively, so a
-- par waits for a source change in flight and is judged against what it left. A lock, not a
-- row lock: an item with no source has no row to lock. Returns the source in force, or NULL.
create or replace function erp.assert_par_set_from(p_facility_id uuid, p_item erp.item, p_branch erp.facility)
returns uuid
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_source uuid;
  v_code   text;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('erp.replenishment_source:' || p_item.item_id::text, 0));
  select s.facility_id into v_source from erp.replenishment_source s where s.item_id = p_item.item_id;
  if p_facility_id is not null and v_source is distinct from p_facility_id then
    if v_source is null then
      raise exception '% is supplied by no facility', p_item.code
        using errcode = 'restrict_violation', constraint = 'par_level_item_has_no_source',
              hint = 'Set its source first. A par it already has is cleared organisation-wide.';
    end if;
    select f.code into v_code from erp.facility f where f.facility_id = v_source;
    raise exception '% is supplied by %: its par at % is set there', p_item.code, v_code, p_branch.code
      using errcode = 'restrict_violation', constraint = 'par_level_not_its_source';
  end if;
  return v_source;
end;
$$;

-- Records a par decision and advances the projection, under a lock per branch and item: a
-- first par has no row to lock, and two first pars racing both read "never set" (as 0023's
-- limit). Then the stale check, against what the person read.
create or replace function erp.apply_par_level(
  p_decision_id          uuid,
  p_kind                 text,
  b                      erp.facility,
  p_item                 erp.item,
  p_unit                 erp.item_unit,
  p_quantity             numeric,
  p_par                  numeric,
  p_expected_decision_id uuid,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  m erp.par_level;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a par states why it was set or cleared'
      using errcode = 'check_violation', constraint = 'par_level_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.par_level:' || b.facility_id::text || ':' || p_item.item_id::text, 0));
  select * into m from erp.par_level x where x.facility_id = b.facility_id and x.item_id = p_item.item_id for update;

  if m.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the par of % at % has changed since it was read', p_item.code, b.code
      using errcode = 'restrict_violation', constraint = 'par_level_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if p_kind = 'par_cleared' and m.par is null then
    raise exception '% has no par at %', p_item.code, b.code
      using errcode = 'restrict_violation', constraint = 'par_level_not_set';
  end if;
  if p_kind = 'par_set' and m.par is not distinct from p_par then
    raise exception 'the par of % at % is already %', p_item.code, b.code, trim_scale(p_par)
      using errcode = 'restrict_violation', constraint = 'par_level_unchanged';
  end if;

  insert into erp.par_level_decision (
    decision_id, kind, facility_id, item_id, item_unit_id, unit_key, factor, quantity, par,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, b.facility_id, p_item.item_id,
    p_unit.item_unit_id, p_unit.unit_key, p_unit.factor, p_quantity, p_par,
    btrim(p_reason), p_actor_id, p_decided_at
  );

  insert into erp.par_level (facility_id, item_id, par, as_of_decision_id)
  values (b.facility_id, p_item.item_id, p_par, p_decision_id)
  on conflict (facility_id, item_id) do update
    set par = excluded.par,
        as_of_decision_id = excluded.as_of_decision_id,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- The seam for module 10 — owner-only, called from its own definer route
-- ---------------------------------------------------------------------------

-- The rule (O3), on its own: the date at a facility, in its time zone, at a moment; the next
-- day when there is a cut-off and the time there is at or after it. The warehouse compared in
-- a hard-coded Asia/Riyadh; every facility is in Riyadh today, so the answer is the same.
-- Never a refusal: an order after the cut-off is taken for tomorrow. Stable, not immutable:
-- it reads the time-zone database.
create or replace function erp.order_day_for(p_at timestamptz, p_tz_name text, p_cutoff time)
returns date
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (p_at at time zone p_tz_name)::date
         + case when p_cutoff is not null and (p_at at time zone p_tz_name)::time >= p_cutoff then 1 else 0 end
$$;

-- The day an order placed NOW with a supplying facility is for, the cut-off decision that
-- dated it, and the moment it was placed. cutoff_decision_id is the decision in force — a
-- clearing included — or NULL when the facility has never had a cut-off.
--
-- Module 10 copies all three onto the order when it is first placed (I-7) and never asks
-- again, so a waiting order changed later keeps its day, and a cut-off changed later dates
-- only orders placed afterwards.
--
-- It takes the cut-off's lock SHARED, the lock every cut-off decision at the facility takes
-- exclusively: an order waits for a cut-off change in flight and is dated by what it left,
-- and the change waits for orders in flight (as 0018's erp.transfer_price_at()). "Now" is the
-- clock once the lock is held, as 0020's: not now(), the transaction's start, which an order
-- that waited behind a change would be dated by, and never a moment the caller states. The
-- projection holds only the cut-off in force now, so a stated moment was dated by a cut-off
-- set after it (found in review).
create or replace function erp.order_day(p_facility_id uuid)
returns table (for_date date, cutoff_decision_id uuid, placed_at timestamptz)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
  c erp.order_cutoff;
begin
  f := erp.assert_supplying_facility(p_facility_id, false);
  perform pg_advisory_xact_lock_shared(hashtextextended('erp.order_cutoff:' || f.facility_id::text, 0));
  select * into c from erp.order_cutoff x where x.facility_id = f.facility_id;

  placed_at := clock_timestamp();
  for_date := erp.order_day_for(placed_at, f.tz_name, c.cutoff);
  cutoff_decision_id := c.as_of_decision_id;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- SOURCES (O1, O5). A master, written organisation-wide as items and prices are: the gate is
-- asked at no facility, so only an organisation-wide writer passes. It also asks the reads
-- erp.replenishment_source_history() asks there, so whoever sets a source can confirm their
-- own retry. p_expected_decision_id is the stamp the person read, or NULL when the item has
-- never had a source.

-- New work on the item, so it must be active. The facility must be an open warehouse or
-- factory of the item's brand: a source of another brand would send one brand's goods from
-- another's site (ADR-0012).
create or replace function erp.set_replenishment_source(
  p_decision_id          uuid,
  p_item_id              uuid,
  p_facility_id          uuid,
  p_expected_decision_id uuid,
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
  v_item  erp.item;
  f       erp.facility;
  v_brand uuid;
  s       erp.replenishment_source;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'write', null);
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', null);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', null);
  perform erp.assert_replenishment_source_decision_is_new(p_decision_id);

  v_item := erp.assert_item_active(p_item_id);
  f := erp.assert_supplying_facility(p_facility_id, true);
  v_brand := erp.item_facility_brand(f.facility_id);
  if v_brand is distinct from v_item.brand_id then
    raise exception 'facility % is of another brand than %', f.code, v_item.code
      using errcode = 'restrict_violation', constraint = 'replenishment_source_brand_differs';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a source states why it was set'
      using errcode = 'check_violation', constraint = 'replenishment_source_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.replenishment_source:' || v_item.item_id::text, 0));
  select * into s from erp.replenishment_source x where x.item_id = v_item.item_id for update;
  if s.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the source of % has changed since it was read', v_item.code
      using errcode = 'restrict_violation', constraint = 'replenishment_source_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if s.facility_id is not distinct from f.facility_id then
    raise exception '% is already supplied by %', v_item.code, f.code
      using errcode = 'restrict_violation', constraint = 'replenishment_source_unchanged';
  end if;

  insert into erp.replenishment_source_decision (decision_id, kind, item_id, facility_id, reason, actor_id, decided_at)
  values (p_decision_id, 'source_set', v_item.item_id, f.facility_id, btrim(p_reason), p_actor_id, p_decided_at);
  insert into erp.replenishment_source (item_id, facility_id, as_of_decision_id)
  values (v_item.item_id, f.facility_id, p_decision_id)
  on conflict (item_id) do update
    set facility_id = excluded.facility_id, as_of_decision_id = excluded.as_of_decision_id, updated_at = now();
end;
$$;

-- No facility supplies the item: module 10 cannot order it. Not new work, so a retired
-- item's source can still be cleared. Its pars stay, and can then only be cleared,
-- organisation-wide, until the item has a source again (erp.assert_par_set_from()).
create or replace function erp.clear_replenishment_source(
  p_decision_id          uuid,
  p_item_id              uuid,
  p_expected_decision_id uuid,
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
  v_item erp.item;
  s      erp.replenishment_source;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'write', null);
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', null);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', null);
  perform erp.assert_replenishment_source_decision_is_new(p_decision_id);

  select * into v_item from erp.item i where i.item_id = p_item_id;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a source states why it was cleared'
      using errcode = 'check_violation', constraint = 'replenishment_source_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.replenishment_source:' || v_item.item_id::text, 0));
  select * into s from erp.replenishment_source x where x.item_id = v_item.item_id for update;
  if s.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the source of % has changed since it was read', v_item.code
      using errcode = 'restrict_violation', constraint = 'replenishment_source_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if s.facility_id is null then
    raise exception '% is supplied by no facility', v_item.code
      using errcode = 'restrict_violation', constraint = 'replenishment_source_not_set';
  end if;

  insert into erp.replenishment_source_decision (decision_id, kind, item_id, reason, actor_id, decided_at)
  values (p_decision_id, 'source_cleared', v_item.item_id, btrim(p_reason), p_actor_id, p_decided_at);
  update erp.replenishment_source
     set facility_id = null, as_of_decision_id = p_decision_id, updated_at = now()
   where item_id = v_item.item_id;
end;
$$;

-- CUT-OFFS (O2, O5). Asked at the supplying facility, as 0023's limits are; the migration
-- grants write to the administrator alone, organisation-wide, so a cut-off is the
-- administrator's, as it was in the warehouse. A cut-off crosses the edge as 'HH:MM' text,
-- 00:00 to 23:59, matched here by one pattern and never parsed loosely.
create or replace function erp.set_order_cutoff(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_cutoff               text,
  p_expected_decision_id uuid,
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
  f        erp.facility;
  c        erp.order_cutoff;
  v_cutoff time(0);
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  perform erp.assert_order_cutoff_decision_is_new(p_decision_id);
  f := erp.assert_supplying_facility(p_facility_id, true);
  if p_cutoff is null or p_cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'a cut-off is a time of day, from 00:00 to 23:59: to have none, clear it'
      using errcode = 'check_violation', constraint = 'order_cutoff_is_valid';
  end if;
  v_cutoff := p_cutoff::time(0);
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a cut-off states why it was set'
      using errcode = 'check_violation', constraint = 'order_cutoff_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.order_cutoff:' || f.facility_id::text, 0));
  select * into c from erp.order_cutoff x where x.facility_id = f.facility_id for update;
  if c.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the cut-off at % has changed since it was read', f.code
      using errcode = 'restrict_violation', constraint = 'order_cutoff_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if c.cutoff is not distinct from v_cutoff then
    raise exception 'the cut-off at % is already %', f.code, p_cutoff
      using errcode = 'restrict_violation', constraint = 'order_cutoff_unchanged';
  end if;

  insert into erp.order_cutoff_decision (decision_id, kind, facility_id, cutoff, reason, actor_id, decided_at)
  values (p_decision_id, 'cutoff_set', f.facility_id, v_cutoff, btrim(p_reason), p_actor_id, p_decided_at);
  insert into erp.order_cutoff (facility_id, cutoff, as_of_decision_id)
  values (f.facility_id, v_cutoff, p_decision_id)
  on conflict (facility_id) do update
    set cutoff = excluded.cutoff, as_of_decision_id = excluded.as_of_decision_id, updated_at = now();
end;
$$;

-- No cut-off at the facility: every order to it is for the day it is placed.
create or replace function erp.clear_order_cutoff(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_expected_decision_id uuid,
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
  c erp.order_cutoff;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  perform erp.assert_order_cutoff_decision_is_new(p_decision_id);
  f := erp.assert_supplying_facility(p_facility_id, true);
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a cut-off states why it was cleared'
      using errcode = 'check_violation', constraint = 'order_cutoff_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.order_cutoff:' || f.facility_id::text, 0));
  select * into c from erp.order_cutoff x where x.facility_id = f.facility_id for update;
  if c.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the cut-off at % has changed since it was read', f.code
      using errcode = 'restrict_violation', constraint = 'order_cutoff_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if c.cutoff is null then
    raise exception '% has no cut-off', f.code
      using errcode = 'restrict_violation', constraint = 'order_cutoff_not_set';
  end if;

  insert into erp.order_cutoff_decision (decision_id, kind, facility_id, reason, actor_id, decided_at)
  values (p_decision_id, 'cutoff_cleared', f.facility_id, btrim(p_reason), p_actor_id, p_decided_at);
  update erp.order_cutoff
     set cutoff = null, as_of_decision_id = p_decision_id, updated_at = now()
   where facility_id = f.facility_id;
end;
$$;

-- PARS (O4, O5). p_facility_id is where the person sets the par from: the facility that
-- supplies the item, or NULL for the organisation. The gate is asked there, so a factory
-- manager scoped to the factory sets the factory's items' pars at every branch, and nobody
-- else's (found in the warehouse: its policy never checked the branch, only the category).
-- It also asks the reads erp.par_level_history() asks there, so whoever sets a par can
-- confirm their own retry. p_expected_decision_id is the stamp the person read, or NULL when
-- the item has never had a par at the branch.

-- A par, entered in a pack of the item (I-7): "3 cartons" is kept as entered and as its base
-- quantity. New work on the item, so the item and the pack must be active; another brand's
-- pack, or a branch of another brand than where it is set from, answers as a missing one
-- (ADR-0012).
create or replace function erp.set_par_level(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_branch_id            uuid,
  p_item_unit_id         uuid,
  p_quantity             text,
  p_expected_decision_id uuid,
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
  b      erp.facility;
  u      erp.item_unit;
  v_item erp.item;
  v_qty  numeric;
  v_base numeric;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_par_level_decision_is_new(p_decision_id);
  b := erp.assert_par_branch(p_branch_id, p_facility_id);

  -- The brand fence first: 0012's own words for a conversion that does not exist.
  select x.* into u
    from erp.item_unit x
    join erp.item i on i.item_id = x.item_id
    join erp.operating_unit ou on ou.brand_id = i.brand_id
   where x.item_unit_id = p_item_unit_id and ou.operating_unit_id = b.operating_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  -- Under the item's share lock, which erp.retire_item_unit() takes for update, the pack is
  -- read again, and held, as 0022's minimum reads it.
  v_item := erp.assert_item_active(u.item_id);
  select x.* into u from erp.item_unit x where x.item_unit_id = u.item_unit_id for share;
  if u.status <> 'active' then
    raise exception 'the % pack of % is retired: enter the par in a current one', u.unit_key, v_item.code
      using errcode = 'restrict_violation', constraint = 'par_level_pack_is_retired';
  end if;

  -- Organisation-wide, the source is not checked against where the par is set from; but an
  -- item no facility supplies cannot be ordered, so it is given no par to order up to.
  if erp.assert_par_set_from(p_facility_id, v_item, b) is null then
    raise exception '% is supplied by no facility', v_item.code
      using errcode = 'restrict_violation', constraint = 'par_level_item_has_no_source',
            hint = 'Set its source first.';
  end if;

  if p_quantity is null or p_quantity !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
    raise exception 'a par is a number with up to twelve digits and six decimal places'
      using errcode = 'check_violation', constraint = 'par_level_is_valid';
  end if;
  v_qty := trim_scale(p_quantity::numeric);
  if v_qty = 0 then
    raise exception 'a par is more than nothing'
      using errcode = 'check_violation', constraint = 'par_level_is_valid',
            hint = 'To have no par, clear it.';
  end if;
  v_base := v_qty * u.factor;
  if v_base <> round(v_base, 6) then
    raise exception '% % is % in the base unit, past six decimal places', v_qty, u.unit_key, trim_scale(v_base)
      using errcode = 'check_violation', constraint = 'par_level_inexact',
            hint = 'Enter it in a larger unit, or in the base unit.';
  end if;
  v_base := trim_scale(v_base);
  if v_base >= 1e12 then
    raise exception '% % is more than any branch holds', v_qty, u.unit_key
      using errcode = 'check_violation', constraint = 'par_level_is_valid';
  end if;

  perform erp.apply_par_level(p_decision_id, 'par_set', b, v_item, u, v_qty, v_base,
                              p_expected_decision_id, p_reason, p_actor_id, p_decided_at);
end;
$$;

-- The item no longer has a par at the branch: module 10 suggests nothing for it there. Not
-- new work, so a retired item's par can still be cleared. An item supplied by no facility has
-- its par cleared organisation-wide.
create or replace function erp.clear_par_level(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_branch_id            uuid,
  p_item_id              uuid,
  p_expected_decision_id uuid,
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
  b      erp.facility;
  v_item erp.item;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_par_level_decision_is_new(p_decision_id);
  b := erp.assert_par_branch(p_branch_id, p_facility_id);

  select i.* into v_item
    from erp.item i
    join erp.operating_unit ou on ou.brand_id = i.brand_id
   where i.item_id = p_item_id and ou.operating_unit_id = b.operating_unit_id;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  perform erp.assert_par_set_from(p_facility_id, v_item, b);
  perform erp.apply_par_level(p_decision_id, 'par_cleared', b, v_item, null, null, null,
                              p_expected_decision_id, p_reason, p_actor_id, p_decided_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- Sources and cut-offs are masters, read at a facility as items are: the facility's brand a
-- second fence, and NULL the organisation, which only an organisation-wide reader passes.
-- Every read pages, 1 to 500 rows (the warehouse loaded every list in one request).

-- Every item of the brand, by code, with the facility that supplies it, if any. p_supplied_by
-- narrows to the items one facility supplies: a supplying facility's par screen.
create or replace function erp.replenishment_sources(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_supplied_by uuid    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  item_id uuid, code text, item_kind text, base_unit_key text, name_en text, name_ar text, item_status text,
  facility_id uuid, facility_code text, facility_type text, facility_name_en text, facility_name_ar text,
  as_of_decision_id uuid, decided_at timestamptz
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
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 items'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select i.item_id, i.code::text, i.item_kind, i.base_unit_key, i.name_en, i.name_ar, i.status,
         f.facility_id, f.code, f.facility_type, f.name_en, f.name_ar,
         s.as_of_decision_id, d.decided_at
    from erp.item i
    left join erp.replenishment_source s on s.item_id = i.item_id
    left join erp.replenishment_source_decision d on d.decision_id = s.as_of_decision_id
    left join erp.facility f on f.facility_id = s.facility_id
   where (v_brand is null or i.brand_id = v_brand)
     and (p_supplied_by is null or s.facility_id = p_supplied_by)
     and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
   order by i.code collate "C"
   limit p_limit;
end;
$$;

-- An item's sources, newest first, paged by seq: every decision, set or cleared. The read the
-- edge makes to confirm a retried write, and the stamp an edit form starts from.
create or replace function erp.replenishment_source_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_item_id     uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, facility_id uuid, facility_code text, reason text,
  actor_id uuid, decided_at timestamptz, recorded_at timestamptz, is_current boolean
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
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 decisions'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i where i.item_id = p_item_id and (v_brand is null or i.brand_id = v_brand)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  return query
  select d.decision_id, d.seq, d.kind, d.facility_id, f.code, d.reason, d.actor_id, d.decided_at, d.recorded_at,
         s.as_of_decision_id is not null
    from erp.replenishment_source_decision d
    left join erp.facility f on f.facility_id = d.facility_id
    left join erp.replenishment_source s on s.as_of_decision_id = d.decision_id
   where d.item_id = p_item_id
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- Every warehouse and factory of the brand, by code, with its cut-off as 'HH:MM', or none: at
-- a branch, the cut-offs of the facilities that supply it (O5); at a supplying facility, its
-- own among them.
create or replace function erp.order_cutoffs(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  facility_id uuid, code text, facility_type text, name_en text, name_ar text, status text, tz_name text,
  cutoff text, as_of_decision_id uuid, decided_at timestamptz
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
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 facilities'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select f.facility_id, f.code, f.facility_type, f.name_en, f.name_ar, f.status, f.tz_name,
         left(c.cutoff::text, 5), c.as_of_decision_id, d.decided_at
    from erp.facility f
    join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
    left join erp.order_cutoff c on c.facility_id = f.facility_id
    left join erp.order_cutoff_decision d on d.decision_id = c.as_of_decision_id
   where f.facility_type in ('warehouse', 'factory')
     and (v_brand is null or ou.brand_id = v_brand)
     and (p_after_code is null or f.code collate "C" > p_after_code collate "C")
   order by f.code collate "C"
   limit p_limit;
end;
$$;

-- A supplying facility's cut-offs, newest first, paged by seq. Asked at that facility, as the
-- routes are.
create or replace function erp.order_cutoff_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, cutoff text, reason text,
  actor_id uuid, decided_at timestamptz, recorded_at timestamptz, is_current boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.setup', 'read', p_facility_id);
  perform erp.assert_supplying_facility(p_facility_id, false);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 decisions'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;

  return query
  select d.decision_id, d.seq, d.kind, left(d.cutoff::text, 5), d.reason, d.actor_id, d.decided_at, d.recorded_at,
         c.as_of_decision_id is not null
    from erp.order_cutoff_decision d
    left join erp.order_cutoff c on c.as_of_decision_id = d.decision_id
   where d.facility_id = p_facility_id
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- Pars are read at their branch — its staff, for New Order — or at a facility that supplies
-- it, for the items that facility supplies (O5), or organisation-wide. A branch's staff hold
-- the read at their own branch alone, so they read no other branch's pars (IAM-006); in the
-- warehouse every signed-in person read every branch's. A branch of another brand than where
-- it is read from answers as a missing one (ADR-0012).
create or replace function erp.assert_par_read(p_facility_id uuid, p_branch_id uuid)
returns erp.facility
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  b       erp.facility;
  v_brand uuid;
  v_type  text;
begin
  if p_branch_id is null or p_branch_id = erp.org_scope() then
    raise exception 'a par is set for a branch: choose one'
      using errcode = 'invalid_parameter_value', constraint = 'par_level_branch_required';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);
  select f.* into b
    from erp.facility f
    join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
   where f.facility_id = p_branch_id and (v_brand is null or ou.brand_id = v_brand);
  if not found then
    raise exception 'no facility %', p_branch_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  if b.facility_type <> 'branch' then
    raise exception 'facility % is a %: a par is set for a branch', b.code, b.facility_type
      using errcode = 'restrict_violation', constraint = 'par_level_at_a_branch';
  end if;
  if p_facility_id is not null and p_facility_id <> p_branch_id then
    select f.facility_type into v_type from erp.facility f where f.facility_id = p_facility_id;
    if v_type not in ('warehouse', 'factory') then
      raise exception 'a branch''s pars are read at the branch, or at a facility that supplies it'
        using errcode = 'invalid_parameter_value', constraint = 'par_level_read_scope';
    end if;
  end if;
  -- Read from a supplying facility or the organisation, the gate asked the state there; the
  -- branch's own counts too, in assert_permitted()'s words (found in review).
  if erp.capability_state_for('ordering.par_levels', b.facility_id) = 'hidden' then
    raise exception 'capability % is hidden for this scope (CAP-P02)', 'ordering.par_levels'
      using errcode = 'restrict_violation';
  end if;
  return b;
end;
$$;

-- A branch's pars, by item code, paged: as entered and in the base unit, with the facility
-- that supplies each item now. Read at a supplying facility, only the items it supplies.
create or replace function erp.par_levels(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_branch_id   uuid,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  item_id uuid, code text, item_kind text, base_unit_key text, name_en text, name_ar text, item_status text,
  par numeric, source_facility_id uuid, as_of_decision_id uuid,
  item_unit_id uuid, unit_key text, factor numeric, quantity numeric, decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  b erp.facility;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  b := erp.assert_par_read(p_facility_id, p_branch_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 items'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;

  return query
  select i.item_id, i.code::text, i.item_kind, i.base_unit_key, i.name_en, i.name_ar, i.status,
         m.par, s.facility_id, m.as_of_decision_id,
         d.item_unit_id, d.unit_key, trim_scale(d.factor), trim_scale(d.quantity), d.decided_at
    from erp.par_level m
    join erp.item i on i.item_id = m.item_id
    join erp.par_level_decision d on d.decision_id = m.as_of_decision_id
    left join erp.replenishment_source s on s.item_id = m.item_id
   where m.facility_id = b.facility_id
     and m.par is not null
     and (p_facility_id is null or p_facility_id = b.facility_id or s.facility_id = p_facility_id)
     and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
   order by i.code collate "C"
   limit p_limit;
end;
$$;

-- An item's pars at a branch, newest first, paged by seq: every decision, set or cleared. The
-- read the edge makes to confirm a retried write, and the stamp an edit form starts from. Read
-- at a supplying facility, only while it supplies the item.
create or replace function erp.par_level_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_branch_id   uuid,
  p_item_id     uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, item_unit_id uuid, unit_key text, factor numeric, quantity numeric,
  par numeric, reason text, actor_id uuid, decided_at timestamptz, recorded_at timestamptz, is_current boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  b erp.facility;
begin
  perform erp.assert_permitted(p_actor_id, 'ordering.par_levels', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  b := erp.assert_par_read(p_facility_id, p_branch_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 decisions'
      using errcode = 'invalid_parameter_value', constraint = 'ordering_page_size';
  end if;
  if not exists (
    select 1 from erp.item i
      join erp.operating_unit ou on ou.brand_id = i.brand_id
      left join erp.replenishment_source s on s.item_id = i.item_id
     where i.item_id = p_item_id and ou.operating_unit_id = b.operating_unit_id
       and (p_facility_id is null or p_facility_id = b.facility_id or s.facility_id = p_facility_id)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  return query
  select d.decision_id, d.seq, d.kind, d.item_unit_id, d.unit_key, trim_scale(d.factor), trim_scale(d.quantity),
         trim_scale(d.par), d.reason, d.actor_id, d.decided_at, d.recorded_at,
         m.as_of_decision_id is not null
    from erp.par_level_decision d
    left join erp.par_level m on m.as_of_decision_id = d.decision_id
   where d.facility_id = b.facility_id and d.item_id = p_item_id
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capabilities (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

-- Two, because the warehouse kept cut-offs the administrator's while its managers set pars:
-- with one write action, a factory manager could move the factory's cut-off (ADR-0033).
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('ordering.setup', 'Ordering setup', 'إعدادات الطلبات',
   array['INV-014', 'MFG-001', 'PRG-014'], false, timestamptz '2026-10-08 00:00:00+00'),
  ('ordering.par_levels', 'Par levels', 'المستويات المستهدفة',
   array['INV-014', 'PRG-014'], false, timestamptz '2026-10-08 00:00:00+00');

-- A real database's only role is the administrator (0011). Who else sets or reads these is
-- the seed's business (0035) and, in a real one, the owner's (ADR-0033 O5).
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'ordering.setup', 'read'),
  ('administrator', 'ordering.setup', 'write'),
  ('administrator', 'ordering.par_levels', 'read'),
  ('administrator', 'ordering.par_levels', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the six tables: writes through the six routes, reads through
-- the six gated functions. Not the helpers, the guards, or the seam: module 10 calls
-- erp.order_day() from its own definer route.
grant execute on function
  erp.set_replenishment_source(uuid, uuid, uuid, uuid, text, uuid, timestamptz),
  erp.clear_replenishment_source(uuid, uuid, uuid, text, uuid, timestamptz),
  erp.set_order_cutoff(uuid, uuid, text, uuid, text, uuid, timestamptz),
  erp.clear_order_cutoff(uuid, uuid, uuid, text, uuid, timestamptz),
  erp.set_par_level(uuid, uuid, uuid, uuid, text, uuid, text, uuid, timestamptz),
  erp.clear_par_level(uuid, uuid, uuid, uuid, uuid, text, uuid, timestamptz),
  erp.replenishment_sources(uuid, uuid, uuid, text, integer),
  erp.replenishment_source_history(uuid, uuid, uuid, bigint, integer),
  erp.order_cutoffs(uuid, uuid, text, integer),
  erp.order_cutoff_history(uuid, uuid, bigint, integer),
  erp.par_levels(uuid, uuid, uuid, text, integer),
  erp.par_level_history(uuid, uuid, uuid, uuid, bigint, integer)
to erp_app;

-- erp_read keeps 0002's default SELECT on the six tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
do $$
declare
  t text;
begin
  foreach t in array array['replenishment_source_decision', 'replenishment_source',
                           'order_cutoff_decision', 'order_cutoff',
                           'par_level_decision', 'par_level'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;
