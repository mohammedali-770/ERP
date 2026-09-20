-- 0006 · Projections, and the indexes that make conflicts detectable
--
-- Requirements: OMS-001 · PAY-015 · POS-028 · NFR-004 · OFF-009
-- Invariant I-3 — no financial fact is ever merged
--
-- These are projections: rebuildable from erp.event_log, never authoritative.
-- They are minimal on purpose — enough to carry the three partial unique
-- indexes, which are the point of this migration.
--
-- Under a genuine network partition two devices CAN both create a payment
-- intent. The design does not pretend to prevent that without a coordinator.
-- It guarantees DETECTION: the second writer fails the index and raises an
-- incident, rather than a last-writer-wins merge silently choosing one.
-- The three statements below are copied verbatim from
-- docs/architecture/core-transaction-design.md.

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

create table erp.orders (
  order_id        uuid primary key,
  order_number    text not null,
  branch_id       uuid not null references erp.facility (facility_id),
  sales_channel_id uuid references erp.sales_channel (sales_channel_id),
  business_date   date not null,
  state           text not null,
  -- Money is integer minor units with an explicit currency, never floating
  -- point (canonical-model.md). SAR has two minor units.
  total_minor     bigint not null default 0,
  currency        text not null default 'SAR' check (char_length(currency) = 3),
  opened_at       timestamptz not null,
  closed_at       timestamptz,
  as_of_event_id  uuid,
  unique (branch_id, order_number)
);

create table erp.payment_intents (
  payment_intent_id uuid primary key,
  order_id          uuid not null references erp.orders (order_id),
  state             text not null
    check (state in ('created','initiated','pending','unknown','captured','declined','cancelled','refunded','partially_refunded')),
  amount_minor      bigint not null check (amount_minor > 0),
  currency          text not null default 'SAR',
  created_at        timestamptz not null,
  as_of_event_id    uuid
);

create table erp.shifts (
  shift_id      uuid primary key,
  branch_id     uuid not null references erp.facility (facility_id),
  cashier_id    uuid not null,
  status        text not null check (status in ('open','closed','reconciled')),
  business_date date not null,
  opened_at     timestamptz not null,
  closed_at     timestamptz,
  as_of_event_id uuid
);

create table erp.drawer_assignments (
  drawer_assignment_id uuid primary key,
  drawer_id            uuid not null,
  shift_id             uuid not null references erp.shifts (shift_id),
  assigned_at          timestamptz not null,
  released_at          timestamptz,
  as_of_event_id       uuid
);

-- Verbatim from core-transaction-design.md. Do not "simplify" these into full
-- unique constraints: the WHERE clause is what permits history while forbidding
-- two live rows.
create unique index ux_one_live_intent on erp.payment_intents (order_id)
  where state in ('created','initiated','pending','unknown');
create unique index ux_one_open_shift on erp.shifts (branch_id, cashier_id)
  where status = 'open';
create unique index ux_one_open_drawer on erp.drawer_assignments (drawer_id)
  where released_at is null;

-- Projections are written by the projector and read by everything else. They
-- carry no DELETE grant: a projection is rebuilt by truncate-and-replay under
-- erp_owner, not deleted row by row by the application.
grant select, insert, update on
  erp.orders, erp.payment_intents, erp.shifts, erp.drawer_assignments
to erp_app;
