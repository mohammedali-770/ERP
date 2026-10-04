-- Synthetic suppliers (0016). SEC-012: no production data, masked or otherwise.
--
-- Five suppliers and eight supplies covering the cases each rule needs:
--
--   SUP-POULTRY  VAT- and CR-registered, with contacts set by a contact decision that
--                carries no contact value (SEC-008). Sells chicken breast in two
--                conversions — 10 kg cartons, preferred, with their own code added by an
--                amendment, and loose kg
--   SUP-PACK     sells medium meal boxes by the carton of 200, preferred
--   SUP-LOCAL    neither VAT- nor CR-registered, cash terms (0 days). The I-7 pack-size
--                change: its supply of cola by the carton of 12 retired with the
--                conversion, carton of 24 added — both preferred, which the partial index
--                allows because only one is active. Also the preferred supplier of rice
--   SUP-OLD      renamed, then retired. Its supply of frying oil by the bucket stays
--                ACTIVE: retiring a supplier stops new work through
--                erp.assert_supplier_active(), and leaves its supplies alone
--   SUP-B2       sells the SECOND brand's meal box, so a facility of the first brand must
--                not see that supply
--
-- Fixed identifiers: suppliers …51NN, supplies …52NN, decisions …53NN. None contains
-- '0000000e', the db-fixtures pattern. EVERY TIMESTAMP IS LITERAL: erp.supplier_decision
-- is append-only, so 0090_freeze_timestamps.sql cannot reach it. seq follows insertion
-- order, which is the order of the decisions, so two builds are identical.
--
-- A seed states a position, as 0040 does; db-check's
-- supplier-projections-match-their-decisions proves it equals its decisions. Every
-- contact below is synthetic: the phone is in the reserved block db-check allows, the
-- email under .example.test.

