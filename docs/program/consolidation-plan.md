# One project — merging the warehouse system into the ERP

- **Decided by:** [ADR-0021](../adr/ADR-0021-one-project.md), which supersedes
  ADR-0020
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011 · CAP-P01..P12
- **Blockers:** B-03 · B-10 and B-11 (both re-scoped down) · [Q-20](./open-questions.md) ·
  [Q-22](./open-questions.md) (answered for stock movements on 2026-10-05) · [Q-23](./open-questions.md) · [Q-24](./open-questions.md)
  (before the first deployment). [Q-21](./open-questions.md) was answered on 2026-10-02 by
  [ADR-0023](../adr/ADR-0023-edge-functions-hold-the-erp-credential.md), and the
  edge-layer foundation it called for was built on 2026-10-03
  ([ADR-0025](../adr/ADR-0025-sessions-and-the-edge-layer.md))
- **Status:** approved by the owner 2026-10-01. Phases 1, 2 and 3 are built; Phase 4 began 2026-10-02 —
  4 of 28 steps done; module 1 has 4 of its 6 sub-steps, module 2 has 4, module 3 has 4, module 4 has 4, module 5 has 4 and module 6 has 4, and the first six modules' staff-testing packs are written.

Neither system is in production — verified read-only: seven of eight accounts in the
warehouse database are demo accounts, against 18 items, 5 branches and 6 suppliers. So
there is no cutover, no data migration and no parallel-running period, and the
consolidation is a build rather than a migration.

**The target:** one repository (this one), one database (the `erp` schema with every
invariant intact), one application. The warehouse repository and its Supabase project
become read-only reference and are decommissioned at the end.

---

## What comes across, and in what form

| Asset | Treatment |
|---|---|
| Its `docs/SYSTEM.md`, 1182 lines | **The specification.** The most valuable artefact in either repository |
| ~26,900 lines of React/TSX, 39 pages, 59 menu entries, 6 print templates, PWA | **Carried over** module by module, behind a rewritten data layer |
| Bilingual `LanguageContext`, RTL, per-user language | Carried over largely as-is |
| 99 migrations / 54 `public` tables | **Rewritten** into `erp`. Read as a design, not ported |
| 95 `SECURITY DEFINER` RPCs, 236 RLS policies | **Replaced** — this *is* the incompatible security model |
| 18 items, 7 demo users | Discarded. Re-seeded synthetically, which `db:check` already requires |
| 5 edge functions | Judged individually. The employee-number/PIN worker sign-in is a good design and is kept |

The data layer is the seam: components do not care which schema answers them, and the
data layer is the only part bound to `authenticated`-reaches-`public`.

---

## Phase 1 — Foundations

No decisions needed. Everything here is repairing something that is already wrong or
unenforced, and all of it is needed before an application can land safely.

| | Work |
|---|---|
| 1 | **Correct the record** — supersede ADR-0020, re-scope B-10/B-11, rewrite this plan *(this PR)* |
| 2 | **Fix `tools/boundary-check`'s resolver.** It matches `@firsttaste/<directory>` while workspaces publish prefixed names, so a cross-workspace import written as a package name resolves to null and is silently skipped. Every containment claim resting on it is currently false |
| 3 | **`tools/dep-policy`** — make the two-dependency and no-build-step rules mechanical. Stated in `CLAUDE.md:168-171` and `README.md:77-79` — **not** ADR-0001, which states only the no-emit half and as a consequence of rejecting project references, not as a rule. Enforced nowhere, absent from the enforced table, invisible to `boundary-check`, read by no test. Must assert **lockfile shape**, because npm workspaces hoist into one lockfile and nesting does not isolate a supply chain |
| 4 | **Widen `tsconfig.json` include and the test glob together**, so tests under `apps/*/test` and `services/*/test` are both run *and* typechecked — today the globs disagree |
| 5 | **`apps/console`** as a real Vite + React workspace, empty shell, under ADR-0021 §4 |

**Phase 1 is complete.** Two decisions and one constraint were settled while building it:

- **React 18.3 and Vite 5**, matching the ~26,900 lines being carried from the
  warehouse rather than the estate console's React 19. Nineteen's breaking changes
  would mean touching every component before any of them has a test. **Upgrading is a
  separate decision** and is not taken here.
- **`apps/console` carries its own tsconfig**, because `tsconfig.base.json` has
  `lib: ["ES2023"]` with no DOM and `moduleResolution: NodeNext`. `typecheck` is now
  two `tsc` invocations, and `dep:policy` asserts a workspace holding JSX has a project
  of its own — the root include's globs end in an explicit `.ts`, which TypeScript
  matches literally, so they can never cover `.tsx`.
