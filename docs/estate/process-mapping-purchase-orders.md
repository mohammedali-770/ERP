# Process mapping — purchase orders and receipts

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 8 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0032](../adr/ADR-0032-purchase-orders.md) (proposed), with the
  owner's decisions P1 to P4 of 2026-10-07
- **Built in:** `supabase/migrations/20261007000400_purchase_orders.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `procurement.purchase_orders` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy:
- the tables (`20251012122409_create_inventory_management_system.sql`), receipts
  (`20260929210000_receipts_counts_prices_reports.sql`), totals
  (`20260929180000_phase0_close_the_holes.sql`), approval limits and notifications
  (`20261001090000_notifications_approval_limits.sql`), receiving
  (`20261007090000_phase4_followup_daily_po_mark.sql`), and the current routes, guards and
  numbering (`20261013090000_test_fixes_orders_stock_factory.sql`);
- the screens: `src/components/Warehouse/WarehousePurchaseOrders.tsx`,
  `src/components/Factory/RawMaterialPurchaseOrders.tsx`,
  `src/components/GeneralManager/PurchaseOrderApprovals.tsx`,
  `src/components/Accountant/AccountantPOView.tsx` and `AccountantRawMaterialPOView.tsx`,
  `src/components/Purchasing/ReceivePOModal.tsx` and `poForm.ts`, and
  `src/utils/printPurchaseOrder.ts`.

**Nothing is migrated here:** the warehouse holds demo data only. Open orders, if any,
arrive with the opening data (module 17), mapped as below.

---

## The order

| | Warehouse | ERP |
|---|---|---|
| Families | two: warehouse items, raw materials | one (P1) |
| Delivered to | implied by the family: the warehouse or the factory | named: one warehouse or factory |
| Lines | an item, or a raw material, in its single purchase unit | a pack a supply of that supplier sells (ADR-0026), copied whole (I-7) |
| Supplier check | the supplier's coarse type | an active supplier, and an active supply of each pack |
| Price | `numeric(12,2)` per unit, no currency | whole halalas per pack, SAR (P2) |
| VAT | one rate per order; 15% fixed in the warehouse form, editable on raw materials | one rate per order, stated with it |
| Totals | computed by a trigger | computed when raised, fixed: subtotal, VAT rounded to the halala, total |
| Number | `WPO-`/`RPO-YYYYMMDD-####`, the Riyadh day, a series per family | `<facility>-PO-YYYYMMDD-NNNN`, the facility's day, a series per facility; never burned |
| Editing | raw-material orders while pending or on hold; warehouse orders never | none: cancel and raise again (ADR-0032 question 2) |
| Deleting | the daily sheet deleted its pending orders on every save | never |
| Lines cascade | from their order; a deleted item's line nulled | never (B-11) |

## Approval

| | Warehouse | ERP |
|---|---|---|
| Who | the general manager, or the administrator | whoever holds approve at the facility (P3) |
| Limit | per family, compared **including** VAT | per facility, compared **before** VAT |
| Within the limit | approved, with no approver recorded and "AUTO-APPROVED" appended to the notes | approved when raised, recorded as approved by the limit decision in force |
| One's own order | an administrator could approve it | refused, approving and rejecting alike (PRC-004); the raiser cancels |
| Withdrawing an approval | approved became rejected | an approved order with nothing received is cancelled |
| On hold | raw materials only | not built (question 3) |
| A stale decision | refused only by the screen | the order's row lock and state |

## Receiving

| | Warehouse | ERP |
|---|---|---|
| What it writes | a counter, `+= quantity × the current ratio` | a stock decision of kind receipt through 0020's seam (ADR-0029) |
| Partial | yes | yes |
| More than ordered | refused | refused, read under the order's lock |
| Closed short | a flag appended to the notes | a decision: closed, with a reason |
| The moment | `now()` | stated when entered late, on the facility's calendar (D3) |
| A retry | posted again while quantity remained | answered as a retry |
| Undoing | impossible; a count corrected the stock and left the order wrong | reversed through the order, whole, once, before a count (P4); the lines reopen |
| Another pack | n/a | not built: received in the pack ordered (question 7) |

## Behaviours kept

- **Approval above a limit**, with orders within it approved at once.
- **Partial receipts**, never more than ordered, and **closing short**.
- **A number per day**, readable on paper.

## Behaviours changed

- **One kind of order**, naming where it goes.
- **Money in halalas with its currency**, a commitment only.
- **The limit is compared before VAT,** so the VAT rate cannot move an order under it.
- **Every approval names who approved it,** a person or a limit, and nobody approves their own.
- **A receipt is a stock movement,** dated by the facility's calendar, retried safely,
  and reversible.
- **Nothing is deleted or cascaded.**

## Not here

Invoices, three-way matching, payment terms in use, payments and journal postings are the
frozen modules 21 and 22 (CLAUDE.md §6); moving-average cost is module 16. The daily
sheet's cash purchases are module 15's (ADR-0032 question 9).

## Open

[ADR-0032](../adr/ADR-0032-purchase-orders.md) lists the owner's questions.
