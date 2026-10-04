# Process mapping — transfer prices

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 3 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0027](../adr/ADR-0027-transfer-prices.md) (proposed)
- **Built in:** `supabase/migrations/20261004000400_transfer_prices.sql`
- **Status:** a mapping for review, not yet approved. As for items and suppliers,
  operations' sign-off is a manual precondition of the migration that promotes
  `inventory.transfer_prices` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy: its `docs/SYSTEM.md` §5
(`items.unit_price`, `item_price_history`, `order_items.unit_price`), §6 (permissions)
and §7 (`set_item_unit_price()`, the price-recording and order-line triggers), and the
migrations that added the column (`20251014081523_add_item_pricing_for_accountants.sql`)
and its history and order-line snapshot (`20260929210000_receipts_counts_prices_reports.sql`).
**Nothing is migrated**: the warehouse holds demo data only, and the ERP is re-seeded
synthetically.

---

## One column becomes two tables

| Warehouse | ERP |
|---|---|
| `items.unit_price numeric(10,2) default 0`, changed in place | `erp.transfer_price`, one row per price ever set, each from a moment |
| `item_price_history`: old price, new price, who, when | `erp.transfer_price_decision`: every price set or withdrawn, with who, when and **why** |
| `order_items.unit_price`, copied by a trigger when the line was added | Module 10's order line copies `erp.transfer_price_at()`'s answer into its own record (I-7) |

## Field by field

| Warehouse | ERP | Why |
|---|---|---|
| One price per **item** ("per sale unit") | One price per **conversion** — per carton, per piece | A branch orders by the pack and is charged for the pack. The warehouse's item had one unit; the ERP's has several (ADR-0024) |
| `numeric(10,2)` | `price_minor bigint` and `currency` | Money is integer minor units with a currency, never a decimal that rounds (canonical-model.md) |
| Default `0` | No row: unpriced. `0`: free, decided | The warehouse could not tell "nobody set a price" from "free", and sent unpriced items out at nothing |
| In force the moment it was saved | `effective_from`: now, or a moment set ahead | "From the first of the month the carton is 185 SAR" is one decision made today |
| (none) | Never backdated | An order placed yesterday was placed at yesterday's price (MNU-015's rule for selling prices) |
| (none) | A price set ahead can be withdrawn before its moment | A mistake caught in time; a price in effect is history and stays |
| `changed_by`, `changed_at` | `actor_id`, `decided_at`, and a stated `reason` | Why a price changed is now recorded |

## Behaviours kept

- **The administrator and the accountant set prices**, as `set_item_unit_price()` let
  them. The migration grants the administrator; the seed grants the accountant, as for
  the readers. ADR-0027's open question 3 asks who else.
- **A branch sees the price it is charged**, at its branch, and only its brand's.
- **An order line keeps the price it was placed at**, whatever the price later becomes.
  In the warehouse a trigger enforced it; here the order line copies the price into its
  own immutable record (module 10, I-7).
- **No VAT on a transfer**, as branch orders carried none. ADR-0027's open question 1.

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| An unpriced item went out at 0, silently | No price is a refusal (`transfer_price_exists`); 0 is a decision |
| One price for an item, whatever the pack | A price names a conversion through the I-7 seam |
| A price change took effect on save, so a change meant for the 1st had to be made on the 1st | A price takes effect from a moment, set ahead |
| History rows could not say why a price changed | Every decision states a reason |
| `numeric(10,2)` money | Integer minor units and a currency |

## For sign-off

Operations and finance should confirm before this mapping is approved:

1. A price per pack — carton, piece — is how branches are charged, and an item ordered
   in a pack with no price should be refused rather than sent at 0 (ADR-0027, questions
   2 and 4).
2. Transfers between branches and the warehouse carry no VAT, including between legal
   entities if the brands are separate companies (question 1).
3. Prices set ahead, effective from midnight Riyadh time on a chosen day, match how
   price changes are announced today.
