# Bounded contexts

Each context owns its data and publishes events. **Contexts do not read each
other's tables.** Cross-context reads go through published events or an explicit
query interface.

This is the rule that keeps the monorepo (ADR-0001) from becoming a single tangled
application, and it is enforced by the TypeScript project-reference graph rather
than by review discipline.

---

## The dependency rule

```
apps/*        →  services/*  →  packages/contracts
services/*    →  packages/contracts
packages/contracts → (nothing)
```

- Nothing depends on an application.
- No service imports another service's internals.
- `contracts` holds identifiers, event shapes and the sync protocol, and depends on
  nothing — so it can be shared by device, controller and central without dragging
  anything with it.

---

## F1 contexts

### identity
**Owns:** employees, roles and capabilities, sessions, device enrolment, privileged-action audit.
**Publishes:** `EmployeeAuthenticated`, `PermissionChanged`, `DeviceEnrolled`, `SessionRevoked`.
**Key requirements:** IAM-001..010.
**Note:** role-capability composition must exist from the start — the employee app
(ADR-0014) and every console assume it, and it cannot be retrofitted once screens
assume fixed layouts.

### menu
**Owns:** products, variants, modifier groups, recipes, price lists, menu versions, publication, availability.
**Publishes:** `MenuVersionPublished`, `PriceChanged`, `ItemSnoozed`, `AvailabilityRestored`.
**Key requirements:** MNU-001..016.
**Note:** head office controls prices; branches control availability only. This
asymmetry is why the menu conflict rule is "central wins by construction" rather
than a merge.

### orders
**Owns:** the order lifecycle across every channel, external references, exception queue, order-time snapshots.
**Publishes:** `OrderAccepted`, `OrderLineAdded`, `OrderLineVoided`, `OrderReady`, `OrderCompleted`, `OrderCancelled`.
**Key requirements:** OMS-001..018, POS-001..030.
**Note:** owns order *identity* absolutely. No other context mints an order identifier.

### payments
**Owns:** intents, attempts, outcomes, refunds, cash movements, shifts, ZATCA documents.
**Publishes:** `PaymentIntentCreated`, `PaymentOutcomeResolved`, `RefundCompleted`, `ShiftClosed`, `InvoiceIssued`.
**Key requirements:** PAY-001..019.
**Note:** shifts live here rather than in `orders` because a shift is a
cash-responsibility record (POS-023), and cash is a payments concern.

### printing
**Owns:** print jobs, queues, leases, templates, reprints.
**Publishes:** `PrintJobQueued`, `PrintJobPrinted`, `PrintJobFailed`, `PrintJobReprinted`.
**Key requirements:** PRN-001..015.
**Note:** subscribes to order and payment events; never calls them.

### sync-gateway
**Owns:** the handshake, event ingestion, projection dispatch, conflict incidents, device cursors.
**Publishes:** `SyncConflictDetected`, `DeviceResynced`.
**Key requirements:** OFF-001..014.
**Note:** the only context that speaks the wire protocol. Others never know whether
an event arrived from a device, a peer or a controller.

---

## Reserved contexts

Architectural space held from the start (PRD §2.4); no implementation before their
phase. Reserved means the boundary exists in the model and nothing else is allowed
to grow into it.

| Context | Phase | Owns | Requirements |
|---|---|---|---|
| inventory | F3 | Stock ledger, batches, expiry, counts, replenishment | INV-001..019 |
| factory | F3 | Production planning, orders, batches, yield, traceability | MFG-001..012 |
| procurement | F3 | Requests, approvals, sourcing, receiving, matching | PRC-001..009 |
| finance | F4 | Accounts, postings, dimensions, closing, statements | FIN-001..020 |
| people | F4 | Employee lifecycle, attendance, scheduling, payroll | HR-001..016, EMP-001..012 |
| delivery | F4 | Assignment, status, proof of delivery, cash handover | DLV-001..010 |
| assets | F4 | Assets, maintenance, work orders, spare parts | AST-001..009 |
| crm | F5 | Customer identity, cases, loyalty, consent | CRM-001..011 |
| marketing | F5 | Channels, publishing, inbox, campaigns | MKT-001..010 |
| intelligence | F5 | Reporting, analytics, AI assistant and auditor | RPT-001..012, AI-001..020 |

---

## Cross-context flows that need care

| Flow | Direction | Why it is delicate |
|---|---|---|
| Sale → stock deduction | orders → inventory | INV-001 wants real-time deduction; the order is authoritative, stock is derived. Deduction must be idempotent on the order event. |
| Sale → financial posting | orders/payments → finance | FIN-008 posts automatically. Postings are immutable (FIN-007), so a corrected order produces a reversal, never an edited posting. |
| Order → loyalty accrual | orders → crm | Accrual on settlement, not on placement — otherwise a cancelled order grants points. |
| Menu → every channel | menu → all | MNU-012 requires one consistent approved version; MNU-013 requires a failed channel not to block the others. |
| Order → print | orders → printing | Printing subscribes. If it called orders, a print failure could block an order. |
