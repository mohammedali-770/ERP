# ADR-0031 — Stock alerts: a minimum per item at a facility, and the bell when stock falls to it

- **Status:** Proposed. Built as module 7's database layer on 2026-10-07. The owner
  decided A1 to A3 (§1) the same day; the questions below are decided before the module
  is switched on
- **Date:** 2026-10-07
- **Requirements:** INV-013 · INV-P03 · SUP-005 · SUP-007 · SUP-P01 · SUP-P04 · INV-008 ·
  CAP-P02 · CAP-P04 · PRG-014
- **Related:** ADR-0012 · ADR-0024 · ADR-0029 · ADR-0030 · invariants I-6, I-7, I-8 ·
  `supabase/migrations/20261007000200_stock_minimums.sql` ·
  [`../estate/process-mapping-stock-alerts.md`](../estate/process-mapping-stock-alerts.md)

## Context

The warehouse system kept a minimum for each kind of stock in its own column, set by the
administrator on the item form and overwritten in place. Three functions listed what
stood at or below its minimum, and a row trigger on each stock table rang the bell when a
value crossed it. The process mapping sets out what it did in full. Four things matter
here:

- **Three minimums for one thing.** Warehouse items, factory products and raw materials
  each had their own column, in their own unit. The ERP has one item master (ADR-0024)
  and one ledger per warehouse or factory (ADR-0029).
- **No record.** Nothing said who changed a minimum, when or why.
- **0 meant none,** and the form offered 0 by default.
- **"Once" depended on reading.** The bell rang on a crossing, as here, but skipped anyone
  who still had that item's alert unread. So a manager who had not read the last one was
  not told when stock went back above its minimum and fell again.

INV-013 asks for minimum, maximum, safety-stock and reorder values by location, in F3.

## Decision

### 1. The owner's three decisions (2026-10-07)

- **A1 — A minimum only,** per item per warehouse or factory. INV-013's maximum, safety
  stock and reorder values stay for F3.
- **A2 — Once per drop.** The bell rings when a movement takes a balance from above its
  minimum to at or below it, and again only after the balance has gone back above and
  falls again. Every item at or below its minimum is also always listed.
- **A3 — The actor is told too.** The person whose movement took stock low is told. A
  below-zero override still tells everyone but its actor (ADR-0030 §4).

### 2. A minimum is a decision

Every master in the ERP is a log and a projection (I-8), and so is this:

- **`erp.stock_minimum_decision`** is append-only. Each row sets or clears one item's
  minimum at one facility, with who, when and why. A minimum set records the pack it was
  entered in — its conversion copied whole, under a composite key to `erp.item_unit` as
  0012's seam lays out (I-7) — the quantity in that pack, and the base quantity.
- **`erp.stock_minimum`** holds the minimum in force per facility and item, stamped with
  the latest decision about it. A cleared minimum keeps its row, empty, so the stamp still
  names the decision that cleared it. Triggers keep a row on its facility and item and
  refuse deleting or truncating it, binding the owner too.
- **More than nothing.** In the warehouse a 0 meant none, and was offered by default; here
  it would ring for every empty shelf. To have no minimum, it is cleared.

### 3. Two write routes, at one facility

`erp.set_stock_minimum()` and `erp.clear_stock_minimum()` ask **write on stock alerts, at
the facility**, so a factory manager sets minimums at the factory alone (IAM-006). They
also ask the three reads `erp.stock_minimum_history()` asks — stock alerts, stock and
items — so whoever sets a minimum can read it back to confirm a retry (found in review).
Then, in order:

1. **A retry is answered as one:** the decision id, locked and checked first, answers
   23505 on `stock_minimum_decision_pkey`, as every log here does.
2. **The facility** is named, open (under its share lock, so a closure waits), and a
   warehouse or a factory. A branch holds no stock record until Q-06 is answered, so it
   holds no minimum either; both refusals are 0020's, in 0020's words.
3. **The pack** is found through the facility's brand, so another brand's answers as a
   missing one (ADR-0012). Setting a minimum is new work on the item, so the item and the
   pack must be active: the item through 0012's `erp.assert_item_active()`, under its share
   lock, and the pack read again under that lock and held. Read only before the wait, a
   pack retired meanwhile was taken as current (found in review; db:check races it).
   Clearing is not new work, so a retired item's minimum can be cleared.
4. **The quantity** is decimal text, up to twelve digits and six places, exact to six
   places in the base unit, as stock's are.
