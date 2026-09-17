# ADR-0010 — Lazywait coexistence before 2028

- **Status:** Proposed
- **Date:** 2026-09-17
- **PRD decisions:** OPN-006 · OMS-002 · OMS-004 · REL-002 · REL-005 · REL-006
- **Deciders:** Product Owner and Operations

## Context

Existing branches stay on Lazywait through 31 December 2027 (REL-002). Eligible
new branches may use the ERP earlier once approved (REL-005). Migration of
existing branches is targeted from 1 January 2028 (REL-006). OPN-006 leaves open
whether Lazywait data should feed the ERP before then, for management reporting.

The current system already integrates with Lazywait, and the surface is **narrow
and well isolated**: three outbound endpoints (order create, CRM customer search,
online-payment update), one HMAC-signed inbound webhook that updates only
Lazywait's own status field, five mapping columns, and a single settings row.
Crucially, the existing design already treats its own database as the source of
truth and never lets Lazywait auto-flip local order state.

## Decision

**Three distinct concerns, decided separately.**

1. **Replacement (OMS-002)** — the ERP takes over the outbound surface. Because it
   is three endpoints and a webhook rather than a deep coupling, this is a
   contained piece of work, and the existing retry and ambiguity semantics are
   proven behaviour to port rather than re-derive (see ADR-0015).
2. **Coexistence reporting (OPN-006)** — whether to pull Lazywait data into the ERP
   for consolidated reporting during 2026–2027. **Recommendation: do not**, unless
   executive reporting genuinely requires a single view before cutover. It adds a
   second write path into ERP projections purely for reporting, during the period
   when the ERP's own integrity is still being proven. A periodic export into the
   analytical store, clearly labelled as external, carries far less risk.
3. **Cutover sequencing (OPN-008)** — deferred to ADR-0011 and the 2028 cutover plan.

## Consequences

- If coexistence reporting is declined, management keeps two reporting surfaces
  until cutover. That is an accepted operational cost and should be stated to
  executives rather than discovered.
- The replacement work is smaller than the PRD implies, which should be reflected
  when F1 effort is re-estimated against the estate.

## Dependency

Lazywait's API availability for any inbound feed is an external dependency the
PRD already records. Nothing here assumes access that has not been confirmed.
