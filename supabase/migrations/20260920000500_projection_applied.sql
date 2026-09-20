-- 0005 · Projection idempotency
--
-- Requirements: OFF-009 · ADR-0003
--
-- Projections are rebuildable from the log and applied idempotently via a
-- (projection, event_id) key, so replay is always safe — including replay that
-- overlaps work already done, which is the normal case after a crash.

set local search_path = erp, extensions, pg_catalog;

create table erp.projection_applied (
  projection  text        not null,
  event_id    uuid        not null,
  applied_at  timestamptz not null default now(),
  primary key (projection, event_id)
);

comment on table erp.projection_applied is
  'Replay guard. An event already applied to a projection is skipped, not reapplied (ADR-0003).';

create table erp.projection_state (
  projection        text        primary key,
  last_event_id     uuid,
  last_business_date date,
  rebuilt_at        timestamptz,
  updated_at        timestamptz not null default now()
);

grant select, insert on erp.projection_applied to erp_app;
grant select, insert, update on erp.projection_state to erp_app;
