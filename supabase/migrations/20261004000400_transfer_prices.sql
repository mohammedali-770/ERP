-- 0018 · Transfer prices — what a branch is charged for an item, from when
--
-- Requirements: INV-017 · INV-019 · INV-005 · PRG-014 · CAP-P02 · CAP-P04 · IAM-006 · IAM-008
-- ADR-0005 · ADR-0012 · ADR-0024 · ADR-0027 (proposed) · invariants I-1, I-6, I-7, I-8
--
-- Phase 4, module 3. The warehouse kept one column, items.unit_price numeric(10,2),
-- default 0: the price a branch order line copied when the line was added, and the price
-- its monthly statements and accounting journal valued transfers at. It was changed in
-- place by the administrator or the accountant (set_item_unit_price()), and a trigger
-- wrote the old and new value to item_price_history. Written fresh here through the
-- process mapping MFG-012 requires (docs/estate/process-mapping-transfer-prices.md).
--
-- A PRICE IS A FACT ABOUT A PACK, FROM A MOMENT. Four changes from the warehouse:
--
--   * IT NAMES A CONVERSION, NOT AN ITEM. A branch orders chicken by the 10 kg carton,
--     and is charged for the carton. The price references erp.item_unit through 0012's
--     four-column seam, as a supply does (0016): a carton changed to 12 kg is a new
--     conversion, and needs a new price; the old price goes on meaning 10.
--   * IT TAKES EFFECT FROM A MOMENT, and may be set ahead of it. "From the first of the
--     month the carton is 185 SAR" is one decision, made today. A price is never
--     backdated: an order placed yesterday was placed at yesterday's price (MNU-015's
--     rule for selling prices, applied to transfers).
--   * IT IS MONEY: integer minor units with an explicit currency, never numeric(10,2) and
--     never a float (canonical-model.md; 0006's total_minor). SAR has two minor units.
--   * ZERO IS A DECISION, NOT A DEFAULT. The warehouse's default 0 meant "nobody set a
--     price" and was indistinguishable from "free". An unpriced conversion here has no
--     price; a price of 0 is something somebody decided, and is recorded as such.
--
-- HISTORY IS THE TABLE ITSELF. erp.transfer_price holds one row per price ever set, each
-- with the moment it takes effect. The price in force at a moment is the latest row in
-- effect at it, so "what did a carton cost on the 3rd" is answered from the rows, and a
-- branch order line (module 10) copies the answer into its own immutable record (I-7).
-- A price, once in effect, never changes and is never withdrawn; a price set ahead may
-- be withdrawn until its moment comes. Every change is a decision with an actor and a
-- reason, in an append-only log, as 0012 and 0016 keep theirs.
--
-- NOT HERE, deliberately, and recorded in ADR-0027 as the owner's to decide:
--   * VAT. Branch orders carried none in the warehouse: a transfer within the company is
--     not a sale. Whether that holds between legal entities is a question for the
--     accountant and counsel, not a column to guess;
--   * a price per branch, or per brand beyond the item's own;
--   * approval of a price change by a second person (AI-011 names price changes among
--     what needs human authorisation; one person deciding is that authorisation today).
--
-- The module ships HIDDEN, like 0012 and 0016: registered here, no decision recorded,
-- so CAP-P02's default-deny holds in every real database until a later migration
-- promotes it.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The decision log (IAM-008, I-8) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.transfer_price_decision (
  decision_id    uuid        primary key,
  -- A total order, as 0012's and 0016's: decided_at ties in the seed.
  seq            bigint      generated always as identity constraint transfer_price_decision_seq_key unique,
  kind           text        not null
    constraint transfer_price_decision_kind_is_known check (kind in ('price_set', 'price_withdrawn')),
  -- No foreign key to the price: the decision is written before the row it creates, as
  -- 0012's and 0016's logs. db-check's transfer-prices-match-their-decisions proves every
  -- decision names a real price.
  price_id       uuid        not null,
  -- The whole price this decision left: the conversion, copied whole, the amount, the
  -- currency, the moment and the status. Never a delta.
  item_unit_id   uuid        not null,
  item_id        uuid        not null,
  unit_key       text        not null,
  factor         numeric     not null,
  price_minor    bigint      not null,
  currency       text        not null,
  effective_from timestamptz not null,
  status         text        not null
    constraint transfer_price_decision_status_is_known check (status in ('active', 'withdrawn')),
  reason         text        not null constraint transfer_price_decision_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id       uuid        not null constraint transfer_price_decision_actor_is_a_person
                               references erp.person (person_id) on delete no action,
  decided_at     timestamptz not null,
  recorded_at    timestamptz not null default now(),
  -- Target for the projection's composite stamp: a stamp names a decision about ITS price.
  constraint transfer_price_decision_about_price unique (decision_id, price_id),
  constraint transfer_price_decision_shape check ((kind = 'price_withdrawn') = (status = 'withdrawn'))
);

comment on table erp.transfer_price_decision is
  'Append-only record of every transfer price set or withdrawn (INV-017, IAM-008, I-8). Each row carries the whole price it put in force.';
comment on column erp.transfer_price_decision.price_id is
  'No foreign key: the log is written before the row it creates, as erp.item_decision.item_id. Checked by db-check.';

create index ix_transfer_price_decision_price on erp.transfer_price_decision (price_id, seq);
create index ix_transfer_price_decision_item on erp.transfer_price_decision (item_id, seq);

create or replace function erp.transfer_price_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'transfer_price_decision is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. What a branch was charged, and who set it, is not unmade by deleting the record of it.';
end;
$$;

-- Append-only, enforced twice as every log here is. erp_app holds no privilege on it.
create trigger transfer_price_decision_append_only
  before update or delete or truncate on erp.transfer_price_decision
  for each statement
  execute function erp.transfer_price_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- The prices (INV-017, I-7) — one row per price ever set
-- ---------------------------------------------------------------------------

create table erp.transfer_price (
  -- UUIDv7, minted by the console (I-1, ADR-0005).
  price_id          uuid        primary key,
  -- THE I-7 SEAM: the conversion priced, copied whole and referenced through 0012's
  -- item_unit_seam. "A branch pays 185 SAR for chicken breast in 10 kg cartons."
  item_unit_id      uuid        not null,
  item_id           uuid        not null,
  unit_key          text        not null,
  factor            numeric     not null,
  -- Integer minor units: 18500 is 185.00 SAR. Zero is allowed and means free, because
  -- somebody decided it; no row means no price. The ceiling is a typing error's, not a
  -- business rule: a billion riyals for one pack.
  price_minor       bigint      not null
    constraint transfer_price_is_minor_units check (price_minor between 0 and 100000000000),
  -- One currency today. A second is a decision for later, made in a migration.
  currency          text        not null constraint transfer_price_currency_is_known check (currency = 'SAR'),
  -- When it takes effect. Never before the decision that set it (no backdating), and
  -- never changed: a different moment is a different price.
  effective_from    timestamptz not null,
  -- 'withdrawn' only before effective_from: a price set ahead may be taken back until its
  -- moment comes, never after (the trigger below binds the owner too).
  status            text        not null constraint transfer_price_status_is_known check (status in ('active', 'withdrawn')),
  -- I-8. The single-column key is what db-check's projection-stamp-is-a-foreign-key-
  -- where-it-can-be finds; the composite one makes it impossible to stamp this price with
  -- ANOTHER price's decision.
  as_of_decision_id uuid        not null constraint transfer_price_as_of_decision_id_fkey
                                  references erp.transfer_price_decision (decision_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint transfer_price_names_a_conversion foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor),
  constraint transfer_price_stamp_is_this_prices_decision foreign key (as_of_decision_id, price_id)
    references erp.transfer_price_decision (decision_id, price_id)
);

comment on table erp.transfer_price is
  'What a branch is charged for one of an item''s conversions, from a moment (INV-017, I-7). One row per price ever set; the price in force at a moment is the latest active row in effect at it. Fixed once set; a price set ahead may be withdrawn before it takes effect. Never deleted.';

-- One price per conversion per moment. Named as the constraint the route raises, so a
-- race that slips past its check is refused under the same name.
create unique index transfer_price_one_per_moment on erp.transfer_price (item_unit_id, effective_from)
  where status = 'active';
create index ix_transfer_price_item on erp.transfer_price (item_id);
create index ix_transfer_price_unit_from on erp.transfer_price (item_unit_id, effective_from desc) where status = 'active';

-- ---------------------------------------------------------------------------
-- Guard triggers — they bind every writer, the owner and the seed included
-- ---------------------------------------------------------------------------

create or replace function erp.transfer_price_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'transfer price % is withdrawn or superseded, never deleted (B-11)', old.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_never_deleted',
            hint = 'Set a new price from a later moment, or withdraw one that has not taken effect.';
  end if;
  if (new.price_id, new.item_unit_id, new.item_id, new.unit_key, new.factor, new.price_minor, new.currency, new.effective_from)
     is distinct from
     (old.price_id, old.item_unit_id, old.item_id, old.unit_key, old.factor, old.price_minor, old.currency, old.effective_from) then
    raise exception 'transfer price %: the pack, the amount and the moment are fixed once set (I-7)', old.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_fixed',
            hint = 'Set a new price from a later moment.';
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'transfer price % is withdrawn for good; set it again (I-6)', old.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_withdrawal_final';
  end if;
  -- A price in effect is history: an order may already have been charged it. Judged by
  -- the clock at the update, not now(), which is the transaction's START: a withdrawal
  -- that waited on a lock past the price's moment was let through (found in review).
  if old.status = 'active' and new.status = 'withdrawn' and old.effective_from <= clock_timestamp() then
    raise exception 'transfer price % is in effect: set a new price instead of withdrawing it', old.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_in_effect';
  end if;
  -- A withdrawn price restamped is a decision that changed nothing (0012's reasoning).
  -- Timestamp-only updates (0090) leave the stamp alone and pass.
  if old.status = 'withdrawn' and new.as_of_decision_id is distinct from old.as_of_decision_id then
    raise exception 'transfer price % is already withdrawn', old.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_already_withdrawn';
  end if;
  return new;
end;
$$;

create trigger transfer_price_is_fixed
  before update or delete on erp.transfer_price
  for each row
  execute function erp.transfer_price_is_fixed();

-- Row triggers do not fire for TRUNCATE.
create or replace function erp.transfer_prices_are_never_truncated()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is never deleted (B-11): TRUNCATE denied', tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Withdraw a price that has not taken effect through erp.withdraw_transfer_price().';
end;
$$;

create trigger transfer_price_never_truncated
  before truncate on erp.transfer_price
  for each statement
  execute function erp.transfer_prices_are_never_truncated();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- A retried call carries the decision id it was first sent with: 0012's
-- assert_item_decision_is_new(), for this log. Locked and checked first, so a retry that
-- overlaps its original waits for it and then answers 23505 on
-- transfer_price_decision_pkey, which the edge reads as already recorded.
create or replace function erp.assert_transfer_price_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.transfer_price_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.transfer_price_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'transfer_price_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.transfer_price_history() to confirm.';
  end if;
end;
$$;

-- The price of a conversion in force at a moment, or NULL when it has none then.
create or replace function erp.transfer_price_in_force(p_item_unit_id uuid, p_at timestamptz)
returns erp.transfer_price
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p.* from erp.transfer_price p
  where p.item_unit_id = p_item_unit_id and p.status = 'active' and p.effective_from <= p_at
  order by p.effective_from desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The seam for later modules — owner-only, called from their own definer routes
-- ---------------------------------------------------------------------------

-- What a branch order line (module 10) copies into its own record (I-7): the price of
-- the conversion in force when the order was placed. No price is a refusal, never a
-- silent 0 as in the warehouse, where an unpriced item went out at nothing.
--
-- It takes the conversion's price lock SHARED, the lock every price decision about the
-- conversion takes exclusively: an order waits for a price decision in flight, and a
-- decision waits for orders in flight, so no order is charged a price that history then
-- says did not apply at its moment (found in review).
--
-- An order is new work, so the item and the conversion must both be active, and are
-- checked here, under the item's share lock, which retire_item_unit() and retire_item()
-- take for update. Checked by the caller alone, through erp.active_item_unit(), a
-- conversion could be retired between that unlocked read and this one, and an order
-- priced for a pack that no longer existed (found in review). The share lock is held to
-- the end of the caller's transaction, so its own erp.active_item_unit() afterwards sees
-- the same conversion. A retired pack's prices stay readable, through the gated reads.
create or replace function erp.transfer_price_at(p_item_unit_id uuid, p_at timestamptz)
returns erp.transfer_price
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v      erp.transfer_price;
  u      erp.item_unit;
  v_item uuid;
begin
  -- item_id never changes (erp.item_unit_is_fixed()), so reading it unlocked is safe.
  select x.item_id into v_item from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  -- The item, then the conversion read after its lock: the order every conversion route
  -- takes, and the order set_transfer_price() takes before the price lock below.
  perform erp.assert_item_active(v_item);
  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if u.status <> 'active' then
    raise exception 'conversion % is retired and admits no new work', u.item_unit_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_conversion_is_active';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('erp.transfer_price:' || p_item_unit_id::text, 0));
  v := erp.transfer_price_in_force(p_item_unit_id, p_at);
  if v.price_id is null then
    raise exception 'conversion % has no transfer price at %', p_item_unit_id, p_at
      using errcode = 'no_data_found', constraint = 'transfer_price_exists',
            hint = 'Set a transfer price for this pack before it can be ordered.';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- A price for one conversion, from a moment: now when p_effective_from is NULL, or a
-- later moment set ahead. Never earlier than the decision. Only an active pack of an
-- active item can be priced; a price already in force at that moment, or the one the
-- pack moves to next, is refused rather than recorded twice.
create or replace function erp.set_transfer_price(
  p_decision_id    uuid,
  p_price_id       uuid,
  p_item_unit_id   uuid,
  p_price_minor    bigint,
  p_currency       text,
  p_effective_from timestamptz,
  p_reason         text,
  p_actor_id       uuid,
  p_decided_at     timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  u       erp.item_unit;
  v_from  timestamptz;
  v_clock timestamptz;
  v_now   erp.transfer_price;
  v_next  erp.transfer_price;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.transfer_prices', 'write', null);
  perform erp.assert_transfer_price_decision_is_new(p_decision_id);

  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  perform erp.assert_item_active(u.item_id);
  -- Read again under the item's share lock: a conversion retired meanwhile is seen.
  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if u.status <> 'active' then
    raise exception 'conversion % is retired: a price is set for an active pack (I-7)', u.item_unit_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_conversion_is_active';
  end if;
  if p_price_minor is null or p_price_minor not between 0 and 100000000000 then
    raise exception 'a transfer price is a whole number of minor units (halalas), 0 or more'
      using errcode = 'check_violation', constraint = 'transfer_price_is_minor_units';
  end if;
  if p_currency is distinct from 'SAR' then
    raise exception 'transfer prices are in SAR'
      using errcode = 'check_violation', constraint = 'transfer_price_currency_is_known';
  end if;

  -- Serialise decisions about this conversion, and orders that read its price (the seam
  -- takes this lock shared), so two prices for one moment, a price checked against
  -- another being withdrawn, or an order reading a price being set, cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('erp.transfer_price:' || u.item_unit_id::text, 0));

  -- "Now" is the clock once the lock is held — not now(), the transaction's start, and
  -- not p_decided_at, which the caller supplies. A caller passing a past decision time,
  -- or a decision that waited on a lock, would otherwise set a price in the past and
  -- rewrite what an order already placed was charged (found in review).
  v_clock := greatest(clock_timestamp(), p_decided_at);
  v_from := coalesce(p_effective_from, v_clock);
  if v_from < v_clock then
    raise exception 'a transfer price takes effect now or later, never before it was set (MNU-015)'
      using errcode = 'check_violation', constraint = 'transfer_price_not_backdated',
            hint = 'An order already placed keeps the price it was placed at.';
  end if;
  if exists (select 1 from erp.transfer_price p
              where p.item_unit_id = u.item_unit_id and p.status = 'active' and p.effective_from = v_from) then
    raise exception 'conversion % already has a price from %; withdraw that one first', u.item_unit_id, v_from
      using errcode = 'unique_violation', constraint = 'transfer_price_one_per_moment';
  end if;
  v_now := erp.transfer_price_in_force(u.item_unit_id, v_from);
  if v_now.price_id is not null and v_now.price_minor = p_price_minor and v_now.currency = p_currency then
    raise exception 'that price is already in force from %', v_from
      using errcode = 'restrict_violation', constraint = 'transfer_price_unchanged';
  end if;
  -- Nor the price the pack already moves to next. With 100 in force and 200 set for
  -- February, 200 from January would leave February's price changing nothing: a second
  -- record of one price, and orders switching price at February for no change (found in
  -- review). Withdraw February's first, then set January's.
  select * into v_next from erp.transfer_price p
   where p.item_unit_id = u.item_unit_id and p.status = 'active' and p.effective_from > v_from
   order by p.effective_from
   limit 1;
  if v_next.price_id is not null and v_next.price_minor = p_price_minor and v_next.currency = p_currency then
    raise exception 'that price is already set from %; withdraw that one first', v_next.effective_from
      using errcode = 'restrict_violation', constraint = 'transfer_price_same_as_next';
  end if;

  insert into erp.transfer_price_decision (
    decision_id, kind, price_id, item_unit_id, item_id, unit_key, factor, price_minor, currency, effective_from,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'price_set', p_price_id, u.item_unit_id, u.item_id, u.unit_key, u.factor, p_price_minor, p_currency,
    v_from, 'active', p_reason, p_actor_id, p_decided_at
  );

  insert into erp.transfer_price (
    price_id, item_unit_id, item_id, unit_key, factor, price_minor, currency, effective_from, status, as_of_decision_id
  ) values (
    p_price_id, u.item_unit_id, u.item_id, u.unit_key, u.factor, p_price_minor, p_currency, v_from, 'active', p_decision_id
  );
end;
$$;

-- Takes back a price set ahead, before its moment comes. A price in effect is history.
create or replace function erp.withdraw_transfer_price(
  p_decision_id uuid,
  p_price_id    uuid,
  p_reason      text,
  p_actor_id    uuid,
  p_decided_at  timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_unit uuid;
  p      erp.transfer_price;
  v_prev erp.transfer_price;
  v_next erp.transfer_price;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.transfer_prices', 'write', null);
  perform erp.assert_transfer_price_decision_is_new(p_decision_id);

  select x.item_unit_id into v_unit from erp.transfer_price x where x.price_id = p_price_id;
  if not found then
    raise exception 'no transfer price %', p_price_id using errcode = 'no_data_found', constraint = 'transfer_price_exists';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('erp.transfer_price:' || v_unit::text, 0));
  select * into p from erp.transfer_price x where x.price_id = p_price_id for update;
  if p.status = 'withdrawn' then
    raise exception 'transfer price % is already withdrawn', p.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_already_withdrawn';
  end if;
  -- As above: the clock once the locks are held, or the decision's own time if later.
  if p.effective_from <= greatest(clock_timestamp(), p_decided_at) then
    raise exception 'transfer price % is in effect: set a new price instead of withdrawing it', p.price_id
      using errcode = 'restrict_violation', constraint = 'transfer_price_in_effect';
  end if;
  -- Nor a withdrawal that leaves two neighbouring prices the same: with 100 in force,
  -- 200 set for February and 100 for March, withdrawing February's leaves March's
  -- changing nothing, the case set_transfer_price() refuses. Withdraw March's first.
  select * into v_prev from erp.transfer_price x
   where x.item_unit_id = p.item_unit_id and x.status = 'active' and x.effective_from < p.effective_from
   order by x.effective_from desc
   limit 1;
  select * into v_next from erp.transfer_price x
   where x.item_unit_id = p.item_unit_id and x.status = 'active' and x.effective_from > p.effective_from
   order by x.effective_from
   limit 1;
  if v_prev.price_id is not null and v_next.price_id is not null
     and v_prev.price_minor = v_next.price_minor and v_prev.currency = v_next.currency then
    raise exception 'withdrawing transfer price % leaves the price from % the same as the one before it; withdraw that one first',
      p.price_id, v_next.effective_from
      using errcode = 'restrict_violation', constraint = 'transfer_price_withdrawal_repeats';
  end if;

  insert into erp.transfer_price_decision (
    decision_id, kind, price_id, item_unit_id, item_id, unit_key, factor, price_minor, currency, effective_from,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'price_withdrawn', p.price_id, p.item_unit_id, p.item_id, p.unit_key, p.factor, p.price_minor,
    p.currency, p.effective_from, 'withdrawn', p_reason, p_actor_id, p_decided_at
  );

  update erp.transfer_price
     set status = 'withdrawn', as_of_decision_id = p_decision_id, updated_at = now()
   where price_id = p.price_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads — the runtime's only view of transfer prices (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- A price names an item's code, names and pack, so every read asks for read on BOTH
-- capabilities, as erp.item_suppliers() does, and is limited to the facility's brand as
-- items are (ADR-0012): an item of another brand answers exactly as a missing one.

-- Every price ever set for an item's conversions, newest moment first per pack, with
-- the one in force now marked.
create or replace function erp.item_transfer_prices(p_actor_id uuid, p_facility_id uuid, p_item_id uuid)
returns table (
  price_id uuid, item_unit_id uuid, unit_key text, factor numeric, price_minor bigint, currency text,
  effective_from timestamptz, status text, in_force boolean, conversion_status text, as_of_decision_id uuid
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
  perform erp.assert_permitted(p_actor_id, 'inventory.transfer_prices', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i where i.item_id = p_item_id and (v_brand is null or i.brand_id = v_brand)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  return query
  select p.price_id, p.item_unit_id, p.unit_key, p.factor, p.price_minor, p.currency, p.effective_from, p.status,
         coalesce(p.price_id = (erp.transfer_price_in_force(p.item_unit_id, now())).price_id, false),
         u.status, p.as_of_decision_id
  from erp.transfer_price p
  join erp.item_unit u on u.item_unit_id = p.item_unit_id
  where p.item_id = p_item_id
  order by p.unit_key, p.effective_from desc, p.price_id;
end;
$$;

-- The price list: for each active conversion of each active item at the facility's
-- brand, the price in force now and the next one set ahead. Paged by item code, at most
-- p_limit items a page, every pack of an item on the same page.
create or replace function erp.list_transfer_prices(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_search      text    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  item_id uuid, code text, name_en text, name_ar text, base_unit_key text, item_unit_id uuid, unit_key text,
  factor numeric, price_id uuid, price_minor bigint, currency text, effective_from timestamptz,
  next_price_id uuid, next_price_minor bigint, next_effective_from timestamptz
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
  perform erp.assert_permitted(p_actor_id, 'inventory.transfer_prices', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 items'
      using errcode = 'invalid_parameter_value', constraint = 'transfer_price_page_size';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  with page as (
    select i.* from erp.item i
    where i.status = 'active'
      and (v_brand is null or i.brand_id = v_brand)
      and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
      and (v_search is null
           or starts_with(i.code, erp.normalise_item_code(v_search))
           or strpos(lower(i.name_en), lower(v_search)) > 0
           or strpos(i.name_ar, v_search) > 0)
    order by i.code collate "C"
    limit p_limit
  )
  select i.item_id, i.code, i.name_en, i.name_ar, i.base_unit_key, u.item_unit_id, u.unit_key, u.factor,
         cur.price_id, cur.price_minor, cur.currency, cur.effective_from,
         nxt.price_id, nxt.price_minor, nxt.effective_from
  from page i
  join erp.item_unit u on u.item_id = i.item_id and u.status = 'active'
  left join lateral erp.transfer_price_in_force(u.item_unit_id, now()) cur on true
  left join lateral (
    select p.price_id, p.price_minor, p.effective_from from erp.transfer_price p
    where p.item_unit_id = u.item_unit_id and p.status = 'active' and p.effective_from > now()
    order by p.effective_from
    limit 1
  ) nxt on true
  order by i.code collate "C", u.factor, u.unit_key;
end;
$$;

-- Every decision about an item's transfer prices, in order (IAM-008).
create or replace function erp.transfer_price_history(p_actor_id uuid, p_facility_id uuid, p_item_id uuid)
returns setof erp.transfer_price_decision
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.transfer_prices', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i where i.item_id = p_item_id and (v_brand is null or i.brand_id = v_brand)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  return query
  select d.* from erp.transfer_price_decision d where d.item_id = p_item_id order by d.seq;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

-- As 0012 and 0016: in the migration, because a real database needs it; no decision, so
-- HIDDEN everywhere until a later migration promotes it.
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('inventory.transfer_prices', 'Transfer prices', 'أسعار التحويل',
   array['INV-017', 'INV-019', 'INV-005', 'PRG-014'], false, timestamptz '2026-10-04 00:00:00+00');

-- In the warehouse, set_item_unit_price() was the administrator's and the accountant's.
-- A real database's only role is the administrator (0011), so these two rows are what
-- lets anyone set a price once the capability opens. The accountant and the readers are
-- the seed's business (0035), as for 0012 and 0016.
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'inventory.transfer_prices', 'read'),
  ('administrator', 'inventory.transfer_prices', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the two tables: writes only through the routes, each
-- recording its decision; reads only through the gated functions. No EXECUTE on the seam
-- or the helpers — module 10 calls the seam from its own definer route.
grant execute on function
  erp.set_transfer_price(uuid, uuid, uuid, bigint, text, timestamptz, text, uuid, timestamptz),
  erp.withdraw_transfer_price(uuid, uuid, text, uuid, timestamptz),
  erp.item_transfer_prices(uuid, uuid, uuid),
  erp.list_transfer_prices(uuid, uuid, text, text, integer),
  erp.transfer_price_history(uuid, uuid, uuid)
to erp_app;

-- erp_read keeps 0002's default SELECT on both tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
do $$
declare
  t text;
begin
  foreach t in array array['transfer_price_decision', 'transfer_price'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;
