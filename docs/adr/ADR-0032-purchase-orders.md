# ADR-0032 — Purchase orders and receipts: one order per receiving facility, approved above a limit by someone else, received through the stock ledger

- **Status:** Proposed. Built as module 8's database layer on 2026-10-07. The owner
  decided P1 to P4 (§1) the same day; the questions below are decided before the module
  is switched on
- **Date:** 2026-10-07
- **Requirements:** PRC-P01 · PRC-P02 · INV-P04 · PRC-001 · PRC-002 · PRC-004 · PRC-006 ·
  INV-006 · INV-007 · SEC-004 · IAM-005 · MFG-012 · CAP-P02 · CAP-P04 · PRG-014
- **Related:** ADR-0012 · ADR-0024 · ADR-0026 · ADR-0027 · ADR-0029 · invariants I-6, I-7,
  I-8 · `supabase/migrations/20261007000400_purchase_orders.sql` ·
  [`../estate/process-mapping-purchase-orders.md`](../estate/process-mapping-purchase-orders.md)

## Context

The warehouse system kept two families of purchase order, one per destination: warehouse
items to the one warehouse, raw materials to the one factory. The process mapping sets out
what it did in full. What matters here:

- **Two families for one thing.** They existed because the warehouse had two item masters.
  The ERP has one (ADR-0024), a supplier sells conversions (ADR-0026), and stock is held
  per facility (ADR-0029).
- **Money as numeric(12,2)** with no currency, one VAT rate per order, 15% in the form.
- **Approval** by the general manager above a limit per family, compared **including** a VAT
  rate the buyer could edit on raw-material orders, so setting it to 0 could bring an order
  under the limit. An auto-approval recorded no approver, and an administrator could approve
  an order they had raised.
- **Receiving** added to a counter, could not be undone, was dated `now()`, and had no
  retry protection: a retried receipt posted again while quantity remained.
- **Lines cascaded** from their order, and a deleted item's line was nulled (B-11).

PRC-001 to PRC-004 and PRC-006 are F3 in the PRD; ADR-0021 brought purchasing forward with
the consolidation. Invoice matching (PRC-007), payables and payments (FIN-009) are frozen
(CLAUDE.md §6) and stay in modules 21 and 22.

## Decision

### 1. The owner's four decisions (2026-10-07)

- **P1 — One order, one receiving facility.** An order names a supplier and the one
  warehouse or factory it is delivered to. Its lines are packs of any item kind the supplier
  supplies. Who may raise one is a permission at that facility.
- **P2 — A price as a commitment.** Each line holds a price per pack in halalas, typed by
  the buyer, and the order one VAT rate. Nothing matches an invoice, pays, posts a journal
  or values stock: those stay in the frozen modules 21 and 22, and costing in module 16.
- **P3 — Approval above a limit, never one's own.** Above a limit set per facility, compared
  **before VAT**, an order waits for someone holding approve there. At or below it, it is
  approved when raised, recorded as approved by the limit in force. Nobody approves or
  rejects an order they raised (PRC-004). One level; PRC-003's chain stays F3.
- **P4 — A receipt is reversed as stock is:** whole, once, with a reason, refused once a
  count has covered it (ADR-0029 §5). The stock goes back out and the order's lines reopen.

### 2. An order is a log, its lines a record, its state a projection

- **`erp.purchase_order_decision`** is append-only: raised — carrying the order whole:
  supplier, number, business day, VAT rate and amounts — then approved, rejected, cancelled
  or closed, each with who, when and why. Its shape is checked: a raise is pending, or
  approved and naming the limit decision that approved it, at the same facility.
- **`erp.purchase_order_line`** is the order's lines, written once with the raise. Each
  names the supply it orders and that supply's conversion, copied whole under 0012's
  composite key (I-7), so a line goes on meaning the pack ordered. A line's amount is its
  quantity times its price, rounded half away from zero to the halala.
- **`erp.purchase_order`** holds what the raise recorded, fixed for good, and the state its
  latest decision put in force, stamped with it (I-8). Its state moves only forward:
  pending to approved, rejected or cancelled; approved to cancelled or closed. Triggers
  refuse any other change, deleting and truncating, binding the owner too.
- **What has arrived is never stored.** An order line's received quantity is the sum of
  its receipts not reversed, so a reversal reopens the order by being recorded, and nothing
  can drift.

### 3. Numbering and the business day

