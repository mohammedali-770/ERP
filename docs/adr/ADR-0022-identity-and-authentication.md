# ADR-0022 — Identity is `erp`-native, and the runtime never reads a credential

- **Status:** Proposed. One part of it is not a choice, and §1 says which
- **Date:** 2026-10-02
- **Requirements:** IAM-001 · IAM-002 · IAM-003 · IAM-006 · IAM-008 · IAM-009 · IAM-010 ·
  SEC-003 · SEC-004 · SEC-008 · CAP-P04 · CAP-P08 · CAP-P11 · IAM-P01..P08
- **Related:** ADR-0003 · ADR-0018 · ADR-0021 · [Q-21](../program/open-questions.md) ·
  [B-11](../program/blocked.md) ·
  [`../program/consolidation-plan.md`](../program/consolidation-plan.md) Phase 3 ·
  `supabase/migrations/20261002000100_identity.sql`

## Context

All ten IAM requirements carried `adr_refs: []`. No decision covered authentication.
The only positive statement anywhere was the consolidation plan's "one identity
model, `erp`-native". Meanwhile three columns named an actor that existed nowhere —
`erp.shifts.cashier_id`, `erp.event_log.actor_id` and
`erp.capability_decision.actor_id` — and the capability registry's own header stated
a rule, `capability_open(scope) AND permission_granted(principal, …)`, whose right
half did not exist.

The warehouse system being rebuilt into the ERP (ADR-0021) has an identity design
worth reading closely, because parts of it are good and one part is not:

- **Good, and kept nearly constant for constant.** Branch workers sign in with an
  employee number and a six-digit PIN, bcrypt-hashed at cost 10 in a table no client
  role can reach. Five misses lock the account for fifteen minutes. **Unknown employee
  numbers are counted in their own table and answer exactly as a wrong PIN does** —
  same status, same countdown, same lock, and the same bcrypt work so the time taken
  does not differ either. `disabled` is answered only after a correct PIN.
- **Not carried.** Its "View as" preview changes only the screen; "the database still
  sees the admin, so previews show all data and actions run with admin rights"
  (`src/contexts/AuthContext.tsx:42-43`). CAP-P11 forbids exactly that.
- **Not carried.** One role per person, global, on `profiles.role`. IAM-006 requires
  access limited to assigned branches and departments.

## Decision

### 1. Identity lives in `erp`, not in Supabase Auth. This part is not a choice.

`supabase/` references the `auth` schema nowhere. `anon`, `authenticated` and
`service_role` hold no USAGE on `erp` (ADR-0018 §3). Adopting `auth.uid()` would break
four `db:check` assertions — `api-roles-cannot-reach-erp`,
`api-roles-hold-no-table-privilege`, `default-privileges-grant-nothing-to-api-roles`,
`no-erp-object-in-public` — and a migration containing it aborts the chain before
any assertion runs. Choosing Supabase Auth would mean reversing ADR-0018, not adding to
it. So `erp.person` is the identity, and a sign-in method is something that resolves
to one.

### 2. Every change to identity is a recorded decision.

`erp.identity_decision` is append-only, protected twice exactly as `erp.event_log` and
`erp.capability_decision` are. `erp.person`, `erp.person_role` and
`erp.person_credential` are projections stamped with the decision behind them (I-8),
by real foreign keys. Each change has one admitted route — `create_person`,
`change_person_status`, `grant_role`, `revoke_role`, `set_pin`, `unlock_credential`,
`bootstrap_administrator` — which records it and advances the projection in one
transaction. The runtime holds no write on any of those tables.

**Personal data stays out of the log.** It records decisions about a subject by
identifier. Names and employee numbers live on `erp.person`, which can be corrected or
erased (SEC-008); an append-only table cannot honour an erasure request.

**Central decisions go here; device events do not.** `PermissionChanged` is central
and belongs in `erp.identity_decision`. `EmployeeAuthenticated` happens at a device and
belongs in `erp.event_log`, which is the branch runtime's log by construction — the
same split ADR-0021's Phase 2 made for capability decisions.

### 3. The runtime never reads a credential.

