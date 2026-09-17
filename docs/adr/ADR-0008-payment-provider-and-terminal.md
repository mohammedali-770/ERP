# ADR-0008 — Payment provider and mada terminal integration

- **Status:** Proposed — **BLOCKED on owner decision; a freeze is in force**
- **Date:** 2026-09-17
- **PRD decisions:** OPN-004 · PAY-001 · PAY-003 · PAY-004 · PAY-007 · PAY-010..014
- **Deciders:** Owner / executive management

## Context

PAY-003 wants the exact amount sent to the terminal and the result returned
automatically where the bank or provider supports integration. PAY-004 requires a
controlled manual fallback where it does not. OPN-004 leaves the method and
provider open pending a bank and provider capability review.

**The existing estate is under an explicit payment freeze.** Tap, Geidea and
Moyasar all appear in the current system: Moyasar is built but inert with its
migration unapplied and no credential configured; the automatic refund worker is
deliberately disabled. No provider has been selected.

## Decision

**No provider is selected here.** This ADR records what the architecture needs
from whichever provider is chosen, so the capability review asks the right
questions.

### The question that matters most

> **Does the terminal protocol support query-by-reference, and is the reference
> field wide enough to carry our intent identifier?**

The entire unknown-outcome protocol (PAY-007) depends on being able to *ask* the
terminal what happened rather than retrying and hoping. From `UNKNOWN`, the only
permitted action is a query; a retry is permitted only after reconciliation
returns "not charged".

If query-by-reference is unavailable, the fallback is human attestation — the
cashier confirming against the printed slip. That works, but it carries a **large
recurring operational cost** that must be priced during selection, not discovered
in month 7.

### Other requirements of any candidate

| Need | Why |
|---|---|
| Reference field wide enough for an intent identifier, or a stable derived short reference | ADR-0005; the reference is the idempotency anchor |
| Idempotent refunds keyed by our identifier | PAY-011 |
| Settlement data including commissions, fees, refunds, chargebacks, withholding, timing | PAY-013, PAY-014 |
| Sandbox permitting induced timeouts and mid-transaction failures | The ECR spike cannot be run against production |

## Consequences

- **F1's payment scope is not build-ready work.** Sixteen F1 requirements
  (PAY-001..PAY-019 within F1) sit behind this decision, and three acceptance
  criteria depend on it: ACC-003 (payment and cash accuracy), T-04 (payment
  uncertainty), T-05 (automatic refund).
- If the freeze does not lift within the nine-month window, those criteria cannot
  be evidenced and the F1 milestone is partial. **This should be put to executive
  management now, not in month 7.**
- Meanwhile the architecture treats the provider as a replaceable adapter, and the
  payment state machine is built and tested against a simulator.

Tracked in `docs/program/blocked.md`.
