# Consolidating the warehouse system and the ERP — an evaluation

- **Asked:** 2026-10-01, by the owner — "shift whatever we have in
  `ExsistingWarehouseFactorySystem` to here or vice versa, making the required
  edits, so it becomes not only WMS but a full First Taste ERP. The admin can make
  the done features as visible and the things under construction unavailable."
- **Requirements:** MFG-012 · IAM-003 · IAM-006 · PRG-010 · PRG-011
- **Related:** [ADR-0020](../adr/ADR-0020-consolidation-direction.md) ·
  [`consolidation-plan.md`](./consolidation-plan.md) · B-04 · B-05 · B-10 · B-11 ·
  [Q-20](./open-questions.md)
- **Status:** evaluation complete; the decision is the owner's and is D-5 in the
  decision pack.

This document answers "should we, and how". The plan that follows from it is
separate. **The short answer is that the two systems should not be merged into one
database, that the half of the request worth building first is the admin switch
rather than the migration, and that one finding here is more urgent than either.**

---

## 0. Read this part first

While establishing the facts, the evaluation found a live exposure on the warehouse
system. It is recorded as **B-10** and is not a consolidation question — it is true
today whatever is decided here.

Verified against the live project by Supabase's own security advisors, observed
2026-10-01 06:57Z: **50 `SECURITY DEFINER` functions in `public` are callable by any
signed-in session over `/rest/v1/rpc/…`**, **leaked-password protection is
disabled**, and the warehouse repository documents a demo **admin** login together
with its password. B-10 states the precise scope, why the obvious remediation order
is the dangerous one, and what to do instead.

**B-11** records the second finding: deleting a user erases their attribution rather
than preserving it, across a system proposed as the ERP's opening balance.

---

## 1. What the two systems actually are, as of 2026-10-01

The ERP's estate documents described the warehouse system as it was on 2026-09-22.
It has changed substantially since, so the first job was re-establishing the facts.

| | Warehouse system | This ERP repository |
|---|---|---|
| Purpose | Working WMS + factory system, in production use | Phase F0 planning and foundation |
| History | **98 commits, 41 PRs, 2026-09-14 → 2026-10-01** | ~30 PRs of planning artefacts |
| Code | ~26,900 lines TS/TSX, 74 files, 39 page components | Tooling only; `services/`, `apps/` reserved and empty |
| Database | **99 migrations**, 54 tables in `public` + 7 in `private` | 9 migrations, everything in `erp` |
| Dependencies | 6 prod, 14 dev; Vite build | **2, deliberately; no build step** |
| Tests | **none** — no `test` script | 268 tests, 6 required CI checks |
| Deployed | **Yes** — Vercel, `vercel.json`, CI on every PR | No hosted project exists (ADR-0018) |
| Hosted DB | `warehouse-factory-system` `dyhkydedckizhxckryvq`, `eu-central-1`, **free plan** | none |
| i18n | Arabic + English throughout, RTL, per-user language | Requirement data bilingual; prose English |

**The warehouse system is further along than this repository is.** It has branch
ordering with geofencing, two purchase-order streams with approval limits, goods
receipts, a seven-step daily factory sheet, recipes and production planning, FEFO
lots with expiry, stock counts, moving-average costing and valuation, month close
with reopen, supplier invoices with 3-way match and payments, a balanced accounting
journal export, POS sales import and branch food-cost analysis, notifications with
web push, and six bilingual print templates. All of that is built and in use.

That is the central asymmetry: **this is not a migration of a legacy system into a
new one. It is a proposal to move a working system into a repository that has not
yet built anything.**

### Facts that changed, and are now corrected in the estate record

| Was recorded | Reality on 2026-10-01 |
|---|---|
| B-04: warehouse database unidentified | **Answered** — ref `dyhkydedckizhxckryvq`, created 2026-09-27, in the same org. B-04 was correct when written; the project did not exist yet |
| "no CI, no deployment config" | CI on every PR since 2026-09-29; Vercel since 2026-09-30 |
| 59 migrations, 28 tables | 99 migrations, 54 `public` tables + 7 `private` |
| Org holds `whatsapp-inbox-simple` | **No longer present** — bears on B-08 |

Two documents inside the warehouse repository are actively misleading and anyone
planning from them will be wrong in opposite directions: its
`INVENTORY_SYSTEM_PROGRESS.md` lists almost every screen as pending, and its
`SETUP_GUIDE.md` claims everything is complete. Its `docs/SYSTEM.md` is the current
one and says so.

