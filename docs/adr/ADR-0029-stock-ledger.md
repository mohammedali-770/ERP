# ADR-0029 — Stock: a ledger at each warehouse and factory, posted through one seam

- **Status:** Proposed. Built as module 5's database layer on 2026-10-05. The owner
  decided D1 to D4 (§1) the same day; the questions below are decided before the module
  is switched on
- **Date:** 2026-10-05
- **Requirements:** INV-003 · INV-006 · INV-007 · INV-008 · INV-009 · INV-P01 · INV-P02 ·
  MFG-012 · CAP-P02 · CAP-P04 · IAM-006
- **Related:** ADR-0005 · ADR-0012 · ADR-0024 · ADR-0027 · ADR-0028 · invariants I-1, I-6,
  I-7, I-8 · Q-06 · Q-22 · [`../domain/ledger-primitives.md`](../domain/ledger-primitives.md) ·
  `supabase/migrations/20261005000200_stock.sql` ·
  [`../estate/process-mapping-stock.md`](../estate/process-mapping-stock.md)

## Context

The warehouse kept stock as **counters**. Each warehouse item had a `warehouse_stock`
row, each factory item a `factory_stock` row, and the counter was changed in place. A
trigger wrote a `stock_movements` row as a side effect of each change, labelled from a
session setting the mover set beforehand. So the counter was the master and the movement
only a log of it. When the two disagreed, nothing said which was right.

The rest followed from that:

- **Stock could go negative,** and nothing said so. The daily factory sheet clamped what
  it showed at zero.
- **A count overwrote the counter** with what was found, against the stock as it was at
  the moment of saving. A movement recorded later but dated earlier was simply lost
  inside it.
- **The pack ratio was editable** under the stock it described, and warehouse stock was
  kept in sale units with purchase units derived.
- **A deleted user nulled the actor** of their movements (B-11), and deletes cascaded.
- **A retried request could post twice:** receipts and batches carried no idempotency key.
- **Stock had no location** below the warehouse or the factory.

The ERP's ledger primitives (`docs/domain/ledger-primitives.md`) say the opposite of most
of this: entries are never updated or deleted; an amount is positive with a direction;
every entry names its cause; stock is held in the item's stock unit; the negative-stock
check is made at posting; and a balance is the sum of its ledger, stamped (I-8).

## Decision

### 1. The owner's four decisions (2026-10-05)

- **D1 — Negative stock is refused, unless a person allowed to override records it, with
  a reason.** The balance then shows negative until a count settles it. Proposed as
  **INV-P02**: INV-008 asks for negative stock to be "prevented or explicitly
  controlled"; this is the control.
- **D2 — No second person approves an adjustment or a count.** Each is posted directly,
  and records who, when and why. This departs from INV-009's "approved variances", and is
  recorded as a departure for the next PRD revision, not as INV-009 delivered.
- **D3 — A movement's business day is the calendar date, in the facility's time zone, of
  the moment it happened.** A movement entered late states that moment, and is never
  dated at or before the item's last count. **This answers Q-22 for warehouse and factory
  stock only.** A branch's business day opens with its shift (Q-06), so no branch holds a
  stock record until that is decided (§8). Proposed as **INV-P01**.
- **D4 — Stock is held per facility and item.** Storage locations within a facility come
  later. INV-003 asks for location and stock status as well; both are open.

### 2. Four tables

- **`erp.stock_decision`** is the append-only log: one row per document, with its kind
  (count, adjustment, waste, damage, expiry, reversal), facility, the moment it happened
  and its business day, the actor, the reason, and an override reason when D1's override
  was used. The id is minted by the console (I-1), so a retry is recognised (ADR-0005).
- **`erp.stock_ledger`** holds the entries. Each is a positive quantity with a
  direction, in the conversion it was entered in, copied whole through 0012's seam (I-7),
  and its base quantity, which is what the balance sums. Each entry copies its decision's
  kind, facility, moment and business day, so a ledger query never joins for them.
- **`erp.stock_count_log`** holds what each count found, line by line, in the packs
  counted. It is kept apart from the ledger, because a count records what was found even
  where it matches the book; the ledger records only the difference.
- **`erp.stock_balance`** is the projection: one row per facility and item, with the
  quantity on hand in the base unit, the moment of the latest count, and a stamp naming
  the latest decision that touched it.

