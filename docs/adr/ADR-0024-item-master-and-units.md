# ADR-0024 — One item master, and conversions that cannot be read two ways

- **Status:** Proposed. The owner decided the one-master shape on 2026-10-02; the
  rules below are this ADR's proposal for how it holds
- **Date:** 2026-10-02
- **Requirements:** INV-002 · INV-005 · PRG-014 · MFG-012 · CAP-P02 · CAP-P04 · CAP-P06 ·
  IAM-003 · IAM-006 · IAM-008
- **Related:** ADR-0012 · ADR-0021 · ADR-0023 · invariants I-6, I-7, I-8 ·
  `supabase/migrations/20261002000200_items_and_units.sql` ·
  [`../estate/process-mapping-items-and-units.md`](../estate/process-mapping-items-and-units.md)

## Context

Items and units are the first Phase 4 module, and every later table references them:
stock, purchasing, recipes, branch orders, lots, costing, POS import. So the choices
made here are the most expensive to reverse in the whole consolidation.

The warehouse system kept three masters — `items`, `raw_materials` and
`warehouse_units` — and its known defects cluster here:

- an item's category and serial could be edited after lots and orders named them;
- units were free text, and factory items had none at all;
- a pack ratio was a `numeric(10,2)` anyone could change at any time, re-denominating
  stock and re-converting approved purchase orders on the day they were received;
- an item with no ratio was read as ratio 1;
- nothing could be retired, so a discontinued item stayed orderable for good, and
  deleting one was guarded by a list of ten later tables.

The owner decided on 2026-10-02 that the ERP has **one item master with a type**
(INV-002), replacing `items` and `raw_materials`.

The design was produced by three independent drafts — from the requirements, from what
warehouse users rely on, and from what later modules need — scored and merged by a
judge. It was then built, and proved by the 134 cases of
`supabase/tests/080_items_test.sql` (those marked CONTROL among them) and by `db:check`.
Separately, one-off mutation runs each removed one mechanism and confirmed that 080 or
`db:check` then failed. That harness is not committed, so those runs are a record of
what was checked, not something this repository can reproduce.

## Decision

### 1. One master, every kind, and identity fixed from creation.

`erp.item` holds every INV-002 kind in a `text` column with a named check. An item's
**code, kind, base unit and brand are fixed from creation**, by a row trigger that binds
the owner too. Not "once used": "used" is knowable only by enumerating every later
table, and some references live in JSON no catalogue scan sees. A mistaken identity is
corrected by retiring the item and creating another; the old code is never reused.
Nothing is deleted either: row triggers refuse DELETE on items and conversions, and a
statement trigger on each table refuses TRUNCATE, which row triggers never see.

### 2. Units come from a closed register; conversions are a star.

`erp.unit` is changed by migration only. Mass, volume and count carry an exact size
against g, ml or piece; a pack has none. Every item's conversions in `erp.item_unit`
convert **straight to its base unit** — there is no unit-to-unit edge, so two paths
cannot disagree — and every active conversion of one physical dimension must agree with
the others, checked by trigger. A unit in an anchored dimension may be left for the
system to derive, and a stated factor must equal the derived one. A pack's size is always stated. **No conversion is ever assumed**: a missing one
raises, and nothing reads it as 1.

### 3. Conversions are immutable; a pack-size change is retire plus add.

A conversion's item, unit and factor never change, and retirement is final (I-6). A
supplier moving from cartons of 12 to cartons of 24 retires one row and adds another,
so a line that used ×12 goes on meaning ×12 (I-7).

### 4. Later rows copy the conversion through a four-column seam.

`(item_unit_id, item_id, unit_key, factor)` is a unique key. Every later
quantity-bearing row copies those four values and references them together, so its
unit and factor are provably the conversion's and the conversion provably its own
item's — I-7 by structure, which survives even an owner who disables a trigger.

### 5. The master knows nothing of later modules.

No stock, minimum, cost, price, supplier, display order or ordering flag lives on the
item, and no trigger on it writes another module's table. Later modules reference the
item; never the reverse. That breaks the warehouse's items-and-stock cycle, and it is
why minimum stock goes to the stock module per location (INV-013).

### 6. Hidden hides the data.

The runtime holds no privilege on the item tables; it writes through six recorded
routes and reads through three gated functions, each of which calls
`erp.assert_permitted()` first. `db:check`'s `every-runtime-definer-route-is-gated`
fails on any definer function the runtime may call that does not. So a `hidden` capability hides the data
and not only the menu (CAP-P02), and brand-private reads at a facility (ADR-0012) are
enforced in the database. This goes one step past ADR-0022, where the runtime may read
`erp.person`.

