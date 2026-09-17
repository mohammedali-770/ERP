# ADR-0007 — Kitchen readiness and barcode workflow

- **Status:** Proposed
- **Date:** 2026-09-17
- **PRD decisions:** OPN-010 · PRN-007 · PRN-008 · PRN-009 · PRN-015
- **Deciders:** Operations management

## Context

PRN-009 fixes the first workflow: a barcode scan confirms readiness for the
**whole order**. Station-level and partial readiness are deferred (OPN-010), to be
settled by operational observation and a prototype during F1 design. PRN-015
records that a Kitchen Display System is not required for the initial workflow.

## Decision

Whole-order readiness, via a unique machine-readable barcode on the kitchen slip.

- The barcode encodes the `order_id`, not the display order number — display
  numbers are per-device sequences (ADR-0005) and are not globally unique.
- Scanning moves the order to `Ready`, subject to authorisation and duplicate-scan
  protection (PRN-008). A duplicate scan is **harmless and logged**, never an error
  the kitchen has to reason about.
- The readiness event carries the scanning device and user, so the data needed to
  design station-level readiness later is being collected from day one.

## Consequences

- Simple to train and simple to prove. Acceptance scenario T-07 covers print,
  reprint and repeated scan.
- Multi-station kitchens get no partial visibility in F1. Operations should confirm
  this is acceptable for the branches in scope before F1 UAT, not after.
- Because readiness events already record station-identifying data, moving to
  partial readiness later is an additive change rather than a redesign.

## Deliberately not decided

Whether readiness should eventually be per-station, and whether a KDS replaces
printed slips. Both need the operational observation OPN-010 calls for. Recorded
in `docs/program/open-questions.md`.
