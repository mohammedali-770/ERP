# Hardware decision matrix

Decides ADR-0004 (OPN-003). **The decision is made by measurement, not preference.**

OFF-014: no hardware model is approved before concurrent printing, offline,
recovery and load tests pass in the HQ lab.

---

## The options

| | A — iPad only | B — Windows POS | C — iPad + controller |
|---|---|---|---|
| Per-cashier device | iPad | Windows terminal | iPad |
| Branch server | None | None | Small controller |
| PRD posture | **Preferred** (OFF-012) | Approved fallback (OFF-013) | Approved fallback (OFF-013) |

---

## What actually decides it

Two measurements, both obtainable in **weeks 1–2**, and either can eliminate
option A on its own:

### D-1 · Does branch Wi-Fi permit client-to-client traffic and mDNS?

Many managed and guest networks enable access-point client isolation by default.
If it cannot be disabled across the production estate, peer replication between
iPads is impossible.

**Fail → option A is eliminated.** This is a network configuration check, not an
engineering effort. It is the cheapest decisive test in the programme.

### D-2 · Does iOS keep the application alive well enough?

Twelve hours continuous under Guided Access, serving peer sync and driving
printers, surviving a low-memory relaunch with zero committed events lost.

**Fail → a controller becomes mandatory for printing and unattended operation.**

---

## Full scoring matrix

Measured in the lab, recorded with evidence. No score is assigned from reasoning.

| # | Criterion | Requirement | Measurement | A | B | C |
|---|---|---|---|---|---|---|
| 1 | Peer discovery and convergence | OFF-005..008 | mDNS under 5s; convergence p95 under 2s at 200 orders/h | | | |
| 2 | Client isolation tolerance | OFF-001 | Works on the real branch network | | | |
| 3 | Background durability | OFF-004 | 12h continuous; survives relaunch, zero committed events lost | | | |
| 4 | Concurrent print reliability | PRN-002, NFR-005 | Zero lost jobs, 4 channels, sustained | | | |
| 5 | Print failover | PRN-012 | Job completes when the homed device sleeps | | | |
| 6 | Printing with all devices asleep | PRN-013 | Does it print at all? | | | |
| 7 | Peripheral driver maturity | PRN-014 | Barcode, label, cash drawer, terminal | | | |
| 8 | Recovery from device loss | NFR-016 | Time to a working till after total device failure | | | |
| 9 | Offline duration supported | OFF-001 | Storage and catch-up time after 48h offline | | | |
| 10 | ZATCA per-device EGS viability | ADR-0006 | Certificate and counter held securely per device | | | |
| 11 | Total cost of ownership | PRG-010 | Devices, controller, printers, network, spares, support, 3yr | | | |
| 12 | Support effort | PRD §9.3 | Estimated incidents per branch per month | | | |
| 13 | Failure blast radius | — | Device-scoped vs branch-scoped | | | |

### Scoring

1–10 are **pass/fail against a stated threshold**, not opinion scores. A single
fail on 1, 2, 3 or 4 eliminates the option.

11–13 are comparative and only break ties among options that passed.

---

## The honest framing for the decision gate

**Synchronisation does not need a controller.** The sync protocol is identical in
all three options (ADR-0004, I-9).

**Printing, peripherals and unattended operation are what need one.**

Anyone arguing for a controller on synchronisation-correctness grounds has misread
the design, and anyone arguing against one on cost grounds should look at criteria
4–7 first.

---

## Recommendation format

The output is not a preference. It is:

> Option _ passed criteria 1–10 with the evidence in `<link>`. Options _ failed at
> criterion _ because _. Three-year total cost of ownership is _ versus _.
> Recommended standard: _.

Signed by IT and Operations, approved by executive management (PRG-012, REL-003).

**Blocked on B-03** — access to a real branch network.