The rules a key or a check can hold are held by structure, so they bind the owner and the
seed as well as the routes:

- each entry and count line is bound to its decision's kind, facility, moment and
  business day by a composite foreign key;
- a reversal is bound to its target's facility and moment the same way;
- a balance's stamp names a decision at its own facility;
- a base quantity is the quantity times the factor;
- a waste, damage or expiry entry goes out;
- a count's variance is at factor 1.

Rules no key can state are held by `db:check`:

- each balance equals the sum of its entries;
- no decision took an item below zero without an override, and none recorded an override
  it did not need;
- business days follow D3;
- what a count posted is what it found less the book at its moment;
- a reversal mirrors its target whole;
- nothing is dated at or before an earlier count of the same item, and a count never
  shares a moment with a movement;
- a count's variance is in the item's base unit, once per item.

### 3. One posting seam

Every stock decision is written by `erp.post_stock()`, in this module and every later one:
receipts, issues, transfers and production will post through it too. It is owner-only.
The order of its work is the design:

1. **The retry check, first.** Every route also calls it straight after its gate, so a
   retry is answered 23505 on `stock_decision_pkey` before any rule its own first sending
   would now break.
2. **The facility:** named, open (read under its share lock, so a closure waits; ADR-0028),
   and a warehouse or a factory.
3. **The lines.** Each conversion is found through the facility's brand, so another
   brand's is answered exactly as a missing one before any other rule could reveal it
   exists (ADR-0012). A quantity is a decimal of at most six places, as text or a JSON
   number, never a float. Its base quantity must be exact to six places, or it is refused
   rather than rounded (INV-005). One line per pack.
4. **The balance lock:** one transaction-scoped advisory lock per facility and item, taken
   in ascending key order by `erp.lock_stock()`. It covers a balance that does not exist
   yet, which a row lock cannot. Every writer of a balance goes through the seam, so this
   lock serialises them all.
5. **"Now" is the clock once the locks are held,** never the transaction's start, as 0018
   found for prices. A movement that waited behind a count is dated after it. A stated
   moment is a real one, and not before the facility's record began: D3 bounds a late
   entry only by the item's last count, so for an item never counted there a year typed
   2016 for 2026 was taken (`stock_moment_before_facility`).
6. **Every rule that reads the balance,** under the lock: D3, the count tie, D1.
7. **The writes:** the decision, with its override already known, then its entries or
   count lines, then the balances, stamped with it. Nothing is written before the
   decision exists, so a stamp always names a real decision.

**The seam never judges whether an item or a conversion is active.** Correcting the book
about stock already held acquires nothing. 0012's `assert_item_active()` is for new work
(a purchase order line, a branch order line, a production output), and the later route
that creates such work calls it before it posts. So a write-off in a pack retired since
is reversed in that pack, and stock of a retired item can be counted, written off or put
back on the book.

**A transaction that posts at more than one facility,** such as a later transfer, makes
one decision per facility, each with its own id and its own business day. It calls
`erp.lock_stock()` once, with every key it will touch, before its first posting, so the
lock order holds across the whole transaction.

**An entry records goods physically entering or leaving a facility,** never a commitment.
The warehouse took stock out when a branch order was approved, not when it left. Carried
over, a count between approval and dispatch would find goods the book had already given
away, and RPT-010's committed and available figures would be impossible. What is committed
belongs to the ordering module (10), and available is on hand less committed.

### 4. Counts (INV-009)

- **A count records what was found** at a moment: now, or the moment counted, stated
  when it is entered later.
- **It posts the difference from the book as it stood at that moment:** the balance now,
  less every entry dated after it. A movement entered late but dated before the count is
  therefore not counted twice.
- **A count may be partial.** Only the items it lists change. Full packs and loose
  pieces are separate lines, summed in the base unit.
- **A count finding none is a count.** One finding the book exact posts nothing, and
  still stamps the balance and records the moment counted.
- **A count is never refused for the balance it leaves.** Found 10 l, with 50 l taken out
  since the moment counted, the balance shows -40. That is a fact, not a decision to
  override.
