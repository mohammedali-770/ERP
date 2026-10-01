-- 0010 · The capability registry — what is exposed, and who decided
--
-- Requirements: CAP-P01 · CAP-P02 · CAP-P03 · CAP-P04 · CAP-P05 · CAP-P06
--               CAP-P07 · CAP-P08 · CAP-P12 · IAM-003 · IAM-006
-- ADR-0021 · invariant I-8 — a cached value carries the record it was computed through
--
-- An administrator exposes capabilities that are finished and withholds those still
-- under construction. Three things the request conflates are kept apart, and keeping
-- them apart is the whole design:
--
--   capability state  is this built and fit to use HERE?   set by an administrator
--   permission        may THIS USER do this action?        IAM-003 / IAM-006, untouched
--   visibility        does the menu render it?             a CONSEQUENCE, never a control
--
-- The effective rule is capability_open(scope) AND permission_granted(principal, …).
-- Neither implies the other: an open capability grants nobody anything, and a granted
-- permission does not open a closed capability.
--
-- WHY A SEPARATE DECISION LOG RATHER THAN erp.event_log, since that is the first
-- question a reader will have. erp.event_log is the BRANCH RUNTIME's log by
-- construction: device_id and device_seq are not null and gapless per device, there
-- is a per-device hash chain in prev_hash, branch_id and business_date are not null
-- and business_date is the partition key, and actor_type admits only
-- ('cashier','system','integration'). A capability decision is central and
-- administrative — no device, no position in any device's chain, no branch, no shift,
-- and no actor_type that fits. Putting it there needs a sentinel device and a
-- fabricated hash link, which is a fiction inside the system of record, and
-- packages/contracts/src/events/envelope.ts would then disagree with the store.
-- ADR-0003 exists to prevent exactly that. So central decisions get their own
-- append-only log, with the same double protection, and erp.event_log is untouched.
--
-- One thing this buys that the event log's projections cannot have: because
-- erp.capability_decision is NOT partitioned, its primary key is a single column, so
-- the projection's stamp is a REAL foreign key rather than a convention checked by a
-- tool. 20260921000100 explains why the four event-log projections cannot do that.

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

-- ---------------------------------------------------------------------------
-- The register (CAP-P01)
-- ---------------------------------------------------------------------------

create table erp.capability (
  capability_key   text        primary key,
  name_en          text        not null,
  name_ar          text        not null,
  -- The requirements this capability delivers. CAP-P09 reads these to refuse
  -- general availability while their evidence cannot be produced. Text rather
  -- than a foreign key: the catalogue lives in docs/requirements, not in the
  -- database, and a copy here would be a second place for it to drift.
  requirement_refs text[]      not null default '{}',
  -- CAP-P08. A protected capability cannot be closed through the application —
  -- the administration of capabilities, identity and audit must not be able to
  -- lock everyone out of itself.
  protected        boolean     not null default false,
  created_at       timestamptz not null default now()
);

comment on table erp.capability is
  'The register of capabilities (CAP-P01). A capability is a unit of function an administrator may expose or withhold; it is not a permission.';
comment on column erp.capability.protected is
  'CAP-P08. Protected capabilities are refused by erp.decide_capability() — the switch that would undo the lockout must not be behind the thing it closes.';

-- CAP-P07. Dependencies are recorded so a state change cannot leave an available
-- capability without one it needs. A separate table rather than an array, because
-- the edge is what gets checked and a self-edge is worth forbidding explicitly.
create table erp.capability_depends_on (
  capability_key text not null references erp.capability (capability_key),
  depends_on_key text not null references erp.capability (capability_key),
  primary key (capability_key, depends_on_key),
  constraint capability_does_not_depend_on_itself check (capability_key <> depends_on_key)
);

comment on table erp.capability_depends_on is
  'CAP-P07. Hard dependencies between capabilities. Checked when a state change would close something another available capability needs.';

-- ---------------------------------------------------------------------------
-- The decision log (CAP-P03, CAP-P12) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.capability_decision (
  decision_id    uuid        primary key,
  capability_key text        not null references erp.capability (capability_key),
  -- Scope. NULL facility means the whole organisation; a facility_id scopes the
  -- decision to one branch, warehouse or factory. CAP-P02 allows both.
  facility_id    uuid                 references erp.facility (facility_id),
  state          text        not null
    check (state in ('hidden','pilot','enabled','read_only','withdrawn')),
  -- CAP-P03 requires the actor, the time, the scope and a stated reason. The
  -- reason is not nullable and not blank: "who opened this the night the numbers
  -- moved" is the question this table exists to answer.
  reason         text        not null check (length(btrim(reason)) > 0),
  actor_id       uuid        not null,
  actor_type     text        not null check (actor_type in ('administrator','system')),
  decided_at     timestamptz not null,
  recorded_at    timestamptz not null default now()
);

