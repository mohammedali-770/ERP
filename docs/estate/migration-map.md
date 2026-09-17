# Migration map

Every existing asset, classified. This is the document that stops F1 rebuilding
things that already work.

**Classifications**

| | Meaning |
|---|---|
| **Migration source** | Its data or model moves into the ERP. Plan the move. |
| **Inherit** | Its conventions or patterns are adopted by the ERP. |
| **Reference design** | Read it, learn from it, do not depend on it. |
| **Supersede** | The ERP replaces it. Plan the retirement. |
| **Adjacent** | Stays as its own product; integrate at a defined seam. |
| **Dead weight** | Archive. No further action. |

---

## By ERP module

### F1 — POS, menu, order management

| Existing asset | Classification | What specifically |
|---|---|---|
| `spicy-meal-ordering` order schema and RPCs | **Migration source** | Order, line, modifier, checkout-session model; idempotency keys; snapshot columns |
| Its fenced create-attempt gate and ambiguity classification | **Migration source** | The proven answer to OMS-011 / PAY-007 — see [`lazywait-surface.md`](./lazywait-surface.md) |
| Its availability snooze and sweeper | **Migration source** | MNU-003/004 already solved, including the transition audit |
| Its order-integrity watchdog (11 rules) | **Migration source** | SUP-004/005 and a head start on AI-016 |
| Its operations alerting | **Migration source** | SUP-005/006; severity, state, dedupe, dispatch outbox |
| `SMA` customer app | **Migration target** | APP-001; re-point per module, do not rewrite (APP-002) |
| `SMA` ops consoles | **Reference design** | Branch, call-centre and integrity consoles inform the ERP console |
| `SMA` conventions and CI gates | **Inherit** | Change control, migration workflow, drift detection |
| Lazywait integration | **Supersede** | Three endpoints, one webhook — narrower than the PRD implies |
| POS itself | *(none)* | **Greenfield.** No existing POS asset in the estate |

> **POS is the genuine greenfield piece.** Nothing in the estate is a point-of-sale
> application. Offline operation, printing, shifts and cash are new build, which is
> consistent with them carrying the two highest technical risks.

### F3 — inventory, procurement, warehouse, factory

| Existing asset | Classification | What specifically |
|---|---|---|
| `ExsistingWarehouseFactorySystem` domain model | **Migration source** | Unit conversion, dual PO streams, production batches, daily snapshots, six-role approval chain |
| Its database | **Migration source** | **Unresolved — not yet identified** (untracked connection config) |
| Its frontend | **Supersede** | Generated scaffold; no tests, no CI; rewriting on the ERP stack is cheaper than maintaining |
| `SpicyMealFactoryWarehouse` | **Reference design** | Predecessor; assess before relying on it |

### F4 — finance, HR, delivery, assets

| Existing asset | Classification | What specifically |
|---|---|---|
| `DeliveryApp` | **Supersede** | Folds into the one employee app (EMP-001, ADR-0014); its field-learned behaviour is input to DLV-005 |
| `yeastarissue` | **Reference** | Context for the PBX integration (CC-001) |
| — | *(none)* | Finance, HR and assets are greenfield |

### F5 — CRM, marketing, AI

| Existing asset | Classification | What specifically |
|---|---|---|
| `spicy-meal-ordering` loyalty ledger | **Migration source** | CRM-005; auditable accrual, redemption, expiry |
| Its account-deletion queue | **Migration source** | SEC-008, CRM-011 |
| WhatsApp inbox (`whatsapp-inbox-simple` + `Spicymeal`) | **Adjacent** | Integrate at the menu and branch data seam; do not absorb |
| Its campaign tables | **Reference design** | Built but unused; `coupons` is what actually runs |

### Superseded and stale

| Asset | Classification |
|---|---|
| `SpicyMealApp` | **Dead weight** — superseded by `SMA` |
| `Spicy-Meal-App`, `Spicy-Meal` | **Dead weight** — a year stale |
| `SpicyMealOperationApp` + `spicy-meal-operation` | **Dead weight** *(probable)* — both stopped the same week; confirm before archiving |
| `spicy-meal-whatsapp-inbox` | **Dead weight** — superseded by the simpler inbox |

---

## Consolidation targets

The estate has accumulated duplication that the ERP should resolve:

1. **Menu and branch data exist in at least two systems** — the ordering backend
   and the WhatsApp inbox, which keeps its own copies. The inbox should read from
   the ERP. This is small, worthwhile, and can happen well before F5.
2. **Five Supabase projects, three paused.** Confirm the paused ones are genuinely
   abandoned, then archive with their data exported and checksummed (ADR-0011
   principle 2).
3. **Four repositories that were once the customer app.** One is canonical; the
   others should be archived so no one reads the wrong one.

---

## Before this map can be called complete

Both are in [`../program/open-questions.md`](../program/open-questions.md):

- **The warehouse system's live database is unidentified.** F3 migration scope
  cannot be assessed without it.
- **The current payment provider state is ambiguous** — the database has one
  provider configured in test mode while the console ships administration for
  another. Nothing should be planned on top of that until it is confirmed.

Every claim in this document was checked against the live systems on 2026-09-17.
Anything that could not be verified is recorded as an open question rather than an
assumption.
