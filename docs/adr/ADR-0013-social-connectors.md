# ADR-0013 — Social platform connectors

- **Status:** Proposed — F5, low urgency
- **Date:** 2026-09-17
- **PRD decisions:** OPN-011 · MKT-001 · MKT-003 · MKT-008 · MKT-009
- **Deciders:** Marketing, with IT

## Context

MKT-001 asks for connectors to WhatsApp, Instagram, Snapchat, TikTok and Google
Business Profile **where platform APIs permit**. MKT-009 requires connectors to be
replaceable because platform APIs and permissions change. OPN-011 defers the
availability and permissions review to before F5.

The estate already contains a live AI WhatsApp inbox running as a separate system,
with its own knowledge base, FAQ and guardrails.

## Decision

- **Each connector is an isolated, replaceable adapter** behind a common interface.
  No platform's data model leaks into ERP core. MKT-009 is a structural requirement,
  not an aspiration, because these APIs genuinely do break.
- **Capability is per-platform and discovered, not assumed.** The review before F5
  must establish, for each platform, what is actually permitted for a business
  account: publishing, reading comments, reading direct messages, reading reviews.
  These differ sharply and change without notice. Planning that assumes symmetry
  across five platforms will be wrong.
- **The existing WhatsApp inbox is adjacent, not absorbed.** It is a customer
  communications product with its own operational history. The integration seam is
  that it should read menu and branch data from the ERP rather than keeping its own
  copies, which it does today. Folding it into ERP core is not proposed.
- **Approval before publishing is non-negotiable** (MKT-003, MKT-008, AI-010). AI may
  draft; management approves; only then does anything leave the building.

## Consequences

- Connector work is sized per platform after the review, not estimated as one item.
- A platform that withdraws API access degrades one adapter, not the module.
- Deduplicating menu and branch data between the inbox and the ERP is a small,
  worthwhile piece of work that can happen well before F5.
