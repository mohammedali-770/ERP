-- pgTAP · facilities, proved by being refused by them
--
-- 0019 is module 4: branches and the other sites made a master, with an area each, and
-- the check a branch order makes that the phone is inside it. Each rule is proved by
-- colliding with it; cases marked CONTROL are why the suite exists. The message is
-- asserted wherever another refusal shares the SQLSTATE.
--
-- ORDER MATTERS, as in 080, 110 and 130:
--   * throws_ok and lives_ok bodies are replayed alone by tools/db-fixtures against the
--     seed, so none may depend on a plain statement earlier in this file;
--   * the lives_ok that COMMIT under db-fixtures are last, with fresh ids, touching
--     nothing an earlier fixture reads.
--
-- Fixture ids are …0e17NN and …0e18NN, a range no seed row and no other suite uses.

begin;
select plan(67);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select has_table('erp', 'facility_decision', 'erp.facility_decision exists');
select col_not_null('erp', 'facility', 'as_of_decision_id', 'every facility carries the decision behind it (I-8)');
select fk_ok('erp', 'facility', array['as_of_decision_id', 'facility_id']::name[],
             'erp', 'facility_decision', array['decision_id', 'facility_id']::name[],
  'a facility is stamped with a decision about ITSELF, never another''s');
select col_isnt_fk('erp', 'facility_decision', 'facility_id', 'the log does not reference the facility it creates');
select col_is_fk('erp', 'facility_decision', 'actor_id', 'a decision names a person, when one made it');

-- ---------------------------------------------------------------------------
-- Privilege facts
-- ---------------------------------------------------------------------------

select is(has_table_privilege('erp_app', 'erp.facility_decision', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), false,
  'the runtime holds no privilege on the facility log');
select is(has_table_privilege('erp_app', 'erp.facility', 'INSERT,UPDATE,DELETE,TRUNCATE'), false,
  'nor any write on erp.facility: it changes through the routes only');
select ok(has_function_privilege('erp_app', 'erp.create_facility(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,timestamptz)', 'EXECUTE'),
  'the runtime may call the routes');
select is(has_function_privilege('erp_app', 'erp.assert_at_facility(uuid,numeric,numeric,numeric)', 'EXECUTE'), false,
  'but not the area check a branch order makes from its own route');
select is(has_function_privilege('erp_app', 'erp.assert_facility_open(uuid)', 'EXECUTE'), false,
  'nor the open check');

-- ---------------------------------------------------------------------------
-- The seed, recorded
-- ---------------------------------------------------------------------------

select is((select count(*)::int from erp.facility f join erp.facility_decision d on d.decision_id = f.as_of_decision_id
            where d.kind = 'facility_recorded' and d.actor_id is null), 2,
  'both seeded branches are recorded by nobody, as they stand');
select is((select (latitude, longitude, geofence_radius_m)::text from erp.facility where code = 'BR-001'),
  '(24.713600,46.675300,150)', 'BR-001 has an area: a point and the warehouse''s default 150 m');
select throws_ok(
  $$ insert into erp.facility_decision (decision_id, kind, facility_id, operating_unit_id, facility_type, code, name_en, name_ar,
       tz_name, status, reason, actor_id, decided_at)
     values ('01936f00-0000-7000-8000-0000000e1701', 'facility_amended', '01936f00-0000-7000-8000-000000000401',
       '01936f00-0000-7000-8000-000000000301', 'branch', 'BR-001', 'x', 'س', 'Asia/Riyadh', 'open', 'testing', null, now()) $$,
  '23514', null,
  'CONTROL: only a facility recorded before the log may have no actor; every decision since names a person'
);

