# Process mapping — notifications

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 6 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0030](../adr/ADR-0030-notifications.md) (proposed), with the owner's
  decisions N1 to N4 of 2026-10-06
- **Built in:** `supabase/migrations/20261006000200_notifications.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `platform.notifications` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy:
- the migration that built it (`20261001090000_notifications_approval_limits.sql`), and
  those that added kinds or changed recipients: supplier invoices
  (`20261004090000_supplier_invoices.sql`), one pending order per branch
  (`20261012090000_one_pending_order_per_branch.sql`), the order and stock fixes
  (`20261013090000_test_fixes_orders_stock_factory.sql`), returns and transfers
  (`20261014090000_phase7_branch_stock_returns_transfers.sql`) and the cancelled-return
  alert (`20261014093000_phase7_cancel_clears_alert.sql`);
- its push function (`supabase/functions/send-push`), service worker (`public/sw.js`) and
  subscription code (`src/lib/push.ts`);
- its bell (`src/components/Layout/NotificationBell.tsx`).

**Nothing is migrated:** the warehouse holds demo data only, and a notification is a
message about a record, not the record.

---

## The mechanism

| Warehouse | ERP |
|---|---|
| `public.notifications`, one row per recipient, written by triggers on the records | `erp.notification`, one row per recipient, written by a trigger on the record's decision log |
| A push queued after each insert through `pg_net`, sent by `send-push` with VAPID keys, to every device the recipient subscribed | **No push** (N1). Sending one, or choosing who receives one, is owner-approved |
| The bell subscribed to its table through Realtime, and kept the latest 30 | The runtime has no privilege on the table. The bell is three routes: list, count unread, mark read |
| Read through row security: a user read their own rows | The routes return only the reader's own rows, still open to them (N2) |
| `link`: the page it opens, stored per row, chosen by the recipient's role | Not stored: the console builds it from the kind and the record's id |
| Kept for good; deleted by cascade with the user | Kept 90 days, then deleted (N3). Never deleted younger, by the owner either; a person is never deleted (B-11) |
| `read_at`, set by `mark_notifications_read()`, and by cancelling a return for the managers' alert about it | `read_at`, set once, by its recipient only |

## What a row holds

| Warehouse | ERP | Why |
|---|---|---|
| `data`: the order number, the branch's name, the item's name, the stock, the minimum, the unit, the status | `data`: ids and quantities only. For stock below zero, each item left below zero and its balance, as decimal text | SUP-007: a row says nothing its link would not. Names are read when the bell is read, so a renamed item is shown by its name now |
| `kind`: one of 13 | `kind`: one, `stock_below_zero`; each module adds its own | |
| `user_id`, cascading | `recipient_id`, never cascaded | B-11 |
| No facility | `facility_id`: where it happened | N2 |
| What it is about: an id inside `data` | A foreign key per source log, one per kind | A notification cannot name a record that does not exist |
| Repeats suppressed for low stock while an alert was unread | One per person per record, by a unique key | |

## Who is told

| Warehouse | ERP |
|---|---|
| Roles, organisation-wide: every active warehouse manager, or factory manager, or general manager | **Whoever can open what it is about, at the facility it happened at** (N2): the capability not hidden there, and the person granted its read there |
| Decided when written, and never again | Decided when made, and asked again whenever read: one whose access has gone is no longer shown or counted |
| The person who acted left out, except for low stock, which also reached the manager whose count or approval caused it | The person who acted left out |

## The warehouse's kinds, and where each goes

| Warehouse kind | Told | ERP |
|---|---|---|
| `low_stock`, at or below an item's minimum, once until read | Every warehouse or factory manager | Module 7, stock alerts: no minimum is held yet ([ADR-0030](../adr/ADR-0030-notifications.md), question 4) |
| — | — | **`stock_below_zero`** (N4): an override took stock below zero (ADR-0029 D1). The warehouse allowed negative stock and said nothing |
| `order_new`, `order_updated`, `order_issue` | The managers | Branch orders, with their module |
| `order_status`, `order_edited` | The branch that ordered | Branch orders, with their module |
| `po_pending`, `po_decision` | The general manager; the PO's author | Purchasing, with its module |
| `invoice_approval`, `invoice_decision` | The general manager; the invoice's author | Supplier invoices, with their module |
| `return_new`, `return_received` | The warehouse or factory manager; the return's author | Returns, with their module |
| `transfer_received` | The transfer's author | Transfers, with their module |

## Behaviours kept

- **One row per recipient,** each with its own read state.
- **A trigger on the record writes it,** so no route can forget to.
- **The person who acted is not told of their own act.**
- **Newest first, a page at a time;** the warehouse's bell showed 30, which is the
  routes' default page.
- **Mark one, or mark all.**

## Behaviours changed

- **Push is off** (N1).
- **Recipients are scoped to the facility** (N2), not organisation-wide by role.
- **No names in a row** (SUP-007).
- **Kept 90 days** (N3), not for good.
- **Read state is personal.** No action marks another person's notification read.

## Open

[ADR-0030](../adr/ADR-0030-notifications.md) lists six questions for the owner: when the
purge runs, how often the console asks, which facility's notifications the bell shows,
low stock, whether an action may mark another's notification read, and severity.
