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
- **A par had no unit and no owner.** One number per branch and item, implicitly in the
  sale unit, which the ERP calls the base unit. Every signed-in user could read every
  branch's. A manager could set any branch's par for their category's items. A par
  cascaded away with its item, and 0 was stored as a row apart from "no par".
- **Nothing kept who or why.** Cut-offs and pars were overwritten in place.
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
  time zone. No cut-off is a clearing, not a time.
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
- **A par is more than nothing.** In the warehouse a 0 only made New Order ask for the
  on-hand figure, which is module 10's `stock_level_required` now. To have no par, it is
  cleared.
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
  pars are set or cleared organisation-wide only.

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
   - A par: the branch is named, open and a branch. A branch of another brand than the
     facility the par is set from answers as a missing one. The pack is found through
     the branch's brand, so another brand's answers as missing too (ADR-0012). For a set,
     the item and the pack must be active: the pack is read again, and held, under the
     item's share lock (0022's finding; db:check races it).
3. **A par's source.** The item's source in force is read under the source's lock, taken
   shared. Every source decision about the item takes that lock exclusively. So a par
   waits for a source change in flight and is judged against what the change left, and a
   factory manager is never admitted by a source no longer in force (db:check races it).
   It is a lock, not a row lock, because an item with no source has no row to lock.
4. **The value.**
   - A cut-off crosses as `'HH:MM'` text, 00:00 to 23:59, matched by one pattern and
     never parsed loosely; empty is refused, never read as none.
   - A par is decimal text, up to twelve digits and six places, exact to six places in
     the base unit and under 10¹², as stock's and minimums' are.
5. **The stale check.** Each setting is locked: an advisory lock on what it is about, for
   a first setting that has no row yet, and then its row. Its stamp is compared with the
   one the person read, which is `null` only when it has never been set. Then a setting
   unchanged is refused, a par compared in the base unit, and so is clearing one that is
   not set.

### 6. The day an order is for: `erp.order_day()` (O3)

Module 10 dates its orders through a seam this module ships, granted to nobody, as
module 3 shipped `erp.transfer_price_at()`:

- **`erp.order_day(facility, at)`** answers the day an order to that supplying facility
  is for, and the cut-off decision that dated it. The day is the date at the facility, in
  its own time zone, at that moment, plus one when a cut-off is in force and the time
  there is at or after it. The decision is the one in force, a clearing included, or
  none when the facility has never had a cut-off.
- **Never a refusal.** An order after the cut-off is taken for tomorrow.
- **Module 10 copies both values onto the order when it is first placed** (I-7) and never
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
    cut-off as `'HH:MM'`, or none. At a branch, these are the cut-offs of the facilities
    that supply it.
  - Each has a history read, newest first, marking the decision in force. A cut-off's
    history is read at its own facility, as its routes are.
- **Pars** are read at their branch, by its staff for New Order, or at a facility that
  supplies it, for the items that facility supplies, or organisation-wide.
  - `erp.par_levels()` gives a branch's pars as entered and in the base unit, with each
    item's source.
  - `erp.par_level_history()` gives one item's decisions at a branch.
  - A branch's staff hold the read at their own branch alone, so they read no other
    branch's (IAM-006). Asking for another branch from their own is refused, as is
    reading a par from anywhere but its branch or a supplying facility.

### 8. Hidden, as every module ships

`ordering.setup` and `ordering.par_levels` are registered with no decision, so they are
hidden in every real database until a migration promotes them. The administrator reads
and writes both.

The synthetic seed opens both at pilot. It gives the two managers par write and the
setup read, each within their scope. Branch workers and the general manager read both.
The accountant holds nothing here.

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
- **A branch reads its own pars only,** and a manager sets only the pars of what their
  facility supplies.
- **An order's day is fixed by a recorded decision,** which module 10 copies, so a
  cut-off changed later never re-dates an order.
- **INV-015 is not met.** The suggestion uses no recorded stock, open transfers or lead
  time, because no branch holds a stock record. INV-014's system-suggested quantities are
  evidenced only once module 10 builds them.
- **db-check's branch rule still checks stock decisions only.** A par at a branch is
  allowed by design; `par-levels-match-their-decisions` requires that every par is at a
  branch.
- **The edge function, screens and staff testing follow,** as for every module.

## Questions for the owner

1. **Should a cut-off of 00:00 be allowed?** It makes every order next-day, as in the
   warehouse. To have none, the cut-off is cleared.
2. **A par of 0.** The warehouse stored 0 as a row apart from "no par", and it only made
   New Order ask for the on-hand figure. Here it is refused; is that right?
3. **Whose time zone dates an order:** the supplying facility's, as built, or the
   branch's? They cannot differ until a facility outside Riyadh exists.
4. **Can a warehouse ever supply two brands?** A source must be of the item's brand
   today, so it cannot be expressed.
5. **Who sets pars in a real database,** and who reads them? The seed's answer is the
   managers, each from the facility that supplies the item, and the branch's own staff
   reading.