- **A count and a movement of the same item never share a moment.** The console states
  moments to the minute. A movement stated at the minute of a count it physically followed
  was otherwise taken as before it, and counted twice. Whichever is recorded second is
  refused and asked which side it was on (`stock_count_moment_taken`, or
  `stock_backdated_before_count` with a hint that says so). **A count stated late holds
  its whole minute, in either order:** a movement recorded "now" at 13:04:51 is no clearer
  about a count stated as 13:04, whichever was recorded first, and was counted twice. Each
  decision records whether its moment was stated (`moment_stated`), so a count made now
  holds only its instant and the work after it goes on.

### 5. Reversals (I-6)

- **An adjustment or a write-off is reversed whole, once,** by a decision that mirrors
  every entry: the same conversion and quantity, the other way, naming the entry it
  undoes. A count is corrected by counting again. A reversal is final.
- **A reversal is dated at the moment of the decision it undoes,** not "now". It says the
  target never happened, so it belongs where the target was. `decided_at` records when it
  was made. Two things follow from D3:
  - **Once a count has covered the target, the reversal is refused**
    (`stock_reversal_counted_since`). The count already corrected the book. Dated "now",
    the reversal corrected the stock a second time, which is the usual sequence in
    practice: a mistake is noticed because a count turned up a variance. To change the
    book after that, count again or record an adjustment.
  - **A count entered late, dated between the target and its reversal,** sees both before
    it, and they cancel.
- **Two reversals of one decision serialise** on a lock named for the target. The second
  is refused by name, `stock_already_reversed`; the unique key carries the same name as a
  backstop.
- **A reversal is held to D1** like any other movement.

### 6. D1: refused, or overridden with a reason

- **What a movement takes out of an item, leaving it below zero, is refused**
  (`stock_would_go_negative`), naming the item, what is on hand, what it takes and what
  it would leave. Lines are netted per item, so an adjustment that puts 10 kg in and takes
  110 kg out of 100 kg leaves exactly nothing, and is not refused.
- **The override is `inventory.stock` approve, held at the facility,** and the movement
  then carries the person's reason for it, apart from the movement's own reason. The
  override follows the role's scope: a grant at one facility overrides there alone, and an
  organisation-wide grant everywhere.
- **Only a decision that would have been refused carries an override.** A reason sent
  when none was needed is not recorded.
- **What goes in never needs an override,** even where the balance stays below zero.
- **"Shown until a count settles it"** is read today as "shown while below zero". The
  stock read lists items below zero for that screen. A receipt that brings the item back
  to zero or above also takes it off that list (open question 7).

### 7. Who reads and who writes

- **Stock is the first module whose writes are scoped to a facility.** A factory manager
  assigned to the factory writes there and nowhere else (IAM-006).
- **Every route and read needs a named facility.** An organisation-wide person reading
  with none got every facility's rows mixed, with no facility to tell them apart (found in
  review). So null, or the organisation's id, is refused (`stock_facility_required`). A
  view across facilities, if wanted, will be its own read, returning the facility.
- **A decision at another facility is answered exactly as a missing one.** Reads also stay
  within the facility's brand.
- **The migration gives the administrator read, write and approve:** a real database has
  no other role. The seed gives the warehouse and factory managers read and write (the
  general manager read only), and gives approve to the
  factory manager alone, until open question 2 is answered. So the seeded factory manager,
  assigned to the seeded factory, overrides there and nowhere else. The organisation-wide warehouse
  manager, writing but not approving, is the control.
- The capability `inventory.stock` ships **hidden**. Until now it was a fixture only the
  synthetic seed knew, recorded as 'enabled'. The seed now records it as 'pilot', as for
  modules 1 to 4.

### 8. Kept out, deliberately

- **Branch stock.** The warehouse's Phase 7 counted, returned and transferred stock at
  branches. D3 decides no branch's business day, and a calendar date stamped on an
  append-only ledger can never be re-dated. So a branch is refused by name
  (`stock_branch_business_day_undecided`), and an office holds no stock. Admitting
  branches later changes a check and the date rule inside the seam, not the tables (open
  question 6).
