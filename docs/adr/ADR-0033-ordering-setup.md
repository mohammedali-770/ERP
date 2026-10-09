# ADR-0033 — Ordering setup: which facility supplies an item, when it stops taking today's orders, and each branch's par

- **Status:** Proposed. Built as module 9's database layer on 2026-10-08. The owner
  decided O1 to O5 (§1) the same day; the questions below are decided before the module
  is switched on
- **Date:** 2026-10-08
- **Requirements:** INV-014 · INV-P05 · INV-P06 · INV-P07 · MFG-001 · IAM-006 · SEC-006 ·
  CAP-P02 · CAP-P04 · PRG-014
- **Related:** ADR-0012 · ADR-0024 · ADR-0027 · ADR-0028 · ADR-0029 · ADR-0031 · ADR-0032 ·
  invariants I-7, I-8 · `supabase/migrations/20261008000100_ordering_setup.sql` ·
  [`../estate/process-mapping-ordering-setup.md`](../estate/process-mapping-ordering-setup.md)

## Context

The warehouse system's Ordering setup screen had four sections: order cut-off times,
purchase-order approval limits, the supplier-invoice tolerance and branch par levels. The
process mapping sets out what each did. Five things matter here:

- **Everything turned on one category.** Each item was 'warehouse' or 'factory'. That
  chose which site sent it, which cut-off dated its order, and which manager set its par.
  The ERP splits the category three ways, and gives "which facility replenishes branches
  with it" to this module ([items mapping](../estate/process-mapping-items-and-units.md)).
- **A cut-off moved an order, never refused it.** An order placed at or after its
  category's cut-off, in a hard-coded Riyadh time, was for the next day. The day was
  fixed when the order was first saved, and an edit to a waiting order kept it. That day
  decided which day's factory production the order landed in.
- **A par had no unit, and no control by branch.** One number per branch and item, implicitly in the
  sale unit, which the ERP calls the base unit. Every signed-in user could read every
  branch's. A manager could set any branch's par for their category's items. A par
  cascaded away with its item, and 0 was stored as a row apart from "no par".
- **Nothing kept why, or any change but the last.** Cut-offs and pars were overwritten in
  place, keeping only who changed each last, and when.
- **Two of the four sections belong elsewhere.** Module 8 already carries the approval
  limits (ADR-0032 §4). The tolerance is read only by supplier-invoice matching, which
  decides whether an invoice may be paid.

INV-014 asks for branch replenishment by manual request, system-suggested quantities and
automatic orders, in F3. ADR-0021 brought it forward. Module 10 builds the orders; this
module records what they need.

## Decision

### 1. The owner's five decisions (2026-10-08)

- **O1 — One supplying facility per item.** Each item has one warehouse or factory that
  supplies every branch with it, organisation-wide, as the category did. It is recorded
  with who, when and why, and changed by a later decision.
- **O2 — One cut-off per supplying facility,** a time of day read in that facility's own
  time zone. To have no cut-off, it is cleared; no time of day means none.
- **O3 — Next day, fixed once placed.** An order placed at or after the cut-off is for
  the next day, never refused. Its day is fixed when it is first placed and kept if the
  waiting order is changed later. A cut-off of 00:00 makes every order next-day.
- **O4 — A par is an order-up-to level,** per branch per item, entered in a current pack
  and kept in the base unit, as a minimum is (ADR-0031). New Order suggests the par less
  the on-hand figure the worker types, rounded up to whole packs of the pack being
  ordered. Module 7's minimum is separate and unchanged.
- **O5 — As the warehouse.** The administrator sets sources and cut-offs. A par is set by
  the administrator, or by the manager of the facility that supplies the item, asked at
  that facility, for any branch. A branch's staff read only their own branch's pars and
  its suppliers' cut-offs.

### 2. Three settings, each a decision

Every master here is a log and a projection (I-8), and so is each of these. A setting is
cleared by a decision too, and its row stays, so its stamp still names the decision that
cleared it. Triggers keep each row on what it is about and refuse deleting or truncating
it, binding the owner too. No foreign key cascades (B-11).

| Setting | Log | Projection, keyed by | Value |
|---|---|---|---|
| Source (O1) | `erp.replenishment_source_decision` | `erp.replenishment_source`, the item | a warehouse or factory |
| Cut-off (O2) | `erp.order_cutoff_decision` | `erp.order_cutoff`, the supplying facility | a `time(0)`, to the minute |
| Par (O4) | `erp.par_level_decision` | `erp.par_level`, the branch and the item | the base quantity, with the pack as entered |

