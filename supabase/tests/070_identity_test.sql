-- pgTAP · identity, proved by being refused by it
--
-- 0011 gives the ERP a person, and with it the right half of the rule 0010's header
-- states: capability_open(scope) AND permission_granted(principal, …). Like 060, every
-- behavioural case is a collision, and the ones marked CONTROL are the reason the
-- suite exists — if one of them passes without its mechanism, the mechanism is
-- decoration.
--
-- SIGN-IN CASES USE is(), NOT throws_ok. erp.verify_pin() answers with a status
-- rather than raising, and every call writes a counter. tools/db-fixtures replays
-- only throws_ok and lives_ok bodies, so keeping these in is() also keeps their
-- counters inside this suite's transaction, where the rollback below removes them.
--
-- ORDER MATTERS. The sign-in cases accumulate misses against …0902 and the unknown
-- number 9999 within this transaction, deliberately, to reach the lock. The one
-- fixture that commits under db-fixtures is last, for the reason 060 gives.
--
-- The PINs below are the synthetic ones 0015_identity.sql seeds.

begin;
select plan(60);

-- ---------------------------------------------------------------------------
-- Structure, and the three actors
-- ---------------------------------------------------------------------------

select has_table('erp', 'person',            'people exist');
select has_table('erp', 'identity_decision', 'the identity decision log exists');
select has_table('erp', 'person_credential', 'credentials exist');
select has_column('erp', 'person',      'as_of_decision_id', 'a person carries the decision behind their status (I-8)');
select has_column('erp', 'person_role', 'as_of_decision_id', 'a role assignment carries the decision that granted it (I-8)');

select col_is_fk('erp', 'shifts', 'cashier_id',
  'a shift names a person — the cashier_id that named nobody now has a referent');
select col_is_fk('erp', 'capability_decision', 'actor_id',
  'a capability decision names a person');
-- Deliberately NOT a foreign key: actor_type admits integrations, envelope.ts declares
-- actor_id nullable, and I-5 forbids a central lookup on an operational write. Asserted
-- so that adding one is a decision someone takes on purpose. db-check checks the
-- cashier rows instead.
select col_isnt_fk('erp', 'event_log', 'actor_id',
  'the event log actor is deliberately not a foreign key');

-- ---------------------------------------------------------------------------
-- Signing in (IAM-P01..IAM-P05)
-- ---------------------------------------------------------------------------

select is(erp.verify_pin('1001', '100001') ->> 'status', 'ok',
  'the right PIN signs an active person in');
select is((erp.verify_pin('1001', '100001') ->> 'person_id')::uuid,
  '01936f00-0000-7000-8000-000000000901'::uuid,
  'and names who signed in');

-- CONTROL. …0905 is suspended and holds a valid PIN. If this answers ok, status is a
-- label rather than a control.
select is(erp.verify_pin('1005', '100005'), '{"status": "disabled"}'::jsonb,
  'a suspended person with the correct PIN is told disabled and never ok');

