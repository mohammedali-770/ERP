# ADR-0028 — Facilities: branches made a master, and the area a branch worker orders from

- **Status:** Proposed. Built as module 4's database layer on 2026-10-05. The owner decided
  how a branch worker is placed (§2) the same day; the questions below are decided before
  the module is switched on
- **Date:** 2026-10-05
- **Requirements:** PRG-002 · PRG-014 · IAM-003 · IAM-006 · IAM-008 · IAM-P11 · MFG-012 ·
  CAP-P02 · CAP-P04 · SEC-001
- **Related:** ADR-0012 · ADR-0022 · ADR-0024 · ADR-0027 · invariants I-6, I-8 · Q-22 ·
  `supabase/migrations/20261005000100_facilities.sql` ·
  [`../estate/process-mapping-facilities.md`](../estate/process-mapping-facilities.md)

## Context

The warehouse kept a `branches` table: a code, a name, a one-line location, an
`internal_only` flag, and a latitude, a longitude and a geofence radius (25 to 2000 m,
default 150). The administrator edited it. A delete silently did nothing, because no
delete policy existed. Had it worked, it would have cascaded into par levels, month
close and POS sales. Names were single-language and not unique. There was no closed
state.

Its geofence did something specific. **It decided which branch a branch worker was
ordering for.** Workers belonged to no branch. When one placed an order, the phone's
position chose the branch whose area it stood in, nearest first where areas overlapped
(`private.branch_at()`). A trigger refused the order without a position, with one vaguer
than 100 m, for a branch with no area, or outside the area. Managers and the
administrator were not checked. Nothing else used it: not attendance, not check-in.

The ERP already had `erp.facility` (0003). It names every branch, warehouse, factory and
office, and roles, orders, shifts, devices and capability decisions all point at it. It
was reference data with no write path, and it carried no place or area.

## Decision

### 1. `erp.facility` becomes a master, on module 1's pattern

- **Writes go through four routes, each recording a decision** in an append-only log,
  `erp.facility_decision`, with an actor and a reason:
  - create;
  - amend names and addresses;
  - set or remove the area;
  - close or reopen.
- **The facility row is the projection,** stamped with the decision it equals (I-8). A
  facility that existed before the log is recorded once by nobody (`facility_recorded`,
  the only decision with no actor); 0019's backfill and the seed do this.
- **Nothing is deleted.** A facility is closed, and closing is reversible (B-11, I-6).
  Triggers bind the owner.
- **Code, type, brand and time zone are fixed once created.**
  - A branch moved to another brand would change, after the fact, whose sales and orders
    it held.
  - A different time zone would move every business date already recorded (Q-22).
- **Names are bilingual and required (PRG-014).** An address is optional in each language.
- **New work needs an open facility.** `erp.assert_facility_open()` is the seam later
  modules call. It reads under the facility's share lock, which every route takes for no
  key update, so a facility closed while work is in flight is seen. The routes do not take
  a full update lock, so an edit to a facility does not hold up an order, a shift or a
  device added there meanwhile (found in review).
- **The all-zero id is never a facility's.** It is `erp.org_scope()`, "organisation-wide",
  to every role and capability decision. A facility holding it would let a grant recorded
  at one facility act organisation-wide (found in review). The route and a constraint
  refuse it.

### 2. A branch worker is assigned to their branch, and the area is a second check (owner, 2026-10-05)

Asked whether the ERP should keep the warehouse's behaviour, the owner chose
**assignment plus a location check**:

- **Who a worker orders for is decided by their roles, as everywhere else.**
  `erp.person_role` scopes `branch_worker` to a facility (IAM-006, ADR-0022), as the seed
  already does. Nobody is placed by where they stand.
- **At order time, the phone must also be inside that branch's area.**
  `erp.assert_at_facility(facility, latitude, longitude, accuracy)` makes that check, and
  module 10's order route calls it after `erp.assert_permitted()`. It refuses:
  - a closed branch;
  - a branch with no area, so its workers cannot order until it is given one;
  - a missing position;
  - a fix vaguer than 100 m;
  - a position outside the area, naming how far away it is.

  It answers with the distance from the branch's point.
