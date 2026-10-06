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
together, and a second key binds the notification's facility to its decision's. A unique
key on recipient, kind and source means a producer that runs twice tells nobody twice.

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

### 5. The first producer, on the balance (N4)

0020 stores an override's reason only when a movement does take an item below zero. A
count never carries one: it is never refused, so it is never overridden. So a decision
carrying a reason is the event N4 names. **A count that leaves stock below zero tells
nobody**: a late count, dated before movements that took out more than it found, can do
that (ADR-0029 §4), and whether it should be told is open question 7.

`erp.notify_stock_below_zero()` runs from two ordinary statement triggers on
`erp.stock_balance`, `AFTER INSERT` and `AFTER UPDATE`, each with its transition tables
and no `WHEN`; the function decides. 0020's seam writes the decision first, then its
entries, then every balance it touches **in one statement**, each stamped with the
decision (ADR-0029 §3, step 7). An after-statement trigger fires when that statement ends,
so it reads every balance the decision wrote, at what that decision left, still under the
seam's key lock. The seam's `INSERT … ON CONFLICT DO UPDATE` fires both: either run names
every item, since it reads the balances, and the second finds the decision already told.
Each decision is told once, however many lines it has.

It acts only for a balance below zero, newly stamped by a decision that carries an
override reason. A touch that keeps the stamp, such as the seed's timestamp freeze, posted
nothing. It names the items the decision took out and left below zero, in code order, at
the balance that decision left them. An item the decision only put back, still below zero,
is not news. It tells every active person but the actor to whom §4 says it is open. It
runs inside the posting: if it fails, the movement is not recorded. It raises nothing of
its own, and writes one row per recipient.

`db:check` requires the triggers' shape: after, statement, one on insert and one on
update, each with its transition tables, enabled, not a constraint trigger, and no `WHEN`.
pgTAP proves what they tell.

**Found in review, twice.** The first design was a constraint trigger on
`erp.stock_decision`, deferred to commit, because the decision is written before the
entries it would read. It had two faults, and pgTAP 160 now holds both as controls:
- **It read balances at commit.** Two overrides in one transaction both reported the
  second's figure.
- **One setting turned it off.** `SET CONSTRAINTS ALL IMMEDIATE`, which needs no privilege,
  fired it at the insert, before any entry existed, and it told nobody. Any later route
  that hurried its own deferred keys would have silenced every notification.

The second was a row trigger on the balance. It was exact, but it ran once per item a
decision left below zero, each run rebuilding the list and asking every person again: a
500-line override did that 500 times inside the stock write (found by the PR's automated
review).

The synthetic seed holds the producer off while it writes its balances (0070), so two
builds stay identical; the seed holds no notification.

### 6. Three routes, behind one capability

The bell is three routes, each asking `platform.notifications` `read` at the facility the
person is working at, as every read does:
- **`erp.list_notifications()`** lists the person's own notifications, newest first,
  1 to 100 at a time. A page ends before the last `seq` shown: a whole number, which no
  client can round. A microsecond moment read into a JavaScript `Date` loses three digits,
  and a cursor rounded down would skip the rows that shared it (found in review). It returns each with its facility's code
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

## Addendum — 2026-10-06: the data layer (module 6, step 2)

The three routes are reachable over HTTP through one edge function, `notifications`
(`supabase/functions/_shared/notifications.ts`), built as `stock` is (ADR-0029's step 2
addendum). Nothing about the routes changed.

- **The routes:**
  - `GET /` lists the person's notifications, newest first: 30 a page unless `limit`
    asks for 1 to 100. A full page answers `next_before`, the last `seq` as decimal text,
    and the next page sends it back as `before`.
  - `GET /unread` answers how many are unread, as a number.
  - `POST /read` marks those named in `notification_ids`, 1 to 100, or every unread one
    when the body says `all: true`, and answers how many it marked.
- **The actor is the session's,** through `withSession` (ADR-0025). Nobody reads, counts
  or marks another person's notifications by naming them: a Node control test holds this
  for all three routes, and the Deno test has the factory manager name the warehouse
  manager's notification and mark nothing.
- **The facility** is `facility_id`, in the query of a read and in the body of the mark,
  as every read asks it. Left out, the bell is asked organisation-wide, which 0021's gate
  answers as it answers any read.
- **The edge checks shape, the database checks rules.** Three shape rules are this
  module's own:
  - **A page ends before a `seq`,** decimal text of a positive int8, checked to fit; a
    moment is refused as a cursor (§6). The driver keeps the `seq` as text, as it keeps a
    stock card's, so it is never rounded past 2^53.
  - **Marking all is said, not implied.** Both `notification_ids` and `all`, or neither,
    is a 400, and so is an empty list or `all: false`. A list that lost its ids on the way
    is never read as every one.
  - **Marking is idempotent.** Marking one already read marks nothing and is no error,
    so a lost answer is retried as it was sent, with no decision id: there is no log, only
    the reader's own read state.