- **A par records the pack it was entered in.** The conversion is copied whole, under a
  composite key to `erp.item_unit` as 0012's seam lays out (I-7), with the quantity in
  that pack and the base quantity, exact to six places.
- **A par is more than nothing.** In the warehouse a par of 0 showed "Par 0" and an
  optional on-hand field on that branch's New Order, and suggested nothing. Requiring the
  on-hand figure was `items.stock_level_required`, per item, which module 10 carries. To
  have no par, it is cleared.
- **A source is a warehouse or factory of the item's brand.** A source of another brand
  would send one brand's goods from another's site (ADR-0012).

### 3. A par is stored at a branch, and is not a stock record

This is the first per-item setting kept at a branch. A par carries no business day and
no balance. So Q-06, when a branch's business day opens, is not reached, and no branch
holds stock because of a par (ADR-0029 §8). The par routes accept a branch, and only a
branch, on purpose: they do not use 0020's facility check, which refuses one.

### 4. Who sets what (O5)

Two capabilities, because the warehouse kept cut-offs the administrator's while its
managers set pars. With one write action, a factory manager could move the factory's
cut-off.

- **`ordering.setup` — sources and cut-offs.** Sources are a master, written
  organisation-wide as items and prices are: the gate is asked at no facility, so only an
  organisation-wide writer passes. A cut-off is asked at its facility, as 0023's limits
  are. The migration grants write to the administrator alone, organisation-wide, so both
  are the administrator's, as in the warehouse.
- **`ordering.par_levels` — pars.** A par is set from the facility that supplies the
  item, or from the organisation. The gate is asked there. So a factory manager scoped to
  the factory sets the factory's items' pars, at any branch, and no other item's. The
  warehouse's policy checked only the category, never the branch. A par set from
  anywhere else is refused, a branch included, and so is a par set from the organisation
  for an item no facility supplies: it cannot be ordered.
- **The gate moves with the source.** When an item's source moves, its pars stay, and
  the manager of the new source sets them from then on. When the source is cleared, its
  pars stay and can only be cleared, organisation-wide; none can be set until the item
  has a source again.
- **The capability is asked at the branch too.** A par is for a branch, so
  `ordering.par_levels` must admit new work at the branch as well as where the par is set
  from. A branch where it is withdrawn, read-only or hidden takes no new par, and a
  branch's pars are not read from anywhere while it is hidden there. Without this, a
  pilot could not name the branches it covers (found in review).

Each write route also asks the reads its history asks, so whoever writes can read the
history back to confirm a retry (ADR-0031 §3).

### 5. Six write routes

`erp.set_replenishment_source()`, `erp.clear_replenishment_source()`,
`erp.set_order_cutoff()`, `erp.clear_order_cutoff()`, `erp.set_par_level()` and
`erp.clear_par_level()`. After the gate, in order:

1. **A retry is answered as one.** The decision id is locked and checked first, and
   answers 23505 on its log's primary key, as every log here does.
2. **What the setting is about.**
   - A source: the item is active (new work), under its share lock. The facility is
     named, open under its share lock, a warehouse or factory, and of the item's brand.
     Clearing is not new work, so a retired item's source can be cleared.
   - A cut-off: the facility is named, open, and a warehouse or factory.
   - A par: the branch is named; then, when the par is set from a facility, of that
     facility's brand, or it answers as a missing one before anything else is said of
     it: checked later, another brand's warehouse answered "is a warehouse" and its closed
     branch "is closed" (found in review). Then it is open, a branch, and one the
     capability admits new work at (§4). The pack is found through the branch's brand, so
     another brand's answers as missing too (ADR-0012). For a set,
     the item and the pack must be active: the pack is read again, and held, under the
     item's share lock (0022's finding; db:check races it).
3. **A par's source.** The item's source in force is read under the source's lock, taken
   shared. Every source decision about the item takes that lock exclusively. So a par
   waits for a source change in flight and is judged against what the change left, and a
   factory manager is never admitted by a source no longer in force (db:check races it).
   It is an advisory lock, not a row lock, because an item that has never had a source
   has no row to lock. For a set, the source must also be open, under its share lock: a closed
   facility takes no orders, so a par towards one is new work nobody can use (found in
   review). A par can be cleared whatever its source's state.
4. **The value.**
   - A cut-off crosses as `'HH:MM'` text, 00:00 to 23:59, matched by one pattern and
     never parsed loosely; empty is refused, never read as none.
   - A par is decimal text, up to twelve digits and six places, exact to six places in
     the base unit and under 10¹², as stock's and minimums' are.
