# Process mapping — stock and movements

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 5 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0029](../adr/ADR-0029-stock-ledger.md) (proposed), with the owner's
  decisions D1 to D4 of 2026-10-05
- **Built in:** `supabase/migrations/20261005000200_stock.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `inventory.stock` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy:
- its `docs/SYSTEM.md`: §5 (`warehouse_stock`, `factory_stock`, `stock_movements`,
  `stock_adjustments`), §5's stock triggers and its write functions `adjust_warehouse_stock()`,
  `record_stock_count()` and `import_opening_stock()`, §8.6 (stock adjustments) and §10's
  known issues;
- the migrations that built the ledger (`20260929200000_stock_ledger.sql`), the counts
  (`20260929210000_receipts_counts_prices_reports.sql`) and the order-stock fixes
  (`20261013090000_test_fixes_orders_stock_factory.sql`);
- its screens: `Warehouse/CurrentStock`, `Warehouse/StockAdjustments`,
  `Factory/CurrentStock`, `Factory/StockAdjustments`, `GeneralManager/CurrentStockView`
  and `Stock/StockMovementsPanel`.

**Nothing is migrated:** the warehouse holds demo data only, and the ERP is re-seeded
synthetically. Opening stock arrives as a count (module 17's import posts one).

---

## The master changes sides

| Warehouse | ERP |
|---|---|
| **The counter is the master:** `warehouse_stock.current_stock_sale_units`, `factory_stock.current_stock`, `raw_materials.current_stock`, changed in place | **The ledger is the master:** `erp.stock_ledger`, never updated or deleted; `erp.stock_balance` is its sum, stamped with the latest decision (I-8) |
| `stock_movements`, written by a trigger as a side effect, labelled from a session setting | Every movement is a decision (`erp.stock_decision`) with its actor, reason and moment, written by the one posting seam |
| `stock_adjustments`: an audit row per manual count | `erp.stock_count_log`: what each count found, line by line, in the packs counted |
| Three counters: warehouse items, factory items, raw materials | One balance per facility and item. Raw materials are items (module 1), and a warehouse and a factory are facilities (module 4) |

## Field by field

| Warehouse | ERP | Why |
|---|---|---|
| `quantity`, signed | `quantity` positive, with `direction` in or out | Ledger primitives rule 3 |
| `balance_after` on each movement | Not stored: the balance is the sum, and a stock card computes a running figure | A stored running balance is wrong the moment a movement is entered late |
| Warehouse in sale units, purchase units derived through an editable ratio | Every entry in the conversion it was entered in, copied whole (I-7), and its base quantity | A pack-size change is a new conversion (module 1); an old carton still means what it meant |
| `movement_type`: opening, receipt, order, production, daily_operation, count, waste, system, return | `kind`: count, adjustment, waste, damage, expiry, reversal. Later modules add receipt, issue, production, transfer, return (I-10) | No "system" movement: every movement names its cause |
| `reference_type` / `reference_id` | The decision's id and kind; later modules' decisions name their documents | |
| `created_by`, nulled when a user was deleted (B-11) | `actor_id`, never null, never cascaded | |
| `created_at` | `occurred_at` (when it happened, stated when late), `business_date` (D3), `decided_at`, `recorded_at` | A late entry says when it happened |
| `unit_cost` | Not here: costing and valuation are module 16 | |
| No location | The facility (D4); storage locations later | INV-003 |
| No idempotency key | The decision's id, minted by the console; a retry is answered as one | ADR-0005 |

## Counts

| Warehouse | ERP |
|---|---|
| Warehouse: one item at a time, full packs plus loose pieces, the form starting from the system figure (`adjust_warehouse_stock()`) | Any number of items in one count, each in as many packs as it was found in, summed in the base unit |
| Factory: a bulk count of factory items or raw materials (`record_stock_count()`) | The same count, at the factory |
| **The count overwrote the counter** with what was found, against the stock at the moment of saving | **The count posts the difference from the book as it stood at the moment counted.** A movement entered later but dated before the count is not counted twice (D3) |
| Counted when saved | Counted now, or at a moment stated when the count is entered later |
| A reason required | A reason required |
| Shown the system figure | Shown the system figure, for now: blind counts are open (ADR-0029, question 3) |

## Negative stock

| Warehouse | ERP |
|---|---|
| Allowed, and not reported. The daily sheet clamped what it showed at zero, and factory lots covered only the stock above zero | **Refused** (D1), naming the item, what is on hand, and what the movement would leave |
| | **Unless a person allowed to override records it, with their reason** (`inventory.stock` approve, at the facility). The balance then shows negative until a count settles it |
| | A count is never refused for the balance it leaves: it records what was found |

## Behaviours kept

- **Full packs plus loose pieces.** A count line per pack, as the warehouse form had packs
  and loose.
- **A reason for every manual change.**
- **The warehouse manager adjusts warehouse stock,** and the factory manager counts
  factory stock: in the seed, the warehouse manager writes stock everywhere and the factory
  manager at the factory only. Who may override is open (ADR-0029, question 2).

## New

- **A retired pack still counts.** The warehouse had one pack per item, with an editable
  ratio. Here an old carton of 12 is counted as a carton of 12 after the supplier moved to
  24: stock already held is counted in the pack it is in (I-7).
- **A count may list many items, and an item in several packs,** where the warehouse
  counted one item at a time at the warehouse.

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| Counter and ledger could disagree, with nothing to say which was right | The ledger is the only record; `db:check` holds every balance to it |
| Stock went negative silently, and screens hid it | D1: refused, or overridden with a reason, and shown |
| A movement entered late was swallowed by a count saved after it | A count is judged at its own moment; a movement is never dated at or before an item's last count |
| A retried receipt or batch could post twice | Every decision carries an id minted once; a retry is answered as one |
| A pack ratio edited under the stock it described | Conversions are immutable (module 1), and every entry keeps its own |
| A deleted user's movements lost their actor; deletes cascaded | Nothing is deleted; no foreign key in `erp` cascades or nulls (B-11) |
| Stock taken out when a branch order was approved, before the goods left | An entry records goods physically moving; commitments belong to the ordering module (ADR-0029 §3) |

## Not yet

- **Branch stock** (the warehouse's Phase 7: branch counts, returns, transfers). No branch
  holds a stock record until a branch's business day is decided (Q-06; ADR-0029,
  question 6).
- **Lots, expiry dates and first-expiry-first-out** at the factory: module 14.
- **Receipts, orders, production and the daily sheet,** which move stock: modules 8, 10,
  13 and 15, each posting through the same seam.
- **Low-stock alerts:** module 7.

## For sign-off

Operations should confirm before this mapping is approved:

1. A movement that would take stock below zero is refused unless someone allowed to
   override records it with a reason, and who that is (D1; ADR-0029, question 2).
2. A late entry states when it happened, and nothing is entered before an item's last
   count: a mistake found by a count is corrected by counting again or adjusting, not by
   reversing (D3; ADR-0029 §5).
3. Whether counts should ever be blind (question 3), and whether the factory's stock waits
   for lots (question 11).
4. That free-text reasons should not name people, until coded reasons are decided
   (question 9).