- **Refusals** map through `_shared/refusal.ts`, unchanged: a hidden bell or a person
  without one is `forbidden` (403); a page or a list of the wrong size is `invalid` (422),
  in 0021's own words; anything else is a 500 that says nothing.
- **Tested** by `_shared/test/notifications.test.ts` (Node: the actor, every shape rule,
  every refusal) and `_deno/test/notifications.test.ts` (Deno, end to end, as `erp_edge`,
  rolled back): the factory manager overrides at the factory **through the stock function**,
  and the administrator and the warehouse manager read the item at the balance that
  decision left, page, count and mark; the factory manager is not told of their own act;
  a cashier's bell is empty.

## Addendum — 2026-10-06: the screens (module 6, step 3)

The bell is in the console (`apps/console/src/notifications.ts`,
`src/screens/Notifications.tsx`). Nothing about the routes changed.

- **The bell sits in the top bar,** beside the person's name, not in the menu. It is
  shown where `platform.notifications` is not hidden and the person holds read on it, as
  a menu entry would be. A typed `#notifications` meets the same answer. A badge counts the
  unread, up to "99+", and the bell's label says the number in words for a screen reader.
- **The count is asked only on the person's own doing:**
  - when the shell opens;
  - when the facility worked at changes;
  - on every move to another screen;
  - after a mark;
  - when they come back to the tab.

  **Never on a timer.** Every request a session makes moves its idle clock (0014,
  `erp.resolve_session()`). A bell asking once a minute would have kept an unattended
  console signed in for good, past the 30 minutes idle that should end it (found
  designing this step). It answers question 2. A click on the bell from its own page,
  and coming back to the tab, read the page's list again too, so the list and the badge
  agree. One residual: an operating system can mark a window visible again on its own,
  for instance when another application's window closes over it. The count is then asked
  once, with nobody there, and the idle clock moves once. Review judged this a small
  risk, and it is left as is.
- **The page** (`#notifications`) lists the person's own, newest first, 30 at a time,
  with "Load more" paging by `seq`. Each shows:
  - what happened and where: "Stock went below zero at" and the facility's code;
  - when, in Riyadh time;
  - whether it is unread;
  - the items it names, with today's code and name, at the balance the decision left,
    in the item's base unit, as text.
- **Marking read is the person's own:** one at a time, or "Mark all read".
  - **"Mark all read" marks the unread ones listed, by id, never `all`.** `all` would
    also mark one that arrived after the page was loaded, which the person has not seen:
    it would leave the bell at zero and show up later already read (found in review).
    Such a notification stays unread, and the bell says so.
  - A selection with nothing in it sends nothing, and the edge and 0021 refuse an empty
    list rather than read it as "all".