An order is numbered by its facility and business day: the facility's code, `-PO-`, the day as `YYYYMMDD` and a four-digit place, one
series per facility per day, the next number taken under a lock per facility so two orders
raised at once take consecutive numbers (db:check races it). Taken inside the raising
transaction, a number is never burned. The business day is the calendar date, in the
facility's time zone, of the moment the order is raised: Q-22's answer for stock movements
(ADR-0029 D3), taken as the default the question asked to be confirmed (question 4).

### 4. The approval limit

`erp.purchase_limit_decision` and `erp.purchase_limit` are a log and its projection, per
facility, as 0022's minimums are: set or cleared, with who, when and why, against the stamp
the person read. A limit is more than nothing; to have none, so that every order waits,
it is cleared. It is its own capability, **`procurement.purchase_limits`**, because whoever
approves orders must not be able to raise the limit that approves without them. **A limit
does not approve an order raised by the person who set it** (found in review): whoever holds
both, as a real database's administrator does, would otherwise set a limit and raise within
it, approving their own order. Such an order waits for an approver.

### 5. Four order routes and two limit routes

Every route is scoped to the order's facility and asks the reads `erp.get_purchase_order()`
asks — orders, suppliers and items — so whoever writes can read back a retry. Each answers
a retry first, on its log's primary key.

- **`erp.raise_purchase_order()`** asks write on orders. The facility is open and holds
  stock. The supplier is active, under its share lock (`erp.assert_supplier_active()`).
  Each line's pack is found through the facility's brand, so another brand's answers as a
  missing one (ADR-0012). The item, its pack and the supply are active, each read under its
  share lock, so a retirement meanwhile waits and is seen. A supply's retirement takes its
  supplier's row for update first, which the raise already holds under its share lock, so
  the two serialise there; the supply's own share lock is a second fence (db:check races
  it, and fails with both removed). A
  quantity is decimal text; a price is a JSON number of whole halalas, never text; a line
  carries its pack, quantity and price and nothing else. The limit in force is read under
  its share lock, then the number taken.
- **`erp.decide_purchase_order()`** approves or rejects (asking approve) or cancels or
  closes (asking write). It locks the order. Approving or rejecting needs a pending order
  and someone other than whoever raised it. Cancelling needs nothing received; closing
  needs something received and something still to come; once every receipt is reversed, an
  order is cancelled again. Only approving is new work, so only it waits on the facility
  being open and asks that the supplier is still active (found in review): approving
  commits the company to buy from it.
- **`erp.receive_purchase_order()`** asks write on orders **and on stock**, since it moves
  stock. It locks the order, then posts through 0020's `erp.post_stock()` as a stock
  decision of kind **receipt**, so D1 to D4 hold for it unchanged: the facility's calendar
  date, a stated moment when entered late, never at or before a count, the balance lock.
  Lines are `{line_no, quantity}`, in the order line's own pack, never more than is still
  to come, read under the order's lock (db:check races two). Goods are received after the
  order was raised. `erp.purchase_receipt` and its lines bind each receipt line by key to
  the ledger line it posted and to the order line it fills, and the receipt names the
  order's decision in force when it arrived, read under the order's lock, so db-check can
  hold that every receipt arrived while its order was approved. Its stock reason is fixed,
  "Received against a purchase order", and names no order: a stock reader need not read
  orders; the order and the delivery note are on the receipt.
- **`erp.reverse_purchase_receipt()`** asks the same, locks the order, and posts 0020's
  reversal. A closed order's receipt is reversed too, and the order stays closed, so a
  closed order can come to show nothing received, which the close route would not make.
- **`erp.set_purchase_limit()` and `erp.clear_purchase_limit()`** ask write on limits.

Lock order is the decision id's lock, the order's row, then the seam's locks, on every path,
so none deadlocks.

### 6. 0020's seam, widened

The receipt is the kind 0020 named to come (I-10). `stock_decision`'s kind check gains it,
and the ledger a check that a receipt is inward. `erp.post_stock()` is replaced whole with
two changes: a receipt's lines are inward, and a receipt may be reversed.
`erp.reverse_stock_decision()` is replaced to refuse a receipt: it is reversed through its
order, which asks purchasing's permission too and keeps the order's knowledge true. It asks
again after the seam has read its target, so a receipt that committed while it waited is
refused too (found in review).

### 7. Three reads

