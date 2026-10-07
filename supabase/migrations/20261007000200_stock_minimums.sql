-- 0022 · Stock alerts — a minimum per item at a warehouse or a factory, and the bell when
-- stock falls to it
--
-- Requirements: INV-013 · INV-P03 · SUP-005 · SUP-007 · SUP-P04 · CAP-P02 · CAP-P04 · PRG-014
-- ADR-0029 · ADR-0030 · ADR-0031 (proposed) · invariants I-6, I-7, I-8
--
-- Phase 4, module 7. The warehouse kept a minimum in three columns
-- (warehouse_units.minimum_stock_purchase_units, factory_stock.minimum_stock_level,
-- raw_materials.minimum_stock_level), set by the administrator and overwritten in place
-- with no record of who changed it or why. Its low-stock lists read "at or below the
-- minimum", and its bell told the role's managers once, on crossing, skipping anyone who
-- still had that alert unread. Written fresh here (docs/estate/process-mapping-stock-alerts.md).
--
-- The owner's decisions of 2026-10-07 (ADR-0031):
--   A1  a MINIMUM only, per item per warehouse or factory. INV-013's maximum, safety stock
--       and reorder values stay for F3.
--   A2  ONCE PER DROP: the bell rings when a movement takes a balance from above its minimum
--       to at or below it. It rings again only after the balance has gone back above and
--       falls again. Every item at or below its minimum is also always listed.
--   A3  the person whose movement took stock low is told too. A below-zero override still
--       tells everyone but its actor (0021).
--
-- THE MINIMUM IS A DECISION, as every master here is: who set it, when, why, in the pack it
-- was entered in (I-7), in an append-only log; the current minimum is a projection stamped
-- with the latest decision about it (I-8). Clearing one is a decision too.
--
-- "ONCE PER DROP" NEEDS NO STATE. A crossing is a fact about one posting: the balance before
-- it was above the minimum then in force and the balance after it is not. So nothing records
-- that an alert is "armed", and nothing can leave one stuck. Setting or raising a minimum
-- above the balance never rings: no stock moved, and the item is listed as low at once.
--
-- The capability ships HIDDEN, as every module's does.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The decision log (INV-013, IAM-008) — append-only
-- ---------------------------------------------------------------------------

create table erp.stock_minimum_decision (
  -- UUIDv7, minted by the console (I-1, ADR-0005): the idempotency key.
  decision_id   uuid        primary key,
  seq           bigint      generated always as identity constraint stock_minimum_decision_seq_key unique,
  kind          text        not null
    constraint stock_minimum_decision_kind_is_known check (kind in ('minimum_set', 'minimum_cleared')),
  facility_id   uuid        not null constraint stock_minimum_decision_facility_exists
                              references erp.facility (facility_id) on delete no action,
  item_id       uuid        not null constraint stock_minimum_decision_item_exists
                              references erp.item (item_id) on delete no action,
  -- As entered, for a minimum set: the conversion it was entered in, copied whole under a
  -- composite key to it, as 0012's seam lays out (I-7), and the quantity in that pack.
  -- Empty when cleared.
  item_unit_id  uuid,
  unit_key      text,
  factor        numeric,
  quantity      numeric,
  -- In the item's base unit: quantity × factor, exact to six places. Empty when cleared.
  -- More than nothing: in the warehouse a minimum of 0 meant none, and its form offered 0
  -- by default, so a 0 here would ring for every empty shelf. To have none, clear it.
  minimum       numeric
    constraint stock_minimum_is_valid check (minimum > 0 and minimum < 1e12 and minimum = round(minimum, 6)),
  reason        text        not null constraint stock_minimum_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id      uuid        not null constraint stock_minimum_decision_actor_is_a_person
                              references erp.person (person_id) on delete no action,
  decided_at    timestamptz not null,
  recorded_at   timestamptz not null default now(),
  constraint stock_minimum_decision_states_its_pack check (
    case kind
      when 'minimum_set' then item_unit_id is not null and unit_key is not null and factor is not null
                              and quantity is not null and minimum is not null and minimum = quantity * factor
      else item_unit_id is null and unit_key is null and factor is null and quantity is null and minimum is null
    end),
  constraint stock_minimum_decision_pack_is_the_items foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor),
  -- The target for the projection's stamp: a minimum names a decision about ITS facility and item.
  constraint stock_minimum_decision_about unique (decision_id, facility_id, item_id)
);

