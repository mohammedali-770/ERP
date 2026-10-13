-- Module 9, step 6: ordering.setup and ordering.par_levels opened as a PILOT organisation-wide
-- (ADR-0033, and the consolidation plan's "Each module, every time", step 6).
--
-- HELD UNMERGED until every one of these holds, and the pull request that merges it names
-- who signed 1 and 2, and when (Q-23: nothing yet enforces the sign-offs, so the PR does):
--
--   1. The ordering-setup staff testing pack (docs/lab/uat/ordering-setup.md) is run by real
--      staff and signed.
--   2. Operations has signed off the ordering-setup process mapping
--      (docs/estate/process-mapping-ordering-setup.md), as MFG-012 asks.
--   3. Items are open organisation-wide first (module 1). Every source and par route asks
--      read on inventory.items; only the cut-off routes do not (0024). Opened alone, item
--      sources and par levels would answer nobody. Stock, the bell and purchase orders are
--      not needed: nothing here reads them.
--   4. The owner has answered the ten questions at the head of the pack, E and J among
--      them. In a real database only the administrator holds either capability (0024).
--      Par write for the warehouse and factory managers, and the branches' reads, are
--      permission changes, owner-approved and made separately, before this. With J, the
--      owner also says whether this comes before module 10: until module 10 places orders,
--      nothing reads a source, a cut-off or a par, and switching on early only lets them be
--      entered ahead.
--   5. An open warehouse or factory exists where this is applied, made through facilities
--      (module 4). Where none does, this warns, records nothing, and still counts as
--      applied, so it never runs again (the gap found in review of module 7's switch-on,
--      ADR-0031's step 6 addendum). Check the warning's absence when applying.
--
-- ORGANISATION-WIDE, NOT AT ONE FACILITY, unlike modules 5 to 8's pilots at the central
-- warehouse. 0024 asks ordering.setup at no facility to set or clear an item's source, so a
-- source is set only where the capability is open organisation-wide. And it asks
-- ordering.par_levels at the branch a par is for as well as where it is set from
-- (ADR-0033 §4, §8), so a pilot at the warehouse and the factory alone would open pars at
-- no branch. capability_state_for() reads a facility's own state before the
-- organisation's, so a branch a pilot leaves out is closed by a run-time decision at that
-- branch, which this leaves in place (the pack's Part 11).
--
-- A DATABASE WITH NO OPEN WAREHOUSE OR FACTORY IS NOT PROMOTED. A source and a cut-off name
-- one; with none, there is nothing to set either to. It also keeps every local rebuild
-- as it is: migrations run before the seed makes any facility, so this records nothing
-- and warns, and the seed opens both for the suites, as it has since 0024 (0030, c013 and
-- c014). Recorded there, this would collide with the seed's own state rows, and its
-- decisions, dated now() in an append-only log the seed cannot freeze, would make two
-- builds differ (db:check). A facility of that kind that is closed does not count.
--
-- A state already recorded organisation-wide for either capability, by a run-time
-- decision, is an error, worded: this migration would otherwise fail on the state row's
-- key, closed but unexplained (found in review of module 7's switch-on).
--
-- Requirements: CAP-P02 · CAP-P03 · CAP-P04 · MFG-012 · INV-014 · INV-P05 · INV-P06 · INV-P07

do $$
declare
  c_setup constant uuid := '00000000-0000-0000-0000-00000000c025';
  c_pars constant uuid := '00000000-0000-0000-0000-00000000c026';
  c_reason constant text :=
    'Module 9 switch-on: a pilot organisation-wide (ADR-0033, step 6). Its sign-offs are named in the pull request that merged this migration.';
  v_supplying text;
  v_existing text;
begin
  select string_agg(f.code, ', ' order by f.code) into v_supplying
    from erp.facility f
   where f.facility_type in ('warehouse', 'factory') and f.status = 'open';
  if v_supplying is null then
    raise warning 'ordering.setup and ordering.par_levels are NOT promoted: no open warehouse or factory exists here. They stay hidden.';
    return;
  end if;
  select string_agg(s.capability_key || ' is ' || s.state, ', ' order by s.capability_key) into v_existing
    from erp.capability_state s
   where s.facility_id = erp.capability_org_scope()
     and s.capability_key in ('ordering.setup', 'ordering.par_levels');
  if v_existing is not null then
    raise exception 'organisation-wide a decision is already recorded (%): this migration decides nothing over it. Record the change through erp.decide_capability() instead.',
      v_existing;
  end if;

  insert into erp.capability_decision (
    decision_id, capability_key, facility_id, state, reason, actor_id, actor_type, decided_at
  ) values
    (c_setup, 'ordering.setup', null, 'pilot', c_reason, erp.system_principal(), 'system', now()),
    (c_pars, 'ordering.par_levels', null, 'pilot', c_reason, erp.system_principal(), 'system', now());
  insert into erp.capability_state (capability_key, facility_id, state, as_of_decision_id) values
    ('ordering.setup', erp.capability_org_scope(), 'pilot', c_setup),
    ('ordering.par_levels', erp.capability_org_scope(), 'pilot', c_pars);
  raise notice 'ordering.setup and ordering.par_levels are a pilot organisation-wide. Open warehouses and factories here: %.', v_supplying;
end;
$$;
