# ADR-0027 — Transfer prices: what a branch is charged for a pack, from when

- **Status:** Proposed. Built as module 3's database layer on 2026-10-04; the owner
  decides the open questions below before the module is switched on
- **Date:** 2026-10-04
- **Requirements:** INV-017 · INV-019 · INV-005 · PRG-014 · CAP-P02 · CAP-P04 · IAM-003 ·
  IAM-006 · IAM-008 · MNU-015 (its rule, applied to transfers)
- **Related:** ADR-0005 · ADR-0012 · ADR-0024 · ADR-0026 · invariants I-1, I-6, I-7, I-8 ·
  `supabase/migrations/20261004000400_transfer_prices.sql` ·
  [`../estate/process-mapping-transfer-prices.md`](../estate/process-mapping-transfer-prices.md)

## Context

Item pricing is module 3 of the consolidation. A branch order (module 10) charges each
line at a transfer price, a branch's monthly statement totals them, and the accounting
journal posts them as transfer revenue against the branch's receivable. So this master
constrains modules 10, 12, 16 and 20.

The warehouse kept one column, `items.unit_price numeric(10,2) default 0`. The
administrator or the accountant changed it in place through `set_item_unit_price()`,
and a trigger wrote the old and new value to `item_price_history`. An order line copied
the price when the line was added, and a trigger kept it from changing after. The
weaknesses:

- **Zero was the default.** An item nobody had priced went out at nothing, and "free"
  could not be told from "never priced".
- **One price per item.** The ERP's items have several conversions (ADR-0024), and a
  branch orders by the carton or the piece.
- **A change took effect on save.** A price meant for the first of the month had to be
  entered on the first of the month.
- **Money as `numeric(10,2)`.** The canonical model keeps money as integer minor units
  with a currency.

## Decision

### 1. A price names a conversion, through the I-7 seam

`erp.transfer_price` references `erp.item_unit` through 0012's four-column seam, as a
supply does (ADR-0026 §3). "A branch pays 185 SAR for chicken breast in 10 kg cartons" is
one row. A carton changed to 12 kg is a new conversion and needs a new price; the old
price goes on meaning 10. Only an active pack of an active item can be priced. A retired
pack keeps its price history and is left off the price list.

### 2. Money is integer minor units with a currency

`price_minor bigint` and `currency`, which is `SAR` alone today: 18500 is 185.00 SAR. A
second currency is a later decision, made in a migration. The ceiling, a billion riyals
for one pack, catches a typing error and is not a business rule.

### 3. Zero is a decision; no row is no price

An unpriced conversion has no row. A price of 0 is something somebody decided: the seed's
loose meal boxes, say. The seam a branch order will call, `erp.transfer_price_at()`,
refuses a pack with no price in force (`transfer_price_exists`). It never answers a
silent 0.

### 4. A price takes effect from a moment, and is never backdated

Each price has `effective_from`: now, or a later moment set ahead. The price in force at
a moment is the latest active price in effect at it, so "what did a carton cost on the
3rd" is answered from the rows. A price is never set to take effect before the decision
that set it: an order already placed keeps its price, which is MNU-015's rule for selling
prices, applied here. One price per pack per moment.

Every price changes something. A price equal to the one in force at its moment is
refused, and so is a price equal to the one the pack moves to next. Withdrawing a price
that would leave its two neighbours equal is refused too: the later one is withdrawn
first. Otherwise a second record of one amount would switch orders to a new price at a
moment when nothing changed (found in review). `db:check` holds every row to this.

### 5. History is the table; prices are fixed once set

One row per price ever set. A price's pack, amount and moment never change. **A price
set ahead may be withdrawn until its moment comes; a price in effect never is**, because
an order may already have been charged it. A withdrawal is final. Triggers bind the
owner to all of it, as 0012's and 0016's do. Every change is a decision in an
append-only log, `erp.transfer_price_decision`, with an actor and a stated reason.
Retries are recognisable as everywhere else (ADR-0026 §6). `db:check` proves the log
matches the prices, and that no row was backdated or withdrawn once in effect.

### 6. Who

The administrator and the accountant set prices, as in the warehouse. The managers read,
and a branch worker reads the prices at their branch, within their brand (ADR-0012).
Every read also asks for read on `inventory.items`, since a price names an item. The
capability `inventory.transfer_prices` ships **hidden**.

### 7. No VAT on a transfer

Branch orders carried none in the warehouse: a transfer within the company is not a
sale. There is no VAT column. Question 1 asks whether that holds.

