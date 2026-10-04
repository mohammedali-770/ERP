# ADR-0026 — Suppliers, and what each one sells, named down to the pack

- **Status:** Proposed. Built as module 2's database layer on 2026-10-04; the owner
  decides the open questions below before the module is switched on
- **Date:** 2026-10-04
- **Requirements:** PRC-005 · INV-005 · PRG-014 · MFG-012 · SEC-008 · CAP-P02 · CAP-P04 ·
  IAM-003 · IAM-006 · IAM-008
- **Related:** ADR-0005 · ADR-0012 · ADR-0023 · ADR-0024 · invariants I-6, I-7, I-8 ·
  `supabase/migrations/20261004000200_suppliers.sql` ·
  [`../estate/process-mapping-suppliers.md`](../estate/process-mapping-suppliers.md)

## Context

Suppliers are module 2 of the consolidation. Purchase orders, receipts, supplier
invoices and the factory's daily supply sheet all name one, so this master constrains
modules 8 and 14–16 as items constrain everything.

The warehouse system kept one table:

- a name;
- a type (`warehouse` | `raw_material` | `both`);
- contact fields;
- payment terms in days.

It was edited in place and deleted at will. Raw materials pointed at it through
`raw_materials.supplier_id`, one primary supplier each. The weaknesses:

- **No code.** Its import matched by `lower(trim(name))`, so renaming a supplier in the
  file created a second one.
- **The type was coarse.** It said a supplier sold "raw materials", not which, and was
  checked against a purchase order's kind as a proxy for "does this supplier sell this".
- **The primary supplier said "chicken", not "chicken in 10 kg cartons".** A purchase
  order line then carried a pack that nothing tied to what the supplier actually sells.
- **Nothing was retired, and no change was recorded.** Who changed the payment terms,
  and when, was unknowable.

PRC-005 asks for more than the warehouse had: commercial, tax, contact, banking,
category, contract and performance information, "subject to access controls".

## Decision

### 1. A supplier master on module 1's pattern

`erp.supplier` is a projection of an append-only decision log, `erp.supplier_decision`.
Each row of the log carries the whole business state it put in force. A supplier has:

- **A code, fixed from creation and reserved forever**, in the same alphabet as an item
  code. Imports match by code.
- **Names in both languages**, unique among active suppliers.
- **A VAT registration number** (fifteen digits, first and last 3) and a **commercial
  registration** (ten digits). Both are optional, because a small local vendor may have
  neither, but never malformed. Digits typed on an Arabic keyboard are folded.
- **Payment terms**, 0–365 days. They are always stated; the warehouse's default of 30
  is the console's suggestion, not the database's.
- **A status.** Retire and reinstate replace delete. A retired supplier admits no new
  work through `erp.assert_supplier_active()`, the seam purchasing will call.

Triggers bind the owner too: no delete, no truncate, and no change of code. Edits are
made against the loaded stamp, so a stale form is refused rather than overwriting.

### 2. Personal data stays out of the log (SEC-008)

A supplier's contact person, phone, email and address can identify a private
individual: a sole trader's address is their home. An append-only log cannot honour an
erasure request. So, as ADR-0022 decided for people:

- **Contacts live only on `erp.supplier`,** mutable, through their own route,
  `erp.set_supplier_contact()`.
