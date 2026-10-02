-- Synthetic people, roles and credentials. SEC-012: no production data, masked or
-- otherwise.
--
-- WHY 0015 AND NOT 0040. Two later files name people: 0020's shifts carry
-- cashier_id and 0030's capability decisions carry actor_id, and since 0011 both are
-- real foreign keys to erp.person. So the people are seeded before either. What a
-- role may DO references capabilities, which 0030 seeds, so that half is
-- 0035_role_permissions.sql.
--
-- The cast, each here for a reason:
--
--   …0900  administrator, organisation-wide — the bootstrap
--   …0901  cashier at branch one, PIN set — the ordinary case
--   …0902  cashier at branch one, PIN set — the identical-answers case
--   …0903  cashier at branch TWO, NO PIN — named only by the event log, never by a
--          shift, which is what makes it the awkward case for db-check's
--          cashier-actors-resolve-to-a-person
--   …0904  warehouse manager, organisation-wide — scope that reaches every branch
--   …0905  cashier, SUSPENDED, holding a valid PIN — the control: a correct PIN
--          must still not sign them in
--   …0906  cashier, PIN set — the lockout fixture, so locking it disturbs nobody
--   …0907  accountant, organisation-wide — holds payroll permissions on a payroll
--          capability nobody has opened, which is the hidden-but-granted case
--
-- EVERY TIMESTAMP IS LITERAL, including recorded_at. erp.identity_decision is
-- append-only, so 0090_freeze_timestamps.sql cannot reach it.
--
-- THE PINs ARE IN CLEAR HERE, deliberately, and synthetic: a test that verifies a PIN
-- needs one. The salt is LITERAL, not gen_salt(), because gen_salt() is random and
-- two builds must be identical (LAB-005). Cost 6 rather than erp.set_pin()'s 10,
-- because this runs on every db reset. Only the 29-character salt appears in the
-- file, never a full 60-character hash, so secret-scan's bcrypt rule stays able to
-- catch a real one.

-- ---------------------------------------------------------------------------
-- Roles beyond the administrator, which 0011 creates. The warehouse system's six,
-- with its `customer` renamed: in one ERP the branches are not the warehouse's
-- customers, they are where branch workers sell.
-- ---------------------------------------------------------------------------

insert into erp.role (role_key, name_en, name_ar, protected, created_at) values
  ('branch_worker',     'Branch worker',     'موظف الفرع',    false, timestamptz '2026-09-20 00:00:00+00'),
  ('warehouse_manager', 'Warehouse manager', 'مدير المستودع', false, timestamptz '2026-09-20 00:00:00+00'),
  ('factory_manager',   'Factory manager',   'مدير المصنع',   false, timestamptz '2026-09-20 00:00:00+00'),
  ('general_manager',   'General manager',   'المدير العام',  false, timestamptz '2026-09-20 00:00:00+00'),
  ('accountant',        'Accountant',        'المحاسب',       false, timestamptz '2026-09-20 00:00:00+00');

-- ---------------------------------------------------------------------------
-- The decisions. A seed states a position rather than replaying a history through
-- the functions, as 0030 does — but every projection row below still names the
-- decision it rests on.
-- ---------------------------------------------------------------------------

