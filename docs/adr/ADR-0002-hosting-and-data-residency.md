# ADR-0002 — Hosting model and Saudi data residency

- **Status:** Proposed — **blocking gate before any production deployment**
- **Date:** 2026-09-17
- **PRD decisions:** OPN-001 · PRG-010 · PRG-011 · SEC-009
- **Deciders:** Executive management, on a costed study

## Context

PRG-011 requires the central hosting model to stay undecided until the
architecture, Saudi data requirements, reliability and cost study are complete.
PRG-010 requires tiered cost options before any infrastructure commitment.
SEC-009 requires personal-data processing to be assessed against applicable Saudi
requirements before production.

The existing estate's live data runs on Supabase in `eu-central-1`; the
`ap-southeast-1` project is an inactive scratch project with no ERP relevance.
**Supabase offers no Saudi region.** Today's system holds customer names, mobile
numbers and delivery addresses outside the Kingdom. The ERP will additionally hold
employee, payroll and financial records.

## Decision

**For the HQ lab: Supabase, Supabase-native, accepting lock-in** (see ADR-0015 for
why, and what it costs).

**For production: no decision.** Production hosting is a gate, not a default. It
cannot be passed by inertia — by the lab working well and everyone assuming the
lab's platform carries forward. The gate requires:

1. A written determination, from someone qualified to give it, of whether Saudi
   law requires in-Kingdom residency for each data category the ERP will hold —
   customer personal data, employee and payroll data, financial records, ZATCA
   documents. These categories may not have the same answer.
2. Tiered costed options (PRG-010), each with its RPO/RTO (ADR-0009), covering at
   minimum: stay on Supabase; self-managed Postgres in an in-Kingdom cloud; a
   hybrid where regulated categories are held in-Kingdom.
3. An honest migration estimate from the lab platform to each option.
4. Executive sign-off recorded in this ADR.

## Consequences

- The lab can move fast now.
- **The exposure is real and is stated rather than buried:** if in-Kingdom
  residency turns out to be required, the Supabase-native choices in ADR-0015 —
  `pg_cron`, `pg_net`, Vault, RLS-as-primary-authorisation, ~190 `SECURITY DEFINER`
  RPCs — are the expensive parts to move. The migration cost is not a database
  export; it is re-platforming the scheduling, secrets and authorisation model.
- This ADR is therefore reviewed at every phase gate, not only at F2.

## Notes

`docs/compliance/data-residency-gate.md` holds the assessment criteria and the
evidence checklist. This ADR records the decision; that document records the work.