`erp.purchase_orders()` lists one facility's orders, newest first, optionally in one state,
each with how much has arrived: none, part or all. `erp.get_purchase_order()` gives one
order whole: its lines with what each has received and has still to come, every decision,
and every receipt with who reversed it and when — not the reversal's reason, which is
stock's, for readers of stock. `erp.purchase_limit_history()` gives a facility's
limits, newest first, marking the one in force. Each names one facility, as stock's do.

### 8. Hidden, as every module ships

Both capabilities are registered with no decision, so hidden in every real database. The
administrator holds read, write and approve on orders and read and write on limits. A real
database with one administrator therefore needs a second person holding approve, or a
limit, before any order above nothing is approved (question 1). The synthetic seed opens
both at pilot; the warehouse manager raises and receives everywhere, the factory manager at
the factory alone, and the accountant approves, since the test data has no general manager
and adding one would change who every stock bell rings for.

### 9. Kept out, deliberately

- **Invoices, matching, payment, journal postings and costing** (P2, CLAUDE.md §6).
- **Editing an order.** A pending order is cancelled and raised again (question 2).
- **On hold**, which the warehouse had for raw materials (question 3).
- **Over-receipt tolerance, rejected quantities, batch and expiry** (PRC-006; question 6).
- **Receiving in another pack** of the same item (question 7).
- **Notifications.** None is raised yet (question 8).
- **The daily sheet's cash purchases,** which the warehouse kept as orders that skipped
  approval: module 15's (question 9).
- **Branches.** A branch holds no stock record until Q-06 is answered, so nothing is
  delivered to one.

## Questions for the owner

1. **Who raises, approves and receives orders, and who sets limits, in a real database?**
   The seed's answer is the managers where they hold stock, and an approver who raises
   nothing. With only the administrator, nobody can approve their orders, by hand or by a
   limit they set. Orders split to stay under a limit are not caught: should they be?
2. **Should a pending order be editable,** against the stamp read, or is cancelling and
   raising again enough? The warehouse let raw-material orders be edited, warehouse orders
   never.
3. **Is "on hold" needed** beside pending, approved and rejected?
4. **Is an order's business day the date it is raised at its facility,** as for stock?
5. **Is the number right:** the facility's code, the day, and a series per facility per day?
6. **May a receipt exceed what was ordered,** by a tolerance, and should rejected quantities
   be recorded with a reason (PRC-006)?
7. **May goods arrive in another pack** than the one ordered?
8. **Who is told,** and of what: an order waiting for approval, a decision, a receipt?
9. **Where do the daily sheet's cash purchases go?** The default is module 15, as receipts
   with no order.
10. **Should a receipt dated before its order was raised be refused,** as it is now? And one
    dated before the order was approved, which is taken now: goods sometimes arrive on a
    phoned approval before it is recorded.

## Consequences

- **One kind of order** serves the warehouse and the factory, for any item kind.
- **Approval cannot be dodged** by the VAT rate, and is always someone else's, or a limit
  someone else set, recorded either way.
- **A receipt is a stock movement,** so everything stock guarantees holds for it, and the
  stock card shows it.
- **A mistaken receipt is undone,** whole, and the order knows.
- **Prices are commitments,** in halalas, ready for modules 21 and 22 to match when the
  freeze lifts, and used by nothing else.
- **0023 replaces two of 0020's functions** with `create or replace`; 0020 is unchanged.
  The console's stock screens name each kind from 0020's list, so they show a receipt by
  its raw kind until step 3 adds its label.
- **The edge function, screens and staff testing follow,** as for every module.

## Addendum — 2026-10-07: the data layer (module 8, step 2)

0023's nine runtime routes are reachable over HTTP through one edge function,
`purchase-orders` (`supabase/functions/_shared/purchase-orders.ts`), built as `stock` and
`stock-alerts` are (ADR-0029's and ADR-0031's step 2 addenda). Nothing about the routes
changed.