5. **The stale check.** Each setting is locked: an advisory lock on what it is about, for
   a first setting that has no row yet, and then its row. Two first pars, or two first
   sources, racing are answered stale, the second after the first (db:check races both). Its stamp is compared with the
   one the person read, which is `null` only when it has never been set. Then a setting
   unchanged is refused, a par compared in the base unit, and so is clearing one that is
   not set.

### 6. The day an order is for: `erp.order_day()` (O3)

Module 10 dates its orders through a seam this module ships, granted to nobody, as
module 3 shipped `erp.transfer_price_at()`:

- **`erp.order_day(facility)`** answers, for an order placed now with that supplying
  facility, the day it is for, the cut-off decision that dated it, and the moment it was
  placed. The decision is the one in force, a clearing included, or none when the
  facility has never had a cut-off.
- **The rule** is `erp.order_day_for(moment, time zone, cut-off)`: the date at the
  facility, in its own time zone, at that moment, plus one when there is a cut-off and
  the time there is at or after it. It reads no table, so its arithmetic is tested at
  stated moments; the session's own time zone changes nothing.
- **Never a refusal.** An order after the cut-off is taken for tomorrow.
- **Now, never a stated moment.** The moment is the clock once the cut-off's lock is held,
  as stock's "now" is (ADR-0029 §3). The first draft took a moment from its caller, but
  the projection holds only the cut-off in force now, so an earlier moment was dated by a
  cut-off set after it (found in review). An order is placed when it is placed.
- **Module 10 copies all three onto the order when it is first placed** (I-7) and never
  asks again. A waiting order changed later keeps its day, and a cut-off changed later
  dates only orders placed afterwards.
- **It takes the cut-off's lock shared,** the lock every cut-off decision takes
  exclusively. So an order waits for a cut-off change in flight and is dated by what it
  left, naming that decision (db:check races it).
- **The supplying facility's time zone,** not the branch's. The warehouse compared in a
  hard-coded Riyadh. Every facility is in Riyadh today, since `erp.create_facility()`
  sets it, so the two cannot yet differ (question 3).

This day is what an order is **for**. The order's own business day, and the day its
number counts in, are module 10's to ask under Q-22.

### 7. Six reads

Every read pages, 1 to 500 rows.

- **Sources and cut-offs** are read as masters are: at a named facility, the facility's
  brand a second fence, or organisation-wide.
  - `erp.replenishment_sources()` lists every item of the brand by code, with the
    facility that supplies it, if any. It can narrow to the items one facility supplies.
  - `erp.order_cutoffs()` lists every warehouse and factory of the brand, with its
    cut-off as `'HH:MM'`, or none. At a branch, these are the cut-offs of every
    warehouse and factory of its brand: its suppliers, and any that supplies nothing yet.
  - Each has a history read, newest first, marking the decision in force. A cut-off's
    history is read at its own facility, as its routes are.
- **Pars** are read at their branch, by its staff for New Order, or at a facility that
  supplies it, for the items that facility supplies, or organisation-wide.
  - `erp.par_levels()` gives a branch's pars as entered and in the base unit, with each
    item's source.
  - `erp.par_level_history()` gives one item's decisions at a branch.
  - A branch's staff hold the read at their own branch alone, so they read no other
    branch's (IAM-006). Asking for another branch from their own is refused, as is
    asking from an office. Asked at a warehouse or factory, a branch's pars are only
    those of the items it supplies.

### 8. Hidden, as every module ships

`ordering.setup` and `ordering.par_levels` are registered with no decision, so they are
hidden in every real database until a migration promotes them. The administrator reads
and writes both.

The synthetic seed opens both at pilot. It gives the two managers par write and the
setup read: the factory manager at the factory alone, so they set only the factory's items'
pars; the warehouse manager organisation-wide, so they set any item's. Branch workers
and the general manager read both. The accountant holds nothing here.

**Switching on.** Since a par is asked at its branch too (§4), a pilot that opens
`ordering.par_levels` at the warehouse and the factory alone opens it at no branch: no
par could be set or read. The switch-on must open it organisation-wide, or at every
branch the pilot covers as well as at the supplying facilities.

### 9. Kept out, deliberately

- **The supplier-invoice tolerance.** It is not built here at all. Its only reader is
  supplier-invoice matching, which decides whether an invoice may be paid: payment-
  adjacent, inside `CLAUDE.md` §6's freeze. So it moves with that matching into frozen
  module 21, under that module's hidden capability. Reopening this is the owner's.
