-- pgTAP · sessions — a correct PIN becomes a signed-in person, and stops being one
--
-- 0014 turns erp.verify_pin()'s answer into a session the edge layer can resolve, and
-- records every attempt. As in 060 and 070, the cases marked CONTROL are the reason the
-- suite exists: each fails if its mechanism is removed.
--
-- SIGN-IN AND RESOLUTION CASES USE is(), NOT throws_ok, for 070's reason: they answer
-- with a status rather than raising, and every call writes. db-fixtures replays only
-- throws_ok and lives_ok bodies, so keeping these in is() keeps their writes inside this
-- suite's transaction. Every throws_ok below raises, so none commits under db-fixtures,
-- and each builds any row it needs in its own body.
--
-- TIME. Neither sign-in nor resolution takes a clock, for verify_pin()'s reason, so a
-- session of a given age is made by inserting its row as the owner with the times
-- wanted and a known token, as 070 moves a lock. The tokens below are synthetic test
-- values; a real one exists only on the device that signed in.
--
-- The PINs are the synthetic ones 0015_identity.sql seeds.

begin;
select plan(63);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'session',     'sessions exist');
select has_table('erp', 'sign_in_log', 'the sign-in log exists');
-- IAM-P10. Asserted so that adding one is a decision someone takes on purpose.
select hasnt_column('erp', 'session', 'token', 'a session has no column for its token: only the hash is kept');
select hasnt_column('erp', 'sign_in_log', 'employee_number',
  'the sign-in log holds no employee number, so it needs no erasure route (SEC-008)');

-- ---------------------------------------------------------------------------
-- Signing in (IAM-P01..P05 through verify_pin, IAM-008, IAM-P09, IAM-P10)
-- ---------------------------------------------------------------------------

create temp table signed_in as select erp.sign_in('1001', '100001') as answer;

select is((select answer ->> 'status' from signed_in), 'ok', 'the right PIN signs an active person in');
select is((select (answer ->> 'person_id')::uuid from signed_in), '01936f00-0000-7000-8000-000000000901'::uuid,
  'and names who signed in');
select ok((select answer ->> 'token' ~ '^[0-9a-f]{64}$' from signed_in),
  'and hands back a token of 32 random bytes, as hex');
-- IAM-P09. now() is the transaction's time, so this is exact.
select is((select (answer ->> 'expires_at')::timestamptz from signed_in), now() + interval '12 hours',
  'a session lasts twelve hours at most');

-- CONTROL. IAM-P10: what is stored is the SHA-256 of the token, and never the token.
select is((select count(*)::int from erp.session s, signed_in t
            where s.token_hash = sha256(decode(t.answer ->> 'token', 'hex'))), 1,
  'the session is found by the SHA-256 of its token');
select is((select count(*)::int from erp.session s, signed_in t
            where s.token_hash = decode(t.answer ->> 'token', 'hex')), 0,
  'and the token itself is stored nowhere');
select is((select count(*)::int from erp.session s, signed_in t
            where s.token_hash = sha256(decode(t.answer ->> 'token', 'hex'))
              and s.person_id = (t.answer ->> 'person_id')::uuid
              and s.expires_at = (t.answer ->> 'expires_at')::timestamptz
              and s.ended_at is null), 1,
  'the session belongs to the person, ends when the answer says, and is open');

-- IAM-008. Every attempt is recorded, whatever its outcome.
select is((select count(*)::int from erp.sign_in_log l, erp.session s, signed_in t
            where l.session_id = s.session_id and l.outcome = 'ok'
              and l.person_id = '01936f00-0000-7000-8000-000000000901'
              and s.token_hash = sha256(decode(t.answer ->> 'token', 'hex'))), 1,
  'a successful sign-in is recorded with its person and its session');

