-- Synthetic stock minimums (0022). SEC-012: no production data, masked or otherwise.
--
-- After 0070, whose balances these stand beside. Chosen so each state the low-stock list
-- and the bell can be in already exists:
--
--   WH-001   chicken breast: 10 cartons (100 kg), on hand 121.5 kg — NOT low. A waste of
--            3 cartons takes it across, and rings (pgTAP 170, the UAT pack).
--            sanitiser: 10 bottles (50 l), on hand 40 l — low, and never rang: a minimum
--            set above the balance does not (A2).
--            rice: 20 bags (100 kg), then cleared — a history, and no minimum.
--   FA-001   chicken strips: 5 trays (200 pieces), on hand 172 — low; set by the factory
--            manager, who holds stock alerts there alone.
--            chicken breast: 20 kg, on hand -10 — low, and below zero.
--
-- A seed states a position rather than replaying a history through the routes, as 0070
-- does: nothing below calls erp.set_stock_minimum(), whose recorded_at would be now(), and
-- the log is append-only, so 0090 could not freeze it. db-check's
-- stock-minimums-match-their-decisions proves the projection obeys its log.
--
-- Fixed identifiers: decisions …58NN. None contains '0000000e', the db-fixtures pattern.
-- EVERY TIMESTAMP IS LITERAL, recorded_at included.

insert into erp.stock_minimum_decision (
  decision_id, kind, facility_id, item_id, item_unit_id, unit_key, factor, quantity, minimum,
  reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000005801', 'minimum_set', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', 'carton', 10, 10, 100,
   'Synthetic: two days of the branches'' orders.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-26 08:00:00+00', timestamptz '2026-09-26 08:00:00+00'),
  ('01936f00-0000-7000-8000-000000005802', 'minimum_set', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000004216', 'bottle', 5, 10, 50,
   'Synthetic: a month of cleaning.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-28 10:00:00+00', timestamptz '2026-09-28 10:00:00+00'),
  ('01936f00-0000-7000-8000-000000005803', 'minimum_set', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004226', 'bag', 5, 20, 100,
   'Synthetic: a week of rice.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-26 08:05:00+00', timestamptz '2026-09-26 08:05:00+00'),
  ('01936f00-0000-7000-8000-000000005804', 'minimum_cleared', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000004111', null, null, null, null, null,
   'Synthetic: rice is now ordered weekly whatever is left.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-09-27 09:00:00+00', timestamptz '2026-09-27 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000005805', 'minimum_set', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004207', 'tray', 40, 5, 200,
   'Synthetic: a day of production.', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-09-29 06:00:00+00', timestamptz '2026-09-29 06:00:00+00'),
  ('01936f00-0000-7000-8000-000000005806', 'minimum_set', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 20, 20,
   'Synthetic: a morning''s strips.', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-09-29 06:05:00+00', timestamptz '2026-09-29 06:05:00+00');

insert into erp.stock_minimum (facility_id, item_id, minimum, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004101', 100,
   '01936f00-0000-7000-8000-000000005801', timestamptz '2026-09-26 08:00:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004105', 50,
   '01936f00-0000-7000-8000-000000005802', timestamptz '2026-09-28 10:00:00+00'),
  ('01936f00-0000-7000-8000-000000000403', '01936f00-0000-7000-8000-000000004111', null,
   '01936f00-0000-7000-8000-000000005804', timestamptz '2026-09-27 09:00:00+00'),
  ('01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000004102', 200,
   '01936f00-0000-7000-8000-000000005805', timestamptz '2026-09-29 06:00:00+00'),
  ('01936f00-0000-7000-8000-000000000404', '01936f00-0000-7000-8000-000000004101', 20,
   '01936f00-0000-7000-8000-000000005806', timestamptz '2026-09-29 06:05:00+00');