---

## 2. Why the naive merge fails

Not for taste reasons. The two systems' security models are **mutually exclusive in
one database**, and the ERP's are enforced by checks that fail the build.

**The warehouse's security *is* `authenticated` reaching `public` tables through
RLS** — 155 `TO authenticated` policy clauses, plus `grant usage on schema private
to authenticated`, plus the 50 owner-privileged RPCs of B-10.

**The ERP's security *is* withholding schema access from those very roles** —
`anon`, `authenticated` and `service_role` hold no `USAGE` on `erp` at all, RLS is
*forced* on every table, and the invariant *"No ERP object is created in `public`"*
is enforced by `db:check` and pgTAP.

You cannot satisfy both in one database. Importing the warehouse as-is requires
either putting ~245 objects in `public` — which fails a required check — or
rescoping the invariants so they no longer cover the data that matters.

Three further mechanical obstacles, each independently sufficient to stop a direct
import:

1. **48 warehouse migrations reference `auth.*`**, which `db:check`'s scratch
   Postgres does not have. Making them apply means stubbing a fake `auth.uid()`, at
   which point the gate proves migrations apply *given a fiction*.
2. **The migration history cannot be replayed in part.** One migration drops every
   policy in `public` in a `DO` loop, and 53 later `ALTER POLICY` statements depend
   on exact surviving names with no `IF EXISTS` available.
3. **Dependencies and the build step.** 2 → 20 dependencies and a Vite build, in the
   repository whose stated reason for two dependencies is that the requirement
   baseline must carry no supply-chain risk.

### The direction the request offered, and why one half is foreclosed

"**or vice versa**" — moving this ERP into the warehouse repository — **cannot be
done from an agent session at all.** `CLAUDE.md` §1 permits writes in this
repository only. That is not a preference to be weighed; it is the rule, and the
instruction that produced this evaluation is machine-generated text, which §3 says
is not approval.

It is also the weaker direction on the merits: the warehouse repository has no
tests, no requirement baseline, no invariants and no change control, so merging into
it means discarding every control this repository exists to provide.

---

## 3. Three strategies, scored

Three complete designs were produced independently, then scored by three
independent judges, each confined to one lens and each verifying the designs'
factual claims against the repositories.

| Strategy | Compliance | Delivery | Data & security | Total |
|---|---|---|---|---|
| **Keep two stores; ERP becomes the shell** ("strangler") | 7 | **7** | 7 | **21** |
| **Rebuild on the ERP core, warehouse as specification** | **8** | 3 | **8** | 19 |
| **Import the warehouse into this repository** ("absorb") | 3 | 4 | 4 | 11 |

**The totals and the lenses disagree, and that matters more than the ranking.**
Rebuild wins two of the three lenses and loses on delivery so badly (3/10) that it
drops to second overall. Strangler wins nothing outright and places second
everywhere, which is what consistency looks like.

**Import fails decisively and should be taken off the table.** It rescopes seven of
ten invariants so the stock, costing, supplier-invoice and month-close data sit
outside all of them; it declines forced RLS on the imported schema because forcing
it would break the 95 `SECURITY DEFINER` functions that are the real authorisation
layer; and it weakens `db:check` to admit content that check currently rejects.
`docs/architecture/invariants.md:3-5` is the governing sentence — *"If a proposed
change violates one, the change is wrong regardless of how convenient it is."* An
ADR is the right way to amend one invariant. It is not a mechanism for retiring
seven.

### What each judge said in one line

- **Compliance:** rebuild, narrowly — it amends exactly one invariant (I-5), on
  ground the repository itself already concedes; strangler amends none but holds
  domain facts in a service whose context is reserved.
- **Delivery:** strangler, clearly — it is the only strategy that is value-positive
  if it stops after its first phase. Rebuild needs 14–20 months and a specification
  freeze on a repository that took 96 commits in five days.
- **Data & security:** rebuild — it is the only strategy under which the
  authoritative financial record ends up auditable, and the only one that converts
  `reopen_month` from "one admin with a free-text reason" into a retained event.

### Then the winner was attacked, and did not survive as written

Two adversarial passes returned **23 findings**, both concluding the plan fails as
written. The four that require restructuring rather than rewording:

