-- Synthetic item master (0012). SEC-012: no production data, masked or otherwise.
--
-- Twelve items covering every INV-002 kind, and the awkward cases each rule needs to be
-- tested against:
--
--   RM-CHK-BREAST     raw ingredient in kg, with g derived, a carton and an average
--                     piece weight — a count anchor on a mass item
--   SF-CHK-STRIPS     semi-finished, counted in pieces, with 1 kg = 8 pieces — a mass
--                     anchor on a count item. g is deliberately NOT declared: 080 derives it
--   FP-COLA-330       a PACK as the base unit, an Arabic name with Arabic-Indic digits,
--                     and the I-7 pack-size change: carton of 12 retired, carton of 24 added
--   PK-MEAL-BOX-M     two packs on one item
--   CL-SANITISER      a volume item with a bottle
--   OP-GLOVES         a factor below one, held exactly (1 piece = 0.01 box)
--   EQ-FRYER-BASKET   only its base unit — the missing-conversion control
--   SP-FRYER-GASKET   only its base unit — the delete control
--   RM-FRYING-OIL-OLD retired: its code is burned and its name freed …
--   RM-FRYING-OIL     … for this item, which carries the same names and is active
--   RM-RICE           amended after creation, so its stamp is not its creation decision
--   B2-PKG-MEAL-BOX-M brand SECOND, with names identical to PK-MEAL-BOX-M: names are
--                     unique per brand, codes globally
--
-- Fixed identifiers: items …41NN, conversions …42NN, decisions …43NN. None contains
-- '0000000e', the db-fixtures pattern. EVERY TIMESTAMP IS LITERAL, recorded_at included:
-- erp.item_decision is append-only, so 0090_freeze_timestamps.sql cannot reach it. seq
-- follows insertion order, so two builds are identical.
--
-- A seed states a position rather than replaying a history through the routes (as 0015
-- and 0030 do); db-check's item-projections-match-their-decisions proves the position
-- equals its decisions. The item_unit trigger still validates every conversion below.
--
-- Left out deliberately: no price, cost, stock, minimum, supplier, display order or
-- picture. Those belong to later modules.

