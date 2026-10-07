-- Module 6, step 6: platform.notifications opened as a PILOT at the central warehouse
-- (ADR-0030, and the consolidation plan's "Each module, every time", step 6).
--
-- HELD UNMERGED until every one of these holds, and the pull request that merges it names
-- who signed 1 and 2, and when (Q-23: nothing yet enforces the sign-offs, so the PR does):
--
--   1. The notifications staff testing pack (docs/lab/uat/notifications.md) is run by real
--      staff and signed.
--   2. Operations has signed off the notifications process mapping
--      (docs/estate/process-mapping-notifications.md), as MFG-012 asks.
--   3. Stock is switched on at the same warehouse: module 5's held switch-on (closed PR
--      #48, migration 20261006000100) is merged first, with module 1 before it. The bell
--      rings only where inventory.stock and inventory.items are both open (0021,
--      erp.notification_is_open_to()), so opened alone it would ring for nobody.
--   4. The owner has answered the questions at the head of the pack, question J among
--      them: in a real database only the administrator holds the bell (0021). Granting it
--      to other roles is a permission change, owner-approved and made separately.
--   5. C_CODE below is the central warehouse's real code. 'WH-001' is the synthetic
--      seed's.
--
-- Organisation-wide, platform.notifications stays hidden (0021). This records one
-- decision, at one facility: capability_state_for() reads a facility's own state before
-- the organisation's, so the bell shows to a person working AT the warehouse and nowhere
-- else (CAP-P02). Working organisation-wide, or at any other facility, they see no bell.
-- That matches where stock can ring it.
--
-- A FACILITY THAT DOES NOT EXIST IS NOT PROMOTED, as in module 5's switch-on. A decision
-- scoped to a facility names it by id, and facilities are made at run time (0019), so the
-- warehouse is found by its code when this is applied. Where there is none, nothing is
-- recorded and a WARNING says so: the bell stays hidden, the safe way to be wrong. Every
-- local rebuild is such a case, since migrations run before the seed makes WH-001; there
-- the seed opens the bell for the suites, as it has since 0021 (0030, c009). A facility
-- found with that code that is not an open warehouse is an error, never a pilot
-- somewhere else.
--
-- Requirements: CAP-P02 · CAP-P03 · CAP-P04 · MFG-012 · SUP-P01 · SUP-P02 · SUP-P03

do $$
declare
  c_code constant text := 'WH-001';
  c_decision constant uuid := '00000000-0000-0000-0000-00000000c021';
  f erp.facility%rowtype;
begin
  select * into f from erp.facility where code = c_code;
  if not found then
    raise warning 'platform.notifications is NOT promoted: no facility % exists here. It stays hidden.', c_code;
    return;
  end if;
  if f.facility_type <> 'warehouse' or f.status <> 'open' then
    raise exception 'facility % is a % that is %, not an open warehouse: no pilot is recorded',
      c_code, f.facility_type, f.status;
  end if;

  insert into erp.capability_decision (
    decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at
  ) values (
    c_decision, 'platform.notifications', f.facility_id, 'pilot',
    'Module 6 switch-on: a pilot at the central warehouse (ADR-0030, step 6). Its sign-offs are named in the pull request that merged this migration.',
    erp.system_principal(), 'system', now()
  );
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values ('platform.notifications', f.facility_id, 'pilot', c_decision);
end;
$$;