- **Node cannot load `.tsx` at all.** `Unknown file extension ".tsx"` under both
  `--experimental-strip-types` and `--experimental-transform-types`, on v22.22.2. So
  `npm test` cannot render a component, and **every carried module in Phase 4 needs its
  testable logic in `.ts` files**, with a JSX-transforming runner inside `apps/console`
  if components themselves are to be tested. This shapes Phase 4 more than anything
  else settled here.

---

## Phase 2 — The capability registry

The owner's original request, and the mechanism the rest of the plan runs on.

- `erp.capability` and `erp.capability_state` in `erp`, event-sourced,
  projection-stamped per I-8, following `20260920000400_event_log.sql`'s
  grant-**and**-trigger shape so the protection binds the owner too.

> **Built 2026-10-01, and the first precondition was resolved differently from the
> way this plan proposed.** The plan said to fix `erp.event_log.device_id` being
> `not null`. Reading the event log showed that is not a defect to fix: `device_id`,
> `device_seq`, `prev_hash`, `branch_id` and `business_date` are all `not null`,
> `device_seq` is gapless per device, `prev_hash` is a **per-device hash chain**, and
> `actor_type` admits only `('cashier','system','integration')`. That table is the
> **branch runtime's** log by construction, and its twenty fields are a contract with
> `packages/contracts/src/events/envelope.ts`. A central administrative decision has
> no device, no place in any device's chain, no branch and no fitting actor type;
> putting one there needs a sentinel device and a fabricated hash link, which is a
> fiction inside the system of record.
>
> So central decisions got **their own append-only log**, `erp.capability_decision`,
> with the same double protection, and **`erp.event_log` is untouched** — no
> owner-approved migration to the system of record was needed after all. Because the
> decision log is not partitioned, the projection's stamp is a **real foreign key**,
> which `20260921000100` explains the event-log projections cannot have. That is
> strictly stronger than the convention it replaces.
- States `hidden | pilot | enabled | read_only | withdrawn`, **default-deny**: a
  capability with no recorded state is `hidden`, so exposure is always a recorded
  decision.
- `erp.assert_command_admitted()` before any event is minted, default-deny on an
  unmapped `(aggregate_type, event_type)` so a new event type cannot be born
  ungoverned.
- Register `CAP-P01..P12`.

**Three things to resolve first, each a real defect rather than a registry concern:**

1. **`erp.event_log.device_id` is `not null`.** A capability change is a central
   decision with no device. The ERP's own log cannot currently record one.
2. **Both hardcoded assertion lists** in `tools/db-check/src/assertions.ts` enumerate
   four table names literally — `projection-stamp-is-mandatory` and
   `projection-stamp-resolves-to-a-real-event`. A fifth projection passes both while
   proving nothing. Add the table to both, **plus a `has_column` assertion**, because
   the stamp check tests nullability and not existence.
3. **`tools/db-fixtures`' reset list** needs the new table in the same PR as its pgTAP
   suite, or write fixtures leak between cases.

**The control case is the deliverable, not the feature.** A fixture that sets a
capability `hidden` and proves a write is **refused by the database** — not merely
absent from a menu. A registry whose control passes has proved nothing.

---

## Phase 3 — Identity and the shell

One identity model, `erp`-native, replacing `profiles.role` read through
`private.current_user_role()`. The branch-worker flow — employee number plus a bcrypt
PIN, lockout after five misses, unknown numbers answering identically — is a sound
design and is rebuilt rather than reinvented, behind the ERP's privilege model.

`navigation.tsx`'s six-role, 59-entry menu is carried over and driven by the registry,
so a `hidden` capability simply has no entry — with the database refusal behind it, per
`CAP-P04`.