- **Opening one goes to its decision, and marks it read once it has gone,** by
  `openTarget()`. A switch the person declines leaves it unread (found in review).
  - where the person works at the facility it happened at, it opens there;
  - from anywhere else they may work, including organisation-wide, a button naming the
    facility ("Work at … and open") switches the facility worked at first, since a stock
    screen reads only that facility (ADR-0029's step 3 addendum), and asks first while a
    form holds typed lines;
  - where they may not work, it says so and offers nothing;
  - a kind the console cannot open yet offers nothing, and says nothing. Only a kind the
    console knows is worded, so a kind named like another string's tail cannot borrow
    that string.
- **Tested** by `apps/console/test/notifications.test.ts` (Node), which:
  - checks that no call names an actor;
  - checks that the cursor travels as text, and that the page's "Mark all read" sends
    the ids it lists and asks the bell again after the mark is saved;
  - checks that nothing to mark sends nothing;
  - checks where each one opens;
  - checks that the bell's door is 0021's capability;
  - checks that every kind 0021 knows has words;
  - reads `App.tsx`, the page and the logic, and fails on any timer.

  Sixteen deliberate breaks each failed a named test. A browser run against the scratch
  database and edge functions passed 29 checks, in English and Arabic:
  - an override at the factory rang the warehouse manager's bell on their next click;
  - opening it switched them to the factory and its decision;
  - the factory manager's bell stayed quiet;
  - the administrator's "Mark all read" left the warehouse manager's own unread one alone;
  - one that arrived after the page was loaded survived "Mark all read", and a click on
    the bell showed it.

## Addendum — 2026-10-06: the staff testing pack (module 6, step 5)

The pack is written, in English and Arabic:
[`docs/lab/uat/notifications.md`](../lab/uat/notifications.md) and
[`ar/notifications.md`](../lab/uat/ar/notifications.md).
- **Who runs it.** The warehouse manager is the participant. The factory manager makes the
  overrides on a second computer, the administrator checks that marks are personal and
  who else is told, and the accountant has a bell that stock never rings.
- **What it evidences.** It evidences SUP-P03 whole, and is cited there alone. It
  exercises SUP-P01, SUP-P02, SUP-005, SUP-006 and SUP-007 without evidencing them. A
  session cannot show what a row stores, a person's access being taken away, or anything
  90 days old.
- **Before the session.** Its owner's table asks this ADR's open questions as staff will
  meet them, with ADR-0029's questions 2 and 9 and where the bell is switched on.
- **Language.** The session runs in each person's own language, the console's Arabic
  first, and one part switches to the other language.

Writing the pack found two things about the console. Neither is the bell's, and the pack
is written around both:
- **An idle sign-out can give the wrong reason.** After 30 minutes untouched, opening a
  screen sends several requests at once. The database answers `idle` only to the first
  and `ended` to the rest (0014), and the console shows whichever answer arrives last. On
  Current stock the facility check, which drops its failures, can take the `idle` answer.
  The person then reads "Your session has ended" rather than "You were signed out after
  30 minutes without activity". The pack accepts either, and the observer notes which. A
  fix keeps the first reason and stops the facility check swallowing a session's end.
- **Every test person's short code reads the same.** A stock entry shows who recorded it
  as the first eight characters of their id, and every synthetic id begins with the same
  eight. The pack asks whether the participant needed to know who; real ids will differ.

## Open, for the owner and for UAT

1. **When is the purge run?** In a hosted project, a scheduled job (`pg_cron`, or an
   edge function on a schedule) would call `erp.purge_notifications()`. Either is
   hosted configuration, owner-approved one action at a time. Until then, nothing older
   than 90 days is shown, but it is still stored.
2. **How often does the console ask?** *Answered by the screens (step 3 addendum): never
   on a timer.* Every request moves the session's idle clock, so a bell that asked once a
   minute would keep an unattended console signed in for good. It asks on the person's
   own doing, so a notification shows on their next click, not the moment it is made. If
   that is too slow somewhere, Realtime would need a grant the runtime does not hold, and
   a decision of its own.
3. **Which facility's notifications does the bell show?** Today, every facility's the
   person may open. A worker who switches between the warehouse and the factory sees
   both in one list, each marked with its facility. Opening one from the other facility
   switches "Where you are working" first (step 3 addendum), and the console asks before
   leaving a typed form (ADR-0029's step 3 addendum). Should the bell show only the
   facility worked at instead?
4. **Low stock.** The warehouse's most frequent alert. It needs a minimum per item and
   facility, which no module holds yet, and a rule for re-alerting while it stays low.
   The plan gives it module 7, stock alerts, which would add its kind here. Should the
   person whose movement took stock low be told too, as the warehouse did?
5. **Should an action ever mark someone else's notification read?** The warehouse did,
   for a cancelled return. Here read state is personal; a later module would add its own
   "this has been dealt with" to what the bell shows, not change anyone's read state.
6. **Severity (SUP-005).** Is an override below zero a warning, or something a general
   manager must see? Today it tells only the facility's readers of stock.
7. **A count that leaves stock below zero.** A late count can, without an override, and
   tells nobody (§5). Should it?

## Alternatives considered

- **Recipients by role, organisation-wide, as the warehouse did.** Rejected by N2: it
  tells people about facilities they cannot open, which SUP-007 forbids.
- **A notification that copies names and the reason.** Rejected: a row would disclose
  what its link might not, a free-text reason naming a person could not be erased within
  90 days, and a renamed item would be shown by its old name.
- **A constraint trigger on `erp.stock_decision`, deferred to commit.** Built first, and
  rejected in review (§5): it read balances at commit, and `SET CONSTRAINTS` could fire it
  before there was anything to read.
- **A trigger on `erp.stock_ledger`.** Rejected: the entries are written before the
  balances, so it would read the balance before the decision.
- **A row trigger on `erp.stock_balance`.** Built second, and rejected in review (§5): it
  redid the whole notification once per item.
- **Calling the producer from `erp.post_stock()`.** Equally exact, since the seam knows
  the balances it wrote. Rejected for now: it means replacing 0020's whole seam in a new
  migration to add one call, and the balance triggers bind every writer of a balance,
  which is the seam alone.
- **Keeping notifications for good.** Rejected by N3.
