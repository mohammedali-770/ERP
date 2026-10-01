# Estate inventory

**Surveyed 2026-09-17. Read-only reconnaissance; nothing was modified.**

The PRD reads as a greenfield programme. It is not. This document records what
already exists, because the largest risk to F1 is not building the wrong thing —
it is rebuilding a working thing.

> **Confidence.** Items marked *verified* were observed directly. Items marked
> *reported* come from repository documentation rather than a live check. Items
> marked **unresolved** are open questions, recorded in
> [`../program/open-questions.md`](../program/open-questions.md) rather than guessed at.

---

## Supabase projects

| Project | Region | Status | Verdict |
|---|---|---|---|
| `spicy-meal-ordering` | eu-central-1 | **Active, production** | The live customer-ordering backend. Migration source. |
| `whatsapp-inbox-simple` | eu-central-1 | Active | AI WhatsApp customer-service inbox. Adjacent, not ERP core — **surveyed in depth 2026-09-20**, see below. |
| `spicy-meal-whatsapp-inbox` | eu-central-1 | Inactive (paused) | Superseded earlier build of the inbox. |
| `spicy-meal-operation` | ap-northeast-1 | Inactive (paused) | Pairs with an operations app; both stopped the same week. Likely abandoned. |
| *(default-named personal project)* | ap-southeast-1 | Inactive (paused) | Scratch. No ERP relevance. |

### `spicy-meal-ordering` — the one that matters

*Verified.* ~143 migrations built continuously over roughly ten weeks
(2026-07-08 → 2026-09-16). 62 tables, ~190 `SECURITY DEFINER` RPCs, 24 edge
functions, nine active `pg_cron` jobs, real order data.

Extensions in use: `pg_cron`, `pg_net`, `postgis`, `pgcrypto`,
`pg_stat_statements`, `supabase_vault`, `uuid-ossp`.

What it already does that F1 also specifies:

| Capability | ERP requirement it anticipates |
|---|---|
| Client-supplied idempotency keys on orders and checkout sessions | POS-011, OMS-005 |
| Fenced create-attempt gate with explicit ambiguous-outcome handling | OMS-011, PAY-007, NFR-004 |
| Timed item availability snooze with automatic restore and full audit | MNU-003, MNU-004 |
| Eleven-rule order-integrity watchdog with deduplicated incidents | SUP-004, SUP-005, AI-016 |
| Operations alerting with severity, state and dispatch outbox | SUP-005, SUP-006 |
| Loyalty as an auditable ledger | CRM-005 |
| VAT, coupon and pricing logic in the database rather than clients | MNU-009 |
| Branch-scoped staff assignment and MFA-gated admin actions | IAM-003, IAM-006 |
| Account-deletion queue | SEC-008, CRM-011 |

**Two things are not production-ready**, which matters for F1 planning:

- Card payments are **disabled**. The configured provider is in test mode with
  `enabled = false`; all live orders to date are cash.
- The automatic refund worker's schedule is **disabled** — deliberately, under the
  payment freeze.

### The PBX

*Verified from the diagnostic bundle in the `yeastarissue` repository.*

| | |
|---|---|
| Model | **Yeastar P560** — not a P650; no such model exists |
| Firmware | 37.23.0.123 (above the 37.7.0.16 the API requires) |
| Careful | the bundle's `asterisk/` subdirectory is a **stale 2026-04-11 snapshot on firmware 37.22.0.17** — not incident evidence |
| Hardware | NXP i.MX8MM, 2 GB RAM |
| Reachable from the ERP | **OpenAPI over HTTPS only** |
| Not reachable | AMI (loopback ACL), CDR feed (loopback Redis), internal web API |
| Access path | Yeastar RAS cloud tunnel, not a direct address |
| Stability | **Three watchdog restarts of Asterisk in one captured day** (at least four by PID count), three core dumps naming signal 11, plus a kernel allocation failure in the ethernet path. No vendor resolution on record |
| Serial | `3632D4574233`, MAC `44:db:d2:00:f2:32` |

The P650 designation appears to originate from a Saudi reseller publishing a
`/yeastar-p650/` URL for what is a P560 product page.

Constraints and consequences: [ADR-0016](../adr/ADR-0016-call-centre-integration.md).
Blockers: B-06 (credentials), B-07 (stability).

### `whatsapp-inbox-simple` — surveyed in depth