- **Approval limits.** Module 8 carries them (ADR-0032 §4); the mapping records it so the
  section is not mapped twice.
- **Display order.** The warehouse's `items.order_index` is the catalogue's order on New
  Order. It goes to module 10, which shows the catalogue.
- **Orders, the suggestion's arithmetic, `stock_level_required`, the typed on-hand figure,
  and numbering:** module 10.
- **Branch stock** (Q-06), and INV-013's maximum, safety stock and reorder values
  (ADR-0031 A1).
- **A schedule.** A cut-off change takes effect at once. There is no effective-from
  moment, as transfer prices have.

## Consequences

- **Each setting has a history and an actor,** where the warehouse kept only the last
  value.
- **A branch reads its own pars only,** and a manager scoped to a facility sets only
  the pars of what it supplies.
- **An order's day is fixed by a recorded decision,** which module 10 copies, so a
  cut-off changed later never re-dates an order.
- **INV-015 is not met.** The suggestion uses no recorded stock, open transfers or lead
  time, because no branch holds a stock record. INV-014's system-suggested quantities are
  evidenced only once module 10 builds them.
- **db-check's branch rule still checks stock decisions only.** A par at a branch is
  allowed by design; `par-levels-match-their-decisions` requires that every par is at a
  branch, for an item of its brand.
- **The edge function, screens and staff testing follow,** as for every module.

## Questions for the owner

1. **Should a cut-off of 00:00 be allowed?** It makes every order next-day, as in the
   warehouse. To have none, the cut-off is cleared.
2. **A par of 0.** The warehouse stored 0 as a row apart from "no par": on that
   branch's New Order it showed "Par 0" and an optional on-hand field. Here it is
   refused, and no per-branch way to show that field remains; is that right?
3. **Whose time zone dates an order:** the supplying facility's, as built, or the
   branch's? They cannot differ until a facility outside Riyadh exists.
4. **Can a warehouse ever supply two brands?** A source must be of the item's brand
   today, so it cannot be expressed.
5. **Who sets pars in a real database,** and who reads them? The seed's answer is the
   managers — the factory manager from the factory alone, the warehouse manager
   organisation-wide — and the branch's own staff reading.

## Addendum — 2026-10-08: the data layer (module 9, step 2)

0024's six write routes and six reads are reachable over HTTP through one edge function,
`ordering-setup` (`supabase/functions/_shared/ordering-setup.ts`), built as `stock-alerts`
is (ADR-0031's step 2 addendum). Nothing about the routes changed. `erp.order_day()` is not
reachable: module 10 calls it from its own route (§6).

- **The routes:**
  - `GET /sources` lists the items of the brand of the query's `facility_id`, by code, or
    every brand's without one; `supplied_by` narrows it to the items one facility supplies.
  - `GET /cutoffs` lists the warehouses and factories of the brand of the query's
    `facility_id`, by code, with their cut-offs, or every brand's without one.
  - `GET /pars/{branch_id}` lists a branch's pars, by code, asked at the query's
    `facility_id`: the branch, a facility that supplies it, or the organisation without one.
  - Each list answers 100 rows unless `limit` asks for 1 to 500. A full page answers
    `next_after`, its last code, which the next page sends back as `after`.
  - `GET /sources/{item_id}`, `GET /cutoffs/{facility_id}` and
    `GET /pars/{branch_id}/items/{item_id}` give a setting's decisions, newest first. A
    full page answers `next_before`, a `seq` as decimal text, which the next page sends
    back as `before`. A cut-off's history is asked at the facility it is of, which its
    path names, whatever the query says.
  - `POST /sources/{item_id}` sets an item's source: `decision_id`, `supplied_by`,
    `expected_decision_id` and `reason`. `POST /sources/{item_id}/clear` clears it:
    `decision_id`, `expected_decision_id` and `reason`.
  - `POST /cutoffs/{facility_id}` sets a cut-off: `decision_id`, `cutoff`,
    `expected_decision_id` and `reason`. `POST /cutoffs/{facility_id}/clear` clears it:
    `decision_id`, `expected_decision_id` and `reason`.
  - `POST /pars/{branch_id}` sets a par: `decision_id`, `facility_id`, `item_unit_id`,
    `quantity`, `expected_decision_id` and `reason`.
    `POST /pars/{branch_id}/items/{item_id}/clear` clears one: `decision_id`,
    `facility_id`, `expected_decision_id` and `reason`.
- **What a setting is about is named in the path:** the item a source is of, the facility
  a cut-off is of, the branch a par is for and, for a clear, its item. No body can name
  another.
- **The actor is the session's,** through `withSession` (ADR-0025); a Node control test
  forges it in every way a body or header could, on all six writes.
- **The edge checks shape, the database checks rules.** A par is decimal text, as a
  minimum is. Three shape rules are this module's own:
  - **A cut-off is `'HH:MM'` text:** two digits, a colon, two digits. A number, a moment,
    one digit or an empty string is a 400. That it is a time of day is 0024's rule, so
    `'24:00'` reaches it and is refused there by name.
  - **A par write states where it is set from:** `facility_id`, the facility that supplies
    the item, or `null` for the organisation (O5). Left out or empty, it is a 400, never
    read as the organisation: a form that never chose must not pass for one that chose.
  - **A source names its facility `supplied_by`,** as the list's filter does, so it is
    never read as the facility the person works at.
- **The stamp is stated,** as a minimum's is: a set carries `expected_decision_id`, `null`
  only where the setting has never been made; left out or empty, it is a 400. A clear
  carries one always. A cleared setting keeps its row and its stamp, so it is set again
  against the decision that cleared it, and `null` there is stale. The source and cut-off
  lists carry that stamp. The par list leaves cleared pars out, so a cleared par's stamp is
  read from its history, as a minimum's is (ADR-0031's step 2 addendum).
