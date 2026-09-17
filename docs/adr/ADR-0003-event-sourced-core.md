# ADR-0003 — Append-only event log as the system of record

- **Status:** Proposed — **decide in month 1 and hold**
- **Date:** 2026-09-17
- **Requirements:** OFF-009 · FIN-007 · POS-028 · PAY-015 · CRM-005 · SEC-006 · OFF-005 · OFF-006
- **Deciders:** Product Owner, with Finance consulted

## Context

The PRD repeatedly forbids destructive mutation of business facts:

- OFF-009 — financial and order events use append-only corrections, never
  destructive overwrites, during conflict resolution.
- FIN-007 — posted entries are immutable; corrections are reversals or adjustments.
- POS-028 — posted financial transactions are never physically deleted.
- PAY-015, CRM-005 — wallet and loyalty balances use ledgers, never an overwritten balance.
- OFF-005 — locally created events enter a durable outbox and synchronise later.

These are not five separate features. They are one architectural property stated
five times.

## Decision

**The system of record is an append-only event log. All queryable state is a
projection derived from it.**

- Business state changes only by appending an event.
- Append-only is enforced at two levels: the application role holds no `UPDATE` or
  `DELETE` grant on the log, and a `BEFORE UPDATE OR DELETE` trigger raises.
  Both, because "a migration accidentally rewrote history" is not recoverable.
- Projections (`orders`, `payments`, `shifts`, `gl_entries`, …) are rebuildable
  from the log, and applied idempotently via a `(projection, event_id)` key so
  replay is always safe.
- Events are additive-only in schema: fields are never removed or repurposed, and
  every event carries a `schema_version`.

## Consequences

- Every requirement in the Context section is satisfied structurally rather than
  by remembering to follow a rule.
- Offline synchronisation becomes shipping events rather than merging rows, which
  is what makes deterministic conflict resolution (ADR-0005) possible at all.
- The audit trail SEC-006 requires is a by-product, not a parallel mechanism that
  can drift from reality.
- **Cost:** every read goes through a projection. Developers must think in events,
  which is a genuine learning curve, and query-time convenience drops.
- **Cost:** storage grows monotonically. Retention and partitioning are design
  work, not an afterthought.

## Why this must be decided now

Reversing it means rewriting every write path in the system. More dangerously, a
*partially* event-sourced system — some aggregates event-sourced, some CRUD — is
worse than either choice consistently applied: it has the query awkwardness of one
and the integrity guarantees of neither, and the boundary between them becomes a
permanent source of bugs.

So this is a month-1 commitment or it is not taken at all. If the team judges the
learning curve too steep, the honest alternative is CRUD with explicit audit
tables and a written acceptance that OFF-009 and FIN-007 are enforced by
convention. That is a worse system, but a coherent one.

**Recommendation: accept.** The PRD's single Critical risk is duplicate or
conflicting financial records under offline sync, and this is the architecture
that addresses it directly.
