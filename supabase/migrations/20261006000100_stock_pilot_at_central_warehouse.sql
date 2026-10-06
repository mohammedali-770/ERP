-- Module 5, step 6: inventory.stock opened as a PILOT at the central warehouse
-- (ADR-0029, and the consolidation plan's "Each module, every time", step 6).
--
-- HELD UNMERGED until every one of these holds, and the pull request that merges it names
-- who signed 1 and 2, and when (Q-23: nothing yet enforces the sign-offs, so the PR does):
--
--   1. The stock staff testing pack (docs/lab/uat/stock.md) is run by real staff and
--      signed.
--   2. Operations has signed off the stock process mapping
--      (docs/estate/process-mapping-stock.md), as MFG-012 asks.
--   3. Module 1 is switched on. Every stock read asks read on inventory.items as well,
--      and the item master is changed only organisation-wide: while inventory.items is
--      hidden, no item can be made to stock, and the stock entry shows to no one.
--   4. The owner has answered the questions at the head of the pack.
--   5. C_CODE below is the central warehouse's real code. 'WH-001' is the synthetic
--      seed's.
--
-- Organisation-wide, inventory.stock stays hidden (0020). This records one decision, at
-- one facility: capability_state_for() reads a facility's own state before the
-- organisation's, so the pilot opens there and nowhere else (CAP-P02).
--
-- A FACILITY THAT DOES NOT EXIST IS NOT PROMOTED. A decision scoped to a facility names it
-- by its id (erp.capability_decision.facility_id references erp.facility), and facilities
-- are made at run time (0019), not by migrations. So the warehouse is found by its code
-- when this is applied. Where there is none, nothing is recorded and a WARNING says so:
-- the capability stays hidden, which is the safe way to be wrong. Every local rebuild is
-- such a case, since migrations run before the seed makes WH-001; there the seed opens
-- the capability for the suites, as it has since 0020 (0030, c002). A facility found
-- with that code that is not an open warehouse is an error, never a pilot somewhere else.
--
-- Requirements: CAP-P02 · CAP-P03 · CAP-P04 · MFG-012 · INV-008 · INV-P01 · INV-P02

do $$
declare
  c_code constant text := 'WH-001';
  c_decision constant uuid := '00000000-0000-0000-0000-00000000c020';
  f erp.facility%rowtype;
begin
  select * into f from erp.facility where code = c_code;
  if not found then
    raise warning 'inventory.stock is NOT promoted: no facility % exists here. It stays hidden.', c_code;
    return;
  end if;
  if f.facility_type <> 'warehouse' or f.status <> 'open' then
    raise exception 'facility % is a % that is %, not an open warehouse: no pilot is recorded',
      c_code, f.facility_type, f.status;
  end if;

  insert into erp.capability_decision (
    decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at
  ) values (
    c_decision, 'inventory.stock', f.facility_id, 'pilot',
    'Module 5 switch-on: a pilot at the central warehouse (ADR-0029, step 6). Its sign-offs are named in the pull request that merged this migration.',
    erp.system_principal(), 'system', now()
  );
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id)
  values ('inventory.stock', f.facility_id, 'pilot', c_decision);
end;
$$;