- **Retries.** `replenishment_source_decision_pkey`, `order_cutoff_decision_pkey` and
  `par_level_decision_pkey` join the logs whose route-raised 23505 is answered 409
  `already_recorded`, and `replenishment_source_stale`, `order_cutoff_stale` and
  `par_level_stale` are 409 `stale`. The console confirms a write through the setting's
  history, asked as the write was: a par from the facility it was set from.
- **Tested** by the Node suite (`_shared/test/ordering-setup.test.ts`): the actor on every
  write and read, the path's subject over the body's, a stated stamp and a stated place,
  cut-offs and pars carried as text, every route's shape, paging, and each refusal's
  answer; and end to end by the Deno test (`_deno/test/ordering-setup.test.ts`): a cashier
  reading their own branch and nothing else; sources set, retried, confirmed and cleared by
  the administrator, and refused to the warehouse manager; a cut-off moved, paged, refused
  at `'24:00'`, refused to the factory manager and cleared; and pars set by the factory
  manager from the factory, refused for the warehouse's items, set organisation-wide and
  cleared.

## Addendum — 2026-10-08: the screens (module 9, step 3)

The console reads and changes the three settings through the `ordering-setup` function.
Nothing about the routes changed.

- **Three entries, under a new Ordering group,** each shown only where every read its list
  asks is held and nothing is hidden (navigation.ts, `alsoReads`); a typed URL meets the
  same answer:
  - "Item sources": read on the setup and on items;
  - "Order cut-off times": read on the setup alone, so a branch's staff see the cut-offs
    of the facilities that supply them;
  - "Par levels": read on pars and on items.
- **What is offered is 0024's gates, read where the person works** (ordering-setup.ts,
  `orderingRights`). Nothing is offered in a preview, or where the capability admits no
  new work.
  - **Sources organisation-wide only,** as the masters are: 0024 asks at no facility.
  - **A cut-off only at its own warehouse or factory, worked at,** as a purchase limit is:
    0024 asks at the facility. Organisation-wide, the administrator reads every cut-off and
    its history, and switches to the facility to change one.
  - **Pars from the warehouse or factory worked at, or organisation-wide** (O5). A par
    write states which: the facility's own id as `facility_id`, or `null`. Never at a
    branch or an office, which supply nothing.
  - **And only where par levels admit new work at the branch too,** which 0024 asks
    again there (`erp.assert_par_branch()`): a pilot names the branches it covers. The
    page reads the state at the branch as the viewer reads one, through the session route
    at the branch (`branchAdmits`). Hidden there, the page says par levels are not switched
    on at the branch where 0024 refuses its read as "not permitted", and only then: a
    branch 0024 does not know is 0024's to answer. Read only or withdrawn, it says they
    take no changes there, and offers none.
- **Sources (`#replenishment_sources`)** lists every item, by code, with its source, read
  where the person works; one facility's items alone on asking. An item's page
  (`#replenishment_sources/{item_id}`) shows the source in force and every decision.
  - A source is set to an open warehouse or factory of the item's brand, never the one in
    force. The cut-off list gives each facility's state; the session's facilities give its
    brand.
  - A source is cleared, a retired item's included.