insert into erp.supplier_decision (
  decision_id, kind, supplier_id, supplier_item_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
  item_unit_id, item_id, unit_key, factor, supplier_code, preferred, status,
  reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000005301', 'supplier_created', '01936f00-0000-7000-8000-000000005101', null, 'SUP-POULTRY', 'Al Waha Poultry (synthetic)', 'دواجن الواحة (تجريبي)', '310000000000003', '1010000001', 30, null, null, null, null, null, null, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005302', 'supplier_contact_changed', '01936f00-0000-7000-8000-000000005101', null, 'SUP-POULTRY', 'Al Waha Poultry (synthetic)', 'دواجن الواحة (تجريبي)', '310000000000003', '1010000001', 30, null, null, null, null, null, null, 'active',
   'Contact details changed.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005303', 'supplier_created', '01936f00-0000-7000-8000-000000005102', null, 'SUP-PACK', 'Gulf Packaging (synthetic)', 'الخليج للتغليف (تجريبي)', '310000000000103', '1010000002', 60, null, null, null, null, null, null, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005304', 'supplier_created', '01936f00-0000-7000-8000-000000005103', null, 'SUP-LOCAL', 'Corner Grocer (synthetic)', 'بقالة الزاوية (تجريبي)', null, null, 0, null, null, null, null, null, null, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005305', 'supplier_created', '01936f00-0000-7000-8000-000000005104', null, 'SUP-OLD', 'Oil Trader (synthetic)', 'تاجر الزيوت (تجريبي)', '310000000000203', null, 30, null, null, null, null, null, null, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005306', 'supplier_amended', '01936f00-0000-7000-8000-000000005104', null, 'SUP-OLD', 'Former Oil Trader (synthetic)', 'تاجر الزيوت السابق (تجريبي)', '310000000000203', null, 45, null, null, null, null, null, null, 'active',
   'Synthetic: renamed, terms renegotiated.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005307', 'supply_added', '01936f00-0000-7000-8000-000000005104', '01936f00-0000-7000-8000-000000005207', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004224', '01936f00-0000-7000-8000-000000004110', 'bucket', 18, null, false, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005308', 'supplier_status_changed', '01936f00-0000-7000-8000-000000005104', null, 'SUP-OLD', 'Former Oil Trader (synthetic)', 'تاجر الزيوت السابق (تجريبي)', '310000000000203', null, 45, null, null, null, null, null, null, 'retired',
   'Synthetic: no longer trading.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005309', 'supplier_created', '01936f00-0000-7000-8000-000000005105', null, 'SUP-B2', 'Second Brand Boxes (synthetic)', 'علب العلامة الثانية (تجريبي)', '310000000000303', null, 30, null, null, null, null, null, null, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005310', 'supply_added', '01936f00-0000-7000-8000-000000005101', '01936f00-0000-7000-8000-000000005201', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, null, true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005311', 'supply_amended', '01936f00-0000-7000-8000-000000005101', '01936f00-0000-7000-8000-000000005201', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 'WP-CB-10', true, 'active',
   'Synthetic: their code, from the invoice.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005312', 'supply_added', '01936f00-0000-7000-8000-000000005101', '01936f00-0000-7000-8000-000000005202', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004201', '01936f00-0000-7000-8000-000000004101', 'kg', 1, null, false, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005313', 'supply_added', '01936f00-0000-7000-8000-000000005102', '01936f00-0000-7000-8000-000000005203', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 'GP-MB-M', true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005314', 'supply_added', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000005204', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, null, true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005315', 'supply_retired', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000005204', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, null, true, 'retired',
   'Synthetic: the carton of 12 was replaced by 24.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005316', 'supply_added', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000005205', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004210', '01936f00-0000-7000-8000-000000004103', 'carton', 24, null, true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005317', 'supply_added', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000005206', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004226', '01936f00-0000-7000-8000-000000004111', 'bag', 5, null, true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005318', 'supply_added', '01936f00-0000-7000-8000-000000005105', '01936f00-0000-7000-8000-000000005208', null, null, null, null, null, null, '01936f00-0000-7000-8000-000000004227', '01936f00-0000-7000-8000-000000004112', 'piece', 1, null, true, 'active',
   'Synthetic suppliers.', '01936f00-0000-7000-8000-000000000900', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

insert into erp.supplier (
  supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days, status,
  contact_person, phone, email, address, as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000005101', 'SUP-POULTRY', 'Al Waha Poultry (synthetic)', 'دواجن الواحة (تجريبي)', '310000000000003', '1010000001', 30, 'active', 'Contact One (synthetic)', '+966550000001', 'orders@poultry.example.test', 'Synthetic industrial area, Riyadh', '01936f00-0000-7000-8000-000000005302', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005102', 'SUP-PACK', 'Gulf Packaging (synthetic)', 'الخليج للتغليف (تجريبي)', '310000000000103', '1010000002', 60, 'active', null, null, null, null, '01936f00-0000-7000-8000-000000005303', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005103', 'SUP-LOCAL', 'Corner Grocer (synthetic)', 'بقالة الزاوية (تجريبي)', null, null, 0, 'active', null, null, null, null, '01936f00-0000-7000-8000-000000005304', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005104', 'SUP-OLD', 'Former Oil Trader (synthetic)', 'تاجر الزيوت السابق (تجريبي)', '310000000000203', null, 45, 'retired', null, null, null, null, '01936f00-0000-7000-8000-000000005308', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005105', 'SUP-B2', 'Second Brand Boxes (synthetic)', 'علب العلامة الثانية (تجريبي)', '310000000000303', null, 30, 'active', null, null, null, null, '01936f00-0000-7000-8000-000000005309', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');

-- Through the seam: each row's (item_unit_id, item_id, unit_key, factor) is the
-- conversion's own, which the foreign key to item_unit_seam proves.
insert into erp.supplier_item (
  supplier_item_id, supplier_id, item_unit_id, item_id, unit_key, factor, supplier_code, preferred, status,
  as_of_decision_id, created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000005201', '01936f00-0000-7000-8000-000000005101', '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 'WP-CB-10', true, 'active', '01936f00-0000-7000-8000-000000005311', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005202', '01936f00-0000-7000-8000-000000005101', '01936f00-0000-7000-8000-000000004201', '01936f00-0000-7000-8000-000000004101', 'kg', 1, null, false, 'active', '01936f00-0000-7000-8000-000000005312', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005203', '01936f00-0000-7000-8000-000000005102', '01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 'GP-MB-M', true, 'active', '01936f00-0000-7000-8000-000000005313', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005204', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, null, true, 'retired', '01936f00-0000-7000-8000-000000005315', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005205', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000004210', '01936f00-0000-7000-8000-000000004103', 'carton', 24, null, true, 'active', '01936f00-0000-7000-8000-000000005316', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005206', '01936f00-0000-7000-8000-000000005103', '01936f00-0000-7000-8000-000000004226', '01936f00-0000-7000-8000-000000004111', 'bag', 5, null, true, 'active', '01936f00-0000-7000-8000-000000005317', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005207', '01936f00-0000-7000-8000-000000005104', '01936f00-0000-7000-8000-000000004224', '01936f00-0000-7000-8000-000000004110', 'bucket', 18, null, false, 'active', '01936f00-0000-7000-8000-000000005307', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005208', '01936f00-0000-7000-8000-000000005105', '01936f00-0000-7000-8000-000000004227', '01936f00-0000-7000-8000-000000004112', 'piece', 1, null, true, 'active', '01936f00-0000-7000-8000-000000005318', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');
