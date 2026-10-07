# Process mapping — stock alerts

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 7 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0031](../adr/ADR-0031-stock-alerts.md) (proposed), with the owner's
  decisions A1 to A3 of 2026-10-07
- **Built in:** `supabase/migrations/20261007000200_stock_minimums.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `inventory.stock_alerts` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy:
- the low-stock lists (`20251014075554_create_low_stock_alert_functions.sql`, and their
  final form in `20261013090000_test_fixes_orders_stock_factory.sql`);
- the bell's low-stock alert (`20261001090000_notifications_approval_limits.sql`, changed
  in `20261013090000_test_fixes_orders_stock_factory.sql`);
- the screens: `src/components/Admin/ItemManagement.tsx`, where minimums were set;
  `src/components/GeneralManager/StockLevelAlerts.tsx`; and the warehouse, factory and
  general manager home pages (`src/components/Home/`).

**Nothing is migrated here:** the warehouse holds demo data only. A real minimum arrives
with the opening data (module 17), mapped as below.

---

## Where a minimum lived

Three columns, one per kind of stock, each overwritten in place:

| Warehouse | Held in | Unit |
|---|---|---|
| Warehouse items | `warehouse_units.minimum_stock_purchase_units` | the purchase pack |
| Factory products | `factory_stock.minimum_stock_level` | the item's unit |
| Raw materials | `raw_materials.minimum_stock_level` | the material's unit |

The administrator set them on the item form, beside the item's other fields. **A minimum
of 0 meant no minimum,** and the form offered 0 by default; the lists and the bell both
skipped an item whose minimum was 0. Nothing recorded who changed a minimum, when, or why.

In the ERP there is one item master (module 1) and one stock ledger per warehouse or
factory (module 5), so there is one minimum: **per item, per facility** (A1). It is a
decision with who, when and why, entered in a pack of the item and kept as entered
(I-7) and in the base unit. There is no minimum of 0: an item with none has its minimum
cleared, also by a decision. **On import, a warehouse minimum of 0 is no minimum.**

## The lists

`get_warehouse_low_stock_items()`, `get_factory_low_stock_items()` and
`get_raw_material_low_stock_items()` each listed what stood **at or below** its minimum.
The general manager's stock-level page showed all three; each home page showed its own.

The ERP has one list, `erp.stock_minimums()`, at one facility: every item with a minimum
there, its minimum as entered and in the base unit, what is on hand, and whether it is
low — the same rule, **at or below**. It can be asked for the low ones alone. An item
with a minimum that has never moved there has none on hand, so is low.

## The bell

The warehouse rang `low_stock` from row triggers on its three stock tables, when a value
went from above its minimum to at or below it. It went to every active warehouse manager
for warehouse stock, or every factory manager for the rest, organisation-wide, and it
skipped anyone who still had an unread alert for that item. Its row carried the item's
name. Since its October fixes it also reached the manager whose own action caused it.

| | Warehouse | ERP |
|---|---|---|
| When | a value crosses from above its minimum to at or below it | the same (A2): the balance before a posting against the balance after |
| Again | on the next crossing, but not to a recipient who still has that alert unread | on the next crossing, to everyone: once the balance has gone back above and falls again (A2) |
| Who | every active manager of the stock's kind, organisation-wide | whoever may read stock alerts, stock and items **at that facility** (0021's rule, N2) |
| The actor | told | told (A3) |
| A minimum raised above stock | no alert | no alert; the item is listed low at once |
| Holds | the item's name, stock, minimum, unit | ids and quantities only; names read when the bell is read (SUP-007) |
| One decision, several items | one alert per item | one notification per person per decision, naming each item it took across |

## Behaviours kept

- **At or below** is low, in the list and the bell alike.
- **The bell rings on a crossing,** not on every movement while low.
- **The person who moved the stock is told.**

## Behaviours changed

- **One minimum per item per facility,** not three columns for three kinds of stock.
- **A minimum is a decision**, with who, when and why, and its history kept.
- **No minimum of 0.** None is cleared.
- **"Once" is a fact about the posting,** not about who has read what. The warehouse rang
  on a crossing too, but skipped a manager who still had the last alert unread, so stock
  that went back above its minimum and fell again told only those who had read it.
- **Recipients are scoped to the facility,** not organisation-wide by role.
- **Who sets a minimum is a permission,** at a facility, not the administrator alone. The
  synthetic seed gives it to the two managers where they hold stock; who holds it in a
  real database is the owner's question (ADR-0031).

## Open

[ADR-0031](../adr/ADR-0031-stock-alerts.md) lists the owner's questions.
