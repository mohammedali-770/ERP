-- 0014 · Sessions — turning a correct PIN into a signed-in person, and back
--
-- Requirements: IAM-001 · IAM-008 · IAM-009 · IAM-010 · SEC-003 · SEC-004
--               IAM-P01 · IAM-P05 · IAM-P09 · IAM-P10
-- ADR-0023 (accepted) · ADR-0025 (proposed) · ADR-0022 · invariant I-8
--
-- 0011 said what it did not do: "erp.verify_pin() answers whether an employee number and
-- PIN match; nothing yet turns that answer into a session". ADR-0023 has since named what
-- holds the runtime's credential, an edge function, so the session layer can exist. This
-- is its database half:
--
--   erp.sign_in()          verify_pin(), recorded, and on 'ok' a session and its token
--   erp.resolve_session()  token -> person, or the reason it no longer names one. This is
--                          the ONLY way the edge layer learns who is calling, so a caller
--                          never names an actor itself (ADR-0025)
--   erp.sign_out()         ends the caller's own session
--   erp.revoke_sessions()  an administrator ends every open session of a person, recorded
--
-- and the login role, erp_edge, that the edge functions connect as.
--
-- THE TOKEN IS NEVER STORED (IAM-P10). It is 32 random bytes, returned once as hex and
-- held only by the device. The database keeps its SHA-256. A plain hash, not bcrypt:
-- bcrypt exists to slow a guess at a six-digit PIN, and 256 random bits cannot be guessed
-- however fast the hash. Someone who reads every row of erp.session holds no token.
--
-- TWELVE HOURS, THIRTY MINUTES IDLE (IAM-P09, the owner's decision of 2026-10-03). Named
-- once, below, and read by every route that needs them.
--
-- THE SIGN-IN LOG HOLDS NO PERSONAL DATA. An attempt against an unknown number records no
-- person and not the number, so the log needs no erasure route (SEC-008, ADR-0022 §2) and
-- does not become a list of who was tried.

-- No `set local search_path` here, for the reason 0011 gives: every name is qualified.

-- ---------------------------------------------------------------------------
-- Named constants
-- ---------------------------------------------------------------------------

-- IAM-P09. The longest a sign-in lasts, however busy the device.
create or replace function erp.session_max_age()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select interval '12 hours' $$;

-- IAM-P09. How long a session may go unused before it ends.
create or replace function erp.session_idle_limit()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select interval '30 minutes' $$;

-- How stale last_seen_at may get before a request moves it. Without this, every request
-- a till makes is a write; with it, most are reads, and the idle limit is honoured to
-- within a minute.
create or replace function erp.session_touch_interval()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select interval '1 minute' $$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table erp.session (
  session_id             uuid        primary key default gen_random_uuid(),
  person_id              uuid        not null references erp.person (person_id),
  -- IAM-P10. SHA-256 of the token, which is never stored.
  token_hash             bytea       not null unique check (octet_length(token_hash) = 32),
  created_at             timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  expires_at             timestamptz not null,
  ended_at               timestamptz,
  ended_reason           text        check (ended_reason in ('signed_out', 'revoked', 'expired', 'idle', 'disabled',
                                                              'superseded')),
  -- A revocation is an administrative act, so it names the decision that recorded it.
  -- The other endings are events at a device, and need none.
  revoked_by_decision_id uuid        references erp.identity_decision (decision_id),
  -- What the session was signed in under: the decision behind the person's status, and
  -- the one behind their credential, as they stood when the PIN was checked. A later
  -- decision about either replaces it, and resolve_session() then ends the session
  -- ('superseded'). Identifiers, not times, so no race can order them wrongly.
  person_decision_id     uuid        not null references erp.identity_decision (decision_id),
  credential_decision_id uuid        not null references erp.identity_decision (decision_id),
  constraint session_ends_whole check ((ended_at is null) = (ended_reason is null)),
  constraint session_revocation_names_its_decision
    check (coalesce(ended_reason = 'revoked', false) = (revoked_by_decision_id is not null)),
  constraint session_expires_after_it_starts check (expires_at > created_at)
);

comment on table erp.session is
  'A signed-in device (ADR-0025). Holds only the SHA-256 of its token (IAM-P10). Ended, never deleted; an ended session never reopens.';
comment on column erp.session.token_hash is
  'SHA-256 of the 32-byte token. The token itself exists only on the device that signed in.';

create index ix_session_open_by_person on erp.session (person_id) where ended_at is null;

-- What a session IS never changes: whose it is, its token, when it started and when it
-- must end. An ended session never changes at all, so it cannot be reopened. And no
-- session is deleted, by anyone: the sign-in log names it. Binds the owner too.
create or replace function erp.session_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'a session is ended, never deleted (ADR-0025): % denied on %', tg_op, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  if old.ended_at is not null then
    raise exception 'session % has ended and never changes again (ADR-0025)', old.session_id
      using errcode = 'restrict_violation';
  end if;
  if (new.session_id, new.person_id, new.token_hash, new.created_at, new.expires_at,
      new.person_decision_id, new.credential_decision_id)
     is distinct from (old.session_id, old.person_id, old.token_hash, old.created_at, old.expires_at,
                       old.person_decision_id, old.credential_decision_id) then
    raise exception 'a session''s person, token and lifetime are fixed when it starts (ADR-0025)'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger session_guard
  before update or delete on erp.session
  for each row
  execute function erp.session_guard();

create trigger session_never_truncated
  before truncate on erp.session
  for each statement
  execute function erp.session_guard();

-- ---------------------------------------------------------------------------
-- The sign-in log (IAM-008) — append-only
-- ---------------------------------------------------------------------------

create table erp.sign_in_log (
  attempt_id   uuid        primary key default gen_random_uuid(),
  attempted_at timestamptz not null default now(),
  outcome      text        not null check (outcome in ('ok', 'wrong', 'locked', 'disabled')),
  -- Null for a number that names nobody. Recorded for a known person whatever the
  -- outcome, which the CALLER is never told: verify_pin() answers an unknown number and a
  -- wrong PIN identically, and this log is not an answer.
  person_id    uuid        references erp.person (person_id),
  session_id   uuid        references erp.session (session_id),
  constraint sign_in_log_shape check (
    (outcome = 'ok') = (session_id is not null)
    and (outcome not in ('ok', 'disabled') or person_id is not null)
  )
);

comment on table erp.sign_in_log is
  'Every sign-in attempt (IAM-008), append-only. No employee number or other personal data: an unknown number records no person.';

create index ix_sign_in_log_person on erp.sign_in_log (person_id, attempted_at desc);

-- Append-only, enforced twice, as every other log is: no write grant to the runtime, and
-- a trigger that refuses every writer, the owner included. Its message has the shape
-- db-check's runtime probe reads: "<log> is append-only (...): <OP> denied on <table>".
create or replace function erp.sign_in_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'sign_in_log is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Who tried to sign in, and when, is not unmade by editing the record of it.';
end;
$$;

create trigger sign_in_log_append_only
  before update or delete on erp.sign_in_log
  for each statement
  execute function erp.sign_in_log_is_append_only();

create trigger sign_in_log_never_truncated
  before truncate on erp.sign_in_log
  for each statement
  execute function erp.sign_in_log_is_append_only();

-- ---------------------------------------------------------------------------
-- A revocation is an identity decision
-- ---------------------------------------------------------------------------

-- 0011 declared the kinds inline, so the constraint carries PostgreSQL's generated name.
-- Widened rather than replaced in meaning: every existing kind stays, and the shape
-- check's ELSE branch already requires a 'sessions_revoked' decision to carry neither a
-- status nor a role. Altering a constraint is not an UPDATE, so the append-only trigger
-- does not fire, and every existing row is revalidated against the wider list.
alter table erp.identity_decision
  drop constraint identity_decision_kind_check,
  add constraint identity_decision_kind_check check (kind in (
    'bootstrap', 'person_created', 'status_changed',
    'role_granted', 'role_revoked',
    'credential_set', 'credential_unlocked',
    'sessions_revoked'));

-- ---------------------------------------------------------------------------
-- The routes
-- ---------------------------------------------------------------------------

-- IAM-P01..P05 through verify_pin(), unchanged, then IAM-008: every attempt is recorded,
-- whatever its outcome, in the same transaction as the counters verify_pin() moved. On
-- 'ok', a session. Answers verify_pin()'s jsonb, and on 'ok' adds:
--
--   token       64 hex characters. Shown once; the database keeps only its hash.
--   expires_at  when the session ends however busy it is (IAM-P09).
--
-- Ungated, deliberately, as verify_pin() is: this is how a person comes to be named at
-- all, so there is nobody yet to ask permission for. db-check's
-- every-runtime-definer-route-is-gated names it as an exception for that reason.
create or replace function erp.sign_in(p_employee_number text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_answer  jsonb;
  v_status  text;
  v_person  uuid;
  v_token   bytea;
  v_session uuid;
  v_expires timestamptz;
begin
  v_answer := erp.verify_pin(p_employee_number, p_pin);
  v_status := v_answer ->> 'status';

  if v_status = 'ok' then
    v_person  := (v_answer ->> 'person_id')::uuid;
    v_token   := extensions.gen_random_bytes(32);
    v_expires := now() + erp.session_max_age();
    -- The stamps are read here, in verify_pin()'s transaction, while it still holds the
    -- credential row it checked FOR UPDATE: a concurrent erp.set_pin() waits on that lock
    -- and then commits a NEW credential decision, which supersedes this session. Stamping
    -- by time instead let a PIN reset whose transaction began first commit a decision
    -- "older" than a session made with the old PIN (found by Codex on PR #31).
    insert into erp.session (person_id, token_hash, expires_at, person_decision_id, credential_decision_id)
    select v_person, pg_catalog.sha256(v_token), v_expires, p.as_of_decision_id, c.as_of_decision_id
      from erp.person p
      join erp.person_credential c on c.person_id = p.person_id
     where p.person_id = v_person
    returning session_id into v_session;
  elsif p_employee_number ~ '^[0-9]{1,10}$' then
    -- For the log only. The caller's answer is verify_pin()'s, unchanged.
    select p.person_id into v_person
      from erp.person p
     where p.employee_number = p_employee_number and p.person_type = 'employee';
  end if;

  insert into erp.sign_in_log (outcome, person_id, session_id)
  values (v_status, v_person, v_session);

  if v_status = 'ok' then
    return v_answer || jsonb_build_object('token', encode(v_token, 'hex'), 'expires_at', v_expires);
  end if;
  return v_answer;
end;
$$;

comment on function erp.sign_in(text, text) is
  'IAM-P01..P05 via erp.verify_pin(), every attempt recorded (IAM-008). On ok, also returns a session token (shown once, stored only as its SHA-256) and expires_at.';

-- Who a token names, now. Answers, as jsonb:
--
--   {status: 'ok', person_id, expires_at}  the session is open
--   {status: 'invalid'}                     no session has this token, or it is malformed
--   {status: 'ended'}                       signed out, revoked, superseded, or ended by an
--                                           earlier call
--   {status: 'expired'}                     older than erp.session_max_age()
--   {status: 'idle'}                        unused for longer than erp.session_idle_limit()
--   {status: 'disabled'}                    the person is no longer active (IAM-P05)
--
-- The last three END the session as they answer, so it answers 'ended' from then on and
-- an expired session is never revived by its clock moving back. Reads now() and takes
-- no clock, for the reason verify_pin() gives.
--
-- SUPERSEDED. A session also ends, answering 'ended', once the person's status or
-- credential has been decided since it was signed in: a status change of either
-- direction, a PIN set, or an unlock (an unlock follows a lockout, which means someone
-- else was trying the number). Without this, suspending a cashier whose till was stolen
-- only PAUSED the thief's session — reactivate them within thirty minutes, even with a new
-- PIN, and the stolen token answered 'ok' again (found in review). Compared by the
-- decision each projection names, not by time (see erp.sign_in()), so no identity route
-- has to remember to end sessions and no race can order the two wrongly.
--
-- AN ORDINARY REQUEST IS A READ. The row is not locked; ending it and moving its idle
-- clock are each one conditional UPDATE that applies only while it is still open. A
-- sign-out or revocation that commits first makes that UPDATE match nothing, and the
-- answer is 'ended'. None of this stops a request that had already resolved 'ok' a moment
-- earlier from finishing: nothing can, short of resolving inside every write.
create or replace function erp.resolve_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_session erp.session;
  v_ending  text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_session
    from erp.session s
   where s.token_hash = pg_catalog.sha256(decode(p_token, 'hex'));
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_session.ended_at is not null then
    return jsonb_build_object('status', 'ended');
  end if;

  if v_session.expires_at <= now() then
    v_ending := 'expired';
  elsif v_session.last_seen_at <= now() - erp.session_idle_limit() then
    v_ending := 'idle';
  elsif not exists (select 1 from erp.person p
                     where p.person_id = v_session.person_id and p.status = 'active') then
    v_ending := 'disabled';
  elsif (select p.as_of_decision_id from erp.person p where p.person_id = v_session.person_id)
          is distinct from v_session.person_decision_id
     or (select c.as_of_decision_id from erp.person_credential c where c.person_id = v_session.person_id)
          is distinct from v_session.credential_decision_id then
    v_ending := 'superseded';
  end if;

  if v_ending is not null then
    update erp.session
       set ended_at = now(), ended_reason = v_ending
     where session_id = v_session.session_id and ended_at is null;
    if not found or v_ending = 'superseded' then
      return jsonb_build_object('status', 'ended');
    end if;
    return jsonb_build_object('status', v_ending);
  end if;

  if v_session.last_seen_at < now() - erp.session_touch_interval() then
    update erp.session set last_seen_at = now()
     where session_id = v_session.session_id and ended_at is null;
    if not found then
      return jsonb_build_object('status', 'ended');
    end if;
  end if;

  return jsonb_build_object('status', 'ok',
                            'person_id', v_session.person_id,
                            'expires_at', v_session.expires_at);
end;
$$;

comment on function erp.resolve_session(text) is
  'ADR-0025. The only way the edge layer learns who is calling: ok with person_id, or invalid | ended | expired | idle | disabled. Ends the session on the last three, and when the person''s status or credential has been decided since it was signed in.';

-- The caller's own session, by the token that proves it is theirs. Answers ok whether it
-- ended now or had already ended, so signing out twice is harmless; invalid for a token
-- that names no session.
create or replace function erp.sign_out(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  update erp.session
     set ended_at = now(), ended_reason = 'signed_out'
   where token_hash = pg_catalog.sha256(decode(p_token, 'hex'))
     and ended_at is null;
  if found or exists (select 1 from erp.session s
                       where s.token_hash = pg_catalog.sha256(decode(p_token, 'hex'))) then
    return jsonb_build_object('status', 'ok');
  end if;
  return jsonb_build_object('status', 'invalid');
end;
$$;

comment on function erp.sign_out(text) is
  'Ends the session the token names. ok if it is now ended (including already); invalid if no session has this token.';

-- IAM-010. An administrator ends every open session of a person: a lost till, a
-- departing employee, a PIN seen over a shoulder. Recorded as an identity decision
-- (IAM-008), and each session it ended names that decision. Returns how many it ended.
-- Suspending someone, or setting their PIN, needs no revocation: resolve_session() ends
-- every session signed in under an earlier decision, at its next use.
create or replace function erp.revoke_sessions(
  p_decision_id uuid,
  p_person_id   uuid,
  p_reason      text,
  p_actor_id    uuid,
  p_decided_at  timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ended integer;
begin
  perform erp.assert_permitted(p_actor_id, 'platform.identity_admin', 'write', null);

  if not exists (select 1 from erp.person p where p.person_id = p_person_id) then
    raise exception 'no person % to revoke sessions for', p_person_id using errcode = 'no_data_found';
  end if;

  insert into erp.identity_decision (
    decision_id, kind, subject_person_id, reason, actor_id, actor_type, decided_at
  ) values (
    p_decision_id, 'sessions_revoked', p_person_id, p_reason, p_actor_id, 'administrator', p_decided_at
  );

  update erp.session
     set ended_at = now(), ended_reason = 'revoked', revoked_by_decision_id = p_decision_id
   where person_id = p_person_id and ended_at is null;
  get diagnostics v_ended = row_count;
  return v_ended;
end;
$$;

comment on function erp.revoke_sessions(uuid, uuid, text, uuid, timestamptz) is
  'IAM-010. Ends every open session of a person, recorded as a sessions_revoked identity decision. Gated by platform.identity_admin write.';

-- ---------------------------------------------------------------------------
-- The login role (ADR-0023)
-- ---------------------------------------------------------------------------

-- What the edge functions connect as. It is erp_app and nothing more: LOGIN, a member
-- of erp_app alone, and none of the attributes that would let it do anything erp_app
-- cannot. INHERIT, so erp_app's privileges apply without a SET ROLE — a SET ROLE is
-- session state, which a transaction-mode pooler does not keep between transactions.
--
-- NO PASSWORD, here or anywhere in this repository. A login role with no password
-- cannot authenticate with one. The local stack's test setup sets a throwaway one; a
-- hosted project's is set by the owner, as a separate approved action (CLAUDE.md §4).
--
-- Roles belong to the cluster, not the database, so it is created only if absent:
-- db-check builds two databases in one cluster.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_edge') then
    create role erp_edge login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      connection limit 20;
  end if;
end
$$;

grant erp_app to erp_edge;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Every new function, closed to PUBLIC, as 0011 explains and db-check enforces.
revoke execute on all functions in schema erp from public;

-- The runtime reaches sessions and the log through the four routes only. It holds no
-- privilege on either table, so it can neither read a token hash nor write a session or
-- an attempt the routes did not.
grant execute on function
  erp.sign_in(text, text),
  erp.resolve_session(text),
  erp.sign_out(text),
  erp.revoke_sessions(uuid, uuid, text, uuid, timestamptz)
to erp_app;

-- And no longer verify_pin() directly. Called directly, it checks a PIN and records
-- nothing, which is a way round IAM-008. erp.sign_in() calls it as its owner.
revoke execute on function erp.verify_pin(text, text) from erp_app;

-- 0002 default-grants SELECT on every new table to erp_read. The reporting role may read
-- who tried to sign in; it has no use for a token hash.
revoke all on erp.session from erp_read;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table erp.session enable row level security;
alter table erp.session force row level security;
alter table erp.sign_in_log enable row level security;
alter table erp.sign_in_log force row level security;

-- erp.session: no policy for anyone, so enabled-with-no-policy denies, as for the
-- credential tables. erp.sign_in_log: the reporting role reads it.
create policy erp_read_all on erp.sign_in_log for select to erp_read using (true);
