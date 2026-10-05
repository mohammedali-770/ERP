-- 0020 · Stock — a ledger of movements at a warehouse or a factory, and what it adds up to
--
-- Requirements: INV-003 · INV-006 · INV-007 · INV-008 · INV-009 · INV-P01 · INV-P02 · MFG-012 · CAP-P02 · CAP-P04
-- ADR-0005 · ADR-0012 · ADR-0024 · ADR-0028 · ADR-0029 (proposed) · invariants I-1, I-6, I-7, I-8
-- docs/domain/ledger-primitives.md
--
-- Phase 4, module 5. The warehouse kept stock as counters on the item rows
-- (warehouse_stock_pieces, factory_stock) and changed them in place; a trigger wrote a
-- stock_movements row as a side effect, labelled from a session setting. The counter was
-- the master and the movement a log of it. It let stock go negative, and the daily sheet
-- clamped what it showed at zero; a count overwrote the counter with what was found. Written
-- fresh here through the process mapping MFG-012 requires (docs/estate/process-mapping-stock.md).
--
-- THE LEDGER IS THE MASTER, the balance its sum (ledger-primitives, I-8):
--
--   * EVERY MOVEMENT IS A DECISION with an actor, a reason and the moment it happened, in an
--     append-only log; its lines are ledger entries, each a positive base quantity with a
--     direction, naming the conversion it was entered in through 0012's seam (I-7). Nothing
--     is updated or deleted: a mistake is reversed by a further decision, once (I-6).
--   * THE BALANCE is per facility and item (D4: no storage location yet), stamped with the
--     latest decision that touched it, and always equal to its entries' sum (db-check).
--   * A COUNT records what was found, line by line, and posts the difference from the book
--     AS AT THE MOMENT COUNTED, so a movement entered late, but dated before the count, is
--     not counted twice (D3).
--
-- The owner's decisions of 2026-10-05 (ADR-0029):
--   D1  stock never goes negative unless a person allowed to override says so, with a
--       reason; the balance then shows negative until a count settles it.
--   D2  no second person approves an adjustment or a count: each is posted directly, and
--       records who, when and why.
--   D3  a movement's business day is the calendar date, in the facility's time zone, of the
--       moment it happened. A late entry states that moment, and is never dated at or before
--       the item's last count. This decides Q-22 for WAREHOUSE AND FACTORY stock only: a
--       branch's business day opens with its shift (Q-06), so branches hold no stock record
--       here until that is decided.
--   D4  stock is held per facility; storage locations within one come later.
--
-- Found in the design review (ADR-0029 lists them): a reversal is dated at the moment it
-- undoes and refused once a count has covered it, or the count's correction is made twice;
-- the balance is locked by key before it exists, never by a placeholder row; "now" is read
-- after the locks; a count and a movement never share a moment; another brand's conversion
-- answers as a missing one; and stock reads are fenced by facility, not only by brand.
--
-- The module ships HIDDEN, as 0012, 0016, 0018 and 0019 do: registered here, no decision
-- recorded, so CAP-P02's default-deny holds in every real database until a later migration
-- promotes it. inventory.stock was until now a capability only the synthetic seed knew.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The decision log (INV-007, IAM-008) — append-only, one row per movement document
-- ---------------------------------------------------------------------------

create table erp.stock_decision (
  -- UUIDv7, minted by the console (I-1, ADR-0005): the idempotency key.
  decision_id          uuid        primary key,
  -- A total order, as every log here keeps. Drawn while the balance locks are held, so for
  -- any one facility and item it is the order the decisions were applied in.
  seq                  bigint      generated always as identity constraint stock_decision_seq_key unique,
  -- Only the kinds this module writes. Later modules widen it additively (I-10): receipt,
  -- issue, production, transfer, return, sale consumption.
  kind                 text        not null
    constraint stock_decision_kind_is_known check (kind in ('count', 'adjustment', 'waste', 'damage', 'expiry', 'reversal')),
  facility_id          uuid        not null constraint stock_decision_facility_exists
                                     references erp.facility (facility_id) on delete no action,
  -- When it happened — for a count, the moment counted. Stated by the person when late (D3),
  -- the clock when not; a reversal takes the moment of the decision it undoes.
  occurred_at          timestamptz not null,
  -- D3, for a warehouse or a factory: the calendar date of occurred_at in the facility's
  -- time zone, which 0019 fixes for good. Held by db-check's stock-ledger-matches-its-decisions.
  business_date        date        not null,
  -- Set on a reversal only, and a decision is reversed at most once (I-6). Named as the
  -- constraint the route raises, so a race past its check is refused under the same name.
  reverses_decision_id uuid        constraint stock_already_reversed unique,
  -- D1: present when the person overrode the refusal of negative stock, and why. Only a
  -- decision that would have been refused carries one.
  override_reason      text
    constraint stock_override_reason_is_stated check (length(btrim(override_reason)) > 0),
  reason               text        not null constraint stock_decision_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded. Each entry reaches its actor through its decision.
  actor_id             uuid        not null constraint stock_decision_actor_is_a_person
                                     references erp.person (person_id) on delete no action,
  decided_at           timestamptz not null,
  recorded_at          timestamptz not null default now(),
  -- Targets for the composite keys below: an entry, a count line and a balance stamp each
  -- name a decision about THEIR facility, at THEIR moment, of THEIR kind.
  constraint stock_decision_at_facility unique (decision_id, facility_id),
  constraint stock_decision_moment unique (decision_id, facility_id, occurred_at, business_date),
  constraint stock_decision_facts unique (decision_id, kind, facility_id, occurred_at, business_date),
  constraint stock_decision_reverses_iff_reversal check ((kind = 'reversal') = (reverses_decision_id is not null)),
  -- A reversal is at its target's facility and moment: it says the target never happened,
  -- so it belongs where the target was, and D3's count rule then refuses one a count has
  -- already covered (found in review: dated "now", it corrected the stock a second time).
  constraint stock_reversal_is_at_its_targets_moment foreign key (reverses_decision_id, facility_id, occurred_at, business_date)
    references erp.stock_decision (decision_id, facility_id, occurred_at, business_date)
);