-- A wrong PIN answers exactly as verify_pin() does, with no token.
select is(erp.sign_in('1002', '000000'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'a wrong PIN is answered as verify_pin answers it, and carries no token');
-- CONTROL. The log knows who was tried; the caller is not told.
select is((select count(*)::int from erp.sign_in_log
            where outcome = 'wrong' and session_id is null
              and person_id = '01936f00-0000-7000-8000-000000000902'), 1,
  'a wrong PIN against a real person is recorded against that person');

-- IAM-P02 still holds through sign-in.
select is(erp.sign_in('9999', '000000'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'an unknown number is answered exactly as a wrong PIN is');
select is((select count(*)::int from erp.sign_in_log where outcome = 'wrong' and person_id is null), 1,
  'and is recorded with no person and no number');
select is(erp.sign_in('12ab', '100001'), '{"status": "wrong"}'::jsonb,
  'a malformed number is refused before anything is read');
select is((select count(*)::int from erp.sign_in_log where outcome = 'wrong' and person_id is null), 2,
  'and is recorded too');

-- CONTROL. IAM-P05: a suspended person holding the right PIN gets no session.
select is(erp.sign_in('1005', '100005'), '{"status": "disabled"}'::jsonb,
  'a suspended person with the correct PIN is told disabled');
select is((select count(*)::int from erp.session where person_id = '01936f00-0000-7000-8000-000000000905'), 0,
  'and no session is created for them');
select is((select count(*)::int from erp.sign_in_log
            where outcome = 'disabled' and session_id is null
              and person_id = '01936f00-0000-7000-8000-000000000905'), 1,
  'and the attempt is recorded');

select is((select count(*)::int from erp.sign_in_log), 5,
  'five attempts, five records: nothing is answered without being recorded');

-- ---------------------------------------------------------------------------
-- Resolving a session — the only way the edge layer learns who is calling
-- ---------------------------------------------------------------------------

select is((select erp.resolve_session(answer ->> 'token') from signed_in),
          jsonb_build_object('status', 'ok',
                             'person_id', '01936f00-0000-7000-8000-000000000901'::uuid,
                             'expires_at', now() + interval '12 hours'),
  'a fresh token resolves to its person');
select is(erp.resolve_session('not-a-token'), '{"status": "invalid"}'::jsonb,
  'a malformed token is invalid');
select is(erp.resolve_session(repeat('0', 64)), '{"status": "invalid"}'::jsonb,
  'a well-formed token that names no session is invalid');
select is((select erp.resolve_session(upper(answer ->> 'token')) from signed_in), '{"status": "invalid"}'::jsonb,
  'a token is compared exactly as issued');

-- Sessions of chosen ages, made as the owner. Each token below is synthetic.
insert into erp.session (session_id, person_id, token_hash, created_at, last_seen_at, expires_at) values
  -- past its twelve hours, though used a minute ago
  ('01936f00-0000-7000-8000-0000000e0901', '01936f00-0000-7000-8000-000000000901',
   sha256(decode(repeat('e1', 32), 'hex')),
   now() - interval '13 hours', now() - interval '1 minute', now() - interval '1 hour'),
  -- unused for thirty-one minutes
  ('01936f00-0000-7000-8000-0000000e0902', '01936f00-0000-7000-8000-000000000901',
   sha256(decode(repeat('e2', 32), 'hex')),
   now() - interval '2 hours', now() - interval '31 minutes', now() + interval '10 hours'),
  -- unused for twenty-nine minutes: still open
  ('01936f00-0000-7000-8000-0000000e0903', '01936f00-0000-7000-8000-000000000901',
   sha256(decode(repeat('e3', 32), 'hex')),
   now() - interval '2 hours', now() - interval '29 minutes', now() + interval '10 hours'),
  -- used thirty seconds ago
  ('01936f00-0000-7000-8000-0000000e0904', '01936f00-0000-7000-8000-000000000901',
   sha256(decode(repeat('e4', 32), 'hex')),
   now() - interval '2 hours', now() - interval '30 seconds', now() + interval '10 hours'),
  -- belongs to the suspended person
  ('01936f00-0000-7000-8000-0000000e0905', '01936f00-0000-7000-8000-000000000905',
   sha256(decode(repeat('e5', 32), 'hex')),
   now() - interval '1 hour', now() - interval '5 minutes', now() + interval '11 hours');

-- CONTROL. IAM-P09: the twelve hours bind however busy the session is.
select is(erp.resolve_session(repeat('e1', 32)), '{"status": "expired"}'::jsonb,
  'a session past its twelve hours is expired, though it was used a minute ago');
select is((select ended_reason from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0901'), 'expired',
  'and is ended as it answers');
select is(erp.resolve_session(repeat('e1', 32)), '{"status": "ended"}'::jsonb,
  'so it answers ended from then on');

-- CONTROL. IAM-P09: thirty minutes idle ends it.
select is(erp.resolve_session(repeat('e2', 32)), '{"status": "idle"}'::jsonb,
  'a session unused for thirty-one minutes has gone idle');
select is((select ended_reason from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0902'), 'idle',
  'and is ended');

-- The control for the two above: the same session, inside its limits, is open.
select is(erp.resolve_session(repeat('e3', 32)) ->> 'status', 'ok',
  'a session unused for twenty-nine minutes is still open');
select is((select last_seen_at from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0903'), now(),
  'and using it restarts its idle clock');
select is((select last_seen_at from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0904'),
          now() - interval '30 seconds',
  'before the call: last seen thirty seconds ago');
select is(erp.resolve_session(repeat('e4', 32)) ->> 'status', 'ok', 'a session used moments ago resolves');
select is((select last_seen_at from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0904'),
          now() - interval '30 seconds',
  'without a write: the idle clock moves at most once a minute');

-- CONTROL. IAM-P05: suspending a person ends their sessions at their next use.
select is(erp.resolve_session(repeat('e5', 32)), '{"status": "disabled"}'::jsonb,
  'a session of a person who is no longer active is refused');
select is((select ended_reason from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0905'), 'disabled',
  'and ended');

-- ---------------------------------------------------------------------------
-- Signing out
-- ---------------------------------------------------------------------------

select is((select erp.sign_out(answer ->> 'token') from signed_in), '{"status": "ok"}'::jsonb,
  'signing out ends the session');
select is((select erp.resolve_session(answer ->> 'token') from signed_in), '{"status": "ended"}'::jsonb,
  'and its token no longer names anyone');
select is((select erp.sign_out(answer ->> 'token') from signed_in), '{"status": "ok"}'::jsonb,
  'signing out twice is harmless');
select is(erp.sign_out(repeat('0', 64)), '{"status": "invalid"}'::jsonb,
  'a token that names no session signs nothing out');

-- ---------------------------------------------------------------------------
-- Revoking (IAM-010) — gated, and recorded
-- ---------------------------------------------------------------------------

insert into erp.session (session_id, person_id, token_hash, expires_at) values
  ('01936f00-0000-7000-8000-0000000e0911', '01936f00-0000-7000-8000-000000000902',
   sha256(decode(repeat('f1', 32), 'hex')), now() + interval '12 hours'),
  ('01936f00-0000-7000-8000-0000000e0912', '01936f00-0000-7000-8000-000000000902',
   sha256(decode(repeat('f2', 32), 'hex')), now() + interval '12 hours');

-- CONTROL. The gate: a branch worker cannot revoke anyone.
select throws_ok(
  $$ select erp.revoke_sessions(
       '01936f00-0000-7000-8000-0000000e0921'::uuid, '01936f00-0000-7000-8000-000000000902'::uuid,
       'testing', '01936f00-0000-7000-8000-000000000901'::uuid, now()) $$,
  '23001',
  'person 01936f00-0000-7000-8000-000000000901 may not write on capability platform.identity_admin here (IAM-003)',
  'a person without identity administration cannot revoke sessions'
);
select is((select count(*)::int from erp.session
            where person_id = '01936f00-0000-7000-8000-000000000902' and ended_at is null), 2,
  'and both sessions are still open');

select is(erp.revoke_sessions(
            '01936f00-0000-7000-8000-0000000e0922'::uuid, '01936f00-0000-7000-8000-000000000902'::uuid,
            'Till reported lost.', '01936f00-0000-7000-8000-000000000900'::uuid, now()), 2,
  'an administrator revokes every open session of a person');
select is((select count(*)::int from erp.session
            where person_id = '01936f00-0000-7000-8000-000000000902'
              and ended_reason = 'revoked'
              and revoked_by_decision_id = '01936f00-0000-7000-8000-0000000e0922'), 2,
  'each names the decision that ended it');
select is((select count(*)::int from erp.identity_decision
            where decision_id = '01936f00-0000-7000-8000-0000000e0922' and kind = 'sessions_revoked'
              and subject_person_id = '01936f00-0000-7000-8000-000000000902'
              and actor_id = '01936f00-0000-7000-8000-000000000900'), 1,
  'and the revocation is recorded as an identity decision (IAM-008)');
select is(erp.resolve_session(repeat('f1', 32)), '{"status": "ended"}'::jsonb,
  'a revoked token names nobody');

select throws_ok(
  $$ select erp.revoke_sessions(
       '01936f00-0000-7000-8000-0000000e0923'::uuid, '01936f00-0000-7000-8000-0000000e09ff'::uuid,
       'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'P0002',
  'no person 01936f00-0000-7000-8000-0000000e09ff to revoke sessions for',
  'revoking for nobody is refused rather than recorded'
);

-- ---------------------------------------------------------------------------
-- What a session is never changes, and nothing is deleted
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into erp.session (session_id, person_id, token_hash, expires_at)
     values ('01936f00-0000-7000-8000-0000000e0931', '01936f00-0000-7000-8000-000000000901',
             sha256(decode(repeat('a1', 32), 'hex')), now() + interval '1 hour');
     update erp.session set expires_at = expires_at + interval '1 day'
      where session_id = '01936f00-0000-7000-8000-0000000e0931' $$,
  '23001',
  'a session''s person, token and lifetime are fixed when it starts (ADR-0025)',
  'a session cannot be extended'
);
select throws_ok(
  $$ insert into erp.session (session_id, person_id, token_hash, expires_at, ended_at, ended_reason)
     values ('01936f00-0000-7000-8000-0000000e0932', '01936f00-0000-7000-8000-000000000901',
             sha256(decode(repeat('a2', 32), 'hex')), now() + interval '1 hour', now(), 'signed_out');
     update erp.session set ended_at = null, ended_reason = null
      where session_id = '01936f00-0000-7000-8000-0000000e0932' $$,
  '23001',
  'session 01936f00-0000-7000-8000-0000000e0932 has ended and never changes again (ADR-0025)',
  'an ended session cannot be reopened'
);
select throws_ok(
  $$ insert into erp.session (session_id, person_id, token_hash, expires_at)
     values ('01936f00-0000-7000-8000-0000000e0933', '01936f00-0000-7000-8000-000000000901',
             sha256(decode(repeat('a3', 32), 'hex')), now() + interval '1 hour');
     delete from erp.session where session_id = '01936f00-0000-7000-8000-0000000e0933' $$,
  '23001',
  'a session is ended, never deleted (ADR-0025): DELETE denied on session',
  'a session is never deleted'
);
select throws_ok(
  $$ truncate erp.session cascade $$,
  '23001',
  'a session is ended, never deleted (ADR-0025): TRUNCATE denied on session',
  'nor truncated'
);

-- The sign-in log is append-only. Statement triggers, so these refuse on an empty log.
select throws_ok(
  $$ update erp.sign_in_log set outcome = outcome where true $$,
  '23001', 'sign_in_log is append-only (IAM-008): UPDATE denied on sign_in_log',
  'a sign-in attempt cannot be rewritten'
);
select throws_ok(
  $$ delete from erp.sign_in_log where true $$,
  '23001', 'sign_in_log is append-only (IAM-008): DELETE denied on sign_in_log',
  'nor deleted'
);
select throws_ok(
  $$ truncate erp.sign_in_log $$,
  '23001', 'sign_in_log is append-only (IAM-008): TRUNCATE denied on sign_in_log',
  'nor truncated'
);

-- ---------------------------------------------------------------------------
-- Privilege facts
-- ---------------------------------------------------------------------------

select is(has_table_privilege('erp_app', 'erp.session', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime holds no privilege of any kind on sessions — the routes answer for it');
select is(has_table_privilege('erp_app', 'erp.sign_in_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor on the sign-in log, so it can record no attempt the routes did not');
-- CONTROL. Called directly, verify_pin() checks a PIN and records nothing.
select is(has_function_privilege('erp_app', 'erp.verify_pin(text,text)', 'EXECUTE'), false,
  'the runtime cannot check a PIN except through sign-in, which records it');
select is(has_table_privilege('erp_read', 'erp.session', 'SELECT'), false,
  'the reporting role cannot read a token hash');
select ok(has_table_privilege('erp_read', 'erp.sign_in_log', 'SELECT'),
  'but reads who tried to sign in, so the revoke above is specific');
select ok(has_function_privilege('erp_edge', 'erp.resolve_session(text)', 'EXECUTE'),
  'the login role reaches the routes, through erp_app');
select is(has_function_privilege('erp_edge', 'erp.bootstrap_administrator(uuid,uuid,text,text,text,text)', 'EXECUTE'), false,
  'and nothing erp_app cannot');

select * from finish();
rollback;
