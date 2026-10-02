-- 0011 · Identity — who a person is, what they may do, and how a branch worker signs in
--
-- Requirements: IAM-001 · IAM-003 · IAM-006 · IAM-008 · IAM-009 · SEC-003 · SEC-004
--               SEC-006 · CAP-P04 · CAP-P06 · CAP-P08 · IAM-P01 · IAM-P02 · IAM-P03
--               IAM-P04 · IAM-P05 · IAM-P06 · IAM-P07 · IAM-P08
-- ADR-0022 (proposed) · ADR-0021 · invariant I-8
--
-- 0010's header states the rule the whole system runs on:
--
--   capability_open(scope) AND permission_granted(principal, …)
--
-- and only the left half existed, because the ERP had no person. Three columns named
-- an actor with nothing to refer to: erp.shifts.cashier_id, erp.event_log.actor_id
-- and erp.capability_decision.actor_id. This migration supplies the referent and the
-- right half, in the same shape 0010 used for the left: an append-only decision log,
-- projections stamped with a real foreign key (I-8), and one admitted writer for
-- each change.
--
-- WHAT IS NOT HERE. No sign-in session, token or endpoint. erp.verify_pin() answers
-- whether an employee number and PIN match; nothing yet turns that answer into a
-- session, because nothing yet names what holds the erp_app credential (Q-21). So the
-- functions below check that the actor a caller NAMES is permitted — they cannot yet
-- check that the named actor is the one actually connected. That is the session
-- layer's job, and it is stated here so nobody reads more into this than it does.
--
-- WHY NOT SUPABASE AUTH. Not a preference: supabase/ references the auth schema
-- nowhere, anon and authenticated hold no USAGE on erp, and adopting auth.uid() would
-- break four named db-check assertions. ADR-0022 records it.
--
-- PERSONAL DATA STAYS OUT OF THE LOG. erp.identity_decision records decisions about a
-- subject by identifier only. Names and employee numbers live on erp.person, which is
-- mutable, because an append-only table cannot honour an erasure request (SEC-008)
-- and this one is append-only by design. So erp.person is not rebuildable from the log
-- in full: its STATUS is decided and stamped, its attributes are reference data.

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

-- ---------------------------------------------------------------------------
-- Named constants
-- ---------------------------------------------------------------------------

-- The organisation-scope sentinel, now named once for everything that scopes.
-- erp.capability_org_scope() keeps working as a wrapper rather than a second copy of
-- the literal, so a scope stated by the registry and one stated by a role assignment
-- are the same value by construction.
create or replace function erp.org_scope()
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create or replace function erp.capability_org_scope()
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select erp.org_scope() $$;

-- The system principal. erp.capability_decision.actor_type admits 'system', and its
-- actor_id is NOT NULL, so a decision taken by the system needs a person row to name.
-- Exactly one exists, it is created below by this migration, and it can hold neither
-- a credential nor a role — so it can be named as an actor and can never sign in or
-- be granted anything.
create or replace function erp.system_principal()
returns uuid
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

-- ---------------------------------------------------------------------------
-- The decision log (IAM-008) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.identity_decision (
  decision_id       uuid        primary key,
  kind              text        not null check (kind in (
                                  'bootstrap', 'person_created', 'status_changed',
                                  'role_granted', 'role_revoked',
                                  'credential_set', 'credential_unlocked')),
  -- NO foreign key, deliberately. This is the log that CREATES the referent: the
  -- bootstrap decision genuinely precedes the first person. Every other log
  -- references erp.person; this one cannot. 0020_awkward_cases.sql explains the same
  -- shape for as_of_event_id.
  subject_person_id uuid        not null,
  status            text        check (status in ('active', 'suspended', 'terminated')),
  role_key          text,
  -- NULL means organisation-wide. The projection uses erp.org_scope() instead,
  -- because a nullable column cannot be part of a primary key.
  scope_facility_id uuid        references erp.facility (facility_id),
  reason            text        not null check (length(btrim(reason)) > 0),
  actor_id          uuid        not null,
  actor_type        text        not null check (actor_type in ('administrator', 'system')),
  decided_at        timestamptz not null,
  recorded_at       timestamptz not null default now(),
  -- Each kind carries what it decides, and nothing it does not.
  constraint identity_decision_shape check (
    case kind
      when 'bootstrap'      then status = 'active' and role_key is not null
      when 'person_created' then status is not null and role_key is null
      when 'status_changed' then status is not null and role_key is null
      when 'role_granted'   then role_key is not null and status is null
      when 'role_revoked'   then role_key is not null and status is null
      else status is null and role_key is null
    end
  )
);

