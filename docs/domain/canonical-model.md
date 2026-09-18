# Canonical model

The entities every context agrees on. Not a schema — a shared vocabulary, so
"branch" and "order" mean one thing across sixteen contexts.

---

## Organisation hierarchy

PRG-002 requires the full hierarchy; PRG-003 requires one legal company now with a
model that admits more later **without redesign**.

```
company
└── legal_entity            (one today; the model admits many)
    └── brand               (Spicy Meal today)
        └── operating_unit
            └── facility    (branch | warehouse | factory | office)
                └── department
                    └── cost_centre
```

Orthogonal dimensions that attach to records rather than nesting:

- `sales_channel` — POS, customer app, website, call centre, company delivery, each delivery platform
- `device` — enrolled POS device, printer, terminal, biometric reader

**Every record that could ever be brand-scoped carries these dimensions from the
first migration**, even while only one brand exists (ADR-0012). Retrofitting a
dimension onto populated tables is painful; carrying an unused one is nearly free.

---

## Core entities

### Facility
A physical location. `type` distinguishes branch, warehouse, factory, office.
Branches carry trading hours, service zones, delivery configuration and minimum
order values. **One entity, not four** — a transfer between a warehouse and a
branch is the same shape as one between two warehouses.

### Employee and role
An employee belongs to an organisation scope and holds roles. Roles grant
**capabilities**, and capabilities are what code checks (IAM-003). Access is limited
to assigned companies, brands, branches, departments and functions (IAM-006).

Screens compose from capabilities rather than role names — which is what makes
EMP-012 (add functions without new apps) possible.

### Product, variant, modifier
- **Product** — a sellable item with bilingual names, descriptions, images, receipt
  and kitchen labels (MNU-006).
- **Variant** — a named size or option with its own price (MNU-007).
- **Modifier group** — a set of choices with defaults, minimums, maximums and
  mutual exclusions (MNU-007).
- **Combo** — a product composed of configurable child selections (MNU-008).

### Menu version
An immutable, numbered, effective-dated publication scoped by company, brand,
branch, channel and order type (MNU-005). Branches consume; they never author.

### Recipe version
Links a sold product to ingredients, semi-finished items and packaging with
expected quantities (MNU-014). Immutable and effective-dated (MNU-015), which is
what lets an order snapshot reference it safely.

### Order
The authoritative record of a customer transaction, regardless of originating
channel (POS-010). Carries an immutable internal identifier plus channel-specific
external references (POS-012).

Lifecycle: `Received → Preparing → Ready → Completed` (POS-020), with `Cancelled`
reachable under authorisation.

### Shift
**A cash-responsibility assignment to a cashier** — not a device session. One open
shift per cashier per branch; many devices may join it (POS-022, POS-023).

### Payment intent
One tender leg of an order. Split payment is several intents, each preserving its
own amount, method, reference and refund balance (PAY-008).

### Invoice
A ZATCA document with its counter position and hash-chain link, bound to an EGS
unit (ADR-0006). Corrections are credit or debit notes, never edits.

### Customer
One profile per verified mobile number (CRM-001), with controlled merge and
duplicate resolution. Mobile numbers are normalised to **one canonical value**
(APP-004) — accepting local and international formats, storing one.

---

## Identity and reference conventions

| Convention | Rule |
|---|---|
| Internal identifiers | UUIDv7, minted at the edge (ADR-0005) |
| Display identifiers | Human-readable, branch and device scoped (Q-01) |
| External references | Raw value preserved byte-for-byte, plus a normalised form for uniqueness |
| Money | Integer minor units with an explicit currency. **Never floating point** |
| Quantities | Decimal with an explicit unit; conversions are explicit and unambiguous (INV-005) |
| Timestamps | UTC instant plus timezone name; `business_date` set at shift open |
| Soft deletion | **Does not exist for financial records** (POS-028, FIN-007). Status changes and reversals, never a deleted flag |

---

## Relationship to the existing estate

This model is shaped to **absorb** the live ordering schema rather than diverge
from it (ADR-0015). Where it differs, the difference is deliberate:

| Difference | Why |
|---|---|
| Full organisation hierarchy | The existing model is single-brand; PRG-002 requires the hierarchy |
| Order identity minted at the device | The existing model mints server-side; offline operation requires edge minting |
| Shift and cash entities | No equivalent exists; POS is greenfield |
| Ledger primitives unified | Loyalty already uses a ledger; finance, wallet and stock adopt the same pattern |
| Money as integer minor units | Verify the existing representation during migration and convert deliberately |

The last row is a migration task with a real failure mode, and is listed in
[`../estate/sma-absorption.md`](../estate/sma-absorption.md) rather than assumed
to be trivial.