### 8. "Now" is the clock, and orders queue behind price decisions (found in review)

Whether a price is backdated, or already in effect, is judged by the clock once the
decision holds its conversion's lock. It is never judged by the decision time the caller
passes, nor by `now()`, which is the transaction's start:

- **A caller's past decision time** no longer sets a price in the past, rewriting what an
  order already placed was charged.
- **A withdrawal that waited on a lock** past its price's moment is refused, by the
  route and by the trigger alike.

The seam takes the same per-conversion lock, shared, so a branch order and a price
decision about its pack never interleave. The order is charged what history will say
applied at its moment.

The seam also refuses a retired pack, or a pack of a retired item. It checks both
under the item's share lock, which retiring a pack takes for update. A check left to the
caller, through `erp.active_item_unit()`'s unlocked read, let a pack be retired between
that check and the price, and an order be priced for it. `db:check` proves this with two
real sessions: a retirement held open while an order asks for the pack's price.

`db:check` also holds every price's decision history to the price. All its decisions
agree on the pack, the amount, the currency and the moment, and its first decision is
its one `price_set`.

## Consequences

- **Branch orders (module 10) get a seam.** An order line calls `erp.transfer_price_at()`
  for its pack at the moment the order is placed. It copies the answer into its own
  immutable record, and is refused when the pack has no price, or when the pack or its
  item is retired (§8). The share lock the seam takes on the item lasts to the end of the
  order's transaction, so the order's own `erp.active_item_unit()` sees the same pack.
- **Valuation and the journal (modules 16, 20) read the order lines,** not this table:
  the price a branch was charged is the line's, fixed when the order was placed.
- **Changing a price is cheap and safe.** Set the new price from the moment it should
  apply; nothing already ordered changes.
- **The edge layer and the screens are built** (see the addenda); **staff testing is module 3's next step.**

## Addendum — 2026-10-05: the data layer (module 3, step 2)

The five runtime routes are reachable over HTTP through one edge function,
`transfer-prices` (`supabase/functions/_shared/transfer-prices.ts`), built as `suppliers`
is (ADR-0026's step 2 addendum). Nothing about the routes changed.

- **The routes:**
  - `GET /` for the price list, paged by item code: a page holds up to `limit` items,
    each with every active pack, so `next_after` is set when the page holds `limit`
    distinct items, not `limit` rows;
  - `GET /items/{item_id}` for every price ever set for an item's packs, and
    `/items/{item_id}/history` for every decision about them;
  - `POST /` to set a price, and `POST /{price_id}/withdraw`.

  The seam `erp.transfer_price_at()` is not among them. It is owner-only, for module 10's
  own routes.
- **The actor is the session's,** through `withSession` (ADR-0025). A Node control test
  holds it for both writes and all three reads. The price a withdrawal acts on is the
  one the path names, whatever the body says.
- **The edge checks shape, the database checks rules.** Two shape rules are new, both
  about money and time:
  - **An amount is a JSON number of whole minor units:** 18500, never `"185.00"` or
    185.5. That it runs 0 to 10^11 and is in SAR is 0018's rule, and so is a moment in
    the past. The answers carry amounts the same way. postgres.js returns an int8 as
    text, so the driver turns each amount into a number, and refuses as an error any
    value that is not a whole number it can hold exactly. Every amount fits: the cap
    is far below 2^53.
  - **A moment names its offset:** `2026-11-01T00:00:00+03:00`, never
    `2026-11-01T00:00:00`. PostgreSQL reads a moment without one in the session's time
    zone, which is UTC on Supabase, so midnight in Riyadh would have become three in
    the morning (question 5). Left out, or null, the price takes effect now.
- **Refusals** map through `_shared/refusal.ts`, which now lists
  `transfer_price_decision_pkey` among its decision logs. A route-raised 23505 on it is
  `already_recorded`; the same constraint raised by PostgreSQL itself stays a conflict.
  Prices have no stale check, so the stale list is unchanged. A second price for one
  moment is a conflict (409). A price that changes nothing, one in effect withdrawn, or
  a retired pack is `refused` (422). A past moment, another currency or an amount out of
  range is `invalid` (422).
- **Proved end to end, as `erp_edge`,** by `supabase/functions/_deno/test/transfer-prices.test.ts`:
  - a cashier reads the price list at their branch, within their brand, sees no row of
    another brand's item and an unpriced pack listed unpriced, and is refused a write;
  - then, in one transaction that is rolled back, the accountant prices the unpriced
    pack. A retry is answered as a retry. A price set for midnight Riyadh time is read
    back as 21:00 UTC the day before. Each rule comes back in the route's own words. The
    warehouse manager reads and is refused both writes, and a price set ahead is
    withdrawn, for good. The history holds every decision, amounts as numbers. The
    rollback is checked.
- **Controls:** 15 deliberate breakages of the edge layer, each failing a named Node or
  Deno test. They include an actor or price taken from the request, a moment without its
  offset accepted, an amount sent or answered as text, the facility dropped from a read,
  paging by row, and the offset dropped by the driver. The review added three: an
  impossible day or an out-of-range offset left to PostgreSQL, which answered a 422
  naming no field, and a missing amount column read as an unpriced pack.

## Addendum — 2026-10-05: the screens (module 3, step 3)

Two screens in the console, built as the supplier screens are (ADR-0026's step 3
addendum): the same in-doubt lock, ids minted once per form, and Retry resending the
exact request first sent.

- **Transfer prices** (`#transfer_prices`), under Inventory. Every active pack of every
  active item, with the price in force now and the next one set ahead. An unpriced pack
  is marked "no price — cannot be ordered", not hidden. A price of zero is shown as a
  price. Paged by item, as the route pages.
- **An item's prices** (`#transfer_prices/{item_id}`), linked from the list and from the
  item's page. Every price ever set, pack by pack, newest moment first, with the one in
  force marked; the set-price form; a Withdraw button on each price whose moment has not
  come; and the history.
- **Money is never a float.** A price is typed in riyals, with Arabic digits and the
  Arabic decimal separator read, and turned into whole halalas by string arithmetic:
  0.29 riyals is 29 halalas, where `0.29 * 100` is 28.999…. It is shown from the integer.
- **Time names Riyadh.** A price set ahead is typed as a date and a time of day, midnight
  by default, read in Riyadh's time and sent with `+03:00` written out (Saudi Arabia keeps
  no daylight saving). Every moment on the page, the history's included, is shown on
  Riyadh's clock, so a browser set to another zone never mixes two. A test checks that a
  moment the console builds matches the edge's own pattern, read from its source.
  Question 5 stays open; midnight is the default the form offers, not a rule.