comment on table erp.capability_decision is
  'Append-only record of every capability state change (CAP-P03, CAP-P12). Central decisions; erp.event_log is the branch runtime''s log and is deliberately not used — see this migration''s header.';
comment on column erp.capability_decision.facility_id is
  'NULL means the whole organisation. A value scopes the decision to one facility (CAP-P02).';

create index ix_capability_decision_key on erp.capability_decision (capability_key, decided_at desc);

-- Append-only, enforced twice, exactly as erp.event_log does it (0004):
--   1. erp_app is granted SELECT and INSERT and never UPDATE or DELETE — stated,
--      not revoked-if-remembered.
--   2. A trigger raises regardless of who is connected, including the owner.
-- A decision log that can be edited answers nothing.
create or replace function erp.capability_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'capability_decision is append-only (CAP-P03): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. A decision that was taken is not unmade by deleting the record of it.';
end;
$$;

create trigger capability_decision_append_only
  before update or delete on erp.capability_decision
  for each statement
  execute function erp.capability_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- The projection (CAP-P02) — current state, derived, never authoritative
-- ---------------------------------------------------------------------------

create table erp.capability_state (
  capability_key    text not null references erp.capability (capability_key),
  -- The all-zero UUID stands for organisation scope so that the primary key can
  -- include it. A nullable column in a primary key is not possible, and a partial
  -- unique index pair would permit a row that is scoped to both at once.
  facility_id       uuid not null,
  state             text not null
    check (state in ('hidden','pilot','enabled','read_only','withdrawn')),
  -- I-8. The decision this row was computed through. A REAL foreign key, which the
  -- event-log projections cannot have because erp.event_log's primary key is
  -- composite (20260921000100 explains it); this log is not partitioned, so the
  -- stamp is enforced by structure rather than by a tool.
  as_of_decision_id uuid not null references erp.capability_decision (decision_id),
  updated_at        timestamptz not null default now(),
  primary key (capability_key, facility_id)
);

comment on table erp.capability_state is
  'Current capability state per scope (CAP-P02). A projection: rebuildable from erp.capability_decision, never authoritative. A capability with no row here is hidden — the default is deny.';
comment on column erp.capability_state.as_of_decision_id is
  'The decision this row was computed through (I-8). Mandatory, and a real foreign key: a state nobody can trace to a decision is the failure this column exists to prevent.';
comment on column erp.capability_state.facility_id is
  'The all-zero UUID means organisation scope. Not nullable, because it is part of the primary key.';

-- ---------------------------------------------------------------------------
-- Resolution and admission (CAP-P02, CAP-P04, CAP-P05, CAP-P06)
-- ---------------------------------------------------------------------------

-- The sentinel for organisation scope, named once so no call site retypes it.
create or replace function erp.capability_org_scope()
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

-- CAP-P02: a capability with no recorded state resolves to hidden. The facility's
-- own state wins over the organisation's; absent both, hidden.
create or replace function erp.capability_state_for(p_capability_key text, p_facility_id uuid)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select s.state from erp.capability_state s
      where s.capability_key = p_capability_key and s.facility_id = p_facility_id),
    (select s.state from erp.capability_state s
      where s.capability_key = p_capability_key and s.facility_id = erp.capability_org_scope()),
    'hidden'
  );
$$;

comment on function erp.capability_state_for(text, uuid) is
  'CAP-P02. Resolves a capability''s state for a scope, facility before organisation, defaulting to hidden. Default-deny: exposure is always a recorded decision.';

