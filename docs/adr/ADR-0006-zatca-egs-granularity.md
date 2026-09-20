# ADR-0006 — ZATCA EGS unit granularity and offline invoicing

- **Status:** Proposed — **needs a product decision, not only an engineering one**
- **Date:** 2026-09-17
- **Requirements:** PAY-016 · PAY-017 · PAY-018 · PAY-019 · OFF-011 · ACC-005
- **Deciders:** Product Owner and Finance, with specialist ZATCA review

## Context

ZATCA Phase 2 requires each e-invoicing generation solution (EGS) unit to hold its
own cryptographic identity, an invoice counter incrementing by exactly one, and a
previous-invoice-hash chain. PAY-017 requires documents issued during an outage to
queue securely and synchronise on reconnection. PAY-018 requires counters, hashes
and certificates to be protected from unauthorised alteration.

## Decision

### Each POS device is its own EGS unit

Its own CSID, certificate, counter and hash chain. Counter advance and event
append happen in one local transaction.

Sharing one counter across three devices would require coordination on every
invoice — exactly what offline operation forbids. And the granularity choice
interacts with ADR-0004: **device-as-EGS works whether or not a controller
arrives; controller-as-EGS cannot degrade to iPad-only.** Choosing device-as-EGS
now costs nothing and preserves both hardware options.

### Offline branches issue simplified invoices only

**This is the part that needs a business decision.** Standard (B2B) invoices
require ZATCA clearance *before* issuance, so they cannot be issued offline.
Simplified (B2C) invoices are reported within 24 hours and are fine offline —
which is what makes the whole offline architecture lawful.

A B2B request during an outage must therefore either queue until connectivity
returns, or be refused with a clear message. The PRD reads as though all document
types behave alike (PAY-016, PAY-017), so somebody must decide what the cashier
sees and says when a business customer asks for a tax invoice during an outage.

## Consequences

- Each device needs onboarding, a certificate and secure key storage. Device
  provisioning becomes a compliance-relevant process, not just IT setup.
- **Counter reuse after restoring a device from backup is a compliance breach, not
  a bug.** It is tested explicitly in the ZATCA spike.
- PAY-019 still stands: all of this is revalidated against the current official
  specification before certification. This ADR records a design intent, not a
  compliance opinion.

## Blocked

The ZATCA offline-issuance spike needs sandbox onboarding credentials. Tracked in
`docs/program/blocked.md`.