- **Who sees what.** The screens appear only where the person may read both transfer
  prices and items, as every 0018 read asks for both. Changes are offered only
  organisation-wide to someone holding write, mirroring both write routes'
  `assert_permitted(…, 'write', NULL)`; a test reads 0018 to hold that. The seed lets a
  branch worker read their own brand's prices, and the end-to-end run checks a cashier
  sees no second-brand item.
- **Refusals read as sentences** for every rule a set or withdrawal can raise in 0018's
  own words, in English and Arabic. A native speaker reviews the Arabic in the UAT pack,
  as for every module.
- **Proved in a browser** against a scratch database and the edge, in English and Arabic,
  from a browser set to New York time. The run prices an unpriced pack from Arabic digits,
  sets a price for midnight Riyadh time, and has the same-as-next and backdated cases
  refused as sentences. It withdraws the price set ahead and finds both prices and the
  withdrawal in the history. It then checks the warehouse manager is offered nothing to
  change, and a cashier sees their brand only. 15 controls each fail a named test.

## Open, for the owner and for UAT

Recorded rather than guessed. Each must be answered before the module that needs it.

1. **VAT on transfers.** Is a transfer between a brand's branches and the central
   warehouse ever subject to VAT, for example if the brands are separate legal entities?
   That is a question for the accountant and counsel.
2. **A price per branch, or per brand,** beyond the item's own brand. The warehouse had
   one price for every branch.
3. **Who besides the administrator and the accountant may set prices,** and whether a
   change needs a second person's approval. AI-011 names price changes among the actions
   that need human authorisation; today one person deciding is that authorisation.
4. **Is a price of 0 ever right,** or should it be refused like a negative one?
5. **The moment a price set ahead takes effect.** Midnight Riyadh time is the natural
   default for the console, which stores the moment exactly.

## Alternatives considered

**A price per item, per base unit, with pack prices derived by the factor.** Simpler, but
a carton's price would then be a rounding of a per-kilogram price in minor units. A
supplier's cartons are priced as cartons, and so is a branch's order. Rejected.

**Keep one current price and a history table, as the warehouse did.** The current price
then cannot be set ahead, and the history becomes a second copy of the truth. Rejected:
one table of prices, each from a moment, is both.

**Allow withdrawing any price.** It would let history change after an order was charged.
Rejected for I-7.