-- CONTROL. IAM-P02: an unknown number answers exactly as a wrong PIN does — the same
-- status and the same countdown — so the answers cannot be used to find out who
-- works here.
select is(erp.verify_pin('1002', '000000'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'a wrong PIN counts down');
select is(erp.verify_pin('9999', '000000'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'an unknown number answers exactly as a wrong PIN does');
select is(erp.verify_pin('1003', '100003'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'a person with no PIN set answers exactly as an unknown number does');

-- IAM-P03: the fifth miss locks — for a real account and an unknown number alike.
select is(array(select erp.verify_pin('1002', '000000') ->> 'status' from generate_series(1, 4)),
  array['wrong', 'wrong', 'wrong', 'locked'],
  'a real account locks on the fifth miss');
select is(array(select erp.verify_pin('9999', '000000') ->> 'status' from generate_series(1, 4)),
  array['wrong', 'wrong', 'wrong', 'locked'],
  'an unknown number locks on the fifth miss too');

-- CONTROL. A lock that refuses only wrong PINs is not a lock.
select is(erp.verify_pin('1002', '100002') ->> 'status', 'locked',
  'a locked account refuses even the correct PIN');
select is(erp.verify_pin('1002', '000000'), erp.verify_pin('9999', '000000'),
  'and the locked answers are identical too, down to locked_until');

-- Expiry. erp.verify_pin() deliberately takes no clock — a p_now argument would let
-- any caller step past a lock — so expiry is tested by moving the lock instead.
update erp.person_credential
   set failed_attempts = 5, locked_until = now() - interval '1 minute'
 where person_id = '01936f00-0000-7000-8000-000000000906';

select is(erp.verify_pin('1006', '000000'), '{"status": "wrong", "attempts_left": 4}'::jsonb,
  'a lock that has run out starts the count again');
select is(erp.verify_pin('1006', '100006') ->> 'status', 'ok',
  'and the correct PIN then signs in');

-- The format is public, so refusing a malformed number early reveals nothing — and
-- it is checked here, not only by an edge that may be replaced.
select is(erp.verify_pin('12ab', '100001'), '{"status": "wrong"}'::jsonb,
  'a malformed employee number is refused before anything is read or counted');

-- ---------------------------------------------------------------------------
-- Permission (IAM-003, IAM-006)
-- ---------------------------------------------------------------------------

select ok(erp.permission_granted('01936f00-0000-7000-8000-000000000901', 'inventory.stock', 'read',
                                 '01936f00-0000-7000-8000-000000000401'),
  'a branch worker may read stock at their own branch');
select is(erp.permission_granted('01936f00-0000-7000-8000-000000000901', 'inventory.stock', 'read',
                                 '01936f00-0000-7000-8000-000000000402'), false,
  'and not at another branch — a facility-scoped role grants there only');
select ok(erp.permission_granted('01936f00-0000-7000-8000-000000000904', 'inventory.stock', 'write',
                                 '01936f00-0000-7000-8000-000000000402'),
  'an organisation-wide role reaches every branch');
select is(erp.permission_granted('01936f00-0000-7000-8000-000000000905', 'inventory.stock', 'read',
                                 '01936f00-0000-7000-8000-000000000401'), false,
  'a suspended person is granted nothing, whatever roles they hold');

-- ---------------------------------------------------------------------------
-- The rule: capability open AND permission granted — neither implies the other
-- ---------------------------------------------------------------------------

select ok(erp.permission_granted('01936f00-0000-7000-8000-000000000907', 'hr.payroll', 'write', null),
  'the accountant holds payroll write');

-- CONTROL, the left half. Granted, and refused anyway, because payroll has no
-- recorded state and so is hidden.
select throws_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000907', 'hr.payroll', 'write', null) $$,
  '23001', null,
  'a granted permission does not open a hidden capability'
);

-- CONTROL, the right half. Stock is enabled; a branch worker holds read and not write.
select throws_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000901', 'inventory.stock', 'write',
                                 '01936f00-0000-7000-8000-000000000401') $$,
  '23001', null,
  'an open capability grants nobody anything'
);

select lives_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000904', 'inventory.stock', 'write',
                                 '01936f00-0000-7000-8000-000000000401') $$,
  'open and granted is admitted'
);

-- CAP-P06: read_only stops new work and keeps history readable.
select lives_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000907', 'finance.month_close', 'read', null) $$,
  'a read_only capability still admits reading its history'
);
select throws_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000907', 'finance.month_close', 'write', null) $$,
  '23001', null,
  'and refuses new work in it'
);
select throws_ok(
  $$ select erp.assert_permitted('01936f00-0000-7000-8000-000000000907', 'hr.payroll', 'read', null) $$,
  '23001', null,
  'a hidden capability is not readable either'
);

-- ---------------------------------------------------------------------------
-- Who may decide
-- ---------------------------------------------------------------------------

-- 0010 recorded who decided and could not ask whether they were allowed to.
select throws_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0101'::uuid, 'inventory.stock', null,
       'enabled', 'testing', '01936f00-0000-7000-8000-000000000901'::uuid,
       'administrator', now()) $$,
  '23001', null,
  'a capability decision by someone who may not administer capabilities is refused'
);
select throws_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0102'::uuid, 'inventory.stock', null,
       'enabled', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid,
       'system', now()) $$,
  '23001', null,
  'claiming to be the system through the application is refused'
);
select throws_ok(
  $$ select erp.create_person(
       '01936f00-0000-7000-8000-0000000e0103'::uuid, '01936f00-0000-7000-8000-0000000e0104'::uuid,
       '4242', 'Nobody', 'لا أحد', null, 'testing',
       '01936f00-0000-7000-8000-000000000901'::uuid, now()) $$,
  '23001', null,
  'a person is created only by someone who may administer identity'
);

