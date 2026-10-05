-- Synthetic stock (0020). SEC-012: no production data, masked or otherwise.
--
-- Stock is held at a warehouse or a factory (D3, D4), and 0010 seeds only two branches, so
-- this file first creates a site of each kind, then a factory manager assigned to the
-- factory, then a position at both: an opening count, and a few movements after it that
-- give every kind of decision something to show.
--
--   WH-001   the central warehouse, created by the administrator. Its opening count names
--            an item in two packs (cartons and loose kilograms), and the cola in three:
--            the current carton of 24, cans, and two cartons of the RETIRED 12 — stock
--            already held is counted in the pack it is in (I-7). Then a waste, a found
--            carton, and a damage reversed as recorded against the wrong item.
--   FA-001   the factory: an opening count, an expiry, and a waste the factory manager
--            let take the chicken BELOW ZERO, with the reason (D1). Its balance shows
--            -10 kg until a count settles it.
--   …0908    the factory manager, assigned to FA-001 alone. 0035 gives the factory manager
--            the override, so this person holds it there and nowhere else: the
--            facility-scoped writer 150 needs, refused at WH-001.
--
-- WHY HERE AND NOT IN 0010 AND 0015. The two sites are CREATED, by the administrator, not
-- recorded by nobody as the branches are: 140 counts the facilities recorded by nobody,
-- and these are not among them. The person comes after its facility, which a role's
-- scope references.
--
-- A seed states a position rather than replaying a history through the routes (0015,
-- 0040, 0060 do the same), so nothing below calls erp.post_stock(): its recorded_at would
-- be now(), and the three stock logs are append-only, so 0090 could not freeze it. db-check's
-- stock-balances-match-their-ledger and stock-ledger-matches-its-decisions prove the
-- position obeys the ledger's rules.
--
-- Fixed identifiers: facilities …0403 and …0404 and their decisions …5603 and …5604; the
-- person …0908 and decisions …d008 and …d028; stock decisions …57NN. None contains
-- '0000000e', the db-fixtures pattern. EVERY TIMESTAMP IS LITERAL, recorded_at included.
-- Moments are stated in UTC; Riyadh is three hours ahead, so 03:00Z is 06:00 there.

-- ---------------------------------------------------------------------------
-- The sites
-- ---------------------------------------------------------------------------