comment on table erp.stock_decision is
  'Append-only record of every stock movement document at a facility (INV-006, INV-007, I-8): who, when it happened, why. Its lines are erp.stock_ledger entries, or erp.stock_count_log lines for a count.';
comment on column erp.stock_decision.override_reason is
  'D1: why stock was let go negative. Present only when the movement would otherwise have been refused.';

create index ix_stock_decision_facility on erp.stock_decision (facility_id, seq);

-- ---------------------------------------------------------------------------
-- The ledger (INV-006, INV-007; ledger-primitives) — append-only, one row per entry
-- ---------------------------------------------------------------------------

create table erp.stock_ledger (
  decision_id       uuid        not null,
  line_no           integer     not null constraint stock_ledger_line_no_is_positive check (line_no > 0),
  -- What a reversal names, and what a history read pages by.
  entry_id          bigint      generated always as identity constraint stock_ledger_entry_id_key unique,
  -- Copied from the decision, and bound to it by stock_entry_is_its_decisions, so a ledger
  -- query never joins for them and no entry can be placed, dated or kinded otherwise.
  kind              text        not null,
  facility_id       uuid        not null,
  occurred_at       timestamptz not null,
  business_date     date        not null,
  -- THE I-7 SEAM: the conversion the line was entered in, copied whole. A count's variance
  -- is in the item's base conversion, at factor 1.
  item_id           uuid        not null,
  item_unit_id      uuid        not null,
  unit_key          text        not null,
  factor            numeric     not null,
  direction         text        not null constraint stock_ledger_direction_is_known check (direction in ('in', 'out')),
  -- Positive, with a direction (ledger-primitives rule 3); six places, as a factor has.
  quantity          numeric     not null
    constraint stock_ledger_quantity_is_exact check (quantity > 0 and quantity = round(quantity, 6) and quantity < 1e12),
  -- The same, in the item's base unit: what the balance sums.
  base_quantity     numeric     not null
    constraint stock_ledger_base_is_exact check (base_quantity > 0 and base_quantity = round(base_quantity, 6) and base_quantity < 1e12),
  -- Set on a reversal's entries only: the entry each undoes, once.
  reverses_entry_id bigint      constraint stock_entry_already_reversed unique
                                  constraint stock_ledger_reverses_an_entry references erp.stock_ledger (entry_id),
  constraint stock_ledger_pkey primary key (decision_id, line_no),
  constraint stock_ledger_base_is_quantity_times_factor check (base_quantity = quantity * factor),
  constraint stock_ledger_reverses_iff_reversal check ((kind = 'reversal') = (reverses_entry_id is not null)),
  -- Waste, damage and expiry take stock out; nothing else is known by kind alone.
  constraint stock_ledger_write_off_is_outward check (kind not in ('waste', 'damage', 'expiry') or direction = 'out'),
  constraint stock_ledger_variance_is_in_base check (kind <> 'count' or factor = 1),
  constraint stock_entry_is_its_decisions foreign key (decision_id, kind, facility_id, occurred_at, business_date)
    references erp.stock_decision (decision_id, kind, facility_id, occurred_at, business_date),
  constraint stock_entry_names_a_conversion foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor)
);

comment on table erp.stock_ledger is
  'Every stock entry (INV-006, INV-007; docs/domain/ledger-primitives.md): a positive quantity, a direction, the conversion it was entered in (I-7) and its base quantity. Never updated or deleted; a reversal is a further entry naming the one it undoes.';

create index ix_stock_ledger_facility_item on erp.stock_ledger (facility_id, item_id, occurred_at);

-- ---------------------------------------------------------------------------
-- What a count found (INV-009) — append-only, one row per line counted
-- ---------------------------------------------------------------------------

-- Kept apart from the ledger because a count records what was found even where it matches
-- the book, and the ledger records only the difference. Full packs and loose pieces of one
-- item are two lines, summed in the base unit.
create table erp.stock_count_log (
  decision_id   uuid        not null,
  line_no       integer     not null constraint stock_count_log_line_no_is_positive check (line_no > 0),
  kind          text        not null constraint stock_count_log_is_a_count check (kind = 'count'),
  facility_id   uuid        not null,
  occurred_at   timestamptz not null,
  business_date date        not null,
  item_id       uuid        not null,
  item_unit_id  uuid        not null,
  unit_key      text        not null,
  factor        numeric     not null,
  -- Zero is a count: none found.
  quantity      numeric     not null
    constraint stock_count_log_quantity_is_exact check (quantity >= 0 and quantity = round(quantity, 6) and quantity < 1e12),
  base_quantity numeric     not null
    constraint stock_count_log_base_is_exact check (base_quantity >= 0 and base_quantity = round(base_quantity, 6) and base_quantity < 1e12),
  constraint stock_count_log_pkey primary key (decision_id, line_no),
  constraint stock_count_log_base_is_quantity_times_factor check (base_quantity = quantity * factor),
  constraint stock_count_line_is_its_decisions foreign key (decision_id, kind, facility_id, occurred_at, business_date)
    references erp.stock_decision (decision_id, kind, facility_id, occurred_at, business_date),
  constraint stock_count_line_names_a_conversion foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor)
);

comment on table erp.stock_count_log is
  'What each count found, line by line, in the conversion counted (INV-009). The ledger holds only the variance a count posted.';

create index ix_stock_count_log_facility_item on erp.stock_count_log (facility_id, item_id, occurred_at);

-- One trigger function for the three logs, in the words db-check's runtime probe reads.
create or replace function erp.stock_log_is_append_only()
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
          hint = 'Reverse the decision, or count again. What moved, and who said so, is not unmade by deleting the record of it.';
end;
$$;

create trigger stock_decision_append_only
  before update or delete or truncate on erp.stock_decision
  for each statement
  execute function erp.stock_log_is_append_only();