- **That route logs a decision that carries no contact value, and no typed reason.** It
  records who and when, a fixed reason ("Contact details changed." or "Contact details
  erased."), and the business record unchanged. Every other decision keeps the reason a
  person typed, and that is append-only; on a contact change the natural reason names
  the person ("new rep Khalid, 055…"), so this route takes none (found in review).
- **Erasure works on a retired supplier,** because an erasure request does not wait for
  a reinstatement.

The log has no contact column at all. pgTAP 110 asserts that, and `db:check` asserts it
as part of `supplier-projections-match-their-decisions`.

What this does **not** guarantee: a reason typed on any other decision is free text, kept
for good, and nothing stops a person typing a name into it. And a sole trader's business
name and commercial registration identify a private individual as surely as an address
does, and they are decided business fields, logged in full. Open question 7 asks what
retention applies to both.

### 3. What a supplier sells is a conversion, not an item

`erp.supplier_item` links a supplier to one of an item's conversions, through 0012's
four-column seam (`item_unit_id`, `item_id`, `unit_key`, `factor`). It is the first
table to stand on that seam.

- "Al Waha sells chicken breast in 10 kg cartons" is one row. When the carton becomes
  12 kg, that is a new conversion and a new supply; the old one goes on meaning 10.
- A supply copies its conversion whole. Its supplier and conversion are fixed;
  retirement is final (I-6).
- A supply on a pack or item retired since stays `active` itself, because purchasing
  refuses the pack where it is used. The reads show the pack's and the item's status
  beside it, and such a supply cannot be made preferred.
- A retired supplier's supply can still give up the item's preferred slot, and nothing
  else, so a slot is never held for good (found in review). Who sells an item is listed
  live suppliers on live packs first, then preferred first.
- Only an **active** pack of an **active** item can be supplied.
- A supplier sells one conversion **once at a time**.
- An item has **at most one preferred supplier at a time**: the warehouse's primary
  supplier, for every kind of item now, not only raw materials.
- The item master knows nothing of suppliers. The dependency runs one way, which is the
  consolidation plan's correction of the old module order.

**The type goes.** What a supplier sells is now answered item by item, which is the
question purchasing actually asks.

### 4. The supplier master is organisation data; what it sells is brand-scoped

Both brands buy from the same suppliers, so the supplier list is not filtered by
facility. Every read still takes the facility and asks `erp.assert_permitted()` there.
What a supplier sells is filtered by the facility's brand, as items are (ADR-0012), so
another brand's catalogue is not revealed through its suppliers.

What a supplier sells names items, so it is shown only to someone who may read items
there: `erp.get_supplier()` returns no supplies, and `erp.supplier_history()` no supply
decisions, while `inventory.items` is hidden or not granted (found in review).
`erp.item_suppliers()` asks for read on both capabilities outright.

### 5. Writes are organisation-wide; reads are for the managers

The administrator writes, as in the warehouse. The warehouse, factory and general
managers and the accountant read, as in the warehouse. A branch worker reads nothing.
The capability `procurement.suppliers` ships **hidden**, like `inventory.items`.

### 6. Retries are recognisable

Every write route locks and checks its decision id first, as 0012's do. A retry that
overlaps its original waits, then answers 23505 on `supplier_decision_pkey`. The import
re-raises that answer from inside its rows rather than reporting the line as failed,
so an import sent again while the first is still running is a retry, not "nothing was
saved" (found in review; `erp.import_items()` has the same gap, for module 1's next
change). `db:check` proves it with two sessions on all seven write routes and the import.

### 7. Import, matched by code; the file wins

`erp.import_suppliers()` is the warehouse's supplier upload. It is all-or-nothing,
matches by code, and runs each row through the same routes as the forms, in its own
subtransaction. Up to 20 failing lines are named. As with items, the file wins: a
differing row overwrites the business record, then the contacts, and a blank cell
clears a field.

## Consequences

- **Purchasing (module 8) gets a seam.**
  - A PO calls `erp.assert_supplier_active()`.
  - A PO line copies a supply's conversion through the seam, so the line provably buys
    what the supplier sells, at the factor it had.
  - The warehouse's `PO_SUPPLIER` type check becomes "this supplier has an active
    supply for this conversion".
- **Retiring a supplier leaves its supplies alone.** They come back unchanged on
  reinstatement. Retiring a conversion does not retire the supplies that name it
  either: purchasing refuses a retired conversion where it is used, and the reads show
  it as retired beside the supply.
- **The edge layer and screens are module 2's next steps.** The edge's refusal mapping
  must then answer `already_recorded` for `supplier_decision_pkey` as it does for
  `item_decision_pkey`.
- **`erp_read` reads contacts,** as it reads `erp.person`'s names. Erasure clears them at
  the source.

## Open, for the owner and for UAT

Recorded rather than guessed. Each must be answered before the module that needs it.

1. **Banking details (PRC-005).** An IBAN is the field a payment fraud changes. Storing
   one needs its own permission, a second approver for any change, and a payment process
   to serve — none of which exists. The payment freeze covers what would use it. Not
   built. When payments are designed: who may see a supplier's IBAN, who may change it,
   and what confirms a change?
2. **Category.** Is "what the supplier sells" enough, or is a separate category wanted,
   for reporting or approval rules (PRC-002)? None is built.
3. **Contracts and documents.** These need storage under ADR-0023, the same open problem
   as item pictures (ADR-0024, question 6).
4. **Performance (PRC-008, F4).** It will be computed from receipts and invoices, which
   do not exist yet.
5. **Who besides the administrator may maintain suppliers.** Purchasing staff, say?
6. **A preferred supplier per facility** rather than per item. The warehouse had one
   per raw material; a branch-specific preference has not been asked for.
7. **Retention (SEC-008).** For a supplier no longer used, should its contact details be
   erased after a period, or kept until someone asks? And what applies to what the log
   keeps for good: a sole trader's business name and commercial registration, and any
   personal detail a person typed into a reason?
8. **The import's file-wins rule**: the same question as ADR-0024's question 8.

## Alternatives considered

**Keep the warehouse's type.** It answers a coarser question than the supplies do, and
two sources of "what does this supplier sell" would disagree. Rejected.

**A supply naming an item, not a conversion.** This is the warehouse's shape. It cannot
say which pack is bought, so a PO line's factor could not be tied to the supplier.
Rejected.

**Contacts in the log, like the rest.** Simpler, and one fewer route. But an erasure
request could then never be honoured. Rejected for ADR-0022's precedent.

**A separate contacts table, several per supplier.** It would hold more than the
warehouse ever did. Deferred: four fields on the supplier match today's use, and a
table can replace them without touching the log.
