# ADR-0012 — Cross-brand data sharing

- **Status:** Proposed
- **Date:** 2026-09-17
- **PRD decisions:** OPN-009 · PRG-002 · PRG-004 · NFR-007
- **Deciders:** Product Owner, before a second brand exists

## Context

PRG-004 requires cross-brand sharing to be configurable **separately for each data
domain** — customers, loyalty, employees, suppliers, products, financial
dimensions. OPN-009 defers the actual rules until a second brand's operating model
is known. NFR-007 requires one codebase to serve future brands without a separate
codebase per brand.

Spicy Meal is the only brand today.

## Decision

**Build the mechanism now; leave the policy open.**

- Every record that could ever be brand-scoped carries the organisation dimensions
  PRG-002 lists — company, legal entity, brand, operating unit, branch or facility,
  department, cost centre, sales channel, device — from the first migration.
  Retrofitting a dimension onto existing rows is painful; carrying an unused one is
  nearly free.
- Sharing is expressed as **per-domain policy**, not a global switch. The data model
  admits three postures per domain: brand-private, shared-read, shared-write.
- Default for every domain until a decision is recorded: **brand-private**. The
  safe default is isolation; sharing is opened deliberately.

### What must be decided before a second brand launches

Per domain, which posture applies — with the awkward ones named rather than left
implicit:

| Domain | The question that actually needs answering |
|---|---|
| Customers | Is one person one customer across brands, or one per brand? This determines whether their order history and personal data cross a brand boundary, which is a privacy question as much as a product one. |
| Loyalty | Are points earned in one brand spendable in another? Affects the ledger and the liability. |
| Employees | Can staff work across brands in one employment record? Affects payroll and scheduling. |
| Suppliers | Shared master with per-brand terms, or separate? |
| Products and recipes | Shared catalogue with per-brand publication, or separate? |
| Financial dimensions | Shared chart of accounts with brand as a dimension — almost certainly yes, but state it. |

## Consequences

- Carrying unused dimensions costs a little storage and some schema noise now, and
  saves a migration across every table later.
- Defaulting to brand-private means a second brand launch requires deliberate
  decisions rather than inheriting Spicy Meal's data by accident.
- The customer-identity question has privacy consequences under Saudi personal-data
  requirements and should involve whoever advises on PDPL, not only product.
