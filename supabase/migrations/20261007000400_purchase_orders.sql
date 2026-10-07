-- 0023 · Purchase orders and receipts — what is ordered from a supplier, for one warehouse or
-- factory, who approved it, and what has arrived
--
-- Requirements: PRC-001 · PRC-002 · PRC-004 · PRC-006 · INV-006 · INV-007 · INV-P04 · PRC-P01 · PRC-P02
--               MFG-012 · CAP-P02 · CAP-P04 · PRG-014
-- ADR-0005 · ADR-0012 · ADR-0024 · ADR-0026 · ADR-0029 · ADR-0032 (proposed) · invariants I-6, I-7, I-8
--
-- Phase 4, module 8. The warehouse kept two families of purchase order — warehouse items and
-- raw materials, one per destination — in four tables whose lines cascaded from their header,
-- priced in numeric(12,2) with an implicit currency, approved by the general manager above a
-- limit compared INCLUDING a VAT the buyer could edit, with no approver recorded on an
-- auto-approval and nothing stopping an administrator approving their own order. Receiving
-- added to a counter, could not be undone, and was dated now(). Written fresh here through
-- the process mapping MFG-012 requires (docs/estate/process-mapping-purchase-orders.md).
--
-- The owner's decisions of 2026-10-07 (ADR-0032):
--   P1  ONE purchase order, for ONE receiving warehouse or factory, from one supplier; its
--       lines are packs of any item kind that supplier supplies (ADR-0026). Who may raise one
--       is a permission at that facility.
--   P2  a price per pack, in halalas (SAR), typed by the buyer, and one VAT rate per order: a
--       COMMITMENT, nothing more. Nothing here matches an invoice, pays, posts a journal or
--       values stock — modules 21 and 22, frozen (CLAUDE.md §6), and costing (16) do.
--   P3  approval by someone holding approve at the facility, above a limit set per facility
--       and compared EXCLUDING VAT; at or below it, approved when raised, recorded as approved
--       by the limit in force. Nobody approves, or rejects, an order they raised (PRC-004).
--       One level; PRC-003's chain stays F3.
--   P4  a receipt is reversed as stock is: whole, once, with a reason, refused once a count
--       has covered it (ADR-0029 §5). The stock goes back out and the order's lines reopen.
--
-- A RECEIPT IS A STOCK DECISION. 0020 built erp.post_stock() as the one seam every movement
-- goes through, and named the receipt as a kind to come (I-10): it is added here, inward
-- only, and posted through the seam, so D1 to D4 hold for it unchanged — the facility's
-- calendar date, never at or before a count, the balance lock. The order knows what arrived
-- through a table of receipt lines bound by key to the ledger lines they posted; what has
-- been received is never a counter, it is the sum of the receipts not reversed, so a
-- reversal reopens the order by being recorded, and nothing can drift.
--
-- The module ships HIDDEN, as every module's does.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The approval limit (P3) — a decision log and its projection, per facility
-- ---------------------------------------------------------------------------

create table erp.purchase_limit_decision (
  -- UUIDv7, minted by the console (I-1, ADR-0005): the idempotency key.
  decision_id  uuid        primary key,
  seq          bigint      generated always as identity constraint purchase_limit_decision_seq_key unique,
  kind         text        not null
    constraint purchase_limit_decision_kind_is_known check (kind in ('limit_set', 'limit_cleared')),
  facility_id  uuid        not null constraint purchase_limit_decision_facility_exists
                             references erp.facility (facility_id) on delete no action,
  -- An order at or below this, before VAT, is approved when raised. More than nothing: a
  -- limit of 0 would approve only orders of nothing, which is "no limit" said unclearly. To
  -- have none, so that every order waits for an approver, clear it. Empty when cleared.
  limit_minor  bigint
    constraint purchase_limit_is_minor_units check (limit_minor between 1 and 10000000000000),
  currency     text
    constraint purchase_limit_currency_is_known check (currency = 'SAR'),
  reason       text        not null constraint purchase_limit_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id     uuid        not null constraint purchase_limit_decision_actor_is_a_person
                             references erp.person (person_id) on delete no action,
  decided_at   timestamptz not null,
  recorded_at  timestamptz not null default now(),
  constraint purchase_limit_decision_shape check (
    case kind when 'limit_set' then limit_minor is not null and currency is not null
              else limit_minor is null and currency is null end),
  -- The target for the projection's stamp, and for an order approved by this limit: a limit
  -- names a decision about ITS facility.
  constraint purchase_limit_decision_at_facility unique (decision_id, facility_id)
);

comment on table erp.purchase_limit_decision is
  'Append-only record of every approval limit set or cleared at a facility (PRC-002, ADR-0032 P3): who, when, why. An order at or below the limit in force, before VAT, is approved when raised.';

create index ix_purchase_limit_decision_facility on erp.purchase_limit_decision (facility_id, seq);

create table erp.purchase_limit (
  facility_id       uuid        primary key constraint purchase_limit_facility_exists
                                  references erp.facility (facility_id) on delete no action,
  -- Empty once cleared; the row stays, so its stamp still names the decision that cleared it.
  limit_minor       bigint      constraint purchase_limit_projection_is_minor_units check (limit_minor > 0),
  currency          text,
  as_of_decision_id uuid        not null constraint purchase_limit_as_of_decision_id_fkey
                                  references erp.purchase_limit_decision (decision_id),
  updated_at        timestamptz not null default now(),
  constraint purchase_limit_stamp_is_its_decision foreign key (as_of_decision_id, facility_id)
    references erp.purchase_limit_decision (decision_id, facility_id)
);

comment on table erp.purchase_limit is
  'The approval limit in force per facility, in halalas before VAT: the latest erp.purchase_limit_decision about it (I-8, db-check purchase-limits-match-their-decisions). No row, or an empty one, means every order waits for an approver.';

-- ---------------------------------------------------------------------------
-- The order's decisions (PRC-001, IAM-008) — append-only, one row per decision
-- ---------------------------------------------------------------------------

create table erp.purchase_order_decision (
  decision_id        uuid        primary key,
  seq                bigint      generated always as identity constraint purchase_order_decision_seq_key unique,
  kind               text        not null
    constraint purchase_order_decision_kind_is_known
    check (kind in ('order_raised', 'order_approved', 'order_rejected', 'order_cancelled', 'order_closed')),
  purchase_order_id  uuid        not null,
  facility_id        uuid        not null constraint purchase_order_decision_facility_exists
                                   references erp.facility (facility_id) on delete no action,
  -- The state the decision puts in force. Raised, an order is pending, or approved by the
  -- limit in force (P3); every other kind names one state.
  state              text        not null
    constraint purchase_order_state_is_known check (state in ('pending', 'approved', 'rejected', 'cancelled', 'closed')),
  -- On a raise approved by the limit: the limit decision in force, at the same facility.
  limit_decision_id  uuid,
  -- THE ORDER AS RAISED, on the raise alone: what it is, whole, as the log records every
  -- master here. The projection copies it; its lines are erp.purchase_order_line, written
  -- once with it.
  supplier_id        uuid        constraint purchase_order_decision_supplier_exists
                                   references erp.supplier (supplier_id) on delete no action,
  number             text,
  business_date      date,
  day_seq            integer,
  currency           text        constraint purchase_order_currency_is_known check (currency = 'SAR'),
  -- Basis points: 1500 is 15%. One rate per order, as the warehouse kept it.
  vat_rate_bp        integer     constraint purchase_order_vat_rate_is_known check (vat_rate_bp between 0 and 10000),
  subtotal_minor     bigint      constraint purchase_order_subtotal_is_minor_units check (subtotal_minor between 0 and 1000000000000000),
  vat_minor          bigint      constraint purchase_order_vat_is_minor_units check (vat_minor between 0 and 1000000000000000),
  total_minor        bigint      constraint purchase_order_total_is_minor_units check (total_minor between 0 and 2000000000000000),
  reason             text        not null constraint purchase_order_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id           uuid        not null constraint purchase_order_decision_actor_is_a_person
                                   references erp.person (person_id) on delete no action,
  decided_at         timestamptz not null,
  recorded_at        timestamptz not null default now(),
  constraint purchase_order_decision_shape check (
    case kind
      when 'order_raised' then
        state in ('pending', 'approved') and (state = 'approved') = (limit_decision_id is not null)
        and supplier_id is not null and number is not null and business_date is not null and day_seq is not null
        and currency is not null and vat_rate_bp is not null and subtotal_minor is not null and vat_minor is not null
        and total_minor is not null and total_minor = subtotal_minor + vat_minor
      else
        limit_decision_id is null and supplier_id is null and number is null and business_date is null
        and day_seq is null and currency is null and vat_rate_bp is null and subtotal_minor is null
        and vat_minor is null and total_minor is null
        and state = case kind when 'order_approved' then 'approved' when 'order_rejected' then 'rejected'
                              when 'order_cancelled' then 'cancelled' else 'closed' end
    end),
  constraint purchase_order_approved_by_a_limit_here foreign key (limit_decision_id, facility_id)
    references erp.purchase_limit_decision (decision_id, facility_id),
  -- Targets for the projection's two stamps: each names a decision about ITS order.
  constraint purchase_order_decision_about unique (decision_id, purchase_order_id),
  constraint purchase_order_decision_kind_about unique (decision_id, purchase_order_id, kind)
);