### 7. Every change is a recorded decision carrying the whole state.

`erp.item_decision` is append-only, protected by grant and by a trigger that also
covers `TRUNCATE`, and each row carries the full state it put in force. Items hold no
personal data, so — unlike `erp.identity_decision` — the log can. A projection row is
therefore checkable by **equality** with its latest decision, which `db:check`
asserts.

## Consequences

- `inventory.items` is registered by the migration and is **hidden** in every real
  database until a later migration promotes it after the edge layer, the screens and
  staff acceptance testing exist. The seed's `pilot` decision is synthetic.
- Every later module must read items through its own `security definer` functions; an
  invoker helper granted to the runtime that touches `erp.item` fails with 42501.
- A typo in a code, kind or base unit costs a retired item and a burned code. The
  create form must make the fixed fields explicit.
- **A retry is recognisable.** Every write route locks and checks its decision id before
  any other rule, so a retry of a write that already committed fails 23505 naming
  `item_decision_pkey` ("decision … is already recorded"), rather than as a taken code
  or a stale form. That holds when the retry overlaps its original too: the lock makes
  the retry wait for the original's transaction to end, and `db:check` proves it with
  two sessions on every write route. The edge then confirms through
  `erp.item_history()` before reporting success.
- Factors are exact to six decimal places, and a derived factor that does not
  terminate is refused ("declare the smaller unit first"). The stock module must
  choose its storage scale for base quantities before it is built.

## Open, for the owner and for UAT

Recorded rather than guessed. None blocks this module's tables; each must be answered
before the module it names.

1. **Who may write items once real staff use the system.** The warehouse's screens let
   only the administrator write items and raw materials. Its row-level security also
   let the factory manager update raw materials (its `SYSTEM.md` §6), a workaround for a
   stock trigger that no screen used. The migration grants write to the administrator
   alone, so that is narrowed. Should write by kind be restored or added — a factory
   manager maintaining raw ingredients, say?
2. **Code format.** People type 1–24 characters of A–Z, 0–9, `.`, `_` and `-`, as the
   warehouse's serials were. Are system-generated codes per kind wanted? Codes are
   reserved forever, so this is expensive to change once real data exists.
3. **Two pack sizes under one unit word** — 10 kg cartons from one supplier and 12 kg
   from another. Refused here as the ambiguity INV-005 names; a second word or retire
   and add is needed. Bites first in the suppliers module.
4. **Catch-weight items** — bought by the piece, costed by weight. A fixed factor is
   wrong for them; the answer decides whether receiving needs a weight field.