*Verified 2026-09-20, read-only, while assessing it as a possible home for the
ERP database (ADR-0018 — the recommendation is no).*

| | |
|---|---|
| Ref | `hdeahrxjfqqaveharziy` · Postgres 17 · `eu-central-1` |
| Tables | 21 — **15 live, 6 backups**, all `inbox_`-prefixed in `public` |
| Migrations | 13, `20260910050840` … `20260915103419` |
| Functions | **7** in `public`; three `SECURITY DEFINER` pinned to `search_path = public` and dependent on `pg_trgm`, which is installed in `public` |
| Edge functions | **none** · `pg_cron` none · `pg_net` none |
| Extensions | pgcrypto, uuid-ossp, pg_stat_statements, pg_trgm, supabase_vault, plpgsql |
| Live rows | 1238 messages · 247 contacts · 691 AI runs · 412 FAQ variants · 279 answer gaps · 52 menu items · 17 branches |

A small, self-contained system with no background machinery — which is what makes
absorbing it into the ERP tractable. The table-by-table plan is
[`inbox-absorption.md`](./inbox-absorption.md).

**One structural fact worth recording separately:** `ALTER DEFAULT PRIVILEGES` on
schema `public` grants `anon` and `authenticated` full rights on every table
created there. The 15 live tables escape it only because each migration
hand-writes a counter-revoke — and that discipline has already failed four times,
which is B-08.

### Security observations

*Verified.* Four exposures in `whatsapp-inbox-simple`, all **not acted on** —
that project is outside this repository's scope and any change is an
owner-approved action. Now tracked as
[**B-08**](../program/blocked.md), which supersedes the earlier, milder note here:
the backup tables are anon-**writable** rather than merely readable, and dropping
them is not the cheap remedy because they hold the AI knowledge base's only
version history.

---

## Repositories

Seventeen repositories exist under the account. Those with ERP relevance:

| Repository | Visibility | Last push | Classification |
|---|---|---|---|
| **`SMA`** | public | 2026-09-16 | **Canonical.** Customer app + ops console + entire backend definition |
| `ExsistingWarehouseFactorySystem` | private | **2026-10-01** | **Migration source** for F3 — and now a live, deployed system; see B-10, B-11, ADR-0020 |
| `SpicyMealFactoryWarehouse` | public | 2026-07-05 | Predecessor of the above; assess before relying on it |
| `DeliveryApp` | public | 2026-09-09 | Superseded by the one employee app (ADR-0014) |
| `Spicymeal` | public | 2026-08-10 | WhatsApp inbox web client. Adjacent |
| `yeastarissue` | private | 2026-07-27 | Context for the PBX integration (CC-001) |
| `SpicyMealApp` | private | 2026-06-25 | Superseded by `SMA` |
| `Spicy-Meal-App`, `Spicy-Meal` | private | 2025-10-06 | Stale. Dead weight |
| `SpicyMealOperationApp` | private | 2026-07-05 | Pairs with the paused operations project. Likely abandoned |
| `FirstTasteCompanyWebsite`, `SpicyMealWebsite`, `FirstTastePoultry`, `Wizer*`, `SMA`-adjacent others | mixed | — | Outside ERP scope for now |

### `SMA` — the canonical system

*Verified.* A monorepo containing:

- **Customer app** — Expo SDK 57, React Native 0.86, expo-router, bilingual with RTL.
- **Staff and operations console** — Vite 6, React 19, covering live orders, menu,
  branches, coupons, loyalty, reports, staff access, operations health, order
  integrity, integrations, and separate branch and call-centre consoles.
- **The whole backend definition vendored in-repo** — 136 migrations, 24 edge
  functions, seed and SQL test suites.
- **185 test files**, nine GitHub Actions workflows including change control,
  production gates, function-drift detection and SQL suites.
- Extensive operational documentation: migrations, rollback, incident response,
  release checklist, security review, go-live readiness, owner actions.

It is actively developed, with pull requests numbered past 390 and commits from
the day before this survey.

**Its change-control rules are strict and worth inheriting** (see
[`../program/governance.md`](../program/governance.md)): protected branches,
pull-request-only workflow, `supabase db push` permanently forbidden against
production, and explicit owner approval required for migrations, function
deployments, payment work, push broadcasts and any live write.

### `ExsistingWarehouseFactorySystem`

