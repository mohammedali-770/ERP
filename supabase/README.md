# Supabase project definition

The ERP's database, functions and tests live here, vendored in-repo — the same
pattern the live Spicy Meal system uses, so the schema is reviewable in a pull
request rather than existing only in a dashboard.

**F0 status: empty.** No migration has been written, because ADR-0003 (append-only
event log as the system of record) is still Proposed. Writing schema before that
decision lands would prejudge it, and it is the one decision that must be made in
month 1 and held — a partially event-sourced system is worse than either choice
applied consistently.

```
migrations/   plain SQL, one file per approved change, append-only history
functions/    edge functions
tests/        pgTAP / SQL suites
```

## Production rules

These are inherited from the live system and are not negotiable here
([`../docs/program/governance.md`](../docs/program/governance.md)):

- **`supabase db push` and migration repair are permanently forbidden against
  production.** Schema changes go only through the approved migration workflow.
- Applying a migration is an **explicit owner-approved action**, one file at a
  time, each followed by read-only verification.
- Migration history is a ledger: appended to, never rewritten.
- The append-only event log will carry **two** independent protections — revoked
  `UPDATE`/`DELETE` grants on the application role, and a `BEFORE UPDATE OR DELETE`
  trigger. Both, because "a migration accidentally rewrote history" is not a
  recoverable event.

## First migrations, once ADR-0003 is accepted

In dependency order:

1. `event_log` with its append-only enforcement and partitioning
2. The partial unique indexes that make conflicts *detectable*: one open shift per
   cashier, one live payment intent per order, one open assignment per drawer
3. `projection_applied`, so replay is always idempotent
4. Organisation hierarchy (PRG-002), carrying every dimension from the first
   migration — retrofitting one onto populated tables is painful, carrying an
   unused one is nearly free (ADR-0012)