insert into erp.item_decision (
  decision_id, kind, item_id, item_unit_id, code, item_kind, base_unit_key, brand_id,
  name_en, name_ar, description_en, description_ar, unit_key, factor, status,
  reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000004301', 'item_created', '01936f00-0000-7000-8000-000000004101', null, 'RM-CHK-BREAST', 'raw_ingredient', 'kg', '01936f00-0000-7000-8000-000000000201',
   'Chicken breast (synthetic)', 'صدر دجاج (تجريبي)', 'Boneless and skinless (synthetic)', 'بدون عظم وجلد (تجريبي)', null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004302', 'unit_added', '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', null, null, null, null,
   null, null, null, null, 'kg', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004303', 'item_created', '01936f00-0000-7000-8000-000000004102', null, 'SF-CHK-STRIPS', 'semi_finished', 'piece', '01936f00-0000-7000-8000-000000000201',
   'Chicken strips (synthetic)', 'شرائح دجاج (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004304', 'unit_added', '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004205', null, null, null, null,
   null, null, null, null, 'piece', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004305', 'item_created', '01936f00-0000-7000-8000-000000004103', null, 'FP-COLA-330', 'finished_product', 'can', '01936f00-0000-7000-8000-000000000201',
   'Cola 330 ml (synthetic)', 'كولا ٣٣٠ مل (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004306', 'unit_added', '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004208', null, null, null, null,
   null, null, null, null, 'can', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004307', 'item_created', '01936f00-0000-7000-8000-000000004104', null, 'PK-MEAL-BOX-M', 'packaging', 'piece', '01936f00-0000-7000-8000-000000000201',
   'Meal box medium (synthetic)', 'علبة وجبة وسط (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004308', 'unit_added', '01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000004211', null, null, null, null,
   null, null, null, null, 'piece', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004309', 'item_created', '01936f00-0000-7000-8000-000000004105', null, 'CL-SANITISER', 'cleaning_supply', 'l', '01936f00-0000-7000-8000-000000000201',
   'Surface sanitiser (synthetic)', 'معقم أسطح (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004310', 'unit_added', '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004214', null, null, null, null,
   null, null, null, null, 'l', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004311', 'item_created', '01936f00-0000-7000-8000-000000004106', null, 'OP-GLOVES', 'operating_supply', 'box', '01936f00-0000-7000-8000-000000000201',
   'Disposable gloves (synthetic)', 'قفازات للاستعمال مرة واحدة (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004312', 'unit_added', '01936f00-0000-7000-8000-000000004106', '01936f00-0000-7000-8000-000000004217', null, null, null, null,
   null, null, null, null, 'box', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004313', 'item_created', '01936f00-0000-7000-8000-000000004107', null, 'EQ-FRYER-BASKET', 'equipment', 'piece', '01936f00-0000-7000-8000-000000000201',
   'Fryer basket (synthetic)', 'سلة قلاية (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004314', 'unit_added', '01936f00-0000-7000-8000-000000004107', '01936f00-0000-7000-8000-000000004220', null, null, null, null,
   null, null, null, null, 'piece', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004315', 'item_created', '01936f00-0000-7000-8000-000000004108', null, 'SP-FRYER-GASKET', 'spare_part', 'piece', '01936f00-0000-7000-8000-000000000201',
   'Fryer gasket (synthetic)', 'جوان قلاية (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004316', 'unit_added', '01936f00-0000-7000-8000-000000004108', '01936f00-0000-7000-8000-000000004221', null, null, null, null,
   null, null, null, null, 'piece', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004317', 'item_created', '01936f00-0000-7000-8000-000000004109', null, 'RM-FRYING-OIL-OLD', 'raw_ingredient', 'l', '01936f00-0000-7000-8000-000000000201',
   'Frying oil (synthetic)', 'زيت قلي (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004318', 'unit_added', '01936f00-0000-7000-8000-000000004109', '01936f00-0000-7000-8000-000000004222', null, null, null, null,
   null, null, null, null, 'l', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004319', 'item_created', '01936f00-0000-7000-8000-000000004110', null, 'RM-FRYING-OIL', 'raw_ingredient', 'l', '01936f00-0000-7000-8000-000000000201',
   'Frying oil (synthetic)', 'زيت قلي (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004320', 'unit_added', '01936f00-0000-7000-8000-000000004110', '01936f00-0000-7000-8000-000000004223', null, null, null, null,
   null, null, null, null, 'l', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004321', 'item_created', '01936f00-0000-7000-8000-000000004111', null, 'RM-RICE', 'raw_ingredient', 'kg', '01936f00-0000-7000-8000-000000000201',
   'Rice (synthetic)', 'أرز (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004322', 'unit_added', '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004225', null, null, null, null,
   null, null, null, null, 'kg', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004323', 'item_created', '01936f00-0000-7000-8000-000000004112', null, 'B2-PKG-MEAL-BOX-M', 'packaging', 'piece', '01936f00-0000-7000-8000-000000000202',
   'Meal box medium (synthetic)', 'علبة وجبة وسط (تجريبي)', null, null, null, null, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004324', 'unit_added', '01936f00-0000-7000-8000-000000004112', '01936f00-0000-7000-8000-000000004227', null, null, null, null,
   null, null, null, null, 'piece', 1, 'active',
   'Synthetic catalogue.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004325', 'unit_added', '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004202', null, null, null, null,
   null, null, null, null, 'g', 0.001, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004326', 'unit_added', '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', null, null, null, null,
   null, null, null, null, 'carton', 10, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004327', 'unit_added', '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004204', null, null, null, null,
   null, null, null, null, 'piece', 0.25, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004328', 'unit_added', '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004206', null, null, null, null,
   null, null, null, null, 'kg', 8, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004329', 'unit_added', '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004207', null, null, null, null,
   null, null, null, null, 'tray', 40, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004330', 'unit_added', '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004209', null, null, null, null,
   null, null, null, null, 'carton', 12, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004331', 'unit_added', '01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000004212', null, null, null, null,
   null, null, null, null, 'carton', 200, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004332', 'unit_added', '01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000004213', null, null, null, null,
   null, null, null, null, 'pack', 50, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004333', 'unit_added', '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004215', null, null, null, null,
   null, null, null, null, 'ml', 0.001, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004334', 'unit_added', '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004216', null, null, null, null,
   null, null, null, null, 'bottle', 5, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004335', 'unit_added', '01936f00-0000-7000-8000-000000004106', '01936f00-0000-7000-8000-000000004218', null, null, null, null,
   null, null, null, null, 'carton', 10, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004336', 'unit_added', '01936f00-0000-7000-8000-000000004106', '01936f00-0000-7000-8000-000000004219', null, null, null, null,
   null, null, null, null, 'piece', 0.01, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004337', 'unit_added', '01936f00-0000-7000-8000-000000004110', '01936f00-0000-7000-8000-000000004224', null, null, null, null,
   null, null, null, null, 'bucket', 18, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004338', 'unit_added', '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004226', null, null, null, null,
   null, null, null, null, 'bag', 5, 'active',
   'Synthetic pack size.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004339', 'unit_retired', '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004209', null, null, null, null,
   null, null, null, null, 'carton', 12, 'retired',
   'Supplier now packs 24 (synthetic).', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-21 00:00:00+00', timestamptz '2026-09-21 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004340', 'unit_added', '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004210', null, null, null, null,
   null, null, null, null, 'carton', 24, 'active',
   'Supplier now packs 24 (synthetic).', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-21 00:00:00+00', timestamptz '2026-09-21 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004341', 'item_status_changed', '01936f00-0000-7000-8000-000000004109', null, 'RM-FRYING-OIL-OLD', 'raw_ingredient', 'l', '01936f00-0000-7000-8000-000000000201',
   'Frying oil (synthetic)', 'زيت قلي (تجريبي)', null, null, null, null, 'retired',
   'Superseded by RM-FRYING-OIL (synthetic).', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-21 00:00:00+00', timestamptz '2026-09-21 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004342', 'item_amended', '01936f00-0000-7000-8000-000000004111', null, 'RM-RICE', 'raw_ingredient', 'kg', '01936f00-0000-7000-8000-000000000201',
   'Basmati rice (synthetic)', 'أرز بسمتي (تجريبي)', null, null, null, null, 'active',
   'Named for the grade bought (synthetic).', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-22 00:00:00+00', timestamptz '2026-09-22 00:00:00+00');

-- The items, each stamped with the decision that left it as it is (I-8).
insert into erp.item (
  item_id, code, item_kind, base_unit_key, brand_id, name_en, name_ar,
  description_en, description_ar, picture_path, status, as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000004101', 'RM-CHK-BREAST', 'raw_ingredient', 'kg', '01936f00-0000-7000-8000-000000000201', 'Chicken breast (synthetic)', 'صدر دجاج (تجريبي)',
   'Boneless and skinless (synthetic)', 'بدون عظم وجلد (تجريبي)', null, 'active', '01936f00-0000-7000-8000-000000004301', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004102', 'SF-CHK-STRIPS', 'semi_finished', 'piece', '01936f00-0000-7000-8000-000000000201', 'Chicken strips (synthetic)', 'شرائح دجاج (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004303', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004103', 'FP-COLA-330', 'finished_product', 'can', '01936f00-0000-7000-8000-000000000201', 'Cola 330 ml (synthetic)', 'كولا ٣٣٠ مل (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004305', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004104', 'PK-MEAL-BOX-M', 'packaging', 'piece', '01936f00-0000-7000-8000-000000000201', 'Meal box medium (synthetic)', 'علبة وجبة وسط (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004307', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004105', 'CL-SANITISER', 'cleaning_supply', 'l', '01936f00-0000-7000-8000-000000000201', 'Surface sanitiser (synthetic)', 'معقم أسطح (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004309', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004106', 'OP-GLOVES', 'operating_supply', 'box', '01936f00-0000-7000-8000-000000000201', 'Disposable gloves (synthetic)', 'قفازات للاستعمال مرة واحدة (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004311', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004107', 'EQ-FRYER-BASKET', 'equipment', 'piece', '01936f00-0000-7000-8000-000000000201', 'Fryer basket (synthetic)', 'سلة قلاية (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004313', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004108', 'SP-FRYER-GASKET', 'spare_part', 'piece', '01936f00-0000-7000-8000-000000000201', 'Fryer gasket (synthetic)', 'جوان قلاية (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004315', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004109', 'RM-FRYING-OIL-OLD', 'raw_ingredient', 'l', '01936f00-0000-7000-8000-000000000201', 'Frying oil (synthetic)', 'زيت قلي (تجريبي)',
   null, null, null, 'retired', '01936f00-0000-7000-8000-000000004341', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004110', 'RM-FRYING-OIL', 'raw_ingredient', 'l', '01936f00-0000-7000-8000-000000000201', 'Frying oil (synthetic)', 'زيت قلي (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004319', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004111', 'RM-RICE', 'raw_ingredient', 'kg', '01936f00-0000-7000-8000-000000000201', 'Basmati rice (synthetic)', 'أرز بسمتي (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004342', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004112', 'B2-PKG-MEAL-BOX-M', 'packaging', 'piece', '01936f00-0000-7000-8000-000000000202', 'Meal box medium (synthetic)', 'علبة وجبة وسط (تجريبي)',
   null, null, null, 'active', '01936f00-0000-7000-8000-000000004323', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

-- The conversions, base row first per item. Every one converts straight to its item's
-- base unit; the retired carton of 12 stays as an immutable row a document can still name.
insert into erp.item_unit (item_unit_id, item_id, unit_key, factor, status, as_of_decision_id, created_at, updated_at) values
  ('01936f00-0000-7000-8000-000000004201', '01936f00-0000-7000-8000-000000004101', 'kg', 1, 'active', '01936f00-0000-7000-8000-000000004302', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004202', '01936f00-0000-7000-8000-000000004101', 'g', 0.001, 'active', '01936f00-0000-7000-8000-000000004325', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 'active', '01936f00-0000-7000-8000-000000004326', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004204', '01936f00-0000-7000-8000-000000004101', 'piece', 0.25, 'active', '01936f00-0000-7000-8000-000000004327', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004205', '01936f00-0000-7000-8000-000000004102', 'piece', 1, 'active', '01936f00-0000-7000-8000-000000004304', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004206', '01936f00-0000-7000-8000-000000004102', 'kg', 8, 'active', '01936f00-0000-7000-8000-000000004328', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004207', '01936f00-0000-7000-8000-000000004102', 'tray', 40, 'active', '01936f00-0000-7000-8000-000000004329', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004208', '01936f00-0000-7000-8000-000000004103', 'can', 1, 'active', '01936f00-0000-7000-8000-000000004306', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, 'retired', '01936f00-0000-7000-8000-000000004339', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004210', '01936f00-0000-7000-8000-000000004103', 'carton', 24, 'active', '01936f00-0000-7000-8000-000000004340', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004211', '01936f00-0000-7000-8000-000000004104', 'piece', 1, 'active', '01936f00-0000-7000-8000-000000004308', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 'active', '01936f00-0000-7000-8000-000000004331', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004213', '01936f00-0000-7000-8000-000000004104', 'pack', 50, 'active', '01936f00-0000-7000-8000-000000004332', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004214', '01936f00-0000-7000-8000-000000004105', 'l', 1, 'active', '01936f00-0000-7000-8000-000000004310', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004215', '01936f00-0000-7000-8000-000000004105', 'ml', 0.001, 'active', '01936f00-0000-7000-8000-000000004333', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004216', '01936f00-0000-7000-8000-000000004105', 'bottle', 5, 'active', '01936f00-0000-7000-8000-000000004334', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004217', '01936f00-0000-7000-8000-000000004106', 'box', 1, 'active', '01936f00-0000-7000-8000-000000004312', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004218', '01936f00-0000-7000-8000-000000004106', 'carton', 10, 'active', '01936f00-0000-7000-8000-000000004335', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004219', '01936f00-0000-7000-8000-000000004106', 'piece', 0.01, 'active', '01936f00-0000-7000-8000-000000004336', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004220', '01936f00-0000-7000-8000-000000004107', 'piece', 1, 'active', '01936f00-0000-7000-8000-000000004314', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004221', '01936f00-0000-7000-8000-000000004108', 'piece', 1, 'active', '01936f00-0000-7000-8000-000000004316', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004222', '01936f00-0000-7000-8000-000000004109', 'l', 1, 'active', '01936f00-0000-7000-8000-000000004318', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004223', '01936f00-0000-7000-8000-000000004110', 'l', 1, 'active', '01936f00-0000-7000-8000-000000004320', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004224', '01936f00-0000-7000-8000-000000004110', 'bucket', 18, 'active', '01936f00-0000-7000-8000-000000004337', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004225', '01936f00-0000-7000-8000-000000004111', 'kg', 1, 'active', '01936f00-0000-7000-8000-000000004322', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004226', '01936f00-0000-7000-8000-000000004111', 'bag', 5, 'active', '01936f00-0000-7000-8000-000000004338', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000004227', '01936f00-0000-7000-8000-000000004112', 'piece', 1, 'active', '01936f00-0000-7000-8000-000000004324', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');
