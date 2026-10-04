# Process mapping — suppliers

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 2 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0026](../adr/ADR-0026-suppliers.md) (proposed)
- **Built in:** `supabase/migrations/20261004000200_suppliers.sql`
- **Status:** a mapping for review, not yet approved. As for items, operations'
  sign-off is a manual precondition of the migration that promotes
  `procurement.suppliers` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy: its `docs/SYSTEM.md`
§5 (Master data), §6 (Permissions), §8.10 (Admin master data) and §8.14 (Supplier
invoices), the migrations that define `suppliers` and `import_master_data()`, and
`src/components/Admin/SupplierManagement.tsx`. **Nothing is migrated**: the warehouse
holds demo data only (six suppliers), and the ERP is re-seeded synthetically.

---

## One table becomes three

| Warehouse | ERP |
|---|---|
| `suppliers`, edited in place, deleted at will | `erp.supplier`, a projection of `erp.supplier_decision` |
| `raw_materials.supplier_id`, one primary supplier per raw material | `erp.supplier_item`, what each supplier sells, one row per pack |
| (no history) | `erp.supplier_decision`: who changed what, when and why |

## Field by field

| Warehouse | ERP | Why |
|---|---|---|
| (none — matched by `lower(trim(name))`) | `code`, fixed and reserved for good | A renamed supplier was a new supplier on import |
| `name` | `name_en` / `name_ar` | PRG-014: both languages |
| `type` (`warehouse` \| `raw_material` \| `both`) | **Gone**: what a supplier sells, item by item, in `erp.supplier_item` | The type was a coarse proxy for "does this supplier sell this", which the supplies answer exactly |
| (none) | `vat_number`, `cr_number` | PRC-005's tax information; a purchase invoice's input VAT needs a valid number |
| `payment_terms_days` (default 30) | `payment_terms_days`, 0–365, always stated | A default in the database is a decision nobody made; the console proposes 30 |
| `contact_person`, `phone`, `email`, `address` | The same four fields, on `erp.supplier` only, never in the log | SEC-008: they can identify a private individual, and an append-only log cannot be erased |
| `raw_materials.supplier_id` | A supply marked `preferred`, at most one per item | Kept for every kind of item, not only raw materials, and naming the pack |
| (none) | `supplier_code` on a supply | The supplier's own code, as printed on their invoices |
| `created_at`, `updated_at` | `actor_id`, `reason`, `decided_at` on every decision | Who changed the terms, and why, is now recorded |

## Behaviours kept

- **Only the administrator maintains suppliers; the managers and the accountant read
  them.** These are permissions, as in the warehouse's row-level security. ADR-0026's
  open question 5 asks whether purchasing staff should also maintain them.
- **Bulk upload, all-or-nothing.** This is `erp.import_suppliers()`, at most 5,000 rows,
  with up to 20 failing lines named. It matches by **code** rather than by name, which
  is the one deliberate change.
- **The file wins**, as in the warehouse and as for items: a row overwrites, and a blank
  cell clears. ADR-0026's open question 8.
- **Supplier names are unique**, in both languages, among active suppliers. A retired
  supplier frees its names.

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| Suppliers deleted at will, under POs and invoices that named them | Retired, never deleted, by triggers that bind the owner |
| Matched by name, so a rename made a duplicate | A fixed code; names can change freely |
| A primary supplier for the item, not the pack | A supply names a conversion through the I-7 seam |
| The type checked against a PO's kind as a stand-in | The supplies themselves; purchasing asks for an active supply of the conversion |
| No record of who changed the payment terms | Every change is a decision with an actor and a reason |
| Contacts only ever overwritten, never erasable on request | Overwriting and erasure are both supported, and the log never held them |

## For sign-off

Operations should confirm before this mapping is approved:

1. Every warehouse supplier can be given a code, and the six demo suppliers' types
   translate into supplies of specific items and packs.
2. One preferred supplier per item, not per branch, matches how ordering works
   (ADR-0026, question 6).
3. Nothing in today's work needs the supplier's bank details in the system before
   payments are designed (ADR-0026, question 1).
