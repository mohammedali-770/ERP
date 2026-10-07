-- Synthetic purchase orders (0023). SEC-012: no production data, masked or otherwise.
--
-- After 0050, whose supplies every line orders, and 0070, whose sites the orders go to. Chosen
-- so each state an order can be in already exists, and none has received anything: a receipt
-- moves stock, and every figure the stock, stock-alert and notification packs quote stands on
-- 0070's balances as they are. Receipts are made in the suites, and in the session.
--
--   …0907    the accountant, organisation-wide, approves (0035): the approver P3 needs, since
--            nobody approves an order they raised. In the warehouse the general manager
--            approved, but the test data has no general manager, and adding one would change
--            who every stock bell already rings for (0021, 0022), which other suites and
--            packs count.
--   WH-001   an approval limit of 5,000.00 riyals, set by the administrator. Then:
--            0001  chicken, 60 cartons at 125.00 — 7,500.00 before VAT: over the limit, PENDING.
--            0002  rice and cola from the local supplier, who is not VAT-registered, so 0% —
--                  1,260.00: within the limit, APPROVED when raised, by the limit.
--            0003  meal boxes, 15 cartons of 200 at 400.00 — 6,000.00: pending, then APPROVED
--                  by the accountant.
--            0004  chicken, 500 kg at 13.00 — 6,500.00: pending, then REJECTED by the
--                  accountant.
--            0005  rice, 120 bags at 45.00 — 5,400.00: pending, then CANCELLED by the
--                  warehouse manager who raised it.
--   FA-001   no limit, so every order waits: chicken, 200 kg at 12.50 — 2,500.00, PENDING,
--            raised by the factory manager.
--
-- A seed states a position rather than replaying a history through the routes, as 0070 does:
-- the routes' recorded_at would be now(), and the logs are append-only, so 0090 could not
-- freeze them. db-check's purchase-orders-match-their-decisions and
-- purchase-limits-match-their-decisions prove the position obeys the routes' rules.
--
-- Fixed identifiers: orders …59NN; order
-- decisions …60NN; limit decisions …61NN. None contains '0000000e', the db-fixtures pattern.
-- EVERY TIMESTAMP IS LITERAL, recorded_at included. Riyadh is three hours ahead of UTC.

-- ---------------------------------------------------------------------------
-- The limit at WH-001
-- ---------------------------------------------------------------------------

insert into erp.purchase_limit_decision (
  decision_id, kind, facility_id, limit_minor, currency, reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000006101', 'limit_set', '01936f00-0000-7000-8000-000000000403', 500000, 'SAR',
   'Synthetic: a week of routine orders.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-25 06:00:00+00', timestamptz '2026-09-25 06:00:00+00');

insert into erp.purchase_limit (facility_id, limit_minor, currency, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000403', 500000, 'SAR', '01936f00-0000-7000-8000-000000006101',
   timestamptz '2026-09-25 06:00:00+00');

-- ---------------------------------------------------------------------------
-- The orders, and every decision about them, in the order they were made
-- ---------------------------------------------------------------------------