> **Built 2026-10-02** — [ADR-0022](../adr/ADR-0022-identity-and-authentication.md),
> `supabase/migrations/20261002000100_identity.sql`, `apps/console/src/navigation.ts`.
> Scope as the owner set it: identity in the database and the shell's logic, **no live
> sign-in**, and the PIN flow proposed as `IAM-P01..P08` rather than read into IAM-001.
>
> - **The warehouse design was kept nearly constant for constant** — six-digit PIN,
>   bcrypt at cost 10, five misses lock for fifteen minutes, and unknown numbers
>   counted in their own table so the answer, the countdown, the lock and the time
>   taken all match a wrong PIN. The current warehouse copy was read for this; an older
>   two-commit clone on the same machine has none of it.
> - **Not carried: "View as".** The warehouse's preview changes only the screen and
>   runs actions with the administrator's rights. CAP-P11 forbids that; the console's
>   preview makes nothing writable, and making the *database* refuse a preview's writes
>   waits on sessions, which wait on Q-21 (since answered: ADR-0023).
> - **The menu is one list, not six.** The warehouse keyed 59 entries by role, writing
>   the same page out under several roles. Each entry now names a capability and an
>   action; a role is a set of permissions.
> - **Three things went further than planned**, each because the plan's version would
>   have been decoration: `erp.decide_capability()` now asks whether its actor may
>   administer capabilities; the two protected platform capabilities and the
>   `administrator` role moved from the seed into the migration, because a real
>   database needs them before anyone can decide anything; and the identity log grants
>   the runtime **no** direct INSERT, unlike 0010's.
> - **Two defects found and closed.** `0002`'s default privileges gave `erp_read`
>   SELECT on every new table, which would have included the PIN hash; and **every
>   `erp` function had been executable by PUBLIC since `0002`**, because a per-schema
>   revoke cannot undo PostgreSQL's global default — so the reporting role could call
>   `erp.decide_capability()`. Both are revoked and both now have a `db:check`
>   assertion.
> - **Q-21 is the open end.** Nothing names what holds the `erp_app` credential, and
>   PostgREST cannot be the ERP's API because `authenticated` reaches nothing in `erp`.
>   Phase 4's data layer cannot be written until that is decided.
>
> *Answered 2026-10-02 by [ADR-0023](../adr/ADR-0023-edge-functions-hold-the-erp-credential.md):
> edge functions hold `erp_app`. The data layer now waits on the edge-layer foundation,
> not on a decision.*
>
> **The foundation, built 2026-10-03** — [ADR-0025](../adr/ADR-0025-sessions-and-the-edge-layer.md),
> `supabase/migrations/20261003000100_sessions.sql`, `supabase/functions/`. Sessions
> issued by `erp.sign_in()` over `verify_pin()`, held only as a hash, ended at twelve
> hours or thirty minutes idle (the owner's numbers); every attempt recorded; revocation
> gated and recorded; the `erp_edge` login role; and sign-in, session and sign-out
> functions in which `withSession` supplies the actor, so a caller cannot name one. CI
> signs in through `erp_edge` with the real driver. **Not done:** nothing is deployed,
> the edge runtime itself and the hosted pooler are first exercised at the first
> approved deployment, and the console has no sign-in screen yet — that belongs to the
> console-layout residual below.

---

## Phase 4 — Modules, in dependency order

> **Re-scoped 2026-10-02, from a complete mapping of the warehouse system.** The list
> this section used to carry had 11 modules. Mapping every table (60), live database
> function (136), page (33) and edge function (5) of the current warehouse copy onto
> modules — each assigned exactly once, checked by script — gives **22**. Nine are not
> in the old list at all, including the warehouse's core workflow, **branch orders**;
> two old modules split in two; raw materials folded into items by the owner's
> decision; and the old order had two dependency errors.

### Progress

| | Steps | Done |
|---|---|---|
| Phases 1–3 — foundations | 3 | 3 |
| Phase 3 residuals — the API layer and sign-in; the console's layout, Arabic/RTL, print and offline support | 2 | 1 — the API layer and sign-in, 2026-10-03. The console's layout and Arabic/RTL came with module 1's screens on 2026-10-04; print and offline support remain |
| Phase 4 — modules | 22 | 0 — module 1 has 4 of its 6 sub-steps, module 2 has 4 (its database layer, tests, data layer and screens), module 3 has 4 (its database layer, tests, data layer and screens), module 4 has 4 (its database layer, tests, data layer and screens), module 5 has 4 (its database layer, tests, data layer and screens), module 6 has 4 (its database layer, tests, data layer and screens) |
| Phase 5 — decommission | 1 | 0 |
| **Total** | **28** | **4 — about 14%** |

By warehouse functionality actually carried, it is near **0%**: about 23,800 lines of
warehouse application code are still to come across, and 3 of its 60 tables have an
ERP counterpart (Phase 3). Phases 1–3 built what the modules sit on.

### Decided 2026-10-02

- **[ADR-0023](../adr/ADR-0023-edge-functions-hold-the-erp-credential.md): edge
  functions hold the `erp_app` credential.** This answers Q-21, which gated every
  module's data layer, screens, staff testing and promotion. The edge-layer foundation
  — login role, connection, sessions from `erp.verify_pin()`, actor resolution — comes
  before the first module's data layer.
- **One item master with a type** (INV-002), not the warehouse's separate `items` and
  `raw_materials` tables. Raw materials stop being a module of their own.

### The modules

Sizes are the warehouse's own: source lines of its screens and logic, and its tables.

| # | Module | Warehouse size | In the old list? | Notes |
|---|---|---|---|---|
| 1 | **Items and units** — every INV-002 kind, units, conversions | 1,109 lines · 3 tables | Yes | Raw materials fold in here. Sets the conventions every later table copies. **Database layer, tests, data layer and screens built** — [ADR-0024](../adr/ADR-0024-item-master-and-units.md) and its two 2026-10-04 addenda; staff testing (its [UAT pack](../lab/uat/items.md) is written) and switch-on remain, [process mapping](../estate/process-mapping-items-and-units.md) |
| 2 | Suppliers | 367 · 1 | Yes | Same place as before. The item–supplier link — the warehouse's `raw_materials.supplier_id`, now naming a conversion — lives here, not on the master, so items no longer depend on suppliers: the old order's second dependency error. **Database layer, tests, data layer and screens built** — [ADR-0026](../adr/ADR-0026-suppliers.md) and its addenda, [process mapping](../estate/process-mapping-suppliers.md); staff testing (its [UAT pack](../lab/uat/suppliers.md) is written) and switch-on remain |
| 3 | Item pricing — internal transfer prices | 246 · 1 | Split out | Money as integer minor units, with history and an effective date (I-7). **Database layer, tests, data layer and screens built** — a price per pack, from a moment, never backdated, over HTTP as the `transfer-prices` edge function and set from the console; [ADR-0027](../adr/ADR-0027-transfer-prices.md), [process mapping](../estate/process-mapping-transfer-prices.md); the staff-testing pack is written ([`transfer-prices`](../lab/uat/transfer-prices.md), en + ar) and waits on the owner's five answers and a session; switch-on remains |
| 4 | **Branches** — and the geofence that places a branch worker | 468 · 1 | **No** | `erp.facility` made a master. **Database layer, tests, data layer and screens built** — closed, never deleted; an area per branch; and, by the owner's decision of 2026-10-05, a worker is assigned to their branch and the area is a check at order time, not what places them ([ADR-0028](../adr/ADR-0028-facilities-and-branch-areas.md), IAM-P11, [process mapping](../estate/process-mapping-facilities.md)); over HTTP as the `facilities` edge function and kept from the console; the staff-testing pack is written ([`facilities`](../lab/uat/facilities.md), en + ar) and waits on the owner's six answers and a session; switch-on remains |
| 5 | Stock and movements | 1,834 · 4 | Yes | **Moved before purchasing**: receiving a PO writes stock. **Database layer and tests built** — a ledger at each warehouse and factory, the balance its sum, posted through one seam every later module uses; by the owner's decisions of 2026-10-05, negative stock refused unless overridden with a reason, no second approval, a movement's business day the facility's calendar date, stock per facility ([ADR-0029](../adr/ADR-0029-stock-ledger.md), INV-P01, INV-P02, [process mapping](../estate/process-mapping-stock.md)); no branch holds stock until Q-06 is answered. **Data layer built** (2026-10-06): the `stock` edge function, every route naming its facility, quantities as decimal text. **Screens built** (2026-10-06): balances, an item's stock card, a decision with Reverse, and the movement and count forms, at a warehouse or factory only; staff testing (its [UAT pack](../lab/uat/stock.md) is written) remains. **Switch-on drafted and held** (2026-10-06): a pilot at the central warehouse alone, by migration, kept in closed PR #48 and reopened only once the pack is signed, operations signs off the process mapping and module 1 is switched on |
| 6 | **Notifications** — the in-app bell | 302 · 3 | **No** | Web push needs owner approval (`CLAUDE.md` §4) and ships off. **Database layer and tests built** (2026-10-06) — by the owner's decisions of that day, the in-app bell only, no push; a notification goes to whoever can open what it is about at the facility it happened at, decided then and asked again when read; ids and quantities only, never names; read once, kept 90 days, then deleted; and the first producer, stock taken below zero by an override, told to that facility's readers of stock at the balance it left ([ADR-0030](../adr/ADR-0030-notifications.md), SUP-P01 to SUP-P03, [process mapping](../estate/process-mapping-notifications.md)). **Data layer built** (2026-10-06): the `notifications` edge function, a page ending before a `seq` sent as text, and marking all only when the body says so. **Bell built** (2026-10-06): in the console's top bar, its count asked only on the person's own doing (never on a timer, which would hold a session open past its idle end), a page that marks read and opens a notification at the facility it happened at. Staff testing (its [UAT pack](../lab/uat/notifications.md) is written, 2026-10-06) remains. **Switch-on drafted and held** (2026-10-07): a pilot at the central warehouse alone, by migration, kept in closed PR #53 and reopened only once the pack is signed, operations signs off the process mapping, and stock is switched on at the same warehouse first |
| 7 | Stock alerts | 206 · 0 | Split out | **Database layer and tests built** (2026-10-07) — by the owner's decisions of that day, a minimum only, per item per warehouse or factory, a decision with who, when and why, entered in a pack; every item at or below its minimum listed; and the bell's second kind, rung once per drop (from above the minimum to at or below it), told to whoever may read stock alerts at that facility, the person who moved the stock included ([ADR-0031](../adr/ADR-0031-stock-alerts.md), INV-P03, SUP-P04, [process mapping](../estate/process-mapping-stock-alerts.md)). **Data layer built** (2026-10-07): the `stock-alerts` edge function, every route naming its facility, quantities as decimal text, and a set stating the stamp it read, `null` only for an item that never had a minimum. **Screens built** (2026-10-07): a Stock alerts entry listing what is low at the warehouse or factory worked at, an item's minimum and its history with Set and Clear, the bell's second kind, and a link from the stock card. **Staff testing pack written** (2026-10-07): [`stock-alerts`](../lab/uat/stock-alerts.md), en + ar, every figure run in a browser first, waiting on the owner's seven answers and a session. **Switch-on drafted and held** (2026-10-07): a pilot at the central warehouse alone, by migration, kept in closed PR #58, after items organisation-wide and stock and the bell there, and only once the pack is signed and its five preconditions hold (ADR-0031's step 6 addendum) |
| 8 | Purchase orders and receipts | 3,124 · 7 | Yes | Commitments in money, no payment. **Database layer and tests built** (2026-10-07) — by the owner's decisions of that day, one order per receiving warehouse or factory, from one supplier, for packs it supplies; a price per pack in halalas and one VAT rate, a commitment only; approved within a limit per facility compared before VAT, or by someone holding approve who did not raise it; and receipts as stock decisions through module 5's seam, never more than is still to come, reversed whole once through the order ([ADR-0032](../adr/ADR-0032-purchase-orders.md), PRC-P01, PRC-P02, INV-P04, [process mapping](../estate/process-mapping-purchase-orders.md)). **Data layer built** (2026-10-07): the `purchase-orders` edge function, every route naming its facility, the decision named by its path, quantities as decimal text and amounts as whole halalas. **Screens built** (2026-10-07): the list, a new order whose figures before sending are 0023's own, an order's page offering only the decisions 0023 would take — never approval of one's own order — receipts and their reversal from the order, and the facility's approval limit. **Staff testing pack written** (2026-10-07): [`purchase-orders`](../lab/uat/purchase-orders.md), en + ar, every figure run in a browser first, waiting on the owner's thirteen answers and a session. **Switch-on drafted and held** (2026-10-07): a pilot at the central warehouse alone, purchase orders and their approval limit, by migration, after items and suppliers organisation-wide and stock there, and only once the pack is signed and its six preconditions hold (ADR-0032's step 6 addendum) |
| 9 | **Ordering setup** — cut-off times, par levels | 361 · 2 | **No** | Its invoice-tolerance section is payment-adjacent and stays hidden |
| 10 | **Branch orders** — branches ordering from the warehouse and factory | 4,128 · 4 | **No** | **The largest module.** `erp.orders` is already the POS sales projection, so this needs another name (INV-014: replenishment). Its delivery note prints lot lines, which module 14 owns |
| 11 | **Branch delivery confirmation** — received, short, damaged | 279 · 0 | **No** | INV-016 |
| 12 | **Branch order reports** — monthly summary, customer overview | 514 · 0 | **No** | |
| 13 | Recipes and production | 825 · 5 | Yes | |
| 14 | **Factory lots** — lots, expiry, FEFO, write-off | 277 · 2 | **No** | INV-004, INV-012, MFG-007, MFG-008 |
| 15 | The daily factory sheet | 1,276 · 8 | Yes | Records cash purchases; not frozen, but the owner should confirm |
| 16 | Costing and valuation | 511 · 1 | Yes | |
| 17 | **Data import** — opening master data and opening stock | 295 · 0 | **No** | Needed precisely because nothing is migrated |
| 18 | POS import | 496 · 4 | Yes | **Moved before the frozen three**: it depends on none of them |
| 19 | **Home dashboards** | 1,184 · 0 | **No** | |
| 20 | Month close | 571 · 3 | Yes | **Frozen** — built, stays hidden |
| 21 | Supplier invoices and payments | 808 · 4 | Yes | **Frozen** — built, stays hidden |
| 22 | Accounting export | 259 · 1 | Yes | **Frozen** — built, stays hidden. FIN-001 requires native accounting, so this is a bridge at most |

