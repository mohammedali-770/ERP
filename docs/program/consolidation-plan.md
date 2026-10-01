# Consolidation plan — from WMS to First Taste ERP

- **Follows from:** [`consolidation-evaluation.md`](./consolidation-evaluation.md) ·
  [ADR-0020](../adr/ADR-0020-consolidation-direction.md)
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011
- **Blockers:** B-03 · B-04 (answered) · B-05 · B-10 · B-11 · [Q-20](./open-questions.md)
- **Status:** proposed. **Phase 0 needs no decision. Phases 2 onward need D-5.**

This is the post-attack plan, not the designed one. Two adversarial passes returned
23 findings against the winning strategy and both concluded it failed as written;
the fixes are folded in below and marked **[fix]** where they changed something.

**The plan deliberately does not start with the migration.** It starts with an
incident, then builds the one thing the owner asked for that needs nothing from the
warehouse, then establishes the facts that turn effort guesses into numbers. The
long-run shape is decided after that, with evidence.

---

## Phase 0 — Contain B-10 · **no approval needed to write it; every step needs one to run it**

Not a migration phase. It is here because it is true today regardless of what is
decided, and because the obvious remediation order destroys data.

**[fix] The order is reversed from the obvious one.** Running `remove_demo_data()`
first looks like the fix and is the dangerous step: 51 `ON DELETE CASCADE`
constraints, `delete from auth.users` inside the removal, `stock_movements.created_by`
set to `on delete set null`, and a **free-plan project with no point-in-time
recovery**. Deletion destroys the attribution and any opening balance derived from it,
irreversibly.

Non-destructive containment, in order, each a separate owner-approved action on a
live system this session cannot touch:

1. **Check whether public sign-up is open** on `dyhkydedckizhxckryvq`. The warehouse
   repository says it is; that is unverified. This is the difference between a
   published password and an open door.
2. Close public sign-up if open. Enable **leaked-password protection**.
3. Set the documented demo profiles `is_active = false` — `private.current_user_role()`
   already treats that as removing every right, so it is a complete and reversible
   revocation.
4. Rotate the documented password; remove it from the warehouse repository's
   `docs/SYSTEM.md` (a write there, owner-approved).
5. **Only then**, and only after an export is taken and verified, consider deletion.

**Deliverable from this session:** a runbook in the shape of
`enablement/07-credential-rotation-runbook.md`, which this plan does not write until
asked, so it is not drafted ahead of the decision to act.

---

## Phase 1 — Correct the record, and map the processes · **no decision needed**

MFG-012 is the only baselined requirement whose subject is this migration. Its
deliverable is not code.

| PR | Contents |
|---|---|
| 1 | The evaluation, this plan, ADR-0020, B-04 answered, B-10, B-11, Q-20 — **this PR** |
| 2 | Estate record made true: `inventory.md` and `migration-map.md` carry today's facts |
| 3 | **The per-workflow process map.** One section per warehouse workflow, citing its real files and functions, ending in a named sign-off |
| 4 | Two decision-pack rows: **D-5** consolidation direction, **D-6** Supabase plan tier and residency |

**PR 3 is the whole phase.** It is judgement, not typing, and every effort estimate
anywhere in this plan is worthless until it exists. **[fix]** It is also where the
`f0-exit-criteria.md` gap bites: the signatories it needs — process owners per
domain — are recorded as *not yet appointed*. PR 4 exists so that is a decision with
a date rather than a blocked precondition discovered later.

---

## Phase 2 — The capability registry, ERP-native · **needs D-5**

The admin switch, built where it can be built correctly. Nothing from the warehouse
is involved, so this phase is independent of the migration's shape.

### The reframe that makes it work

The request conflates three things, and keeping them apart is the design:

- **Capability state** — is this module built and fit to use *here*? Set by an admin.
- **Permission** — may *this user* do this action? Already `IAM-003`/`IAM-006`.
- **Visibility** — does the menu render it? A *consequence*, never a control.

The rule is `capability_open(scope) AND permission_granted(principal, action, scope)`.
Neither implies the other. **Not a boolean:** the states are
`hidden | pilot | enabled | read_only | withdrawn`, default-deny, because the
programme needs "built but pilot-only" and "closed to new work, history still
readable" and a boolean expresses neither.

### What lands

- `erp.capability` and `erp.capability_state` in the `erp` schema, projection-stamped
  per I-8, following `20260920000400_event_log.sql`'s grant-**and**-trigger shape so
  the protection binds the owner too.
- `erp.assert_command_admitted()`, called before any event is minted. Default-deny on
  an unmapped `(aggregate_type, event_type)`, so a new event type cannot be born
  ungoverned.
- Twelve proposed requirements, `CAP-P01..P12`. **[fix]** Written
  **estate-agnostic** — no clause naming the warehouse, "preview" ceilings or
  retirement dates — because `PRG-015` makes a promoted identifier's meaning
  permanent, and encoding a temporary seam into the baseline is how a bridge becomes
  furniture. Estate-specific clauses live separately and expire.

### The fixes that are not optional

- **[fix] Do not append estate observations to `erp.event_log`.** Its `device_seq` is
  gapless per device with a hash chain, and a rejected duplicate has already consumed
  a sequence number — so idempotent re-ingestion and chain integrity cannot both
  hold there. Estate observations get `erp.estate_observation_log`, keyed on
  `(source, table_name, pk, row_hash)`, with its own append-only trigger.
