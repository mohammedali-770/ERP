# Snapshot rules

What is frozen at order time, and why.

Requirements: OMS-016 · MNU-015 · Invariant I-7

---

## The rule

**Values applicable to an order at the moment it was placed are embedded in the
event payload, not resolved by lookup at read time.**

This makes immunity to later master-data edits **structural**. Nobody has to
remember to snapshot; there is no read path that could accidentally resolve a
current value instead of a historical one.

---

## What is snapshotted

### On `OrderLineAdded`

| Field | Why |
|---|---|
| `item_id`, `menu_version_id` | Which version of the menu priced this |
| `name_en`, `name_ar` | A renamed product must not rewrite past receipts |
| `unit_price` | MNU-015 — historical sales retain the price that applied |
| `tax_code`, `tax_rate`, `tax_inclusive` | A VAT change must not alter historical tax |
| `modifiers[]` with their own prices | Modifier prices change independently |
| `recipe_version_id`, `recipe_hash` | Cost of goods must reflect the recipe used |
| `cost_snapshot` | Margin at time of sale |

### On `OrderCustomerAttached`

Delivery address, coordinates, short address, directions and contact **as they were**
(APP-010). A customer who later edits their address has not changed where
yesterday's order went.

### On `OrderSubmitted`

Order-level totals, discounts, promotion identifiers and the tax summary — so a
receipt reprinted a year later is byte-identical to the original.

---

## Recipes: pointer, not copy

Recipes are snapshotted as `recipe_version_id` plus `recipe_hash` rather than by
embedding the full bill of materials in every line.

A pointer to an immutable row is exactly as safe as a copy, and dramatically
smaller at 200 orders/hour across an estate. The safety depends entirely on
`recipe_versions` genuinely being immutable — enforced by the same append-only
mechanism as the event log — and `recipe_hash` makes a violation **detectable**
rather than merely prohibited.

This is the one place the design trades a copy for a reference, and it is recorded
here precisely because that trade is only safe under a condition that must not
quietly lapse.

---

## What is *not* snapshotted

| Not snapshotted | Why |
|---|---|
| Customer name and phone on the customer record | The order references the customer; a name correction should propagate. The *delivery* address is snapshotted because it describes a past physical event. |
| Branch name, address | Reference data; a renamed branch is the same branch |
| Employee name | The audit trail references the employee identifier |
| Current stock | Not an order-time fact |

The distinguishing question: **does this value describe what happened, or who
someone is?** What happened is frozen. Who someone is, is referenced.

---

## Consequence for the menu conflict rule

Because price is snapshotted, an order priced from a **stale menu bundle is valid,
not wrong**. A branch running an old bundle during a connectivity outage produces
correct orders at the prices it knew.

Central records `PriceVarianceObserved` for finance. It does **not** re-price the
order — that would be a destructive overwrite of a financial fact (I-3) and would
mean a customer was charged one amount and the books recorded another.

This is why `../architecture/core-transaction-design.md` §5 can state the menu rule
as "central wins by construction" with no merge: there is nothing to merge, because
the order already carries its own truth.