comment on table erp.purchase_order_decision is
  'Append-only record of every purchase order decision (PRC-001, IAM-008, ADR-0032): raised — with the order whole — approved, rejected, cancelled or closed short; who, when, why.';

-- One raise per order; a race past the route's check is refused under this name.
create unique index purchase_order_raised_once on erp.purchase_order_decision (purchase_order_id) where kind = 'order_raised';
create index ix_purchase_order_decision_order on erp.purchase_order_decision (purchase_order_id, seq);

-- ---------------------------------------------------------------------------
-- The order (I-8) — fixed facts from its raise, and the state its latest decision put in force
-- ---------------------------------------------------------------------------

create table erp.purchase_order (
  -- UUIDv7, minted by the console (I-1).
  purchase_order_id    uuid        primary key,
  -- P1: the one warehouse or factory it is delivered to.
  facility_id          uuid        not null constraint purchase_order_facility_exists
                                     references erp.facility (facility_id) on delete no action,
  supplier_id          uuid        not null constraint purchase_order_supplier_exists
                                     references erp.supplier (supplier_id) on delete no action,
  -- The facility's code, the business day, and the order's place in it: WH-001-PO-20261007-0001.
  -- One series per facility per day, numbered under a lock, so without gaps.
  number               text        not null constraint purchase_order_number_key unique,
  -- The calendar date, in the facility's time zone, of the moment it was raised (Q-22's
  -- default for a facility's own work, ADR-0029 D3; confirmed for orders as P5's question).
  business_date        date        not null,
  day_seq              integer     not null constraint purchase_order_day_seq_is_positive check (day_seq > 0),
  currency             text        not null,
  vat_rate_bp          integer     not null,
  subtotal_minor       bigint      not null,
  vat_minor            bigint      not null,
  total_minor          bigint      not null,
  raised_by            uuid        not null constraint purchase_order_raised_by_a_person
                                     references erp.person (person_id) on delete no action,
  raised_at            timestamptz not null,
  -- The raise, which holds what the order is. A constant kind, so the key can say it.
  raised_decision_id   uuid        not null,
  raised_kind          text        not null default 'order_raised'
    constraint purchase_order_raised_kind check (raised_kind = 'order_raised'),
  state                text        not null,
  -- I-8. The single-column key is what db-check's projection-stamp-is-a-foreign-key-where-
  -- it-can-be finds; the composite one makes it impossible to stamp this order with another's.
  as_of_decision_id    uuid        not null constraint purchase_order_as_of_decision_id_fkey
                                     references erp.purchase_order_decision (decision_id),
  updated_at           timestamptz not null default now(),
  constraint purchase_order_day_seq_key unique (facility_id, business_date, day_seq),
  constraint purchase_order_at_facility unique (purchase_order_id, facility_id),
  constraint purchase_order_stamp_is_its_decision foreign key (as_of_decision_id, purchase_order_id)
    references erp.purchase_order_decision (decision_id, purchase_order_id),
  constraint purchase_order_raised_by_its_raise foreign key (raised_decision_id, purchase_order_id, raised_kind)
    references erp.purchase_order_decision (decision_id, purchase_order_id, kind)
);

comment on table erp.purchase_order is
  'A purchase order (PRC-001, ADR-0032): to one warehouse or factory, from one supplier, as raised — fixed for good — and in the state its latest decision put in force. What has arrived is never stored here: it is the sum of the receipts not reversed (erp.purchase_receipt_line).';

create index ix_purchase_order_facility on erp.purchase_order (facility_id, business_date desc, day_seq desc);

-- What an order is never changes; its state moves only forward. Never deleted.
create or replace function erp.purchase_order_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is never truncated: an order is cancelled, rejected or closed, by a decision', tg_table_name
      using errcode = 'restrict_violation';
  elsif tg_op = 'DELETE' then
    raise exception 'a purchase order is never deleted: it is cancelled, rejected or closed, by a decision'
      using errcode = 'restrict_violation', constraint = 'purchase_order_never_deleted';
  end if;
  if (new.purchase_order_id, new.facility_id, new.supplier_id, new.number, new.business_date, new.day_seq,
      new.currency, new.vat_rate_bp, new.subtotal_minor, new.vat_minor, new.total_minor, new.raised_by,
      new.raised_at, new.raised_decision_id, new.raised_kind)
     is distinct from
     (old.purchase_order_id, old.facility_id, old.supplier_id, old.number, old.business_date, old.day_seq,
      old.currency, old.vat_rate_bp, old.subtotal_minor, old.vat_minor, old.total_minor, old.raised_by,
      old.raised_at, old.raised_decision_id, old.raised_kind) then
    raise exception 'purchase order % is fixed as raised: cancel it and raise another', old.number
      using errcode = 'restrict_violation', constraint = 'purchase_order_fixed';
  end if;
  if new.state <> old.state and not (
       (old.state = 'pending' and new.state in ('approved', 'rejected', 'cancelled'))
    or (old.state = 'approved' and new.state in ('cancelled', 'closed'))) then
    raise exception 'purchase order % does not go from % to %', old.number, old.state, new.state
      using errcode = 'restrict_violation', constraint = 'purchase_order_state_moves_forward';
  end if;
  return new;
end;
$$;

create trigger purchase_order_is_fixed
  before update or delete on erp.purchase_order
  for each row
  execute function erp.purchase_order_is_fixed();
create trigger purchase_order_never_truncated
  before truncate on erp.purchase_order
  for each statement
  execute function erp.purchase_order_is_fixed();

-- ---------------------------------------------------------------------------
-- The order's lines (PRC-001, I-7) — written once, with the raise
-- ---------------------------------------------------------------------------

create table erp.purchase_order_line (
  purchase_order_id uuid        not null constraint purchase_order_line_order_exists
                                  references erp.purchase_order (purchase_order_id) on delete no action,
  line_no           integer     not null constraint purchase_order_line_no_is_positive check (line_no > 0),
  -- What the supplier sells (ADR-0026): the supply the line was raised against, and THE I-7
  -- SEAM, its conversion copied whole. A pack changed since is a new conversion, so this line
  -- goes on meaning the pack ordered.
  supplier_item_id  uuid        not null constraint purchase_order_line_supply_exists
                                  references erp.supplier_item (supplier_item_id) on delete no action,
  item_unit_id      uuid        not null,
  item_id           uuid        not null,
  unit_key          text        not null,
  factor            numeric     not null,
  -- In packs, six places, as stock is.
  quantity          numeric     not null
    constraint purchase_order_line_quantity_is_exact check (quantity > 0 and quantity = round(quantity, 6) and quantity < 1e12),
  base_quantity     numeric     not null
    constraint purchase_order_line_base_is_exact check (base_quantity > 0 and base_quantity = round(base_quantity, 6) and base_quantity < 1e12),
  -- P2: the price per pack, in halalas, before VAT; and the line's amount, quantity × price
  -- rounded half away from zero to the halala.
  price_minor       bigint      not null
    constraint purchase_order_line_price_is_minor_units check (price_minor between 0 and 100000000000),
  amount_minor      bigint      not null
    constraint purchase_order_line_amount_is_minor_units check (amount_minor between 0 and 100000000000000),
  constraint purchase_order_line_pkey primary key (purchase_order_id, line_no),
  constraint purchase_order_line_pack_once unique (purchase_order_id, item_unit_id),
  -- The target a receipt line binds to: the line AND its pack.
  constraint purchase_order_line_pack unique (purchase_order_id, line_no, item_unit_id),
  constraint purchase_order_line_base_is_quantity_times_factor check (base_quantity = quantity * factor),
  constraint purchase_order_line_amount_is_quantity_times_price check (amount_minor = round(quantity * price_minor)),
  constraint purchase_order_line_names_a_conversion foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor)
);

comment on table erp.purchase_order_line is
  'What a purchase order asks for, line by line, as raised: a supply''s pack (ADR-0026, I-7), a quantity of it and a price per pack in halalas. Written once with the order; never changed or deleted.';

-- The lines of an order, its receipts and their lines are records, not projections: written
-- once, and refused any later change, by the owner too.
create or replace function erp.purchase_record_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is written once: % denied', tg_table_name, tg_op
    using errcode = 'restrict_violation',
          hint = 'An order is cancelled or closed, and a receipt reversed, by a further decision.';
end;
$$;