-- ---------------------------------------------------------------------------
-- The gate (CAP-P02, CAP-P04) and permission (IAM-003)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.decide_capability('01936f00-0000-7000-8000-0000000e1702'::uuid, 'org.facilities', null, 'hidden', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, 'administrator', now());
     select erp.create_facility('01936f00-0000-7000-8000-0000000e1703'::uuid, '01936f00-0000-7000-8000-0000000e1704'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', 'BR-T01', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', null,
  'CONTROL: a hidden capability refuses even the administrator'
);
select throws_like(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1705'::uuid, '01936f00-0000-7000-8000-0000000e1706'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', 'BR-T02', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000904'::uuid, now()) $$,
  '%may not write on capability org.facilities%',
  'CONTROL: the warehouse manager reads facilities and may not create one (IAM-003)'
);
select lives_ok(
  $$ select * from erp.list_facilities('01936f00-0000-7000-8000-000000000904'::uuid, null, null, null, null, 100) $$,
  'the warehouse manager reads facilities organisation-wide'
);
select throws_like(
  $$ select * from erp.list_facilities('01936f00-0000-7000-8000-000000000901'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, 'open', null, null, 100) $$,
  '%may not read on capability org.facilities%',
  'a branch worker reads nothing of facilities: they are placed by assignment, not by looking up areas'
);

-- ---------------------------------------------------------------------------
-- Creating: the rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1707'::uuid, '01936f00-0000-7000-8000-0000000e1708'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'kiosk', 'BR-T03', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a facility is a branch, a warehouse, a factory or an office',
  'a facility is one of the four types 0003 knows'
);
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1709'::uuid, '01936f00-0000-7000-8000-0000000e1710'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', 'BR 9!', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a facility code is 1 to 32 letters, digits and hyphens, starting with a letter or digit',
  'a code is letters, digits and hyphens'
);
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1711'::uuid, '01936f00-0000-7000-8000-0000000e1712'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', ' br-٠٠١ ', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'facility code BR-001 is already used',
  'CONTROL: a code is read in capitals and Western digits, so " br-٠٠١ " is BR-001, already used'
);
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1713'::uuid, '01936f00-0000-7000-8000-0000000e1714'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', 'BR-T04', 'Test', '   ', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a facility is named in both English and Arabic (PRG-014)',
  'a facility is named in both languages'
);
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1715'::uuid, '01936f00-0000-7000-8000-0000000e1716'::uuid,
       '01936f00-0000-7000-8000-0000000e1799'::uuid, 'branch', 'BR-T05', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'P0002', 'no operating unit 01936f00-0000-7000-8000-0000000e1799',
  'a facility belongs to an operating unit that exists'
);
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-000000005601'::uuid, '01936f00-0000-7000-8000-0000000e1717'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'branch', 'BR-T06', 'Test', 'تجريبي', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'decision 01936f00-0000-7000-8000-000000005601 is already recorded',
  'a decision id already in the log is answered as a retry, before any other rule'
);