- **Storage locations** (D4) and **stock status** (INV-003).
- **Batch and expiry on the entry** (INV-004, INV-007's "batch where applicable"). Lots
  are module 14's. An expiry write-off today names no lot (open question 11).
- **Approval of variances** (D2), **blind counts** and **a recount's link to the count it
  corrects** (open questions 3 and 12).

INV-007's attributes, one by one:

| Attribute | Where it is held |
|---|---|
| source document | The decision, its id, its kind |
| user | The decision's actor |
| date | The moment it happened, and its business day |
| quantity, unit | Each entry: quantity in the conversion entered, and the base quantity |
| location | The facility (D4); a storage location later |
| batch | Not yet: module 14 |
| approval state | Posted (D2) |

## Consequences

- **Later modules post through `erp.post_stock()`:** receipts (8), branch orders and
  delivery confirmation (10, 11), production and the daily sheet (13, 15), opening stock
  (17). A route that creates new work calls `assert_item_active()` itself before posting.
- **Step 2 adds `stock_decision_pkey` to the edge's decision logs.** A retry is then
  answered `already_recorded`, confirmed through `erp.get_stock_decision()` at the same
  facility. A 23505 on write followed by a 404 on confirm is a collision with another
  facility's decision, never a retry.
- **The console's stock screens need a chosen facility.** Their write rule is the inverse
  of the masters': offered only at a named facility where the person writes, never
  organisation-wide.
- **`db:check` proves the races with two real sessions:**
  - two withdrawals that together overdraw an item;
  - two reversals of one decision;
  - a count racing a waste dated before it;
  - a count racing an item's first movement, before it has a balance a row lock could
    hold;
  - a "now" movement that waited behind a count;
  - two first movements of new items in opposite orders, against the draft's placeholder
    rows.

  It asks the ledger's rules again after them. A retry that overlaps its original is
  answered as a retry on all three routes.
- **`db:check` discovers `%_ledger` tables** as append-only logs, by the one predicate its
  catalogue check and its runtime probe now share. The probe updates the first column an
  UPDATE may set to itself; an identity column refuses in the rewriter, before any trigger
  fires.

## Found in review

The design was reviewed adversarially before it was built, through five lenses: the
invariants, concurrency, what later modules need, operations, and fit with this
repository. Each finding was checked by two independent skeptics. The confirmed ones are
built in:

- **A reversal dated "now" corrected a counted mistake twice.** It is now dated at its
  target's moment, and refused once a count has covered it (§5).
- **The draft's placeholder balance rows** needed a stamp before the decision existed,
  and deadlocked on first movements listed in opposite orders. They are replaced by the
  key lock (§3).
- **Branches would have been stamped with calendar business days** D3 does not decide.
  They are refused (§8).
- **A cross-facility transaction would deadlock,** locking per call. The lock order is
  now per transaction (§3).
- **"Now" was read before the locks.** It is read after them (§3).
- **A movement at exactly a count's moment** was silently taken as before it. Whichever
  is second is now refused (§4).
- **A second reversal met an unnamed unique index,** and got a generic error. Reversals
  now serialise on the target, and the refusal is named (§5).
- **The active checks would have refused** reversing a write-off of a since-retired pack.
  They are taken out of the seam (§3).
- **Values copied onto entries were bound only by code.** They are bound by keys (§2).
- **Reads were fenced by brand, not facility.** A null facility mixed every one (§7).
- **Another brand's conversion had its own refusal,** which told a writer it existed. It
  is now answered as a missing one (§3).
- **The seed had no warehouse, factory or facility-scoped stock writer.** 0070 adds
  them, and an approve split that leaves a control.
- **`db:check`'s probe could not update a log whose first column is an identity.** It now
  picks a column it can set.
- **The pgTAP fixtures depended on state, and the hidden-capability control passed
  vacuously** under CAP-P07. Every stateful case now runs self-contained and rolled
  back. Each hidden control withdraws production first, and asserts the gate's own words
  (CAP-P04 for a write, CAP-P02 for a read).

## Found in the review of what was built

Three independent reviews of the built step — its SQL, whether its tests prove what they
claim, and whether its documents say what the code does — found these, now fixed:

- A count stated to the minute did not see a "now" movement in that minute (§4).
- A stated moment had no lower bound for an item never counted, and could be infinite
  (§3).
- A count whose difference from the book was past any store's size met the table's own
  check, not a named refusal.
- No probe raced an item's FIRST movement, where a row lock holds nothing; the probe that
  seemed to was not testing the lock. Nothing checked that a count posted what it found;
  the override's per-facility scope and the balance guard's item half were untested.
- Nine statements in these documents and the migration's header said more, or other,
  than the code does.

## Addendum — 2026-10-06: the data layer (module 5, step 2)

The six runtime routes are reachable over HTTP through one edge function, `stock`
(`supabase/functions/_shared/stock.ts`), built as `facilities` is (ADR-0028's step 2
addendum). Nothing about the routes changed. `erp.post_stock()` and
`erp.lock_stock()` are not among them: they are owner-only, for later modules' own
routes.

- **The routes:**
  - `GET /` reads the balances at a facility, paged by code; `negative=true` lists only
    what stands below zero.
  - `GET /items/{item_id}` reads an item's stock card at a facility, newest first, paged
    by `before`, a seq as decimal text.
  - `GET /decisions/{decision_id}` reads one decision whole, at the facility asked. A
    decision at another facility is a 404, as a missing one is.
  - `POST /adjustments` records an adjustment, a waste, a damage or an expiry.
  - `POST /counts` records a count.
  - `POST /decisions/{decision_id}/reverse` reverses one. The decision reversed is the
    one the path names, whatever the body says.
- **The actor is the session's,** through `withSession` (ADR-0025). A Node control test
  holds this for all three writes and all three reads.
- **Every route names its facility.** These are the first writes scoped to one: a
  write's body must state `facility_id`, or it is a 400, and 0020 asks permission there.
  A read asks at the query's `facility_id`, as every read does. Left out, the edge asks
  with none, and 0020 refuses rather than mix every facility's stock: an
  organisation-wide person gets `stock_facility_required` (§8), and a facility-scoped
  one is refused by the gate first (403), since the gate runs before that check.
- **The edge checks shape, the database checks rules.** Four shape rules are this
  module's own:
  - **A quantity is decimal text,** as a factor and a coordinate are: `"2.5"`, never the
    number 2.5, with no sign, no exponent and no decimal comma. It goes to a `numeric`
    column inside the lines' `jsonb`, and every answer carries quantities and factors as
    text, so no float touches one either way. How many digits and places is 0020's rule
    (twelve and six), refused in its own words.
  - **A moment names its offset,** as a transfer price's does (ADR-0027's step 2
    addendum). The check moved from `transfer-prices.ts` into `fields.ts`, so both use
    one. Left out, a moment is now.
  - **A line carries on only its conversion, its quantity and its direction.** Nothing
    else a client puts on a line reaches the database. A malformed line names itself:
    `lines[2].quantity`.
  - **A business date is text,** `"2026-09-25"`: the facility's calendar day (D3).
    postgres.js parses a `date` as a moment at UTC midnight, which a browser west of
    Greenwich shows as the day before, so the driver casts it (found in review).
  - **An adjustment or a count is a document, not a form.** It may be up to 128 KiB,
    because 500 lines at their longest are about 50 KB, past a form's 8 KiB. A reversal
    has no lines and stays a form.