- **Cut-offs (`#order_cutoffs`)** lists every warehouse and factory, by code, with its
  cut-off as `HH:MM` and its time zone.
  - The list links a cut-off's page (`#order_cutoffs/{facility_id}`) only
    organisation-wide or at the facility itself, since 0024 reads its history there. From
    a branch, the list is all there is. An address typed by hand is answered by 0024,
    which reads the history to an organisation-wide role wherever it works.
  - A cut-off is typed on the 24-hour clock, `9:30` or `14:00`, or as the digits alone,
    `930` or `1400`, since a phone's number pad has no colon; Arabic-Indic digits are read.
    It is sent as `HH:MM` and checked by 0024's own pattern, so `24:00` is named before
    sending.
  - Only someone who holds write on the setup is told that a cut-off is changed while
    working at its facility; anyone else is told only that they cannot change it.
  - It is never a time input and never a moment: it is a time of day at the facility, read
    in its own time zone, which the form names.
- **Pars (`#par_levels`).**
  - **The entry, at a branch,** is the branch's own pars, and no other branch is offered
    (IAM-006).
  - **At a warehouse or factory, or organisation-wide,** a branch is chosen first: the
    brand's branches where the person reads facilities, otherwise the session's own, of
    the facility's brand at a warehouse or factory. A chooser left empty for want of
    facility read says so.
  - **A branch's page (`#par_levels/{branch_id}`)** lists its pars, each in the base unit
    and as entered, with the facility that supplies the item. From a warehouse or factory,
    it lists only the items that facility supplies.
  - **An item is found to set a par for.** From a warehouse or factory, it is found among
    the items that facility supplies (0024's source list, filtered to it). Organisation-wide,
    it is any active item of the branch's brand.
  - **An item's par page (`#par_levels/{branch_id}/items/{item_id}`)** shows the par in
    force, the item's source and every decision. A par is typed in a current pack as
    decimal text, more than nothing.
  - **Set and clear are offered as 0024 would take them** (`parActions`): at a branch not
    known to be closed, where par levels are not known to take no new work, and for an
    item the facility worked at supplies. A set needs an active item with a source, at a
    source not known to be closed. A clear is offered organisation-wide even when the item
    has no source. **Every form withheld has its reason said** (`parNotice`): the branch's
    state, the branch closed, read only, set elsewhere, no source, the item retired, or
    its source closed.
  - **From a warehouse or factory, an item it does not supply** is answered as missing by
    0024 (`item_exists`). The page then says where its par is set, from the item's source
    history, or, where that cannot be read, that the facility does not supply it, rather
    than that the item does not exist. A branch 0024 does not know (`facility_exists`) is
    answered as 0024 answers it.
- **The stamp is the history's** for all three settings, a clearing included, and never a
  list's. It is `null` only for a setting never made.
- **Every write goes through the shared lifecycle** (write.ts): built once, and retried as
  sent. Start over reads the setting's history, asked as the write was, and says "already
  saved" when the history holds the lost request's id. A par form at a warehouse or
  factory also settles its doubt when that history is answered as missing: the item is no
  longer supplied from there, so 0024 takes no par of it from there, and a new decision
  cannot repeat the lost one (write.ts, `settled`). It first sends the request once more,
  as Retry would, the form locked meanwhile: 0024 checks a decision's id after its
  permission gates and before its rules, so while the person may still set pars there, a
  request recorded under the lost answer is answered "already saved", and the page says
  so. Unanswered again, Retry and Start over stay as before.
- **Every 0024 refusal a person can meet is worded** in both languages (messages.ts); the
  retry keys are not. The Arabic uses the warehouse's own words for a cut-off (موعد
  الإغلاق) and a par (المستوى المستهدف). It is marked for a native speaker's review with
  the staff testing pack.
- **Tested** by `apps/console/test/ordering-setup.test.ts` (Node), against the migration's
  own patterns, kinds, gates, seed grants and constraints, and by a browser run against the
  scratch database and edge. In that run:
  - the administrator, organisation-wide, filters the sources to the factory's, sets
    frying oil's source to the warehouse and clears it, sets the gloves' source again
    against its clearing, and is told a clear is stale when the source moved behind the
    page;
  - the administrator reads both cut-offs and the factory's history, with no form; at the
    warehouse, `24:00` is named before sending, `9:30` is kept as `09:30`, an answer cut
    off after the database recorded `1515`, typed as a number pad types it, as `15:15`
    is found by Start over and reported as already saved, and the cut-off is cleared;
  - the administrator sets rice's par at the first branch, `0` named before sending, `12.5`
    kept;
  - the factory manager, at the factory, chooses the second branch, finds strips but not
    chicken breast, and sets three trays, kept as 120 pieces; chicken's page says the
    warehouse supplies it and its par is set there; sources and the factory's own cut-off
    are read only, and they are not told to work there to change it;
  - the factory manager clears the strips' par and the answer is cut off after the
    database recorded it; the strips' source moves to the warehouse; Start over asks the
    clear once more, settles the doubt, says it was already saved, and says where the par
    is set now;
  - with par levels read only at the second branch, its page and the strips' say they
    take no changes there, and offer none; hidden there, both say par levels are not
    switched on at the branch, never "not permitted";
  - a cashier at the first branch reads its pars directly, read only, is refused the
    second branch's in words, and opens no cut-off's page;
  - the warehouse manager reads a branch's pars and the cut-offs in Arabic, right to left.