-- ---------------------------------------------------------------------------
-- Amending, the area and the status: the rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.amend_facility('01936f00-0000-7000-8000-0000000e1718'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid,
       '01936f00-0000-7000-8000-000000005602'::uuid, 'Test Branch One', 'الفرع التجريبي الأول', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'facility BR-001 has changed since it was read',
  'CONTROL: a change read from a stamp that is not the facility''s own is refused as stale'
);
select throws_ok(
  $$ select erp.amend_facility('01936f00-0000-7000-8000-0000000e1719'::uuid, '01936f00-0000-7000-8000-0000000e1798'::uuid,
       '01936f00-0000-7000-8000-000000005601'::uuid, 'x', 'س', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'P0002', null,
  'a facility that does not exist is not found'
);
select throws_ok(
  $$ select erp.amend_facility('01936f00-0000-7000-8000-0000000e1720'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid,
       '01936f00-0000-7000-8000-000000005601'::uuid, '', 'الفرع التجريبي الأول', null, null, 'testing',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a facility is named in both English and Arabic (PRG-014)',
  'an amendment keeps both names'
);
select throws_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1721'::uuid, '01936f00-0000-7000-8000-000000000402'::uuid,
       '01936f00-0000-7000-8000-000000005602'::uuid, 24.7, null, 150, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'an area is a latitude, a longitude and a radius together, or none',
  'CONTROL: a latitude without a longitude is no area'
);
select throws_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1722'::uuid, '01936f00-0000-7000-8000-000000000402'::uuid,
       '01936f00-0000-7000-8000-000000005602'::uuid, null, null, 150, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'an area is a latitude, a longitude and a radius together, or none',
  'nor is a radius without a point'
);
select throws_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1723'::uuid, '01936f00-0000-7000-8000-000000000402'::uuid,
       '01936f00-0000-7000-8000-000000005602'::uuid, 24.7, 46.7, 10, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'an area''s radius is from 25 to 2000 metres',
  'a radius is 25 to 2000 m, as the warehouse allowed'
);
select throws_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1724'::uuid, '01936f00-0000-7000-8000-000000000402'::uuid,
       '01936f00-0000-7000-8000-000000005602'::uuid, 95, 46.7, 150, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a latitude is from -90 to 90 and a longitude from -180 to 180',
  'a point is on the earth'
);
select throws_ok(
  $$ select erp.change_facility_status('01936f00-0000-7000-8000-0000000e1725'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid,
       '01936f00-0000-7000-8000-000000005601'::uuid, 'open', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'facility BR-001 is already open',
  'a status change that changes nothing is refused'
);
select throws_ok(
  $$ select erp.change_facility_status('01936f00-0000-7000-8000-0000000e1726'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid,
       '01936f00-0000-7000-8000-000000005601'::uuid, 'demolished', 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23514', 'a facility is open or closed',
  'a facility is open or closed'
);

-- ---------------------------------------------------------------------------
-- Guard triggers bind the owner too
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ delete from erp.facility where code = 'BR-002' $$,
  '23001', 'facility BR-002 is closed, never deleted (B-11)',
  'CONTROL: not even the owner deletes a facility'
);
select throws_ok(
  $$ update erp.facility set code = 'BR-099' where code = 'BR-002' $$,
  '23001', 'facility BR-002: its code, type, brand and time zone are fixed once created',
  'nor changes its code'
);
select throws_ok(
  $$ update erp.facility set operating_unit_id = operating_unit_id, facility_type = 'warehouse' where code = 'BR-002' $$,
  '23001', 'facility BR-002: its code, type, brand and time zone are fixed once created',
  'nor its type'
);
select throws_ok(
  $$ update erp.facility set tz_name = 'Asia/Dubai' where code = 'BR-002' $$,
  '23001', 'facility BR-002: its code, type, brand and time zone are fixed once created',
  'nor its time zone, which would move every business date already recorded (Q-22)'
);
select throws_ok(
  $$ update erp.facility_decision set name_en = 'x' where decision_id = '01936f00-0000-7000-8000-000000005601' $$,
  '23001', null,
  'the log is never rewritten'
);

-- ---------------------------------------------------------------------------
-- The area check a branch order makes (ADR-0028)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-000000000402'::uuid, 24.7136, 46.6753, 10) $$,
  '23001', 'facility BR-002 has no area: give it one before its workers can order',
  'a branch with no area admits no order checked against it'
);
select throws_ok(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, null, null, 10) $$,
  '23514', 'a position is needed to act for facility BR-001',
  'no position, no order'
);
select throws_ok(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, 24.7136, 46.6753, 150) $$,
  '23514', 'the position is not precise enough (within 100 m needed)',
  'a fix vaguer than 100 m is refused, as the warehouse refused it'
);
select throws_ok(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, 24.7136, 46.6753, null) $$,
  '23514', 'the position is not precise enough (within 100 m needed)',
  'and so is a fix that says nothing of its precision'
);
select is(round(erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, 24.713600, 46.675300, 10)::numeric), 0::numeric,
  'at the branch''s point, the distance is 0');
