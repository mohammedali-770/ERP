# ADR-0023 — Edge functions hold the ERP's database credential

- **Status:** Accepted — the owner decided this on 2026-10-02, in the active
  conversation, choosing between the three options [Q-21](../program/open-questions.md)
  set out
- **Date:** 2026-10-02
- **Corrected:** 2026-10-02, after review, without changing the decision. §1's reasons
  had said the warehouse system already ran this pattern, and its citations named
  ADR-0018 §3 as the rule that keeps API roles out of `erp`. The warehouse's sign-in uses
  `service_role` through PostgREST, so what §1 decides is new on this estate. The rule
  lives in a migration and a `db:check` assertion, which are now cited
- **Answers:** [Q-21](../program/open-questions.md)
- **Requirements:** IAM-001 · IAM-008 · IAM-010 · SEC-003 · SEC-004 · CAP-P04 · CAP-P11 ·
  IAM-P01 · IAM-P08
- **Related:** ADR-0018 · ADR-0021 · ADR-0022 ·
  [`../program/consolidation-plan.md`](../program/consolidation-plan.md) Phase 4

## Context

The ERP's privilege model keeps every API role out of the `erp` schema: `anon`,
`authenticated` and `service_role` hold no USAGE on it (ADR-0018 §3, enforced by
`db:check`'s `api-roles-cannot-reach-erp`). Only `erp_app` (the runtime) and `erp_read`
(reporting) can reach it, and both are `nologin`.

So **PostgREST cannot be the ERP's API** — it runs every request as `anon` or
`authenticated` — and something server-side has to hold a connection that acts as
`erp_app`. Until something did, Phase 4 could build each module's tables and tests but
not its data layer, its screens, its staff acceptance testing or its promotion, and
ADR-0022 could check only that the actor a caller *named* was permitted, not that the
named actor was the one connected.

Q-21 offered three candidates: edge functions, a small API service, or PostgREST on a
second, `erp`-only role.

## Decision

### 1. Supabase Edge Functions hold the `erp_app` credential.

Every request from the console reaches the database through an edge function, which
connects to Postgres directly — not through PostgREST — as a dedicated login role
holding `erp_app`'s privileges and nothing else. Never `service_role`, which would
bypass row-level security and is the credential the warehouse system's
`admin-create-user` misused: until that repository's commit `ae60684` (2026-09-27) it
created users of any role, `admin` included, for any caller, without checking who was
asking.

Why this option: everything stays in one Supabase project, which ADR-0021 already
committed to. An edge function already signs branch workers in on this estate (the
warehouse system's `worker-sign-in`), so writing, deploying and operating one is
familiar. That function connects as `service_role` through PostgREST, which this
decision rejects. So a direct connection as a non-`service_role` login role, with its
connection limits, is new here: the foundation PR proves it, not precedent. And no
server has to be hosted and paid for outside ADR-0018's costing.

### 2. The edge layer is where the actor becomes real.

`erp.verify_pin()` answers whether a PIN matches. The edge layer turns an `ok` into a
session, and on every later call resolves the session to a `person_id` and passes that
— and only that — as the actor to `erp.assert_permitted()` and the module's write
functions. A caller cannot name an actor; the session names it. This closes the gap
ADR-0022 left open, and it is where IAM-008's sign-in records, IAM-010's revocation
and CAP-P11's database-enforced read-only preview are implemented.

### 3. Logic is plain TypeScript; the Deno entry points are thin.

Neither Deno nor the Supabase CLI is in the development container, and CI's
`Database stack` job starts the local stack with the edge runtime excluded. So, as with
`apps/console/src/navigation.ts`, each function's logic lives in plain TypeScript that
`npm test` can exercise, and the file Deno loads only wires a request to it. How the
Deno side is typechecked and tested in CI — and what that adds to the supply chain —
is decided in the PR that builds the foundation, not assumed here.

### 4. Nothing is deployed without the owner, one deployment at a time.

`CLAUDE.md` §4 lists "deploying or deleting an edge function" as owner-approved, and
no hosted project exists yet (ADR-0018). Edge functions are written, reviewed and
tested in this repository; deploying any of them is a separate, approved act.

## Consequences

- The rule that no API role reaches `erp` stands unchanged. Migration
  `20260920000200_roles_and_default_privileges.sql` revokes the schema from them, and
  `db:check`'s `api-roles-cannot-reach-erp` fails if any of them can reach it. ADR-0018
  §3 explains why withholding USAGE is what binds `service_role`.
- **The foundation comes before any module's data layer**: the login role, the
  connection, sessions issued from `erp.verify_pin()`, actor resolution, and the
  console calling functions over HTTPS with a session token. It finishes Phase 3's
  remaining sign-in work, and every Phase 4 module's step 2 builds on it.
- The foundation PR must show the direct connection working from the edge runtime,
  within its connection limits, before any module's data layer depends on it.
- The connection string is a secret held in the edge functions' environment.
  `secret:scan` keeps it out of the repository, as it does every credential shape.
- Edge functions add a runtime — Deno — that the repository's two-dependency rule does
  not yet speak to. The foundation PR decides how it is pinned, as ADR-0021 §4 decided
  for `apps/*`.

## Alternatives considered

**A small API service in `services/`.** One process owning sessions and the
connection: the cleanest boundary, but a server to host and pay for that ADR-0018 has
not costed. Not chosen; revisit if edge functions' cold starts or connection limits
bite.

**PostgREST on a second, `erp`-only role.** Keeps generated endpoints, but it would give
an API role USAGE on `erp`. Migration `20260920000200` revokes exactly that, and
`db:check`'s `api-roles-cannot-reach-erp` fails on it (ADR-0018 §3 explains why that
revoke is what binds `service_role`). Rejected.
