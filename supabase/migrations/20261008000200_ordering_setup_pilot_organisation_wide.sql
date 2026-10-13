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
--      not needed: nothing here reads them. Checked when this is applied: items in any
--      state but enabled or pilot organisation-wide is refused, in words.
--   4. The owner has answered the ten questions at the head of the pack, E and J among
--      them, and has said, though no question in the pack asks it, whether this comes
--      before module 10: until module 10 places orders, nothing reads a source, a cut-off
--      or a par, and switching on early only lets them be entered ahead. In a real
--      database only the administrator holds a permission on either capability (0024).
--      Any permission changes the answers to E and J call for (par write for the warehouse
--      and factory managers, the branches' reads) are owner-approved and made on their
--      own, before this: otherwise only the administrator can use what it opens. And
--      every branch the answer to J leaves out has its own decision on par levels recorded
--      there first, also owner-approved: opened organisation-wide, the pilot reaches every
--      branch that has none from the moment this is applied.
--   5. An open warehouse or factory exists where this is applied, made through facilities
--      (module 4). Where none does, this warns, records nothing, and still counts as
--      applied, so it never runs again (the gap found in review of module 7's switch-on,
--      ADR-0031's step 6 addendum). Check the warning's absence when applying.
--   6. Neither capability has a state recorded organisation-wide where this is applied.
--      Check it read-only before merging: this refuses otherwise, and a refused migration
--      stops every migration after it.
--   7. It takes a fresh timestamp when it comes back, later than every migration merged by
--      then, module 10's and any switch-on of module 1 included, or a hosted project would
--      refuse it as out of order (Q-23). Dated 20261008000200, it follows only 0024.
--
-- ORGANISATION-WIDE, NOT AT ONE FACILITY, unlike modules 5 to 8's pilots at the central
-- warehouse. 0024 asks ordering.setup at no facility to set or clear an item's source, so a
-- source is set only where the capability is open organisation-wide. And it asks
-- ordering.par_levels at the branch a par is for as well as where it is set from
-- (ADR-0033 §4, §8), so a pilot at the warehouse and the factory alone would open pars at
-- no branch. §8 also allows par levels at the supplying facilities and at each branch the
-- pilot covers. Not taken: a par set organisation-wide asks the capability at no facility,
-- and would be refused, and every facility named here would be a code to replace before
-- merging, as modules 5 to 8's WH-001 is. capability_state_for() reads a facility's own
-- state before the organisation's, so a branch the pilot leaves out is closed by its own
-- decision there, recorded first (4), which this leaves in place.
--
-- A DATABASE WITH NO OPEN WAREHOUSE OR FACTORY IS NOT PROMOTED. A source and a cut-off name
-- one; with none, there is nothing to set either to. It also keeps every local rebuild
-- as it is: migrations run before the seed makes any facility, so this records nothing
-- and warns, and the seed opens both for the suites, as it has since 0024 (0030, c013 and
-- c014). Recorded there, this would collide with the seed's own state rows, and its
-- decisions, dated now() in an append-only log the seed cannot freeze, would make two
-- builds differ (db:check). A facility of that kind that is closed does not count.
--
-- A STATE ALREADY RECORDED ORGANISATION-WIDE for either capability is an error, worded,
-- and asked first, so the warning above never claims both stay hidden while one is open:
-- this migration would otherwise fail on the state row's key, closed but unexplained
-- (found in review of module 7's switch-on). A local stack built from the seed always has
-- both, so one migrated forward with this file stops here; its hint says to rebuild.
--
-- Requirements: CAP-P02 · CAP-P03 · CAP-P04 · MFG-012 · INV-014 · INV-P05 · INV-P06 · INV-P07

do $$
declare
  c_setup constant uuid := '00000000-0000-0000-0000-00000000c025';
  c_pars constant uuid := '00000000-0000-0000-0000-00000000c026';
  c_reason constant text :=
    'Module 9 switch-on: a pilot organisation-wide (ADR-0033, step 6). Its sign-offs are named in the pull request that merged this migration.';
  v_existing text;
  v_supplying text;
begin
  select string_agg(s.capability_key || ' is ' || s.state, ', ' order by s.capability_key) into v_existing
    from erp.capability_state s
   where s.facility_id = erp.capability_org_scope()
     and s.capability_key in ('ordering.setup', 'ordering.par_levels');
  if v_existing is not null then
    raise exception 'organisation-wide a decision is already recorded (%): this migration decides nothing over it.',
      v_existing
      using hint = 'On a local stack built from the seed, which opens both (0030), rebuild it: npm run db:reset. Anywhere else, withdraw this migration by a pull request; the decision recorded stands, and a change to it is recorded through erp.decide_capability().';
  end if;

  select string_agg(f.code, ', ' order by f.code) into v_supplying
    from erp.facility f
   where f.facility_type in ('warehouse', 'factory') and f.status = 'open';
  if v_supplying is null then
    raise warning 'ordering.setup and ordering.par_levels are NOT promoted: no open warehouse or factory exists here. They stay hidden.';
    return;
  end if;

  if not erp.capability_admits_new_work('inventory.items', null) then
    raise exception 'inventory.items is % organisation-wide: item sources and par levels would answer nobody. Nothing is promoted.',
      erp.capability_state_for('inventory.items', null)
      using hint = 'Switch items on organisation-wide first (module 1), then apply this.';
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
