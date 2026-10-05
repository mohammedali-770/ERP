-- Synthetic capability registry. SEC-012: no production data, masked or otherwise.
--
-- Four capabilities here and two protected ones from 0011, covering every state the
-- registry has, because a seed that only exercises the happy one leaves the
-- interesting paths untested: a protected capability that cannot be closed, a
-- dependency edge that blocks a close, a capability that was never built, and one
-- closed to new work whose history is still readable.
--
-- platform.capability_admin USED to be seeded here. It moved to migration 0011 with
-- platform.identity_admin, because a real database needs both before anyone can
-- decide anything, and a seed does not run there.
--
-- Every decision below is taken by the seeded administrator, …0900 (0015). They
-- named …0901 until 0011 gave actor_id a referent — and …0901 is a cashier, so the
-- old seed recorded a cashier taking administrative decisions as an administrator.
--
-- Identifiers are fixed constants, not generated, so `db reset` produces an
-- identical database every time (LAB-005).
--
-- EVERY TIMESTAMP IS LITERAL, including recorded_at. erp.capability_decision is
-- append-only, so 0090_freeze_timestamps.sql cannot reach it — the same reason
-- event_log is excluded there, and the reason event_log sets ingested_at explicitly.
-- A default now() here would make two builds differ and fail db:check.

insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('inventory.stock',           'Stock and movements',      'المخزون والحركات',
   array['INV-001','INV-006'],  false, timestamptz '2026-09-20 00:00:00+00'),
  ('factory.production',        'Production',               'الإنتاج',
   array['MFG-004','MFG-005'],  false, timestamptz '2026-09-20 00:00:00+00'),
  ('hr.payroll',                'Payroll',                  'الرواتب',
   array['HR-001'],             false, timestamptz '2026-09-20 00:00:00+00'),
  ('finance.month_close',       'Month close',              'إقفال الشهر',
   array['FIN-007'],            false, timestamptz '2026-09-20 00:00:00+00');

-- CAP-P07. Production consumes stock, so stock cannot be closed while production
-- is open. This edge is what the dependency test collides with.
insert into erp.capability_depends_on (capability_key, depends_on_key) values
  ('factory.production', 'inventory.stock');

-- The decisions. hr.payroll deliberately has NONE: CAP-P02 says a capability with
-- no recorded state resolves to hidden, and the only way to seed that is to record
-- nothing — so this absence is the fixture.
insert into erp.capability_decision (
  decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-00000000c002', 'inventory.stock', null, 'enabled',
   'Carried over and its evidence produced.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000c003', 'factory.production', null, 'pilot',
   'Open to named pilot users only while the daily sheet is verified.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000c004', 'finance.month_close', null, 'read_only',
   'Closed to new work while the payment freeze stands; its history stays readable.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  -- inventory.items is registered HIDDEN by migration 0012. This opens it for the suites
  -- only: a real database records no decision, so the module stays hidden there until a
  -- migration promotes it after its data layer, screens and staff testing exist.
  ('01936f00-0000-7000-8000-00000000c005', 'inventory.items', null, 'pilot',
   'Synthetic: open to the suites. A real database records no decision, so the module is hidden until UAT.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  -- procurement.suppliers (0016): the same, for module 2.
  ('01936f00-0000-7000-8000-00000000c006', 'procurement.suppliers', null, 'pilot',
   'Synthetic: open to the suites. A real database records no decision, so the module is hidden until UAT.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  -- inventory.transfer_prices (0018): the same, for module 3.
  ('01936f00-0000-7000-8000-00000000c007', 'inventory.transfer_prices', null, 'pilot',
   'Synthetic: open to the suites. A real database records no decision, so the module is hidden until UAT.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

-- The projection, stamped with the decision each row was computed through (I-8).
-- Written directly here rather than through erp.decide_capability() because a seed
-- states a position; it does not replay a history. The function is what the
-- application uses and what the pgTAP suite exercises.
insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id, updated_at) values
  ('inventory.stock',           erp.capability_org_scope(), 'enabled',
   '01936f00-0000-7000-8000-00000000c002', timestamptz '2026-09-20 00:00:00+00'),
  ('factory.production',        erp.capability_org_scope(), 'pilot',
   '01936f00-0000-7000-8000-00000000c003', timestamptz '2026-09-20 00:00:00+00'),
  ('finance.month_close',       erp.capability_org_scope(), 'read_only',
   '01936f00-0000-7000-8000-00000000c004', timestamptz '2026-09-20 00:00:00+00'),
  ('inventory.items',           erp.capability_org_scope(), 'pilot',
   '01936f00-0000-7000-8000-00000000c005', timestamptz '2026-09-20 00:00:00+00'),
  ('procurement.suppliers',     erp.capability_org_scope(), 'pilot',
   '01936f00-0000-7000-8000-00000000c006', timestamptz '2026-09-20 00:00:00+00'),
  ('inventory.transfer_prices', erp.capability_org_scope(), 'pilot',
   '01936f00-0000-7000-8000-00000000c007', timestamptz '2026-09-20 00:00:00+00');
