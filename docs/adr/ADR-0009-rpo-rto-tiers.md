# ADR-0009 — Recovery point and recovery time targets

- **Status:** Proposed — awaiting costed tiers and executive selection
- **Date:** 2026-09-17
- **PRD decisions:** OPN-002 · PRG-012 · SEC-013
- **Deciders:** Executive management

## Context

PRG-012 requires RPO and RTO to be selected from costed tiers and approved by
executive management. SEC-013 requires backups to be encrypted, restore-tested and
isolated from ordinary application credentials.

## Decision

**No target is selected here.** This ADR frames the choice so the costed proposal
(ADR-0002's gate) can be evaluated.

### What the architecture already guarantees, independent of tier

Because branches operate fully offline (OFF-001) with a durable local event log
and outbox (ADR-0003), **a central outage does not stop a branch trading.** Local
events survive and synchronise afterwards. This decouples the RPO question from
"can we keep selling", and makes the cheaper tiers far more defensible than they
would be in a centrally-dependent design.

What central RPO actually governs is how much *already-synchronised* history could
be lost, and how long management reporting, cross-branch functions and integrations
stay unavailable.

### The tiers to cost

| Tier | Indicative RPO | Indicative RTO | Shape |
|---|---|---|---|
| A | ~24h | ~8h | Daily backup, manual restore |
| B | ~1h | ~1h | Point-in-time recovery, scripted restore |
| C | ~5 min | ~15 min | PITR plus warm standby |
| D | near-zero | minutes | Multi-region replication with failover |

Each tier must be costed including the operational effort of *proving* it —
scheduled restore exercises, not just a configuration setting.

### The rule that applies to every tier

A backup that has never been restored is not a backup. SEC-013's restore exercise
is a recurring scheduled obligation with a recorded outcome, at whatever tier is
chosen.

## Consequences

- Branch-level continuity is an architectural property; central RPO/RTO is a
  procurement decision. Keeping these separate prevents over-buying central
  resilience to solve a problem the offline design already solves.
- The chosen tier feeds `docs/lab/lab-design.md`, because the restore exercise is
  part of what the lab must be able to rehearse.
