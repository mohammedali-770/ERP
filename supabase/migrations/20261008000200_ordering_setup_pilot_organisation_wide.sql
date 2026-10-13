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
--   3. Items are open (enabled or pilot) organisation-wide first (module 1). Every source
--      and par route asks read on inventory.items; only the cut-off routes do not (0024).
--      Read-only or withdrawn, items take no new work, and ordering setup is not opened
--      over them. Stock, the bell and purchase orders are not needed: nothing here reads
--      them. Refused, in words, when this is applied; check it read-only first (below),
--      since a refused migration stops every migration after it.
--   4. The owner has answered the ten questions at the head of the pack, E and J among
--      them, and Q-29 (whether this comes before module 10) and Q-30 (whether a warehouse
--      or factory left out can still supply items), recorded in the pack's answer column
--      and in each question. An answer may hold this longer (Q-29: with module 10) or add
--      a migration it waits on (Q-30: the source routes changed). In a real database only
--      the administrator holds a permission on either capability (0024). Then, each
--      owner-approved and made on its own, before this:
--      - the permission changes the answers to E and J call for (for the warehouse and
--        factory managers, par write with the setup read and items read; the branches'
--        reads); without them only the administrator can use what this opens;
--      - at every facility the answer to J leaves out, its own decision on each capability
--        it is left out of. At a branch, both hidden closes everything there: no par is
--        set, cleared or read for it, and nothing is read there; read_only leaves all of
--        it readable, and no par is set or cleared for it. At a warehouse or factory,
--        ordering.setup governs its cut-off and what is read there, and ordering.par_levels
--        the pars set from there: both hidden, nothing is set or read there, though a
--        cut-off already set stays in force. One kept in par levels takes ordering.setup
--        read_only, not hidden, since its par page finds items through their sources.
--        Whatever is decided there, a warehouse or factory can still be named as an item's
--        source, and pars for that item set organisation-wide: 0024 asks the source routes
--        at no facility (Q-30).
--      Opened organisation-wide, the pilot reaches every facility with no decision of its
--      own from the moment this is applied, and every facility made later until one is
--      recorded there. No reviewed way to record such a decision exists yet (Q-23): it is
--      a further migration naming the facility by code, which this then waits on, or a
--      write to the live database.
--   5. Where this is applied to a database not built from the seed (production), an open
--      warehouse or factory exists there, made through facilities (module 4). Where none
--      does, this warns, records nothing, and still counts as applied, so it never runs
--      again (the gap found in review of module 7's switch-on, ADR-0031's step 6
--      addendum). Check the warning's absence when applying.
--   6. Where this is applied to a database not built from the seed, neither capability has
--      a state recorded there organisation-wide: a recorded hidden counts, though it reads
--      as no state at all. Check it read-only before merging and again before applying.
--      A database built from the seed (a local stack, the staging project) always has the
--      seed's two. There this is applied before the seed makes any facility, by a rebuild
--      or by the first push to a fresh project, so it warns by design; pushed onto one
--      already seeded, it is refused (below).
--   7. It takes a fresh timestamp when it comes back, later than every migration merged by
--      then, module 10's and any switch-on of module 1 included, or a hosted project would
--      refuse it as out of order (Q-23). It is dated directly after 0024.
--
-- Read-only checks, as the owner of the database, before merging and again before
-- applying, where it is not built from the seed:
--   3. select erp.capability_state_for('inventory.items', null);  -- enabled or pilot
--   4. select f.code, s.capability_key, s.state from erp.capability_state s
--        join erp.facility f on f.facility_id = s.facility_id
--       where s.capability_key in ('ordering.setup', 'ordering.par_levels') order by 1, 2;
--                       -- each facility the answer to J leaves out, in the state (4) says
--   5. select code from erp.facility
--       where facility_type in ('warehouse', 'factory') and status = 'open';  -- at least one
--   6. select capability_key, state from erp.capability_state
--       where facility_id = erp.capability_org_scope()
--         and capability_key in ('ordering.setup', 'ordering.par_levels');  -- no rows
--      Not capability_state_for() or the console: both read a recorded hidden as none.
--
-- ORGANISATION-WIDE, NOT AT ONE FACILITY, unlike modules 5 to 8's pilots at the central
-- warehouse. 0024 asks ordering.setup at no facility to set or clear an item's source, so a
-- source is set only where the capability is open organisation-wide. And it asks
-- ordering.par_levels at the branch a par is for as well as where it is set from
-- (ADR-0033 §4, §8), so a pilot at the warehouse and the factory alone would open pars at
-- no branch. §8 also allows par levels at the supplying facilities and at each branch the
-- pilot covers. Not taken: there, a par is neither set nor read organisation-wide, and the
-- par of an item whose source is cleared, which only the organisation clears, could not be
-- cleared until the item has a source again.
-- capability_state_for() reads a facility's own state before the organisation's, so a
-- facility the pilot leaves out takes its own decision there, recorded first (4), which
-- this leaves in place. The cost: a facility made later is in the pilot until one is
-- recorded there.
--
-- A DATABASE WITH NO OPEN WAREHOUSE OR FACTORY IS NOT PROMOTED. A source and a cut-off name
-- one; with none, there is nothing to set either to. It also keeps every local rebuild
-- as it is: migrations run before the seed makes any facility, so this records nothing
-- and warns, and the seed opens both for the suites, as it has since 0024 (0030, c013 and
-- c014). Recorded there, this would collide with the seed's own state rows, and its
-- decisions, dated now() in an append-only log the seed cannot freeze, would make two
-- builds differ (db:check). A facility of that kind that is closed does not count. No
-- facility is named here, so no code needs replacing before merging, unlike modules 5 to
-- 8's WH-001 (a facility left out may be named elsewhere: 4).
--
-- A STATE ALREADY RECORDED ORGANISATION-WIDE for either capability is an error, worded,
-- and asked first, so the warning never passes over one: this migration would otherwise
-- fail on the state row's key, closed but unexplained (found in review of module 7's
-- switch-on). No route removes a state, so the error stands until something changes. A
-- database built from the seed and then migrated forward has both, the seed's: a local
-- stack, or the staging project once seeded. Its hint says to rebuild it, which runs
-- migrations before the seed. Anywhere else the file is withdrawn.
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
  v_items text;