**Found in review of step 3, fixed before it:**
- **A par at a branch where par levels are not open.** 0024 asks the capability again at
  the branch, and the planned pilot covers some branches only. The page offered set and
  clear there, and every read of a hidden branch, all refused as "not permitted here". It
  now reads the state at the branch, offers nothing where it admits no new work, and says
  why.
- **A source page that loaded for ever.** A failed read of the facilities left the set
  form a spinner with no message. The failure is shown, with Reload.
- **Words that led nowhere.** A manager at their own facility was told to change a cut-off
  while working there; a retired item with no source was promised a clear; a closed source
  or a retired item hid Set without a word. Each now says what is true.
- **A par write that could stay locked.** In doubt at a warehouse or factory when its
  item's source moved away, Start over was refused for ever, and Retry answered only if
  the lost write had been recorded. Start over now settles it.
- **A cut-off on a phone.** The number pad has no colon; the digits alone are now read.
- **Tests that could not fail.** The gate assertions on the set routes ran on into their
  clears, which repeat them; nothing pinned what each page passed to the logic deciding
  what it offers, the stamp handed to each form, or where most reads are asked; the
  shared refusals named one 0024 never raises; item search was never tried in another
  case. Each is pinned now, and each mutation the review found survives no longer.

**Found in the second review, of those fixes, fixed before it:**
- **A settled doubt that said nothing.** Settling at once dropped the one request that
  could say the lost write had been saved. Start over now sends it once more first, and
  the page that a settled write lands on shows the write's answer too.
- **Answers that overruled 0024's.** The "not supplied here" page and the "not switched on"
  notice each answered for any refusal of their kind of status: a branch 0024 does not
  know, typed by hand, read as either. Each now answers only for the refusal it explains.
- **A page left stale.** Where the item's source cannot be read, a settled par write left
  the par it may have cleared on screen. The page now says the facility does not supply
  the item.
- **Tests that could still not fail:** how the branch's state is read, the "not supplied
  here" page, the hidden branch page's refusal, Reload, and the words each notice names a
  facility with. Each is pinned now, as `branchIsHere`, `suppliedElsewhere` and
  `hiddenRefusal` in the logic, tested directly.

**Found in the third review, fixed before it:**
- **"Shown as it is now" where nothing is shown.** A write settled onto an item no longer
  supplied from here said the par was shown as it is now. That page shows no par, and now
  says only what happened (`parWriteBanner`).
- **A request asked again, untested.** The lock while it is out, and both ways out after it
  goes unanswered, were held by the code alone. Both are tested now, and an earlier Start
  over's failure is cleared when the request is asked again.
- **A claim too wide.** "Already saved" is answered while the person may still set pars
  there: 0024 asks its permission gates before the decision's id. The docs say so.

**The fourth review, of those fixes,** found no fault in the code: the banner's table was
tested for seven of its ten cases, and is now tested for all of them, with how the page
builds and renders it.

## Addendum — 2026-10-08: the staff testing pack (module 9, step 5)

[`docs/lab/uat/ordering-setup.md`](../lab/uat/ordering-setup.md), with its Arabic version
in [`ar/`](../lab/uat/ar/ordering-setup.md), is run by the administrator and the warehouse
manager in turn. On a second computer are the administrator again, the factory manager and a
cashier. It evidences INV-P05, INV-P06 and INV-P07, which now name it. In thirteen parts it
covers:
- item sources: one set, one set again against its clearing, one cleared, and none offered
  for an item of a brand with no warehouse or factory;
- cut-offs, read organisation-wide and changed at the warehouse: `24:00` named before
  sending, `1330` kept as 13:30, the same time refused, then cleared and set again;
- par levels at a branch, organisation-wide: one set in bags, `0` named before sending, one
  set in 2.5 cartons, only current packs offered, one cleared, one set again against its
  clearing, and none offered for an item no facility supplies;
