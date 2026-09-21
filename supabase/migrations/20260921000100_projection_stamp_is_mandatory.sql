-- 0009 · The projection stamp is mandatory
--
-- Requirements: PAY-015 · CRM-005 · OFF-009
-- Invariant I-8 — cached balances are verifiable against their ledger
--
-- I-8 says a materialised balance carries the event it was computed through,
-- "so it can always be checked". Migration 0006 added `as_of_event_id` to all
-- four projection tables and left it nullable on every one, so a projection row
-- could be written with no stamp at all — which is exactly the un-checkable
-- balance the invariant exists to forbid. An audit on 2026-09-21 found it;
-- this migration closes it.
--
-- A projection row is only ever produced by applying an event, so an identifier
-- is always available and NULL never means anything legitimate here.
--
-- WHY THERE IS NO FOREIGN KEY, since the next reader will look for one.
-- erp.event_log is `partition by range (business_date)` and its primary key is
-- therefore the composite (event_id, business_date). A single-column reference
-- from as_of_event_id cannot exist against that key; it would require carrying a
-- redundant business_date on each projection purely to satisfy the constraint.
-- That trade was considered and declined. The stamp is checked instead by
-- `projection-stamp-resolves-to-a-real-event` in tools/db-check — not by
-- structure, and said plainly here rather than left to be rediscovered as a gap.
--
-- erp.projection_state.last_event_id is deliberately NOT included: a projection
-- that has never applied an event has no last event, and that NULL is meaningful.

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

alter table erp.orders             alter column as_of_event_id set not null;
alter table erp.payment_intents    alter column as_of_event_id set not null;
alter table erp.shifts             alter column as_of_event_id set not null;
alter table erp.drawer_assignments alter column as_of_event_id set not null;

comment on column erp.orders.as_of_event_id is
  'The event this projection row was computed through (I-8). Mandatory: a row that cannot be checked against the log is the failure this column exists to prevent.';