create trigger purchase_order_line_is_fixed
  before update or delete on erp.purchase_order_line
  for each row
  execute function erp.purchase_record_is_fixed();
create trigger purchase_order_line_never_truncated
  before truncate on erp.purchase_order_line
  for each statement
  execute function erp.purchase_record_is_fixed();

-- ---------------------------------------------------------------------------
-- Receipts (PRC-006, INV-006) — a stock decision of kind 'receipt', and what it received
-- ---------------------------------------------------------------------------

-- Additive (I-10), as 0020 said it would be: a receipt puts stock in, and is reversed.
alter table erp.stock_decision drop constraint stock_decision_kind_is_known;
alter table erp.stock_decision add constraint stock_decision_kind_is_known
  check (kind in ('count', 'adjustment', 'waste', 'damage', 'expiry', 'reversal', 'receipt'));
alter table erp.stock_ledger add constraint stock_ledger_receipt_is_inward
  check (kind <> 'receipt' or direction = 'in');
-- The target a receipt line binds to: the ledger line AND the pack and quantity it moved.
alter table erp.stock_ledger add constraint stock_ledger_line_moves
  unique (decision_id, line_no, item_unit_id, quantity);

create table erp.purchase_receipt (
  -- The stock decision that posted it, of kind receipt, at the order's facility, its
  -- moment copied and bound by key so no receipt is dated or placed otherwise.
  decision_id       uuid        primary key,
  kind              text        not null default 'receipt' constraint purchase_receipt_is_a_receipt check (kind = 'receipt'),
  facility_id       uuid        not null,
  occurred_at       timestamptz not null,
  business_date     date        not null,
  purchase_order_id uuid        not null,
  -- The supplier's delivery note number, as printed. Optional.
  delivery_note     text
    constraint purchase_receipt_delivery_note_is_canonical check (
      delivery_note = btrim(delivery_note) and length(delivery_note) between 1 and 64),
  constraint purchase_receipt_is_its_stock_decision foreign key (decision_id, kind, facility_id, occurred_at, business_date)
    references erp.stock_decision (decision_id, kind, facility_id, occurred_at, business_date),
  constraint purchase_receipt_is_for_an_order_here foreign key (purchase_order_id, facility_id)
    references erp.purchase_order (purchase_order_id, facility_id),
  constraint purchase_receipt_of_order unique (decision_id, purchase_order_id)
);

comment on table erp.purchase_receipt is
  'A goods receipt against a purchase order (PRC-006, ADR-0032): the stock decision of kind receipt that posted it, and the delivery note. Reversed through erp.reverse_purchase_receipt(), never changed or deleted.';

create index ix_purchase_receipt_order on erp.purchase_receipt (purchase_order_id);

create table erp.purchase_receipt_line (
  decision_id       uuid        not null,
  -- The ledger line it posted, which has this number.
  line_no           integer     not null,
  purchase_order_id uuid        not null,
  order_line_no     integer     not null,
  item_unit_id      uuid        not null,
  quantity          numeric     not null,
  constraint purchase_receipt_line_pkey primary key (decision_id, line_no),
  constraint purchase_receipt_line_once unique (decision_id, order_line_no),
  constraint purchase_receipt_line_of_its_receipt foreign key (decision_id, purchase_order_id)
    references erp.purchase_receipt (decision_id, purchase_order_id),
  -- In the order line's own pack, which is the ledger line's: received as ordered (P4's default).
  constraint purchase_receipt_line_against_its_order_line foreign key (purchase_order_id, order_line_no, item_unit_id)
    references erp.purchase_order_line (purchase_order_id, line_no, item_unit_id),
  constraint purchase_receipt_line_is_its_ledger_line foreign key (decision_id, line_no, item_unit_id, quantity)
    references erp.stock_ledger (decision_id, line_no, item_unit_id, quantity)
);

comment on table erp.purchase_receipt_line is
  'What a receipt received of each order line, bound by key to the ledger line that posted it. An order line''s received quantity is the sum of these for receipts not reversed.';

create index ix_purchase_receipt_line_order on erp.purchase_receipt_line (purchase_order_id, order_line_no);

create trigger purchase_receipt_is_fixed
  before update or delete on erp.purchase_receipt
  for each row
  execute function erp.purchase_record_is_fixed();
create trigger purchase_receipt_never_truncated
  before truncate on erp.purchase_receipt
  for each statement
  execute function erp.purchase_record_is_fixed();
create trigger purchase_receipt_line_is_fixed
  before update or delete on erp.purchase_receipt_line
  for each row
  execute function erp.purchase_record_is_fixed();
create trigger purchase_receipt_line_never_truncated
  before truncate on erp.purchase_receipt_line
  for each statement
  execute function erp.purchase_record_is_fixed();

-- The two logs, in the words db-check's runtime probe reads, as 0020's.
create or replace function erp.purchase_log_is_append_only()
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
          hint = 'Record a further decision. Who ordered, approved or limited what, and why, is not unmade by deleting the record of it.';
end;
$$;

create trigger purchase_limit_decision_append_only
  before update or delete or truncate on erp.purchase_limit_decision
  for each statement
  execute function erp.purchase_log_is_append_only();
create trigger purchase_order_decision_append_only
  before update or delete or truncate on erp.purchase_order_decision
  for each statement
  execute function erp.purchase_log_is_append_only();

-- The limit's projection: one facility's, for good; cleared, never deleted.
create or replace function erp.purchase_limit_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is never truncated: a limit is cleared, by a decision', tg_table_name
      using errcode = 'restrict_violation';
  elsif tg_op = 'DELETE' then
    raise exception 'an approval limit is never deleted: it is cleared, by a decision'
      using errcode = 'restrict_violation', constraint = 'purchase_limit_never_deleted';
  end if;
  if new.facility_id is distinct from old.facility_id then
    raise exception 'an approval limit stays the limit of its facility'
      using errcode = 'restrict_violation', constraint = 'purchase_limit_fixed';
  end if;
  return new;
end;
$$;

create trigger purchase_limit_is_fixed
  before update or delete on erp.purchase_limit
  for each row
  execute function erp.purchase_limit_is_fixed();
create trigger purchase_limit_never_truncated
  before truncate on erp.purchase_limit
  for each statement
  execute function erp.purchase_limit_is_fixed();

-- ---------------------------------------------------------------------------
-- 0020's seam, widened to receipts — and the stock route, kept from reversing one
-- ---------------------------------------------------------------------------

-- Replaced whole, as 0022 replaced 0021's functions; 0020 itself is unchanged. Two changes,
-- marked RECEIPT: a receipt's lines are inward, and a receipt may be reversed. Every rule a
-- receipt meets is 0020's, in 0020's order and words.
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
  l_unit     uuid[]    := '{}';
  l_item     uuid[]    := '{}';
  l_key      text[]    := '{}';
  l_factor   numeric[] := '{}';
  l_dir      text[]    := '{}';
  l_qty      numeric[] := '{}';
  l_base     numeric[] := '{}';
  l_rev      bigint[]  := '{}';
  c_item     uuid[];
  c_variance numeric[];
  c_on_hand  numeric[];
  v_clock    timestamptz;
  v_at       timestamptz;
  v_date     date;
  v_bad      record;
  v_override text;
begin
  perform erp.assert_stock_decision_is_new(p_decision_id);

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

  -- RECEIPT: a kind.
  if p_kind is null or p_kind not in ('count', 'adjustment', 'waste', 'damage', 'expiry', 'reversal', 'receipt') then
    raise exception 'a stock decision is a count, an adjustment, a waste, a damage, an expiry, a receipt or a reversal'
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

  if p_kind = 'reversal' then
    if p_lines is not null then
      raise exception 'a reversal takes its lines from the decision it reverses'
        using errcode = 'check_violation', constraint = 'stock_lines_are_stated';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('erp.stock_reversal:' || p_reverses::text, 0));
    select * into t from erp.stock_decision d where d.decision_id = p_reverses and d.facility_id = f.facility_id;
    if not found then
      raise exception 'no stock decision % at %', p_reverses, f.code
        using errcode = 'no_data_found', constraint = 'stock_decision_exists';
    end if;
    -- RECEIPT: reversible, through its order (erp.reverse_purchase_receipt()).
    if t.kind not in ('adjustment', 'waste', 'damage', 'expiry', 'receipt') then
      raise exception 'a % is not reversed', t.kind
        using errcode = 'restrict_violation', constraint = 'stock_decision_is_not_reversible',
              hint = case t.kind when 'count' then 'A count is corrected by counting again.'
                                 else 'A reversal is final. Record an adjustment instead.' end;
    end if;
    if exists (select 1 from erp.stock_decision d where d.reverses_decision_id = t.decision_id) then
      raise exception 'stock decision % is already reversed', t.decision_id
        using errcode = 'unique_violation', constraint = 'stock_already_reversed';
    end if;
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
      elsif p_kind = 'receipt' then
        -- RECEIPT: inward, always.
        if coalesce(v_dir, 'in') <> 'in' then
          raise exception 'line %: a receipt puts stock in', v_no
            using errcode = 'check_violation', constraint = 'stock_direction_is_known';
        end if;
        v_dir := 'in';
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

  perform erp.lock_stock(array_fill(f.facility_id, array[cardinality(l_item)]), l_item);

  v_clock := greatest(clock_timestamp(), p_decided_at);
  if p_kind = 'reversal' then
    v_at := t.occurred_at;
  else
    v_at := coalesce(p_occurred_at, v_clock);
    if v_at > v_clock then
      raise exception 'stock is recorded once it has moved, not before'
        using errcode = 'check_violation', constraint = 'stock_not_in_future';
    end if;
    if not isfinite(v_at) or v_at < f.created_at then
      raise exception 'the record of % begins at %: nothing is dated before it', f.code, erp.stock_moment(f.created_at, f.tz_name)
        using errcode = 'check_violation', constraint = 'stock_moment_before_facility',
              hint = 'Check the date, and the year especially.';
    end if;
  end if;
  v_date := (v_at at time zone f.tz_name)::date;

  select i.code, b.last_counted_at into v_bad
    from erp.stock_balance b
    join erp.item i on i.item_id = b.item_id
   where b.facility_id = f.facility_id and b.item_id = any (l_item)
     and (b.last_counted_at >= v_at
          or (v_at < date_trunc('minute', b.last_counted_at) + interval '1 minute'
              and exists (select 1 from erp.stock_count_log c
                            join erp.stock_decision kd on kd.decision_id = c.decision_id
                           where c.facility_id = b.facility_id and c.item_id = b.item_id
                             and c.occurred_at = b.last_counted_at and kd.moment_stated)))
   order by i.code collate "C"
   limit 1;
  if found then
    if p_kind = 'reversal' then
      raise exception '% was counted at % since the decision being reversed, and the count already corrected it',
        v_bad.code, erp.stock_moment(v_bad.last_counted_at, f.tz_name)
        using errcode = 'restrict_violation', constraint = 'stock_reversal_counted_since',
              hint = 'Count it again, or record an adjustment, to change it now.';
    elsif v_bad.last_counted_at <= v_at then
      raise exception '% was counted at %, to the minute: say whether this was before or after the count',
        v_bad.code, erp.stock_moment(v_bad.last_counted_at, f.tz_name)
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
    select i.code, e.decision_id, e.occurred_at into v_bad
      from erp.stock_ledger e
      join erp.item i on i.item_id = e.item_id
     where e.facility_id = f.facility_id and e.item_id = any (l_item) and e.kind <> 'count'
       and (e.occurred_at = v_at
            or (p_occurred_at is not null
                and e.occurred_at >= date_trunc('minute', v_at)
                and e.occurred_at < date_trunc('minute', v_at) + interval '1 minute'))
     order by i.code collate "C"
     limit 1;
    if found then
      raise exception 'a movement of % is recorded at % (decision %), in the minute counted: say whether the count was before or after it',
        v_bad.code, erp.stock_moment(v_bad.occurred_at, f.tz_name), v_bad.decision_id
        using errcode = 'restrict_violation', constraint = 'stock_count_moment_taken',
              hint = 'If you counted before it, state the count a minute earlier; if after, a minute later.';
    end if;

    select array_agg(k.item_id order by k.item_id),
           array_agg(k.counted - (k.on_hand - k.later) order by k.item_id),
           array_agg(k.on_hand order by k.item_id),
           max(greatest(k.counted, abs(k.counted - (k.on_hand - k.later))))
      into c_item, c_variance, c_on_hand, v_base
      from (select c.item_id, c.counted, coalesce(b.on_hand, 0) as on_hand,
                   coalesce((select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end)
                               from erp.stock_ledger e
                              where e.facility_id = f.facility_id and e.item_id = c.item_id and e.occurred_at > v_at), 0) as later
              from (select x.item_id, sum(x.base) as counted
                      from unnest(l_item, l_base) as x(item_id, base) group by x.item_id) c
              left join erp.stock_balance b on b.facility_id = f.facility_id and b.item_id = c.item_id) k;
    if v_base >= 1e12 then
      raise exception 'what was found of one item, or its difference from the book, is more than any store holds'
        using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
    end if;
  else
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

  insert into erp.stock_decision (
    decision_id, kind, facility_id, occurred_at, moment_stated, business_date, reverses_decision_id, override_reason,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, f.facility_id, v_at, p_kind <> 'reversal' and p_occurred_at is not null, v_date, p_reverses,
    v_override, p_reason, p_actor_id, p_decided_at
  );

  if p_kind = 'count' then
    insert into erp.stock_count_log (
      decision_id, line_no, kind, facility_id, occurred_at, business_date,
      item_id, item_unit_id, unit_key, factor, quantity, base_quantity
    )
    select p_decision_id, x.n, 'count', f.facility_id, v_at, v_date, x.item_id, x.unit, x.key, x.factor, x.qty, x.base
      from unnest(l_item, l_unit, l_key, l_factor, l_qty, l_base)
           with ordinality as x(item_id, unit, key, factor, qty, base, n);

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

