# ADR-0005 — Device-minted identifiers as idempotency keys

- **Status:** Proposed
- **Date:** 2026-09-17
- **Requirements:** POS-011 · POS-012 · OMS-005 · OMS-009 · OMS-011 · PAY-005 · PAY-007 · OFF-006 · NFR-003 · NFR-004
- **Deciders:** Product Owner

## Context

The acceptance gate is absolute: no accepted order lost or duplicated, no
confirmed payment attached to the wrong order or charged twice — under sustained
load with retries, timeouts, reconnections and device restarts (NFR-003, NFR-004).

A branch must create orders with no central connectivity (OFF-001), so identifiers
cannot be server-assigned.

## Decision

**Identity is minted at the edge, and the identifier *is* the idempotency key.**

- Every business object gets a **UUIDv7**, minted by the creating device or ingest
  worker, persisted durably before any user-visible confirmation.
- Central ingestion is `INSERT ... ON CONFLICT (event_id) DO NOTHING`. A device
  that retries a push a thousand times produces exactly one order.
- There is **no separate idempotency-key table**, no TTL window, no fuzzy matching
  on amount and timestamp. Duplicate prevention is a primary-key constraint, and
  primary-key constraints do not have bugs.
- `order_id` is minted with the **first line item**, not at "Send", so identity
  exists from the first tap.
- External orders use `UNIQUE (channel_code, external_id_norm)` with the raw
  external reference preserved byte-for-byte (OMS-005). Ingestion is one atomic
  upsert returning whether the row was created; a replay returns the existing
  `order_id` rather than creating a second order.
- Payments are modelled as **intent → attempt → outcome**. The reference sent to
  the terminal derives from the *intent*, never the attempt, so a retry cannot
  present as a new transaction.

UUIDv7 specifically because it is time-ordered: it indexes without the random-UUID
page-split pathology at sustained load, while needing no coordination to be unique.

## Consequences

- POS-011 (duplicate submission from repeated taps, retries, delayed responses or
  reconnection) is prevented structurally.
- The sync channel needs no reconciliation protocol: gapless per-device sequences
  plus prefix acknowledgement mean a device that loses an ack simply resumes.
  Ambiguity is expensive only where the far side cannot be made idempotent — card
  terminals and third-party APIs — and the design pushes the cost there.
- **Residual exposure, stated plainly:** no ID scheme survives *regeneration* —
  device mints an ID, crashes before persisting, cashier re-enters the order. The
  design shrinks the window to the gap between first tap and fsync, where the loss
  is a draft. It does not eliminate it.

## Hard to reverse

- The ID format and the decision to mint at the edge are effectively permanent.
- **External-reference normalisation is the sharpest edge.** Changing the rule
  later retroactively splits or merges order identities. It is frozen with golden
  tests and a `norm_version` column so a change is a deliberate migration.