- **Refusals** map through `_shared/refusal.ts`, which now lists `stock_decision_pkey`
  among its decision logs:
  - a retry is `already_recorded`, and the console confirms it through
    `GET /decisions/{id}` at the same facility;
  - a decision already reversed is a conflict (409);
  - a missing override permission is `forbidden` (403);
  - stock that would go below zero, a movement dated at or before a count, a count at a
    movement's moment, a reversal a count has covered, a count reversed, a branch or an
    office, and a closed facility are each `refused` (422). The closed facility is held by
    the Node test alone: 0019's own tests close one end to end;
  - a kind, a direction, a quantity or a moment that breaks a rule is `invalid` (422),
    and so is an organisation-wide read with no facility;
  - a conversion of another brand, or a decision at another facility, is 404, exactly as
    a missing one is.
- **Proved end to end, as `erp_edge`,** by `supabase/functions/_deno/test/stock.test.ts`:
  - A signed-in cashier reads their branch's stock, which is none, reads nothing at the
    warehouse, and writes off nothing.
  - Then, in one transaction that is rolled back:
    - The seeded balances read back as text, factors included. The factory stands at
      -10 kg, and only it is listed below zero.
    - The opening count reads back with what it found, and is a 404 at the factory.
    - The warehouse manager records a count stated late, at 09:00 Riyadh with its offset.
      It reads back as 06:00 UTC and posts the difference from the book. The same
      moment without its offset is a 400.
    - A waste is recorded, and a retry carrying other lines is answered as a retry and
      moves nothing.
    - Movements dated before the count, at its instant, or within its stated minute are
      refused. So is one in the future.
    - Going below zero is refused. With an override reason it is refused to the
      warehouse manager (403), allowed to the factory manager at the factory, and refused
      to them at the warehouse.
    - The waste is reversed, once. A decision a count has since covered and a count
      itself are refused, and a reversal from another facility is a 404.
    - The item's card holds every decision, newest first, paged by seq.
    - A branch, a read with no facility, another brand's pack, a quantity sent as a
      number, and a seventh decimal place are each refused.
    - The rollback is checked.
