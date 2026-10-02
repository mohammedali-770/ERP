# ADR-0024 — One item master, and conversions that cannot be read two ways

- **Status:** Proposed. The owner decided the one-master shape on 2026-10-02; the
  rules below are this ADR's proposal for how it holds
- **Date:** 2026-10-02
- **Requirements:** INV-002 · INV-005 · PRG-014 · MFG-012 · CAP-P02 · CAP-P04 · CAP-P06 ·
  IAM-003 · IAM-006 · IAM-008
- **Related:** ADR-0012 · ADR-0021 · ADR-0023 · invariants I-6, I-7, I-8 ·
  `supabase/migrations/20261002000200_items_and_units.sql` ·
  [`../estate/process-mapping-items-and-units.md`](../estate/process-mapping-items-and-units.md)

## Context

Items and units are the first Phase 4 module, and every later table references them:
stock, purchasing, recipes, branch orders, lots, costing, POS import. So the choices
made here are the most expensive to reverse in the whole consolidation.

The warehouse system kept three masters — `items`, `raw_materials` and
`warehouse_units` — and its known defects cluster here:

- an item's category and serial could be edited after lots and orders named them;
- units were free text, and factory items had none at all;
- a pack ratio was a `numeric(10,2)` anyone could change at any time, re-denominating
  stock and re-converting approved purchase orders on the day they were received;
- an item with no ratio was read as ratio 1;
- nothing could be retired, so a discontinued item stayed orderable for good, and
  deleting one was guarded by a list of ten later tables.

The owner decided on 2026-10-02 that the ERP has **one item master with a type**
(INV-002), replacing `items` and `raw_materials`.

The design was produced by three independent drafts — from the requirements, from what
warehouse users rely on, and from what later modules need — scored and merged by a
judge. It was then built, and proved by the 134 cases of
`supabase/tests/080_items_test.sql` (those marked CONTROL among them) and by `db:check`.
Separately, one-off mutation runs each removed one mechanism and confirmed that 080 or
`db:check` then failed. That harness is not committed, so those runs are a record of
what was checked, not something this repository can reproduce.

## Decision

### 1. One master, every kind, and identity fixed from creation.

`erp.item` holds every INV-002 kind in a `text` column with a named check. An item's
**code, kind, base unit and brand are fixed from creation**, by a row trigger that binds
the owner too. Not "once used": "used" is knowable only by enumerating every later
table, and some references live in JSON no catalogue scan sees. A mistaken identity is
corrected by retiring the item and creating another; the old code is never reused.
Nothing is deleted either: row triggers refuse DELETE on items and conversions, and a
statement trigger on each table refuses TRUNCATE, which row triggers never see.

### 2. Units come from a closed register; conversions are a star.

`erp.unit` is changed by migration only. Mass, volume and count carry an exact size
against g, ml or piece; a pack has none. Every item's conversions in `erp.item_unit`
convert **straight to its base unit** — there is no unit-to-unit edge, so two paths
cannot disagree — and every active conversion of one physical dimension must agree with
the others, checked by trigger. A unit in an anchored dimension may be left for the
system to derive, and a stated factor must equal the derived one. A pack's size is always stated. **No conversion is ever assumed**: a missing one
raises, and nothing reads it as 1.

### 3. Conversions are immutable; a pack-size change is retire plus add.

A conversion's item, unit and factor never change, and retirement is final (I-6). A
supplier moving from cartons of 12 to cartons of 24 retires one row and adds another,
so a line that used ×12 goes on meaning ×12 (I-7).

### 4. Later rows copy the conversion through a four-column seam.

`(item_unit_id, item_id, unit_key, factor)` is a unique key. Every later
quantity-bearing row copies those four values and references them together, so its
unit and factor are provably the conversion's and the conversion provably its own
item's — I-7 by structure, which survives even an owner who disables a trigger.

### 5. The master knows nothing of later modules.

No stock, minimum, cost, price, supplier, display order or ordering flag lives on the
item, and no trigger on it writes another module's table. Later modules reference the
item; never the reverse. That breaks the warehouse's items-and-stock cycle, and it is
why minimum stock goes to the stock module per location (INV-013).

### 6. Hidden hides the data.