### Each module, every time

1. Schema in `erp`, written fresh from the warehouse's design — through the process
   mapping MFG-012 requires, not copied
2. Data layer, as edge functions (ADR-0023)
3. UI carried over
4. Tests — the module's first, since it arrives with none
5. A UAT pack where real staff touch it
6. **Then** promoted off `hidden`, by a capability decision registered in a migration
   — not by the synthetic seed, which is where `inventory.stock`, `factory.production`
   and `finance.month_close` live today — and only after operations has signed off the
   module's process mapping (MFG-012). Nothing enforces that sign-off yet
   ([Q-23](./open-questions.md)), so the promoting PR states who approved it, and when

Steps 1 and 4 could run ahead of the edge-layer foundation; 2, 3, 5 and 6 could not.
The foundation is built (2026-10-03), so step 2 can now begin: each module's functions
wrap their handlers in `withSession` and pass `session.personId` as the actor
(ADR-0025).

**Payment-adjacent modules stay `hidden`** — supplier invoices, supplier payments,
month close, accounting export, and ordering setup's invoice-tolerance section — while
`CLAUDE.md` §6 and Q-20 are open, so the freeze fails closed.

### Carried into every module

- **Money is integer minor units with an explicit currency**, the ERP's convention —
  not the warehouse's `numeric(10,2)`.
