# Process mapping — ordering setup

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 9 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0033](../adr/ADR-0033-ordering-setup.md) (proposed), with the owner's
  decisions O1 to O5 of 2026-10-08
- **Built in:** `supabase/migrations/20261008000100_ordering_setup.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `ordering.setup` and `ordering.par_levels` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy, through git only:
- the tables: `public.order_cutoffs` and `public.branch_par_levels`
  (`20260930090000_dispatch_receipt_cutoffs_par.sql`), `public.invoice_tolerance`
  (`20261004090000_supplier_invoices.sql`), and their policies
  (`20261013120000_verification_followups.sql`);
- how an order is dated: `set_order_for_date()` (`20260930090000_dispatch_receipt_cutoffs_par.sql`),
  `place_order()` and the order guard (`20261013090000_test_fixes_orders_stock_factory.sql`),
  and one waiting order per branch and category (`20261012090000_one_pending_order_per_branch.sql`);
- the screens: `src/components/Admin/OrderingSetup.tsx` and `src/components/Customer/NewOrder.tsx`.

**Nothing is migrated here:** the warehouse holds demo data only. A real setting arrives
with the opening data (module 17), mapped as below.

---

## The screen's four sections

| Section | Warehouse | ERP |
|---|---|---|
| Cut-off times | `order_cutoffs`, one per category | **this module**, one per supplying facility (O2) |
| Approval limits | `approval_limits`, one per order type | module 8 — `erp.purchase_limit`, per facility (ADR-0032 §4) |
| Invoice tolerance | `invoice_tolerance`, one row | **not here**: frozen module 21, with the invoice matching that reads it (`CLAUDE.md` §6) |
| Par levels | `branch_par_levels`, per branch and item | **this module**, per branch and item, in a pack (O4) |

Only the administrator and the two managers had the screen. The approval limits and the
tolerance are listed so neither is mapped twice nor lost: the limits arrived with module 8,
and the tolerance stays hidden with the payments it decides.

## Which facility supplies an item

In the warehouse, `items.category` — 'warehouse' or 'factory' — said where a branch's
order for an item went. It also chose the cut-off that dated the order and the manager
who set its par. In the ERP the category is split three ways
([items mapping](./process-mapping-items-and-units.md)), and this part is a setting of its
own: **one supplying facility per item**, a warehouse or factory of the item's brand,
organisation-wide (O1). It is set by the administrator, with who, when and why, and
changed or cleared by a later decision.

**On import:** an item's category becomes its source — 'warehouse' the central warehouse,
'factory' the factory.

## Cut-off times

| | Warehouse | ERP |
|---|---|---|
| Kept per | category | supplying facility (O2) |
| Time zone | hard-coded Asia/Riyadh | the facility's own (every one is Riyadh today) |
| No cut-off | a null time | the cut-off cleared, by a decision |
| An order at or after it | for the next day | the same (O3) |
| At exactly the cut-off | after it | the same |
| 00:00 | every order next-day | the same (question 1) |
| Refused after it? | never | never |
| Who sets it | the administrator | the administrator (O5) |
| History | the last change's time and person | every decision, with who, when and why |
| Read by | every signed-in person | a branch's staff, the cut-offs of their brand's suppliers |

**How the day is fixed.** The warehouse set an order's `for_date` when the order was
first inserted, and never again: an edit to the one waiting order replaced its lines and
kept its day, so lines added after the cut-off kept the earlier day. In the ERP, module 10
asks `erp.order_day()` once, when an order is first placed, and copies the day and the
cut-off decision that dated it onto the order (I-7). The same behaviour, with the
decision recorded.

**On import:** each category's cut-off becomes the cut-off of the facility its items come
from.

## Par levels

| | Warehouse | ERP |
|---|---|---|
| Kept per | branch and item | the same |
| Unit | none stored: implicitly the sale unit | entered in a current pack, kept as entered and in the base unit (O4) |
| 0 | stored, apart from "no par" | refused: to have none, clear it (question 2) |
| Deleted with the item | yes, by cascade | never: an item is retired, and its par cleared by a decision |
| Who sets it | admin any item; each manager their category's items, at any branch | admin; the manager of the facility that supplies the item, asked there, at any branch (O5) |
| Who reads it | every signed-in person, every branch | a branch's own staff, their own branch; a supplying facility, the pars of what it supplies |
| Saved | an upsert, then a separate delete: not atomic | one decision per par, atomic |
| History | the last change's time and person; nothing once deleted | every decision, with who, when and why |

**The suggestion.** New Order showed "Par n" and, once the worker typed what the branch
had on hand, suggested `min(10000, max(0, ceil(par − on hand)))`. Nothing about the
suggestion was stored. In the ERP the par is recorded here, and module 10 suggests the par
less the typed on-hand figure, rounded up to whole packs of the pack being ordered (O4).

**On import:** a warehouse par becomes a par in the item's base unit, entered in the base
unit's own pack. A par of 0 is no par.

## Behaviours kept

- **A cut-off moves an order to the next day; it never refuses one.**
- **At the cut-off is after it, and 00:00 makes every order next-day.**
- **An order's day is fixed when it is first placed,** and kept when the waiting order
  is changed.
- **The administrator sets cut-offs; managers set pars at any branch,** for the items
  their site supplies.

## Behaviours changed

- **Where an item comes from is a setting,** not a category on the item.
- **A cut-off belongs to a facility,** read in its own time zone.
- **A par is entered in a pack,** and kept in the base unit too.
- **No par of 0.** None is cleared.
- **Every change is a decision,** with who, when and why, and its history kept.
- **A branch reads only its own pars,** and a manager scoped to a facility sets only the
  pars of what it supplies, asked there.
- **Nothing cascades.** An item is retired, never deleted, and its par stays until it is
  cleared.

## For operations to confirm

1. **Each item's source.** Is every item supplied by exactly one site, the one its
   category named?
2. **Can a warehouse ever supply two brands?** A source must be of the item's brand
   today.
3. **The cut-off times,** and whether either site wants one per weekday or per branch,
   which this does not offer.
4. **The par levels,** each branch's, in the pack the branch thinks in.

## Open

[ADR-0033](../adr/ADR-0033-ordering-setup.md) lists the owner's questions.