comment on table erp.stock_minimum_decision is
  'Append-only record of every minimum set or cleared for an item at a facility (INV-013, ADR-0031): who, when, why, in the pack it was entered in.';

create index ix_stock_minimum_decision_facility_item on erp.stock_minimum_decision (facility_id, item_id, seq);

-- In the words db-check's runtime probe reads, as 0020's.
create or replace function erp.stock_minimum_log_is_append_only()
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
          hint = 'Set the minimum again, or clear it. Who set it, and why, is not unmade by deleting the record of it.';
end;
$$;

create trigger stock_minimum_decision_append_only
  before update or delete or truncate on erp.stock_minimum_decision
  for each statement
  execute function erp.stock_minimum_log_is_append_only();

-- ---------------------------------------------------------------------------
-- The minimum (I-8) — a projection of its decisions, per facility and item
-- ---------------------------------------------------------------------------

create table erp.stock_minimum (
  facility_id       uuid        not null constraint stock_minimum_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  item_id           uuid        not null constraint stock_minimum_item_exists
                                  references erp.item (item_id) on delete no action,
  -- In the item's base unit; empty once cleared. The row stays, so its stamp still names
  -- the decision that cleared it.
  minimum           numeric
    constraint stock_minimum_is_more_than_nothing check (minimum > 0),
  as_of_decision_id uuid        not null constraint stock_minimum_as_of_decision_id_fkey
                                  references erp.stock_minimum_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint stock_minimum_pkey primary key (facility_id, item_id),
  constraint stock_minimum_stamp_is_its_decision foreign key (as_of_decision_id, facility_id, item_id)
    references erp.stock_minimum_decision (decision_id, facility_id, item_id)
);

comment on table erp.stock_minimum is
  'The minimum in force per facility and item, in the item''s base unit: the latest erp.stock_minimum_decision about it (I-8, db-check stock-minimums-match-their-decisions).';

create or replace function erp.stock_minimum_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is never truncated: a minimum is cleared, by a decision', tg_table_name
      using errcode = 'restrict_violation';
  elsif tg_op = 'DELETE' then
    raise exception 'a minimum is never deleted: it is cleared, by a decision'
      using errcode = 'restrict_violation', constraint = 'stock_minimum_never_deleted';
  end if;
  if (new.facility_id, new.item_id) is distinct from (old.facility_id, old.item_id) then
    raise exception 'a minimum stays the minimum of its facility and item'
      using errcode = 'restrict_violation', constraint = 'stock_minimum_fixed';
  end if;
  return new;
end;
$$;

create trigger stock_minimum_is_fixed
  before update or delete on erp.stock_minimum
  for each row
  execute function erp.stock_minimum_is_fixed();
create trigger stock_minimum_never_truncated
  before truncate on erp.stock_minimum
  for each statement
  execute function erp.stock_minimum_is_fixed();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- A retried call carries the decision id it was first sent with: 0012's pattern, for this
-- log. Called straight after the gate, before any rule a committed first attempt would
-- itself now break (the stale check, "unchanged"), so a retry always answers 23505 on
-- stock_minimum_decision_pkey.
create or replace function erp.assert_stock_minimum_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.stock_minimum_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.stock_minimum_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'stock_minimum_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.stock_minimum_history() to confirm.';
  end if;
end;
$$;