-- 0020's reversal route, replaced: a receipt is reversed through its order, which asks
-- purchasing's permission too and reopens the order's lines. Otherwise unchanged.
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
  if exists (select 1 from erp.stock_decision d
              where d.decision_id = p_target_decision_id and d.facility_id = p_facility_id and d.kind = 'receipt') then
    raise exception 'a receipt is reversed from its purchase order'
      using errcode = 'restrict_violation', constraint = 'stock_receipt_reversed_through_its_order',
            hint = 'Open the purchase order and reverse the receipt there, so the order knows the goods are not in.';
  end if;
  perform erp.post_stock(p_decision_id, 'reversal', p_facility_id, null, null, p_target_decision_id,
                         p_reason, p_override_reason, p_actor_id, p_decided_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- 0012's retry pattern, for each log: called straight after the gate, before any rule a
-- committed first attempt would itself now break, so a retry always answers 23505 on the
-- log's primary key. A receipt and its reversal are stock decisions, and use 0020's.
create or replace function erp.assert_purchase_order_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_order_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.purchase_order_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'purchase_order_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.get_purchase_order() to confirm.';
  end if;
end;
$$;

create or replace function erp.assert_purchase_limit_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_limit_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.purchase_limit_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'purchase_limit_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.purchase_limit_history() to confirm.';
  end if;
end;
$$;

-- The facility an order is delivered to: named, open (its share lock, so a closure waits),
-- and one that holds stock — 0020's rules, in 0020's words, since a receipt posts there.
create or replace function erp.assert_purchase_facility(p_facility_id uuid)
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

-- What each line of an order has received: the sum of its receipts not reversed.
create or replace function erp.purchase_order_received(p_purchase_order_id uuid)
returns table (line_no integer, received numeric)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select l.line_no,
         coalesce((select sum(r.quantity)
                     from erp.purchase_receipt_line r
                    where r.purchase_order_id = l.purchase_order_id and r.order_line_no = l.line_no
                      and not exists (select 1 from erp.stock_decision v where v.reverses_decision_id = r.decision_id)), 0)
    from erp.purchase_order_line l
   where l.purchase_order_id = p_purchase_order_id;
$$;

-- How much of an order has arrived: none, part, or all of every line.
create or replace function erp.purchase_order_progress(p_purchase_order_id uuid)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case when bool_and(r.received = 0) then 'none'
              when bool_and(r.received >= l.quantity) then 'full'
              else 'partial' end
    from erp.purchase_order_line l
    join erp.purchase_order_received(p_purchase_order_id) r on r.line_no = l.line_no
   where l.purchase_order_id = p_purchase_order_id;
$$;

-- An order at a facility, locked for the decision about to be made. Another facility's
-- answers exactly as a missing one.
create or replace function erp.lock_purchase_order(p_purchase_order_id uuid, p_facility_id uuid)
returns erp.purchase_order
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  o erp.purchase_order;
begin
  select * into o from erp.purchase_order x
   where x.purchase_order_id = p_purchase_order_id and x.facility_id = p_facility_id
     for update;
  if not found then
    raise exception 'no purchase order %', p_purchase_order_id
      using errcode = 'no_data_found', constraint = 'purchase_order_exists';
  end if;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- The write routes (CAP-P04, IAM-006) — the runtime's only way in
-- ---------------------------------------------------------------------------

-- Each is scoped to the order's facility, as stock's are, and asks the reads
-- erp.get_purchase_order() asks, so whoever writes can confirm their own retry.

-- A new order: a supplier, the facility it is delivered to, one VAT rate, and 1 to 200 lines
-- of {item_unit_id, quantity, price_minor} — a pack the supplier supplies (ADR-0026), a
-- quantity of packs as decimal text, a price per pack in halalas as a whole number. New work,
-- so the supplier, each item, each pack and each supply must be active, read under their
-- share locks so a retirement meanwhile waits and is seen (0018's and 0022's finding).
-- Approved at once when the facility has a limit and the order, before VAT, is within it (P3).
create or replace function erp.raise_purchase_order(
  p_decision_id       uuid,
  p_purchase_order_id uuid,
  p_facility_id       uuid,
  p_supplier_id       uuid,
  p_vat_rate_bp       integer,
  p_lines             jsonb,
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
  f          erp.facility;
  s          erp.supplier;
  u          erp.item_unit;
  v_item     erp.item;
  v_supply   uuid;
  v_line     jsonb;
  v_no       integer := 0;
  v_unit     uuid;
  v_qty_text text;
  v_qty      numeric;
  v_base     numeric;
  v_price    bigint;
  v_amount   numeric;
  l_unit     uuid[]    := '{}';
  l_item     uuid[]    := '{}';
  l_key      text[]    := '{}';
  l_factor   numeric[] := '{}';
  l_supply   uuid[]    := '{}';
  l_qty      numeric[] := '{}';
  l_base     numeric[] := '{}';
  l_price    bigint[]  := '{}';
  l_amount   bigint[]  := '{}';
  v_subtotal numeric;
  v_vat      bigint;
  lim        erp.purchase_limit;
  v_state    text := 'pending';
  v_limit_id uuid;
  v_at       timestamptz;
  v_date     date;
  v_day_seq  integer;
  v_number   text;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_purchase_order_decision_is_new(p_decision_id);
  f := erp.assert_purchase_facility(p_facility_id);

  if p_purchase_order_id is null then
    raise exception 'an order is raised with the id it will be known by'
      using errcode = 'not_null_violation', constraint = 'purchase_order_id_is_stated';
  end if;
  -- One id, one order: the same id under another decision is a different order, not a retry.
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_order:' || p_purchase_order_id::text, 0));
  if exists (select 1 from erp.purchase_order o where o.purchase_order_id = p_purchase_order_id) then
    raise exception 'purchase order % is already raised', p_purchase_order_id
      using errcode = 'unique_violation', constraint = 'purchase_order_raised_once';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'an order states why it is raised'
      using errcode = 'check_violation', constraint = 'purchase_order_reason_is_stated';
  end if;

  -- The supplier, under its share lock (ADR-0026's seam for new work).
  s := erp.assert_supplier_active(p_supplier_id);

  if p_vat_rate_bp is null or p_vat_rate_bp not between 0 and 10000 then
    raise exception 'a VAT rate is 0 to 10000 basis points: 1500 is 15%%'
      using errcode = 'check_violation', constraint = 'purchase_order_vat_rate_is_known';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'an order has 1 to 200 lines'
      using errcode = 'check_violation', constraint = 'purchase_order_lines_are_stated';
  end if;
  for v_line in select x.value from jsonb_array_elements(p_lines) as x loop
    v_no := v_no + 1;
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(v_line ->> 'item_unit_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'line %: a line names the pack it orders, by its id', v_no
        using errcode = 'check_violation', constraint = 'purchase_order_lines_are_stated';
    end if;
    v_unit := (v_line ->> 'item_unit_id')::uuid;
    -- The brand fence first: 0012's own words for a conversion that does not exist.
    select x.* into u
      from erp.item_unit x
      join erp.item i on i.item_id = x.item_id
      join erp.operating_unit ou on ou.brand_id = i.brand_id
     where x.item_unit_id = v_unit and ou.operating_unit_id = f.operating_unit_id;
    if not found then
      raise exception 'no conversion %', v_unit using errcode = 'no_data_found', constraint = 'item_unit_exists';
    end if;
    if u.item_unit_id = any (l_unit) then
      raise exception 'line %: that pack is already on line %', v_no, array_position(l_unit, u.item_unit_id)
        using errcode = 'check_violation', constraint = 'purchase_order_line_pack_once',
              hint = 'One line per pack: add the quantities together.';
    end if;
    -- Under the item's share lock, which erp.retire_item_unit() takes for update, the pack is
    -- read again and held; then the supply, held too, which erp.retire_supplier_item() updates.
    v_item := erp.assert_item_active(u.item_id);
    select x.* into u from erp.item_unit x where x.item_unit_id = u.item_unit_id for share;
    if u.status <> 'active' then
      raise exception 'line %: the % pack of % is retired: order a current one', v_no, u.unit_key, v_item.code
        using errcode = 'restrict_violation', constraint = 'purchase_order_line_pack_is_retired';
    end if;
    select si.supplier_item_id into v_supply
      from erp.supplier_item si
     where si.supplier_id = s.supplier_id and si.item_unit_id = u.item_unit_id and si.status = 'active'
       for share;
    if not found then
      raise exception 'line %: % does not supply % in the % pack', v_no, s.code, v_item.code, u.unit_key
        using errcode = 'restrict_violation', constraint = 'purchase_order_line_not_supplied',
              hint = 'Order a pack the supplier sells, or add that supply to the supplier first.';
    end if;

    v_qty_text := v_line ->> 'quantity';
    if coalesce(jsonb_typeof(v_line -> 'quantity'), '') not in ('string', 'number')
       or v_qty_text !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      raise exception 'line %: a quantity is a number with up to twelve digits and six decimal places', v_no
        using errcode = 'check_violation', constraint = 'purchase_order_line_quantity_is_exact';
    end if;
    v_qty := trim_scale(v_qty_text::numeric);
    if v_qty = 0 then
      raise exception 'line %: a quantity ordered is more than nothing', v_no
        using errcode = 'check_violation', constraint = 'purchase_order_line_quantity_is_exact';
    end if;
    v_base := v_qty * u.factor;
    if v_base <> round(v_base, 6) or v_base >= 1e12 then
      raise exception 'line %: % % is % in the base unit, past six decimal places or more than any store holds',
        v_no, v_qty, u.unit_key, trim_scale(v_base)
        using errcode = 'check_violation', constraint = 'purchase_order_line_base_is_exact',
              hint = 'Order it in a larger pack.';
    end if;
    -- P2: a whole number of halalas, as JSON number, never a string to be guessed at.
    if jsonb_typeof(v_line -> 'price_minor') is distinct from 'number'
       or (v_line ->> 'price_minor') !~ '^[0-9]{1,12}$'
       or (v_line ->> 'price_minor')::numeric > 100000000000 then
      raise exception 'line %: a price is a whole number of halalas per pack, at most 1,000,000,000.00 riyals', v_no
        using errcode = 'check_violation', constraint = 'purchase_order_line_price_is_minor_units';
    end if;
    v_price := (v_line ->> 'price_minor')::bigint;
    v_amount := round(v_qty * v_price);
    if v_amount > 100000000000000 then
      raise exception 'line %: % packs at that price is more than one line may commit', v_no, v_qty
        using errcode = 'check_violation', constraint = 'purchase_order_line_amount_is_minor_units';
    end if;
    if exists (select 1 from jsonb_object_keys(v_line) k where k not in ('item_unit_id', 'quantity', 'price_minor')) then
      raise exception 'line %: a line carries its pack, its quantity and its price, and nothing else', v_no
        using errcode = 'check_violation', constraint = 'purchase_order_lines_are_stated';
    end if;

    l_unit := array_append(l_unit, u.item_unit_id);
    l_item := array_append(l_item, u.item_id);
    l_key := array_append(l_key, u.unit_key::text);
    l_factor := array_append(l_factor, u.factor);
    l_supply := array_append(l_supply, v_supply);
    l_qty := array_append(l_qty, v_qty);
    l_base := array_append(l_base, trim_scale(v_base));
    l_price := array_append(l_price, v_price);
    l_amount := array_append(l_amount, v_amount::bigint);
  end loop;

  select sum(x) into v_subtotal from unnest(l_amount) as x;
  if v_subtotal > 1000000000000000 then
    raise exception 'this order commits more than any one order may'
      using errcode = 'check_violation', constraint = 'purchase_order_subtotal_is_minor_units';
  end if;
  v_vat := round(v_subtotal * p_vat_rate_bp / 10000)::bigint;

  -- P3: the limit in force here, held while the order is judged against it.
  select * into lim from erp.purchase_limit x where x.facility_id = f.facility_id for share;
  if lim.limit_minor is not null and v_subtotal <= lim.limit_minor then
    v_state := 'approved';
    v_limit_id := lim.as_of_decision_id;
  end if;

  -- The number: the facility's next of its business day, under a lock per facility and day,
  -- so two orders raised at once take consecutive numbers rather than one. The day is read
  -- once the lock is held, so an order that waited past midnight is numbered in its own day.
  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_order_number:' || f.facility_id::text, 0));
  v_at := greatest(clock_timestamp(), p_decided_at);
  v_date := (v_at at time zone f.tz_name)::date;
  select coalesce(max(o.day_seq), 0) + 1 into v_day_seq
    from erp.purchase_order o where o.facility_id = f.facility_id and o.business_date = v_date;
  v_number := f.code || '-PO-' || to_char(v_date, 'YYYYMMDD') || '-'
              || lpad(v_day_seq::text, greatest(4, length(v_day_seq::text)), '0');

  insert into erp.purchase_order_decision (
    decision_id, kind, purchase_order_id, facility_id, state, limit_decision_id, supplier_id, number,
    business_date, day_seq, currency, vat_rate_bp, subtotal_minor, vat_minor, total_minor, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'order_raised', p_purchase_order_id, f.facility_id, v_state, v_limit_id, s.supplier_id, v_number,
    v_date, v_day_seq, 'SAR', p_vat_rate_bp, v_subtotal::bigint, v_vat, v_subtotal::bigint + v_vat, btrim(p_reason),
    p_actor_id, p_decided_at
  );

  insert into erp.purchase_order (
    purchase_order_id, facility_id, supplier_id, number, business_date, day_seq, currency, vat_rate_bp,
    subtotal_minor, vat_minor, total_minor, raised_by, raised_at, raised_decision_id, state, as_of_decision_id
  ) values (
    p_purchase_order_id, f.facility_id, s.supplier_id, v_number, v_date, v_day_seq, 'SAR', p_vat_rate_bp,
    v_subtotal::bigint, v_vat, v_subtotal::bigint + v_vat, p_actor_id, v_at, p_decision_id, v_state, p_decision_id
  );

  insert into erp.purchase_order_line (
    purchase_order_id, line_no, supplier_item_id, item_unit_id, item_id, unit_key, factor,
    quantity, base_quantity, price_minor, amount_minor
  )
  select p_purchase_order_id, x.n, x.supply, x.unit, x.item, x.key, x.factor, x.qty, x.base, x.price, x.amount
    from unnest(l_supply, l_unit, l_item, l_key, l_factor, l_qty, l_base, l_price, l_amount)
         with ordinality as x(supply, unit, item, key, factor, qty, base, price, amount, n);
end;
$$;

-- A decision about an order: approved or rejected, by someone holding approve here who did
-- not raise it (P3, PRC-004); cancelled, before anything has arrived; or closed, when part
-- has arrived and the rest will not. Each with a reason.
create or replace function erp.decide_purchase_order(
  p_decision_id       uuid,
  p_facility_id       uuid,
  p_purchase_order_id uuid,
  p_kind              text,
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
  o          erp.purchase_order;
  v_state    text;
  v_progress text;
begin
  -- The kind decides which permission is asked, so it is read first; it reveals nothing.
  if p_kind is null or p_kind not in ('order_approved', 'order_rejected', 'order_cancelled', 'order_closed') then
    raise exception 'an order is approved, rejected, cancelled or closed'
      using errcode = 'check_violation', constraint = 'purchase_order_decision_kind_is_known';
  end if;
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders',
                               case when p_kind in ('order_approved', 'order_rejected') then 'approve' else 'write' end,
                               p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_purchase_order_decision_is_new(p_decision_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a decision about an order states why'
      using errcode = 'check_violation', constraint = 'purchase_order_reason_is_stated';
  end if;

  o := erp.lock_purchase_order(p_purchase_order_id, p_facility_id);
  -- Approving is new work at the facility; stopping an order is not, so it is never kept
  -- waiting on a facility's closure.
  if p_kind = 'order_approved' then
    perform erp.assert_facility_open(p_facility_id);
  end if;

  v_state := case p_kind when 'order_approved' then 'approved' when 'order_rejected' then 'rejected'
                         when 'order_cancelled' then 'cancelled' else 'closed' end;
  if p_kind in ('order_approved', 'order_rejected') then
    if o.state <> 'pending' then
      raise exception 'purchase order % is %, not waiting for approval', o.number, o.state
        using errcode = 'restrict_violation', constraint = 'purchase_order_not_pending';
    end if;
    -- PRC-004: whoever raised it does not decide it. They may cancel it.
    if o.raised_by = p_actor_id then
      raise exception 'purchase order % was raised by you: someone else approves or rejects it', o.number
        using errcode = 'restrict_violation', constraint = 'purchase_order_self_approval',
              hint = 'To withdraw your own order, cancel it.';
    end if;
  else
    v_progress := erp.purchase_order_progress(o.purchase_order_id);
    if p_kind = 'order_cancelled' then
      if o.state not in ('pending', 'approved') then
        raise exception 'purchase order % is %, and is not cancelled', o.number, o.state
          using errcode = 'restrict_violation', constraint = 'purchase_order_is_finished';
      end if;
      if v_progress <> 'none' then
        raise exception 'purchase order % has goods received against it, and is not cancelled', o.number
          using errcode = 'restrict_violation', constraint = 'purchase_order_has_receipts',
                hint = 'Close it, if the rest will not arrive; or reverse the receipts first.';
      end if;
    else
      if o.state <> 'approved' then
        raise exception 'purchase order % is %: only an approved order is closed', o.number, o.state
          using errcode = 'restrict_violation', constraint = 'purchase_order_not_approved';
      end if;
      if v_progress = 'none' then
        raise exception 'nothing has been received against purchase order %: cancel it instead', o.number
          using errcode = 'restrict_violation', constraint = 'purchase_order_nothing_received';
      elsif v_progress = 'full' then
        raise exception 'purchase order % is received in full: there is nothing left to close', o.number
          using errcode = 'restrict_violation', constraint = 'purchase_order_received_in_full';
      end if;
    end if;
  end if;

  insert into erp.purchase_order_decision (
    decision_id, kind, purchase_order_id, facility_id, state, reason, actor_id, decided_at
  ) values (
    p_decision_id, p_kind, o.purchase_order_id, o.facility_id, v_state, btrim(p_reason), p_actor_id, p_decided_at
  );
  update erp.purchase_order
     set state = v_state, as_of_decision_id = p_decision_id, updated_at = now()
   where purchase_order_id = o.purchase_order_id;
end;
$$;

-- Goods arrived against an approved order: 1 to 200 lines of {line_no, quantity}, each in its
-- order line's pack, never more than is still to come. Posted through 0020's seam as a stock
-- decision of kind receipt, so D1 to D4 hold for it; p_received_at is the moment the goods
-- arrived, stated when entered late, or NULL for now. Asks write on stock here as well as on
-- orders: it moves stock.
create or replace function erp.receive_purchase_order(
  p_decision_id       uuid,
  p_facility_id       uuid,
  p_purchase_order_id uuid,
  p_received_at       timestamptz,
  p_lines             jsonb,
  p_delivery_note     text,
  p_actor_id          uuid,
  p_decided_at        timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  o        erp.purchase_order;
  d        erp.stock_decision;
  v_note   text := nullif(btrim(p_delivery_note), '');
  v_line   jsonb;
  v_no     integer := 0;
  v_ln     integer;
  v_qty    numeric;
  ol       erp.purchase_order_line;
  v_left   numeric;
  l_ln     integer[] := '{}';
  l_unit   uuid[]    := '{}';
  l_qty    numeric[] := '{}';
  v_stock  jsonb := '[]'::jsonb;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id);
  perform erp.assert_stock_decision_is_new(p_decision_id);
  perform erp.assert_stock_facility_named(p_facility_id);

  -- The order first, then 0020's locks inside the seam: one order across every path.
  o := erp.lock_purchase_order(p_purchase_order_id, p_facility_id);
  if o.state <> 'approved' then
    raise exception 'purchase order % is %: goods are received against an approved order', o.number, o.state
      using errcode = 'restrict_violation', constraint = 'purchase_order_not_approved';
  end if;
  if v_note is not null and length(v_note) > 64 then
    raise exception 'a delivery note number is at most 64 characters'
      using errcode = 'check_violation', constraint = 'purchase_receipt_delivery_note_is_canonical';
  end if;
  if p_received_at is not null and p_received_at < o.raised_at then
    raise exception 'purchase order % was raised at %: goods are received against it after that',
      o.number, erp.stock_moment(o.raised_at, (select x.tz_name from erp.facility x where x.facility_id = o.facility_id))
      using errcode = 'check_violation', constraint = 'purchase_receipt_before_order',
            hint = 'State the moment the goods arrived.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'a receipt has 1 to 200 lines'
      using errcode = 'check_violation', constraint = 'purchase_receipt_lines_are_stated';
  end if;
  for v_line in select x.value from jsonb_array_elements(p_lines) as x loop
    v_no := v_no + 1;
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(jsonb_typeof(v_line -> 'line_no'), '') <> 'number'
       or (v_line ->> 'line_no') !~ '^[1-9][0-9]{0,2}$'
       or exists (select 1 from jsonb_object_keys(v_line) k where k not in ('line_no', 'quantity')) then
      raise exception 'line %: a receipt line names the order''s line by its number, and its quantity, and nothing else', v_no
        using errcode = 'check_violation', constraint = 'purchase_receipt_lines_are_stated';
    end if;
    v_ln := (v_line ->> 'line_no')::integer;
    select * into ol from erp.purchase_order_line x where x.purchase_order_id = o.purchase_order_id and x.line_no = v_ln;
    if not found then
      raise exception 'purchase order % has no line %', o.number, v_ln
        using errcode = 'no_data_found', constraint = 'purchase_order_line_exists';
    end if;
    if v_ln = any (l_ln) then
      raise exception 'line %: order line % is already on line %', v_no, v_ln, array_position(l_ln, v_ln)
        using errcode = 'check_violation', constraint = 'purchase_receipt_line_once',
              hint = 'One line per order line: add the quantities together.';
    end if;
    if coalesce(jsonb_typeof(v_line -> 'quantity'), '') not in ('string', 'number')
       or (v_line ->> 'quantity') !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then
      raise exception 'line %: a quantity is a number with up to twelve digits and six decimal places', v_no
        using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
    end if;
    v_qty := trim_scale((v_line ->> 'quantity')::numeric);
    if v_qty = 0 then
      raise exception 'line %: a quantity received is more than nothing', v_no
        using errcode = 'check_violation', constraint = 'stock_quantity_is_valid';
    end if;
    -- Never more than is still to come: the order holds its lock, so no other receipt of it
    -- is counted twice.
    select r.received into v_left
      from erp.purchase_order_received(o.purchase_order_id) r where r.line_no = v_ln;
    v_left := ol.quantity - v_left;
    if v_qty > v_left then
      raise exception 'line %: % % of line % is still to come; % is more', v_no, trim_scale(v_left), ol.unit_key, v_ln, v_qty
        using errcode = 'restrict_violation', constraint = 'purchase_receipt_exceeds_order',
              hint = 'Receive what was ordered. More than that is a new order, or an adjustment with its reason.';
    end if;
    l_ln := array_append(l_ln, v_ln);
    l_unit := array_append(l_unit, ol.item_unit_id);
    l_qty := array_append(l_qty, v_qty);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object('item_unit_id', ol.item_unit_id, 'quantity', v_qty::text, 'direction', 'in'));
  end loop;

  perform erp.post_stock(p_decision_id, 'receipt', p_facility_id, p_received_at, v_stock, null,
                         'Received against ' || o.number || coalesce(', delivery note ' || v_note, ''),
                         null, p_actor_id, p_decided_at);
  select * into d from erp.stock_decision x where x.decision_id = p_decision_id;

  insert into erp.purchase_receipt (decision_id, facility_id, occurred_at, business_date, purchase_order_id, delivery_note)
  values (d.decision_id, d.facility_id, d.occurred_at, d.business_date, o.purchase_order_id, v_note);
  -- post_stock numbers its ledger lines in the order given, which is this order.
  insert into erp.purchase_receipt_line (decision_id, line_no, purchase_order_id, order_line_no, item_unit_id, quantity)
  select d.decision_id, x.n, o.purchase_order_id, x.ln, x.unit, x.qty
    from unnest(l_ln, l_unit, l_qty) with ordinality as x(ln, unit, qty, n);
end;
$$;

-- A receipt recorded by mistake, undone whole, once, before any count has covered it (P4,
-- ADR-0029 §5): its stock goes back out — by an override with a reason, where the goods have
-- since been used — and the order's lines are open again. Allowed on a closed order too: the
-- goods did not come, and the rest still will not.
create or replace function erp.reverse_purchase_receipt(
  p_decision_id         uuid,
  p_facility_id         uuid,
  p_receipt_decision_id uuid,
  p_reason              text,
  p_override_reason     text,
  p_actor_id            uuid,
  p_decided_at          timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r erp.purchase_receipt;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.stock', 'write', p_facility_id);
  perform erp.assert_stock_decision_is_new(p_decision_id);
  perform erp.assert_stock_facility_named(p_facility_id);

  select * into r from erp.purchase_receipt x where x.decision_id = p_receipt_decision_id and x.facility_id = p_facility_id;
  if not found then
    raise exception 'no receipt %', p_receipt_decision_id
      using errcode = 'no_data_found', constraint = 'purchase_receipt_exists';
  end if;
  -- The order first, as a receipt takes it, then the seam's locks.
  perform erp.lock_purchase_order(r.purchase_order_id, p_facility_id);
  perform erp.post_stock(p_decision_id, 'reversal', p_facility_id, null, null, r.decision_id,
                         p_reason, p_override_reason, p_actor_id, p_decided_at);
end;
$$;

-- The approval limit at a facility, in halalas before VAT, against the stamp the person read:
-- NULL when the facility has never had one (as 0022's minimums).
create or replace function erp.set_purchase_limit(
  p_decision_id          uuid,
  p_facility_id          uuid,
  p_limit_minor          bigint,
  p_currency             text,
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
  f   erp.facility;
  lim erp.purchase_limit;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'read', p_facility_id);
  perform erp.assert_purchase_limit_decision_is_new(p_decision_id);
  f := erp.assert_purchase_facility(p_facility_id);
  if p_limit_minor is null or p_limit_minor not between 1 and 10000000000000 then
    raise exception 'a limit is a whole number of halalas, more than nothing: to have none, clear it'
      using errcode = 'check_violation', constraint = 'purchase_limit_is_minor_units';
  end if;
  if p_currency is distinct from 'SAR' then
    raise exception 'a limit is in riyals (SAR)'
      using errcode = 'check_violation', constraint = 'purchase_limit_currency_is_known';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a limit states why it was set'
      using errcode = 'check_violation', constraint = 'purchase_limit_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_limit:' || f.facility_id::text, 0));
  select * into lim from erp.purchase_limit x where x.facility_id = f.facility_id for update;
  if lim.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the approval limit at % has changed since it was read', f.code
      using errcode = 'restrict_violation', constraint = 'purchase_limit_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if lim.limit_minor is not distinct from p_limit_minor then
    raise exception 'the approval limit at % is already that', f.code
      using errcode = 'restrict_violation', constraint = 'purchase_limit_unchanged';
  end if;

  insert into erp.purchase_limit_decision (decision_id, kind, facility_id, limit_minor, currency, reason, actor_id, decided_at)
  values (p_decision_id, 'limit_set', f.facility_id, p_limit_minor, 'SAR', btrim(p_reason), p_actor_id, p_decided_at);
  insert into erp.purchase_limit (facility_id, limit_minor, currency, as_of_decision_id)
  values (f.facility_id, p_limit_minor, 'SAR', p_decision_id)
  on conflict (facility_id) do update
    set limit_minor = excluded.limit_minor, currency = excluded.currency,
        as_of_decision_id = excluded.as_of_decision_id, updated_at = now();
end;
$$;

-- No limit at the facility: every order raised there waits for an approver.
create or replace function erp.clear_purchase_limit(
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
  f   erp.facility;
  lim erp.purchase_limit;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'write', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'read', p_facility_id);
  perform erp.assert_purchase_limit_decision_is_new(p_decision_id);
  f := erp.assert_purchase_facility(p_facility_id);
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a limit states why it was cleared'
      using errcode = 'check_violation', constraint = 'purchase_limit_reason_is_stated';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp.purchase_limit:' || f.facility_id::text, 0));
  select * into lim from erp.purchase_limit x where x.facility_id = f.facility_id for update;
  if lim.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'the approval limit at % has changed since it was read', f.code
      using errcode = 'restrict_violation', constraint = 'purchase_limit_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if lim.limit_minor is null then
    raise exception '% has no approval limit', f.code
      using errcode = 'restrict_violation', constraint = 'purchase_limit_not_set';
  end if;

  insert into erp.purchase_limit_decision (decision_id, kind, facility_id, reason, actor_id, decided_at)
  values (p_decision_id, 'limit_cleared', f.facility_id, btrim(p_reason), p_actor_id, p_decided_at);
  update erp.purchase_limit
     set limit_minor = null, currency = null, as_of_decision_id = p_decision_id, updated_at = now()
   where facility_id = f.facility_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The gated reads (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- An order names a supplier and items, so each read asks read on orders, suppliers and items,
-- at ONE facility (0020's finding), the facility's brand a second fence on the items.
-- Quantities and factors inside JSON are text; amounts are whole numbers of halalas.

-- The orders here, newest first, paged by the raise's seq: p_state narrows to one state.
create or replace function erp.purchase_orders(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_state       text    default null,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  purchase_order_id uuid, seq bigint, number text, business_date date, state text, progress text,
  supplier_id uuid, supplier_code text, supplier_name_en text, supplier_name_ar text,
  currency text, vat_rate_bp integer, subtotal_minor bigint, vat_minor bigint, total_minor bigint,
  line_count integer, raised_by uuid, raised_at timestamptz, as_of_decision_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  if p_state is not null and p_state not in ('pending', 'approved', 'rejected', 'cancelled', 'closed') then
    raise exception 'an order is pending, approved, rejected, cancelled or closed'
      using errcode = 'invalid_parameter_value', constraint = 'purchase_order_state_is_known';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 orders'
      using errcode = 'invalid_parameter_value', constraint = 'purchase_page_size';
  end if;

  return query
  select o.purchase_order_id, d.seq, o.number, o.business_date, o.state, erp.purchase_order_progress(o.purchase_order_id),
         s.supplier_id, s.code::text, s.name_en, s.name_ar,
         o.currency, o.vat_rate_bp, o.subtotal_minor, o.vat_minor, o.total_minor,
         (select count(*)::integer from erp.purchase_order_line l where l.purchase_order_id = o.purchase_order_id),
         o.raised_by, o.raised_at, o.as_of_decision_id
    from erp.purchase_order o
    join erp.purchase_order_decision d on d.decision_id = o.raised_decision_id
    join erp.supplier s on s.supplier_id = o.supplier_id
   where o.facility_id = p_facility_id
     and (p_state is null or o.state = p_state)
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- One order, whole: its lines with what each has received and has still to come, every
-- decision about it, and every receipt with its lines and its reversal. The read the edge
-- makes to confirm a retried raise, decision, receipt or reversal.
create or replace function erp.get_purchase_order(p_actor_id uuid, p_facility_id uuid, p_purchase_order_id uuid)
returns table (
  purchase_order_id uuid, number text, business_date date, state text, progress text,
  supplier_id uuid, supplier_code text, supplier_name_en text, supplier_name_ar text, supplier_status text,
  currency text, vat_rate_bp integer, subtotal_minor bigint, vat_minor bigint, total_minor bigint,
  raised_by uuid, raised_at timestamptz, as_of_decision_id uuid,
  lines jsonb, decisions jsonb, receipts jsonb
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
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_orders', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select o.purchase_order_id, o.number, o.business_date, o.state, erp.purchase_order_progress(o.purchase_order_id),
         s.supplier_id, s.code::text, s.name_en, s.name_ar, s.status,
         o.currency, o.vat_rate_bp, o.subtotal_minor, o.vat_minor, o.total_minor,
         o.raised_by, o.raised_at, o.as_of_decision_id,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'line_no', l.line_no, 'item_id', l.item_id, 'code', i.code, 'name_en', i.name_en, 'name_ar', i.name_ar,
                   'base_unit_key', i.base_unit_key, 'item_unit_id', l.item_unit_id, 'unit_key', l.unit_key,
                   'factor', trim_scale(l.factor)::text, 'supplier_item_id', l.supplier_item_id,
                   'quantity', trim_scale(l.quantity)::text, 'price_minor', l.price_minor, 'amount_minor', l.amount_minor,
                   'received', trim_scale(r.received)::text, 'remaining', trim_scale(greatest(l.quantity - r.received, 0))::text)
                 order by l.line_no), '[]'::jsonb)
            from erp.purchase_order_line l
            join erp.item i on i.item_id = l.item_id
            join erp.purchase_order_received(o.purchase_order_id) r on r.line_no = l.line_no
           where l.purchase_order_id = o.purchase_order_id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'decision_id', d.decision_id, 'seq', d.seq, 'kind', d.kind, 'state', d.state,
                   'limit_decision_id', d.limit_decision_id, 'reason', d.reason, 'actor_id', d.actor_id,
                   'decided_at', d.decided_at, 'recorded_at', d.recorded_at)
                 order by d.seq), '[]'::jsonb)
            from erp.purchase_order_decision d where d.purchase_order_id = o.purchase_order_id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'decision_id', pr.decision_id, 'occurred_at', sd.occurred_at, 'business_date', sd.business_date,
                   'delivery_note', pr.delivery_note, 'actor_id', sd.actor_id, 'decided_at', sd.decided_at,
                   'recorded_at', sd.recorded_at, 'reversed_by_decision_id', rv.decision_id,
                   'reversal_reason', rv.reason, 'reversed_by', rv.actor_id,
                   'lines', (select jsonb_agg(jsonb_build_object('order_line_no', rl.order_line_no,
                                                                 'quantity', trim_scale(rl.quantity)::text)
                                              order by rl.line_no)
                               from erp.purchase_receipt_line rl where rl.decision_id = pr.decision_id))
                 order by sd.seq), '[]'::jsonb)
            from erp.purchase_receipt pr
            join erp.stock_decision sd on sd.decision_id = pr.decision_id
            left join erp.stock_decision rv on rv.reverses_decision_id = pr.decision_id
           where pr.purchase_order_id = o.purchase_order_id)
    from erp.purchase_order o
    join erp.supplier s on s.supplier_id = o.supplier_id
    join erp.facility fa on fa.facility_id = o.facility_id
    join erp.operating_unit ou on ou.operating_unit_id = fa.operating_unit_id
   where o.purchase_order_id = p_purchase_order_id and o.facility_id = p_facility_id
     and ou.brand_id = v_brand;
  if not found then
    raise exception 'no purchase order %', p_purchase_order_id
      using errcode = 'no_data_found', constraint = 'purchase_order_exists';
  end if;
