# ADR-0019 — Prove one order end to end before building breadth

- **Status:** Proposed — a sequencing change to the F1 roadmap, not a design change
- **Date:** 2026-09-22
- **Requirements:** OFF-001 · OFF-005 · OFF-012 · OFF-013 · OFF-014 · PRN-013 · PRN-014 · NFR-001 · LAB-001 · LAB-003 · ACC-001
- **Deciders:** Product Owner, with executive management where it moves the hardware budget
- **Related:** ADR-0003 · ADR-0004 · B-03 · D-3 · [`../program/roadmap.md`](../program/roadmap.md) · [`../program/f1-backlog.md`](../program/f1-backlog.md)

## Context

The roadmap sequences F1 by workstream: foundation (months 1–3), menu (2–4),
orders (3–6), branch runtime and offline (3–7), POS (4–8), printing (4–7). The
milestone table puts **"integrated branch — full order lifecycle, printing,
simulated payments" at end of month 7**, of nine.

That sequencing is sound and was already resequenced once for the estate, which
the PRD's own roadmap does not account for. This ADR does not dispute any of it.
It disputes one thing: **when the riskiest assumption is first tested as a whole.**

### The assumption everything rests on

`OFF-012` states the preferred deployment avoids dedicated branch hardware
*"provided the approved reliability tests pass"*. `OFF-013` names the fallback if
it does not: Windows POS, or a small branch controller per site. That is a
per-branch capital and rollout decision across the estate, and it is D-3.

So the architecture rests on a compound claim: **an iPad-only branch can take an
order with no central connectivity, print it reliably to a kitchen printer, and
reconcile afterwards without loss or duplication.** `OFF-001`, `OFF-005`,
`PRN-013` and `ACC-001` each assert a part of it.

Under the current sequence, the first time that claim is tested as one thread is
month 7. If it fails there, months 4 through 7 of POS, printing and offline work
were built around a deployment model that does not hold.

### What the spikes do and do not settle

Six spikes pass today, and they are not nothing:

- `offline-sync` — zero lost, zero duplicated at 245/h per branch
- `print-queue` — no lost kitchen slips, no silent duplicate invoice
- `shift-conflict`, `payment-reconciliation`, `callback-engine`,
  `rating-statistics` — all passing, each with a control case

**Every one of them runs in simulation.** `lan-peer-sync` and `ios-durability`,
the two that touch real hardware, are procedures with no harness and are blocked
by B-03. And no spike — simulated or otherwise — exercises the *integrated*
thread: a real device, holding a real order, driving a real printer, over a real
branch network, then reconciling.

`OFF-014` is explicit that this is not optional and not satisfiable by spikes:

> No hardware model shall be approved before concurrent printing, offline,
> recovery and load tests are **passed in the HQ lab**.

`PRN-014` says the same of printing: the lab compares iPad-native, Windows and an
optional controller **before** production hardware is chosen.

## Decision

**Add one milestone to the F1 roadmap: a vertical integration slice, targeted at
the end of month 3, immediately after the foundation workstream.**

The slice is the thinnest path that exercises the full critical thread:

| Included | Excluded |
|---|---|
| One device, one hardcoded item, one kitchen printer | Menu authoring, versioning, publication |
| Order creation with an immutable identifier | Payments of any kind, simulated included |
| Local store, outbox, sync on reconnect | Shifts, cash, blind close |
| Print on issue, and after a printer outage | Reporting, monitoring, customer app |
| Reconciliation after connectivity returns | Multi-channel anything |

**Pass condition, and it is the same bar `offline-sync` already meets in
simulation:** twenty orders taken with the network disconnected, twenty slips
printed, connectivity restored, **zero lost and zero duplicated**. Run on real
hardware rather than against a simulator.

That exercises roughly ten of the 164 F1 requirements. They are the ten that
determine whether the other 154 are built on a deployment model that holds.

### This does not dodge B-03 or the lab

It cannot, and pretending otherwise would be the failure this repository keeps
finding in its own documents. `OFF-014` requires the HQ lab; the lab is not built,
and that is an open F0 exit item. The slice needs either the lab or branch access,
which is B-03.

**What it changes is how much of the lab has to exist first.** `LAB-003` specifies
controlled disconnection, latency, device restart, printer outage and
service-failure injection; the UAT readiness pack adds three tills, receipt and
kitchen printers, a barcode reader, a payment terminal and a switchable branch
controller. The slice needs **one device, one kitchen printer, and the ability to
pull the network** — a subset that can stand months before the full configuration.

So the slice defines the lab's minimum viable configuration, and gives the lab
build an earlier and smaller first target than "everything the UAT packs need".

### What it feeds

ADR-0004 is Proposed and says it is *"resolved by lab evidence, not by
preference"*, with executive management deciding on that evidence. The slice is
the earliest evidence that decision can be given. It does not decide D-3 by
itself — `PRN-014` requires the three-way printing comparison — but it establishes
whether the iPad-only path is viable at all, which is the branch of the decision
tree that carries the budget.

## Alternatives considered

**Keep the layered sequence unchanged.** Defensible: the workstreams have real
dependencies, E1 genuinely gates everything, and building a throwaway slice costs
weeks that the nine-month schedule does not obviously have. The counter is that
the slice is not throwaway — it is the first vertical cut of E5, E6 and E7, and
the code survives into them. What is spent is sequencing, not effort.

**Wait for the two blocked spikes.** `lan-peer-sync` and `ios-durability` will
answer the network and device questions when B-03 lifts, and enablement document
01 can clear the network half in thirty minutes with two laptops. But neither
proves the integrated thread, and `OFF-014` does not accept them as the evidence
it requires.

**Move the integrated-branch milestone earlier without narrowing it.** Rejected:
the month-7 milestone includes the full order lifecycle and simulated payments.
Pulling that forward moves the date without reducing what must be true by it.

## Consequences

- **The riskiest assumption is tested at month 3 rather than month 7**, leaving
  six months to respond rather than two.
- **The lab gets an earlier, smaller first target.** One device, one printer,
  network control — rather than the full UAT configuration.
- **D-3's evidence starts accumulating earlier**, though the slice does not close
  it: `PRN-014`'s three-way comparison still stands.
- **The slice competes with E3 menu and E4 orders for months 2–3.** That is the
  real cost, and it is a Product Owner trade rather than an engineering one.
- **If the slice fails**, the fallback in `OFF-013` is invoked eighteen weeks
  earlier than the current sequence would invoke it, while POS and printing are
  still small enough to reshape.
- **If it passes**, nothing else changes. The workstreams continue as planned
  with one assumption retired, and the slice's code is the first commit of E5,
  E6 and E7 rather than a detour.

## Status note

**Proposed, and it should stay Proposed until the Product Owner decides.** This
ADR was drafted by an agent session from the roadmap, the F1 backlog and the
requirement catalogue. It reorders work that people have to do and trades against
a schedule an agent is not accountable for, which makes it a recommendation on
the record rather than a decision.
