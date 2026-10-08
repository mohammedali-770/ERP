-- Synthetic ordering setup (0024). SEC-012: no production data, masked or otherwise.
--
-- After 0040, whose items and packs these name, and 0070, whose warehouse and factory supply
-- the branches. Chosen so each state a source and a par can be in already exists — set,
-- cleared, never set — and a cut-off has a history. A cleared cut-off, and a facility with
-- none, are made by pgTAP 190 and db-check:
--
--   SOURCES   set by the administrator, organisation-wide (O1). WH-001 supplies the chicken,
--             the cola, the meal boxes, the sanitiser and the rice; FA-001 the chicken strips.
--             The gloves were supplied by WH-001, then cleared: branches buy them locally.
--             The frying oil has never had a source.
--   CUT-OFFS  WH-001 at 14:00 and FA-001 at 11:00, the warehouse's demonstration values.
--             FA-001's was 10:30 first: a history.
--   PARS      BR-001: chicken 3 cartons (30 kg), set by the warehouse manager; strips
--             2 trays (80 pieces), set by the factory manager, at the factory, for the
--             branch (O5); cola 2 cartons of 24 (48 cans), set by the administrator.
--             BR-002: chicken 20 kg; rice 2 bags (10 kg), then cleared.
--
-- A seed states a position rather than replaying a history through the routes, as 0070 does:
-- the routes' recorded_at would be now(), and the logs are append-only, so 0090 could not
-- freeze them. db-check's replenishment-sources-match-their-decisions,
-- order-cutoffs-match-their-decisions and par-levels-match-their-decisions prove the position
-- obeys the logs.
--
-- Fixed identifiers: decisions …62NN. None contains '0000000e', the db-fixtures pattern.
-- EVERY TIMESTAMP IS LITERAL, recorded_at included.

-- ---------------------------------------------------------------------------
-- Which facility supplies each item
-- ---------------------------------------------------------------------------