create trigger stock_ledger_append_only
  before update or delete or truncate on erp.stock_ledger
  for each statement
  execute function erp.stock_log_is_append_only();

create trigger stock_count_log_append_only
  before update or delete or truncate on erp.stock_count_log
  for each statement
  execute function erp.stock_log_is_append_only();

-- ---------------------------------------------------------------------------
-- The balance (I-8) — a projection of the ledger, per facility and item
-- ---------------------------------------------------------------------------

create table erp.stock_balance (
  facility_id       uuid        not null constraint stock_balance_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  item_id           uuid        not null constraint stock_balance_item_exists
                                  references erp.item (item_id) on delete no action,
  -- In the item's base unit. Below zero only by an override (D1), or by a count dated
  -- before movements that took out more than it found; shown either way, never clamped.
  on_hand           numeric     not null constraint stock_balance_on_hand_is_exact check (on_hand = round(on_hand, 6)),
  -- The latest count of the item here. Nothing is recorded at or before it (D3).
  last_counted_at   timestamptz,
  -- I-8. The single-column key is what db-check's projection-stamp-is-a-foreign-key-where-
  -- it-can-be finds; the composite one makes it impossible to stamp this balance with
  -- another facility's decision.
  as_of_decision_id uuid        not null constraint stock_balance_as_of_decision_id_fkey
                                  references erp.stock_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint stock_balance_pkey primary key (facility_id, item_id),
  constraint stock_balance_stamp_is_this_facilitys_decision foreign key (as_of_decision_id, facility_id)
    references erp.stock_decision (decision_id, facility_id)
);

comment on table erp.stock_balance is
  'Stock on hand per facility and item, in the item''s base unit: the sum of its ledger entries (I-8, db-check stock-balances-match-their-ledger). Written only by erp.post_stock(), under its key lock.';

-- Guard: the balance of one facility and item stays that, and is never deleted. It is
-- written only by erp.post_stock(); that is a rule of the code, held by db-check.
create or replace function erp.stock_balance_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a stock balance is never deleted: it is the sum of its ledger (I-8)'
      using errcode = 'restrict_violation', constraint = 'stock_balance_never_deleted';
  end if;
  if (new.facility_id, new.item_id) is distinct from (old.facility_id, old.item_id) then
    raise exception 'a stock balance stays the balance of its facility and item'
      using errcode = 'restrict_violation', constraint = 'stock_balance_fixed';
  end if;
  return new;
end;
$$;

create trigger stock_balance_is_fixed
  before update or delete on erp.stock_balance
  for each row
  execute function erp.stock_balance_is_fixed();

-- Row triggers do not fire for TRUNCATE.
create or replace function erp.stock_balances_are_never_truncated()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is never deleted: it is the sum of its ledger (I-8). TRUNCATE denied', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger stock_balance_never_truncated
  before truncate on erp.stock_balance
  for each statement
  execute function erp.stock_balances_are_never_truncated();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- A retried call carries the decision id it was first sent with: 0012's
-- assert_item_decision_is_new(), for this log. Every stock route calls it straight after
-- its gate, before any rule that a committed first attempt would itself now break (a count
-- is never dated at its own moment twice), so a retry always answers 23505 on
-- stock_decision_pkey. erp.post_stock() calls it again; taken twice in one transaction, the
-- lock is simply held.
create or replace function erp.assert_stock_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.stock_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.stock_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'stock_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.get_stock_decision() to confirm.';
  end if;
end;
$$;

-- Stock is held at a facility (D4). An organisation-wide person reaches every one, so a
-- route that left the facility out would otherwise read or post across all of them.
create or replace function erp.assert_stock_facility_named(p_facility_id uuid)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_facility_id is null or p_facility_id = erp.org_scope() then
    raise exception 'stock is held at a facility: choose one'
      using errcode = 'invalid_parameter_value', constraint = 'stock_facility_required';
  end if;
end;
$$;

-- THE BALANCE LOCK. One transaction-scoped advisory lock per facility and item, taken in
-- ascending key order. It covers a balance that does not exist yet, which a row lock
-- cannot: two first postings of the same items, listed in opposite orders, deadlocked on
-- each other's placeholder rows in the draft (found in review). Every writer of a balance
-- goes through erp.post_stock(), which takes it, so it serialises them all. A transaction
-- that posts at more than one facility — a later module's transfer — calls this once with
-- every key it will touch before its first erp.post_stock(); taken again there, a lock is
-- simply held, and one order across the whole transaction means no deadlock.
create or replace function erp.lock_stock(p_facility_ids uuid[], p_item_ids uuid[])
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_key bigint;
begin
  -- A loop, not one PERFORM over a sorted subquery: the order is the point.
  for v_key in
    select distinct hashtextextended('erp.stock_balance:' || x.facility_id::text || ':' || x.item_id::text, 0)
      from unnest(p_facility_ids, p_item_ids) as x(facility_id, item_id)
     order by 1
  loop
    perform pg_advisory_xact_lock(v_key);
  end loop;
end;
$$;

-- A moment as a person at the facility reads it.
create or replace function erp.stock_moment(p_at timestamptz, p_tz_name text)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select to_char(p_at at time zone p_tz_name, 'YYYY-MM-DD HH24:MI:SS');
$$;

-- ---------------------------------------------------------------------------
-- THE POSTING SEAM — owner-only; every stock route, in this module and later ones
-- ---------------------------------------------------------------------------