-- ---------------------------------------------------------------------------
-- The means of administration cannot remove itself (IAM-P07, CAP-P08)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.bootstrap_administrator(
       '01936f00-0000-7000-8000-0000000e0105'::uuid, '01936f00-0000-7000-8000-0000000e0106'::uuid,
       '4243', 'Usurper', 'منتحل', 'testing') $$,
  '23001', null,
  'no bootstrap while an active administrator exists'
);
select throws_ok(
  $$ select erp.change_person_status(
       '01936f00-0000-7000-8000-0000000e0107'::uuid, '01936f00-0000-7000-8000-000000000900'::uuid,
       'suspended', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', null,
  'the last active administrator cannot be suspended'
);
select throws_ok(
  $$ select erp.revoke_role(
       '01936f00-0000-7000-8000-0000000e0108'::uuid, '01936f00-0000-7000-8000-000000000900'::uuid,
       'administrator', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', null,
  'nor stripped of the role'
);
select throws_ok(
  $$ select erp.grant_role(
       '01936f00-0000-7000-8000-0000000e0109'::uuid, '01936f00-0000-7000-8000-000000000904'::uuid,
       'administrator', '01936f00-0000-7000-8000-000000000401'::uuid, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', null,
  'a protected role is granted organisation-wide or not at all'
);
select throws_ok(
  $$ select erp.grant_role(
       '01936f00-0000-7000-8000-0000000e0110'::uuid, '00000000-0000-0000-0000-000000000001'::uuid,
       'accountant', null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', null,
  'the system principal can be named as an actor and granted nothing'
);
select throws_ok(
  $$ select erp.set_pin(
       '01936f00-0000-7000-8000-0000000e0111'::uuid, '01936f00-0000-7000-8000-000000000903'::uuid,
       '1234', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', null,
  'a PIN is exactly six digits'
);

-- ---------------------------------------------------------------------------
-- Privilege facts — what the runtime cannot do at all
-- ---------------------------------------------------------------------------

-- Facts rather than role-switch collisions, for the reason 060 gives: db-fixtures
-- replays each fixture body alone, where a `set local role` would be missing. Each list
-- names every table privilege PostgreSQL 16 and 17 both know; TRUNCATE matters most,
-- because a row trigger does not fire for it.
select is(has_table_privilege('erp_app', 'erp.person_credential', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime holds no privilege of any kind on credentials — verify_pin answers for it');
select is(has_table_privilege('erp_app', 'erp.credential_miss', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor on the unknown-number counter');
-- 0002 default-grants SELECT on every new table to erp_read. Without 0011's revoke a
-- PIN hash would be in the reporting role's reach.
select is(has_table_privilege('erp_read', 'erp.person_credential', 'SELECT'), false,
  'the reporting role cannot read a PIN hash');
select is(has_table_privilege('erp_read', 'erp.credential_miss', 'SELECT'), false,
  'nor the miss counter');
select is(has_table_privilege('erp_app', 'erp.person', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime writes no person directly');
select is(has_table_privilege('erp_app', 'erp.person_role', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor any role assignment — each has one admitted route, which records it');
select is(has_table_privilege('erp_app', 'erp.identity_decision', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'nor any decision — one appended without its projection would be a decision never in force');
select is(has_function_privilege('erp_app', 'erp.bootstrap_administrator(uuid,uuid,text,text,text,text)', 'EXECUTE'), false,
  'the runtime cannot reach the bootstrap');
-- Every erp function was executable by PUBLIC until 0011 — 0002's per-schema revoke
-- could not undo PostgreSQL's global default — so the reporting role could call a
-- SECURITY DEFINER function that writes. These two would have failed on main.
select is(has_function_privilege('erp_read',
            'erp.decide_capability(uuid,text,uuid,text,text,uuid,text,timestamptz)', 'EXECUTE'), false,
  'the reporting role cannot call a function that writes capability state');
select is(has_function_privilege('erp_read', 'erp.verify_pin(text,text)', 'EXECUTE'), false,
  'nor check PINs');
-- The control for the facts above: the same function returns true where a grant exists.
select ok(has_function_privilege('erp_app', 'erp.verify_pin(text,text)', 'EXECUTE'),
  'the runtime can check a PIN');
select ok(has_table_privilege('erp_read', 'erp.person', 'SELECT'),
  'the reporting role still reads people, so the revoke above is specific');

-- ---------------------------------------------------------------------------
-- IAM-P06 and B-11 — disabled, never deleted
-- ---------------------------------------------------------------------------

-- A person who held a shift cannot be removed, so nothing that names them can come to
-- name nobody. The precondition is built explicitly: …0902 also has a role and a
-- credential, and their foreign keys fire FIRST — so without removing them, this case
-- passed on person_role_person_id_fkey and would have gone on passing with the shift
-- foreign key deleted. The exact constraint is asserted for the same reason. Placed
-- after the sign-in cases, which use …0902.
delete from erp.person_role       where person_id = '01936f00-0000-7000-8000-000000000902';
delete from erp.person_credential where person_id = '01936f00-0000-7000-8000-000000000902';

select throws_ok(
  $$ delete from erp.person where person_id = '01936f00-0000-7000-8000-000000000902' $$,
  '23503',
  'update or delete on table "person" violates foreign key constraint "shifts_cashier_is_a_person" on table "shifts"',
  'a person who held a shift cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- IAM-008 — the identity log is append-only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update erp.identity_decision set reason = 'rewritten' $$,
  '23001', null,
  'an identity decision cannot be edited after the fact'
);
select throws_ok(
  $$ delete from erp.identity_decision $$,
  '23001', null,
  'an identity decision cannot be deleted'
);
-- An UPDATE or DELETE trigger does not see TRUNCATE (0013). CASCADE, because the person
-- tables reference the log, and the refusal must be the trigger's.
select throws_ok(
  $$ truncate erp.identity_decision cascade $$,
  '23001', 'identity_decision is append-only (IAM-008): TRUNCATE denied on identity_decision',
  'nor emptied by TRUNCATE'
);

-- ---------------------------------------------------------------------------
-- IAM-P07 — the recovery bootstrap makes a person an administrator, never a service
-- ---------------------------------------------------------------------------

-- With no active administrator, bootstrap is the recovery path. It must refuse the
-- system principal: otherwise it granted administrator to a service identity, and
-- since that row is active, every later bootstrap was refused. The exact message is
-- asserted because "an active administrator already exists" carries the same
-- SQLSTATE and would let this pass for the wrong reason. A VALID employee number is
-- passed on purpose: with none, the old code was refused by a check constraint before
-- reaching the conflict branch, and the case would not have exercised the defect.
-- …0900 is suspended for this case only and reactivated straight after.
update erp.person set status = 'suspended' where person_id = '01936f00-0000-7000-8000-000000000900';

select throws_ok(
  $$ select erp.bootstrap_administrator(
       '01936f00-0000-7000-8000-0000000e0120'::uuid, erp.system_principal(),
       '4244', 'System', 'النظام', 'testing') $$,
  '23001',
  'only an employee can be bootstrapped as administrator; 00000000-0000-0000-0000-000000000001 is not one (IAM-P07)',
  'the system principal cannot be bootstrapped as administrator'
);

update erp.person set status = 'active' where person_id = '01936f00-0000-7000-8000-000000000900';

-- LAST, because it is the one fixture that commits under db-fixtures. …0903 has no
-- PIN; an administrator sets one, and it then works.
select lives_ok(
  $$ select erp.set_pin(
       '01936f00-0000-7000-8000-0000000e0130'::uuid, '01936f00-0000-7000-8000-000000000903'::uuid,
       '100003', 'First PIN issued.', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'an administrator sets a PIN, and the decision is recorded'
);
select is(erp.verify_pin('1003', '100003') ->> 'status', 'ok',
  'and the person can then sign in with it');

select * from finish();
rollback;