insert into erp.replenishment_source_decision (
  decision_id, kind, item_id, facility_id, reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000006201', 'source_set', '01936f00-0000-7000-8000-000000004101',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:00:00+00', timestamptz '2026-10-01 06:00:00+00'),
  ('01936f00-0000-7000-8000-000000006202', 'source_set', '01936f00-0000-7000-8000-000000004102',
   '01936f00-0000-7000-8000-000000000404', 'Synthetic: the factory makes it.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:01:00+00', timestamptz '2026-10-01 06:01:00+00'),
  ('01936f00-0000-7000-8000-000000006203', 'source_set', '01936f00-0000-7000-8000-000000004103',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:02:00+00', timestamptz '2026-10-01 06:02:00+00'),
  ('01936f00-0000-7000-8000-000000006204', 'source_set', '01936f00-0000-7000-8000-000000004104',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:03:00+00', timestamptz '2026-10-01 06:03:00+00'),
  ('01936f00-0000-7000-8000-000000006205', 'source_set', '01936f00-0000-7000-8000-000000004105',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:04:00+00', timestamptz '2026-10-01 06:04:00+00'),
  ('01936f00-0000-7000-8000-000000006206', 'source_set', '01936f00-0000-7000-8000-000000004111',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:05:00+00', timestamptz '2026-10-01 06:05:00+00'),
  ('01936f00-0000-7000-8000-000000006207', 'source_set', '01936f00-0000-7000-8000-000000004106',
   '01936f00-0000-7000-8000-000000000403', 'Synthetic: the warehouse buys it in and sends it out.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 06:06:00+00', timestamptz '2026-10-01 06:06:00+00'),
  ('01936f00-0000-7000-8000-000000006208', 'source_cleared', '01936f00-0000-7000-8000-000000004106',
   null, 'Synthetic: branches buy gloves locally now.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-02 07:00:00+00', timestamptz '2026-10-02 07:00:00+00');

insert into erp.replenishment_source (item_id, facility_id, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000006201', timestamptz '2026-10-01 06:00:00+00'),
  ('01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000000404',
   '01936f00-0000-7000-8000-000000006202', timestamptz '2026-10-01 06:01:00+00'),
  ('01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000006203', timestamptz '2026-10-01 06:02:00+00'),
  ('01936f00-0000-7000-8000-000000004104', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000006204', timestamptz '2026-10-01 06:03:00+00'),
  ('01936f00-0000-7000-8000-000000004105', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000006205', timestamptz '2026-10-01 06:04:00+00'),
  ('01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000000403',
   '01936f00-0000-7000-8000-000000006206', timestamptz '2026-10-01 06:05:00+00'),
  ('01936f00-0000-7000-8000-000000004106', null,
   '01936f00-0000-7000-8000-000000006208', timestamptz '2026-10-02 07:00:00+00');

-- ---------------------------------------------------------------------------
-- The cut-offs
-- ---------------------------------------------------------------------------

insert into erp.order_cutoff_decision (
  decision_id, kind, facility_id, cutoff, reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000006211', 'cutoff_set', '01936f00-0000-7000-8000-000000000403',
   time '14:00', 'Synthetic: picking for the next morning starts at two.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 07:00:00+00', timestamptz '2026-10-01 07:00:00+00'),
  ('01936f00-0000-7000-8000-000000006212', 'cutoff_set', '01936f00-0000-7000-8000-000000000404',
   time '10:30', 'Synthetic: the production plan is fixed before the lunch shift.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-01 07:01:00+00', timestamptz '2026-10-01 07:01:00+00'),
  ('01936f00-0000-7000-8000-000000006213', 'cutoff_set', '01936f00-0000-7000-8000-000000000404',
   time '11:00', 'Synthetic: the factory asked for half an hour more.',
   '01936f00-0000-7000-8000-000000000900', timestamptz '2026-10-03 05:00:00+00', timestamptz '2026-10-03 05:00:00+00');

insert into erp.order_cutoff (facility_id, cutoff, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000403', time '14:00',
   '01936f00-0000-7000-8000-000000006211', timestamptz '2026-10-01 07:00:00+00'),
  ('01936f00-0000-7000-8000-000000000404', time '11:00',
   '01936f00-0000-7000-8000-000000006213', timestamptz '2026-10-03 05:00:00+00');

-- ---------------------------------------------------------------------------
-- The pars
-- ---------------------------------------------------------------------------

insert into erp.par_level_decision (
  decision_id, kind, facility_id, item_id, item_unit_id, unit_key, factor, quantity, par,
  reason, actor_id, decided_at, recorded_at
) values
  ('01936f00-0000-7000-8000-000000006221', 'par_set', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004203', 'carton', 10, 3, 30,
   'Synthetic: two days of the lunch trade.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-02 08:00:00+00', timestamptz '2026-10-02 08:00:00+00'),
  ('01936f00-0000-7000-8000-000000006222', 'par_set', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000004102', '01936f00-0000-7000-8000-000000004207', 'tray', 40, 2, 80,
   'Synthetic: a day of strips.', '01936f00-0000-7000-8000-000000000908',
   timestamptz '2026-10-02 08:05:00+00', timestamptz '2026-10-02 08:05:00+00'),
  ('01936f00-0000-7000-8000-000000006223', 'par_set', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000004103', '01936f00-0000-7000-8000-000000004210', 'carton', 24, 2, 48,
   'Synthetic: a weekend of cola.', '01936f00-0000-7000-8000-000000000900',
   timestamptz '2026-10-02 08:10:00+00', timestamptz '2026-10-02 08:10:00+00'),
  ('01936f00-0000-7000-8000-000000006224', 'par_set', '01936f00-0000-7000-8000-000000000402',
   '01936f00-0000-7000-8000-000000004101', '01936f00-0000-7000-8000-000000004201', 'kg', 1, 20, 20,
   'Synthetic: a smaller branch.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-02 08:15:00+00', timestamptz '2026-10-02 08:15:00+00'),
  ('01936f00-0000-7000-8000-000000006225', 'par_set', '01936f00-0000-7000-8000-000000000402',
   '01936f00-0000-7000-8000-000000004111', '01936f00-0000-7000-8000-000000004226', 'bag', 5, 2, 10,
   'Synthetic: rice on the menu.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-02 08:20:00+00', timestamptz '2026-10-02 08:20:00+00'),
  ('01936f00-0000-7000-8000-000000006226', 'par_cleared', '01936f00-0000-7000-8000-000000000402',
   '01936f00-0000-7000-8000-000000004111', null, null, null, null, null,
   'Synthetic: rice is off the menu at this branch.', '01936f00-0000-7000-8000-000000000904',
   timestamptz '2026-10-04 06:00:00+00', timestamptz '2026-10-04 06:00:00+00');

insert into erp.par_level (facility_id, item_id, par, as_of_decision_id, updated_at) values
  ('01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000004101', 30,
   '01936f00-0000-7000-8000-000000006221', timestamptz '2026-10-02 08:00:00+00'),
  ('01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000004102', 80,
   '01936f00-0000-7000-8000-000000006222', timestamptz '2026-10-02 08:05:00+00'),
  ('01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000004103', 48,
   '01936f00-0000-7000-8000-000000006223', timestamptz '2026-10-02 08:10:00+00'),
  ('01936f00-0000-7000-8000-000000000402', '01936f00-0000-7000-8000-000000004101', 20,
   '01936f00-0000-7000-8000-000000006224', timestamptz '2026-10-02 08:15:00+00'),
  ('01936f00-0000-7000-8000-000000000402', '01936f00-0000-7000-8000-000000004111', null,
   '01936f00-0000-7000-8000-000000006226', timestamptz '2026-10-04 06:00:00+00');
