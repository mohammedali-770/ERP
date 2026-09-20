# F1 backlog

The 164 F1 requirements decomposed into sequenced epics.

Every F1 requirement appears here exactly once. `npm run req:lint` fails if one is
missing, so this document cannot quietly drift from the catalogue.

---

## How each epic is sized

Not in days. The PRD assumes a greenfield build; reconnaissance found a live
production system implementing a meaningful share of F1 already. So the useful
signal is **how much already exists**:

| | Meaning |
|---|---|
| **Absorb** | Working behaviour exists in the live system. Port the mechanism, do not re-derive it |
| **Adapt** | Something equivalent exists but in a single-brand shape. Reshape rather than rebuild |
| **Build** | No estate asset. Genuine new work |
| **Prove** | Design exists and is proven by a spike; the work is integration |

`Build` epics carry the risk. `Absorb` epics carry the schedule relief the PRD's
own roadmap does not account for.

---

## The critical path

```
E1 Foundation ──┬── E3 Menu ──────────────┐
                │                          ├── E6 POS ── E9 Lab & UAT
                ├── E4 Orders ─────────────┤
                │                          │
                └── E5 Branch runtime ── E7 Printing
                                           │
                    E8 Payments (gated) ───┘
```

**E1 gates everything.** E5 and E7 carry the two highest technical risks. E8 is
gated on a decision, not on engineering.

---

## E1 · Platform foundation

**Build** · no dependencies · gates every other epic

Organisation hierarchy, identity, capabilities, device enrolment, audit, the event
log and projection framework.

`IAM-001` `IAM-002` `IAM-003` `IAM-004` `IAM-005` `IAM-006` `IAM-007` `IAM-008`
`IAM-010` `SEC-010` `SEC-011` `NFR-006`-adjacent work is F0

> The `SECURITY DEFINER` RPC and RLS-helper-predicate pattern from the live system
> is the model to follow — it is proven under production load and inheriting it
> costs nothing.

**Note:** role-*capability* composition must exist from the start. Screens compose
from capabilities, and retrofitting that once screens assume fixed layouts is
expensive (ADR-0014).

---

## E2 · Requirement and quality infrastructure

**Done in F0** · continuous

`NFR-009` `NFR-010` `NFR-011` `NFR-012`

Telemetry, correlation references in user-facing failures, reversible migrations,
and the automated test suites. The suites exist; they grow with each epic.

---

## E3 · Menu, pricing and availability

**Absorb** (availability) + **Adapt** (publication) · depends on E1

`MNU-001` `MNU-002` `MNU-003` `MNU-004` `MNU-005` `MNU-006` `MNU-007` `MNU-008`
`MNU-009` `MNU-010` `MNU-011` `MNU-012` `MNU-013` `MNU-015`

> **`MNU-003` and `MNU-004` are already solved.** Timed availability snooze with
> automatic restore and a full transition audit runs in production today,
> including the sweeper. Port it.

The `Adapt` part is publication scoping: the live model is single-brand, and
`MNU-005` needs company, brand, branch, channel, order type and effective dates.

---

## E4 · Order management

**Absorb** (idempotency, ambiguity) + **Build** (multi-channel lifecycle) · depends on E1

`OMS-001` `OMS-003` `OMS-005` `OMS-006` `OMS-007` `OMS-008` `OMS-009` `OMS-010`
`OMS-011` `OMS-012` `OMS-013` `OMS-014` `OMS-015` `OMS-016` `OMS-018`

> **`OMS-005`, `OMS-009` and `OMS-011` are already solved.** The fenced
> create-attempt gate — `ready_to_send` / `already_synced` /
> `ref_present_unverified` / `deadline_expired` — with ambiguous-outcome
> classification that refuses to re-send and routes to human confirmation, is
> running in production against a third party that offers no idempotency key.
> That is the hardest part of this epic and it exists.

---

## E5 · Branch runtime and offline operation

**Build** · depends on E1, E4 · **highest technical risk (R-02, Critical)**

`OFF-001` `OFF-002` `OFF-003` `OFF-004` `OFF-005` `OFF-006` `OFF-007` `OFF-008`
`OFF-009` `OFF-010` `OFF-011` `OFF-012` `OFF-013` `OFF-014`

Local store, transactional outbox, sync protocol, deterministic conflict
resolution, recovery.

**Design proven** by `spikes/offline-sync` under fault injection. The contracts
package already carries the identifier, clock, envelope and protocol primitives.

`OFF-012`, `OFF-013` and `OFF-014` are the hardware decision (ADR-0004), gated on
the [network capability check](./enablement/01-network-capability-check.md).

---

## E6 · Point of sale

**Build** · depends on E1, E3, E4, E5 · **no estate asset whatsoever**

`POS-001` `POS-002` `POS-003` `POS-004` `POS-005` `POS-006` `POS-007` `POS-008` `POS-009` `POS-010` `POS-011` `POS-012` `POS-013` `POS-014` `POS-015` `POS-016` `POS-017` `POS-018` `POS-019` `POS-020` `POS-021` `POS-022` `POS-023` `POS-024` `POS-025` `POS-026` `POS-027` `POS-028` `POS-029` `POS-030`

*(all thirty)*

Order entry across six service types, modifiers, discounts, voids, shifts, cash,
blind close, bilingual right-to-left interface, training mode, recoverable-failure
guidance.

> **This is the genuine greenfield piece.** Nothing in the estate is a
> point-of-sale application — no repository, no schema, nothing. It is also where
> `NFR-008` (responsive under load, robustness first) and `NFR-013`
> (accessibility, touch targets, clear error states) land.

