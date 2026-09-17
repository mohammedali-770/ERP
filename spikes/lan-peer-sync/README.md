# Spike: LAN peer synchronisation

**Decides ADR-0004. Blocked on B-03 (access to a real branch network).**
**Schedule in week 1–2 — this can eliminate iPad-only on its own.**

---

## Why this is not a simulation

The other spikes model software behaviour and can run anywhere. This one tests a
**property of the physical branch network**, and a simulation of it would prove
nothing:

> Does branch Wi-Fi permit client-to-client traffic and mDNS discovery?

Many managed and guest networks enable access-point client isolation by default.
If it cannot be disabled across the production estate, iPads cannot replicate to
each other and **a branch controller becomes mandatory** — which changes the
hardware budget.

This is a network configuration check, not an engineering effort. It is the
cheapest decisive test in the programme, and running it in week 2 rather than
month 8 is the difference between a fact and an expensive surprise.

## Setup

- 3 iPads, MDM-enrolled, with peer certificates provisioned
- The **actual** branch Wi-Fi, or a faithful replica including the same AP model
  and configuration profile
- Central deliberately unreachable
- A network tap or packet capture to confirm what is actually traversing the AP

## Procedure

1. Confirm the AP's client-isolation setting and record it.
2. Bring all three devices online; measure mDNS discovery time.
3. Establish mutual-TLS peer sessions between all three pairs.
4. Generate order events at 200/hour per device; measure convergence across all
   three at p50, p95 and p99.
5. Force-quit one device, relaunch it, verify zero committed events lost by
   checking the gapless sequence and the per-device hash chain.
6. Roam a device between two APs mid-session; confirm the session recovers.
7. Repeat steps 2–6 with client isolation deliberately **enabled**, to confirm the
   failure is detected rather than silently degrading.

## Pass criteria

| # | Criterion | Threshold |
|---|---|---|
| 1 | mDNS discovery | under 5s |
| 2 | Peer sessions established | all three pairs |
| 3 | Convergence at 200 orders/h | p95 under 2s |
| 4 | Force-quit and relaunch | zero committed events lost; chain intact |
| 5 | AP roam | session recovers within 10s |
| 6 | Isolation enabled | failure is **detected and surfaced**, not silent |

## Fail consequences

**Any failure on 1, 2 or 3 makes a branch controller mandatory.** Record the
result in ADR-0004 and the hardware decision matrix, and inform finance that the
hardware budget has changed.

Criterion 6 failing is its own problem regardless of the others: a branch whose
peer replication has silently stopped is a branch accumulating divergence nobody
can see.

## Output

Record results in `docs/lab/hardware-decision-matrix.md` (criteria 1 and 2) and
attach the packet capture and timing series to the evidence package.