-- CAP-P04. New work is admitted only when the capability is open. `enabled` and
-- `pilot` admit; `read_only` and `withdrawn` do not, which is CAP-P06 — their
-- history stays readable while new work stops. `hidden` never admits.
--
-- CAP-P05 is why this is named ADMIT rather than ALLOW: it governs a NEW command.
-- Work already accepted completes, synchronises and is recorded regardless, and
-- nothing here is consulted when an already-accepted event is applied.
create or replace function erp.capability_admits_new_work(p_capability_key text, p_facility_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select erp.capability_state_for(p_capability_key, p_facility_id) in ('enabled', 'pilot');
$$;

comment on function erp.capability_admits_new_work(text, uuid) is
  'CAP-P04/P05/P06. True when a NEW command may be accepted. read_only and withdrawn return false while their data stays readable; already-accepted work is never consulted against this.';

-- CAP-P04's teeth. A command handler calls this before minting anything, and it
-- raises rather than returning false, so a caller that forgets to check the return
-- value still cannot proceed.
create or replace function erp.assert_capability_admits(p_capability_key text, p_facility_id uuid)
returns void
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
begin
  if not erp.capability_admits_new_work(p_capability_key, p_facility_id) then
    raise exception
      'capability % is % for this scope and does not admit new work (CAP-P04)',
      p_capability_key, erp.capability_state_for(p_capability_key, p_facility_id)
      using errcode = 'restrict_violation',
            hint = 'An administrator must set it to enabled or pilot. Hiding a menu entry is not this control.';
  end if;
end;
$$;

comment on function erp.assert_capability_admits(text, uuid) is
  'CAP-P04. Raises unless the capability admits new work. Raises rather than returning, so a caller who ignores a result still cannot proceed.';

-- ---------------------------------------------------------------------------
-- Deciding (CAP-P03, CAP-P07, CAP-P08)
-- ---------------------------------------------------------------------------

-- The only admitted route to a state change: it appends the decision and advances
-- the projection in one transaction, so a state without a decision cannot exist.
-- erp_app has no direct write privilege on erp.capability_state, so this is not
-- advisory — there is no other way in.
create or replace function erp.decide_capability(
  p_decision_id    uuid,
  p_capability_key text,
  p_facility_id    uuid,
  p_state          text,
  p_reason         text,
  p_actor_id       uuid,
  p_actor_type     text,
  p_decided_at     timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_scope   uuid := coalesce(p_facility_id, erp.capability_org_scope());
  v_blocker text;
begin
  -- CAP-P08. Protected capabilities are not closable through the application.
  if p_state <> 'enabled'
     and exists (select 1 from erp.capability c
                  where c.capability_key = p_capability_key and c.protected) then
    raise exception
      'capability % is protected and cannot be closed through the application (CAP-P08)',
      p_capability_key
      using errcode = 'restrict_violation',
            hint = 'Protected capabilities administer capabilities, identity and audit. Closing one would remove the means to reopen it.';
  end if;

  -- CAP-P07. Refuse a change that would leave an available capability without one
  -- it depends on. Checked before the append, so the log holds no decision that
  -- was never in force.
  if p_state not in ('enabled', 'pilot') then
    select d.capability_key into v_blocker
    from erp.capability_depends_on d
    where d.depends_on_key = p_capability_key
      and erp.capability_admits_new_work(d.capability_key, v_scope)
    limit 1;

    if v_blocker is not null then
      raise exception
        'capability % cannot be set % because % depends on it and is still open (CAP-P07)',
        p_capability_key, p_state, v_blocker
        using errcode = 'restrict_violation',
              hint = 'Close the dependent capability first, or leave this one open.';
    end if;
  end if;

  insert into erp.capability_decision (
    decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, p_capability_key, p_facility_id, p_state, p_reason, p_actor_id, p_actor_type, p_decided_at
  );

  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values (p_capability_key, v_scope, p_state, p_decision_id)
  on conflict (capability_key, facility_id) do update
    set state = excluded.state,
        as_of_decision_id = excluded.as_of_decision_id,
        updated_at = now();
end;
$$;

comment on function erp.decide_capability(uuid, text, uuid, text, text, uuid, text, timestamptz) is
  'CAP-P03. The only admitted route to a capability state change: appends the decision and advances the projection in one transaction, so a state with no decision behind it cannot exist.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- erp_read gets SELECT automatically from 0002's default privileges. erp_app's
-- rights are stated here, in the migration that creates the tables, in the diff a
-- human reviews.
--
-- Note what erp_app does NOT get: no write of any kind on erp.capability_state.
-- The projection is advanced only by erp.decide_capability(), which is SECURITY
-- DEFINER. That is what makes CAP-P04 structural rather than advisory — there is
-- no route by which the runtime can set a state without recording the decision.
grant select, insert on erp.capability_decision to erp_app;
grant select on erp.capability, erp.capability_depends_on, erp.capability_state to erp_app;
grant execute on function
  erp.capability_state_for(text, uuid),
  erp.capability_admits_new_work(text, uuid),
  erp.assert_capability_admits(text, uuid),
  erp.capability_org_scope(),
  erp.decide_capability(uuid, text, uuid, text, text, uuid, text, timestamptz)
to erp_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- 0008 ran once over the tables that existed then. It is not an event trigger and
-- does not re-run, so a table created later gets no RLS and no policies — which
-- fails db-check's rls-enabled-on-every-erp-table, and, because RLS is FORCED,
-- would deny erp_app despite its grants. Stated per table here.
do $$
declare
  t text;
begin
  foreach t in array array['capability', 'capability_depends_on', 'capability_decision', 'capability_state'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;

-- The policies mirror the grants rather than widening them (0008's rule). erp_app
-- may read all four and insert decisions; it has no policy permitting a write to
-- the register, the dependency edges or the state projection, because it has no
-- grant for one either.
create policy erp_app_read on erp.capability          for select to erp_app using (true);
create policy erp_app_read on erp.capability_depends_on for select to erp_app using (true);
create policy erp_app_read on erp.capability_state    for select to erp_app using (true);
create policy erp_app_read on erp.capability_decision for select to erp_app using (true);
create policy erp_app_append on erp.capability_decision for insert to erp_app with check (true);