begin
  select string_agg(s.capability_key || ' is ' || s.state, ', ' order by s.capability_key) into v_existing
    from erp.capability_state s
   where s.facility_id = erp.capability_org_scope()
     and s.capability_key in ('ordering.setup', 'ordering.par_levels');
  if v_existing is not null then
    raise exception 'already recorded organisation-wide: %. This migration decides nothing over a recorded state.',
      v_existing
      using hint = 'On a database built from the seed (a local stack, or the staging project), rebuild it: npm run db:reset locally, supabase db reset --linked on staging alone, owner-approved. Anywhere else, withdraw this migration by a pull request; what is recorded stands, and a change to it is recorded through erp.decide_capability().';
  end if;

  select string_agg(f.code, ', ' order by f.code) into v_supplying
    from erp.facility f
   where f.facility_type in ('warehouse', 'factory') and f.status = 'open';
  if v_supplying is null then
    raise warning 'ordering.setup and ordering.par_levels are NOT promoted: no open warehouse or factory exists here. Nothing is recorded.';
    return;
  end if;

  v_items := erp.capability_state_for('inventory.items', null);
  if v_items not in ('enabled', 'pilot') then
    raise exception 'inventory.items is % organisation-wide, not open: ordering setup is switched on only after items are. Nothing is promoted.',
      v_items
      using hint = 'Switch items on organisation-wide first (module 1), by a migration dated before this one or a decision recorded at run time, owner-approved, then apply this. Otherwise withdraw this migration by a pull request.';
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
