-- pgTAP · the viewer — what the console is told, and that it is told only what is true
--
-- 0015's erp.viewer() is what the console's menu and forms are built from. It is not a
-- control (every route asks erp.assert_permitted() itself), but a viewer that told a
-- cashier they could write items would show them a door the database then slams. So
-- each answer is checked against the rule it mirrors.
--
-- The people and facilities are the synthetic ones 0015_identity.sql and
-- 0010_organisation.sql seed; the seed opens inventory.items as pilot.

begin;
select plan(18);

select has_function('erp', 'viewer', array['uuid', 'uuid'], 'erp.viewer(person, facility) exists');
select is((select prosecdef from pg_proc where oid = 'erp.viewer(uuid,uuid)'::regprocedure), false,
  'it is security invoker: it reads only what the runtime already reads');
select ok(has_function_privilege('erp_app', 'erp.viewer(uuid,uuid)', 'EXECUTE'), 'the runtime may call it');
select is(has_function_privilege('erp_read', 'erp.viewer(uuid,uuid)', 'EXECUTE'), false, 'the reporting role may not');

-- A cashier at their branch: …0901 is a branch worker at BR-001 only.
select is((erp.viewer('01936f00-0000-7000-8000-000000000901', '01936f00-0000-7000-8000-000000000401')
           -> 'person' ->> 'employee_number'), '1001', 'it names the person');
select ok((erp.viewer('01936f00-0000-7000-8000-000000000901', '01936f00-0000-7000-8000-000000000401')
           -> 'permissions') ? 'inventory.items:read', 'a cashier may read items at their branch');
select is(((erp.viewer('01936f00-0000-7000-8000-000000000901', '01936f00-0000-7000-8000-000000000401')
           -> 'permissions') ? 'inventory.items:write'), false, 'and may not write them');
-- CONTROL. Scope: the same person organisation-wide holds nothing, as permission_granted() says.
select is(erp.viewer('01936f00-0000-7000-8000-000000000901', null) -> 'permissions', '[]'::jsonb,
  'a cashier holds nothing organisation-wide');
select is(erp.viewer('01936f00-0000-7000-8000-000000000901', '01936f00-0000-7000-8000-000000000402') -> 'permissions',
  '[]'::jsonb, 'nor at another branch');
select is((erp.viewer('01936f00-0000-7000-8000-000000000901', null) ->> 'org_wide')::boolean, false,
  'a cashier is not organisation-wide');
select is((select jsonb_agg(f ->> 'code') from jsonb_array_elements(
             erp.viewer('01936f00-0000-7000-8000-000000000901', null) -> 'facilities') f),
  '["BR-001"]'::jsonb, 'and can work only at the branch their role names');

-- The administrator, organisation-wide.
select ok((erp.viewer('01936f00-0000-7000-8000-000000000900', null) -> 'permissions') ? 'inventory.items:write',
  'the administrator may write items');
select is((erp.viewer('01936f00-0000-7000-8000-000000000900', null) ->> 'org_wide')::boolean, true,
  'and is organisation-wide');
select is(jsonb_array_length(erp.viewer('01936f00-0000-7000-8000-000000000900', null) -> 'facilities'),
  (select count(*)::int from erp.facility), 'so can work at every facility');

-- CONTROL. IAM-P05: a suspended person holds nothing, whatever their roles say.
select is(erp.viewer('01936f00-0000-7000-8000-000000000905', '01936f00-0000-7000-8000-000000000401') -> 'permissions',
  '[]'::jsonb, 'a suspended person holds nothing');

-- States are the database's own, for every registered capability (CAP-P02).
select is((erp.viewer('01936f00-0000-7000-8000-000000000901', '01936f00-0000-7000-8000-000000000401') -> 'states'),
  (select jsonb_object_agg(c.capability_key, erp.capability_state_for(c.capability_key, '01936f00-0000-7000-8000-000000000401'))
     from erp.capability c),
  'each capability is in the state erp.capability_state_for() gives it here');

-- The reference data the forms need.
select is(jsonb_array_length(erp.viewer('01936f00-0000-7000-8000-000000000900', null) -> 'units'),
  (select count(*)::int from erp.unit), 'every registered unit');
select is(jsonb_array_length(erp.viewer('01936f00-0000-7000-8000-000000000900', null) -> 'brands'),
  (select count(*)::int from erp.brand), 'every brand');

select * from finish();
rollback;