- **It stores nothing.** The position it is handed is gone when the call returns. No
  worker's location is kept by this module. Whether module 10 keeps the distance on the
  order, as the warehouse did, is that module's question (open question 3).
- **Overlapping areas are harmless,** so the warehouse's overlap warning and its
  nearest-branch lookup are not carried. With assignment, an area only answers "is this
  phone at the branch this person works for?".

This is new behaviour that no PRD requirement covers, so it is proposed as **IAM-P11**.

### 3. An area is a point and a radius, both or neither

- **Latitude and longitude** are kept to six places, about a tenth of a metre.
- **The radius is 25 to 2000 m,** defaulting to the warehouse's 150 m when a point is
  given without one.
- **Removing an area** is a decision too, and leaves the branch's workers unable to order.
- **The distance is the haversine great circle,** the warehouse's `private.distance_m()`.
  Its error at a few hundred metres is far below a phone's.

### 4. Who reads and who writes

- **Writes are organisation-wide,** as for every master: `assert_permitted(…, 'write',
  NULL)`.
- **The administrator writes,** as in the warehouse.
- **The managers read.** A branch worker reads nothing of this capability: they need no
  list of areas, being placed by assignment.
- **Read at a facility,** a person sees that facility's brand's facilities only
  (ADR-0012), and another brand's answers as a missing one.
- **`erp.viewer()` still lists the facilities a person may work at,** by code and name,
  to everyone as before.
- The capability `org.facilities` ships **hidden**.

### 5. Kept out, deliberately

- **`internal_only`.** In the warehouse it hid a branch from the geofence lookup, which
  no longer exists. What it was for otherwise is open question 1.
- **Trading hours, service zones, delivery configuration and minimum order values.**
  `canonical-model.md` puts them on the branch, and OMS-012, APP-011 and DLV-003 need
  them. They belong to the modules that use them, as columns or tables keyed by
  `facility_id`, not to this one.

## Consequences

- **Module 10 calls two seams when a branch orders:** `erp.assert_permitted()` at the
  branch, then `erp.assert_at_facility()`. `db:check` proves the check waits for a closure
  in flight and then refuses it, with two real sessions.
- **Every later module reaches the open check** through `erp.assert_facility_open()`.
- **The screens are module 4's next step.** The data layer is built (step 2 addendum,
  below): the edge's refusal mapping answers `already_recorded` for
  `facility_decision_pkey`, and `stale` for `facility_stale`.

## Addendum — 2026-10-05: the data layer (module 4, step 2)

The seven runtime routes are reachable over HTTP through one edge function, `facilities`
(`supabase/functions/_shared/facilities.ts`), built as `suppliers` and `transfer-prices`
are (ADR-0026's and ADR-0027's step 2 addenda). Nothing about the routes changed.

- **The routes:**
  - `GET /` lists facilities, paged by code. Open ones are listed unless `status` asks
    for `closed` or `all`.
  - `GET /{facility_id}` reads one facility, and `/{facility_id}/history` reads every
    decision about it.
  - `POST /` creates a facility.
  - `POST /{facility_id}/amend`, `/area` and `/status` change one.

  The seams `erp.assert_facility_open()` and `erp.assert_at_facility()` are not among
  them. They are owner-only, for later modules' own routes.
- **The actor is the session's,** through `withSession` (ADR-0025). A Node control test
  holds this for all four writes and all three reads. The facility a write changes is
  the one the path names, whatever the body says. The facility a read is asked at is the
  query's `facility_id`, never the facility read.
- **The edge checks shape, the database checks rules.** Three shape rules are this
  module's own:
  - **A coordinate is decimal text,** as a factor is: `"24.713600"`, never the number
    24.7136. It may have up to three integer digits and 15 places, as a phone's reading
    has; the route rounds it to six (found in review: a six-place cap at the edge made
    that rounding unreachable, and every client cut the text itself). It goes to the
    route through a `numeric` cast, and comes back as postgres.js answers a numeric, as
    text, so no float touches it either way. That a point is on the earth is 0019's rule; so
    is anything past `numeric(9,6)`, which the route refuses in its own words before
    converting.
  - **An area is stated whole.** `latitude`, `longitude` and `radius_m` must each be
    present, as a value or null. The route puts the whole area in force, so an absent
    field read as null would remove an area by omission. All three null removes it on
    purpose. A point with a null radius is 0019's to default to 150 m.
  - **An amendment states both addresses,** for the same reason: an omitted address
    would clear one.