5. **Sharing items across brands** (PRG-004, ADR-0012's open decision OPN-009). Reads
   are brand-private today. Only the read predicate changes if one catalogue is shared.
6. **Item pictures under ADR-0023** — how an edge function writes to and signs URLs from
   the private `erp-menu-media` bucket without `service_role`, and whether the owner
   wants the warehouse's public pictures instead. Until then `picture_path` stays null.
7. **The Arabic unit names** need a native speaker's review (PRG-014).
8. **Should an import be refused when an item changed after the file was exported?**
   Today the file wins, as it did in the warehouse: a row matching an existing code
   overwrites that item's names and descriptions, and a row with no description clears
   them. Refusing instead needs the export to carry each item's stamp, so that a stale
   row fails as a line error and refuses the whole file. Must be answered before the
   import screen ships.

## Addendum — 2026-10-04: the data layer (module 1, step 2)

The nine routes are reachable over HTTP through one edge function, `items`
(`supabase/functions/_shared/items.ts`). Nothing about the routes changed.

- **The actor is the session's.** Every route is wrapped in `withSession`, and the actor is
  passed to the database as its own argument (ADR-0025). A request whose body and headers
  name the administrator still acts as the person its token resolves to; a Node control
  test holds this for every write.
- **The facility is the caller's, and that is safe.** Reads take `facility_id` from the
  query, unbound to the session. `erp.assert_permitted()` checks the actor's role AT that
  facility, and reads there are limited to its brand (§6), so naming a facility grants
  nothing a role there does not. Writes take none: they are gated organisation-wide. This
  settles what 0012's comment on `erp.item_facility_brand()` left to the foundation.
- **The edge checks shape, the database checks rules.** Ids must be UUIDs, text has a
  bounded length, and a factor is a decimal of at most six places, written as text. A
  JSON number is refused: it is already a binary float when read, so 12.3456789999999999
  would arrive as 12.345679 and pass (found in review). Every rule stays in 0012, so the
  two can never disagree. A form may be 8 KiB. An import may be 8 MiB, because 5,000
  realistic rows are 2.2 MB. A body past its limit is `413 too_large`.
- **A refusal is an answer.** Each refusal's SQLSTATE and constraint map to one answer
  (`supabase/functions/_shared/refusal.ts`):
  - `409 already_recorded` for a retry;
  - `409 conflict` for a taken code or name;
  - `409 stale` for a form loaded before someone else's change;
  - `403 forbidden` from the gate;
  - `422 refused` for a broken rule;
  - `422 invalid` for a malformed value. An import's `detail` names its failing lines;
  - `404 not_found`, including another brand's item.

  A route's own message reaches the person, because the routes write them for people. A
  refusal PostgreSQL raises itself, such as a unique index or a CHECK, keeps its status
  and constraint name but gets a generic message and no detail. Its own words are
  "duplicate key value violates unique constraint", with a detail that prints the whole
  failing row (found in review). `already_recorded` is answered only when the retry
  check raised it. Anything else is a 500 that says nothing.

  A constraint-less 23001 is read as the gate's refusal, which holds for every route
  reachable here. A future trigger that raises one without a constraint would be
  answered 403, so it must name its constraint.
- **The decision time is the database's** `now()`, never the console's clock.
- **Proved end to end, as `erp_edge`,** by `supabase/functions/_deno/test/items.test.ts`,
  which CI runs against the Database stack:
  - a cashier reads their branch's items and is refused organisation-wide;
  - then, in one transaction on `erp_edge`'s own login that is rolled back, every route
    runs through the router and the driver, every field is read back, and the rollback
    is checked against what the transaction changed.

  It found a real defect: the driver sent an import's rows already JSON-encoded, so
  postgres.js encoded them again and every import was refused as not an array.
- **Since migration 0017,** an import sent again while its first sending is still
  running is answered `409 already_recorded`, not refused as a file in which every line
  failed. The upload screen shows that as the file saved. A decision id used twice
  within one file is a line error, never a retry. Both gaps were found in module 2's
  reviews (ADR-0026 §6 and its addendum).

## Addendum — 2026-10-04: the screens (module 1, step 3)

The console (`apps/console`) has sign-in and the items screens: a list, an item page with
its units and history, a create and an edit form, adding and retiring a unit, retiring and
reinstating an item, and a CSV upload. Arabic is the default, right to left, with English a
click away. Nothing about the routes changed; one read was added (0015, below).

- **What a person may do comes from the database, and the menu is not a control.** On
  sign-in the console asks `GET /session` for the person's viewer — `erp.viewer()`, 0015:
  their permissions and every capability's state where they are working, the facilities
  they can work at, and the brands and units the forms need. The menu and the buttons are
  built from it (`navigation.ts`, `viewer.ts`). Every route still asks
  `erp.assert_permitted()` itself (CAP-P04), so a wrong menu shows a door the database
  keeps shut. A capability state the console does not know is treated as hidden.
- **Changes are offered only organisation-wide.** Every write route asks for write with no
  facility, so the console offers changes only while the person works organisation-wide,
  from the viewer computed there. A branch role holding write is shown no button the
  database would refuse. A test reads 0012 and fails if a write route ever takes a
  facility.
- **Each form mints its ids once, as UUIDv7** (ADR-0005, `ids.ts`), when it opens, and sends
  the same ids on every attempt. A retry after a lost answer is answered
  `already_recorded` and shown as the success it is, so a double-click on a slow line
  records one decision, not two.
- **A write that got no answer locks its form.** When the connection failed or the server
  did (5xx), the change may have been recorded. So the fields lock, and the person may
  only Retry, which sends exactly the same change, or Start over, which first reads what
  is saved and then mints new ids. Leaving the fields editable under the same ids let a
  changed second attempt be answered "already recorded" for the first (found in review).
  Starting over is safe because the database refuses the duplicate on every route:
  - a code is unique;
  - a stale stamp is refused;
  - only one conversion per unit may be active;
  - a retirement is final.
- **A refusal reads as a sentence in the reader's language,** with the database's own
  words and the rule's constraint name under it (`messages.ts`). The rules staff are likely
  to meet have their own sentence. That matters most where PostgreSQL raised the refusal
  and the edge withholds its words: running the screens found that a missing Arabic
  description (`item_description_is_bilingual`) read only "a value is not valid". The form
  now also says "both languages, or neither" and checks it before sending.
- **A stale form says so and offers a reload.** An edit made while someone else changed
  the item is refused (`item_stale`). The console says what happened and reloads the item
  as it now is, rather than overwriting the other change.
- **Bulk upload is CSV, not the warehouse's .xlsx.**
  - A spreadsheet parser for untrusted files in the browser is a supply-chain risk this
    upload does not need, and Excel saves "CSV UTF-8" from the same sheet.
  - A file that is not UTF-8 is refused rather than guessed. Excel's plain CSV on an
    Arabic Windows is Windows-1256, which would save every Arabic name as garbage.
  - The console checks only the file's shape: known columns, at most 5,000 rows, and
    brands that exist. The rows' rules stay the database's, which saves all of the file
    or none of it.
  - A quote opens a quoted field only at the start of a field. Reading every quote as an
    opening one let `12" plate` merge two rows into one, silently and at the header's
    width (found in review). A quote out of place refuses its line instead.
  - Rows of bare commas, which Excel writes below the data, are skipped.
  - A retry is safe for a different reason than the forms'. Each row's ids are minted
    when the file is read, but choosing the file again mints new ones. What makes a
    re-upload record nothing twice is that rows match existing items by code. A retry
    after a lost answer therefore reports the saved rows as unchanged, and the screen
    says so.
- **Digits typed on an Arabic keyboard are read as digits.** ٠-٩ and ۰-۹ become 0-9 before
  the employee number, the PIN or a factor is sent. `erp.verify_pin()` reads ASCII digits
  only, so a correct PIN typed in Arabic digits counted as a miss and could lock the
  account (found in review).
- **The token lives in the tab's `sessionStorage`,** never `localStorage` and never a
  cookie. It dies with the tab and is shared with no other tab. A session the database
  ends — 30 minutes idle, 12 hours, signed out elsewhere, a suspended account — signs the
  person out at their next action, with the reason. Signing out forgets the token before
  telling the server, so a hung connection cannot leave a shared machine signed in.

**Proved:**

- **65 Node tests** (`apps/console/test/`) for the client, the CSV reader, the ids, the
  translations, the viewer, the routes and the messages. Several read 0012 and fail if the
  console drifts from it: the item kinds, the import's columns, the 5,000-row limit, the
  derived-factor rule, the paired descriptions, and the central write gate. Controls
  include: no request ever names an actor, a stored value that is not a token is never
  sent, an unknown capability state is hidden, an inch mark never merges two rows, and
  Arabic digits reach `verify_pin()` as ASCII.
- **pgTAP 100** (19 cases) for `erp.viewer()`. It states each capability's state rather
  than recomputing it, and checks that `erp_app` holds every privilege the function
  needs.
- **The Deno session test** now reads the viewer as `erp_edge`.
- **A browser run (scratch only, not committed)** drove the screens in Chromium. It used
  the real edge handlers and driver against a database built from the migrations and
  seed, on `erp_edge`'s own login. It covered:
  - sign-in, including a wrong PIN;
  - the administrator creating an item, adding a derived and a stated unit, amending it,
    a stale amend and its reload, a duplicate code, and a CSV upload;
  - the cashier reading their branch's items, read-only, at desktop and phone width;
  - a session ended elsewhere signing the person out.

An independent review found no way past a permission, no leak through the viewer, no
token exposure and no injection. It confirmed ten defects, all fixed before the PR:

1. the inch-mark merge;
2. Arabic-Indic digits;
3. editable fields after a lost answer;
4. overlapping loads drawing an older answer last;
5. a language switch discarding open forms;
6. sign-out waiting on the network;
7. a malformed URL blanking the console;
8. rows of bare commas refusing a file;
9. Arabic plurals and wording;
10. tests and docs that claimed more than they showed.

**Still open, and now a gate on staff testing (step 5).**

- Item 8 above — whether an import should be refused when an item changed after the
  file was exported — was to be answered before the import screen ships. The screen is
  built with today's behaviour, in which the file wins as it did in the warehouse. The
  console has no export yet, so no file carries a stamp to compare. The question stays
  the owner's, and must be answered before staff use the upload.
- The database's refusal messages are English. The console puts a sentence in the
  reader's language above them, but translating each route's message is not done.
- The Arabic strings new in this step need a native speaker's review, as the unit names
  do (item 7). So does showing dates in the Gregorian calendar.

## Alternatives considered

**Keep the warehouse's three masters.** Rejected by the owner's decision.

**Identity correctable until first use** (design 2 of the three). Needs a scan of every
later foreign key and cannot see references in JSON. Rejected for fixing identity from
creation.

**Mutable conversions with derived same-dimension units** (design 1). Only immutable
rows let a later line hold a provable copy of its factor. Rejected for design 3's
immutable rows, with design 1's dimension rule generalised to them.

**Runtime `SELECT` on the item tables**, as ADR-0022 allows on `erp.person`. Then
`hidden` would bind the menu and not the data. Rejected.