- **The routes:**
  - `GET /` lists one facility's orders, newest first, paged by the raise's `seq` sent as
    decimal text, 100 a page unless `limit` asks for 1 to 500; `state` narrows to one.
  - `GET /{purchase_order_id}` gives one order whole, at the query's `facility_id`.
  - `GET /limits` gives a facility's limits, newest first, paged the same way.
  - `POST /` raises an order: `decision_id`, `purchase_order_id`, `facility_id`,
    `supplier_id`, `vat_rate_bp`, `lines` and `reason`.
  - `POST /{purchase_order_id}/approve`, `/reject`, `/cancel` and `/close` decide one:
    `decision_id`, `facility_id` and `reason`. **The decision is the path:** no body names
    a kind, so none can name another.
  - `POST /{purchase_order_id}/receipts` receives against one: `decision_id`, `facility_id`,
    `received_at` (with its offset, or absent for now), `lines` and an optional
    `delivery_note`.
  - `POST /receipts/{receipt_id}/reverse` reverses a receipt: `decision_id`, `facility_id`,
    `reason` and an optional `override_reason`.
  - `POST /limits` sets a facility's limit — `limit_minor`, `currency` and
    `expected_decision_id`, present and null only where the facility never had one, as a
    minimum's stamp is (ADR-0031's step 2 addendum) — and `POST /limits/clear` clears it,
    against a stamp always.
- **Two kinds of number, kept apart.** A quantity is decimal text, both ways, as stock's
  are. An amount — a price per pack, a limit — and a VAT rate are JSON whole numbers, both
  ways, as transfer prices' are; the driver turns 0023's bigints into numbers through
  `withMinor()`, which refuses anything not a safe integer.
- **A line carries on only what it is:** an order line its `item_unit_id`, `quantity` and
  `price_minor`; a receipt line its `line_no`, a whole number, and `quantity`. Anything
  else on a line is dropped, so no receipt line can name a pack: it arrives in the one
  ordered.
- **An order or a receipt is a document** of up to 200 lines, read up to 64 KiB; a
  decision, a reversal and a limit are forms, up to 8 KiB.
- **Retries.** `purchase_order_decision_pkey` and `purchase_limit_decision_pkey` join the
  logs whose route-raised 23505 is answered 409 `already_recorded`; a receipt and a
  reversal answer on `stock_decision_pkey`, as stock's do. The console confirms a raise, a
  decision, a receipt or a reversal through the order at the same facility, and a limit
  through the facility's limit history. The same order id under a new decision is 409
  `conflict` (`purchase_order_raised_once`), and `purchase_limit_stale` is 409 `stale`.
- **Tested** by the Node suite (`_shared/test/purchase-orders.test.ts`): the actor on every
  write, the kind from the path, the lines' fields, amounts and quantities, every route's
  shape, and each refusal's answer; and end to end by the Deno test
  (`_deno/test/purchase-orders.test.ts`): the seeded orders, a raise approved by the limit
  and its retry, self-approval refused and the accountant approving, a receipt moving
  stock, the stock route refusing to reverse it and the order's route reversing it, cancel,
  close and reject, and limits set and cleared by the administrator alone.

## Addendum — 2026-10-07: the screens (module 8, step 3)

The console reads and changes orders through the `purchase-orders` function, at the
warehouse or factory being worked at, as the stock screens do (ADR-0029's step 3
addendum).

- **The entry, "Purchase orders",** sits under Purchasing beside Suppliers. It is shown
  only to someone who may read orders, suppliers and items where none is hidden, since
  every order read asks all three (navigation.ts, `alsoReads`). Organisation-wide, or at a
  branch or an office, the page says that orders go to a warehouse or a factory.
- **What is offered is 0023's gates, read at the facility** (purchase-orders.ts,
  `purchaseRights`): raise, cancel and close to someone holding write on orders; approve
  and reject to someone holding approve; receive and reverse a receipt to someone holding
  write on orders and on stock, since a receipt moves stock; the limit to someone holding
  read, and set and clear to someone holding write, on limits. Nothing is offered in a
  preview, or where the capability admits no new work.
- **The list (`#purchase_orders`)** gives the facility's orders newest first, one state
  alone on asking, each with its supplier, what has arrived and its total.
- **A new order (`#purchase_orders/new`)** is one active supplier, found by code or name,
  and up to 200 lines of what it sells now: the supply, its pack and its item all current.
  Each line is a pack, a quantity typed as decimal text and a price per pack typed in
  riyals; the VAT rate is typed as a percentage, 15 to start. **The figures shown before
  sending are 0023's**: each line's amount and the VAT are worked out in BigInt from the
  text typed, rounded half up as 0023's `round()` does, so the total the person checks is
  the one the order will carry. A repeated pack, a bad quantity or price, a rate past 100%
  and a line or order past 0023's caps are named before sending. The order's id is minted
  with its decision (I-1); a lost answer is retried as first sent, and Start over looks
  for the order before minting new ids, as a stock entry does.
