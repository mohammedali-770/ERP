-- Synthetic transfer prices (0018). SEC-012: no production data, masked or otherwise.
--
-- The cases each rule needs:
--
--   RM-CHK-BREAST by the 10 kg carton
--     18500 from 2026-09-01, superseded by 19000 from 2026-09-15 — the history, and
--     the price in force; 19500 set ahead from 2099-01-01 — a price not yet in effect;
--     20000 set ahead from 2099-02-01 and withdrawn — a withdrawn price
--   PK-MEAL-BOX-M by the carton of 200: 4000
--   PK-MEAL-BOX-M by the piece: 0 — free, because somebody decided it, not by default
--   PK-MEAL-BOX-M by the pack of 50: NO price — an unpriced pack, which the seam refuses
--   FP-COLA-330 by the carton of 12: 3000, set before that conversion was retired — a
--     retired pack keeps its price history
--   B2-BOX by the piece: 150 — the second brand's, so a first-brand facility must not
--     see it
--
-- Fixed identifiers: prices …54NN, decisions …55NN. None contains '0000000e', the
-- db-fixtures pattern. EVERY TIMESTAMP IS LITERAL: erp.transfer_price_decision is
-- append-only, so 0090_freeze_timestamps.sql cannot reach it. seq follows insertion
-- order, which is the order of the decisions, so two builds are identical. Each decision
-- is made at or before the moment its price takes effect: none is backdated.
--
-- A seed states a position, as 0040 does; db-check's
-- transfer-prices-match-their-decisions proves it equals its decisions.

insert into erp.transfer_price_decision (
  decision_id, kind, price_id, item_unit_id, item_id, unit_key, factor, price_minor, currency, effective_from,
  status, reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000005501', 'price_set', '01936f00-0000-7000-8000-000000005401',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 18500, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', 'Synthetic transfer prices.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-08-31 00:00:00+00', timestamptz '2026-08-31 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005502', 'price_set', '01936f00-0000-7000-8000-000000005402',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 19000, 'SAR',
   timestamptz '2026-09-15 00:00:00+00', 'active', 'Supplier price rise passed on.', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-09-14 00:00:00+00', timestamptz '2026-09-14 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005503', 'price_set', '01936f00-0000-7000-8000-000000005403',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 19500, 'SAR',
   timestamptz '2099-01-01 00:00:00+00', 'active', 'Set ahead (synthetic).', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005504', 'price_set', '01936f00-0000-7000-8000-000000005404',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 20000, 'SAR',
   timestamptz '2099-02-01 00:00:00+00', 'active', 'Set ahead (synthetic).', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005505', 'price_withdrawn', '01936f00-0000-7000-8000-000000005404',
   '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 20000, 'SAR',
   timestamptz '2099-02-01 00:00:00+00', 'withdrawn', 'Entered in error (synthetic).', '01936f00-0000-7000-8000-000000000907',
   timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005506', 'price_set', '01936f00-0000-7000-8000-000000005405',
   '01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 4000, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', 'Synthetic transfer prices.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-08-31 00:00:00+00', timestamptz '2026-08-31 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005507', 'price_set', '01936f00-0000-7000-8000-000000005406',
   '01936f00-0000-7000-8000-000000004211', '01936f00-0000-7000-8000-000000004104', 'piece', 1, 0, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', 'Loose boxes are not charged (synthetic).', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-08-31 00:00:00+00', timestamptz '2026-08-31 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005508', 'price_set', '01936f00-0000-7000-8000-000000005407',
   '01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, 3000, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', 'Synthetic transfer prices.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-08-31 00:00:00+00', timestamptz '2026-08-31 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005509', 'price_set', '01936f00-0000-7000-8000-000000005408',
   '01936f00-0000-7000-8000-000000004227', '01936f00-0000-7000-8000-000000004112', 'piece', 1, 150, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', 'Synthetic transfer prices.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-08-31 00:00:00+00', timestamptz '2026-08-31 00:00:00+00');

insert into erp.transfer_price (
  price_id, item_unit_id, item_id, unit_key, factor, price_minor, currency, effective_from, status, as_of_decision_id,
  created_at, updated_at
) values
  ('01936f00-0000-7000-8000-000000005401', '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 18500, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005501', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005402', '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 19000, 'SAR',
   timestamptz '2026-09-15 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005502', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005403', '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 19500, 'SAR',
   timestamptz '2099-01-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005503', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005404', '01936f00-0000-7000-8000-000000004203', '01936f00-0000-7000-8000-000000004101', 'carton', 10, 20000, 'SAR',
   timestamptz '2099-02-01 00:00:00+00', 'withdrawn', '01936f00-0000-7000-8000-000000005505', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005405', '01936f00-0000-7000-8000-000000004212', '01936f00-0000-7000-8000-000000004104', 'carton', 200, 4000, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005506', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005406', '01936f00-0000-7000-8000-000000004211', '01936f00-0000-7000-8000-000000004104', 'piece', 1, 0, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005507', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005407', '01936f00-0000-7000-8000-000000004209', '01936f00-0000-7000-8000-000000004103', 'carton', 12, 3000, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005508', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00'),
  ('01936f00-0000-7000-8000-000000005408', '01936f00-0000-7000-8000-000000004227', '01936f00-0000-7000-8000-000000004112', 'piece', 1, 150, 'SAR',
   timestamptz '2026-09-01 00:00:00+00', 'active', '01936f00-0000-7000-8000-000000005509', timestamptz '2026-09-20 00:00:00+00', timestamptz '2026-09-20 00:00:00+00');
