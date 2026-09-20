-- The awkward cases, which LAB-005 requires by name: "Must include the awkward
-- cases, because these are where bugs live."
--
-- Every row here exists to make a specific failure reachable. A seed of five
-- tidy orders proves the schema parses; it proves nothing about the system.
--
-- All values synthetic (SEC-012). Phone numbers use the +966 5xx 000 0000
-- reserved-looking block and are never real; no IBAN, no card number, no
-- employee record appears anywhere in this repository.

-- ---------------------------------------------------------------------------
-- Shifts. One open per (branch, cashier) is enforced by ux_one_open_shift, so
-- the seed deliberately sits right at that boundary: two cashiers open in the
-- same branch is legal, the same cashier twice is not.
-- ---------------------------------------------------------------------------
insert into erp.shifts (shift_id, branch_id, cashier_id, status, business_date, opened_at, closed_at) values
  ('01936f00-0000-7000-8000-000000001001', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000000901', 'open',   date '2026-09-19', timestamptz '2026-09-19 05:00:00+03', null),
  ('01936f00-0000-7000-8000-000000001002', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000000902', 'open',   date '2026-09-19', timestamptz '2026-09-19 05:05:00+03', null),
  -- A closed shift for the same cashier on the previous day: proves the partial
  -- index permits history and only forbids two LIVE rows.
  ('01936f00-0000-7000-8000-000000001003', '01936f00-0000-7000-8000-000000000401',
   '01936f00-0000-7000-8000-000000000901', 'closed', date '2026-09-18', timestamptz '2026-09-18 05:00:00+03', timestamptz '2026-09-19 01:30:00+03');

insert into erp.drawer_assignments (drawer_assignment_id, drawer_id, shift_id, assigned_at, released_at) values
  ('01936f00-0000-7000-8000-000000001101', '01936f00-0000-7000-8000-000000000a01',
   '01936f00-0000-7000-8000-000000001001', timestamptz '2026-09-19 05:00:00+03', null),
  ('01936f00-0000-7000-8000-000000001102', '01936f00-0000-7000-8000-000000000a01',
   '01936f00-0000-7000-8000-000000001003', timestamptz '2026-09-18 05:00:00+03', timestamptz '2026-09-19 01:30:00+03');

-- ---------------------------------------------------------------------------
-- Orders. The awkward ones, each labelled with what it is for.
-- ---------------------------------------------------------------------------
insert into erp.orders
  (order_id, order_number, branch_id, sales_channel_id, business_date, state, total_minor, currency, opened_at, closed_at)
values
  -- Ordinary, so "everything is an edge case" is not the only shape present.
  ('01936f00-0000-7000-8000-000000002001', 'BR-001-260919-A0001',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000701',
   date '2026-09-19', 'closed', 4550, 'SAR', timestamptz '2026-09-19 12:00:00+03', timestamptz '2026-09-19 12:07:00+03'),

  -- CROSSES MIDNIGHT. Placed at 01:10 on the 20th by the clock, but the shift
  -- opened on the 19th, so business_date is the 19th. Deriving the day from
  -- calendar midnight splits a night's trading across two days in every report,
  -- which is exactly what Q-06 exists to prevent.
  ('01936f00-0000-7000-8000-000000002002', 'BR-001-260919-A0002',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000701',
   date '2026-09-19', 'closed', 8900, 'SAR', timestamptz '2026-09-20 01:10:00+03', timestamptz '2026-09-20 01:22:00+03'),

  -- SPLIT TENDER: one order, two payment intents, neither of them live.
  ('01936f00-0000-7000-8000-000000002003', 'BR-001-260919-A0003',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000701',
   date '2026-09-19', 'closed', 12000, 'SAR', timestamptz '2026-09-19 19:30:00+03', timestamptz '2026-09-19 19:41:00+03'),

  -- PARTIALLY REFUNDED.
  ('01936f00-0000-7000-8000-000000002004', 'BR-001-260919-A0004',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000702',
   date '2026-09-19', 'closed', 6700, 'SAR', timestamptz '2026-09-19 20:00:00+03', timestamptz '2026-09-19 20:15:00+03'),

  -- SCHEDULED, for a business_date that has not opened. Anything that assumes
  -- opened_at <= business_date fails here, and should.
  ('01936f00-0000-7000-8000-000000002005', 'BR-001-260921-A0001',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000702',
   date '2026-09-21', 'scheduled', 3300, 'SAR', timestamptz '2026-09-19 21:00:00+03', null),

  -- UNKNOWN PAYMENT OUTCOME, open across the shift boundary. The state that
  -- blocks retry until reconciliation (PAY-007, invariant I-4).
  ('01936f00-0000-7000-8000-000000002006', 'BR-001-260919-A0005',
   '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000701',
   date '2026-09-19', 'open', 5000, 'SAR', timestamptz '2026-09-19 23:55:00+03', null),

  -- SECOND BRANCH, same order_number suffix. Order numbers are branch-scoped,
  -- so a global unique constraint on order_number would reject this row — which
  -- is the bug this line exists to catch.
  ('01936f00-0000-7000-8000-000000002007', 'BR-001-260919-A0001',
   '01936f00-0000-7000-8000-000000000402', '01936f00-0000-7000-8000-000000000701',
   date '2026-09-19', 'closed', 2500, 'SAR', timestamptz '2026-09-19 12:00:00+03', timestamptz '2026-09-19 12:05:00+03');

insert into erp.payment_intents
  (payment_intent_id, order_id, state, amount_minor, currency, created_at)
values
  ('01936f00-0000-7000-8000-000000003001', '01936f00-0000-7000-8000-000000002001', 'captured',  4550, 'SAR', timestamptz '2026-09-19 12:05:00+03'),
  ('01936f00-0000-7000-8000-000000003002', '01936f00-0000-7000-8000-000000002002', 'captured',  8900, 'SAR', timestamptz '2026-09-20 01:20:00+03'),
  -- Split tender: two settled intents on one order. Legal, because neither is
  -- in a live state; ux_one_live_intent would reject a second live one.
  ('01936f00-0000-7000-8000-000000003003', '01936f00-0000-7000-8000-000000002003', 'captured',  7000, 'SAR', timestamptz '2026-09-19 19:38:00+03'),
  ('01936f00-0000-7000-8000-000000003004', '01936f00-0000-7000-8000-000000002003', 'captured',  5000, 'SAR', timestamptz '2026-09-19 19:40:00+03'),
  ('01936f00-0000-7000-8000-000000003005', '01936f00-0000-7000-8000-000000002004', 'partially_refunded', 6700, 'SAR', timestamptz '2026-09-19 20:10:00+03'),
  -- The one live intent in the seed, and it is UNKNOWN: reconciliation must
  -- resolve it before any retry is permitted.
  ('01936f00-0000-7000-8000-000000003006', '01936f00-0000-7000-8000-000000002006', 'unknown',   5000, 'SAR', timestamptz '2026-09-19 23:58:00+03');

-- ---------------------------------------------------------------------------
-- The event log. Bilingual payloads, a per-device hash chain, and a gapless
-- device_seq — so a projector built against this seed meets the real shape.
-- ---------------------------------------------------------------------------
insert into erp.event_log
  (event_id, device_id, device_seq, hlc, occurred_at, tz_name, business_date, branch_id, shift_id,
   aggregate_type, aggregate_id, event_type, schema_version, payload, payload_hash, prev_hash,
   actor_type, actor_id, ingested_at)
values
  ('01936f00-0000-7000-8000-00000000b001', '01936f00-0000-7000-8000-000000000801', 1,
   '2026-09-19T05:00:00.000Z-0000-01936f00', timestamptz '2026-09-19 05:00:00+03', 'Asia/Riyadh',
   date '2026-09-19', '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000001001',
   'shift', '01936f00-0000-7000-8000-000000001001', 'ShiftOpened', 1,
   '{"opening_float_minor": 50000, "currency": "SAR"}'::jsonb,
   decode('00', 'hex'), decode('00', 'hex'), 'cashier', '01936f00-0000-7000-8000-000000000901', timestamptz '2026-09-20 00:00:00+00'),

  -- Bilingual item names carried in the payload as an immutable snapshot
  -- (invariant I-7, snapshot-rules.md), including a modifier group with a
  -- minimum and a maximum and a combo with child selections.
  ('01936f00-0000-7000-8000-00000000b002', '01936f00-0000-7000-8000-000000000801', 2,
   '2026-09-19T12:00:00.000Z-0000-01936f00', timestamptz '2026-09-19 12:00:00+03', 'Asia/Riyadh',
   date '2026-09-19', '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000001001',
   'order', '01936f00-0000-7000-8000-000000002001', 'OrderLineAdded', 1,
   '{"item_id":"01936f00-0000-7000-8000-00000000c001",
     "name_en":"Spicy Chicken Combo","name_ar":"وجبة الدجاج الحار",
     "unit_price_minor":4550,"currency":"SAR","tax_code":"VAT15","tax_rate":0.15,"tax_inclusive":true,
     "modifiers":[{"group_en":"Spice level","group_ar":"درجة الحرارة","min":1,"max":1,
                   "chosen":[{"name_en":"Extra hot","name_ar":"حار جدا","price_minor":0}]},
                  {"group_en":"Extras","group_ar":"إضافات","min":0,"max":3,
                   "chosen":[{"name_en":"Cheese","name_ar":"جبن","price_minor":300},
                             {"name_en":"Garlic sauce","name_ar":"صلصة ثوم","price_minor":200}]}],
     "combo_children":[{"name_en":"Fries","name_ar":"بطاطس"},
                       {"name_en":"Soft drink","name_ar":"مشروب غازي"}]}'::jsonb,
   decode('00', 'hex'), decode('00', 'hex'), 'cashier', '01936f00-0000-7000-8000-000000000901', timestamptz '2026-09-20 00:00:00+00'),

  -- Second device, its own gapless sequence starting at 1. A projector that
  -- assumes device_seq is globally unique breaks on this row.
  ('01936f00-0000-7000-8000-00000000b003', '01936f00-0000-7000-8000-000000000802', 1,
   '2026-09-19T19:30:00.000Z-0000-01936f00', timestamptz '2026-09-19 19:30:00+03', 'Asia/Riyadh',
   date '2026-09-19', '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000001002',
   'order', '01936f00-0000-7000-8000-000000002003', 'OrderOpened', 1,
   '{"channel":"POS"}'::jsonb, decode('00', 'hex'), decode('00', 'hex'),
   'cashier', '01936f00-0000-7000-8000-000000000902', timestamptz '2026-09-20 00:00:00+00'),

  -- Crosses midnight: occurred_at is the 20th, business_date is the 19th.
  ('01936f00-0000-7000-8000-00000000b004', '01936f00-0000-7000-8000-000000000801', 3,
   '2026-09-20T01:10:00.000Z-0000-01936f00', timestamptz '2026-09-20 01:10:00+03', 'Asia/Riyadh',
   date '2026-09-19', '01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000001001',
   'order', '01936f00-0000-7000-8000-000000002002', 'OrderClosed', 1,
   '{"total_minor":8900,"currency":"SAR"}'::jsonb, decode('00', 'hex'), decode('00', 'hex'),
   'cashier', '01936f00-0000-7000-8000-000000000901', timestamptz '2026-09-20 00:00:00+00');

insert into erp.projection_applied (projection, event_id) values
  ('orders', '01936f00-0000-7000-8000-00000000b002'),
  ('orders', '01936f00-0000-7000-8000-00000000b004');

insert into erp.projection_state (projection, last_event_id, last_business_date, rebuilt_at) values
  ('orders', '01936f00-0000-7000-8000-00000000b004', date '2026-09-19', timestamptz '2026-09-20 02:00:00+03');