-- A thousandth of a degree of latitude is about 111 m.
select ok(erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, 24.714800, 46.675300, 20) between 125 and 140,
  'about 133 m north is inside the 150 m area, and the distance is answered');
select throws_like(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-000000000401'::uuid, 24.715000, 46.675300, 20) $$,
  'this device is 156 m from facility BR-001, outside its 150 m area',
  'CONTROL: about 156 m north is outside it, and refused'
);
select ok(erp.distance_m(24.7136, 46.6753, 21.4858, 39.1925) between 845000 and 850000,
  'the distance is the great circle''s: Riyadh to Jeddah is about 847 km');
select throws_ok(
  $$ select erp.assert_facility_open('01936f00-0000-7000-8000-0000000e1797'::uuid) $$,
  'P0002', null,
  'a facility that does not exist admits nothing'
);

-- ---------------------------------------------------------------------------
-- What a successful decision records — last, because under db-fixtures they commit
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1801'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'warehouse', ' wh-t1 ', ' Test  Warehouse ', 'مستودع تجريبي', ' Exit 18 ', null,
       'testing: a warehouse', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'the administrator creates a warehouse'
);
select is((select (code, name_en, address_en, status, latitude, as_of_decision_id)::text from erp.facility where facility_id = '01936f00-0000-7000-8000-0000000e1802'),
  '(WH-T1,"Test Warehouse","Exit 18",open,,01936f00-0000-7000-8000-0000000e1801)',
  'created open, canonical, with no area, stamped with its decision');
select is((select (kind, actor_id)::text from erp.facility_decision where decision_id = '01936f00-0000-7000-8000-0000000e1801'),
  '(facility_created,01936f00-0000-7000-8000-000000000900)', 'and its decision names who created it');
select lives_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1803'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1801'::uuid, 24.6, 46.7, null, 'testing: its area', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'it is given an area, with no radius stated'
);
select is((select (latitude, longitude, geofence_radius_m)::text from erp.facility where facility_id = '01936f00-0000-7000-8000-0000000e1802'),
  '(24.600000,46.700000,150)', 'which takes the warehouse''s default radius of 150 m');