5. **The balance lock.** The route takes 0020's key lock for that facility and item, so a
   minimum and the movements of that item there are applied in one order: a movement is
   judged against the minimum before it or after it, never half of each.
6. **The stale check** compares the minimum's stamp with the one the person read, which
   is empty for an item that has never had one there. Then a minimum unchanged in the base
   unit is refused, as is clearing one that is not set.

### 4. Two reads

`erp.stock_minimums()` lists every item with a minimum at one facility, by code: its
minimum as entered and in the base unit, what is on hand, and whether it is low. It can
list the low ones alone. An item that has never moved there has none on hand, so a
minimum makes it low at once. `erp.stock_minimum_history()` gives one item's decisions
there, newest first, marking the one in force: the read an edit form starts from, and
the one the edge makes to confirm a retry.

Both show stock beside the minimum, so they ask **read on stock alerts, stock and
items**, at one named facility, with the facility's brand a second fence (ADR-0029 §8).

### 5. The bell's second kind (A2, A3)

0021's notification takes a second kind, `stock_low`, about a stock decision as the
first is. Its key — one per person per kind per decision — already holds for it.

- **Who is told:** every active person who may read stock alerts, stock and items at that
  facility, capability state and grant alike, asked when it is made and again whenever it
  is read (ADR-0030 §4). **The actor included** (A3). So SUP-P01's "the person who acted is
  not told" now holds for each kind unless its rule says otherwise, and this one's does.
- **What it holds:** each item the decision took across, the balance it left and the
  minimum it crossed, as ids and quantities. The bell's page names the items when it is
  read, and now passes the minimum on beside the balance.
- **The producer** is an ordinary AFTER UPDATE statement trigger on the balance, with both
  transition tables, for ADR-0030 §5's reasons: 0020's seam writes every balance a decision
  touches in one statement, so the trigger reads what that decision left, under the seam's
  lock. A crossing is a row whose old balance was above the minimum and whose new one is
  at or below it, with its stamp changed. Only an update can cross: a first posting
  inserts its balance from nothing, and nothing is never above a minimum.
- **"Once per drop" needs no state.** It is a fact about one posting. Nothing records
  that an alert is armed, so nothing can leave one stuck, and whether anybody read the
  last one does not matter.
- **Setting or raising a minimum rings nothing.** No stock moved. The item is listed low at
  once, and the next movement out does not ring either, since it does not cross.
- **Every kind of movement can cross:** a write-off, an adjustment out, a reversal of a
  movement in, a count that finds less. A movement that takes stock below zero by an
  override, past its minimum, raises both kinds: the override's to everyone but the actor,
  this one to everyone who may read alerts, the actor included.

### 6. Hidden, as every module ships

`inventory.stock_alerts` is registered with no decision, so it is hidden in every real
database until a migration promotes it. The administrator reads and sets minimums. The
synthetic seed opens it at pilot, and gives both managers read and write and the general
manager read, each within their scope. A branch worker, who reads stock at their branch,
holds nothing here.

### 7. Kept out, deliberately

- **INV-013's maximum, safety stock and reorder values** (A1), and anything that orders
  stock (module 9's par levels and module 10's branch orders come later).
- **A low-stock alert at a branch.** A branch holds no stock record until Q-06 is answered.
- **Ringing when a minimum is set above stock.** No stock moved; the list shows it.

## Consequences

- **Minimums are kept as stock is,** with a history and an actor, in the pack people
  think in.
- **The bell rings once per drop for everyone,** whatever they did with the last alert.
- **A person told can always open it:** the same three reads choose the recipient and
  gate the list it opens.
- **0022 changes three of 0021's functions** with `create or replace` — the rule of who
  may open a kind, the bell's page, and the below-zero producer — and widens two of its
  checks. 0021 itself is unchanged. The producer asked whether a decision had been told
  anything, and an `INSERT … ON CONFLICT DO UPDATE` fires its update triggers before its
  insert's. So an override that took a new item below zero and another item past its
  minimum wrote the low-stock notification first, and the below-zero one was never made
  (found in review). It now asks whether the decision was told it went below zero.
- **The edge function, screens and staff testing follow,** as for every module.

## Questions for the owner

1. **Who sets minimums in a real database,** and who reads them? The seed's answer is the
   managers where they hold stock, and the general manager reading.
2. **Who is told,** beyond those who read alerts? Today it is exactly them, at that
   facility.
3. **Should a count that finds stock below its minimum ring?** It does now. A count only
   finds what is there, but it is how a shortfall is often discovered.
4. **Should one notification name every item a decision took low,** or one per item? It
   names them all now, as the override's does.