- **An order's page (`#purchase_orders/{id}`)** shows its lines with what has arrived and
  what is still to come, every receipt, and every decision. The decisions offered are the
  ones 0023 would take (`orderActions`): approve and reject while pending, and **never on
  an order the person raised (PRC-004)** — they are told someone else decides it, and may
  cancel it; cancel while nothing has arrived; close short once part has; receive while
  approved and not in full. A facility known to be closed is offered no approval or
  receipt. Each decision is its own path, built once and retried as sent (write.ts).
- **A receipt** is a quantity per open line in the pack ordered, blank where none came,
  never more than is still to come (compared as decimal text, not as floats), a moment —
  now or stated, as a stock entry's — and an optional delivery note. **A receipt is
  reversed from its order only**: on the stock card it reads "Receipt", and the stock
  decision's page offers no reversal (0023: `stock_receipt_reversed_through_its_order`).
  The override (D1) is offered on a reversal to those who hold it, as on stock.
- **The limit (`#purchase_limits`)** is its own entry, "Approval limit", under Purchasing,
  since 0023's limit read asks read on limits alone: someone who sets limits need not read
  orders (found in review). It shows the one in force, before VAT, and every decision about
  it; it is set and cleared against the history's stamp, a clearing included, as a minimum
  is (ADR-0031's step 3 addendum), in riyals up to 0023's 100,000,000,000.00, past a
  price's ten digits (found in review).
- **Every 0023 refusal a person can meet is worded** in both languages (messages.ts); the
  retry keys are not, since PostgreSQL's own collision is no "already saved".
- **Tested** by `apps/console/test/purchase-orders.test.ts` (Node) against the migration's
  own states, kinds, gates, rounding and constraints, and by a browser run against the
  scratch database and edge. In that run:
  - the warehouse manager reads the list and raises an order within the limit, approved
    when raised, and one over it, which waits, with no approval offered;
  - a repeated pack and a VAT rate past 100% are named before sending;
  - the accountant approves the large order, and rejects the seed's pending one;
  - the manager receives ten cartons (stock rises 100 kg), is refused more than is to
    come before sending, reverses the receipt from the order (stock falls back), receives
    again and closes the order short;
  - the administrator raises the limit and clears it, then raises an order of their own,
    which waits and offers them no approval;
  - the list and an order are read in Arabic, right to left; the cashier has no entry.

**Found in review of step 2, fixed here:** a VAT rate past a 32-bit integer is now a 400
naming `vat_rate_bp`, not PostgreSQL's cast failure; a delivery note is bounded for size
at the edge and held to 64 characters by 0023 after trimming, as 0023 measures it; the
Node suite sends a 200-line receipt past a form's 8 KiB and a document past 64 KiB; and the
Deno test retries an approval, a receipt, a reversal, a limit and its clearing, each
answered `already_recorded` and confirmed through the reads, and holds a business date to
text.

## Addendum — 2026-10-07: the staff testing pack (module 8, step 5)

[`docs/lab/uat/purchase-orders.md`](../lab/uat/purchase-orders.md), with its Arabic version
in [`ar/`](../lab/uat/ar/purchase-orders.md), is run by whoever orders and receives the
warehouse's stock, with the accountant, the administrator, the factory manager and a
cashier on a second computer. It evidences PRC-P01, PRC-P02 and INV-P04, which now name it.
In thirteen parts it covers:
- the orders at the warehouse;
- raising one within the limit and one over it, and what is named before sending;
- the accountant approving and rejecting;
- receiving, refusing more than is still to come, and reversing a receipt from its order;
- an order received in full, one closed short, and one cancelled;
- the administrator's limit, and their own order, which waits although it is within it;
- a lost answer retried;
- the factory manager and a cashier;
- the other language.

**Every figure in it was run first in a browser** against the scratch database and edge,
as the session scripts it: stock rising and falling by each receipt and reversal, every
total before and after sending, and each order's number in the day's series. The script
checks every "Passes when" the screens can show, 51 checks, and passes clean. A first
draft said a rejection's history showed the accountant by a short code, where it shows
their own name to them, and left out choosing the warehouse after signing in afresh: the
script had not checked either, and now checks both (found in review).

It holds thirteen questions for the owner to answer before the session: this ADR's ten,
and three that the session's staff will meet:
- whether an order received in full should close itself;
- whether a receipt on an order closed short may still be reversed;
- where the module is switched on.

Three clauses are left to the database's tests, and the pack says which: a reversal after
a count, and the two races.

**Found in review of step 3, fixed before it:**
- **A lost receipt answer.** Start over on a sub-form now reads the record and says
  "already saved" when the record holds the lost request's id (write.ts, `recorded`). A
  receipt recorded under a lost answer looked like any other, so the same goods could be
  received twice. Decisions, reversals and limits work the same way.
- **What is no longer offered.** Approve is not offered while the order's supplier has
  stopped. A receipt's reversal is not offered at a closed facility. Both are refusals
  0023 makes, and the supplier's is now worded.
- **A facility switch is not covered.** Switching facility, or leaving the page, unmounts a
  form in doubt, as every full-page form in the console does, and its request is lost: the
  leave prompt is all that stands between the person and raising it twice. A first fix
  looked up the order at the facility the request went to, but the form never survives
  the switch to make that lookup (found in review, Codex), so it was taken out. Keeping an
  in-doubt request across navigation is a console-wide change, put to the owner as Q-26.
- **Checks before sending.** A price past 0023's cap per pack is caught before sending,
  and the Arabic percent sign is read.
- **Saying what was saved.** A decision's and a reversal's Start over say "this decision" or
  "this reversal was already saved", not the receipt's or the order's words; and a record of
  an unexpected shape is read as "not there", so the form resets under new ids rather than
  unlocking the used one (found in review).

## Addendum — 2026-10-07: the switch-on, drafted and held (module 8, step 6)

**Not on `main`.** The migration was drafted in pull request #63, which the owner closed
for now (2026-10-07); it is kept there, at commit `4ba55a5`, and comes back as a new pull
request once the preconditions below hold.

The migration, `20261007000500_purchase_orders_pilot_at_central_warehouse.sql`, records two
capability decisions: `procurement.purchase_orders` and `procurement.purchase_limits`, each
at `pilot` at the central warehouse, and nowhere else. It is drafted and held unmerged, as
modules 5's, 6's and 7's were (closed pull requests #48, #53 and #58).

**What it opens.** Organisation-wide both stay hidden: 0023 registers them with no state,
and no state reads as hidden. `capability_state_for()` reads a facility's own state before
the organisation's, so Purchase orders and Approval limit show only to a person working at
the warehouse, and every route refuses anywhere else. The factory, where P1 also lets
orders go, stays shut because nothing is recorded there; opening stock at the factory later
would not open purchase orders.

**It finds the warehouse by its code when applied,** as the other three do. Where none has
that code, which is every local rebuild, it records nothing and warns, and the seed opens
both for the suites (0030, c011 and c012). A code naming anything but an open warehouse is
an error. **Two gaps module 7's review found are closed here:**
- a state already recorded at the warehouse for either capability is refused in words,
  where module 7's draft failed on the state row's key, unexplained;
- the warehouse's existence is a precondition of its own (6, below), since a migration that
  warns and records nothing still counts as applied.

All of it was run on a scratch database:
- **The rebuild** warned and recorded nothing.
- **Applied after the seed,** with both capabilities first decided hidden
  organisation-wide, as a real database has them: both read `pilot` at the warehouse, and
  `hidden` at the factory and organisation-wide.
- **The administrator** listed orders and read the limit at the warehouse, and raised an
  order there. Each was refused at the factory, the raise as admitting no new work.
- **Applied a second time,** it was refused, naming both states.
- **Pointed at the factory,** it was refused.
- `db:check` and `db:fixtures` pass with it in place.

**It is held** until six things hold, named in the migration's header:
1. the purchase-orders pack is signed by staff;
2. operations has signed off the process mapping (MFG-012; Q-23 leaves the sign-off to
   the merging PR);
3. items and suppliers are switched on organisation-wide, then stock at the same warehouse
   (module 5's held switch-on). Every order route asks read on suppliers and items, and a
   receipt write on stock, so opened alone purchase orders would answer nobody. Module 5's
   held file is dated before 0023, and this one after it: when it comes back it takes a
   fresh timestamp, and this one a later one still (Q-23). The bell is not needed: nothing
   about an order rings it;
4. the owner has answered the pack's thirteen questions, A and M among them, and Q-26. A
   real database grants orders and limits to the administrator alone (0023), and nobody
   approves an order they raised, by hand or by a limit they set: with the administrator
   alone, every order waits for ever. A second person who may approve, and orders for the
   warehouse manager, are permission changes, owner-approved and made on their own, before
   this;
5. the real warehouse code replaces the synthetic seed's;
6. the warehouse exists where it is applied. Check that the warning is absent.
