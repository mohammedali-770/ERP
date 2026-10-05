# Process mapping — branches and facilities

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 4 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0028](../adr/ADR-0028-facilities-and-branch-areas.md) (proposed)
- **Built in:** `supabase/migrations/20261005000100_facilities.sql`
- **Status:** a mapping for review, not yet approved. As for the earlier modules,
  operations' sign-off is a manual precondition of the migration that promotes
  `org.facilities` ([Q-23](../program/open-questions.md))

The warehouse system's design was read from its current copy:
- its `docs/SYSTEM.md`: §5 (`branches`), §7 (`check_order_location_trigger`,
  `private.branch_at()`, `private.distance_m()`) and §8.10 (Branch Management);
- the migrations that added the geofence
  (`20260929120000_branch_geofence_and_employee_login.sql`) and the branch lookup
  (`20260930090000_dispatch_receipt_cutoffs_par.sql`).

**Nothing is migrated:** the warehouse holds demo data only, and the ERP is re-seeded
synthetically.

---

## One table becomes the facility master

| Warehouse | ERP |
|---|---|
| `branches`, edited in place | `erp.facility` (0003), now a projection of its decisions |
| No history | `erp.facility_decision`: every change, with who, when and why |
| Branches only | Branches, warehouses, factories and offices, one entity |

## Field by field

| Warehouse | ERP | Why |
|---|---|---|
| `code`, required only in the browser; an import made branches without one | `code`, required, canonical (capitals, digits, hyphens), unique, fixed | Every role, order and device names a facility; its code is how people do |
| `name`, one language, not unique | `name_en` and `name_ar`, both required | PRG-014 |
| `location`, a free text line | `address_en`, `address_ar`, optional | Bilingual, and optional rather than an empty string |
| `latitude`, `longitude`, both or neither | The same, six decimal places | Kept |
| `geofence_radius_m`, 25–2000, default 150 | The same | Kept |
| `internal_only` | Not carried | It hid a branch from the geofence lookup, which is gone (ADR-0028, open question 1) |
| (none) | `facility_type` | One master for every kind of site (PRG-002) |
| (none) | `status`: open or closed | A branch closes; it is never deleted |
| (none) | `tz_name`, fixed | A branch's business day (Q-22) |
| (none) | `operating_unit_id`, and through it the brand, fixed | Brand-private reads (ADR-0012) |

## The geofence: what changes

| Warehouse | ERP |
|---|---|
| **The phone chose the branch:** whichever area it stood in, nearest first | **The worker is assigned to their branch** by their role, and the phone must also be inside that branch's area (owner, 2026-10-05; IAM-P11) |
| Checked by a trigger on the order | Checked by `erp.assert_at_facility()`, which module 10's order route calls after `erp.assert_permitted()` |
| Refused: no position, vaguer than 100 m, a branch with no area, outside the area | The same four, plus a closed branch |
| `order_distance_m` kept on the order | The check answers the distance and stores nothing. Whether module 10 keeps it is open (ADR-0028, question 3) |
| Overlapping areas warned about, and resolved to the nearest | Harmless, since nobody is placed by an area: no warning, no lookup |
| Managers and the administrator not checked | Module 10 decides (ADR-0028, question 2) |

## Behaviours kept

- **The administrator edits branches.** The managers read.
- **A branch with no area admits no order checked against it,** and its workers are told
  to ask for one, as the warehouse's list flagged them.
- **The precision limit is 100 m** (question 4).

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| Delete silently did nothing, and would have cascaded into par levels, month close and POS sales | A facility is closed, never deleted; triggers refuse a delete, the owner's included, and no foreign key in `erp` cascades (B-11) |
| A branch imported with no code | The code is required and canonical |
| Single-language names | Both languages required |
| Overlapping areas resolved silently to the nearest branch | Nobody is placed by an area |
| No closed state, so a closed branch could still be ordered for | Closed is a status, and `erp.assert_facility_open()` refuses new work |
| No record of who changed a branch's area | Every change is a decision with an actor and a reason |

## For sign-off

Operations should confirm before this mapping is approved:

1. A branch worker belongs to their branch, and orders for it only from inside its area
   (the owner's decision).
2. What `internal_only` was used for, if anything beyond the geofence lookup (question 1).
3. Whether managers ordering for a branch should be checked against its area
   (question 2), and whether 100 m is the right precision (question 4).
