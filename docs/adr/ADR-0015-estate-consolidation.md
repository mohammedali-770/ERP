# ADR-0015 — Relationship between the ERP and the existing estate

- **Status:** Accepted
- **Date:** 2026-09-17
- **Requirements:** APP-001 · APP-002 · NFR-007 · PRG-006 · OMS-002
- **Deciders:** Product Owner

## Context

The PRD reads as a greenfield programme. It is not. The account already runs:

- **`SMA`** — the canonical, actively developed monorepo: Expo customer app, staff
  and operations web console, and the complete backend definition (136 migrations,
  24 edge functions, 185 tests, nine CI workflows) against the live
  `spicy-meal-ordering` project.
- **`ExsistingWarehouseFactorySystem`** — a working warehouse and factory system,
  59 migrations, covering unit conversions, dual purchase-order streams, production
  batches and daily operational snapshots.
- A live AI WhatsApp inbox, a delivery app, and older superseded repositories.

APP-001 requires the existing customer app to migrate to ERP services; APP-002
requires that migration not force an unnecessary complete rewrite.

## Decision

### The ERP is a new repository that inherits SMA's conventions

Not a fork of SMA, and not a clean break.

**Why not evolve SMA into the ERP:** SMA is one brand's customer-and-operations
application. The ERP is company-level and must be brand-neutral (NFR-007) and hold
finance, HR, payroll, factory and assets. Growing a company ERP out of a schema
shaped around one brand's ordering app binds the wrong foundations.

**Why not a clean break:** SMA's conventions are proven under production load —
change control, production gates, function-drift detection, SQL suites, a
migration workflow that forbids `supabase db push` against production. Inventing
looser conventions for a system that will hold payroll and financial records would
be a regression.

### Platform: Supabase-native, lock-in accepted

The owner has chosen full Supabase-native rather than holding a portability
boundary. This reuses the team's skill and the estate's proven machinery.

**The cost is recorded, not hidden:** `pg_cron`, `pg_net`, Vault,
RLS-as-primary-authorisation and `SECURITY DEFINER` RPCs are the parts that do not
travel. If the residency gate (ADR-0002) later requires in-Kingdom hosting, the
migration is a re-platforming of scheduling, secrets and authorisation — not a
database export. ADR-0002 is reviewed at every phase gate for exactly this reason.

### Classification of every existing asset

| Asset | Classification | Note |
|---|---|---|
| `spicy-meal-ordering` schema and RPCs | **Migration source** | Orders, menu, loyalty, payments, availability |
| SMA conventions and CI gates | **Inherit** | Change control, migration workflow, drift detection |
| SMA customer app | **Migration target** | APP-001; re-point at ERP services, do not rewrite (APP-002) |
| SMA ops console | **Reference design** | Informs the ERP management console |
| `ExsistingWarehouseFactorySystem` domain model | **Migration source** | F3's de-facto requirements specification |
| `ExsistingWarehouseFactorySystem` frontend | **Supersede** | Generated scaffold, no tests or CI |
| WhatsApp inbox | **Adjacent integration** | ADR-0013; should read menu and branch data from ERP |
| Delivery app | **Supersede** | ADR-0014; folds into the one employee app |
| `SpicyMealApp`, older Spicy Meal repos | **Dead weight** | Superseded by SMA |

### Mechanisms to port rather than re-derive

Named explicitly so F1 starts from proven behaviour:

- Client-supplied idempotency keys on orders and checkout sessions.
- The fenced create-attempt gate (`ready_to_send` / `already_synced` /
  `ref_present_unverified` / `deadline_expired`) — a working answer to the
  unknown-outcome problem OMS-011 and PAY-007 specify.
- Ambiguous-outcome classification that refuses to re-send and routes to human
  confirmation — exactly the behaviour NFR-004 requires.
- The 11-rule order-integrity watchdog with deduplicated incidents and non-PII alert
  payloads — a head start on SUP-004/005 and AI-016.
- Timed availability snooze with automatic restore and full transition audit —
  MNU-003/004, already solved.
- The `SECURITY DEFINER` RPC plus RLS-helper-predicate pattern and branch-scoped
  staff assignment.

## Consequences

- **F1's effort estimate should fall** once the migration map is complete. Several
  F1 requirements describe behaviour that already exists and works.
- Two systems run in parallel until APP-001 completes, with a defined seam rather
  than a gradual blur.
- **Nothing in this repository writes to the live estate.** All reconnaissance was
  read-only; migration is a separate, owner-approved workstream.
- **Unresolved:** the warehouse system's live database has not been identified (its
  connection lives in an untracked environment file), and the current payment
  provider state needs confirming — the database has one provider configured while
  the console ships administration for another. Both are in
  `docs/program/open-questions.md`.