- **Refusals** map through `_shared/refusal.ts`, which now lists
  `facility_decision_pkey` among its decision logs and `facility_stale` among its
  stamps:
  - a retry is `already_recorded`;
  - a form loaded before someone else's change is `stale` (both 409);
  - a code in use is a conflict (409);
  - a closed facility, or a status it already has, is `refused` (422);
  - a code, a type, a name, a point or a radius that breaks a rule is `invalid` (422);
  - a facility or an operating unit that does not exist is 404.
- **Proved end to end, as `erp_edge`,** by `supabase/functions/_deno/test/facilities.test.ts`:
  - A signed-in cashier reads no facility and changes none (§4).
  - Then, in one transaction that is rolled back:
    - The seeded first branch reads back with its area as six-place text.
    - The administrator creates a branch; a retry is answered as a retry, and a code in
      use as a conflict.
    - An amendment from a stale form is refused.
    - An area is set from a reading with more than six places and without a radius, and
      reads back rounded, at 150 m. The area rules, a value
      past `numeric(9,6)` included, come back in the route's own words.
    - The area is removed on purpose.
    - The branch is closed, refuses an amendment, drops out of the default list, and is
      reopened.
    - The warehouse manager reads and is refused all four writes.
    - The history holds every decision with its actor and reason, and the rollback is
      checked.

  Another brand's facility is not tested there: the seed's second brand owns none, and
  `erp_edge` cannot make one. pgTAP 140 covers brand-private reads.
- **Controls:** 17 deliberate breakages of the edge layer, each failing a named Node or
  Deno test. Among them:
  - an actor or a facility taken from the request;
  - a coordinate accepted as a number or with sixteen places, rounded by the edge, or
    passed through a float;
  - an absent coordinate, radius or address read as null;
  - the retry and stale mappings removed;
  - closed facilities listed by default;
  - latitude and longitude swapped, or an address dropped, by the driver.

## Open, for the owner and for UAT

Recorded rather than guessed. Each is decided before the module that needs it.

1. **What was `internal_only` for,** beyond hiding a branch from the geofence lookup? A
   central kitchen that orders nothing, or a branch that must not appear to customers
   (APP-007)?
2. **Do managers and the administrator skip the area check** when they order for a
   branch, as the warehouse let them? Today the seam is called for whoever the route
   calls it for; module 10 decides, and this is the owner's answer to give.
3. **Is the distance kept on the order?** The warehouse kept `order_distance_m`. It is a
   fact about where an employee stood, so it needs a notice and a retention period under
   PDPL ([`pdpl-assessment.md`](../compliance/pdpl-assessment.md) rates attendance
   location High).
4. **Is 100 m the right precision?** Indoors a phone often reports 30–80 m, and sometimes
   worse.
5. **Who besides the administrator edits branches?** Operations, say, for areas only?
6. **What happens to people assigned to a branch that closes?** Today their roles stay,
   and the closed branch admits no new work through `assert_facility_open()`.

## Alternatives considered

- **Let GPS decide, as the warehouse did.** The worker holds the role organisation-wide,
  and the branch is whichever area the phone is in. It matches the warehouse exactly, but
  anyone with the role could act for any branch they walked into, and it puts placement
  outside the permission model every other screen uses. The owner rejected it.
- **Assignment with no location check.** No worker's location is ever taken. The owner
  chose the check, so that nobody orders for a branch they are not at.
- **A separate `branch` table beside `erp.facility`.** Two records for one place. One
  entity, not four, as `canonical-model.md` says of branches.
- **A PostGIS geography column.** It is a new extension for one distance calculation;
  the haversine is exact enough here and needs nothing.