insert into erp.identity_decision (
  decision_id, kind, subject_person_id, status, role_key, scope_facility_id,
  reason, actor_id, actor_type, decided_at, recorded_at
) values
  -- IAM-P07. The administrator arrives by bootstrap, taken by the system.
  ('01936f00-0000-7000-8000-00000000d000', 'bootstrap', '01936f00-0000-7000-8000-000000000900',
   'active', 'administrator', null,
   'First administrator, while none was active.',
   '00000000-0000-0000-0000-000000000001', 'system',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),

  ('01936f00-0000-7000-8000-00000000d001', 'person_created', '01936f00-0000-7000-8000-000000000901',
   'active', null, null, 'Joined branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d002', 'person_created', '01936f00-0000-7000-8000-000000000902',
   'active', null, null, 'Joined branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d003', 'person_created', '01936f00-0000-7000-8000-000000000903',
   'active', null, null, 'Joined branch two.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d004', 'person_created', '01936f00-0000-7000-8000-000000000904',
   'active', null, null, 'Warehouse manager.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d005', 'person_created', '01936f00-0000-7000-8000-000000000905',
   'active', null, null, 'Joined branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d006', 'person_created', '01936f00-0000-7000-8000-000000000906',
   'active', null, null, 'Joined branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d007', 'person_created', '01936f00-0000-7000-8000-000000000907',
   'active', null, null, 'Accountant.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),

  -- IAM-009. Suspended, not deleted — and still holding a PIN, which is the point.
  ('01936f00-0000-7000-8000-00000000d015', 'status_changed', '01936f00-0000-7000-8000-000000000905',
   'suspended', null, null, 'Suspended pending an HR review.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),

  -- IAM-006. Branch workers are scoped to their branch; managers and the
  -- accountant reach every facility.
  ('01936f00-0000-7000-8000-00000000d021', 'role_granted', '01936f00-0000-7000-8000-000000000901',
   null, 'branch_worker', '01936f00-0000-7000-8000-000000000401', 'Works the tills at branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d022', 'role_granted', '01936f00-0000-7000-8000-000000000902',
   null, 'branch_worker', '01936f00-0000-7000-8000-000000000401', 'Works the tills at branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d023', 'role_granted', '01936f00-0000-7000-8000-000000000903',
   null, 'branch_worker', '01936f00-0000-7000-8000-000000000402', 'Works the tills at branch two.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d024', 'role_granted', '01936f00-0000-7000-8000-000000000904',
   null, 'warehouse_manager', null, 'Runs the central warehouse.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d025', 'role_granted', '01936f00-0000-7000-8000-000000000905',
   null, 'branch_worker', '01936f00-0000-7000-8000-000000000401', 'Works the tills at branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d026', 'role_granted', '01936f00-0000-7000-8000-000000000906',
   null, 'branch_worker', '01936f00-0000-7000-8000-000000000401', 'Works the tills at branch one.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d027', 'role_granted', '01936f00-0000-7000-8000-000000000907',
   null, 'accountant', null, 'Keeps the books.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),

  -- Credentials. …0903 deliberately has none.
  ('01936f00-0000-7000-8000-00000000d031', 'credential_set', '01936f00-0000-7000-8000-000000000901',
   null, null, null, 'First PIN issued.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d032', 'credential_set', '01936f00-0000-7000-8000-000000000902',
   null, null, null, 'First PIN issued.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d035', 'credential_set', '01936f00-0000-7000-8000-000000000905',
   null, null, null, 'First PIN issued.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d036', 'credential_set', '01936f00-0000-7000-8000-000000000906',
   null, null, null, 'First PIN issued.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

-- ---------------------------------------------------------------------------
-- The projections
-- ---------------------------------------------------------------------------

insert into erp.person (
  person_id, employee_number, full_name_en, full_name_ar, person_type, status,
  primary_facility_id, as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000000900', '1000', 'Test Administrator (synthetic)', 'مسؤول تجريبي',
   'employee', 'active', null,
   '01936f00-0000-7000-8000-00000000d000', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000901', '1001', 'Test Cashier One (synthetic)', 'كاشير تجريبي ١',
   'employee', 'active', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d001', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000902', '1002', 'Test Cashier Two (synthetic)', 'كاشير تجريبي ٢',
   'employee', 'active', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d002', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000903', '1003', 'Test Cashier Three (synthetic)', 'كاشير تجريبي ٣',
   'employee', 'active', '01936f00-0000-7000-8000-000000000402',
   '01936f00-0000-7000-8000-00000000d003', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000904', '1004', 'Test Warehouse Manager (synthetic)', 'مدير مستودع تجريبي',
   'employee', 'active', null,
   '01936f00-0000-7000-8000-00000000d004', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000905', '1005', 'Test Suspended Cashier (synthetic)', 'كاشير موقوف تجريبي',
   'employee', 'suspended', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d015', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000906', '1006', 'Test Cashier Six (synthetic)', 'كاشير تجريبي ٦',
   'employee', 'active', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d006', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000907', '1007', 'Test Accountant (synthetic)', 'محاسب تجريبي',
   'employee', 'active', null,
   '01936f00-0000-7000-8000-00000000d007', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

insert into erp.person_role (person_id, role_key, scope_facility_id, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000900', 'administrator',     erp.org_scope(),
   '01936f00-0000-7000-8000-00000000d000', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000901', 'branch_worker',     '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d021', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000902', 'branch_worker',     '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d022', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000903', 'branch_worker',     '01936f00-0000-7000-8000-000000000402',
   '01936f00-0000-7000-8000-00000000d023', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000904', 'warehouse_manager', erp.org_scope(),
   '01936f00-0000-7000-8000-00000000d024', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000905', 'branch_worker',     '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d025', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000906', 'branch_worker',     '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-00000000d026', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000907', 'accountant',        erp.org_scope(),
   '01936f00-0000-7000-8000-00000000d027', timestamptz '2026-09-20 00:00:00+00');

insert into erp.person_credential (person_id, pin_hash, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000901', extensions.crypt('100001', '$2a$06$SyntheticSeedSaltOnly.'),
   '01936f00-0000-7000-8000-00000000d031', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000902', extensions.crypt('100002', '$2a$06$SyntheticSeedSaltOnly.'),
   '01936f00-0000-7000-8000-00000000d032', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000905', extensions.crypt('100005', '$2a$06$SyntheticSeedSaltOnly.'),
   '01936f00-0000-7000-8000-00000000d035', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000906', extensions.crypt('100006', '$2a$06$SyntheticSeedSaltOnly.'),
   '01936f00-0000-7000-8000-00000000d036', timestamptz '2026-09-20 00:00:00+00');
