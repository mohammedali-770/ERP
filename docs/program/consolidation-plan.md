# One project — merging the warehouse system into the ERP

- **Decided by:** [ADR-0021](../adr/ADR-0021-one-project.md), which supersedes
  ADR-0020
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011 · CAP-P01..P12
- **Blockers:** B-03 · B-10 and B-11 (both re-scoped down) · [Q-20](./open-questions.md)
- **Status:** approved by the owner 2026-10-01. Phase 1 is in progress.

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
| 3 | **`tools/dep-policy`** — make the two-dependency and no-build-step rules mechanical. Stated in `CLAUDE.md`, `README.md` and ADR-0001; enforced nowhere, absent from the enforced table, invisible to `boundary-check`, read by no test. Must assert **lockfile shape**, because npm workspaces hoist into one lockfile and nesting does not isolate a supply chain |
| 4 | **Widen `tsconfig.json` include and the test glob together**, so tests under `apps/*/test` and `services/*/test` are both run *and* typechecked — today the globs disagree |
| 5 | **`apps/console`** as a real Vite + React workspace, empty shell, under ADR-0021 §4 |

---

## Phase 2 — The capability registry

The owner's original request, and the mechanism the rest of the plan runs on.

- `erp.capability` and `erp.capability_state` in `erp`, event-sourced,
  projection-stamped per I-8, following `20260920000400_event_log.sql`'s
  grant-**and**-trigger shape so the protection binds the owner too.
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

---

## Phase 4 — Modules, in dependency order

Items and units → suppliers → purchase orders and receipts → stock and movements →
recipes and production → the daily factory sheet → costing and valuation → month
close → supplier invoices and payments → accounting export → POS import.

Each module, every time:

1. Schema in `erp`, written fresh from the warehouse's design
2. Data layer rewritten against the ERP's privilege model
3. UI carried over
4. Tests written — the module's first, since it arrives with none
5. A UAT pack where real staff touch it
6. **Then** promoted off `hidden`

**Payment-adjacent modules stay `hidden`** — supplier invoices, supplier payments,
month close, accounting export — while `CLAUDE.md` §6 and Q-20 are open, so the freeze
fails closed.

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
