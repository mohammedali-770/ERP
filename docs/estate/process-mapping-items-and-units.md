# Process mapping — items and units

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 1 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0024](../adr/ADR-0024-item-master-and-units.md) (proposed); the
  one-master shape by the owner, 2026-10-02
- **Built in:** `supabase/migrations/20261002000200_items_and_units.sql`
- **Status:** a mapping for review, not yet approved. MFG-012 asks for an *approved*
  mapping, so `inventory.items` lists MFG-012 in its requirements and CAP-P09 will hold
  promotion until this is signed off by operations.

The warehouse system's design was read from its current copy — its `docs/SYSTEM.md` §5
(Master data), §8.10 (Admin master data) and §10 (known issues), and the migrations and
screens they name. **Nothing is migrated**: the warehouse holds demo data only, and the
ERP is re-seeded synthetically (ADR-0021).

---

## Three masters become one

| Warehouse | ERP |
|---|---|
| `items` (warehouse and factory products) | `erp.item`, every INV-002 kind |
| `raw_materials` (a second master, with its own unit and stock) | `erp.item` of kind `raw_ingredient` — or `packaging` or `operating_supply` where the factory consumes one |
| `warehouse_units` (one purchase unit, one sale unit and a ratio per item) | `erp.item_unit`: any number of conversions, each straight to the base unit |

## Field by field

| Warehouse | ERP | Why |
|---|---|---|
| `items.serial` | `erp.item.code` | Canonical: trimmed, upper-cased, Arabic-Indic digits folded, and unique across retired items too. The warehouse's was case-sensitive and editable while lot codes were built from it |
| `items.name`, `description` | `name_en` / `name_ar`, `description_en` / `description_ar` | PRG-014: both languages, descriptions in pairs |
| `items.category` (`warehouse` \| `factory`) | **Split three ways**: what the item *is* → `item_kind`; which facility replenishes branches with it → ordering setup (module 9); who handles its orders and alerts → permissions | It conflated the three, and could be flipped after stock, recipes and orders named the item |
| `items.picture` (public bucket) | `picture_path` in the private `erp-menu-media` bucket, served by signed URL | 0007 makes public buckets a reviewed act; see ADR-0024's open question 6 |
| `items.order_index`, per-category reorder | Ordering setup and branch orders (modules 9–10), per facility, saved in one call | A catalogue position is an ordering concern, not what an item is |
| `items.stock_level_required` | Branch orders (module 10) | Same |
| `items.unit_price` | Item pricing (module 3), priced against a specific conversion, with history and an effective date | A price per sale unit changed meaning whenever the ratio was edited |
| `warehouse_units.sale_unit` | `erp.item.base_unit_key` — the unit stock is held in | The warehouse already held stock in the sale unit |
| `warehouse_units.purchase_unit` + `purchase_to_sale_ratio` | A pack conversion in `erp.item_unit`, same direction ("1 carton = 12 pieces") | Exact, immutable, retired rather than edited |
| `warehouse_units.minimum_stock_purchase_units`, `factory_stock.minimum_stock_level`, `raw_materials.minimum_stock_level` | Stock module (5), per location | INV-013: minimums are by location. The warehouse kept them in three places, none per location |
| `raw_materials.unit` (free text) | `base_unit_key`, from the unit register | Free text let one carton be spelt three ways |
| `raw_materials.supplier_id` (the primary supplier) | Suppliers module (2): an item–supplier link naming a conversion | Removes the plan's second ordering error: the master needs no supplier |
| `raw_materials.current_stock`, `avg_cost` | Stock (5) and costing (16) | The master holds no balance (I-8) |
| `created_by` → `auth.users` | `actor_id` on every `erp.item_decision`, a foreign key to `erp.person` that never nulls | B-11 |

## Behaviours kept

- **An item with history cannot be removed** — strengthened: no item is ever removed.
  Retire and reinstate replace delete, and a retired item admits no new work, which the
  warehouse could not express.
- **The Excel template and bulk upload, matching by code** — kept as
  `erp.import_items()`: all-or-nothing in the database, at most 5,000 rows, and up to 20
  `line n: …` errors in the warehouse's own format, so its screen carries over.
- **Only the administrator edits master data; other roles read it** — kept, as
  permissions.
- **Counting full packs plus loose pieces** — expressible as two count lines in two
  conversions, summed in the base unit (stock module).
- **Lot codes built as `<code>-YYMMDD`** — keep working, because a code never changes.

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| Category and serial editable after use | Fixed from creation, by a trigger that binds the owner |
| A missing ratio read as 1 | The base conversion is written with the item; a missing conversion raises |
| A ratio editable under existing stock and approved POs | Conversions are immutable; later lines copy them through a four-column foreign key |
| Create and edit as several client calls with no rollback | One transaction per route |
| No retired state; delete guarded by a list of ten later tables | A status, plus a delete-refusing trigger with no list to maintain |
| 51 `ON DELETE CASCADE` constraints (B-11) | None in `erp`, asserted by `db:check` |
| Guards that fired only for app calls | Triggers fire for every writer |
| Every list loaded unpaged | Keyset paging, at most 500 a page |

## For sign-off

Operations should confirm three things before this mapping is approved:

1. Every warehouse item and raw material can be given exactly one INV-002 kind.
2. No item is bought by the piece and consumed by weight (ADR-0024, open question 4).
3. Moving display order, the stock-level flag and the replenishing facility out of the
   item master into ordering setup matches how branches actually order.