insert into erp.purchase_order_decision (
  decision_id, kind, purchase_order_id, facility_id, state, limit_decision_id, supplier_id, number,
  business_date, day_seq, currency, vat_rate_bp, subtotal_minor, vat_minor, total_minor, reason, actor_id,
  decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000006001', 'order_raised', '01936f00-0000-7000-8000-000000005901',
   '01936f00-0000-7000-8000-000000000403', 'pending', null, '01936f00-0000-7000-8000-000000005101',
   'WH-001-PO-20260930-0001', date '2026-09-30', 1, 'SAR', 1500, 750000, 112500, 862500,
   'Synthetic: the week''s chicken.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-30 05:00:00+00', timestamptz '2026-09-30 05:00:00+00'),
  ('01936f00-0000-7000-8000-000000006002', 'order_raised', '01936f00-0000-7000-8000-000000005902',
   '01936f00-0000-7000-8000-000000000403', 'approved', '01936f00-0000-7000-8000-000000006101',
   '01936f00-0000-7000-8000-000000005103', 'WH-001-PO-20260930-0002', date '2026-09-30', 2, 'SAR', 0, 126000, 0, 126000,
   'Synthetic: rice and cola from the local supplier.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-09-30 05:30:00+00', timestamptz '2026-09-30 05:30:00+00'),
  ('01936f00-0000-7000-8000-000000006003', 'order_raised', '01936f00-0000-7000-8000-000000005903',
   '01936f00-0000-7000-8000-000000000403', 'pending', null, '01936f00-0000-7000-8000-000000005102',
   'WH-001-PO-20261001-0001', date '2026-10-01', 1, 'SAR', 1500, 600000, 90000, 690000,
   'Synthetic: meal boxes for the month.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-01 05:00:00+00', timestamptz '2026-10-01 05:00:00+00'),
  ('01936f00-0000-7000-8000-000000006004', 'order_raised', '01936f00-0000-7000-8000-000000005904',
   '01936f00-0000-7000-8000-000000000403', 'pending', null, '01936f00-0000-7000-8000-000000005101',
   'WH-001-PO-20261001-0002', date '2026-10-01', 2, 'SAR', 1500, 650000, 97500, 747500,
   'Synthetic: loose chicken for a promotion.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-01 05:10:00+00', timestamptz '2026-10-01 05:10:00+00'),
  ('01936f00-0000-7000-8000-000000006005', 'order_raised', '01936f00-0000-7000-8000-000000005906',
   '01936f00-0000-7000-8000-000000000404', 'pending', null, '01936f00-0000-7000-8000-000000005101',
   'FA-001-PO-20261001-0001', date '2026-10-01', 1, 'SAR', 1500, 250000, 37500, 287500,
   'Synthetic: chicken for tomorrow''s strips.', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-10-01 06:00:00+00', timestamptz '2026-10-01 06:00:00+00'),
  ('01936f00-0000-7000-8000-000000006006', 'order_approved', '01936f00-0000-7000-8000-000000005903',
   '01936f00-0000-7000-8000-000000000403', 'approved', null, null, null, null, null, null, null, null, null, null,
   'Synthetic: within the month''s budget.', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-10-01 09:00:00+00', timestamptz '2026-10-01 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000006007', 'order_rejected', '01936f00-0000-7000-8000-000000005904',
   '01936f00-0000-7000-8000-000000000403', 'rejected', null, null, null, null, null, null, null, null, null, null,
   'Synthetic: the promotion is postponed.', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-10-01 09:05:00+00', timestamptz '2026-10-01 09:05:00+00'),
  ('01936f00-0000-7000-8000-000000006008', 'order_raised', '01936f00-0000-7000-8000-000000005905',
   '01936f00-0000-7000-8000-000000000403', 'pending', null, '01936f00-0000-7000-8000-000000005103',
   'WH-001-PO-20261002-0001', date '2026-10-02', 1, 'SAR', 0, 540000, 0, 540000,
   'Synthetic: rice for the quarter.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-02 05:00:00+00', timestamptz '2026-10-02 05:00:00+00'),
  ('01936f00-0000-7000-8000-000000006009', 'order_cancelled', '01936f00-0000-7000-8000-000000005905',
   '01936f00-0000-7000-8000-000000000403', 'cancelled', null, null, null, null, null, null, null, null, null, null,
   'Synthetic: raised for the wrong quarter.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-02 05:20:00+00', timestamptz '2026-10-02 05:20:00+00');

insert into erp.purchase_order (
  purchase_order_id, facility_id, supplier_id, number, business_date, day_seq, currency, vat_rate_bp,
  subtotal_minor, vat_minor, total_minor, raised_by, raised_at, raised_decision_id, state, as_of_decision_id, updated_at
) values
  ('01936f00-0000-7000-8000-000000005901', '01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000005101',
   'WH-001-PO-20260930-0001', date '2026-09-30', 1, 'SAR', 1500, 750000, 112500, 862500,
   '01936f00-0000-7000-8000-000000000904', timestamptz '2026-09-30 05:00:00+00', '01936f00-0000-7000-8000-000000006001',
   'pending', '01936f00-0000-7000-8000-000000006001', timestamptz '2026-09-30 05:00:00+00'),
  ('01936f00-0000-7000-8000-000000005902', '01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000005103',
   'WH-001-PO-20260930-0002', date '2026-09-30', 2, 'SAR', 0, 126000, 0, 126000,
   '01936f00-0000-7000-8000-000000000904', timestamptz '2026-09-30 05:30:00+00', '01936f00-0000-7000-8000-000000006002',
   'approved', '01936f00-0000-7000-8000-000000006002', timestamptz '2026-09-30 05:30:00+00'),
  ('01936f00-0000-7000-8000-000000005903', '01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000005102',
   'WH-001-PO-20261001-0001', date '2026-10-01', 1, 'SAR', 1500, 600000, 90000, 690000,
   '01936f00-0000-7000-8000-000000000904', timestamptz '2026-10-01 05:00:00+00', '01936f00-0000-7000-8000-000000006003',
   'approved', '01936f00-0000-7000-8000-000000006006', timestamptz '2026-10-01 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000005904', '01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000005101',
   'WH-001-PO-20261001-0002', date '2026-10-01', 2, 'SAR', 1500, 650000, 97500, 747500,
   '01936f00-0000-7000-8000-000000000904', timestamptz '2026-10-01 05:10:00+00', '01936f00-0000-7000-8000-000000006004',
   'rejected', '01936f00-0000-7000-8000-000000006007', timestamptz '2026-10-01 09:05:00+00'),
  ('01936f00-0000-7000-8000-000000005905', '01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000005103',
   'WH-001-PO-20261002-0001', date '2026-10-02', 1, 'SAR', 0, 540000, 0, 540000,
   '01936f00-0000-7000-8000-000000000904', timestamptz '2026-10-02 05:00:00+00', '01936f00-0000-7000-8000-000000006008',
   'cancelled', '01936f00-0000-7000-8000-000000006009', timestamptz '2026-10-02 05:20:00+00'),
  ('01936f00-0000-7000-8000-000000005906', '01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000005101',
   'FA-001-PO-20261001-0001', date '2026-10-01', 1, 'SAR', 1500, 250000, 37500, 287500,
   '01936f00-0000-7000-8000-000000000908', timestamptz '2026-10-01 06:00:00+00', '01936f00-0000-7000-8000-000000006005',
   'pending', '01936f00-0000-7000-8000-000000006005', timestamptz '2026-10-01 06:00:00+00');

-- Through the seam: each line's (item_unit_id, item_id, unit_key, factor) is its supply's, and
-- the conversion's own, which the foreign keys prove.
insert into erp.purchase_order_line (
  purchase_order_id, line_no, supplier_item_id, item_unit_id, item_id, unit_key, factor,
  quantity, base_quantity, price_minor, amount_minor
) values
  ('01936f00-0000-7000-8000-000000005901', 1, '01936f00-0000-7000-8000-000000005201',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 60, 600, 12500, 750000),
  ('01936f00-0000-7000-8000-000000005902', 1, '01936f00-0000-7000-8000-000000005206',
   '01936f00-0000-7000-8000-000000004226', '01936f00-0000-7000-8000-000000004111', 'bag', 5, 20, 100, 4500, 90000),
  ('01936f00-0000-7000-8000-000000005902', 2, '01936f00-0000-7000-8000-000000005205',
   '01936f00-0000-7000-8000-000000004210', '01936f00-0000-7000-8000-000000004103', 'carton', 24, 10, 240, 3600, 36000),
  ('01936f00-0000-7000-8000-000000005903', 1, '01936f00-0000-7000-8000-000000005203',
   '01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 15, 3000, 40000, 600000),
  ('01936f00-0000-7000-8000-000000005904', 1, '01936f00-0000-7000-8000-000000005202',
   '01936f00-0000-7000-8000-000000004201', '01936f00-0000-7000-8000-000000004101', 'kg', 1, 500, 500, 1300, 650000),
  ('01936f00-0000-7000-8000-000000005905', 1, '01936f00-0000-7000-8000-000000005206',
   '01936f00-0000-7000-8000-000000004226', '01936f00-0000-7000-8000-000000004111', 'bag', 5, 120, 600, 4500, 540000),
  ('01936f00-0000-7000-8000-000000005906', 1, '01936f00-0000-7000-8000-000000005202',
   '01936f00-0000-7000-8000-000000004201', '01936f00-0000-7000-8000-000000004101', 'kg', 1, 200, 200, 1250, 250000);