-- The one way a stock decision is written: its entries (or a count's lines), and the
-- balances they change, in one transaction, under the balance lock. Every route of this
-- module calls it after its own gate and erp.assert_stock_decision_is_new(); a later
-- module's receipt, issue or transfer posts through it too, so the rules below hold for
-- every movement there will ever be.
--
--   p_kind       'adjustment', 'waste', 'damage' or 'expiry' (lines carry a direction for an
--                adjustment, and are out for the rest); 'count' (lines are what was found);
--                'reversal' (no lines: the target's, mirrored).
--   p_occurred_at  when it happened, or NULL for now. Ignored for a reversal.
--   p_lines      a JSON array of {item_unit_id, quantity, direction?}; quantity is a decimal,
--                as text or a number, at most six places.
--   p_override_reason  D1: the person's reason for letting stock go negative, or NULL.
--
-- THE ORDER, and why:
--   1. the retry check, first;
--   2. the facility: named, open (its share lock, so a closure waits), and a warehouse or a
--      factory — D3 decides a business day for those alone;
--   3. the lines: each conversion found through the facility's brand, so another brand's
--      answers as a missing one before any other rule could reveal it exists (ADR-0012);
--      or, for a reversal, the target's entries, under the target's lock;
--   4. the balance locks, in key order;
--   5. "now" — the clock once the locks are held, not the transaction's start: a movement
--      that waited behind a count would otherwise be dated before it (0018's finding);
--   6. every rule that reads the balance: never at or before a count (D3); a count never
--      shares a moment with a movement; never negative without an override (D1);
--   7. the writes: the decision, with its override already known, then its entries or
--      count lines, then the balances, stamped with it. Nothing is written before the
--      decision exists, so a balance's stamp always names a real decision.
--
-- It never judges whether an item or a conversion is active. Correcting the book about
-- stock already held acquires nothing: 0012's seam is for new work — a PO line, an order
-- line, a production output — and the later route that creates such work calls
-- erp.assert_item_active() before it posts (found in review: a mistaken write-off of a
-- since-retired pack could not otherwise be reversed).
create or replace function erp.post_stock(
  p_decision_id     uuid,
  p_kind            text,
  p_facility_id     uuid,
  p_occurred_at     timestamptz,
  p_lines           jsonb,
  p_reverses        uuid,
  p_reason          text,
  p_override_reason text,
  p_actor_id        uuid,
  p_decided_at      timestamptz
)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  f          erp.facility;
  t          erp.stock_decision;
  v_brand    uuid;
  v_line     jsonb;
  v_no       integer := 0;
  v_unit     uuid;
  u          record;
  v_qty_text text;
  v_qty      numeric;
  v_base     numeric;
  v_dir      text;
  -- One element per line, in line order.
  l_unit     uuid[]    := '{}';
  l_item     uuid[]    := '{}';
  l_key      text[]    := '{}';
  l_factor   numeric[] := '{}';
  l_dir      text[]    := '{}';
  l_qty      numeric[] := '{}';
  l_base     numeric[] := '{}';
  l_rev      bigint[]  := '{}';
  -- One element per item counted, in item_id order.
  c_item     uuid[];
  c_variance numeric[];
  c_on_hand  numeric[];
  v_clock    timestamptz;
  v_at       timestamptz;
  v_date     date;
  v_bad      record;
  v_override text;
begin
  -- 1. A retry is answered as one before anything is read.
  perform erp.assert_stock_decision_is_new(p_decision_id);

  -- 2. The facility.
  perform erp.assert_stock_facility_named(p_facility_id);
  f := erp.assert_facility_open(p_facility_id);
  if f.facility_type = 'branch' then
    raise exception 'branch % holds no stock record yet: a branch''s business day opens with its shift, and is still to be decided (Q-06)', f.code
      using errcode = 'restrict_violation', constraint = 'stock_branch_business_day_undecided',
            hint = 'Warehouse and factory stock is recorded now. Branch stock follows once a branch''s business day is decided.';
  elsif f.facility_type not in ('warehouse', 'factory') then
    raise exception 'facility % is an %, and holds no stock', f.code, f.facility_type
      using errcode = 'restrict_violation', constraint = 'stock_facility_holds_no_stock';
  end if;

  if p_kind is null or p_kind not in ('count', 'adjustment', 'waste', 'damage', 'expiry', 'reversal') then
    raise exception 'a stock decision is a count, an adjustment, a waste, a damage, an expiry or a reversal'
      using errcode = 'check_violation', constraint = 'stock_decision_kind_is_known';
  end if;
  if (p_kind = 'reversal') <> (p_reverses is not null) then
    raise exception 'a reversal names the decision it reverses, and no other kind does'
      using errcode = 'check_violation', constraint = 'stock_decision_reverses_iff_reversal';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a stock decision states why it was made'
      using errcode = 'check_violation', constraint = 'stock_decision_reason_is_stated';
  end if;
  if p_override_reason is not null and length(btrim(p_override_reason)) = 0 then
    raise exception 'an override of negative stock states why'
      using errcode = 'check_violation', constraint = 'stock_override_reason_is_stated';
  end if;

  -- 3. The lines.
  if p_kind = 'reversal' then
    if p_lines is not null then
      raise exception 'a reversal takes its lines from the decision it reverses'
        using errcode = 'check_violation', constraint = 'stock_lines_are_stated';
    end if;
    -- Two reversals of one decision serialise here, so the second sees the first and is
    -- refused by name, not by the unique key's own words (found in review).
    perform pg_advisory_xact_lock(hashtextextended('erp.stock_reversal:' || p_reverses::text, 0));
    -- A decision at another facility answers exactly as a missing one.
    select * into t from erp.stock_decision d where d.decision_id = p_reverses and d.facility_id = f.facility_id;
    if not found then
      raise exception 'no stock decision % at %', p_reverses, f.code
        using errcode = 'no_data_found', constraint = 'stock_decision_exists';
    end if;
    if t.kind not in ('adjustment', 'waste', 'damage', 'expiry') then
      raise exception 'a % is not reversed', t.kind
        using errcode = 'restrict_violation', constraint = 'stock_decision_is_not_reversible',
              hint = case t.kind when 'count' then 'A count is corrected by counting again.'
                                 else 'A reversal is final. Record an adjustment instead.' end;
    end if;
    if exists (select 1 from erp.stock_decision d where d.reverses_decision_id = t.decision_id) then
      raise exception 'stock decision % is already reversed', t.decision_id
        using errcode = 'unique_violation', constraint = 'stock_already_reversed';
    end if;
    -- The target's entries, mirrored, copied whole: the conversion each named, retired or
    -- not, and the quantity it moved. Never re-resolved and never re-judged (I-7).
    select array_agg(e.item_unit_id order by e.line_no), array_agg(e.item_id order by e.line_no),
           array_agg(e.unit_key order by e.line_no), array_agg(e.factor order by e.line_no),
           array_agg(case e.direction when 'in' then 'out' else 'in' end order by e.line_no),
           array_agg(e.quantity order by e.line_no), array_agg(e.base_quantity order by e.line_no),
           array_agg(e.entry_id order by e.line_no)
      into l_unit, l_item, l_key, l_factor, l_dir, l_qty, l_base, l_rev
      from erp.stock_ledger e where e.decision_id = t.decision_id;
  else
    if p_lines is null or jsonb_typeof(p_lines) <> 'array'
       or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
      raise exception 'a stock decision has 1 to 500 lines'
        using errcode = 'check_violation', constraint = 'stock_lines_are_stated';
    end if;
    select ou.brand_id into v_brand from erp.operating_unit ou where ou.operating_unit_id = f.operating_unit_id;
    for v_line in select x.value from jsonb_array_elements(p_lines) as x loop
      v_no := v_no + 1;
      if jsonb_typeof(v_line) <> 'object'
         or coalesce(v_line ->> 'item_unit_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'line %: a line names the conversion it is in, by its id', v_no
          using errcode = 'check_violation', constraint = 'stock_lines_are_stated';
      end if;
      v_unit := (v_line ->> 'item_unit_id')::uuid;
      -- The brand fence comes first: 0012's own words for a conversion that does not exist.
      select x.item_unit_id, x.item_id, x.unit_key, x.factor into u
        from erp.item_unit x
        join erp.item i on i.item_id = x.item_id
       where x.item_unit_id = v_unit and i.brand_id = v_brand;
      if not found then
        raise exception 'no conversion %', v_unit using errcode = 'no_data_found', constraint = 'item_unit_exists';
      end if;
      if u.item_unit_id = any (l_unit) then
        raise exception 'line %: that conversion is already on line %', v_no, array_position(l_unit, u.item_unit_id)
          using errcode = 'check_violation', constraint = 'stock_line_repeats',
                hint = 'One line per pack of an item: add the quantities together.';
      end if;
      v_qty_text := v_line ->> 'quantity';
      if coalesce(jsonb_typeof(v_line -> 'quantity'), '') not in ('string', 'number')
         or v_qty_text !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
        raise exception 'line %: a quantity is a number with up to twelve digits and six decimal places', v_no
          using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
      end if;
      v_qty := trim_scale(v_qty_text::numeric);
      if v_qty = 0 and p_kind <> 'count' then
        raise exception 'line %: a quantity moved is more than nothing', v_no
          using errcode = 'check_violation', constraint = 'stock_quantity_is_valid',
                hint = 'A count may find none. Nothing else moves none.';
      end if;
      v_base := v_qty * u.factor;
      if v_base <> round(v_base, 6) then
        raise exception 'line %: % % is % in the base unit, past six decimal places', v_no, v_qty, u.unit_key, v_base
          using errcode = 'check_violation', constraint = 'stock_quantity_inexact',
                hint = 'Enter it in a larger unit, or in the base unit.';
      end if;
      v_base := trim_scale(v_base);
      if v_base >= 1e12 then
        raise exception 'line %: % % is more than any store holds', v_no, v_qty, u.unit_key
          using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
      end if;
      v_dir := v_line ->> 'direction';
      if p_kind = 'adjustment' then
        if v_dir is null or v_dir not in ('in', 'out') then
          raise exception 'line %: an adjustment line is in or out', v_no
            using errcode = 'check_violation', constraint = 'stock_direction_is_known';
        end if;
      elsif p_kind = 'count' then
        if v_dir is not null then
          raise exception 'line %: a count line is what was found, and has no direction', v_no
            using errcode = 'check_violation', constraint = 'stock_direction_is_known';
        end if;
      elsif coalesce(v_dir, 'out') <> 'out' then
        raise exception 'line %: a % takes stock out', v_no, p_kind
          using errcode = 'check_violation', constraint = 'stock_direction_is_known';
      else
        v_dir := 'out';
      end if;
      l_unit := array_append(l_unit, u.item_unit_id);
      l_item := array_append(l_item, u.item_id);
      l_key := array_append(l_key, u.unit_key::text);
      l_factor := array_append(l_factor, u.factor);
      l_dir := array_append(l_dir, v_dir);
      l_qty := array_append(l_qty, v_qty);
      l_base := array_append(l_base, v_base);
      l_rev := array_append(l_rev, null::bigint);
    end loop;
  end if;

  -- 4. The balance locks.
  perform erp.lock_stock(array_fill(f.facility_id, array[cardinality(l_item)]), l_item);

  -- 5. The moment. Every statement from here reads what the previous holder of a lock
  -- committed: plpgsql takes a fresh snapshot per statement in READ COMMITTED.
  v_clock := greatest(clock_timestamp(), p_decided_at);
  if p_kind = 'reversal' then
    v_at := t.occurred_at;
  else
    v_at := coalesce(p_occurred_at, v_clock);
    if v_at > v_clock then
      raise exception 'stock is recorded once it has moved, not before'
        using errcode = 'check_violation', constraint = 'stock_not_in_future';
    end if;
  end if;
  v_date := (v_at at time zone f.tz_name)::date;

  -- 6. The rules that read the balance.
  -- D3: nothing at or before an item's last count. For a reversal, that is a count since
  -- the decision it undoes: the count already corrected it.
  select i.code, b.last_counted_at into v_bad
    from erp.stock_balance b
    join erp.item i on i.item_id = b.item_id
   where b.facility_id = f.facility_id and b.item_id = any (l_item) and b.last_counted_at >= v_at
   order by i.code collate "C"
   limit 1;
  if found then
    if p_kind = 'reversal' then
      raise exception '% was counted at % since the decision being reversed, and the count already corrected it',
        v_bad.code, erp.stock_moment(v_bad.last_counted_at, f.tz_name)
        using errcode = 'restrict_violation', constraint = 'stock_reversal_counted_since',
              hint = 'Count it again, or record an adjustment, to change it now.';
    elsif v_bad.last_counted_at = v_at then
      raise exception '% was counted at exactly %: say whether this was before or after the count',
        v_bad.code, erp.stock_moment(v_at, f.tz_name)
        using errcode = 'restrict_violation', constraint = 'stock_backdated_before_count',
              hint = 'If it happened before the count, the count already includes it. If after, state a later moment.';
    else
      raise exception '% was counted at %, after %: nothing is recorded before an item''s last count (D3)',
        v_bad.code, erp.stock_moment(v_bad.last_counted_at, f.tz_name), erp.stock_moment(v_at, f.tz_name)
        using errcode = 'restrict_violation', constraint = 'stock_backdated_before_count',
              hint = 'The count already includes what happened before it. State a later moment, or count again.';
    end if;
  end if;

  if p_kind = 'count' then
    -- A count and a movement of one item never share a moment. Recorded after a count, a
    -- movement at its moment is refused above; this is the other order. Otherwise a
    -- movement stated to the minute of a count it physically followed was taken as
    -- before it, and counted twice (found in review).
    select i.code, e.decision_id into v_bad
      from erp.stock_ledger e
      join erp.item i on i.item_id = e.item_id
     where e.facility_id = f.facility_id and e.item_id = any (l_item) and e.occurred_at = v_at and e.kind <> 'count'
     order by i.code collate "C"
     limit 1;
    if found then
      raise exception 'a movement of % is recorded at exactly % (decision %): say whether the count was before or after it',
        v_bad.code, erp.stock_moment(v_at, f.tz_name), v_bad.decision_id
        using errcode = 'restrict_violation', constraint = 'stock_count_moment_taken',
              hint = 'If you counted before it, state the count a minute earlier; if after, a minute later.';
    end if;

    -- The variance per item: what was found, less the book AS AT the moment counted — the
    -- balance now, less every entry dated after that moment.
    select array_agg(k.item_id order by k.item_id),
           array_agg(k.counted - (k.on_hand - k.later) order by k.item_id),
           array_agg(k.on_hand order by k.item_id),
           max(k.counted)
      into c_item, c_variance, c_on_hand, v_base
      from (select c.item_id, c.counted, coalesce(b.on_hand, 0) as on_hand,
                   coalesce((select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end)
                               from erp.stock_ledger e
                              where e.facility_id = f.facility_id and e.item_id = c.item_id and e.occurred_at > v_at), 0) as later
              from (select x.item_id, sum(x.base) as counted
                      from unnest(l_item, l_base) as x(item_id, base) group by x.item_id) c
              left join erp.stock_balance b on b.facility_id = f.facility_id and b.item_id = c.item_id) k;
    if v_base >= 1e12 then
      raise exception 'the lines of one item add up to more than any store holds'
        using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
    end if;
  else
    -- D1: an item this takes out of, left below nothing. A count records a fact and is
    -- never refused for one; what goes in never needs an override.
    select i.code, i.base_unit_key, coalesce(b.on_hand, 0) as on_hand, d.delta into v_bad
      from (select x.item_id, sum(case x.dir when 'in' then x.base else -x.base end) as delta
              from unnest(l_item, l_dir, l_base) as x(item_id, dir, base) group by x.item_id) d
      join erp.item i on i.item_id = d.item_id
      left join erp.stock_balance b on b.facility_id = f.facility_id and b.item_id = d.item_id
     where d.delta < 0 and coalesce(b.on_hand, 0) + d.delta < 0
     order by i.code collate "C"
     limit 1;
    if found then
      if p_override_reason is null then
        raise exception '% has % % on hand; this takes out %, which would leave %',
          v_bad.code, trim_scale(v_bad.on_hand), v_bad.base_unit_key, trim_scale(-v_bad.delta), trim_scale(v_bad.on_hand + v_bad.delta)
          using errcode = 'restrict_violation', constraint = 'stock_would_go_negative',
                hint = 'Look for a receipt not yet recorded, or a miscount. A person allowed to override may record it with a reason; it then shows negative until a count.';
      end if;
      perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'approve', f.facility_id);
      v_override := p_override_reason;
    end if;
  end if;

  -- 7. The writes.
  insert into erp.stock_decision (
    decision_id, kind, facility_id, occurred_at, business_date, reverses_decision_id, override_reason,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, f.facility_id, v_at, v_date, p_reverses, v_override, p_reason, p_actor_id, p_decided_at
  );

  if p_kind = 'count' then
    insert into erp.stock_count_log (
      decision_id, line_no, kind, facility_id, occurred_at, business_date,
      item_id, item_unit_id, unit_key, factor, quantity, base_quantity
    )
    select p_decision_id, x.n, 'count', f.facility_id, v_at, v_date, x.item_id, x.unit, x.key, x.factor, x.qty, x.base
      from unnest(l_item, l_unit, l_key, l_factor, l_qty, l_base)
           with ordinality as x(item_id, unit, key, factor, qty, base, n);

    -- The variance, in each item's base conversion.
    insert into erp.stock_ledger (
      decision_id, line_no, kind, facility_id, occurred_at, business_date,
      item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity
    )
    select p_decision_id, row_number() over (order by i.code collate "C"), 'count', f.facility_id, v_at, v_date,
           v.item_id, bu.item_unit_id, bu.unit_key, bu.factor,
           case when v.variance > 0 then 'in' else 'out' end, trim_scale(abs(v.variance)), trim_scale(abs(v.variance))
      from unnest(c_item, c_variance) as v(item_id, variance)
      join erp.item i on i.item_id = v.item_id
      join erp.item_unit bu on bu.item_id = i.item_id and bu.unit_key = i.base_unit_key and bu.factor = 1 and bu.status = 'active'
     where v.variance <> 0;

    insert into erp.stock_balance (facility_id, item_id, on_hand, last_counted_at, as_of_decision_id)
    select f.facility_id, v.item_id, trim_scale(v.on_hand + v.variance), v_at, p_decision_id
      from unnest(c_item, c_variance, c_on_hand) as v(item_id, variance, on_hand)
     order by v.item_id
    on conflict (facility_id, item_id) do update
      set on_hand = excluded.on_hand,
          last_counted_at = excluded.last_counted_at,
          as_of_decision_id = excluded.as_of_decision_id,
          updated_at = now();
  else
    insert into erp.stock_ledger (
      decision_id, line_no, kind, facility_id, occurred_at, business_date,
      item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity, reverses_entry_id
    )
    select p_decision_id, x.n, p_kind, f.facility_id, v_at, v_date,
           x.item_id, x.unit, x.key, x.factor, x.dir, x.qty, x.base, x.rev
      from unnest(l_item, l_unit, l_key, l_factor, l_dir, l_qty, l_base, l_rev)
           with ordinality as x(item_id, unit, key, factor, dir, qty, base, rev, n);

    insert into erp.stock_balance (facility_id, item_id, on_hand, as_of_decision_id)
    select f.facility_id, d.item_id, trim_scale(d.delta), p_decision_id
      from (select x.item_id, sum(case x.dir when 'in' then x.base else -x.base end) as delta
              from unnest(l_item, l_dir, l_base) as x(item_id, dir, base) group by x.item_id) d
     order by d.item_id
    on conflict (facility_id, item_id) do update
      set on_hand = trim_scale(erp.stock_balance.on_hand + excluded.on_hand),
          as_of_decision_id = excluded.as_of_decision_id,
          updated_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- The first routes whose writes are scoped to a facility: stock is held at one, so a
-- factory manager assigned to the factory writes there and nowhere else (IAM-006). Each
-- asks permission there, then answers a retry, then posts.

-- An adjustment (lines in or out), or a write-off: waste, damage or expiry (lines out).
create or replace function erp.record_stock_adjustment(
  p_decision_id     uuid,
  p_facility_id     uuid,
  p_kind            text,
  p_occurred_at     timestamptz,
  p_lines           jsonb,
  p_reason          text,
  p_override_reason text,
  p_actor_id        uuid,
  p_decided_at      timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id);
  perform erp.assert_stock_decision_is_new(p_decision_id);
  if p_kind is null or p_kind not in ('adjustment', 'waste', 'damage', 'expiry') then
    raise exception 'this records an adjustment, a waste, a damage or an expiry'
      using errcode = 'check_violation', constraint = 'stock_decision_kind_is_known';
  end if;
  perform erp.post_stock(p_decision_id, p_kind, p_facility_id, p_occurred_at, p_lines, null,
                         p_reason, p_override_reason, p_actor_id, p_decided_at);
end;
$$;

-- What was found, at a moment: NULL for now, or the moment counted, stated when the count
-- is entered later (D3). A partial count changes only the items it lists.
create or replace function erp.record_stock_count(
  p_decision_id uuid,
  p_facility_id uuid,
  p_counted_at  timestamptz,
  p_lines       jsonb,
  p_reason      text,
  p_actor_id    uuid,
  p_decided_at  timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id);
  perform erp.assert_stock_decision_is_new(p_decision_id);
  perform erp.post_stock(p_decision_id, 'count', p_facility_id, p_counted_at, p_lines, null,
                         p_reason, null, p_actor_id, p_decided_at);
end;
$$;

-- Undoes an adjustment or a write-off recorded by mistake, whole, once, before any count
-- has covered it. Named with its facility, so the permission asked is the one where it
-- happened; a decision at another facility answers as a missing one.
create or replace function erp.reverse_stock_decision(
  p_decision_id        uuid,
  p_facility_id        uuid,
  p_target_decision_id uuid,
  p_reason             text,
  p_override_reason    text,
  p_actor_id           uuid,
  p_decided_at         timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id);
  perform erp.assert_stock_decision_is_new(p_decision_id);
  if p_target_decision_id is null then
    raise exception 'name the stock decision to reverse'
      using errcode = 'no_data_found', constraint = 'stock_decision_exists';
  end if;
  perform erp.post_stock(p_decision_id, 'reversal', p_facility_id, null, null, p_target_decision_id,
                         p_reason, p_override_reason, p_actor_id, p_decided_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads — the runtime's only view of stock (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- Stock names items, so every read asks read on BOTH capabilities, as 0018's do. It is
-- always for ONE facility: stock is held at one, and an organisation-wide person reading
-- with no facility would otherwise get every facility's rows mixed, with no facility to
-- tell them apart (found in review). The facility's brand stays a second fence (ADR-0012).
-- Quantities and factors inside JSON are text: a JSON number is a float to the edge.

-- What each item stands at here, by item code, paged.
create or replace function erp.stock_on_hand(
  p_actor_id      uuid,
  p_facility_id   uuid,
  p_search        text    default null,
  p_after_code    text    default null,
  p_limit         integer default 100,
  p_negative_only boolean default false
)
returns table (
  item_id uuid, code text, item_kind text, base_unit_key text, name_en text, name_ar text, item_status text,
  on_hand numeric, last_counted_at timestamptz, as_of_decision_id uuid, units jsonb
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
         b.on_hand, b.last_counted_at, b.as_of_decision_id,
         (select jsonb_agg(jsonb_build_object(
                   'item_unit_id', u.item_unit_id, 'unit_key', u.unit_key, 'factor', trim_scale(u.factor)::text,
                   'status', u.status)
                 order by u.status, u.factor, u.unit_key, u.item_unit_id)
            from erp.item_unit u where u.item_id = i.item_id)
  from erp.stock_balance b
  join erp.item i on i.item_id = b.item_id
  where b.facility_id = p_facility_id
    and i.brand_id = v_brand
    and (not coalesce(p_negative_only, false) or b.on_hand < 0)
    and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
    and (v_search is null
         or starts_with(i.code, erp.normalise_item_code(v_search))
         or strpos(lower(i.name_en), lower(v_search)) > 0
         or strpos(i.name_ar, v_search) > 0)
  order by i.code collate "C"
  limit p_limit;
end;
$$;

-- An item's stock card here: every decision that touched it, newest first, with what it
-- moved in the base unit, or what a count found. Paged by seq.
create or replace function erp.stock_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_item_id     uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, occurred_at timestamptz, business_date date,
  quantity_in numeric, quantity_out numeric, counted numeric,
  reason text, override_reason text, actor_id uuid, decided_at timestamptz, recorded_at timestamptz,
  reverses_decision_id uuid, reversed_by_decision_id uuid
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
  with moved as (
    select e.decision_id,
           coalesce(sum(e.base_quantity) filter (where e.direction = 'in'), 0) as q_in,
           coalesce(sum(e.base_quantity) filter (where e.direction = 'out'), 0) as q_out
      from erp.stock_ledger e
     where e.facility_id = p_facility_id and e.item_id = p_item_id
     group by e.decision_id
  ),
  counts as (
    select c.decision_id, sum(c.base_quantity) as counted
      from erp.stock_count_log c
     where c.facility_id = p_facility_id and c.item_id = p_item_id
     group by c.decision_id
  )
  select d.decision_id, d.seq, d.kind, d.occurred_at, d.business_date,
         coalesce(m.q_in, 0), coalesce(m.q_out, 0), k.counted,
         d.reason, d.override_reason, d.actor_id, d.decided_at, d.recorded_at,
         d.reverses_decision_id, r.decision_id
    from erp.stock_decision d
    left join moved m on m.decision_id = d.decision_id
    left join counts k on k.decision_id = d.decision_id
    left join erp.stock_decision r on r.reverses_decision_id = d.decision_id
   where d.facility_id = p_facility_id
     and (m.decision_id is not null or k.decision_id is not null)
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- One decision, whole: its entries, what a count found, and its reversal if it has one.
-- The read the edge makes to confirm a retried write. A decision at another facility
-- answers exactly as a missing one, so not even an error says another facility's exists.
create or replace function erp.get_stock_decision(p_actor_id uuid, p_facility_id uuid, p_decision_id uuid)
returns table (
  decision_id uuid, seq bigint, kind text, facility_id uuid, occurred_at timestamptz, business_date date,
  reverses_decision_id uuid, reversed_by_decision_id uuid, override_reason text, reason text, actor_id uuid,
  decided_at timestamptz, recorded_at timestamptz, entries jsonb, counted jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);

  return query
  select d.decision_id, d.seq, d.kind, d.facility_id, d.occurred_at, d.business_date,
         d.reverses_decision_id, r.decision_id, d.override_reason, d.reason, d.actor_id,
         d.decided_at, d.recorded_at,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'entry_id', e.entry_id, 'line_no', e.line_no, 'item_id', e.item_id, 'code', i.code,
                   'item_unit_id', e.item_unit_id, 'unit_key', e.unit_key, 'factor', trim_scale(e.factor)::text,
                   'direction', e.direction, 'quantity', trim_scale(e.quantity)::text,
                   'base_quantity', trim_scale(e.base_quantity)::text, 'reverses_entry_id', e.reverses_entry_id)
                 order by e.line_no), '[]'::jsonb)
            from erp.stock_ledger e join erp.item i on i.item_id = e.item_id
           where e.decision_id = d.decision_id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'line_no', c.line_no, 'item_id', c.item_id, 'code', i.code,
                   'item_unit_id', c.item_unit_id, 'unit_key', c.unit_key, 'factor', trim_scale(c.factor)::text,
                   'quantity', trim_scale(c.quantity)::text, 'base_quantity', trim_scale(c.base_quantity)::text)
                 order by c.line_no), '[]'::jsonb)
            from erp.stock_count_log c join erp.item i on i.item_id = c.item_id
           where c.decision_id = d.decision_id)
    from erp.stock_decision d
    left join erp.stock_decision r on r.reverses_decision_id = d.decision_id
   where d.decision_id = p_decision_id and d.facility_id = p_facility_id;
  if not found then
    raise exception 'no stock decision %', p_decision_id
      using errcode = 'no_data_found', constraint = 'stock_decision_exists';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

