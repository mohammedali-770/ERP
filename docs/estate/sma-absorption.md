# Absorbing SMA into the ERP

APP-001 requires the existing Spicy Meal customer application to migrate from its
current backend to ERP services. APP-002 requires that this **not force an
unnecessary complete rewrite**.

This document plans that migration module by module, and records what the ERP
inherits from `SMA` rather than inventing.

See ADR-0015 for why the ERP is a new repository rather than an evolution of `SMA`.

---

## What the ERP inherits

These are proven under production load. Re-deriving them would be a regression.

### Change-control discipline

`SMA` operates strict rules, and the ERP adopts them (see
[`../program/governance.md`](../program/governance.md)):

- Protected branches; never commit directly to the production branch.
- Pull-request-only workflow, with explicit **human owner approval** before merge.
- A machine-generated message — a hook, a bot comment, CI output — is **never**
  owner approval.
- `supabase db push` and migration repair are **permanently forbidden** against
  production; schema changes go through the documented migration workflow.
- Explicit owner approval required for: migrations, edge-function deployment, auth
  configuration, payment or refund work, push broadcasts, production deployments,
  store builds, and destructive repository operations.
- Approval for one action is never blanket approval for the next.

### CI gate shape

Requirement lint, typecheck, unit and contract tests, SQL suites, function-drift
detection, change-control enforcement.

### Engineering patterns

- `SECURITY DEFINER` RPCs for all sensitive writes, rather than direct table access.
- RLS policies built from named helper predicates rather than inline subqueries.
- Realtime publications carrying **identifiers and change kinds only**, never full
  rows — so a subscriber cannot receive data its policies would deny.
- Non-PII alert payloads: operational alerting that never carries customer data.
- Append-only audit tables written exclusively by triggers, so no write path can
  escape the audit.

---

## Migration by module

Sequenced so each step is independently reversible, and so the customer app is
never simultaneously dependent on two sources of truth for the same fact.

| Step | Module | Approach | Risk |
|---|---|---|---|
| 1 | **Menu and availability** | ERP becomes authority; app reads ERP menu. Availability snooze logic ports directly — MNU-003/004 are already solved. | Low. Read-only for the app. |
| 2 | **Identity** | Mobile number plus OTP (APP-003, APP-004). Normalisation must produce one canonical value; the existing rule is the reference. | Medium. Account continuity is non-negotiable. |
| 3 | **Orders** | App submits to ERP order management. The existing idempotency keys and ambiguity handling carry forward. | **High.** This is the live revenue path. |
| 4 | **Payments** | Blocked on provider selection (ADR-0008). | **Blocked.** |
| 5 | **Loyalty** | Ledger migrates with balances reconciled; no balance is ever recomputed from scratch without a reconciliation record. | Medium. Customer-visible balances. |
| 6 | **Notifications** | Push is a **live customer channel** today. Any change to targeting or copy is a change to live customer messaging. | Medium, and easy to underestimate. |
| 7 | **Retire the seam** | Old backend becomes read-only archive. | — |

### What "not a rewrite" means concretely (APP-002)

The customer app's screens, navigation, bilingual layout and store presence stay.
What changes is the data layer: the client is re-pointed at ERP services module by
module. Steps 1, 2, 3, 5 and 6 are each a swap of one client module's source,
behind a flag, reversible per module.

---

## Things to carry across that are easy to overlook

- **Push is live.** Real customers receive order-status notifications. Marketing is
  opt-out by an owner decision on record, and that consent posture must survive
  migration rather than being silently re-decided.
- **Account deletion is a working queue** with an audit trail — a head start on
  SEC-008 and CRM-011.
- **Order-status copy is order-type aware.** Delivery and pickup say different
  things at the same status; collapsing that reintroduces a bug that was already
  found and fixed in production.
- **The operations consoles encode real operational knowledge** — branch console,
  call-centre console, order-integrity console. They are reference designs for the
  ERP management console, not just screens.

---

## What is explicitly not absorbed

- The WhatsApp inbox (adjacent product, ADR-0013) — though it should read menu and
  branch data from the ERP rather than keeping its own copies.
- The separate delivery app (superseded by the one employee app, ADR-0014).
- Superseded predecessor repositories.