- **[fix] Add the new projection to *both* hardcoded assertion lists** in
  `tools/db-check/src/assertions.ts` — `projection-stamp-is-mandatory` and
  `projection-stamp-resolves-to-a-real-event` each enumerate four table names
  literally, so a fifth projection passes both while proving nothing. And add a
  `has_column` assertion, because the stamp check tests nullability, not existence.
- **[fix] Add the table to `tools/db-fixtures`' reset list** in the same PR as its
  pgTAP suite, or write fixtures leak between cases.
- **[fix] `erp.event_log.device_id` is `not null`.** A capability change is a central
  decision with no device. This is a real gap in the ERP's own event log and must be
  resolved before the registry can append anything — it is not a registry problem.
- **[fix] Anything added to CI is added to `npm run verify` in the same commit.**
  `governance.md` records that the verify/CI mirror is an already-learned lesson.
- **[fix] Nothing new goes in a *required* check.** A new job named `Estate seam`,
  deliberately not in `main.json`'s required list — `tools/ci-contract` only compares
  required-versus-documented names, so a non-required job needs no ruleset edit and no
  owner action.

### Enforcement, and what is not enforcement

Hiding a menu entry is not access control. The controls are: `anon`, `authenticated`
and `service_role` hold no `USAGE` on `erp`, so no browser reaches a capability table
at all; and command admission refuses writes in the database. The menu is ergonomics.

**[fix] Dropped from the design: the retirement clock as a required check.** A check
that fails on a calendar date makes every unrelated PR unmergeable the day a date
passes, and the ruleset's bypass list is empty, so it binds the owner too. Permanence
is prevented by a **named owner per module and an executive review date**, with the
clock as a `req-lint` *warning*. A clock is one editable file encoding something that
has not gone wrong yet — the weakest class of check in a repository whose every other
enforced rule encodes a failure that actually happened.

---

## Phase 3 — Decide the long-run shape · **D-5**

Only now, with the process map in hand. The two live options:

| | Two stores, ERP shell | Rebuild on the ERP core |
|---|---|---|
| Scored | 21/30 — consistent | 19/30 — wins compliance and data-risk, loses delivery 3/10 |
| Time to value | Short | 14–20 months to parity |
| Financial record | Stays in 53 mutable `public` tables | Becomes an event log that can be audited |
| Needs | A seam, and discipline to retire it | A **specification freeze** on a repo that took 96 commits in five days |
| Fails if | The seam becomes permanent | The freeze never happens |

**Importing the warehouse wholesale is not among them.** 11/30, seven of ten
invariants rescoped, forced RLS declined by design, `db:check` weakened to admit what
it currently rejects.

**[fix] B-03 comes before any of it.** One branch visit with real iPads and a real
printer clears `PRN-014`, `OFF-012`, `OFF-013` and `OFF-014` — which
`f0-exit-criteria.md` records as the entire remaining gate failure. Spending F0
attention on F3 infrastructure while that sits open inverts the cheapest win
available.

---

## Phase 4 — Execute the chosen shape

Not planned in detail here, deliberately: the shape is undecided and a detailed plan
for the wrong one is waste. What is already known to be required either way:

- **[fix] `tools/boundary-check` must be fixed before it is relied on.** Its
  resolver matches `@firsttaste/<directory>`, but workspaces publish under prefixed
  names, so a cross-workspace import written as a package name resolves to null and
  is skipped. Any containment claim resting on it is currently false.
- **[fix] A dependency and build-step check.** The two-dependency and no-build-step
  rules are stated in three places and enforced nowhere — absent from `CLAUDE.md`'s
  enforced table, invisible to `boundary-check`, read by no test. It must assert
  lockfile shape, since npm workspaces hoist into one lockfile and nesting does not
  isolate a supply chain.
- **[fix] Widen `tsconfig.json`'s include alongside the test glob.** Tests under
  `services/*/test` and `apps/*/test` would run but never typecheck.
- **[fix] Snapshot-and-diff, never CDC.** `updated_at` is trigger-maintained on five
  tables only, seven have no timestamp at all, and there is no LSN to trust. A partial
  export is marked `generation_incomplete` and **refused for diffing**, so a truncated
  extract is never read as mass deletion.
- **[fix] Per-document money control totals** against the warehouse's own header
  figure, with more than two decimals a reconcile failure rather than a rounding
  opportunity.
- **[fix] Payment-adjacent surfaces ship hidden.** `supplier_invoices`,
  `supplier_payments`, `month_end`, `accounting_export` — so the freeze's first
  production test fails closed while Q-20 is open.

---

## What this plan will not do

- **It will not write to the warehouse repository, any Supabase project, or any live
  system.** `CLAUDE.md` §1. Every Phase 0 step and everything in Phase 4 that touches
  a hosted project is an owner-approved action, one at a time, §4.
- **It will not move this ERP into the warehouse repository.** The owner's "or vice
  versa" is foreclosed by §1 and is the weaker direction regardless: that repository
  has no tests, no requirement baseline, no invariants and no change control.
- **It will not treat this plan's existence as approval.** The instruction that
  produced it is machine-generated text, which §3 says is not owner approval.

## Verification

Each PR: `npm run verify` green, `npm run db:check` where migrations change,
`npm run db:test` for pgTAP, `secret:scan` clean, every relative link resolving, and
a test that fails without the change. Phase 2's registry additionally needs its
control case — a fixture that sets a capability `hidden` and proves a write is
**refused by the database**, not merely absent from a menu. A registry whose control
passes has proved nothing.