comment on table erp.identity_decision is
  'Append-only record of every identity decision (IAM-008): who exists, their status, their roles and their credentials. Identifiers only — personal data stays on erp.person, which can be erased.';
comment on column erp.identity_decision.subject_person_id is
  'No foreign key: this log creates the referent, so the first decision precedes the first person.';

create index ix_identity_decision_subject on erp.identity_decision (subject_person_id, decided_at desc);

-- Append-only, enforced twice, as 0004 and 0010 do it: the runtime is granted no
-- UPDATE or DELETE, and a trigger raises regardless of who is connected.
create or replace function erp.identity_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'identity_decision is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. Who was granted what, and by whom, is not unmade by deleting the record of it.';
end;
$$;

create trigger identity_decision_append_only
  before update or delete on erp.identity_decision
  for each statement
  execute function erp.identity_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- People, roles and permissions
-- ---------------------------------------------------------------------------

create table erp.person (
  person_id           uuid        primary key,
  -- IAM-001 and IAM-P01. The sign-in handle for an employee, and absent for the
  -- system principal, which signs in to nothing.
  employee_number     text        unique check (employee_number ~ '^[0-9]{1,10}$'),
  full_name_en        text        not null,
  full_name_ar        text        not null,
  person_type         text        not null check (person_type in ('employee', 'service')),
  -- IAM-009 and IAM-P05. A person is disabled, never deleted (IAM-P06): the rows that
  -- name them must go on naming someone. B-11 records the system that did otherwise.
  status              text        not null check (status in ('active', 'suspended', 'terminated')),
  primary_facility_id uuid        references erp.facility (facility_id),
  -- I-8. The decision that set this person's current status.
  as_of_decision_id   uuid        not null references erp.identity_decision (decision_id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint person_employee_has_a_number check ((person_type = 'employee') = (employee_number is not null))
);

comment on table erp.person is
  'Everyone the ERP can name as an actor (IAM-001). Disabled, never deleted (IAM-P06). A projection for status, stamped with the decision that set it; reference data for name and number.';

create table erp.role (
  role_key   text        primary key,
  name_en    text        not null,
  name_ar    text        not null,
  -- A protected role cannot lose its last active holder through the application,
  -- for the same reason as CAP-P08: the means of administration must not be able to
  -- remove itself.
  protected  boolean     not null default false,
  created_at timestamptz not null default now()
);

-- IAM-003. What a role may do, per capability and action. A capability is not a
-- permission (0010's header); this table is where the two meet.
create table erp.role_permission (
  role_key       text not null references erp.role (role_key),
  capability_key text not null references erp.capability (capability_key),
  action         text not null check (action in ('read', 'write', 'approve')),
  primary key (role_key, capability_key, action)
);

-- IAM-006. Assignments are scoped: a facility grants there only; erp.org_scope()
-- grants everywhere. Many per person, unlike the single profiles.role the warehouse
-- system carried.
create table erp.person_role (
  person_id         uuid        not null references erp.person (person_id),
  role_key          text        not null references erp.role (role_key),
  scope_facility_id uuid        not null,
  as_of_decision_id uuid        not null references erp.identity_decision (decision_id),
  updated_at        timestamptz not null default now(),
  primary key (person_id, role_key, scope_facility_id)
);

comment on column erp.person_role.scope_facility_id is
  'The all-zero UUID (erp.org_scope()) means organisation-wide. Not nullable, because it is part of the primary key — the shape erp.capability_state already uses.';

-- ---------------------------------------------------------------------------
-- Credentials (IAM-P01..IAM-P04, IAM-P08) — reachable by no role but the owner
-- ---------------------------------------------------------------------------

-- The PIN as a bcrypt hash, and the lockout counters. erp_app holds NO privilege on
-- this table at all: erp.verify_pin() is SECURITY DEFINER and answers with a status,
-- so the runtime can check a PIN without ever being able to read a hash.
create table erp.person_credential (
  person_id         uuid        primary key references erp.person (person_id),
  pin_hash          text        not null,
  failed_attempts   integer     not null default 0 check (failed_attempts >= 0),
  locked_until      timestamptz,
  -- The decision that set or unlocked this credential. The counters move without a
  -- decision — a wrong PIN is an event at a device, not an administrative act.
  as_of_decision_id uuid        not null references erp.identity_decision (decision_id),
  updated_at        timestamptz not null default now()
);

-- IAM-P02. Wrong attempts against employee numbers that have no credential, counted
-- exactly as a real account's are, so the answer, the countdown and the lock cannot
-- tell an unknown number from a known one. The warehouse system's design, kept.
create table erp.credential_miss (
  employee_number text        primary key check (employee_number ~ '^[0-9]{1,10}$'),
  failed_attempts integer     not null default 0 check (failed_attempts >= 0),
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

create index ix_credential_miss_updated on erp.credential_miss (updated_at);

-- ---------------------------------------------------------------------------
-- The three actors, given a referent
-- ---------------------------------------------------------------------------

-- A person who held a shift cannot be deleted. ON DELETE NO ACTION, the default,
-- stated: B-11 is a system whose actor reference nulled on delete and so rewrote
-- every movement a departed employee made to "nobody".
alter table erp.shifts
  add constraint shifts_cashier_is_a_person
  foreign key (cashier_id) references erp.person (person_id) on delete no action;

-- Adding a constraint is not an UPDATE or DELETE, so the append-only trigger does not
-- fire. The decision log already holds no rows when this runs on a fresh database.
alter table erp.capability_decision
  add constraint capability_decision_actor_is_a_person
  foreign key (actor_id) references erp.person (person_id) on delete no action;

-- erp.event_log.actor_id gets NO foreign key, deliberately. Its actor_type admits
-- 'integration', whose identifier is not a person; envelope.ts declares actor_id
-- nullable unconditionally and 0004 says store and wire format must not drift; and
-- I-5 forbids an operational write that depends on a central lookup. The referent is
-- stated in ADR-0022 instead and CHECKED BY A TOOL: db-check's
-- cashier-actors-resolve-to-a-person.

-- ---------------------------------------------------------------------------
-- Permission (IAM-003, IAM-006) — the right half of the rule
-- ---------------------------------------------------------------------------

-- The function 0010's header names. A facility-scoped assignment grants at that
-- facility only; an organisation-wide one grants everywhere. A person who is not
-- active is granted nothing, whatever they hold (IAM-P05).
create or replace function erp.permission_granted(
  p_person_id      uuid,
  p_capability_key text,
  p_action         text,
  p_facility_id    uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from erp.person p
    join erp.person_role pr     on pr.person_id = p.person_id
    join erp.role_permission rp on rp.role_key = pr.role_key
    where p.person_id = p_person_id
      and p.status = 'active'
      and rp.capability_key = p_capability_key
      and rp.action = p_action
      and (pr.scope_facility_id = erp.org_scope() or pr.scope_facility_id = p_facility_id)
  );
$$;

comment on function erp.permission_granted(uuid, text, text, uuid) is
  'IAM-003/IAM-006. True when an active person holds the action on the capability at this facility, through a facility-scoped or organisation-wide role. Says nothing about whether the capability is open — see erp.assert_permitted().';

-- THE GATE. Both halves of the rule in one call, so a command handler cannot apply
-- one and forget the other. Raises rather than returning, as
-- erp.assert_capability_admits() does, so a caller who ignores a result still cannot
-- proceed.
--
-- Reading is admitted by any state but hidden (CAP-P06: the history of a read_only or
-- withdrawn capability stays readable). Anything else is new work and needs the
-- capability open (CAP-P04).
create or replace function erp.assert_permitted(
  p_person_id      uuid,
  p_capability_key text,
  p_action         text,
  p_facility_id    uuid
)
returns void
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_action = 'read' then
    if erp.capability_state_for(p_capability_key, p_facility_id) = 'hidden' then
      raise exception 'capability % is hidden for this scope (CAP-P02)', p_capability_key
        using errcode = 'restrict_violation';
    end if;
  else
    perform erp.assert_capability_admits(p_capability_key, p_facility_id);
  end if;

  if not erp.permission_granted(p_person_id, p_capability_key, p_action, p_facility_id) then
    raise exception
      'person % may not % on capability % here (IAM-003)', p_person_id, p_action, p_capability_key
      using errcode = 'restrict_violation',
            hint = 'An open capability grants nobody anything. A role holding this action must be assigned at this scope.';
  end if;
end;
$$;

comment on function erp.assert_permitted(uuid, text, text, uuid) is
  'The effective rule: capability open AND permission granted. Raises restrict_violation if either fails. Neither half implies the other.';

-- What a role may do, so "View as" can be computed from the role itself rather than
-- by impersonating someone who holds it (CAP-P11).
create or replace function erp.role_permissions(p_role_key text)
returns table (capability_key text, action text)
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select rp.capability_key, rp.action
  from erp.role_permission rp
  where rp.role_key = p_role_key
  order by rp.capability_key, rp.action;
$$;

-- ---------------------------------------------------------------------------
-- Signing in (IAM-P01..IAM-P05)
-- ---------------------------------------------------------------------------

-- The warehouse system's verify_worker_pin(), kept nearly constant for constant:
-- six digits, five misses, fifteen minutes, bcrypt, and unknown numbers answering
-- exactly as known ones do. Answers, as jsonb:
--
--   {status: 'ok', person_id}        the PIN matched an active person
--   {status: 'wrong', attempts_left} for a wrong PIN AND for an unknown number
--   {status: 'locked', locked_until} after five misses, for either
--   {status: 'disabled'}             only after a CORRECT PIN, so it reveals nothing
--                                    to someone who does not hold the PIN
--
-- Two deliberate departures:
--
-- NO CLOCK PARAMETER. It reads now(). A p_now argument would make the lockout easy
-- to test, and would equally let any caller holding EXECUTE step past it. The pgTAP
-- suite tests expiry by moving locked_until instead.
--
-- THE FORMAT IS CHECKED HERE, not only in an edge function that may be replaced.
-- A malformed employee number is refused before anything is read or counted: the
-- format is public, so that reveals nothing about who exists, and it stops arbitrary
-- strings filling the miss table.
create or replace function erp.verify_pin(p_employee_number text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_max_attempts constant integer  := 5;
  c_lock         constant interval := interval '15 minutes';
  v_person erp.person;
  v_cred   erp.person_credential;
  v_miss   erp.credential_miss;
begin
  if p_employee_number is null or p_employee_number !~ '^[0-9]{1,10}$' then
    return jsonb_build_object('status', 'wrong');
  end if;

  select * into v_person from erp.person
   where employee_number = p_employee_number and person_type = 'employee';
  if found then
    select * into v_cred from erp.person_credential
     where person_id = v_person.person_id
     for update;
  end if;

  -- No credential: an unknown number, or a person with no PIN set. Counted under the
  -- number, with the same bcrypt work a real check costs, so neither the answer, the
  -- countdown, the lock nor the time taken tells the two apart.
  if v_cred.person_id is null then
    delete from erp.credential_miss where updated_at < now() - interval '1 day';
    insert into erp.credential_miss (employee_number) values (p_employee_number)
      on conflict (employee_number) do nothing;
    select * into v_miss from erp.credential_miss
     where employee_number = p_employee_number
     for update;

    if v_miss.locked_until is not null then
      if v_miss.locked_until > now() then
        return jsonb_build_object('status', 'locked', 'locked_until', v_miss.locked_until);
      end if;
      v_miss.failed_attempts := 0;
      v_miss.locked_until := null;
    end if;

    if p_pin ~ '^[0-9]{6}$' then
      perform extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
    end if;

    v_miss.failed_attempts := v_miss.failed_attempts + 1;
    if v_miss.failed_attempts >= c_max_attempts then
      v_miss.locked_until := now() + c_lock;
    end if;
    update erp.credential_miss
       set failed_attempts = v_miss.failed_attempts,
           locked_until    = v_miss.locked_until,
           updated_at      = now()
     where employee_number = p_employee_number;

    if v_miss.locked_until is not null then
      return jsonb_build_object('status', 'locked', 'locked_until', v_miss.locked_until);
    end if;
    return jsonb_build_object('status', 'wrong', 'attempts_left', c_max_attempts - v_miss.failed_attempts);
  end if;

  -- A real credential. A lock that is still running answers 'locked' even to the
  -- correct PIN; one that has run out starts the count again.
  if v_cred.locked_until is not null then
    if v_cred.locked_until > now() then
      return jsonb_build_object('status', 'locked', 'locked_until', v_cred.locked_until);
    end if;
    v_cred.failed_attempts := 0;
    v_cred.locked_until := null;
  end if;

  if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, v_cred.pin_hash) = v_cred.pin_hash then
    update erp.person_credential
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where person_id = v_cred.person_id;
    -- IAM-P05. Checked AFTER the PIN, so only someone holding it learns the account
    -- is disabled — and checked at all, so a suspended person never gets 'ok'.
    if v_person.status <> 'active' then
      return jsonb_build_object('status', 'disabled');
    end if;
    return jsonb_build_object('status', 'ok', 'person_id', v_person.person_id);
  end if;

  v_cred.failed_attempts := v_cred.failed_attempts + 1;
  if v_cred.failed_attempts >= c_max_attempts then
    v_cred.locked_until := now() + c_lock;
  end if;
  update erp.person_credential
     set failed_attempts = v_cred.failed_attempts,
         locked_until    = v_cred.locked_until,
         updated_at      = now()
   where person_id = v_cred.person_id;

  if v_cred.locked_until is not null then
    return jsonb_build_object('status', 'locked', 'locked_until', v_cred.locked_until);
  end if;
  return jsonb_build_object('status', 'wrong', 'attempts_left', c_max_attempts - v_cred.failed_attempts);
end;
$$;

comment on function erp.verify_pin(text, text) is
  'IAM-P01..P05. Checks an employee number and PIN; answers ok | wrong | locked | disabled. Unknown numbers answer exactly as wrong PINs do. Reads now() and takes no clock, so no caller can step past a lock.';

-- ---------------------------------------------------------------------------
-- Administering identity — each change has exactly one admitted route
-- ---------------------------------------------------------------------------

-- Every function below is SECURITY DEFINER, appends its decision and advances the
-- projection in one transaction, and first asks erp.assert_permitted() whether the
-- named actor may administer identity at all. erp_app holds no write on any
-- projection, so these are not advisory: there is no other way in.

-- A protected role must keep at least one active holder. Serialised, because two
-- concurrent removals of the last two administrators would each see the other.
create or replace function erp.assert_protected_role_keeps_a_holder(
  p_person_id uuid,
  p_role_key  text
)
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if not exists (select 1 from erp.role r where r.role_key = p_role_key and r.protected) then
    return;
  end if;
  if not exists (
    select 1
    from erp.person_role pr
    join erp.person p on p.person_id = pr.person_id
    where pr.role_key = p_role_key
      and pr.scope_facility_id = erp.org_scope()
      and p.status = 'active'
      and p.person_id <> p_person_id
  ) then
    raise exception
      'role % would be left with no active holder (CAP-P08)', p_role_key
      using errcode = 'restrict_violation',
            hint = 'Grant the role to another active person first. The means of administration must not be able to remove itself.';
  end if;
end;
$$;

create or replace function erp.create_person(
  p_decision_id         uuid,
  p_person_id           uuid,
  p_employee_number     text,
  p_full_name_en        text,
  p_full_name_ar        text,
  p_primary_facility_id uuid,
  p_reason              text,
  p_actor_id            uuid,
  p_decided_at          timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, status, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'person_created', p_person_id, 'active', p_reason, p_actor_id, 'administrator', p_decided_at
  );

  insert into erp.person (
    person_id, employee_number, full_name_en, full_name_ar, person_type, status,
    primary_facility_id, as_of_decision_id
  ) values (
    p_person_id, p_employee_number, p_full_name_en, p_full_name_ar, 'employee', 'active',
    p_primary_facility_id, p_decision_id
  );
end;
$$;

-- IAM-009 and IAM-P05/P06. Suspension and termination are status changes, never
-- deletions.
create or replace function erp.change_person_status(
  p_decision_id uuid,
  p_person_id   uuid,
  p_status      text,
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
  v_role text;
begin
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);
  perform pg_advisory_xact_lock(hashtext('erp.protected_roles'));

  if p_status <> 'active' then
    for v_role in select pr.role_key from erp.person_role pr where pr.person_id = p_person_id loop
      perform erp.assert_protected_role_keeps_a_holder(p_person_id, v_role);
    end loop;
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, status, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'status_changed', p_person_id, p_status, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  update erp.person
     set status = p_status, as_of_decision_id = p_decision_id, updated_at = now()
   where person_id = p_person_id and person_type = 'employee';
  if not found then
    raise exception 'no employee % to change', p_person_id using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function erp.grant_role(
  p_decision_id uuid,
  p_person_id   uuid,
  p_role_key    text,
  p_facility_id uuid,
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
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);

  if not exists (select 1 from erp.person p where p.person_id = p_person_id and p.person_type = 'employee') then
    raise exception 'roles are granted to employees only; % is not one', p_person_id
      using errcode = 'restrict_violation';
  end if;
  -- A protected role is organisation-wide or nothing: a facility-scoped
  -- administrator would count towards nobody's last-holder check.
  if p_facility_id is not null
     and exists (select 1 from erp.role r where r.role_key = p_role_key and r.protected) then
    raise exception 'role % is protected and is granted organisation-wide only', p_role_key
      using errcode = 'restrict_violation';
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, role_key, scope_facility_id, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'role_granted', p_person_id, p_role_key, p_facility_id, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  insert into erp.person_role (person_id, role_key, scope_facility_id, as_of_decision_id)
  values (p_person_id, p_role_key, coalesce(p_facility_id, erp.org_scope()), p_decision_id)
  on conflict (person_id, role_key, scope_facility_id) do update
    set as_of_decision_id = excluded.as_of_decision_id, updated_at = now();
end;
$$;

create or replace function erp.revoke_role(
  p_decision_id uuid,
  p_person_id   uuid,
  p_role_key    text,
  p_facility_id uuid,
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
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);
  perform pg_advisory_xact_lock(hashtext('erp.protected_roles'));

  if p_facility_id is null then
    perform erp.assert_protected_role_keeps_a_holder(p_person_id, p_role_key);
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, role_key, scope_facility_id, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'role_revoked', p_person_id, p_role_key, p_facility_id, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  -- The projection row goes; the decision that granted it and the one that revoked
  -- it both remain in the log.
  delete from erp.person_role
   where person_id = p_person_id
     and role_key = p_role_key
     and scope_facility_id = coalesce(p_facility_id, erp.org_scope());
end;
$$;

-- IAM-P04. Six digits, hashed with bcrypt at cost 10, and nothing stored or logged
-- in clear — not in the decision, not in an error message.
create or replace function erp.set_pin(
  p_decision_id uuid,
  p_person_id   uuid,
  p_pin         text,
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
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);

  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'a PIN is exactly six digits (IAM-P04)'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from erp.person p where p.person_id = p_person_id and p.person_type = 'employee') then
    raise exception 'a PIN is set for an employee only; % is not one', p_person_id
      using errcode = 'restrict_violation';
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'credential_set', p_person_id, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  insert into erp.person_credential (person_id, pin_hash, as_of_decision_id)
  values (p_person_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), p_decision_id)
  on conflict (person_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        as_of_decision_id = excluded.as_of_decision_id,
        updated_at = now();
end;
$$;

create or replace function erp.unlock_credential(
  p_decision_id uuid,
  p_person_id   uuid,
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
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'credential_unlocked', p_person_id, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  update erp.person_credential
     set failed_attempts = 0, locked_until = null,
         as_of_decision_id = p_decision_id, updated_at = now()
   where person_id = p_person_id;
  if not found then
    raise exception 'no credential for %', p_person_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- IAM-P07. The first administrator, or a replacement when none is active — and only
-- then. The warehouse system's make_first_admin() had the same guard; this one is
-- serialised, records a decision, and is executable by the owner alone: erp_app is
-- never granted it, and the PUBLIC revoke under Privileges below is what makes that
-- true — 0002's default privileges did not, as that section explains.
create or replace function erp.bootstrap_administrator(
  p_decision_id     uuid,
  p_person_id       uuid,
  p_employee_number text,
  p_full_name_en    text,
  p_full_name_ar    text,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('erp.protected_roles'));

  if exists (
    select 1
    from erp.person_role pr
    join erp.person p on p.person_id = pr.person_id
    where pr.role_key = 'administrator' and p.status = 'active'
  ) then
    raise exception 'an active administrator already exists (IAM-P07)'
      using errcode = 'restrict_violation',
            hint = 'Grant the role through erp.grant_role() as that administrator.';
  end if;

  -- An existing EMPLOYEE is reactivated: that is the recovery path. Anyone else —
  -- the system principal above all — is refused. Without this, the on-conflict
  -- branch below kept a service identity as it was and made it an administrator,
  -- bypassing grant_role()'s employee-only guard; and because that row is active,
  -- every later bootstrap was refused, leaving no human able to administer
  -- anything. Found in review on PR #28.
  if exists (select 1 from erp.person p
              where p.person_id = p_person_id and p.person_type <> 'employee') then
    raise exception 'only an employee can be bootstrapped as administrator; % is not one (IAM-P07)', p_person_id
      using errcode = 'restrict_violation';
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, status, role_key, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'bootstrap', p_person_id, 'active', 'administrator', p_reason,
    erp.system_principal(), 'system', now()
  );

  insert into erp.person (
    person_id, employee_number, full_name_en, full_name_ar, person_type, status, as_of_decision_id
  ) values (
    p_person_id, p_employee_number, p_full_name_en, p_full_name_ar, 'employee', 'active', p_decision_id
  )
  on conflict (person_id) do update
    set status = 'active', as_of_decision_id = excluded.as_of_decision_id, updated_at = now();

  insert into erp.person_role (person_id, role_key, scope_facility_id, as_of_decision_id)
  values (p_person_id, 'administrator', erp.org_scope(), p_decision_id)
  on conflict (person_id, role_key, scope_facility_id) do update
    set as_of_decision_id = excluded.as_of_decision_id, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Closing the loop on 0010: a capability decision now needs a permitted actor
-- ---------------------------------------------------------------------------

-- 0010 recorded who decided, but could not ask whether they were allowed to: there
-- was no person to ask about. The body is 0010's unchanged except for the two checks
-- at the top. Without them, permission_granted() would gate nothing in the database,
-- which is the exact failure CAP-P04 names.
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
  -- Through the application, a decision is an administrator's. 'system' decisions are
  -- taken by migrations, as the owner, and never through this function — otherwise a
  -- caller could claim 'system' and skip the permission check below.
  if p_actor_type <> 'administrator' then
    raise exception 'a capability decision through the application is taken by an administrator'
      using errcode = 'restrict_violation';
  end if;
  perform erp.assert_permitted(p_actor_id, 'platform.capability_admin', 'write', null);

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

-- ---------------------------------------------------------------------------
-- Structural rows — what a real database needs before anyone can decide anything
-- ---------------------------------------------------------------------------

-- These are not sample data, which is why they are here and not in a seed. Without
-- them a bootstrapped administrator in a real database could do nothing: the
-- capabilities that administer capabilities and identity would not exist, so both
-- would resolve to hidden and every decision would be refused.
--
-- The append-only rows carry a LITERAL time, the date of this migration. now() would
-- make two builds of the same files differ (db-check compares them), and
-- 0090_freeze_timestamps.sql cannot reach an append-only table to correct it.

insert into erp.identity_decision (
  decision_id, kind, subject_person_id, status, reason, actor_id, actor_type, decided_at, recorded_at
) values (
  '00000000-0000-0000-0000-00000000d001', 'person_created', erp.system_principal(), 'active',
  'The system principal: the actor named by decisions the system takes itself. Holds no credential and no role.',
  erp.system_principal(), 'system',
  timestamptz '2026-10-02 00:00:00+00', timestamptz '2026-10-02 00:00:00+00'
);

insert into erp.person (
  person_id, employee_number, full_name_en, full_name_ar, person_type, status, as_of_decision_id
) values (
  erp.system_principal(), null, 'System', 'النظام', 'service', 'active',
  '00000000-0000-0000-0000-00000000d001'
);

insert into erp.role (role_key, name_en, name_ar, protected) values
  ('administrator', 'Administrator', 'مسؤول النظام', true);

-- CAP-P08: the capabilities that administer capabilities and identity are
-- protected. platform.capability_admin was seeded by 0030 until now; it moves here
-- because a real database needs it as much as a development one does.
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected) values
  ('platform.capability_admin', 'Capability administration', 'إدارة القدرات',
   array['CAP-P01','CAP-P08'], true),
  ('platform.identity_admin',   'Identity administration',   'إدارة الهوية',
   array['IAM-003','IAM-006','IAM-009','CAP-P08'], true);

insert into erp.capability_decision (
  decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at, recorded_at
) values
  ('00000000-0000-0000-0000-00000000c001', 'platform.capability_admin', null, 'enabled',
   'Protected: administration must be reachable before anything else can be decided.',
   erp.system_principal(), 'system',
   timestamptz '2026-10-02 00:00:00+00', timestamptz '2026-10-02 00:00:00+00'),
  ('00000000-0000-0000-0000-00000000c002', 'platform.identity_admin', null, 'enabled',
   'Protected: identity must be administrable before anyone else can be admitted.',
   erp.system_principal(), 'system',
   timestamptz '2026-10-02 00:00:00+00', timestamptz '2026-10-02 00:00:00+00');

insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id) values
  ('platform.capability_admin', erp.org_scope(), 'enabled', '00000000-0000-0000-0000-00000000c001'),
  ('platform.identity_admin',   erp.org_scope(), 'enabled', '00000000-0000-0000-0000-00000000c002');

insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'platform.capability_admin', 'read'),
  ('administrator', 'platform.capability_admin', 'write'),
  ('administrator', 'platform.identity_admin',   'read'),
  ('administrator', 'platform.identity_admin',   'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- EVERY erp FUNCTION HAS BEEN EXECUTABLE BY PUBLIC SINCE 0002, and this closes it.
--
-- 0002 runs `alter default privileges … in schema erp revoke all on functions from
-- public`, intending functions to be born unexecutable. That statement does nothing.
-- PostgreSQL grants EXECUTE to PUBLIC as a GLOBAL default, and a per-schema
-- (IN SCHEMA) default can only add to the global one: a per-schema REVOKE reverses
-- an earlier per-schema GRANT and nothing else. The catalogue says so plainly —
-- 0010's functions carry `=X/postgres` in their ACL.
--
-- The consequence was real: erp_read, the reporting role that "holds no write
-- anywhere", could call erp.decide_capability(), which is SECURITY DEFINER and
-- writes the capability state. Found by this migration's own pgTAP suite, when
-- bootstrap_administrator() — granted to nobody — turned out to be callable by the
-- runtime anyway.
--
-- Fixed per object rather than by changing a global default, because a global
-- default for the migration role would also reach functions an extension creates in
-- other schemas. And ENFORCED rather than remembered: db-check's
-- no-erp-function-is-executable-by-public fails any later migration that adds a
-- function without the same revoke.
revoke execute on all functions in schema erp from public;

-- What erp_app does NOT get is the design:
--
--   * no privilege of any kind on erp.person_credential or erp.credential_miss —
--     erp.verify_pin() answers with a status, so the runtime never needs a hash;
--   * no write on erp.person, erp.person_role or erp.identity_decision — each change
--     has one admitted route, a SECURITY DEFINER function that records it. Unlike
--     0010, which granted INSERT on its decision log, this log has no direct INSERT:
--     a decision appended without its projection would be a decision never in force;
--   * no EXECUTE on erp.bootstrap_administrator().
grant select on erp.person, erp.role, erp.role_permission, erp.person_role, erp.identity_decision to erp_app;
grant execute on function
  erp.org_scope(),
  erp.system_principal(),
  erp.permission_granted(uuid, text, text, uuid),
  erp.assert_permitted(uuid, text, text, uuid),
  erp.role_permissions(text),
  erp.verify_pin(text, text),
  erp.create_person(uuid, uuid, text, text, text, uuid, text, uuid, timestamptz),
  erp.change_person_status(uuid, uuid, text, text, uuid, timestamptz),
  erp.grant_role(uuid, uuid, text, uuid, text, uuid, timestamptz),
  erp.revoke_role(uuid, uuid, text, uuid, text, uuid, timestamptz),
  erp.set_pin(uuid, uuid, text, text, uuid, timestamptz),
  erp.unlock_credential(uuid, uuid, text, uuid, timestamptz)
to erp_app;

-- 0002 default-grants SELECT on every new erp table to erp_read, which would put a
-- PIN hash in the reporting role's reach the moment its table exists. Revoked here,
-- and db-check's credential-tables-are-unreachable holds the line for any credential
-- table added later.
revoke all on erp.person_credential, erp.credential_miss from erp_read;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- 0008 does not re-run, so each table is stated here, as 0010 does. The credential
-- tables get RLS enabled and forced and NO policy for anyone: enabled-with-no-policy
-- denies, which is the posture wanted there.
do $$
declare
  t text;
begin
  foreach t in array array['identity_decision', 'person', 'role', 'role_permission', 'person_role',
                           'person_credential', 'credential_miss'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
  end loop;
  foreach t in array array['identity_decision', 'person', 'role', 'role_permission', 'person_role'] loop
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
    execute format('create policy erp_app_read on erp.%I for select to erp_app using (true)', t);
  end loop;
end
$$;
