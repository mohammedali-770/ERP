# ADR-0021 — One project: the warehouse system is rebuilt into the ERP

- **Status:** Accepted — the owner decided this directly on 2026-10-01, in the active
  conversation, after being shown the evidence that reversed it
- **Date:** 2026-10-01
- **Supersedes:** [ADR-0020](./ADR-0020-consolidation-direction.md)
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011 · CAP-P01..P12
- **Related:** ADR-0011 · ADR-0018 · ADR-0019 ·
  [`../program/consolidation-plan.md`](../program/consolidation-plan.md) · Q-20 · B-03

## Context

ADR-0020 concluded, the same day, that the two systems should stay in two databases.
It was sound reasoning from a false premise: it assumed the warehouse system was in
production and that a running business had to be protected throughout.

**The owner stated that neither system is in production. That was verified read-only
against the live warehouse database before acting on it:**

| | |
|---|---|
| `private.demo_users` | 7 |
| `public.profiles` | 8 — so **seven of eight accounts are demo accounts** |
| Items / branches / suppliers | 18 / 5 / 6 |
| Distinct actors in `stock_movements` | 5, all demo |
| Orders | 2026-08-27 → 2026-09-30 |

That is a test fixture. Three of the four pillars holding up ADR-0020 rest on
production and collapse without it:

1. **Cutover risk** — nothing to cut over.
2. **The data migration** — B-11's destroyed attribution, opening balances, control
   totals, truncated-extract guards were all about preserving real history. There is
   none. Eighteen items and seven demo users are re-seeded.
3. **Delivery cost** — the rebuild option scored 3/10 on delivery because of parity
   before cutover, two systems running in parallel, a warehouse feature freeze, and
   per-migration owner approvals against a live database. Every one of those is a
   production cost.

What does *not* change is the finding that produced ADR-0020's §1, and it is the
reason this ADR still does not simply import the warehouse schema: **the two
authorisation models cannot share one database.** The warehouse's security *is* the
`authenticated` role reaching `public` tables through RLS — 155 policy clauses, 95
`SECURITY DEFINER` functions callable over `/rest/v1/rpc/…`. The ERP's *is*
withholding schema access from exactly that role, with RLS forced and "no ERP object
in `public`" enforced by `db:check` and pgTAP.

With no data to preserve, that conflict stops being a reconciliation problem and
becomes a choice. We choose the ERP's model, because it is the one designed for a
system that will hold payroll and financial records, and because it is enforced rather
than reviewed.

## Decision

### 1. One repository, one database, one application.

Everything lands in this repository, in the `erp` schema, with every existing
invariant intact and no check weakened. The warehouse repository and its Supabase
project become **read-only reference material** and are decommissioned at the end. All
writes land here, so `CLAUDE.md` §1 is satisfied by construction rather than by
exception.

### 2. The schema is rewritten, not ported.

The warehouse's 99 migrations are read as a schema *design* — operationally proven,
and the most valuable thing in it after the specification — and re-expressed in `erp`.
They are not transformed, renumbered or replayed. ADR-0020 §3 records why a port
cannot work: a `DO` loop drops every `public` policy and 53 later `ALTER POLICY`
statements depend on exact surviving names with no `IF EXISTS`. None of that matters
once the target is a fresh schema.

### 3. The application is carried over, not rewritten.

~26,900 lines of React/TSX across 39 page components, bilingual with RTL, six print
templates, a PWA service worker and a 59-entry six-role menu. It works. Rewriting it
would be waste. It is carried module by module behind a rewritten data-access layer,
because the data layer is the part bound to the old security model and the components
are not.

### 4. `apps/*` may have a build step and its own dependencies.

`CLAUDE.md`'s two-dependency and no-build-step rules were written for the tooling that
defines the requirement baseline, and the reason given is supply-chain risk to *that*
tooling. A React application cannot honour them and does not threaten what they
protect. **The rules stand unchanged for `tools/`, `packages/` and `services/`, and
are made mechanical for the first time** by a dependency-policy check — they are
currently stated in three places and enforced nowhere.

### 5. The capability registry is the migration's own control.

Each module arrives `hidden`, acquires its rewritten data layer and its tests, and is
promoted only then. `CAP-P09` already requires that a capability cannot be made
generally available until the evidence for its requirements can be produced. So "done
means visible, unfinished means unavailable" — the owner's original request — is
enforced by the mechanism rather than by anyone remembering, and it is what keeps
27,000 lines of currently-untested code honest as it arrives.

### 6. Payment-adjacent modules ship hidden and stay hidden.

`supplier_invoices`, `supplier_payments`, `month_end` and `accounting_export` arrive
`hidden` while the payment freeze (`CLAUDE.md` §6) and Q-20 are open, so the freeze's
first real test fails closed rather than relying on a reviewer.

## Consequences

- **F3 is pulled forward past F1, and ADR-0019 argued the opposite.** ADR-0019 wanted
  depth before breadth; this is breadth. It is a genuine trade and the owner made it
  with the cost stated. What ADR-0019 was protecting — discovering late that the
  deployment model does not hold — is unaffected: B-03 and the lab still gate
  `OFF-012`/`OFF-013`/`OFF-014`, and one branch visit still clears the entire
  remaining F0 gate failure for very little money.
- **The ERP stops being a planning repository.** It acquires an application, a build
  step and real dependencies. The PRG-010/PRG-011 architecture gate is passed by
  building through it rather than by a costed study.
- **Untested code enters a repository whose standard is "a test that would fail
  without your change".** Mitigated by §5 and by nothing else; if the registry gating
  is weakened, that standard is gone.
- **B-10 and B-11 drop from urgent to housekeeping**, and are re-scoped accordingly.
  They were correctly urgent *given* production. A demo password on a test project
  with no real data is a tidy-up — still worth closing public sign-up and disabling
  the demo accounts, but it blocks nothing.
- **Hosting moves.** ADR-0018 defers the ERP's hosted project to ~April–May 2027. One
  project means one database sooner; development stays local on Docker for a long
  while, so this is not urgent, but ADR-0018 will need revisiting rather than
  silently drifting.
- **Q-20 becomes a precondition rather than an open question.** `eu-central-1` and the
  plan tier must be settled before any real data is entered — which, since there is
  none today, is now a thing that can be decided calmly and in advance.

## Alternatives considered

**Keep two databases with an ERP shell (ADR-0020).** Scored highest of the three
strategies, on the strength of leaving a live system undisturbed. With no live system
its advantage is worth nothing, and it would leave the financial record permanently in
53 mutable `public` tables behind nine structural assertions that pass vacuously.

**Import the warehouse's code and migrations wholesale.** Still rejected, and the
reasons are unchanged by the production finding: it rescopes seven of ten invariants,
declines forced RLS by design, and stubs `auth.uid()` so `db:check` proves migrations
apply given a fiction. The absence of data removes the *need* for it, not its defects.

**Rebuild from the PRD without reusing the warehouse at all.** Rejected as waste. The
warehouse system is a validated specification for F3 and a working bilingual UI, both
of which were expensive to produce and neither of which is improved by being thrown
away.
