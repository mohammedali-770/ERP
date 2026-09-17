# ADR-0004 — Branch runtime and deployment model

- **Status:** Proposed — resolved by lab evidence, not by preference
- **Date:** 2026-09-17
- **PRD decisions:** OPN-003 · OFF-012 · OFF-013 · OFF-014 · PRN-014
- **Deciders:** Executive management, on HQ lab evidence

## Context

The PRD's preferred outcome is no extra branch hardware (OFF-012). The approved
fallback is Windows POS at each cashier, or iPads supported by a small branch
controller (OFF-013). OFF-014 forbids approving any hardware model before
concurrent printing, offline, recovery and load tests pass in the HQ lab.

A branch runs up to three simultaneous POS devices (POS-009) and must operate
fully with no central connectivity (OFF-001).

## Decision

**Defer the hardware choice; make it irrelevant to correctness.**

The synchronisation protocol is identical for device↔peer, device↔controller and
device↔central (see `docs/architecture/core-transaction-design.md`). A controller
is a peer with better uptime and a bigger disk. There is **no protocol fork**.

This yields an invariant that must hold for the life of the system:

> **The controller is an optimisation, never a correctness requirement.**
> Everything works with it absent.

What a controller changes is exactly three guarantees, each an upgrade from
*detect* to *prevent*:

| Guarantee | iPad-only | With controller |
|---|---|---|
| One open shift per cashier | Detected at merge, raised as an incident | Prevented locally |
| One live payment intent per order | Detected at merge | Prevented locally |
| Drawer assignment | Detected at merge | Prevented locally |

Plus the practical wins: a single authoritative print queue, printing that
survives all three iPads sleeping, and USB/serial peripherals with mature drivers.

## The honest summary for the decision gate

**Synchronisation does not need a controller. Printing, peripherals and unattended
operation are what need one.** Anyone arguing the controller on sync-correctness
grounds has misread the design.

## Evidence that decides it

Two spikes, scheduled in weeks 1–2 because either can force the answer immediately:

- `spikes/lan-peer-sync` — three iPads on the **actual** branch Wi-Fi, central
  unreachable. Fails if AP client isolation cannot be disabled on the production
  network, if convergence exceeds 10s, or if any event is lost.
- `spikes/ios-durability` — 12 hours under Guided Access serving peer sync and
  printing; must survive a low-memory relaunch with zero committed events lost.

**Any failure in either makes a controller mandatory.** Running these in week 2
rather than month 8 is the entire point: it converts a late, expensive surprise
into an early, cheap fact.

## Consequences

- The build is not blocked on the hardware decision.
- The hardware budget is not knowable until the spikes report. Finance should be
  told this explicitly rather than given a number that might double.
- If a controller is adopted it becomes a branch single point of failure and needs
  its own recovery story — which iPad-only does not.
