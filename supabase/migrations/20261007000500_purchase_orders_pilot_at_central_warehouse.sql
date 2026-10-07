-- Module 8, step 6: procurement.purchase_orders and procurement.purchase_limits opened as a
-- PILOT at the central warehouse (ADR-0032, and the consolidation plan's "Each module,
-- every time", step 6).
--
-- HELD UNMERGED until every one of these holds, and the pull request that merges it names
-- who signed 1 and 2, and when (Q-23: nothing yet enforces the sign-offs, so the PR does):
--
--   1. The purchase-orders staff testing pack (docs/lab/uat/purchase-orders.md) is run by
--      real staff and signed.
--   2. Operations has signed off the purchase-orders process mapping
--      (docs/estate/process-mapping-purchase-orders.md), as MFG-012 asks.
--   3. What every order route reads is open first: items and suppliers organisation-wide,
--      where every item and supplier is made (modules 1 and 2), then stock at this
--      warehouse (module 5's held switch-on, closed PR #48). Every order route asks read on
--      procurement.suppliers and inventory.items here, and a receipt asks write on
--      inventory.stock (0023), so opened alone purchase orders would answer nobody. Module
--      5's held file is dated before 0023 and this one after it: when it comes back it takes
--      a fresh timestamp, and this one a later one still (Q-23). The bell (module 6) is not
--      needed: nothing about an order rings it (question H of the pack).
--   4. The owner has answered the thirteen questions at the head of the pack, A and M among
--      them, and Q-26. In a real database only the administrator raises, approves and
--      receives orders and sets limits (0023), and nobody approves an order they raised,
--      by hand or by a limit they set (PRC-004): with the administrator alone, every order
--      waits for ever. Granting orders to the warehouse manager, or approval to a second
--      person, is a permission change, owner-approved and made separately, before this.
--   5. C_CODE below is the central warehouse's real code. 'WH-001' is the synthetic
--      seed's.
--   6. The warehouse exists where this is applied. Where it does not, this warns, records
--      nothing, and still counts as applied, so it never runs again (found in review of
--      module 7's switch-on, ADR-0031's step 6 addendum): a hosted project's migrations
--      applied before module 4 has made the warehouse would lose the pilot with only a
--      warning. Check the warning's absence when applying.
--
-- Organisation-wide, both stay hidden (0023 registers them with no state, which reads as
-- hidden). This records two decisions, at one facility: capability_state_for() reads a
-- facility's own state before the organisation's, so Purchase orders and Approval limit
-- show to a person working AT the warehouse and nowhere else (CAP-P02). The factory,
-- where 0023 would also take orders (P1), stays shut because nothing is recorded there and
-- the organisation-wide default is hidden: opening stock at the factory later would not
-- open purchase orders there.
--
-- A FACILITY THAT DOES NOT EXIST IS NOT PROMOTED, as in modules 5's, 6's and 7's
-- switch-ons. A decision scoped to a facility names it by id, and facilities are made at
-- run time (0019), so the warehouse is found by its code when this is applied. Where there
-- is none, nothing is recorded and a WARNING says so: purchase orders stay hidden, the safe
-- way to be wrong (but see 6). Every local rebuild is such a case, since migrations run
-- before the seed makes WH-001; there the seed opens both for the suites, as it has since
-- 0023 (0030, c011 and c012). A facility found with that code that is not an open warehouse
-- is an error, never a pilot somewhere else. A state already recorded at the warehouse for
-- either capability, by a run-time decision, is an error too, worded: this migration
-- would otherwise fail on the state row's key, closed but unexplained (found in review of
-- module 7's switch-on).
--
-- Requirements: CAP-P02 · CAP-P03 · CAP-P04 · MFG-012 · PRC-001 · PRC-P01 · PRC-P02 · INV-P04

do $$
declare
  c_code constant text := 'WH-001';
  c_orders constant uuid := '00000000-0000-0000-0000-00000000c023';
  c_limits constant uuid := '00000000-0000-0000-0000-00000000c024';
  c_reason constant text :=
    'Module 8 switch-on: a pilot at the central warehouse (ADR-0032, step 6). Its sign-offs are named in the pull request that merged this migration.';
  f erp.facility%rowtype;
  v_existing text;
begin
  select * into f from erp.facility where code = c_code;
  if not found then
    raise warning 'procurement.purchase_orders and procurement.purchase_limits are NOT promoted: no facility % exists here. They stay hidden.', c_code;
    return;
  end if;
  if f.facility_type <> 'warehouse' or f.status <> 'open' then
    raise exception 'facility % is a % that is %, not an open warehouse: no pilot is recorded',
      c_code, f.facility_type, f.status;
  end if;
  select string_agg(s.capability_key || ' is ' || s.state, ', ' order by s.capability_key) into v_existing
    from erp.capability_state s
   where s.facility_id = f.facility_id
     and s.capability_key in ('procurement.purchase_orders', 'procurement.purchase_limits');
  if v_existing is not null then
    raise exception 'at facility % a decision is already recorded (%): this migration decides nothing over it. Record the change through erp.decide_capability() instead.',
      c_code, v_existing;
  end if;

  insert into erp.capability_decision (
    decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at
  ) values
    (c_orders, 'procurement.purchase_orders', f.facility_id, 'pilot', c_reason, erp.system_principal(), 'system', now()),
    (c_limits, 'procurement.purchase_limits', f.facility_id, 'pilot', c_reason, erp.system_principal(), 'system', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id) values
    ('procurement.purchase_orders', f.facility_id, 'pilot', c_orders),
    ('procurement.purchase_limits', f.facility_id, 'pilot', c_limits);
end;
$$;
