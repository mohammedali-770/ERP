# ZATCA e-invoicing plan

Requirements: PAY-016..019 · OFF-011 · ACC-005 · T-09
Related: ADR-0006 · B-02 · Q-02

> **Scope note.** This is a product-design document, not a compliance opinion.
> PAY-019 requires validation against the current official specification before
> certification and production release, and PRD §7.3 is explicit that this
> document does not replace specialist tax advice. A specialist review is an
> F0 exit item.

---

## Design intent

### One EGS unit per POS device

Each device holds its own cryptographic identity, invoice counter and
previous-invoice-hash chain. Counter advance and event append happen in **one
local transaction**.

Sharing a counter across three devices would require coordination on every
invoice — precisely what offline operation forbids (OFF-001).

The granularity choice also interacts with the undecided hardware model:
**device-as-EGS works whether or not a branch controller arrives;
controller-as-EGS cannot degrade to iPad-only.** Choosing device-as-EGS now costs
nothing and preserves both options (ADR-0004).

### Offline branches issue simplified invoices only

This is the constraint that makes the whole offline architecture lawful, and the
PRD does not state it:

| Document | Clearance | Offline? |
|---|---|---|
| Simplified (B2C) | Reported within 24h | **Yes** |
| Standard (B2B) | Cleared **before** issuance | **No** |

A B2B request during an outage must queue until connectivity returns, or be
refused with a clear message. **Which one, and what the cashier says, is an open
business decision** (Q-02). PAY-016 and PAY-017 read as though all document types
behave alike; they do not.

### Protection of counters, hashes and certificates (PAY-018)

- Private keys and certificates in device secure storage, never in the application
  database.
- The counter advances only inside the invoice-issuing transaction.
- The hash chain is part of the append-only event log (ADR-0003), so alteration is
  detectable rather than merely prohibited.
- **Counter reuse after restoring a device from backup is a compliance breach, not
  a bug**, and is tested explicitly.

### Deferred synchronisation (PAY-017, OFF-011)

Documents issued offline queue in the durable outbox and synchronise
automatically on reconnection, with **visible completion status** — an operator
must be able to see that the queue drained, not assume it.

---

## Validation plan

| Step | What | Blocked by |
|---|---|---|
| 1 | Specialist review of the current official specification | — |
| 2 | Sandbox onboarding and device registration | B-02 |
| 3 | Online issuance against sandbox | B-02 |
| 4 | Offline issuance, three devices, then reconnect (T-09) | B-02 |
| 5 | Counter-chain integrity across restart and restore | B-02 |
| 6 | B2B refusal behaviour during outage | Q-02 |
| 7 | Certification | 1–6 |

### Acceptance (T-09, ACC-005)

Issue eligible invoices while central connectivity is unavailable, then reconnect.

**Expected:** documents remain valid locally; deferred records synchronise
successfully under current rules; counter chains unbroken and gapless per unit;
previous-invoice-hash verified end to end; a device restored from backup does not
reuse a counter value.

---

## Open items

- Sandbox credentials (B-02)
- The B2B-during-outage decision (Q-02)
- Specialist review commissioned
- Confirmation that per-device receipt numbering is acceptable to finance (Q-01) —
  distinct from the ZATCA counter, which is gapless per EGS regardless
