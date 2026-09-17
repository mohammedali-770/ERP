# First Taste ERP

Company-level ERP platform for First Taste, with Spicy Meal as the first brand and
first implementation. Intended to replace Lazywait as the POS and order platform.

**Phase F0 — planning and foundation.** No production feature code yet: the PRD's
own architecture gate (PRG-010, PRG-011) has not been passed. What is here is the
requirement baseline, the architecture and its decisions, the estate map, the
compliance gates, the lab design, and runnable spikes that retire the top risks.

---

## Start here

| If you want to know | Read |
|---|---|
| What the system must do | [`docs/requirements/INDEX.md`](docs/requirements/INDEX.md) — 387 requirements |
| Why it is shaped this way | [`docs/architecture/overview.md`](docs/architecture/overview.md) and [`invariants.md`](docs/architecture/invariants.md) |
| How order and payment integrity works | [`docs/architecture/core-transaction-design.md`](docs/architecture/core-transaction-design.md) |
| What has been decided, and what has not | [`docs/adr/`](docs/adr/) |
| What already exists and must not be rebuilt | [`docs/estate/migration-map.md`](docs/estate/migration-map.md) |
| **What is blocking work right now** | [`docs/program/blocked.md`](docs/program/blocked.md) |
| What still needs a human decision | [`docs/program/open-questions.md`](docs/program/open-questions.md) |
| When things happen | [`docs/program/roadmap.md`](docs/program/roadmap.md) |
| How to work in this repository | [`docs/program/governance.md`](docs/program/governance.md) |

## Three things worth knowing immediately

1. **This is not a greenfield programme.** A live production backend already
   implements a meaningful share of what F1 specifies — idempotent order
   placement, ambiguous-outcome handling, timed availability snooze, an
   order-integrity watchdog. See [`docs/estate/`](docs/estate/). F1 should absorb
   it, not rebuild it.
2. **Payment work is blocked.** No provider is selected and a freeze is in force,
   which puts 16 F1 requirements and three acceptance criteria behind an owner
   decision. See [B-01](docs/program/blocked.md).
3. **Production hosting is a gate, not a default.** Data residency has not been
   determined and the lab's platform confers no presumption. See
   [`docs/compliance/data-residency-gate.md`](docs/compliance/data-residency-gate.md).

---

## Working in this repository

```bash
npm ci
npm run verify        # traceability + boundaries + typecheck + tests
```

| Command | What it does |
|---|---|
| `npm run prd:extract` | Regenerate the requirement catalogue from the vendored PRD |
| `npm run req:index` | Regenerate the human-readable requirement index |
| `npm run req:lint` | Check traceability (add `-- --gate f0-exit` for the strict gate) |
| `npm run boundary:check` | Enforce the bounded-context dependency rule |
| `npm run typecheck` | Typecheck every workspace |
| `npm test` | Run all tests |
| `npm run spike:offline-sync` | Risk spike R-02 (Critical) |
| `npm run spike:print-queue` | Risk spike R-01 (High) |
| `npm run spike:shift-conflict` | Shift, cash and blind-count properties |

No build step: Node 22 runs the TypeScript sources directly by stripping types.
The only dependencies are TypeScript and Node type definitions — deliberately, so
the tooling that defines the requirement baseline carries no supply-chain risk.

## Layout

```
docs/          requirements, architecture, adr, estate, domain, compliance, lab, program
packages/      contracts — identifiers, events, sync protocol (depends on nothing)
services/      identity, menu, orders, payments, printing, sync-gateway (F0: boundaries only)
apps/          pos (Expo/iPad), console (F0: boundaries only)
spikes/        runnable risk harnesses, each with a control case
tools/         prd-extract, req-lint, boundary-check
supabase/      migrations, functions, tests
```

Service and application workspaces are **reserved boundaries**, not
implementations. The boundary exists now so that when F1 code arrives it lands
inside a shape the architecture gate approved.

## Requirement baseline

387 requirements, extracted reproducibly from `docs/source/`:

| Phase | Count | Scope |
|---|---|---|
| F0 | 33 | Discovery, architecture, prototypes, compliance planning, lab prep |
| **F1** | **164** | Nine-month lab release: POS, menu, OMS and platform dependencies |
| F2 | 19 | Production readiness, executive acceptance, new-branch rollout |
| F3 | 37 | Inventory, procurement, warehouse, factory |
| F4 | 81 | Finance, HR, payroll, employee app, delivery, assets |
| F5 | 49 | CRM, loyalty, marketing, analytics, AI |
| F6 | 2 | Lazywait migration from 1 January 2028 |

`requirements.yaml` and `INDEX.md` are **generated**. Ownership and traceability
annotations are hand-maintained in `annotations.yaml`; regenerating never discards
them.

## Change control

This repository inherits the change-control rules already operating in the live
Spicy Meal system. In short: never commit to a protected branch, every change
arrives by pull request, and **machine-generated text is never owner approval**.

Migrations, deployments, payment work, push broadcasts and any live write each
require explicit human owner approval, and approval for one action is never
blanket approval for the next. Full rules:
[`docs/program/governance.md`](docs/program/governance.md).

---

_Confidential working document for First Taste Company._
