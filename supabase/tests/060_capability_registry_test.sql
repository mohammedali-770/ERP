-- pgTAP · the capability registry, proved by being refused by it
--
-- CAP-P04 is the point of this suite: "a capability that is not available shall
-- refuse new commands IN THE DATABASE ITSELF, and the removal of a menu entry or a
-- screen shall never be the only control preventing its use." A test that only read
-- the catalogue would prove the tables exist and nothing about whether they stop
-- anything, so every behavioural case here is a collision.
--
-- NOTE ON FIXTURES AND db:fixtures. tools/db-fixtures replays each throws_ok and
-- lives_ok body standalone, outside a transaction, so anything that commits stays
-- committed. erp.capability_decision is append-only and its reset is therefore
-- impossible by design — a DELETE is refused by the same trigger this suite tests.
-- Every fixture below is non-committing except the last, which is placed last for
-- exactly that reason: nothing after it depends on the state it changes. That is
-- also why this suite adds no entry to db-fixtures' reset list.

begin;
select plan(19);

-- Structure. Four reads, because the stamp's EXISTENCE and its NULLability are
-- different questions: db-check asserts `not attnotnull` over a discovered column,
-- which passes silently if the column is renamed away.
select has_table('erp', 'capability',          'the register exists');
select has_table('erp', 'capability_decision', 'the decision log exists');
select has_table('erp', 'capability_state',    'the state projection exists');
select has_column('erp', 'capability_state', 'as_of_decision_id', 'the projection carries its stamp (I-8)');

-- ---------------------------------------------------------------------------
-- CAP-P02 and CAP-P04 — admission, and default-deny
-- ---------------------------------------------------------------------------

-- THE CONTROL. hr.payroll has no decision in the seed at all, deliberately: the
-- only way to seed "no recorded state" is to record nothing. CAP-P02 says that
-- resolves to hidden, and CAP-P04 says hidden refuses new work. If this passes
-- without raising, the registry is decoration.
select throws_ok(
  $$ select erp.assert_capability_admits('hr.payroll',
       '00000000-0000-0000-0000-000000000000') $$,
  '23001', null,
  'a capability with no recorded state refuses new work'
);

select lives_ok(
  $$ select erp.assert_capability_admits('inventory.stock',
       '00000000-0000-0000-0000-000000000000') $$,
  'an enabled capability admits new work'
);

-- pilot admits. The state exists so a module can be open to named users while it is
-- verified, which a boolean could not express.
select lives_ok(
  $$ select erp.assert_capability_admits('factory.production',
       '00000000-0000-0000-0000-000000000000') $$,
  'a pilot capability admits new work'
);

-- CAP-P06. read_only stops NEW work…
select throws_ok(
  $$ select erp.assert_capability_admits('finance.month_close',
       '00000000-0000-0000-0000-000000000000') $$,
  '23001', null,
  'a read_only capability refuses new work'
);

-- …while its history stays readable, which is the half of CAP-P06 that a single
-- on/off flag gets wrong: hiding the data is not the same as stopping the work.
select is(
  erp.capability_state_for('finance.month_close', '00000000-0000-0000-0000-000000000000'),
  'read_only',
  'a read_only capability is still resolvable, so its data stays readable'
);

-- Default-deny for a key nobody has decided anything about.
select is(
  erp.capability_state_for('does.not.exist', '00000000-0000-0000-0000-000000000000'),
  'hidden',
  'an unknown capability resolves to hidden rather than to nothing'
);

-- ---------------------------------------------------------------------------
-- CAP-P03 — the decision log is append-only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update erp.capability_decision set reason = 'rewritten' $$,
  '23001', null,
  'a decision cannot be edited after the fact'
);

select throws_ok(
  $$ delete from erp.capability_decision $$,
  '23001', null,
  'a decision cannot be deleted — it is unmade by appending another'
);

-- ---------------------------------------------------------------------------
-- The projection has exactly one admitted writer
-- ---------------------------------------------------------------------------

-- This is what makes CAP-P04 structural rather than advisory. erp_app holds SELECT
-- on the projection and no write of any kind, so the only route to a state is
-- erp.decide_capability(), which records the decision in the same transaction.
-- Without this, a runtime could set a state nobody decided.
-- A privilege fact rather than a collision, deliberately. A collision would need
-- `set local role` and then an UPDATE, and tools/db-fixtures replays each fixture
-- body alone, where the role switch would be missing and the UPDATE would run as
-- the owner — passing or failing for a reason unrelated to what is asserted.
select is(
  has_table_privilege('erp_app', 'erp.capability_state', 'UPDATE'),
  false,
  'the runtime holds no UPDATE on the state projection'
);
select is(
  has_table_privilege('erp_app', 'erp.capability_state', 'INSERT'),
  false,
  'nor INSERT — erp.decide_capability() is the only admitted route to a state'
);
select is(
  has_table_privilege('erp_app', 'erp.capability_decision', 'DELETE'),
  false,
  'nor DELETE on the decision log'
);

-- ---------------------------------------------------------------------------
-- CAP-P08 and CAP-P07 — what a decision may not do
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0001'::uuid, 'platform.capability_admin', null,
       'hidden', 'testing', '01936f00-0000-7000-8000-000000000901'::uuid,
       'administrator', now()) $$,
  '23001', null,
  'a protected capability cannot be closed through the application'
);

-- factory.production depends on inventory.stock and is pilot, so it is open.
-- Closing stock underneath it would leave production consuming something it cannot
-- write, which is the failure CAP-P07 names.
select throws_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0002'::uuid, 'inventory.stock', null,
       'withdrawn', 'testing', '01936f00-0000-7000-8000-000000000901'::uuid,
       'administrator', now()) $$,
  '23001', null,
  'a capability cannot be closed while an open capability depends on it'
);

-- A reason is required and may not be blank. "Who opened this the night the numbers
-- moved" is the question the log exists to answer, and an empty string does not
-- answer it.
select throws_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0003'::uuid, 'hr.payroll', null,
       'enabled', '   ', '01936f00-0000-7000-8000-000000000901'::uuid,
       'administrator', now()) $$,
  '23514', null,
  'a decision without a stated reason is refused'
);

-- LAST, because it is the one fixture that commits. Closing factory.production is
-- permitted: nothing depends on it, and it is not protected. Placed here so that
-- nothing above it depends on the state this changes — see the note at the top.
select lives_ok(
  $$ select erp.decide_capability(
       '01936f00-0000-7000-8000-0000000e0004'::uuid, 'factory.production', null,
       'withdrawn', 'Verified and superseded; closing it to new work.',
       '01936f00-0000-7000-8000-000000000901'::uuid, 'administrator', now()) $$,
  'a capability nothing depends on can be closed, and the decision is recorded'
);

select * from finish();
rollback;
