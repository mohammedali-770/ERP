# Architecture overview

This is the layered view the PRD describes in section 4, with bounded contexts
named and owned. It is the map; [`invariants.md`](./invariants.md) holds the rules
and [`core-transaction-design.md`](./core-transaction-design.md) holds the design
that carries the most risk.

PRG-011 keeps the central hosting model undecided until the architecture and cost
study completes. This document therefore describes **boundaries and
responsibilities**, not infrastructure. See ADR-0002.

---

## Layers

| Layer | Responsibility | Phase |
|---|---|---|
| **Experience channels** | POS, customer app, management console, employee app, call-centre workspace, future voice interface | F1→F5 |
| **Branch runtime** | Offline store, durable order and print queues, device coordination, local monitoring and recovery | F1 |
| **Core business services** | Organisation, identity, menu, pricing, orders, payments, invoicing, inventory, factory, finance, HR, CRM, delivery, assets | F1→F5 |
| **Integration** | ZATCA, banks and payment providers, delivery platforms, PBX, messaging, maps, official HR services, social platforms | F1→F5 |
| **Data and intelligence** | Event log, projections, analytical store, reporting, monitoring, AI assistant and internal auditor | F1→F5 |
| **Platform controls** | Security, audit, consent, configuration, workflow, notifications, deployment, backup and recovery | F0→F1 |

---

## Bounded contexts

Each maps to a workspace under `services/`. Contexts own their data; they do not
read each other's tables.

| Context | Owns | Phase | Key requirements |
|---|---|---|---|
| **identity** | Employees, roles, capabilities, sessions, device enrolment, audit of privileged action | F1 | IAM-001..010 |
| **menu** | Products, variants, modifiers, recipes, price lists, menu versions, publication, availability | F1 | MNU-001..016 |
| **orders** | Order lifecycle across every channel, external references, exceptions, snapshots | F1 | OMS-001..018, POS-001..030 |
| **payments** | Intents, attempts, outcomes, refunds, cash and shift reconciliation, ZATCA documents | F1 | PAY-001..019 |
| **printing** | Print jobs, queues, leases, templates, reprints | F1 | PRN-001..015 |
| **sync-gateway** | Handshake, event ingestion, projection dispatch, conflict incidents | F1 | OFF-001..014 |
| *inventory* | Stock ledger, batches, expiry, counts, replenishment | F3 | INV-001..019 |
| *factory* | Production planning, orders, batches, yield, traceability | F3 | MFG-001..012 |
| *procurement* | Requests, approvals, sourcing, receiving, matching | F3 | PRC-001..009 |
| *finance* | Chart of accounts, postings, dimensions, closing, statements | F4 | FIN-001..020 |
| *people* | Employee lifecycle, attendance, scheduling, payroll | F4 | HR-001..016, EMP-001..012 |
| *delivery* | Driver assignment, status, proof of delivery, cash handover | F4 | DLV-001..010 |
| *assets* | Assets, maintenance, work orders, spare parts | F4 | AST-001..009 |
| *crm* | Customer identity, cases, loyalty ledger, consent | F5 | CRM-001..011 |
| *marketing* | Channels, publishing, inbox, campaigns, attribution | F5 | MKT-001..010 |
| *intelligence* | Reporting, analytics, AI assistant, internal auditor | F5 | RPT-001..012, AI-001..020 |

Italicised contexts are **reserved boundaries** — their architectural space is
held from the start (PRD §2.4) but no implementation is scheduled before their
phase.

---

## Data ownership

Following PRD §4.1. One authoritative source per domain; everything else holds a
replica that is explicitly labelled as one.

| Domain | Authoritative source |
|---|---|
| Organisation and master structure | ERP organisation service |
| Menu, price, recipe | ERP menu service, head-office controlled |
| Item availability | ERP availability, with branch-controlled timed snooze |
| Order | ERP order management |
| Payment state | ERP payment ledger, reconciled to provider |
| Tax invoice | ERP invoicing and ZATCA records |
| Customer | ERP CRM, keyed on verified mobile identity |
| Inventory and batch | ERP inventory ledger |
| Financial posting | ERP native accounting ledger |
| Employee and payroll | ERP HR and payroll |
| External channel references | External platform, with reference and status replicated into the ERP |

---

## Integration principles

Every connector has authentication, timeout, retry, idempotency, validation,
health monitoring and a named operational owner (PRD §6.3).

- **Raw provider responses are retained separately from normalised ERP
  conclusions.** Reconciliation needs the original, and a normalisation bug must
  not be unrecoverable.
- **Connector failure creates an exception; it never corrupts the authoritative
  record.**
- **Provider credentials never reach client applications.**
- **Adapters are replaceable by design** (MKT-009, R-04, R-10). External APIs change
  and access gets withdrawn; that is a normal condition, not an incident.
- **Each direct delivery-platform connector is certified individually** before
  production use.

---

## What is deliberately not here

- **Infrastructure topology, regions, instance sizing.** Blocked on ADR-0002.
- **The branch hardware standard.** Blocked on lab evidence, ADR-0004.
- **The payment provider.** Blocked on an owner decision, ADR-0008.

These are gates, not omissions. Filling them in early with a plausible guess would
convert an open decision into an assumed one, which is the failure mode PRG-010
and PRG-011 exist to prevent.