end;
$$;

-- The approval limits at a facility, newest first, paged by seq: every decision, set or
-- cleared. The read the edge makes to confirm a retried write, and the stamp a form starts from.
create or replace function erp.purchase_limit_history(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_before_seq  bigint  default null,
  p_limit       integer default 100
)
returns table (
  decision_id uuid, seq bigint, kind text, limit_minor bigint, currency text, reason text,
  actor_id uuid, decided_at timestamptz, recorded_at timestamptz, is_current boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.purchase_limits', 'read', p_facility_id);
  perform erp.assert_stock_facility_named(p_facility_id);
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 decisions'
      using errcode = 'invalid_parameter_value', constraint = 'purchase_page_size';
  end if;

  return query
  select d.decision_id, d.seq, d.kind, d.limit_minor, d.currency, d.reason, d.actor_id, d.decided_at, d.recorded_at,
         m.as_of_decision_id is not null
    from erp.purchase_limit_decision d
    left join erp.purchase_limit m on m.as_of_decision_id = d.decision_id
   where d.facility_id = p_facility_id
     and (p_before_seq is null or d.seq < p_before_seq)
   order by d.seq desc
   limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capabilities (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('procurement.purchase_orders', 'Purchase orders', 'أوامر الشراء',
   array['PRC-001', 'PRC-004', 'PRC-006', 'INV-006', 'INV-007', 'MFG-012', 'PRG-014'], false,
   timestamptz '2026-10-07 00:00:00+00'),
  ('procurement.purchase_limits', 'Purchase approval limits', 'حدود اعتماد الشراء',
   array['PRC-002', 'IAM-005', 'PRG-014'], false,
   timestamptz '2026-10-07 00:00:00+00');

-- A real database's only role is the administrator (0011). 'approve' on orders is P3's: it
-- follows the role's scope, so a grant at one facility approves there alone. An administrator
-- holds write and approve, and still does not approve an order they raised (PRC-004): a real
-- database needs a second person holding approve, or a limit. Who else holds what is the
-- seed's business (0035) and the owner's open question (ADR-0032).
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'procurement.purchase_orders', 'read'),
  ('administrator', 'procurement.purchase_orders', 'write'),
  ('administrator', 'procurement.purchase_orders', 'approve'),
  ('administrator', 'procurement.purchase_limits', 'read'),
  ('administrator', 'procurement.purchase_limits', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the seven tables: writes through the routes, reads through the
-- gated functions. Not the helpers, the guards or the seam.
grant execute on function
  erp.raise_purchase_order(uuid, uuid, uuid, uuid, integer, jsonb, text, uuid, timestamptz),
  erp.decide_purchase_order(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.receive_purchase_order(uuid, uuid, uuid, timestamptz, jsonb, text, uuid, timestamptz),
  erp.reverse_purchase_receipt(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.set_purchase_limit(uuid, uuid, bigint, text, uuid, text, uuid, timestamptz),
  erp.clear_purchase_limit(uuid, uuid, uuid, text, uuid, timestamptz),
  erp.purchase_orders(uuid, uuid, text, bigint, integer),
  erp.get_purchase_order(uuid, uuid, uuid),
  erp.purchase_limit_history(uuid, uuid, bigint, integer)
to erp_app;

-- erp_read keeps 0002's default SELECT on all seven tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
do $$
declare
  t text;
begin
  foreach t in array array['purchase_limit_decision', 'purchase_limit', 'purchase_order_decision', 'purchase_order',
                           'purchase_order_line', 'purchase_receipt', 'purchase_receipt_line'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;
