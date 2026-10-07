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


## Addendum — 2026-10-07: the data layer (module 7, step 2)

0022's four routes are reachable over HTTP through one edge function, `stock-alerts`
(`supabase/functions/_shared/stock-alerts.ts`), built as `stock` is (ADR-0029's step 2
addendum). Nothing about the routes changed.

- **The routes:**
  - `GET /` lists every item with a minimum at the query's `facility_id`, by code, 100 a
    page unless `limit` asks for 1 to 500; `low=true` lists the low ones alone. A full
    page answers `next_after`, the last code, and the next page sends it back as `after`.
  - `GET /items/{item_id}` gives one item's decisions there, newest first, paged by a
    `seq` sent as decimal text, as a stock card is.
  - `POST /minimums` sets a minimum: `decision_id`, `facility_id`, `item_unit_id`,
    `quantity`, `expected_decision_id` and `reason`.
  - `POST /items/{item_id}/clear` clears one: `decision_id`, `facility_id`,
    `expected_decision_id` and `reason`. The item is named in the path, so a body cannot
    name another.
- **The actor is the session's,** through `withSession` (ADR-0025); a Node control test
  forges it in every way a body or header could, on both writes.
- **The edge checks shape, the database checks rules.** Two shape rules are this
  module's own:
  - **A quantity is decimal text,** as stock's is: "2.5", never the number 2.5. That it
    is more than nothing, exact in the base unit and within range is 0022's to refuse.
  - **The stamp is stated.** A set must carry `expected_decision_id`: the stamp of the
    decision in force, which the item's history marks, or `null` when the item has
    **never** had a minimum there. A cleared minimum keeps its row and its stamp (§2), so
    it is set again against the decision that cleared it; `null` there is stale, and the
    list, which leaves cleared items out, does not carry that stamp (found in review).
    Left out or empty, the stamp is a 400, never read as "none", since a form that never
    read the minimum must not pass for one that read its absence. A clear carries a stamp,
    always; an item that never had a minimum can only answer stale, so the console offers
    Clear only on a listed one.
- **Refusals** map through `_shared/refusal.ts`, which now knows
  `stock_minimum_decision_pkey`: raised by 0022's retry check it is `already_recorded`
  (409), and the console confirms the retry by finding the decision in the item's
  history at the same facility, paging back as it must. 0022 checks an id against every
  facility and item, so an id the history does not hold was used for another: a
  collision, never a retry. Raised natively it is a conflict. `stock_minimum_stale` is `stale` (409).
  The rest are 0022's own words: `refused` for an unchanged minimum, one not set, a
  retired pack or item, a branch or a closed facility; `invalid` for none, an inexact
  quantity or no reason; `not_found` for another brand's pack or item.
- **The bell needs nothing new:** the notifications function passes each item through as
  0022's page gives it, and a low-stock item carries its `minimum`.
- **Tested** by `_shared/test/stock-alerts.test.ts` (Node: the actor, every shape rule,
  every refusal, paging) and `_deno/test/stock-alerts.test.ts` (Deno, end to end, as
  `erp_edge`, rolled back): the warehouse manager raises chicken's minimum in cartons,
  retries, is refused a stale and an unchanged one; sets rice's again from the decision
  that cleared it, after `null` is refused as stale; sees an id used at the factory
  answered as recorded and absent from the history; wastes past it **through the stock
  function**, and both they and the administrator read the low-stock notification
  **through the notifications function**, at the balance left and the minimum crossed;
  a second waste while low rings nothing; then clears it. A cashier reads and sets none.

## Addendum — 2026-10-07: the screens (module 7, step 3)

The console reads and changes minimums through the `stock-alerts` function, at the
warehouse or factory being worked at, as the stock screens do (ADR-0029's step 3
addendum). Nothing about the routes changed.

- **The entry, "Stock alerts",** sits under Inventory beside Current stock. It is shown
  only to someone who may read stock alerts, stock and items where none is hidden, since
  the list asks all three (navigation.ts, `alsoReads`). A branch or an office is told, as
  on the stock screens, that it holds no stock record.
- **The list (`#stock_alerts`)** lists the low ones alone by default (A2): each item's
  minimum in its base unit and as entered, beside what is on hand, marked Low. Unticking
  "Low only" lists every minimum, by code. Where the person may set minimums, an item is found by code or name, among
  active ones only, and opened.
- **An item's page (`#stock_alerts/items/{id}`)** shows what is on hand, the minimum in
  force as entered, and every decision about it, newest first. Set and Clear are offered
  where 0022 would accept them: at a warehouse or factory that is not closed, to someone
  holding write on stock alerts there. Set is offered for an active item only; Clear only
  while a minimum is in force.
- **The stamp is the history's,** never the list's (stock-alerts.ts, `stampOf`): the
  decision in force, a clearing included, or none when the item never had a minimum
  there. A cleared minimum is set again against its clearing, which the browser run
  shows.
- **A minimum is the decimal text typed,** checked by 0022's own pattern, and more than
  nothing; none is cleared. Arabic-Indic digits and the Arabic decimal separator are read.
- **Writes go through the shared lifecycle** (write.ts): built once when the button is
  pressed, retried as first sent, `already_recorded` shown as saved, and a stale answer
  shown as a change someone else made, with the page reloaded. After any answer the forms
  are withdrawn until the page has read what the write left, since their stamp would be the
  one before it, and an older page of the history asked before that reload is dropped
  (found in review).
- **A low-stock notification opens the stock decision** that took the item across, as a
  below-zero one does, not the low-stock list 0022's comment names. Its recipients may
  read stock and items there, which the decision asks; the list is a menu entry away.
- **The bell** words the second kind ("Stock fell to its minimum at" and the facility's code) and shows the
  minimum each item crossed beside the balance left. It opens the stock decision, as a
  below-zero notification does.
- **The stock card** links to the item's minimum, for someone who may read it.
- **Tested** by `apps/console/test/stock-alerts.test.ts` (Node) against the migration's own
  pattern, kinds, gates and constraints, and by a browser run against the scratch database
  and edge. In that run the warehouse manager:
  - reads the low list, then every minimum;
  - raises chicken's minimum to 12 cartons;
  - is refused a minimum of none before sending;
  - is told by the bell when a waste takes chicken past it, and opens the waste;
  - clears chicken's minimum, and sets the seed's cleared rice again.

  The page is also read in Arabic, right to left; the factory manager sees the factory's
  two low items; and the accountant has no entry.