1. **`boundary-check` cannot see the import it is credited with forbidding.** Its
   resolver matches `@firsttaste/<directory>`, but the workspaces publish under
   prefixed names, so a cross-service import by package name resolves to null and is
   skipped. The strategy's containment mechanism does not currently exist.
2. **Appending estate observations to `erp.event_log` breaks it.** The log's
   `device_seq` is gapless per device with a hash chain; a rejected duplicate has
   already consumed a sequence number. Idempotent re-ingestion and chain integrity
   are mutually exclusive there. Estate observations need their own append-only
   table.
3. **A claimed privacy benefit does not exist.** The seed-content assertions only
   ever see a database built from migrations plus declared seeds, so routing estate
   facts through the log does not bring them into scope.
4. **The anti-permanence mechanism would freeze the repository.** A clock that fails
   a *required* status check on a calendar date makes every unrelated PR unmergeable
   the day a date passes — and the ruleset's bypass list is empty, so it binds the
   owner too.

Every one of the 23 has a small, named fix. That is the point of running the attack:
the plan is now the post-attack version, not the designed one.

---

## 4. Recommendation

**Do not merge the databases. Do three things in this order.**

1. **Contain B-10 now**, as an incident, separately from all of this.
2. **Build the admin capability switch in this repository**, ERP-native and
   event-sourced. This is the half of the request with the clearest value and it
   needs nothing from the warehouse.
3. **Correct the record and map the processes** — MFG-012's actual deliverable, a
   signed per-workflow process map — before designing any seam.

Then decide the long-run shape with evidence in hand, as D-5. Not now, and not in
this document: the choice between "two stores indefinitely with an ERP shell" and
"rebuild on the ERP core" turns on a resequencing judgement and a budget that an
agent session is not accountable for.

### The uncomfortable part, stated plainly

**All three strategies independently concluded that the admin switch the owner
actually asked for is roughly a fortnight's work inside the warehouse
repository** — where the screens, the roles and the users already are — against
months to deliver it ERP-native. `CLAUDE.md` §1 forbids this session from writing
there.

So there is a real choice, and it is the owner's:

- **Build it ERP-native** (the plan's Phase 2). Slower, but it lands in the
  repository with the invariants, the tests and the change control, and it is the
  first genuinely useful thing the ERP does.
- **Build it in the warehouse** under explicit owner approval. Much faster to the
  business, and it is throwaway work the moment consolidation happens.
- **Both** — specify it here, implement it there, and treat the ERP-native version
  as the real one when the seam exists.

This evaluation recommends the first, and notes without hedging that the second is
what someone optimising purely for next-month value would choose.

### What is not recommended, and why

- **A big-bang merge.** It fails compliance 3/10 and its own author's design
  concedes the user's request needs none of its first three phases.
- **Pulling F3 forward wholesale.** F1 has not started one of its eleven
  workstreams, the PRG-010/PRG-011 architecture gate has not been passed, and
  ADR-0019 argues for depth before breadth. Consolidation is breadth.
- **Spending F0 attention here before B-03.** One branch visit with real iPads and a
  real printer clears `PRN-014`, `OFF-012`, `OFF-013` and `OFF-014`, which
  `f0-exit-criteria.md` records as the entire remaining gate failure. That is the
  cheapest win available and this work is not it.

---

## 5. What this evaluation does not establish

- **Whether the warehouse data is fit to be an opening balance.** B-11 says
  attribution is destroyed by design; nothing here has reconciled a single balance.
  A physical count is the fallback and should be priced.
- **Residency and durability.** The authoritative financial record is on a
  **free-plan** project in **`eu-central-1`**, with no point-in-time recovery, for a
  Saudi business with PDPL obligations. That is [Q-20](./open-questions.md) and it
  interlocks with B-05; it is a decision, not a finding.
- **Effort.** No estimate here is better than an order of magnitude. The process map
  is what turns these into numbers, which is why it is the first deliverable.
- **Whether public sign-up is open on the live project.** The warehouse repository
  says it is (`docs/SYSTEM.md:1059-1062`); that was not independently verified, and
  it is the first thing B-10 asks IT to check.

---

*Produced by an agent session on 2026-10-01 from a read-only reading of both
repositories and read-only queries against the live Supabase account. Nothing was
written outside this repository. The owner's instruction to evaluate is not approval
for any action this document recommends — `CLAUDE.md` §4 applies to each separately.*
