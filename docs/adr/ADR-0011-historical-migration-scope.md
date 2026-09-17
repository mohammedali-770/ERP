# ADR-0011 — Historical migration scope and branch cutover sequence

- **Status:** Proposed
- **Date:** 2026-09-17
- **PRD decisions:** OPN-007 · OPN-008 · PRG-013 · REL-006
- **Deciders:** Executive management, Finance

## Context

PRG-013 treats historical data migration as a separate assessed workstream with
**no approved scope at this stage**. OPN-007 leaves scope and retention open
pending a data audit; OPN-008 leaves the cutover sequence to Q4 2027. Risk R-08
records that historical data may be incomplete or inconsistent.

## Decision

**Keep migration scope closed until the data audit reports.** This ADR records the
principles that will govern it, so the audit asks the right questions.

### Principles

1. **Opening balances, not history, is the default.** The cheapest defensible
   migration carries forward balances and open items — stock on hand, open orders,
   receivables, payables, employee records, loyalty balances — and leaves
   transactional history in the source system as a read-only archive. Every
   expansion beyond that must be justified by a named business or statutory need.
2. **Source archives are preserved regardless.** Whatever is or is not migrated,
   the source exports are retained and checksummed. This is cheap now and
   impossible later.
3. **Reconciliation is the acceptance test.** Migrated balances reconcile to the
   source, signed off by Finance, before a branch is considered cut over.
4. **Migrated data is labelled.** Records originating from migration carry their
   provenance, so a later anomaly can be traced to import rather than operation.

### Cutover sequencing

Deferred to the 2028 cutover plan (Q4 2027) as the PRD requires. Two constraints
recorded now because they shape it:

- A branch cuts over only when its hardware, connectivity, payment, printing,
  training and support readiness are confirmed (rollout policy, PRD §9.2).
- Support capacity, not technical readiness, is likely to be the binding
  constraint on cutover pace. The plan should be built around it explicitly.

## Consequences

- No migration engineering is scheduled in F1, matching PRG-013.
- The data audit is itself a workstream needing an owner and a date. Recorded in
  `docs/program/open-questions.md`.
- **Known gap:** the existing warehouse/factory system reads its database
  connection from an untracked environment file, so its live database has not been
  identified. That must be resolved before F3 migration can be scoped at all.
