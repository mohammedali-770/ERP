# ADR-0030 — Notifications: an in-app bell, rung by the records people can open

- **Status:** Proposed. Built as module 6's database layer on 2026-10-06. The owner
  decided N1 to N4 (§1) the same day; the questions below are decided before the module
  is switched on
- **Date:** 2026-10-06
- **Requirements:** SUP-005 · SUP-006 · SUP-007 · SUP-P01 · SUP-P02 · SUP-P03 · INV-008 ·
  INV-P02 · CAP-P02 · CAP-P04 · PRG-014
- **Related:** ADR-0012 · ADR-0025 · ADR-0029 (D1) · invariants I-1, I-6 ·
  `supabase/migrations/20261006000200_notifications.sql` ·
  [`../estate/process-mapping-notifications.md`](../estate/process-mapping-notifications.md)

## Context

The warehouse system had a bell, and it worked. Triggers on its orders, purchase orders,
supplier invoices, returns, transfers and stock counters wrote one `public.notifications`
row per recipient. The app read its own rows through row security and Realtime. When the
recipient had a device subscribed, the insert also queued a call, through `pg_net`, to a
`send-push` edge function holding VAPID keys. The process mapping sets out what it did in
full; four things about it matter here:

- **Recipients were roles, organisation-wide.** A low-stock alert at the factory went to
  every active factory manager, whichever factory they worked at. Nothing asked whether
  the person could open what the alert was about.
- **Rows carried names.** Each held the item's or branch's name, and the link it opened,
  as it was when written. A renamed item kept its old name in every alert, and a row
  disclosed whatever it said to whoever received it.
- **Nothing was ever deleted,** except by cascade when the user was.
- **Read state was not only personal.** Cancelling a branch return marked the managers'
  alert about it read.

The PRD asks for alerts with severity, ownership, deduplication and escalation (SUP-005),
delivered through the dashboard, employee-app push, email, WhatsApp and in-POS messages
(SUP-006), with content and recipient rules that prevent disclosure through an
inappropriate channel (SUP-007). Sending a push, or changing who receives one, is
owner-approved (`CLAUDE.md` §4).

## Decision

### 1. The owner's four decisions (2026-10-06)

- **N1 — The in-app bell only.** No push subscription, no push function, no keys. Each of
  SUP-006's other channels arrives as its own approved step.
- **N2 — A notification goes to whoever can open what it is about, at the facility it
  happened at.** Recipients are decided when it happens, and it is shown only while they
  still can open it. Nobody is told of something they could not open (SUP-007). Proposed
  as **SUP-P01**.
- **N3 — Kept 90 days, then deleted.** A notification is a message about a record, not
  the record: the stock decision keeps its own history for good. Proposed as **SUP-P02**.
- **N4 — The mechanism, and one producer.** Stock taken below zero by an override
  (ADR-0029 D1) tells that facility's readers of stock. Later modules add their own kinds.
  Proposed as **SUP-P03**.

### 2. One table, holding ids and quantities

`erp.notification` holds one row per recipient:
- its kind (`stock_below_zero`, for now);
- the recipient;
- the facility it happened at;
- what it is about;
- a small `data` object;
- when it was made, and when it was read.

**What it is about is a real foreign key.** Each source log has its own column, and a
check binds each kind to exactly one of them. A later module adds its column and its kind
together. A unique key on recipient, kind and source means a producer that runs twice
tells nobody twice.

**`data` holds ids and quantities, never names or free text.** For a stock notification,
it holds the items left below zero and the balance each was left at, as decimal text. The
override's reason, which may name a person (ADR-0029 question 9), stays on the decision.
Codes and names are read when the bell is read, through the reader's own access. So a
notification discloses nothing its link would not (SUP-007), and a renamed item is shown
by its name now.

### 3. Read once, kept 90 days, binding the owner

A trigger holds three rules, for the owner and the routes alike:
- **The only change a row takes is from unread to read, once.** Nothing else about it
  changes, and it is never marked unread again.
- **A row younger than 90 days is never deleted.**
- **The table is never truncated.** Past 90 days, rows are deleted one by one.

`erp.purge_notifications()` deletes what is past 90 days. It is owner-only: the runtime
cannot call it. Until something runs it, the routes already show nothing older (§6), so
N3 holds for what people see even before it holds for what is stored. Scheduling it in a
hosted project is open question 1.

**Read state is personal.** Nothing marks another person's notification read: not a
route, not a later module's action. The warehouse's "cancelling a return clears the
managers' alert" becomes, when returns arrive, a question for that module (open
question 5).

### 4. Who is told (N2)

`erp.notification_is_open_to(person, kind, facility)` answers whether a person may open
what a notification of this kind is about, at that facility, now. For stock below zero,
it asks the two reads 0020's stock routes ask: stock and items not hidden there, and the
person granted `read` on both there. It is asked twice:
- **when a notification is made,** to choose its recipients;
- **whenever one is read,** so one whose access has gone is no longer shown or counted.

So a role grant scoped to one facility is honoured. A factory manager whose role holds at
the factory alone is not told of an override at the warehouse; the warehouse manager,
who reads stock everywhere, is told of one at either. The accountant, who reads no
stock, is told of neither. This is the difference from the
warehouse's roles-everywhere rule.

**The person who acted is not told of their own act.** They stated the reason a moment
ago. The warehouse made one exception, low stock, which reached the manager whose count
caused it; there is no low-stock alert here yet (open question 4).

### 5. The first producer, deferred to commit (N4)

0020 stores an override's reason only when a movement does take an item below zero. So a
stock decision carrying one is exactly the event, and no other is.

