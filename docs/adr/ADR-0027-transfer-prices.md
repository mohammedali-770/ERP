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

`db:check` also holds every price's decision history to the price. All its decisions
agree on the pack, the amount, the currency and the moment, and its first decision is
its one `price_set`.

## Consequences

- **Branch orders (module 10) get a seam.** An order line calls `erp.transfer_price_at()`
  for its pack at the moment the order is placed. It copies the answer into its own
  immutable record, and is refused when the pack has no price. The seam does not check
  the pack is still active: a price set ahead outlives a pack retired meanwhile. So the
  order line reaches its pack through `erp.active_item_unit()` first, as every
  quantity-bearing line must.
- **Valuation and the journal (modules 16, 20) read the order lines,** not this table:
  the price a branch was charged is the line's, fixed when the order was placed.
- **Changing a price is cheap and safe.** Set the new price from the moment it should
  apply; nothing already ordered changes.
- **The edge layer and screens are module 3's next steps.** The edge's refusal mapping
  must then answer `already_recorded` for `transfer_price_decision_pkey`.

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