`POS-022`, `POS-023`, `POS-024`, `POS-025`, `POS-026` are proven by
`spikes/shift-conflict`.

**`POS-029` (training mode) is the one P1 here** — the only F1 POS requirement
that can slip without failing the phase.

---

## E7 · Printing

**Build** · depends on E5 · **second highest risk (R-01, High)**

`PRN-001` `PRN-002` `PRN-003` `PRN-004` `PRN-005` `PRN-006` `PRN-007` `PRN-008`
`PRN-009` `PRN-010` `PRN-011` `PRN-012` `PRN-013` `PRN-014`

Durable queue, leases, templates, reprints, barcode readiness.

**Design proven** by `spikes/print-queue`. `PRN-014` is part of the hardware
decision. `PRN-011` is the sole P1.

> Hardware note: network printers, not Bluetooth (Q-04). Bluetooth pairs
> one-to-one and eliminates the lease failover that makes iPad-only viable.

---

## E8 · Payments, cash and tax invoicing

**Prove** → **integrate** · depends on E4, E6 · **GATED on D-1 and B-02**

`PAY-001` `PAY-002` `PAY-003` `PAY-004` `PAY-005` `PAY-006` `PAY-007` `PAY-008`
`PAY-009` `PAY-010` `PAY-011` `PAY-012` `PAY-016` `PAY-017` `PAY-018` `PAY-019`

> **Design is proven** by `spikes/payment-reconciliation`: the charge guard, the
> reconciliation ladder, refund idempotency and safe reference derivation. What
> remains is integration against a provider that has not been chosen.

Tax invoicing (`PAY-016`..`PAY-019`) additionally needs sandbox credentials
(B-02) and the business-invoice-during-outage decision (Q-02).

**Sequencing consequence:** everything here can be built and tested against a
simulator. None of it can be *evidenced* until D-1 lifts.

---

## E9 · Customer application migration

**Adapt** · depends on E3, E4, E8

`APP-001` `APP-002` `APP-003` `APP-004` `APP-005` `APP-006` `APP-007` `APP-008`
`APP-009` `APP-010` `APP-011` `APP-012` `APP-013` `APP-014` `APP-015`

> **`APP-002` is explicit: not a rewrite.** The app's screens, navigation,
> bilingual layout and store presence stay; the data layer is re-pointed module by
> module, behind a flag, reversibly. Plan in
> [`../estate/sma-absorption.md`](../estate/sma-absorption.md).

`APP-012` and `APP-013` inherit the payment protocol from E8.

---

## E10 · Reporting, monitoring and support

**Absorb** (alerting) + **Build** (reporting) · depends on E4

`RPT-001` `RPT-003` `RPT-006` `RPT-008` `RPT-009` `SUP-004` `SUP-005` `SUP-006`
`SUP-007` `SUP-008` `SUP-009`

> **`SUP-004` and `SUP-005` are substantially solved.** Operations alerting with
> severity, state, deduplication and a dispatch outbox, plus an eleven-rule
> order-integrity watchdog with non-PII alert payloads, runs in production.

`SUP-009` is runbooks — writing, not engineering, and it can start now.

---

## E11 · Lab, testing and acceptance

**Build** · continuous from month 1

`LAB-003` `LAB-004` `LAB-005` `NFR-001` `NFR-002` `NFR-003` `NFR-004` `NFR-005`
`NFR-014` `NFR-015` `NFR-016` `ACC-001` `ACC-002` `ACC-003` `ACC-004` `ACC-005`
`ACC-006` `ACC-007` `ACC-008` `REL-004`

Evidence accumulates continuously rather than being assembled in month 9. The
spike harnesses are retained as permanent regression tests, not one-off milestones.

`ACC-003` and `ACC-005` cannot be evidenced while E8 is gated.

---

## What the estate changes about the estimate

The PRD's roadmap assumes every F1 requirement is new work. These are not:

| Already working in production | Requirements |
|---|---|
| Timed availability snooze with auto-restore and audit | `MNU-003` `MNU-004` |
| Idempotent order creation with fenced attempts | `OMS-005` `OMS-009` |
| Ambiguous-outcome handling that refuses to re-send | `OMS-011` |
| Operations alerting with dedupe and dispatch | `SUP-005` `SUP-006` |
| Order-integrity monitoring, eleven rules | `SUP-004` |
| Loyalty as an auditable ledger | *(F5, but the pattern is reusable now)* |

And these carry **no** estate asset at all, which is where the effort actually is:

| Genuine greenfield | Requirements | Count |
|---|---|---|
| Point of sale | `POS-001`..`POS-030` | 30 |
| Offline runtime and sync | `OFF-001`..`OFF-014` | 14 |
| Printing | `PRN-001`..`PRN-014` | 14 |

**58 of 164 F1 requirements are in three greenfield epics**, and those three carry
both Critical and High risks. That is where the schedule should be protected.

---

## Blocked, and what it means for sequencing

| Epic | Blocked by | Can still proceed |
|---|---|---|
| E8 payments | **D-1** (provider), **B-02** (sandbox) | Build and test against a simulator — already proven |
| E5, E7 hardware choice | **B-03** (branch access: network, devices, printer) | Everything except the final hardware standard |
| E11 acceptance | E8 for `ACC-003`, `ACC-005` | All other scenarios |

Nothing is blocked from *starting*. Two things are blocked from *finishing*.

---

*Requirement coverage is enforced: `npm run req:lint` fails if any F1 requirement
is absent from this document.*