- **Controls:** 21 deliberate breakages of the edge layer, each failing a named Node or
  Deno test. Among them:
  - an actor taken from the query or a header;
  - a line passed on whole;
  - a quantity accepted as a number or passed through a float;
  - a write with no facility, or a reversal whose target is taken from the body;
  - a moment without its offset;
  - the retry mapping removed, or a native collision answered as a retry;
  - a count held to a form's 8 KiB;
  - the driver dropping the override reason, sending the lines as a JSON string,
    counting now, ignoring `negative`, reading a decision at no facility, or answering a
    business date as a UTC moment.

## Open, for the owner and for UAT

Recorded rather than guessed. Each is decided before the module that needs it.

1. **Is a central warehouse shared by both brands?** Today an item's brand must be the
   facility's. A shared warehouse would widen the conversion lookup to the brands it
   serves, and the same "missing" answer would still apply to the rest.
2. **Who may override negative stock?** The warehouse and factory managers, the general
   manager, at which facilities? The seed's choice is a fixture, not this answer.
3. **Are counts ever blind,** with the counter not shown the book? A screen cannot make
   one blind while the counter can read the balance elsewhere. It needs a capability for
   counting without reading, and a record on the count that it was blind.
4. **Which facilities need storage locations first** (D4)?
5. **A count that reveals negative stock** after later movements is shown, not refused.
   Is that right, or must those movements be looked at again?
6. **Branch stock:**
   - Is a branch's business day its shift's (Q-06), or the calendar's?
   - Who counts at a branch? In the warehouse, branch workers did.
   - Does counting need a permission separate from writing stock off? Today one `write`
     covers both, and a branch worker who may count could then write off.
   - Which module carries branch stock, returns and transfers?
7. **"Until a count settles it":** is a negative balance cleared from the list by any
   movement back to zero or above, as built, or only by a count?
8. **A closed facility's remaining stock** cannot be counted or written off without
   reopening it to all new work. Should disposal be allowed at a closed site, as it is for
   a retired item?
9. **Reasons are free text, kept for good** in an append-only log. A reason naming a
   person ("dropped by X") cannot be erased (SEC-008; `pdpl-assessment.md` rates
   disciplinary records High), and free text cannot be grouped for INV-011's variance by
   reason. Should each kind have a coded list, with any note kept apart and erasable? This
   extends ADR-0026's retention question to stock. Until then the screens will ask people
   not to name anyone.
10. **Putting a retired item's stock back on the book** is allowed, because correcting the
    book acquires nothing. Confirm.
11. **Factory lots.** The warehouse picked first-expiry-first-out by lot. Is the factory's
    stock promoted on module 5 alone, or only with module 14's lots?
12. **A recount is not linked to the count it corrects.** A mistyped count and its
    correction both stand as variances. Is a link needed, so variance reports can net the
    pair?
13. **How late may an entry be?** Nothing is recorded before an item's last count or
    before the facility's record began, but within that a year typed one too few is still
    taken. Should a movement stated more than some days before it is recorded need a
    manager, or be refused?

## Alternatives considered

- **Keep counters as the master,** with the ledger as their side effect, as the warehouse
  did. The two drift, and nothing says which is right.
- **One generic ledger for every domain.** The ledger primitives' rules are kept per
  domain instead, so each entry can name its own conversion through a foreign key.
- **Lock balance rows, with placeholder rows for new items.** A row lock cannot cover a
  row that does not exist. The placeholder needed a stamp before its decision, and
  deadlocked on opposite orders. A deferrable foreign key would be the only one in `erp`,
  and would let a stamp name a decision that does not exist until commit.
- **Date a reversal "now" and refuse it after a count,** keeping the reversal's own moment.
  A count entered late between the two still read the reversal as after it, and counted the
  correction twice.
- **Let stock go negative silently,** as the warehouse did. The owner chose D1.
- **A second person approves each adjustment.** The owner chose D2, for now.
