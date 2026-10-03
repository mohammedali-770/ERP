# Process mapping — items and units

- **Requirement:** MFG-012 — warehouse and factory workflows are "optimized and migrated
  through approved process mapping rather than copied without review"
- **Module:** Phase 4, module 1 ([consolidation plan](../program/consolidation-plan.md))
- **Decided by:** [ADR-0024](../adr/ADR-0024-item-master-and-units.md) (proposed); the
  one-master shape by the owner, 2026-10-02
- **Built in:** `supabase/migrations/20261002000200_items_and_units.sql`
- **Status:** a mapping for review, not yet approved. MFG-012 asks for an *approved*
  mapping, and `inventory.items` lists MFG-012 in its requirements, but nothing enforces
  the approval yet. CAP-P09 is proposed and not built, and even as specified it checks
  producible evidence, not a sign-off. So operations' sign-off is a manual precondition
  of promotion, which the PR that promotes `inventory.items` states and a reviewer checks
  ([Q-23](../program/open-questions.md)).

The warehouse system's design was read from its current copy — its `docs/SYSTEM.md` §5
(Master data), §6 (Permissions), §8.10 (Admin master data) and §10 (known issues), and
the migrations and screens they name. **Nothing is migrated**: the warehouse holds demo data only, and the
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
| `items.picture_url` (public bucket) | `picture_path` in the private `erp-menu-media` bucket, served by signed URL | 0007 makes public buckets a reviewed act; see ADR-0024's open question 6 |
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
  errors, each in the warehouse's `line n: …` wording. The lines travel in the error's
  DETAIL (PostgREST's `details`) under "item import refused: N line(s) failed…", not
  after the warehouse's `IMPORT_ROWS:` message prefix, so a screen reads `details`
  rather than parsing the message.
- **The file wins, as it did in the warehouse.** A row matching an existing code
  overwrites that item's names and descriptions, even if the item was edited after the
  file was exported, and a row with no description clears the item's. Whether an import
  should instead be refused when the item changed since export is
  [ADR-0024](../adr/ADR-0024-item-master-and-units.md)'s open question 8.
- **Only the administrator edits items through the screens** — kept, as permissions;
  other roles read. The warehouse's row-level security also let the factory manager
  update raw materials (§6), a workaround for a stock trigger that no screen used. That
  is narrowed to read here; ADR-0024's open question 1 asks whether to restore it.
- **Counting full packs plus loose pieces** — expressible as two count lines in two
  conversions, summed in the base unit (stock module).
- **Lot codes built as `<code>-YYMMDD`** — keep working, because a code never changes.

## Not carried

| Warehouse defect | Why it cannot recur |
|---|---|
| Category and serial editable after use | Fixed from creation, by a trigger that binds the owner |
| A missing ratio read as 1 | The base conversion is written with the item; a missing conversion raises |
| A ratio editable under existing stock and approved POs | Conversions are immutable, and later lines will copy them through a four-column foreign key to the `item_unit_seam` key |
| Create and edit as several client calls with no rollback | One transaction per route |
| No retired state; delete guarded by a list of ten later tables | A status, plus triggers that refuse DELETE and TRUNCATE, with no list to maintain |
| 51 `ON DELETE CASCADE` constraints (B-11) | None in `erp`, asserted by `db:check` |
| Guards that fired only for app calls | Triggers fire for every writer |
| Every list loaded unpaged | Keyset paging, at most 500 a page |

## For sign-off

Operations should confirm three things before this mapping is approved:

1. Every warehouse item and raw material can be given exactly one INV-002 kind.
2. No item is bought by the piece and consumed by weight (ADR-0024, open question 4).
3. Moving display order, the stock-level flag and the replenishing facility out of the
   item master into ordering setup matches how branches actually order.
