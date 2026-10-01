# ADR-0020 — The warehouse system and the ERP stay in two databases

- **Status:** Proposed — the direction decision is **D-5** and belongs to the owner,
  with executive management where it moves the roadmap
- **Date:** 2026-10-01
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011
- **Deciders:** Product Owner, with executive management on the resequencing
- **Related:** ADR-0011 · ADR-0018 · ADR-0019 · B-04 · B-05 · B-10 · B-11 ·
  [`../program/consolidation-evaluation.md`](../program/consolidation-evaluation.md) ·
  [`../program/consolidation-plan.md`](../program/consolidation-plan.md)

## Context

The owner asked on 2026-10-01 for the warehouse and factory system to be merged with
this repository — in either direction — so the result is "not only WMS but a full
First Taste ERP", with an administrator able to expose finished features and withhold
unfinished ones.

The warehouse system is not a legacy system awaiting replacement. As of today it
carries **98 commits across 41 pull requests** made since 2026-09-14, **99
migrations**, ~26,900 lines of application code, a Vercel deployment, CI on every pull
request, and full Arabic/RTL support. It runs the business's stock, costing, purchase
orders, factory operations, supplier invoices and month close.

This repository, by contrast, is Phase F0. It has tooling, a 387-requirement
baseline, ten architectural invariants enforced in CI, and **no feature code at all**
— `services/` and `apps/` are reserved boundaries.

So the asymmetry runs the opposite way to the usual migration: the working system is
the one without the controls, and the system with the controls has not yet built
anything.

### The finding that forces the decision

The two systems' security models are **mutually exclusive in a single database**.

The warehouse's authorisation *is* the `authenticated` role reaching `public` tables
through RLS — 155 `TO authenticated` policy clauses, `grant usage on schema private to
authenticated`, and 50 `SECURITY DEFINER` functions callable over
`/rest/v1/rpc/…`, each protected only by its own internal role check (B-10).

This repository's authorisation *is* withholding access from exactly those roles.
`anon`, `authenticated` and `service_role` hold no `USAGE` on `erp`; RLS is *forced*
on every table; and **"No ERP object is created in `public`"** is enforced by
`db:check` and pgTAP, which means it fails the build rather than a review.

A direct import therefore requires either ~245 objects in `public` — which cannot
merge — or rescoping the invariants so they no longer cover the stock, costing,
supplier-invoice and month-close data. `invariants.md:3-5` governs that choice: *"If a
proposed change violates one, the change is wrong regardless of how convenient it
is."* An ADR is the right instrument for amending one invariant. It is not an
instrument for retiring seven.

## Decision

### 1. The two systems keep two databases. There is no schema merge.

The seam between them is a service tier and a one-way, append-only observation pipe —
never a shared database. This is a finding rather than a preference: the alternative
cannot pass the checks this repository already enforces.

### 2. The direction is into this repository, and the reverse is foreclosed.

`CLAUDE.md` §1 permits writes in this repository only, so moving the ERP into the
warehouse repository cannot be done from an agent session at all. It is also the
weaker direction: that repository has no tests, no requirement baseline, no invariants
and no change control, so merging into it discards every control this repository
exists to provide.

### 3. Importing the warehouse's code and migrations wholesale is rejected.

Scored 11/30 against 21 and 19 for the alternatives, and rejected on five grounds
each independently sufficient: it rescopes seven of ten invariants; it declines forced
RLS by design, because forcing it would break the 95 `SECURITY DEFINER` functions that
are the warehouse's real authorisation layer; it weakens `db:check` with a stubbed
`auth` schema so the gate proves migrations apply *given a fiction*; it takes
dependencies from 2 to 20 and adds a build step; and its migration history is provably
un-replayable in part — a `DO` loop drops every `public` policy and 53 later `ALTER
POLICY` statements depend on exact surviving names with no `IF EXISTS` available.

### 4. The administrator's capability switch is built here, ERP-native, and first.

It is the half of the request with the clearest value and it needs **nothing** from
the warehouse, so it does not wait on the direction decision. Three things the request
conflates are kept separate — **capability state** (is this built and fit to use
here?), **permission** (may this user?), and **visibility** (does the menu render
it?) — with the effective rule `capability_open AND permission_granted`, and
visibility a consequence that is never a control. The state set is
`hidden | pilot | enabled | read_only | withdrawn`, default-deny, because a boolean
cannot express "built but pilot-only" or "closed to new work, history still readable".

### 5. The long-run shape is deferred to D-5, with the process map as its input.

Two options stay live — two stores with an ERP shell, or rebuilding on the ERP core
with the warehouse as specification. The first scored highest overall; the second won
compliance and data-risk and lost delivery 3/10, needing 14–20 months and a
specification freeze on a repository that took 96 commits in five days. Choosing
between them is a resequencing and budget judgement, which is why this ADR does not
make it.

## Consequences

- **Two systems, two identities, for as long as the seam exists.** This is the real
  cost and the evaluation does not minimise it: it is the longest-lived state in any
  strangler, and on a payroll-bearing estate it is worse than either endpoint.
- **The financial record stays where it is** until D-5 chooses otherwise — 53 mutable
  `public` tables on a **free-plan** project in `eu-central-1` with no point-in-time
  recovery, with attribution destroyed on user deletion (B-11). That is
  [Q-20](../program/open-questions.md), and it is now written down rather than
  implied.
- **A green pipeline will not mean what it appears to mean.** Nine of eleven
  structural assertions are `erp`-scoped, so while the data that matters sits outside
  `erp` they pass over an empty blast radius. Said here so no reviewer reads six green
  checks as "the invariants hold for the business's data".
- **F3 is not pulled forward by this ADR.** B-03 remains the cheapest available win —
  one branch visit clears `PRN-014`, `OFF-012`, `OFF-013` and `OFF-014`, the entire
  remaining F0 gate failure — and ADR-0019 argues for depth before breadth.
  Consolidation is breadth.
- **B-04 is answered** as a side effect: the database is `warehouse-factory-system`,
  ref `dyhkydedckizhxckryvq`, created 2026-09-27. The blocker was overtaken rather
  than wrong.
- **If the capability registry is built and nothing else is**, the outcome is still
  positive: the ERP gains its first working capability and the switch the owner asked
  for, with no foreign SQL, no new dependencies and no weakened check.

## Alternatives considered

**Import the warehouse into this repository.** Covered in §3. The strongest argument
for it is honest — it is the only option that makes one system quickly — and its own
design concedes the owner's actual request needs none of its first three phases.

**Rebuild on the ERP core now.** The best outcome on compliance and auditability, and
the only strategy under which the financial record ends up genuinely auditable. Not
chosen *now* because it depends on a warehouse feature freeze that the organisation's
demonstrated behaviour makes implausible, and because 14–20 months of two systems is a
larger bet than this evaluation can justify without the process map. It remains live
as D-5.

**Build the switch in the warehouse repository instead.** All three designs
independently concluded this is roughly a fortnight's work there against months here,
because the screens, roles and users already exist. It is genuinely the fastest route
to what the owner asked for. Not adopted because §1 forecloses it from this session
and because the work is thrown away when consolidation happens — but it is the option
someone optimising purely for next-month value would take, and the owner should be
told that rather than left to infer it.

## Status note

**Proposed, and it should stay Proposed until the owner decides D-5.** This ADR was
produced by an agent session from a read-only reading of both repositories and
read-only queries against the live Supabase account. It recommends against the
direction the request implied, which makes it a recommendation on the record rather
than a decision. The instruction that produced it is machine-generated text, and
`CLAUDE.md` §3 is explicit that this is not owner approval.