The runtime holds no privilege on the item tables; it writes through six recorded
routes and reads through three gated functions, each of which calls
`erp.assert_permitted()` first. `db:check`'s `every-runtime-definer-route-is-gated`
fails on any definer function the runtime may call that does not. So a `hidden` capability hides the data
and not only the menu (CAP-P02), and brand-private reads at a facility (ADR-0012) are
enforced in the database. This goes one step past ADR-0022, where the runtime may read
`erp.person`.

### 7. Every change is a recorded decision carrying the whole state.

`erp.item_decision` is append-only, protected by grant and by a trigger that also
covers `TRUNCATE`, and each row carries the full state it put in force. Items hold no
personal data, so — unlike `erp.identity_decision` — the log can. A projection row is
therefore checkable by **equality** with its latest decision, which `db:check`
asserts.

## Consequences

- `inventory.items` is registered by the migration and is **hidden** in every real
  database until a later migration promotes it after the edge layer, the screens and
  staff acceptance testing exist. The seed's `pilot` decision is synthetic.
- Every later module must read items through its own `security definer` functions; an
  invoker helper granted to the runtime that touches `erp.item` fails with 42501.
- A typo in a code, kind or base unit costs a retired item and a burned code. The
  create form must make the fixed fields explicit.
- **A retry is recognisable.** Every write route checks its decision id before any other
  rule, so a retry of a write that already committed fails 23505 naming
  `item_decision_pkey` ("decision … is already recorded"), rather than as a taken code
  or a stale form. The edge then confirms through `erp.item_history()` before reporting
  success.
- Factors are exact to six decimal places, and a derived factor that does not
  terminate is refused ("declare the smaller unit first"). The stock module must
  choose its storage scale for base quantities before it is built.

## Open, for the owner and for UAT

Recorded rather than guessed. None blocks this module's tables; each must be answered
before the module it names.

1. **Who may write items once real staff use the system.** The warehouse's screens let
   only the administrator write items and raw materials. Its row-level security also
   let the factory manager update raw materials (its `SYSTEM.md` §6), a workaround for a
   stock trigger that no screen used. The migration grants write to the administrator
   alone, so that is narrowed. Should write by kind be restored or added — a factory
   manager maintaining raw ingredients, say?
2. **Code format.** People type 1–24 characters of A–Z, 0–9, `.`, `_` and `-`, as the
   warehouse's serials were. Are system-generated codes per kind wanted? Codes are
   reserved forever, so this is expensive to change once real data exists.
3. **Two pack sizes under one unit word** — 10 kg cartons from one supplier and 12 kg
   from another. Refused here as the ambiguity INV-005 names; a second word or retire
   and add is needed. Bites first in the suppliers module.
4. **Catch-weight items** — bought by the piece, costed by weight. A fixed factor is
   wrong for them; the answer decides whether receiving needs a weight field.
5. **Sharing items across brands** (PRG-004, ADR-0012's open decision OPN-009). Reads
   are brand-private today. Only the read predicate changes if one catalogue is shared.
6. **Item pictures under ADR-0023** — how an edge function writes to and signs URLs from
   the private `erp-menu-media` bucket without `service_role`, and whether the owner
   wants the warehouse's public pictures instead. Until then `picture_path` stays null.
7. **The Arabic unit names** need a native speaker's review (PRG-014).
8. **Should an import be refused when an item changed after the file was exported?**
   Today the file wins, as it did in the warehouse: a row matching an existing code
   overwrites that item's names and descriptions, and a row with no description clears
   them. Refusing instead needs the export to carry each item's stamp, so that a stale
   row fails as a line error and refuses the whole file. Must be answered before the
   import screen ships.

## Alternatives considered

**Keep the warehouse's three masters.** Rejected by the owner's decision.

**Identity correctable until first use** (design 2 of the three). Needs a scan of every
later foreign key and cannot see references in JSON. Rejected for fixing identity from
creation.

**Mutable conversions with derived same-dimension units** (design 1). Only immutable
rows let a later line hold a provable copy of its factor. Rejected for design 3's
immutable rows, with design 1's dimension rule generalised to them.

**Runtime `SELECT` on the item tables**, as ADR-0022 allows on `erp.person`. Then
`hidden` would bind the menu and not the data. Rejected.