select lives_ok(
  $$ select erp.amend_facility('01936f00-0000-7000-8000-0000000e1804'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1803'::uuid, 'Test Warehouse', 'مستودع تجريبي', 'Exit 18', null,
       'testing: unchanged', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'an amendment that changes nothing is accepted…'
);
select is((select count(*)::int from erp.facility_decision where decision_id = '01936f00-0000-7000-8000-0000000e1804'), 0,
  '…and records nothing');
select lives_ok(
  $$ select erp.change_facility_status('01936f00-0000-7000-8000-0000000e1805'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1803'::uuid, 'closed', 'testing: closed', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'it is closed'
);
select throws_ok(
  $$ select erp.amend_facility('01936f00-0000-7000-8000-0000000e1806'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1805'::uuid, 'Renamed', 'مستودع', null, null, 'testing', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23001', 'facility WH-T1 is closed: reopen it before changing it',
  'a closed facility is reopened before it is changed'
);
select throws_ok(
  $$ select erp.assert_facility_open('01936f00-0000-7000-8000-0000000e1802'::uuid) $$,
  '23001', 'facility WH-T1 is closed and admits no new work',
  'CONTROL: a closed facility admits no new work'
);
select throws_ok(
  $$ select erp.assert_at_facility('01936f00-0000-7000-8000-0000000e1802'::uuid, 24.6, 46.7, 10) $$,
  '23001', 'facility WH-T1 is closed and admits no new work',
  'and no order checked against its area, though the phone is at its point'
);
select lives_ok(
  $$ select erp.change_facility_status('01936f00-0000-7000-8000-0000000e1807'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1805'::uuid, 'open', 'testing: reopened', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'it is reopened: closing is not final'
);
select lives_ok(
  $$ select erp.set_facility_area('01936f00-0000-7000-8000-0000000e1808'::uuid, '01936f00-0000-7000-8000-0000000e1802'::uuid,
       '01936f00-0000-7000-8000-0000000e1807'::uuid, null, null, null, 'testing: area removed', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'and its area is removed'
);
select is((select latitude is null and geofence_radius_m is null from erp.facility where facility_id = '01936f00-0000-7000-8000-0000000e1802'), true,
  'it has no area now');
select throws_ok(
  $$ select erp.create_facility('01936f00-0000-7000-8000-0000000e1801'::uuid, '01936f00-0000-7000-8000-0000000e1809'::uuid,
       '01936f00-0000-7000-8000-000000000301'::uuid, 'office', 'OF-T1', 'Office', 'مكتب', null, null, 'testing: retry',
       '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  '23505', 'decision 01936f00-0000-7000-8000-0000000e1801 is already recorded',
  'a retry under the same decision id is answered as a retry, whatever it carries'
);
select is((select array_agg(kind order by seq) from erp.facility_history('01936f00-0000-7000-8000-000000000900'::uuid, null, '01936f00-0000-7000-8000-0000000e1802'::uuid)),
  array['facility_created', 'facility_located', 'facility_status_changed', 'facility_status_changed', 'facility_located'],
  'its history holds every decision, in order');

-- Another brand's facility, at a first-brand branch, answers exactly as a missing one.
select lives_ok(
  $$ insert into erp.operating_unit (operating_unit_id, brand_id, code, name_en, name_ar) values
       ('01936f00-0000-7000-8000-0000000e1810', '01936f00-0000-7000-8000-000000000202', 'OU-T2', 'Second brand unit (test)', 'وحدة العلامة الثانية');
     select erp.create_facility('01936f00-0000-7000-8000-0000000e1811'::uuid, '01936f00-0000-7000-8000-0000000e1812'::uuid,
       '01936f00-0000-7000-8000-0000000e1810'::uuid, 'branch', 'B2-T1', 'Second brand branch', 'فرع العلامة الثانية', null, null,
       'testing: another brand', '01936f00-0000-7000-8000-000000000900'::uuid, now()) $$,
  'a branch of the second brand is created'
);
select is((select count(*)::int from erp.list_facilities('01936f00-0000-7000-8000-000000000900'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, null, null, null, 500) where code = 'B2-T1'), 0,
  'CONTROL: at a first-brand branch, the second brand''s facility is not listed');
select throws_ok(
  $$ select * from erp.get_facility('01936f00-0000-7000-8000-000000000900'::uuid, '01936f00-0000-7000-8000-000000000401'::uuid, '01936f00-0000-7000-8000-0000000e1812'::uuid) $$,
  'P0002', 'no facility 01936f00-0000-7000-8000-0000000e1812',
  'nor found'
);
select is((select count(*)::int from erp.list_facilities('01936f00-0000-7000-8000-000000000900'::uuid, null, null, null, null, 500) where code = 'B2-T1'), 1,
  'organisation-wide, it is');

-- I-8: every facility equals the latest decision about it, after all of this.
select is_empty(
  $$ select f.facility_id from erp.facility f
     left join erp.facility_decision d on d.decision_id = f.as_of_decision_id
     where d.decision_id is null
        or (d.operating_unit_id, d.facility_type, d.code, d.name_en, d.name_ar, d.address_en, d.address_ar, d.tz_name,
            d.latitude, d.longitude, d.geofence_radius_m, d.status)
           is distinct from (f.operating_unit_id, f.facility_type, f.code, f.name_en, f.name_ar, f.address_en, f.address_ar,
            f.tz_name, f.latitude, f.longitude, f.geofence_radius_m, f.status)
        or exists (select 1 from erp.facility_decision l where l.facility_id = f.facility_id and l.seq > d.seq) $$,
  'every facility equals the latest decision about it'
);

select * from finish();
rollback;