-- The facility a minimum is set at: named, open (its share lock, so a closure waits), and
-- one that holds stock — 0020's own rules, in 0020's own words.
create or replace function erp.assert_stock_minimum_facility(p_facility_id uuid)
returns erp.facility
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f erp.facility;
begin
  perform erp.assert_stock_facility_named(p_facility_id);
  f := erp.assert_facility_open(p_facility_id);
  if f.facility_type = 'branch' then
    raise exception 'branch % holds no stock record yet: a branch''s business day opens with its shift, and is still to be decided (Q-06)', f.code
      using errcode = 'restrict_violation', constraint = 'stock_branch_business_day_undecided';
  elsif f.facility_type not in ('warehouse', 'factory') then
    raise exception 'facility % is an %, and holds no stock', f.code, f.facility_type
      using errcode = 'restrict_violation', constraint = 'stock_facility_holds_no_stock';
  end if;
  return f;
end;
$$;

-- Records a decision and advances the projection, under 0020's balance lock for the item
-- here: a minimum and the movements of that item at that facility are applied in one
-- order, so a movement is judged against the minimum before it or after it, never half of
-- each. Then the stale check, against what the person read.
create or replace function erp.apply_stock_minimum(
  p_decision_id          uuid,
  p_kind                 text,
  f                      erp.facility,
  p_item                 erp.item,
  p_unit                 erp.item_unit,
  p_quantity             numeric,
  p_minimum              numeric,
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
  m erp.stock_minimum;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a minimum states why it was set or cleared'
      using errcode = 'check_violation', constraint = 'stock_minimum_reason_is_stated';
  end if;

  perform erp.lock_stock(array[f.facility_id], array[p_item.item_id]);
  select * into m from erp.stock_minimum x where x.facility_id = f.facility_id and x.item_id = p_item.item_id;

  if m.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the minimum of % at % has changed since it was read', p_item.code, f.code
      using errcode = 'restrict_violation', constraint = 'stock_minimum_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if p_kind = 'minimum_cleared' and m.minimum is null then
    raise exception '% has no minimum at %', p_item.code, f.code
      using errcode = 'restrict_violation', constraint = 'stock_minimum_not_set';
  end if;
  if p_kind = 'minimum_set' and m.minimum is not distinct from p_minimum then
    raise exception 'the minimum of % at % is already %', p_item.code, f.code, trim_scale(p_minimum)
      using errcode = 'restrict_violation', constraint = 'stock_minimum_unchanged';
  end if;

  insert into erp.stock_minimum_decision (
    decision_id, kind, facility_id, item_id, item_unit_id, unit_key, factor, quantity, minimum,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, f.facility_id, p_item.item_id,
    p_unit.item_unit_id, p_unit.unit_key, p_unit.factor, p_quantity, p_minimum,
    btrim(p_reason), p_actor_id, p_decided_at
  );

  insert into erp.stock_minimum (facility_id, item_id, minimum, as_of_decision_id)
  values (f.facility_id, p_item.item_id, p_minimum, p_decision_id)
  on conflict (facility_id, item_id) do update
    set minimum = excluded.minimum,
        as_of_decision_id = excluded.as_of_decision_id,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- Each is scoped to the facility, as stock's are: a factory manager sets minimums at the
-- factory and nowhere else. Each asks write on stock alerts there, and the three reads
-- erp.stock_minimum_history() asks, so whoever sets a minimum can confirm their own retry
-- (found in review); then answers a retry, then applies.

-- A minimum, entered in a pack of the item (I-7): "4 cartons" is kept as entered and as its
-- base quantity. New work on an item, so the item and the pack must be active;
-- another brand's pack answers as a missing one (ADR-0012). p_expected_decision_id is the
-- stamp the person read, or NULL when the item has never had a minimum here.
create or replace function erp.set_stock_minimum(
  p_decision_id          uuid,
  p_facility_id          uuid,
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
  f      erp.facility;
  u      erp.item_unit;
  v_item erp.item;
  v_qty  numeric;
  v_base numeric;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_minimum_decision_is_new(p_decision_id);
  f := erp.assert_stock_minimum_facility(p_facility_id);

  -- The brand fence first: 0012's own words for a conversion that does not exist.
  select x.* into u
    from erp.item_unit x
    join erp.item i on i.item_id = x.item_id
    join erp.operating_unit ou on ou.brand_id = i.brand_id
   where x.item_unit_id = p_item_unit_id and ou.operating_unit_id = f.operating_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  -- Under the item's share lock, which erp.retire_item_unit() takes for update, the pack is
  -- read again, and held: read only before, a pack retired while this waited was taken as
  -- current (found in review, as 0018's pricing was).
  v_item := erp.assert_item_active(u.item_id);
  select x.* into u from erp.item_unit x where x.item_unit_id = u.item_unit_id for share;
  if u.status <> 'active' then
    raise exception 'the % pack of % is retired: enter the minimum in a current one', u.unit_key, v_item.code
      using errcode = 'restrict_violation', constraint = 'stock_minimum_pack_is_retired';
  end if;

  if p_quantity is null or p_quantity !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
    raise exception 'a minimum is a number with up to twelve digits and six decimal places'
      using errcode = 'check_violation', constraint = 'stock_minimum_is_valid';
  end if;
  v_qty := trim_scale(p_quantity::numeric);
  if v_qty = 0 then
    raise exception 'a minimum is more than nothing'
      using errcode = 'check_violation', constraint = 'stock_minimum_is_valid',
            hint = 'To have no minimum, clear it.';
  end if;
  v_base := v_qty * u.factor;
  if v_base <> round(v_base, 6) then
    raise exception '% % is % in the base unit, past six decimal places', v_qty, u.unit_key, trim_scale(v_base)
      using errcode = 'check_violation', constraint = 'stock_minimum_inexact',
            hint = 'Enter it in a larger unit, or in the base unit.';
  end if;
  v_base := trim_scale(v_base);
  if v_base >= 1e12 then
    raise exception '% % is more than any store holds', v_qty, u.unit_key
      using errcode = 'check_violation', constraint = 'stock_minimum_is_valid';
  end if;

  perform erp.apply_stock_minimum(p_decision_id, 'minimum_set', f, v_item, u, v_qty, v_base,
                                  p_expected_decision_id, p_reason, p_actor_id, p_decided_at);
end;
$$;

-- The item no longer has a minimum here: nothing rings for it, and it is not listed. Not new
-- work, so a retired item's minimum can still be cleared.
create or replace function erp.clear_stock_minimum(
  p_decision_id          uuid,
  p_facility_id          uuid,
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
  f      erp.facility;
  v_item erp.item;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_minimum_decision_is_new(p_decision_id);
  f := erp.assert_stock_minimum_facility(p_facility_id);

  select i.* into v_item
    from erp.item i
    join erp.operating_unit ou on ou.brand_id = i.brand_id
   where i.item_id = p_item_id and ou.operating_unit_id = f.operating_unit_id;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  perform erp.apply_stock_minimum(p_decision_id, 'minimum_cleared', f, v_item, null, null, null,
                                  p_expected_decision_id, p_reason, p_actor_id, p_decided_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- They show stock on hand beside the minimum, so each asks read on stock alerts, stock and
-- items, at ONE facility (0020's finding), with the facility's brand a second fence.

-- Every item with a minimum here, by item code, paged: its minimum, as entered and in the
-- base unit, what is on hand (none, for an item never moved here), and whether it is low —
-- at or below its minimum (A2). p_low_only lists the low ones alone.
create or replace function erp.stock_minimums(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_low_only    boolean default false,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  item_id uuid, code text, item_kind text, base_unit_key text, name_en text, name_ar text, item_status text,
  minimum numeric, on_hand numeric, is_low boolean, as_of_decision_id uuid,
  item_unit_id uuid, unit_key text, factor numeric, quantity numeric, decided_at timestamptz
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
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 items'
      using errcode = 'invalid_parameter_value', constraint = 'stock_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select i.item_id, i.code::text, i.item_kind, i.base_unit_key, i.name_en, i.name_ar, i.status,
         m.minimum, coalesce(b.on_hand, 0), coalesce(b.on_hand, 0) <= m.minimum, m.as_of_decision_id,
         d.item_unit_id, d.unit_key, trim_scale(d.factor), trim_scale(d.quantity), d.decided_at
    from erp.stock_minimum m
    join erp.item i on i.item_id = m.item_id
    join erp.stock_minimum_decision d on d.decision_id = m.as_of_decision_id
    left join erp.stock_balance b on b.facility_id = m.facility_id and b.item_id = m.item_id
   where m.facility_id = p_facility_id
     and m.minimum is not null
     and i.brand_id = v_brand
     and (not coalesce(p_low_only, false) or coalesce(b.on_hand, 0) <= m.minimum)
     and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
   order by i.code collate "C"
   limit p_limit;
end;
$$;

-- An item's minimums here, newest first, paged by seq: every decision, set or cleared. The
-- read the edge makes to confirm a retried write, and the stamp an edit form starts from.
create or replace function erp.stock_minimum_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_item_id     uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, item_unit_id uuid, unit_key text, factor numeric, quantity numeric,
  minimum numeric, reason text, actor_id uuid, decided_at timestamptz, recorded_at timestamptz, is_current boolean
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
  perform erp.assert_permitted(p_actor_id, 'inventory.stock_alerts', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 decisions'
      using errcode = 'invalid_parameter_value', constraint = 'stock_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i where i.item_id = p_item_id and i.brand_id = v_brand) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  return query
  select d.decision_id, d.seq, d.kind, d.item_unit_id, d.unit_key, trim_scale(d.factor), trim_scale(d.quantity),
         trim_scale(d.minimum), d.reason, d.actor_id, d.decided_at, d.recorded_at,
         m.as_of_decision_id is not null
    from erp.stock_minimum_decision d
    left join erp.stock_minimum m on m.as_of_decision_id = d.decision_id
   where d.facility_id = p_facility_id and d.item_id = p_item_id
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- The bell (A2, A3) — 0021's notification, a second kind
-- ---------------------------------------------------------------------------

-- Additive (I-10): a second kind, about a stock decision as the first is. Its key, one per
-- person per kind per decision, already holds for it.
alter table erp.notification drop constraint notification_kind_is_known;
alter table erp.notification add constraint notification_kind_is_known
  check (kind in ('stock_below_zero', 'stock_low'));
alter table erp.notification drop constraint notification_names_its_source;
alter table erp.notification add constraint notification_names_its_source
  check ((kind in ('stock_below_zero', 'stock_low')) = (stock_decision_id is not null));

-- 0021's rule, with the second kind: a low-stock notification opens the low-stock list, so
-- it asks the list's three reads; capability state and grant alike.
create or replace function erp.notification_is_open_to(p_person_id uuid, p_kind text, p_facility_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case p_kind
    when 'stock_below_zero' then
          erp.capability_state_for('inventory.stock', p_facility_id) <> 'hidden'
      and erp.capability_state_for('inventory.items', p_facility_id) <> 'hidden'
      and erp.permission_granted(p_person_id, 'inventory.stock', 'read', p_facility_id)
      and erp.permission_granted(p_person_id, 'inventory.items', 'read', p_facility_id)
    when 'stock_low' then
          erp.capability_state_for('inventory.stock_alerts', p_facility_id) <> 'hidden'
      and erp.capability_state_for('inventory.stock', p_facility_id) <> 'hidden'
      and erp.capability_state_for('inventory.items', p_facility_id) <> 'hidden'
      and erp.permission_granted(p_person_id, 'inventory.stock_alerts', 'read', p_facility_id)
      and erp.permission_granted(p_person_id, 'inventory.stock', 'read', p_facility_id)
      and erp.permission_granted(p_person_id, 'inventory.items', 'read', p_facility_id)
    else false
  end;
$$;

-- THE PRODUCER (A2). An after-statement trigger on the balance, as 0021's, for the same
-- reasons: 0020's seam writes every balance a decision touches in one statement, stamped
-- with it, so this reads what that decision left, still under the seam's key lock, which
-- erp.apply_stock_minimum() takes too.
--
-- A crossing: the balance before the posting was above the minimum, and after it is at or
-- below it. Only an UPDATE can cross: a balance's first posting inserts it, from nothing,
-- and nothing is never above a minimum. An update that keeps the stamp posted nothing.
--
-- Its items are those this decision took across, with the balance it left and the minimum
-- it crossed, by code. An item it took below zero is among them when it crossed its
-- minimum: the override's notification and this one are of different kinds, for different
-- people (A3: here the actor is told too).
create or replace function erp.notify_stock_low()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_crossed record;
begin
  for v_crossed in
    select n.as_of_decision_id as decision_id, n.facility_id,
           jsonb_agg(jsonb_build_object('item_id', n.item_id, 'on_hand', trim_scale(n.on_hand)::text,
                                        'minimum', trim_scale(m.minimum)::text)
                     order by i.code collate "C") as items
      from new_rows n
      join old_rows o on o.facility_id = n.facility_id and o.item_id = n.item_id
      join erp.stock_minimum m on m.facility_id = n.facility_id and m.item_id = n.item_id
      join erp.item i on i.item_id = n.item_id
     where m.minimum is not null
       and o.on_hand > m.minimum
       and n.on_hand <= m.minimum
       and n.as_of_decision_id is distinct from o.as_of_decision_id
     group by n.as_of_decision_id, n.facility_id
     order by n.as_of_decision_id
  loop
    continue when exists (select 1 from erp.notification x
                           where x.stock_decision_id = v_crossed.decision_id and x.kind = 'stock_low');
    insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id, data)
    select 'stock_low', p.person_id, v_crossed.facility_id, v_crossed.decision_id,
           jsonb_build_object('items', v_crossed.items)
      from erp.person p
     where p.status = 'active'
       and erp.notification_is_open_to(p.person_id, 'stock_low', v_crossed.facility_id)
    on conflict on constraint notification_once_per_person do nothing;
  end loop;
  return null;
end;
$$;

-- 0021's producer, asking only whether a decision was told THAT it went below zero. It
-- asked whether any notification named the decision, and an INSERT … ON CONFLICT DO UPDATE
-- fires its update triggers before its insert's: so an override that took a new item below
-- zero and another item across its minimum wrote the low-stock row first, and the
-- below-zero producer then told nobody (found in review). Otherwise as 0021 wrote it.
create or replace function erp.notify_stock_below_zero()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_decision_ids uuid[];
  v_decision     erp.stock_decision;
  v_items        jsonb;
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.as_of_decision_id) into v_decision_ids
      from new_rows n where n.on_hand < 0;
  else
    select array_agg(distinct n.as_of_decision_id) into v_decision_ids
      from new_rows n
      join old_rows o on o.facility_id = n.facility_id and o.item_id = n.item_id
     where n.on_hand < 0 and n.as_of_decision_id is distinct from o.as_of_decision_id;
  end if;
  if v_decision_ids is null then
    return null;
  end if;

  for v_decision in
    select d.* from erp.stock_decision d
     where d.decision_id = any (v_decision_ids)
       and d.override_reason is not null
       and not exists (select 1 from erp.notification x
                        where x.stock_decision_id = d.decision_id and x.kind = 'stock_below_zero')
     order by d.decision_id
  loop
    select jsonb_agg(jsonb_build_object('item_id', b.item_id, 'on_hand', trim_scale(b.on_hand)::text)
                     order by i.code collate "C")
      into v_items
      from (select distinct e.item_id from erp.stock_ledger e
             where e.decision_id = v_decision.decision_id and e.direction = 'out') x
      join erp.stock_balance b on b.facility_id = v_decision.facility_id and b.item_id = x.item_id
      join erp.item i on i.item_id = b.item_id
     where b.as_of_decision_id = v_decision.decision_id
       and b.on_hand < 0;
    continue when v_items is null;

    insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id, data)
    select 'stock_below_zero', p.person_id, v_decision.facility_id, v_decision.decision_id,
           jsonb_build_object('items', v_items)
      from erp.person p
     where p.status = 'active'
       and p.person_id <> v_decision.actor_id
       and erp.notification_is_open_to(p.person_id, 'stock_below_zero', v_decision.facility_id)
    on conflict on constraint notification_once_per_person do nothing;
  end loop;
  return null;
end;
$$;

-- No WHEN clause, as 0021's: the function decides.
create trigger stock_low_is_notified
  after update on erp.stock_balance
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function erp.notify_stock_low();

-- 0021's bell page, now also naming the minimum a low-stock item crossed. A key only a
-- notification that holds it carries: a below-zero one reads exactly as before.
create or replace function erp.list_notifications(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 30
)
returns table (
  notification_id uuid, seq bigint, kind text, facility_id uuid, facility_code text, stock_decision_id uuid,
  created_at timestamptz, read_at timestamptz, items jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'platform.notifications', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'a page holds 1 to 100 notifications'
      using errcode = 'invalid_parameter_value', constraint = 'notification_page_size';
  end if;

  return query
  select n.notification_id, n.seq, n.kind, n.facility_id, f.code::text, n.stock_decision_id, n.created_at, n.read_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'item_id', i.item_id, 'code', i.code, 'name_en', i.name_en, 'name_ar', i.name_ar,
                    'base_unit_key', i.base_unit_key, 'on_hand', x.value ->> 'on_hand')
                    || case when x.value ? 'minimum' then jsonb_build_object('minimum', x.value ->> 'minimum')
                            else '{}'::jsonb end
                  order by x.ordinality)
             from jsonb_array_elements(n.data -> 'items') with ordinality as x(value, ordinality)
             join erp.item i on i.item_id = (x.value ->> 'item_id')::uuid), '[]'::jsonb)
    from erp.notification n
    join erp.facility f on f.facility_id = n.facility_id
   where n.recipient_id = p_actor_id
     and n.created_at > now() - interval '90 days'
     and (p_before_seq is null or n.seq < p_before_seq)
     and erp.notification_is_open_to(p_actor_id, n.kind, n.facility_id)
   order by n.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('inventory.stock_alerts', 'Stock alerts', 'تنبيهات المخزون',
   array['INV-013', 'SUP-005', 'PRG-014'], false,
   timestamptz '2026-10-07 00:00:00+00');

-- A real database's only role is the administrator (0011). Who else sets or reads minimums
-- is the seed's business (0035) and, in a real one, the owner's open question (ADR-0031).
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'inventory.stock_alerts', 'read'),
  ('administrator', 'inventory.stock_alerts', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the two tables: writes through the two routes, reads
-- through the two gated functions. Not the helpers, the guard or the producer.
grant execute on function
  erp.set_stock_minimum(uuid, uuid, uuid, text, uuid, text, uuid, timestamptz),
  erp.clear_stock_minimum(uuid, uuid, uuid, uuid, text, uuid, timestamptz),
  erp.stock_minimums(uuid, uuid, boolean, text, integer),
  erp.stock_minimum_history(uuid, uuid, uuid, bigint, integer)
to erp_app;

-- erp_read keeps 0002's default SELECT on both tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
alter table erp.stock_minimum_decision enable row level security;
alter table erp.stock_minimum_decision force row level security;
create policy erp_read_all on erp.stock_minimum_decision for select to erp_read using (true);
alter table erp.stock_minimum enable row level security;
alter table erp.stock_minimum force row level security;
create policy erp_read_all on erp.stock_minimum for select to erp_read using (true);