> **Re-verified 2026-10-01 and substantially changed.** The description below was
> accurate on 2026-09-22 and is now out of date in almost every number. This system
> is under active, rapid development: **98 commits across 41 pull requests between
> 2026-09-14 and 2026-10-01**, built largely by agent sessions on `claude/*` branches.
> See [`../program/consolidation-evaluation.md`](../program/consolidation-evaluation.md)
> for the current picture and [ADR-0020](../adr/ADR-0020-consolidation-direction.md)
> for what it means.
>
> | | 2026-09-22 | 2026-10-01 |
> |---|---|---|
> | Migrations | 59 | **99** |
> | Tables | 28, all `public` | **54 in `public` + 7 in `private`** |
> | Application | ~46 files | **~74 files, ~26,900 lines, 39 page components** |
> | CI | none | **on every pull request** since 2026-09-29 |
> | Deployment | no config | **Vercel** (`vercel.json`) since 2026-09-30 |
> | Hosted database | unidentified (B-04) | **`warehouse-factory-system`, ref `dyhkydedckizhxckryvq`, `eu-central-1`, free plan**, created 2026-09-27 |
> | Tests | none | **still none** — there is no `test` script |
>
> Two documents inside that repository are **actively misleading in opposite
> directions**: its `INVENTORY_SYSTEM_PROGRESS.md` lists almost every screen as
> pending, its `SETUP_GUIDE.md` says everything is complete. Its `docs/SYSTEM.md` is
> the current one and says so itself. Plan from `SYSTEM.md` only.
>
> **Two blockers were opened against it on 2026-10-01:** [B-10](../program/blocked.md)
> — 50 `SECURITY DEFINER` functions callable by any signed-in session,
> leaked-password protection disabled, and a documented demo admin password — and
> [B-11](../program/blocked.md), attribution destroyed on user deletion.

*Verified 2026-09-22.* 59 migrations (2025-10 → 2026-05) creating **28 tables** —
counted then, not approximated. React + Vite frontend **generated in bolt.new**
(`package.json` still carries the template's name, `vite-react-typescript-starter`),
with no tests, no CI and no Supabase CLI tooling. The README was three lines, one
of which is an *Open in Bolt* badge for project **`sb1-vseddlse`**.

The **domain model is the valuable part** and is effectively F3's requirements
specification, validated against real operations:

- Unit conversion between purchase, production, storage and recipe units (INV-005)
- Two purchase-order streams — warehouse and raw material (PRC-001)
- Production batches with explicit inputs and outputs (MFG-004, MFG-005)
- Stock auto-increment on receipt, consumption on production (INV-006)
- Daily operational snapshots — production, process, supply, withdrawal, employee meals
- Six roles driving six dashboards with an approval chain (PRC-002, PRC-003)
- Auto-numbered purchase orders and batches, low-stock alerting (INV-013)

**Resolved 2026-10-01.** The live database is `warehouse-factory-system`, ref
`dyhkydedckizhxckryvq`, `eu-central-1`, Postgres 17, **free plan** — named in that
repository's own `CLAUDE.md:7`, `.env.example:3` and `docs/SYSTEM.md:95-96`, and
confirmed against the live account read-only. B-04 is answered. What replaces it is
not identity but **residency and durability**: a payroll-adjacent financial record on
a free-tier project with no point-in-time recovery, which is
[Q-20](../program/open-questions.md) and interlocks with B-05.

> **Worth noting against its predecessor.** `SpicyMealFactoryWarehouse` is the
> better-engineered repository of the two — 49 migrations, vitest, prettier, full
> Supabase CLI local-development tooling, and an `.env.example` pointing at
> `127.0.0.1:54321`. The successor dropped all of it and took a dependency on a
> hosted Supabase project nobody has identified. That is the whole of B-04: a
> rebuild traded local reproducibility for a connection string in someone's
> environment file.

---

## What this changes about F1

1. **F1's effort estimate should fall.** Several F1 requirements describe behaviour
   that exists and works today.
2. **The Lazywait replacement is smaller than the PRD implies** — see
   [`lazywait-surface.md`](./lazywait-surface.md).
3. **Payment work is blocked, not merely unstarted** — see
   [`../program/blocked.md`](../program/blocked.md).
4. **The estate needs consolidating**, not just extending: five Supabase projects
   and several superseded repositories, with menu and branch data duplicated across
   at least two systems.