- the warehouse setting only the pars of what it supplies;
- two people changing one par, the second told so;
- a source moved while a par page is open, and the par it leaves to the factory; a source
  cleared, and the par it leaves, which only the organisation can clear;
- a lost answer retried;
- the factory manager setting the factory's items' pars at any branch, and finding none of
  the warehouse's;
- a branch the pilot leaves out, read only and then hidden;
- a cashier reading their own branch's pars alone, and refused another's by its address;
- the other language.

**Every figure in it was run first in a browser** against the scratch database and edge,
rebuilt fresh, as the session scripts it. The run moves by the links a participant would
follow, and checks each par as typed and in the base unit, each history, and each sentence
the pack quotes. The English quotations were then checked against the text the screens
showed in that run. The Arabic ones were checked against the console's Arabic strings and
the Arabic pages captured at the run's end. The Arabic version's searches are given as the
stored words, «أرز», «معقم», «شرائح» and «دجاج», and a browser run of them found what the
pack says.

It holds ten questions for the owner: this ADR's five, and five that the session's staff
will meet:
- whether a moved or cleared source should keep its pars;
- whether a cut-off change should be scheduled ahead;
- whether a cut-off should be changed only at its facility;
- whether a branch should read the cut-offs and sources of facilities that supply it
  nothing, which goes beyond O5;
- where the module is switched on.

Three things are not shown, and the pack says which:
- **The day an order is for.** Its rule, `erp.order_day_for()`, is tested at stated moments
  in pgTAP 190, and `erp.order_day()` is raced against a cut-off change in `db:check`. An
  order keeping its day is module 10's to build, and nothing evidences it yet.
- **A request naming another brand's facility as a source.** pgTAP 190 refuses it; the test
  data has no such facility to offer.
- **The races,** held in `db:check`.

**Found writing it, and in its review, fixed before it:**
- **A par page that contradicted itself.** With a par page open, the item's source moved to
  another facility, and Set was refused in the right words. The page went on saying
  "Supplied by" the facility it had read, offering the form, under the earlier "Saved.". A
  par write refused because the item's source moved or was cleared (`sourceMoved`:
  `par_level_not_its_source`, `par_level_item_has_no_source`) now reads the item again. The
  page keeps the refusal and says where the par is set now.
- **A "Saved." above a later refusal.** A refused attempt left the previous write's
  "Saved." at the top of the page. On module 9's three pages, the word on a write is now
  cleared when the next is sent, by a hook on the shared write lifecycle (write.ts,
  `PageHooks.started`, held by `write.test.ts`). The forms that check a value before
  sending call the same hook first, and each page's own load clears it when another record
  opens. `ordering-setup.test.ts` holds those two.
- **A form in doubt lost to the page's other form.** A write on the other form, or a
  refusal that reads the page again, unmounted the form whose request was in doubt, and its
  Start over with it. A form whose request is out or in doubt now holds the page's other
  form until it is answered or settled (`PageHooks`, `doubt` and `held`). Held only once in
  doubt, the other form could still be used while the request was out (found in the third
  review, by the real screens bundled and driven in a browser).
- **The Arabic named the organisation with a word the picker never shows.** Module 9's
  sentences said «على مستوى المنظمة». The facility picker offers «المؤسسة كاملة», and INV-P07's
  Arabic says «على مستوى المؤسسة». Every Arabic string now says «المؤسسة», module 4's one
  refusal that used the other word included. A Node test holds every Arabic string to it,
  on the word's root (`logic.test.ts`).
- **A built console for the network cut.** Served by Vite's development server, the page
  reloads itself when the network returns, and loses the change in doubt and its Retry. This
  pack and the two before it whose cut is followed by Retry (stock alerts, purchase orders)
  now serve the console as a built page. So does the notifications pack, where a console is
  opened from another computer, since a reload there loses where the participant works.
  Five earlier packs also cut the network, and do not yet say where the console runs.
- **req-lint read the test data's facility codes (BR-001, WH-001, FA-001) as requirement
  citations.** The pack quotes screens that name a facility by its code alone. No
  requirement module uses those prefixes, so they join req-lint's list of look-alikes.

**Put to the owner, not changed here:**
- **A search finds Arabic only as it is stored.** Neither «ارز» nor «الأرز» finds «أرز بسمتي»,
  in every module's search, the database's and the console's (Q-27).
- **Every other module's detail pages** keep a page's word on a write until the next one
  succeeds: above a later refusal, and on another record of the same kind opened by an
  address typed or pasted (Q-28).
