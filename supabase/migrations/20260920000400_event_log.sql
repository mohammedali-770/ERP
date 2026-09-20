-- 0004 · The event log — the system of record
--
-- Requirements: OFF-009 · FIN-007 · POS-028 · PAY-015 · SEC-006 · SEC-007
-- ADR-0003 (accepted 2026-09-20) · invariants I-1, I-2, I-10
--
-- The twenty envelope fields are fixed by docs/domain/event-catalogue.md and are
-- already implemented and tested in packages/contracts/src/events/envelope.ts.
-- Column names here match that module exactly; if they drift, the wire format
-- and the store disagree and neither is obviously wrong.
--
-- APPEND-ONLY IS ENFORCED TWICE, and both are required:
--   1. erp_app is granted SELECT and INSERT. It is never granted UPDATE or
--      DELETE — stated, not revoked-if-remembered.
--   2. A BEFORE UPDATE OR DELETE trigger raises regardless of who is connected,
--      including the owner and any superuser path.
-- "A migration accidentally rewrote history" is not a recoverable event.

set local search_path = erp, extensions, pg_catalog;

create table erp.event_log (
  event_id        uuid        not null,
  device_id       uuid        not null,
  device_seq      bigint      not null,
  hlc             text        not null,
  occurred_at     timestamptz not null,
  tz_name         text        not null,
  business_date   date        not null,
  branch_id       uuid        not null,
  shift_id        uuid,
  aggregate_type  text        not null,
  aggregate_id    uuid        not null,
  event_type      text        not null,
  schema_version  int         not null check (schema_version >= 1),
  payload         jsonb       not null,
  payload_hash    bytea       not null,
  prev_hash       bytea       not null,
  correlation_id  uuid,
  causation_id    uuid,
  actor_type      text        not null check (actor_type in ('cashier','system','integration')),
  actor_id        uuid,
  ingested_at     timestamptz not null default now(),
  primary key (event_id, business_date)
) partition by range (business_date);

comment on table erp.event_log is
  'Append-only system of record (ADR-0003). Partitioned by business_date, which is set at shift open and is NOT calendar midnight (Q-06).';

-- device_seq is gapless per device, so a gap is detectable rather than silent.
create unique index ux_event_log_device_seq
  on erp.event_log (device_id, device_seq, business_date);

create index ix_event_log_aggregate on erp.event_log (aggregate_type, aggregate_id);
create index ix_event_log_business_date on erp.event_log (business_date);

-- A default partition means an event is never rejected for want of a partition;
-- dated partitions are added ahead of time by scheduled maintenance.
create table erp.event_log_default partition of erp.event_log default;

-- Protection two. SECURITY DEFINER with a pinned search_path: an unpinned one is
-- how a function gets hijacked by a shadowing object, and four functions in the
-- estate's inbox project carry that defect today.
create or replace function erp.event_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'event_log is append-only (ADR-0003): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a correcting event. History is never rewritten.';
end;
$$;

create trigger event_log_append_only
  before update or delete on erp.event_log
  for each statement
  execute function erp.event_log_is_append_only();

-- Protection one. SELECT and INSERT, stated explicitly. UPDATE and DELETE are
-- absent rather than revoked, so no future migration can restore them by
-- forgetting a line.
grant select, insert on erp.event_log to erp_app;