`erp.verify_pin()` is `security definer` and answers with a status. `erp_app` holds
**no privilege of any kind** on `erp.person_credential` or `erp.credential_miss`, and
neither does `erp_read`, which `0002`'s default privileges would otherwise have given
SELECT on every new table. `db:check`'s `credential-tables-are-unreachable` holds that
for any credential table added later.

`verify_pin` takes **no clock argument**. It would make the lockout easier to test and
would equally let any caller holding EXECUTE step past it.

### 4. Permission is scoped, and the gate is one function.

Roles are assigned per person, many at a time, at a facility or organisation-wide
(IAM-006). `erp.role_permission` maps a role to an action on a capability (IAM-003).
`erp.assert_permitted()` applies both halves of the rule — capability open, permission
granted — and raises if either fails, so a caller cannot apply one and forget the
other. Reading is admitted for any state but `hidden` (CAP-P06); anything else needs
the capability open. `erp.decide_capability()` and every identity function call it on
the actor they are given.

### 5. The means of administration cannot remove itself.

`platform.capability_admin` and `platform.identity_admin` are protected capabilities,
created by the migration rather than a seed because a real database needs them. The
`administrator` role is protected: it is granted organisation-wide only, and its last
active holder cannot be suspended or stripped of it. The first administrator — or a
replacement when none is active — comes only through `bootstrap_administrator()`,
which is refused while an active administrator exists, is serialised, is recorded, and
is executable by the owner alone.

### 6. Disabled, never deleted.

`erp.shifts.cashier_id` and `erp.capability_decision.actor_id` are foreign keys to
`erp.person` with no cascading action, so a person anything names cannot be deleted.
B-11 records the system that did the opposite.

`erp.event_log.actor_id` deliberately is **not** a foreign key. Its `actor_type`
admits `'integration'`, whose identifier is not a person; `envelope.ts` declares it
nullable unconditionally, and store and wire format must not drift; I-5 forbids an
operational write that needs a central lookup. Its referent is `erp.person` when
`actor_type = 'cashier'`, and `db:check`'s `cashier-actors-resolve-to-a-person`
checks that in place of a constraint.

## What this does not decide

Named, so that silence is not read as a decision:

| | Why not yet |
|---|---|
| **What holds the `erp_app` credential** | [Q-21](../program/open-questions.md). PostgREST cannot be the ERP's API, because `authenticated` never reaches `erp`. Until something is named, there is no session |
| **Sessions and tokens** | No session exists. The functions check that the actor a caller *names* is permitted; they cannot yet check that the named actor is the one connected. That is the session layer's job, and it needs Q-21 first |
| **Administrator sign-in and MFA** (IAM-002) | Administrators have no credential type yet. A PIN on a shared till is the wrong factor for them |
| **Trusted devices and revocation** (IAM-010) | `erp.device` exists; binding a session to it waits on sessions existing |
| **Database enforcement of a read-only preview** (CAP-P11) | `erp.role_permissions()` lets a preview be computed from the role, and the console makes nothing writable in one. Making the *database* refuse a preview's writes needs a session that knows it is a preview |
| **Temporary access** (IAM-007) and **approval limits** (IAM-005) | Not attempted. `role_permission` has no amount or date dimension yet |

## Consequences

- The three dangling actor columns have a referent, two by constraint and one by tool.
- `permission_granted` exists, and the capability registry's rule is enforced in the
  database rather than stated in a header.
- **0011 also found that every `erp` function had been executable by PUBLIC since
  0002.** A per-schema default-privilege revoke cannot undo PostgreSQL's global
  default, so the reporting role could call `security definer` functions that write.
  It is revoked, and `no-erp-function-is-executable-by-public` keeps it so.
- Seeds that name people must run before the seeds that reference them, which is why
  the identity seed is `0015` and role permissions are `0035`.
- The warehouse system's PIN constants become the ERP's. Changing them is a proposed
  requirement change (IAM-P03, IAM-P04), not a code edit.

## Alternatives considered

**Supabase Auth with `auth.users` as the person.** Rejected by §1: it reverses
ADR-0018.

**Carry the warehouse model as it is** — one global role per person, preview on the
screen only. Rejected: it fails IAM-006 and CAP-P11 outright.

**A single `decide_identity(kind, …)` function** in place of seven. Rejected while
writing it: each kind carries different arguments and different guards, and one
function switching on a string would have been seven functions in one body with none
of their signatures checked.