- **Disabled, never deleted**, with foreign keys that restrict: the warehouse cascades
  in 51 places (B-11).
- **Bilingual names** (PRG-014) and the ADR-0012 dimensions from the first migration.
- **[Q-22](./open-questions.md) — the business day for warehouse and factory
  operations — must be answered before branch orders and purchasing**, because every
  order, PO, batch and daily sheet is stamped with one.
- **The warehouse's `docs/SYSTEM.md` is the specification but holds a demo password and
  branch-worker PINs in clear** (lines 142–144). Anything quoted from it is redacted
  first; `secret:scan` would rightly refuse it otherwise.
- **Several requirements these modules deliver are F3 in the PRD** — INV-002, INV-005,
  INV-013, INV-014, INV-016 among them. ADR-0021 brought them forward deliberately; the
  roadmap should say so when it is next revised.
- **Per-person language** has no home yet: `erp.person` has no language column, and the
  warehouse's per-user language setting needs one.

---

## Phase 5 — Decommission

The warehouse repository archived, its Supabase project deleted, `inventory.md` and
`migration-map.md` updated, B-10 and B-11 closed by the systems they describe ceasing
to exist. Only then is "one project" true rather than aspirational.

---

## Still the owner's to decide

1. **Hosting.** ADR-0018 defers the ERP's hosted project to ~April–May 2027. One
   project means one database sooner. Development stays local on Docker for a long
   while, so this is not urgent — but ADR-0018 should be revisited deliberately rather
   than left to drift.
2. **[Q-20](./open-questions.md)** — `eu-central-1` and the plan tier. Now a
   precondition rather than an open question: it must be settled **before** any real
   data is entered, which is a decision that can be taken calmly precisely because
   there is none today.
3. **B-03.** Unchanged by any of this and still the cheapest win available: one branch
   visit with real iPads and a real printer clears `PRN-014`, `OFF-012`, `OFF-013` and
   `OFF-014` — the entire remaining F0 exit-gate failure.

## Verification

Per PR: `npm run verify` green, `db:check` where migrations change, `db:test` for
pgTAP, `secret:scan` clean, every relative link resolving, and a test that would fail
without the change.

Per module: its UAT pack passes, and a fixture proves its capability cannot be written
to while `hidden`, with a control that fails if the mechanism is absent.

At the end: every feature in the warehouse's `SYSTEM.md` maps onto a promoted
capability, with nothing silently dropped — and the mapping is checked, not asserted.