-- As 0012, 0016, 0018 and 0019: in the migration, because a real database needs it; no
-- decision, so HIDDEN everywhere until a later migration promotes it. Until now only the
-- synthetic seed knew this capability (0012's header), which now registers nothing for it
-- and keeps only its decision.
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('inventory.stock', 'Stock and movements', 'المخزون والحركات',
   array['INV-003', 'INV-006', 'INV-007', 'INV-008', 'INV-009', 'MFG-012', 'PRG-014'], false,
   timestamptz '2026-10-05 00:00:00+00');

-- A real database's only role is the administrator (0011). 'approve' is the override of
-- negative stock (D1): it follows the role's scope, so a grant at one facility overrides
-- there alone. Who else holds what is the seed's business (0035), as for every module.
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'inventory.stock', 'read'),
  ('administrator', 'inventory.stock', 'write'),
  ('administrator', 'inventory.stock', 'approve');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the four tables: writes only through the three routes,
-- reads only through the three gated functions. No EXECUTE on the posting seam, the lock
-- or the helpers: a later module calls them from its own definer route.
grant execute on function
  erp.record_stock_adjustment(uuid, uuid, text, timestamptz, jsonb, text, text, uuid, timestamptz),
  erp.record_stock_count(uuid, uuid, timestamptz, jsonb, text, uuid, timestamptz),
  erp.reverse_stock_decision(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.stock_on_hand(uuid, uuid, text, text, integer, boolean),
  erp.stock_history(uuid, uuid, uuid, bigint, integer),
  erp.get_stock_decision(uuid, uuid, uuid)
to erp_app;

-- erp_read keeps 0002's default SELECT on all four tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
do $$
declare
  t text;
begin
  foreach t in array array['stock_decision', 'stock_ledger', 'stock_count_log', 'stock_balance'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;