insert into erp.facility_decision (
  decision_id, kind, facility_id, operating_unit_id, facility_type, code, name_en, name_ar,
  address_en, address_ar, tz_name, latitude, longitude, geofence_radius_m, status,
  reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000005603', 'facility_created', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000000301', 'warehouse', 'WH-001', 'Central Warehouse (synthetic)', 'المستودع المركزي (تجريبي)',
   null, null, 'Asia/Riyadh', null, null, null, 'open',
   'Synthetic organisation: the warehouse stock is held at.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005604', 'facility_created', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-000000000301', 'factory', 'FA-001', 'Central Kitchen Factory (synthetic)', 'مصنع المطبخ المركزي (تجريبي)',
   null, null, 'Asia/Riyadh', null, null, null, 'open',
   'Synthetic organisation: the factory.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

insert into erp.facility (
  facility_id, operating_unit_id, facility_type, code, name_en, name_ar, as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000000301',
   'warehouse', 'WH-001', 'Central Warehouse (synthetic)', 'المستودع المركزي (تجريبي)',
   '01936f00-0000-7000-8000-000000005603', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000000301',
   'factory', 'FA-001', 'Central Kitchen Factory (synthetic)', 'مصنع المطبخ المركزي (تجريبي)',
   '01936f00-0000-7000-8000-000000005604', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

-- ---------------------------------------------------------------------------
-- The factory manager, assigned to the factory (IAM-006)
-- ---------------------------------------------------------------------------

insert into erp.identity_decision (
  decision_id, kind, subject_person_id, status, role_key, scope_facility_id,
  reason, actor_id, actor_type, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-00000000d008', 'person_created', '01936f00-0000-7000-8000-000000000908',
   'active', null, null, 'Factory manager.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-00000000d028', 'role_granted', '01936f00-0000-7000-8000-000000000908',
   null, 'factory_manager', '01936f00-0000-7000-8000-000000000404', 'Runs the factory.',
   '01936f00-0000-7000-8000-000000000900', 'administrator',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

insert into erp.person (
  person_id, employee_number, full_name_en, full_name_ar, person_type, status,
  primary_facility_id, as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000000908', '1008', 'Test Factory Manager (synthetic)', 'مدير مصنع تجريبي',
   'employee', 'active', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-00000000d008', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

insert into erp.person_role (person_id, role_key, scope_facility_id, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000908', 'factory_manager', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-00000000d028', timestamptz '2026-09-20 00:00:00+00');

-- ---------------------------------------------------------------------------
-- The decisions, in the order they were made
-- ---------------------------------------------------------------------------

insert into erp.stock_decision (
  decision_id, kind, facility_id, occurred_at, business_date, reverses_decision_id, override_reason,
  reason, actor_id, decided_at, recorded_at
) values
  -- The opening counts. A first count finds the book at nothing, so all it found is posted in.
  ('01936f00-0000-7000-8000-000000005701', 'count', '01936f00-0000-7000-8000-000000000403',
   timestamptz '2026-09-25 03:00:00+00', date '2026-09-25', null, null,
   'Opening count (synthetic).', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-25 03:30:00+00', timestamptz '2026-09-25 03:30:00+00'),
  ('01936f00-0000-7000-8000-000000005702', 'count', '01936f00-0000-7000-8000-000000000404',
   timestamptz '2026-09-25 04:00:00+00', date '2026-09-25', null, null,
   'Opening count (synthetic).', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-09-25 04:30:00+00', timestamptz '2026-09-25 04:30:00+00'),
  ('01936f00-0000-7000-8000-000000005703', 'waste', '01936f00-0000-7000-8000-000000000403',
   timestamptz '2026-09-26 07:00:00+00', date '2026-09-26', null, null,
   'Spoiled in chiller 2 (synthetic).', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-26 07:05:00+00', timestamptz '2026-09-26 07:05:00+00'),
  ('01936f00-0000-7000-8000-000000005704', 'adjustment', '01936f00-0000-7000-8000-000000000403',
   timestamptz '2026-09-27 06:00:00+00', date '2026-09-27', null, null,
   'Found behind the pallet rack (synthetic).', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-27 06:10:00+00', timestamptz '2026-09-27 06:10:00+00'),
  ('01936f00-0000-7000-8000-000000005705', 'damage', '01936f00-0000-7000-8000-000000000403',
   timestamptz '2026-09-28 08:00:00+00', date '2026-09-28', null, null,
   'Bottle split on the shelf (synthetic).', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-28 08:05:00+00', timestamptz '2026-09-28 08:05:00+00'),
  -- Dated at the moment it undoes, decided an hour later.
  ('01936f00-0000-7000-8000-000000005706', 'reversal', '01936f00-0000-7000-8000-000000000403',
   timestamptz '2026-09-28 08:00:00+00', date '2026-09-28', '01936f00-0000-7000-8000-000000005705', null,
   'Recorded against the wrong item: that bottle was intact (synthetic).', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-28 09:00:00+00', timestamptz '2026-09-28 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000005707', 'expiry', '01936f00-0000-7000-8000-000000000404',
   timestamptz '2026-09-29 05:00:00+00', date '2026-09-29', null, null,
   'Past its use-by date (synthetic).', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-09-29 05:10:00+00', timestamptz '2026-09-29 05:10:00+00'),
  -- D1: 50 kg out of 40, let through by a person who may override, with the reason.
  ('01936f00-0000-7000-8000-000000005708', 'waste', '01936f00-0000-7000-8000-000000000404',
   timestamptz '2026-09-30 11:00:00+00', date '2026-09-30', null,
   'The morning delivery is not entered yet (synthetic).',
   'Dropped while unloading (synthetic).', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-09-30 11:05:00+00', timestamptz '2026-09-30 11:05:00+00');

-- What the counts found, in the packs they were found in.
insert into erp.stock_count_log (
  decision_id, line_no, kind, facility_id, occurred_at, business_date,
  item_id, item_unit_id, unit_key, factor, quantity, base_quantity
) values
  -- WH-001: chicken breast, 12 cartons of 10 kg and 3.5 kg loose — 123.5 kg.
  ('01936f00-0000-7000-8000-000000005701', 1, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', 'carton', 10, 12, 120),
  ('01936f00-0000-7000-8000-000000005701', 2, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 3.5, 3.5),
  -- Cola: 40 cartons of 24, 2 of the retired 12, 6 cans — 990 cans.
  ('01936f00-0000-7000-8000-000000005701', 3, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004210', 'carton', 24, 40, 960),
  ('01936f00-0000-7000-8000-000000005701', 4, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004209', 'carton', 12, 2, 24),
  ('01936f00-0000-7000-8000-000000005701', 5, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004208', 'can', 1, 6, 6),
  -- Meal boxes, 10 packs of 50; rice, 20 bags of 5 kg; sanitiser, 8 bottles of 5 l; oil, 6 buckets of 18 l.
  ('01936f00-0000-7000-8000-000000005701', 6, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000004213', 'pack', 50, 10, 500),
  ('01936f00-0000-7000-8000-000000005701', 7, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004226', 'bag', 5, 20, 100),
  ('01936f00-0000-7000-8000-000000005701', 8, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004216', 'bottle', 5, 8, 40),
  ('01936f00-0000-7000-8000-000000005701', 9, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004110', '01936f00-0000-7000-8000-000000004224', 'bucket', 18, 6, 108),
  -- FA-001: chicken strips, 5 trays of 40 and 12 loose — 212 pieces; chicken breast, 4 cartons.
  ('01936f00-0000-7000-8000-000000005702', 1, 'count', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-25 04:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004207', 'tray', 40, 5, 200),
  ('01936f00-0000-7000-8000-000000005702', 2, 'count', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-25 04:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004205', 'piece', 1, 12, 12),
  ('01936f00-0000-7000-8000-000000005702', 3, 'count', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-25 04:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', 'carton', 10, 4, 40);

-- The entries. A count's are its variances, in each item's base conversion, by item code.
insert into erp.stock_ledger (
  decision_id, line_no, kind, facility_id, occurred_at, business_date,
  item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity
) values
  ('01936f00-0000-7000-8000-000000005701', 1, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004214', 'l', 1, 'in', 40, 40),
  ('01936f00-0000-7000-8000-000000005701', 2, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004208', 'can', 1, 'in', 990, 990),
  ('01936f00-0000-7000-8000-000000005701', 3, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000004211', 'piece', 1, 'in', 500, 500),
  ('01936f00-0000-7000-8000-000000005701', 4, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 'in', 123.5, 123.5),
  ('01936f00-0000-7000-8000-000000005701', 5, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004110', '01936f00-0000-7000-8000-000000004223', 'l', 1, 'in', 108, 108),
  ('01936f00-0000-7000-8000-000000005701', 6, 'count', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-25 03:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004225', 'kg', 1, 'in', 100, 100),
  ('01936f00-0000-7000-8000-000000005702', 1, 'count', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-25 04:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 'in', 40, 40),
  ('01936f00-0000-7000-8000-000000005702', 2, 'count', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-25 04:00:00+00', date '2026-09-25',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004205', 'piece', 1, 'in', 212, 212),
  -- 2 kg of chicken, in kilograms.
  ('01936f00-0000-7000-8000-000000005703', 1, 'waste', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-26 07:00:00+00', date '2026-09-26',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 'out', 2, 2),
  -- A carton of 24 cans, found.
  ('01936f00-0000-7000-8000-000000005704', 1, 'adjustment', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-27 06:00:00+00', date '2026-09-27',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004210', 'carton', 24, 'in', 1, 24),
  -- A bottle of sanitiser, damaged — and reversed below.
  ('01936f00-0000-7000-8000-000000005705', 1, 'damage', '01936f00-0000-7000-8000-000000000403', timestamptz '2026-09-28 08:00:00+00', date '2026-09-28',
   '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004216', 'bottle', 5, 'out', 1, 5),
  -- A tray of strips, expired.
  ('01936f00-0000-7000-8000-000000005707', 1, 'expiry', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-29 05:00:00+00', date '2026-09-29',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004207', 'tray', 40, 'out', 1, 40),
  -- Five cartons of chicken, 50 kg, where 40 kg was held.
  ('01936f00-0000-7000-8000-000000005708', 1, 'waste', '01936f00-0000-7000-8000-000000000404', timestamptz '2026-09-30 11:00:00+00', date '2026-09-30',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', 'carton', 10, 'out', 5, 50);

-- The reversal's entry mirrors the damage's, naming it.
insert into erp.stock_ledger (
  decision_id, line_no, kind, facility_id, occurred_at, business_date,
  item_id, item_unit_id, unit_key, factor, direction, quantity, base_quantity, reverses_entry_id
)
select '01936f00-0000-7000-8000-000000005706', 1, 'reversal', e.facility_id, e.occurred_at, e.business_date,
       e.item_id, e.item_unit_id, e.unit_key, e.factor, 'in', e.quantity, e.base_quantity, e.entry_id
from erp.stock_ledger e
where e.decision_id = '01936f00-0000-7000-8000-000000005705' and e.line_no = 1;

-- ---------------------------------------------------------------------------
-- The balances, each the sum of its entries and stamped with the latest decision about it
-- ---------------------------------------------------------------------------

insert into erp.stock_balance (facility_id, item_id, on_hand, last_counted_at, as_of_decision_id, updated_at) values
  -- WH-001
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004101', 121.5, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005703', timestamptz '2026-09-26 07:05:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004103', 1014, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005704', timestamptz '2026-09-27 06:10:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004104', 500, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005701', timestamptz '2026-09-25 03:30:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004105', 40, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005706', timestamptz '2026-09-28 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004110', 108, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005701', timestamptz '2026-09-25 03:30:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004111', 100, timestamptz '2026-09-25 03:00:00+00',
   '01936f00-0000-7000-8000-000000005701', timestamptz '2026-09-25 03:30:00+00'),
  -- FA-001
  ('01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000004101', -10, timestamptz '2026-09-25 04:00:00+00',
   '01936f00-0000-7000-8000-000000005708', timestamptz '2026-09-30 11:05:00+00'),
  ('01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000004102', 172, timestamptz '2026-09-25 04:00:00+00',
   '01936f00-0000-7000-8000-000000005707', timestamptz '2026-09-29 05:10:00+00');