`erp.notify_stock_below_zero()` runs from a constraint trigger on `erp.stock_decision`,
`AFTER INSERT`, **deferred to commit**, and only when the decision carries an override
reason. Deferral is the design. 0020's seam writes the decision first and its entries and
balances after it (ADR-0029 §3, step 7), and what to tell is which balances the decision
left below zero. A trigger that fired at the insert would find no entries, and tell
nobody. `db:check` requires the trigger, deferred; pgTAP proves what it tells.

It names only the items the decision left below zero, in code order, at their balance at
commit. It tells every active person but the actor to whom §4 says it is open. Being
deferred, it runs in the poster's transaction: if it fails, the movement is not recorded.
It raises nothing of its own, and writes one row per recipient.

### 6. Three routes, behind one capability

The bell is three routes, each asking `platform.notifications` `read` at the facility the
person is working at, as every read does:
- **`erp.list_notifications()`** lists the person's own notifications, newest first,
  paged by moment and id, 1 to 100 at a time. It returns each with its facility's code
  and its items' codes, names and base units, read now.
- **`erp.count_unread_notifications()`** counts the person's unread ones.
- **`erp.mark_notifications_read()`** marks those named, or all when none are named; an
  empty or over-100 list is refused rather than read as "all". It answers how many it
  marked, so marking one already read marks nothing and is no error: a second tab, or a
  retry, asks the same.

All three see only the person's own rows, younger than 90 days, still open to them (§4),
**from every facility**, not only the one the person is working at. The facility asked at
is where the gate is asked. Which facility's notifications the bell should show is open
question 3.

`erp_app` has no privilege on the table, only the three routes; not the producer, the
guard, the rule or the purge. Marking read is asked as `read`, because it changes nothing
anyone else sees.

### 7. Hidden, as every module ships

`platform.notifications` is registered with no decision, so no real database shows a
bell until a later migration promotes it (CAP-P02, CAP-P04). 0021 grants the
administrator `read`; the synthetic seed grants every role a bell. The accountant holds a
bell that stock never rings, because the grant is only the bell: what rings it is each
kind's own rule.

### 8. Kept out, deliberately

- **Push, email, WhatsApp, in-POS** (N1). Sending a push, or choosing who gets one, is
  owner-approved, and each is its own step.
- **Realtime.** The warehouse's bell subscribed to its table; the ERP's runtime has no
  privilege on the table, and the console reaches the database only through edge
  functions (ADR-0023). The console will ask (step 3; open question 2).
- **A stored link.** The warehouse stored, per row, the page it opened, chosen by role.
  Here the console builds it from the kind and the source id, so a moved screen breaks
  no stored row.
- **Severity, ownership, deduplication beyond "once per person per record", and
  escalation** (SUP-005). None has a producer that needs it yet. This module does not
  evidence SUP-005; it provides what it will be built on.
- **The warehouse's other kinds:** new and changed orders, purchase-order approvals,
  supplier invoices, returns, transfers and low stock. Each arrives with its module, and
  each module decides its recipients by N2's rule.

## Consequences

- A later module adds a kind, a source column and a producer, and extends
  `erp.notification_is_open_to()` with its own rule. The table, the guard and the routes
  do not change.
- A notification can never say more than its link would show, and stops being shown when
  its link would stop opening.
- The bell's history is 90 days. Anyone needing to know what happened longer ago reads
  the record itself, which is kept for good.
- A producer failing fails the write that caused it. That is the price of a
  notification that cannot be lost between a commit and a queue; there is no queue.

## Open, for the owner and for UAT

1. **When is the purge run?** In a hosted project, a scheduled job (`pg_cron`, or an
   edge function on a schedule) would call `erp.purge_notifications()`. Either is
   hosted configuration, owner-approved one action at a time. Until then, nothing older
   than 90 days is shown, but it is still stored.
2. **How often does the console ask?** A bell that asks every minute is one request per
   open console per minute. Realtime would need a grant the runtime does not hold, and a
   decision of its own.
3. **Which facility's notifications does the bell show?** Today, every facility's the
   person may open. A worker who switches between the warehouse and the factory sees
   both in one list, each marked with its facility. Opening one from the other facility
   would switch "Where you are working" first, and the console asks before leaving a
   typed form (ADR-0029's step 3 addendum).
4. **Low stock.** The warehouse's most frequent alert. It needs a minimum per item and
   facility, which no module holds yet, and a rule for re-alerting while it stays low.
   The plan gives it module 7, stock alerts, which would add its kind here. Should the
   person whose movement took stock low be told too, as the warehouse did?
5. **Should an action ever mark someone else's notification read?** The warehouse did,
   for a cancelled return. Here read state is personal; a later module would add its own
   "this has been dealt with" to what the bell shows, not change anyone's read state.
6. **Severity (SUP-005).** Is an override below zero a warning, or something a general
   manager must see? Today it tells only the facility's readers of stock.

## Alternatives considered

- **Recipients by role, organisation-wide, as the warehouse did.** Rejected by N2: it
  tells people about facilities they cannot open, which SUP-007 forbids.
- **A notification that copies names and the reason.** Rejected: a row would disclose
  what its link might not, a free-text reason naming a person could not be erased within
  90 days, and a renamed item would be shown by its old name.
- **An immediate trigger on `erp.stock_ledger` or `erp.stock_balance`.** Rejected: the
  balance is written once per item, and the decision once per document, so a trigger on
  either would tell once per item or need its own bookkeeping. One deferred trigger on the
  decision tells once per document.
- **Calling the producer from `erp.post_stock()`.** Rejected: every later module would
  have to remember to call it, and a merged migration is never edited. The trigger binds
  every writer, the seam's later callers included.
- **Keeping notifications for good.** Rejected by N3.
