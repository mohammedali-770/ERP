# Core transactional design

This document addresses the PRD's single **Critical** risk — R-02, offline
synchronisation creating duplicate or conflicting financial records — and the
acceptance criteria that depend on it: NFR-003 (no accepted order lost or
duplicated), NFR-004 (no confirmed payment attached to the wrong order or charged
twice), ACC-001 and ACC-008.

It assumes the [invariants](./invariants.md) and ADR-0003, ADR-0004, ADR-0005.

---

## 0. A testable definition of "accepted"

The acceptance gate says no *accepted* order may be lost. That is untestable until
"accepted" has a moment.

> **An order is accepted when its `OrderAccepted` event is fsync'd to the local
> store.** Before that it is a draft and may legitimately be lost.

Nothing may render a confirmation, print a kitchen slip, or enable payment before
that fsync returns. This turns ACC-001 from a sentiment into a property a test can
measure, and it tells the interface exactly where its blocking point is.

---

## 1. Identifiers

| Object | Format | Minted by | When |
|---|---|---|---|
| `order_id` | UUIDv7 | Creating device / ingest worker | On the **first line item**, not at "Send" |
| `order_number` (display) | `{branch}-{YYMMDD}-{slot}{seq:04}` | Creating device | With `order_id` |
| `shift_id` | UUIDv7 | Opening device | On shift open |
| `payment_intent_id` | UUIDv7 | Order-owning device | Before any terminal or gateway call |
| `payment_attempt_id` | UUIDv7 | Same device | Per communication attempt |
| `refund_id` | UUIDv7 | Initiating service | Before the refund call |
| `print_job_id` | UUIDv7 | Enqueueing device | In the same transaction as the causing event |
| `event_id` | UUIDv7 | Any writer | On append |

UUIDv7 because it is time-ordered: it indexes without the random-UUID page-split
pathology at sustained load, while requiring no coordination to stay unique.

`slot` is a device slot letter (A/B/C) assigned at enrolment, which makes the
human-readable number collision-free across the three devices with no coordination.

> **Needs finance sign-off:** this makes receipt numbers *per-device* sequences,
> not branch-gapless. A gapless per-branch sequence requires a branch coordinator
> and is incompatible with pure iPad-only operation. ZATCA's own gapless
> requirement is met separately by the per-EGS counter (ADR-0006), so this is a
> finance preference rather than a compliance constraint — but it is much cheaper
> to settle in month 1 than after go-live.

### The identifier is the idempotency key

Central ingestion is one statement:

```sql
INSERT INTO event_log (...) VALUES (...) ON CONFLICT (event_id) DO NOTHING;
```

A device that retries a push a thousand times produces exactly one order. There is
no separate idempotency-key table, no TTL window, no fuzzy matching on amount and
timestamp. Duplicate prevention is a primary-key constraint, and primary-key
constraints do not have bugs.

The dangerous case is not retry but **regeneration** — a device mints an ID,
crashes before persisting, and the cashier re-enters the order. No identifier
scheme fixes that, so the design shrinks the window instead: `order_id` is minted
and committed with the first line item, so identity exists from the first tap. What
remains exposed is a crash between tap and fsync, which loses a draft. That is
correct behaviour.

### External references

```sql
order_external_ref(
  channel_code      text,   -- 'jahez','hungerstation','callcentre','app',...
  external_id_raw   text,   -- verbatim, never normalised in place
  external_id_norm  text,   -- normalisation output, used for uniqueness
  norm_version      int,
  order_id          uuid REFERENCES orders(order_id),
  raw_payload       jsonb,
  PRIMARY KEY (channel_code, external_id_norm)
)
```

Ingestion is a single atomic upsert returning whether the row was created. A
replay returns the existing `order_id` with a byte-stable response body, so the
aggregator's retry logic sees consistency (OMS-005). `external_id_raw` is
preserved byte-for-byte.

> **Hard to reverse.** Changing the normalisation rule later retroactively splits
> or merges order identities. It is frozen with golden tests, and `norm_version`
> makes any change a deliberate migration rather than an accident.

### Payments: intent → attempt → outcome

- **Intent** — one per tender leg. A split payment of cash plus card is two
  intents. This is what the business means by "a payment" (PAY-008).
- **Attempt** — one per communication with the terminal or gateway. Many attempts,
  one intent.
- **Outcome** — attached to the intent, monotonic.

**The reference sent to the terminal derives from the intent, never the attempt.**
A retry therefore reuses the intent's reference and cannot present as a new
transaction. Whether the acquirer honours reference-based lookup — and whether its
reference field is wide enough — is the central open question in ADR-0008.

> **Where double-charging actually comes from.** The physical card terminal is the
> real mutex: two iPads cannot swipe the same customer's card simultaneously, and
> cash is serialised by the cashier's hands. The realistic vector is not
> cross-device concurrency but **one device retrying after an ambiguous response**.
> Effort should be budgeted accordingly — section 4 deserves more care than
> distributed locking does.

---

## 2. Event sequencing and clocks

Two mechanisms, both required.

**Per-device gapless sequence.** `device_seq` is a monotonic counter incremented
and persisted in the same transaction as the event, with `UNIQUE (device_id,
device_seq)` at central. Gaplessness lets central *prove* it holds everything from
a device: "I have 1..N contiguous" is a complete statement. It is also what makes
prefix acknowledgement possible (§3), and why a lost push acknowledgement needs no
reconciliation at all.

**Hybrid logical clock for cross-device ordering.** `hlc = (physical_ms, logical,
device_id)`, merged on every peer message. Device wall clocks are untrusted — an
iPad's clock can be wrong, can jump, and can be changed by a person. The HLC gives
a total order that never moves backwards and respects any communication that
actually happened.

Every event also carries `occurred_at` (UTC instant), `tz_name` (`Asia/Riyadh`) and
`business_date` (NFR-015).

> **`business_date` is set at shift open, not derived from calendar midnight.** A
> branch closing at 02:00 books those sales to the prior business day. Deriving it
> from the calendar is a classic and expensive mistake.

Each handshake measures clock skew against central or the controller. Events
created while skew exceeds a threshold are flagged, which routes them to
reconciliation. Cheap, and it converts a silent corruption into a visible one.

---

## 3. Branch runtime and sync protocol

### What lives on the device

Local store: **SQLite in WAL mode**, encrypted at rest (OFF-004).

- *Authored here:* orders, order events and lines, shifts, cash movements, payment
  intents and attempts, availability snoozes, print jobs, outbox, ZATCA counter.
- *Replicated from central:* menu bundle (effective-dated, signed), tax rules,
  modifier groups, price lists, printer configuration, employee roster, bounded
  customer cache.
- *Secure storage:* ZATCA certificate and private key, ICV counter, device TLS
  client certificate.

### The outbox

```sql
CREATE TABLE outbox_event (
  event_id       TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL,
  device_seq     INTEGER NOT NULL,   -- gapless
  hlc            TEXT NOT NULL,
  occurred_at    TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload        BLOB NOT NULL,      -- canonical JSON, sorted keys
  payload_hash   BLOB NOT NULL,
  prev_hash      BLOB NOT NULL,      -- per-device hash chain
  sync_state     TEXT NOT NULL,      -- pending|inflight|acked|rejected
  UNIQUE (device_id, device_seq)
);
```

`prev_hash` forms a per-device hash chain. One SHA-256 per event buys provable
detection of gaps, reordering and tampering. For a system whose top risk is
financial-record integrity, that is the cheapest audit mechanism available
(SEC-006, SEC-007).

### The handshake

One protocol, unchanged for device↔central, device↔peer and device↔controller.
This is what makes the ADR-0004 hardware decision deferrable — **there is no
protocol fork.**

```
1. HELLO     → device_id, my_seq_high, chain_head_hash, per-peer cursors, local clock
2. ACK_HELLO ← server_now, epoch, acked_through_seq, want_from_seq, config_version
3. PUSH      → events ordered by device_seq from want_from_seq (capped by count and bytes)
4. PUSH_ACK  ← accepted_through_seq (PREFIX), rejected[], conflicts[]
5. PULL      → per-stream cursors (menu, config, inbound orders, payment resolutions, peers)
6. PULL_ACK  ← batches + new cursors, has_more
```

Three points carry the weight:

- **`acked_through_seq` answers "did my push land?" before the device does
  anything.** The push path has the same ambiguity problem as payments, but here
  it is free to solve, because the identifier is a primary key and the sequence is
  gapless. A device that times out mid-push simply resumes.
- **Acceptance is prefix-based.** `accepted_through_seq = N` means 1..N are
  durable. A rejection halts the prefix and requires resolution before the device
  advances. Per-event acknowledgement sets would reintroduce gap bookkeeping,
  which is where bugs live.
- **`epoch`** lets central force a full resync after a restore from backup. A
  boring recovery lever, included from day one because adding it later means
  shipping a release that cannot tell old clients to resync.

Rejections are never silent: `reason_code` is a closed enum and every rejection
produces a reconciliation-queue row (OFF-007).

### Three peers, central down, LAN up

**Does a branch need a leader? No — and it must not require one.** Three iPads
cannot form a reliable quorum: any of them can be carried out of the room, put to
sleep by iOS, or run out of battery. Consensus among participants that
unilaterally vanish is not achievable, and a design depending on it fails in
exactly the situation it was built for.

Instead **authority is partitioned so every write has one natural owner.**

| Contested thing | Rule |
|---|---|
| Order authorship | The creating device owns the lifecycle. Device-minted IDs mean creation can never conflict. |
| Order handoff | Cooperative normally; under partition a peer may claim, lowest HLC wins, and the loser's later mutations surface as a visible conflict rather than being dropped. |
| Payment | Only the order owner may create an intent. At most one non-terminal intent per order. |
| Shift | One open shift per (branch, cashier). Devices *join* shifts. |
| Drawer | One open assignment per drawer. |

Enforced at central by partial unique indexes. **These three are built**, in
[`supabase/migrations/20260920000600_projections_and_conflict_detection.sql`](../../supabase/migrations/20260920000600_projections_and_conflict_detection.sql),
copied from this block verbatim and covered by pgTAP:

```sql
CREATE UNIQUE INDEX ux_one_live_intent ON payment_intents (order_id)
  WHERE state IN ('created','initiated','pending','unknown');
CREATE UNIQUE INDEX ux_one_open_shift ON shifts (branch_id, cashier_id)
  WHERE status = 'open';
CREATE UNIQUE INDEX ux_one_open_drawer ON drawer_assignments (drawer_id)
  WHERE released_at IS NULL;
```

Under a genuine partition two devices *could* both create an intent. The design
does not pretend to prevent this without a coordinator — it **guarantees
detection**: the second fails the index on merge and raises a
`PaymentConflictIncident` that freezes automatic refunds and retries on that order
until a human resolves it. Being honest here matters, because claiming prevention
would mean claiming a distributed lock that cannot exist.

### Shift is cash-responsibility, not a device lock

The framing that dissolves most of the problem: **"two devices both think they own
the shift" is the normal, required case**, because POS-022 says one cashier may
work across several terminals and POS-023 says cash responsibility follows the
cashier's shift.

A cashier signing in on a second terminal emits `ShiftDeviceJoined`. Cash movements
post against `(shift_id, drawer_id)`, never `device_id`.

The two real failure cases:

- **Two devices close the same shift.** Close is two-phase and append-only. First
  `ShiftCloseRequested` by HLC wins; later ones append `ShiftCloseRejected` and
  tell the cashier. Close is terminal; a shift is never reopened. Post-close
  corrections are adjustments against the closed shift.
- **One cashier opens two shifts on two offline devices.** On merge the earlier HLC
  is canonical; the later becomes a `ShiftMergeRequired` incident and its cash
  movements are re-parented by explicit `CashMovementReassigned` correction events
  — appended, never deleted, with a human confirming (I-3, OFF-009).

### Blind count, made tamper-evident

A UI-only blind count is defeated by anyone who can read the local database.
POS-024 deserves better, so the close is commit-then-reveal:

1. `ShiftCloseCounted{counted_denominations, count_hash}` is appended first.
2. `ShiftVarianceComputed{expected, counted, variance}` is appended second, and may
   be produced by a different actor.

Because the count is hash-committed before the variance is knowable,
retroactively "fixing" a count is detectable. This turns a policy into a provable
property.

### Degrading to a controller

The controller runs the same sync service as central, in store-and-forward mode.
Exactly three things change, all *detect → prevent* upgrades: one open shift per
cashier, one live intent per order, and drawer assignment become locally enforced.
Plus a single authoritative print queue, printing that survives all three iPads
sleeping, and USB/serial peripherals.

**The honest summary for the decision gate: synchronisation does not need a
controller. Printing, peripherals and unattended operation do.**

### The write path, concretely

```
BEGIN (SQLite)
  append  OrderSubmitted{order_id, totals, tax_snapshot}        → outbox
  append  PaymentIntentCreated{intent_id, order_id, amount, ref} → outbox
  insert  print_job{kitchen slip, rendered_payload, queued}      → outbox
COMMIT (fsync)
-- only now does the interface show "sending to terminal"
append PaymentAttemptStarted{attempt_id}   -- committed BEFORE the wire call
  → ECR call
append PaymentAttemptCompleted{...} | PaymentAttemptUnknown{...}
```

`PaymentAttemptStarted` is committed *before* the call. An app kill at any point
afterwards leaves a durable record that a charge may exist — which is what makes
§4 possible at all. Write-ahead is the entire trick.

---

## 4. Unknown-outcome reconciliation

### Payment state machine

```
CREATED → INITIATED ─┬→ AUTHORIZED ─┬→ CAPTURED ─┬→ PARTIALLY_REFUNDED → REFUNDED
                     │              │            └→ REFUNDED
                     │              ├→ CANCELLED
                     │              └→ EXPIRED
                     ├→ CAPTURED
                     ├→ DECLINED
                     ├→ CANCELLED
                     ├→ PENDING        (async tenders)
                     └→ UNKNOWN ──→ [RECONCILIATION] ──→ any terminal state
                                                   └───→ ESCALATED
```

All transitions are monotonic (I-6). Entries into `UNKNOWN`: gateway timeout, ECR
read timeout, app crash with an intent left `INITIATED`, terminal disconnect
mid-transaction, ambiguous response code, unparseable or signature-invalid
response.

### The ladder

From `UNKNOWN` the only permitted action is a **query**, never a charge. The ladder
stops at the first authoritative answer:

1. **Terminal-local query** — "status by reference" using the intent's reference.
   Works with central unreachable, which is why it is first.
2. **Gateway query API** by merchant reference.
3. **Settlement file** for the business day.
4. **Human attestation** — cashier confirms against the printed slip, appended as
   `PaymentOutcomeAttested` and always reviewed at close.

The resolution records its `source` permanently: "resolved by human attestation"
and "resolved by gateway query" carry different audit weight.

### Operating rules while unresolved

- **Order payment freeze.** No new intents, no automatic refunds, no auto-close of
  the containing shift.
- **The cashier-facing instruction is the single highest-value interface element in
  the system.** It must block and say, unambiguously in Arabic and English, *do not
  swipe the card again*, offering only: take another tender, or leave the order open.
- **Another tender is allowed.** If the customer pays cash and the unknown intent
  later resolves to captured, the system *proposes* a refund. It never
  auto-executes one while the intent is unresolved (PAY-010's rules apply after
  resolution, not before).
- **Shift close is not blocked forever.** Closing with unresolved intents is
  permitted with supervisor acknowledgement, appending
  `ShiftClosedWithUnresolvedPayments`. A protocol that can wedge a branch at
  closing time will be worked around by staff, which is worse than no protocol.
- **Sweeper.** A central worker runs the ladder on `UNKNOWN` intents older than 60s
  with backoff, escalating to the operations queue at 15 minutes.

### Refunds

`refund_id` is minted and persisted before the call and carried as the provider's
idempotency key (PAY-011). Central is to hold `UNIQUE(refund_id)` plus a partial
unique index preventing more than one in-flight refund per `(payment_id,
reason_code, amount)`.

> **Designed, not built.** There is no refunds table in `supabase/migrations/`
> yet — `refund` appears only as a state value in the `payment_intents` check
> constraint. This paragraph previously read "Central holds", present tense and
> indistinguishable from §1 above, whose indexes *are* built. Corrected 2026-09-21
> so the two are not mistaken for each other. The design is unchanged and remains
> the thing to build; note that PAY-010..012 are also blocked by B-01, so the
> provider's own idempotency semantics will shape the final constraint. Refund workers look up by `refund_id` only — never by matching amount and
timestamp, which is the standard way teams accidentally refund twice.

### External order creation

*As callee:* covered entirely by the unique index in §1.

*As caller:* `ExternalCallInitiated` is committed **before** the call, then resolves
to `CREATED`, `REJECTED` or `UNKNOWN`. **Only a reconciled `NOT_CREATED` unlocks a
resend, and the resend reuses the original request identifier** (OMS-011).

### Why the sync channel needs none of this

A device that pushes and loses the acknowledgement has the same ambiguity, but
needs no reconciliation: `event_id` is a primary key and `device_seq` is gapless
and prefix-acked, so the next `ACK_HELLO` tells it exactly where to resume.
Ambiguity is expensive only where the far side cannot be made idempotent — card
terminals and third-party APIs — and the design pushes the cost to exactly there.

---

## 5. Conflict rules

Deterministic and documented, as OFF-008 requires. One rule per contested entity.

### Menu version

> **Central wins by construction. Branch orders are honoured at the price snapshot
> taken at order time. Divergence is recorded as a variance event, never
> retro-priced.**

Branches have no write authority over the menu (MNU-001, MNU-002), so there is no
merge. The only failure mode is a branch running a stale bundle, and an order
priced from a stale bundle is *valid*, not wrong (MNU-015, OMS-016). Central
appends `PriceVarianceObserved` for finance. Re-pricing a completed order would be
a destructive overwrite of a financial fact (I-3).

### Item availability

> **`available = central_enabled AND NOT branch_snoozed`. Concurrent branch
> snoozes resolve by highest HLC. Auto-restore is a local scheduled transition
> that also emits an event. A branch snooze can never widen availability beyond
> central.**

The merge is a **most-restrictive AND**, not last-writer-wins over a boolean. An
unmerged or late-arriving snooze can then only cause a missed sale, never an
oversell. The failure direction is chosen deliberately.

`AvailabilityRestored{reason: timer_expired}` makes MNU-004's automatic restore
distinguishable in the log from a manual one.

### Shift

> **One open shift per (branch, cashier), earliest HLC canonical. Devices join
> shifts; they do not own them. Close is first-HLC-wins and terminal. Duplicate
> opens become `ShiftMergeRequired` incidents with cash movements re-parented by
> append-only correction events. A shift is never reopened.**

### Order

> **Identity is device-minted and never merged. State folds from an append-only
> per-order event list in HLC order. Line edits are add and void events, never
> mutations, so the merge is a commutative set union with tombstones. Void wins
> over add regardless of HLC. Once terminal, later mutations are rejected and
> recorded as `LateMutationRejected`.**

Modelling quantity changes as void-plus-add rather than in-place update is what
makes concurrent edits commutative: there is no arithmetic to reconcile, only a set.

> **"Void wins" is a business policy, not an architectural constraint.** It biases
> toward under-charging rather than charging customers for items they cancelled.
> Reversible, but it should be signed off rather than absorbed as an implementation
> accident.

### Payment

> **Never merged. Each intent is single-writer, owned by its creating device. The
> state machine is monotonic. At most one non-terminal intent per order, enforced
> by a partial unique index. A partition that yields two produces a
> `PaymentConflictIncident` — the system does not pick a winner. Corrections are
> new events (refund, reversal), never edits.**

### Ledgers

> **General-ledger postings are immutable; corrections are reversal plus re-post
> pairs (FIN-007). Wallet and loyalty balances are the sum of ledger entries,
> materialised into a cached balance stamped with `as_of_event_id`** (I-8).

---

## 6. Print subsystem

```sql
print_job(
  print_job_id   uuid PRIMARY KEY,
  target_printer_id, target_role,     -- kitchen_hot|kitchen_cold|receipt|label
  document_type,                      -- kot|receipt|invoice|label|shift_report
  source_aggregate_id,
  rendered_payload bytea,             -- rendered AT ENQUEUE
  content_hash     bytea,
  state text,                         -- queued|printing|printed|failed|retrying|failed_permanent
  attempt_count int,
  reprint_of uuid, reprint_seq int,
  lease_owner_device uuid, lease_expires_at timestamptz
)
```

The rules that deliver PRN-002 through PRN-013:

- **The job is persisted in the same local transaction as the causing business
  event.** A fired order cannot lose its kitchen slip to a crash, because the job
  exists before the crash window opens.
- **Content is rendered at enqueue, not at print.** A later menu edit cannot change
  what the kitchen already committed to producing — the same immutability principle
  as order snapshots (I-7).
- **Reprints are new jobs**, linked by `reprint_of` and marked "REPRINT #n"
  (POS-019 for the reprint label, PRN-006 for order changes). The original is never mutated.
- **Unknown print outcomes are handled per document type**, as configuration
  rather than hardcoded logic:
  - *Kitchen slip* — auto-retry. A duplicate costs seconds of confusion; a missing
    one costs an order. **Bias to duplicate.**
  - *Receipt or invoice* — never silently reprint. Mark unknown, require explicit
    cashier action, banner any later copy. Two identical invoices are a compliance
    problem.
  - After a send timeout, **query printer status before retrying** — the same
    query-before-retry discipline as payments (PRN-011).
- **Every printed document carries the short job identifier and attempt number in
  the footer.** Thermal printers have no deduplication, so duplicates cannot always
  be prevented — but they can be made *identifiable*, which is what staff and
  auditors actually need.
- **No print path calls central** (I-5).

### Leases

One executing owner at a time, on a short renewable lease. In iPad-only mode a
printer is homed to a primary device; if the lease expires past a grace period a
peer may take the job. Under partition this can duplicate a kitchen slip —
acceptable given the bias above — but **invoices never fail over**: only the
order-owning device prints them.

> **Recommendation: mandate LAN thermal printers, not Bluetooth.** A LAN printer is
> reachable from all three iPads, which is the precondition for lease failover.
> Bluetooth pairing is effectively one-to-one and eliminates failover entirely.
> Cheap to decide now; an estate-wide swap later.

### What changes with a controller

| Aspect | iPad-only | With controller |
|---|---|---|
| Queue authority | Per-device, peer-replicated | Single authoritative queue |
| Lease | Distributed; duplicate kitchen slip possible under partition | Single writer; no duplicate risk |
| Printer connectivity | LAN mandatory | LAN, or USB/serial |
| All devices asleep | No printing | Printing continues |
| Blast radius | Device-scoped | Controller becomes a branch single point of failure |

---

## 7. Assumptions this design makes

Recorded because each is testable, and each would change the design if false. The
first two are the ones most likely to sink iPad-only, and both are answerable in
week 2 (ADR-0004).

1. Branch Wi-Fi permits client-to-client traffic and mDNS. **Many managed networks
   enable AP client isolation by default.**
2. iOS keeps the app alive under Guided Access / MDM kiosk mode, in the foreground.
3. The acquirer's protocol supports query-by-reference with an adequate reference
   field width (ADR-0008).
4. B2B standard invoices are not issued offline (ADR-0006).
5. One card terminal is paired to one POS device, or terminals expose their own queue.
6. Order numbers are per-device sequences, not branch-gapless.
7. `business_date` is set at shift open.
8. Cash drawers are physically assigned one per shift.
9. "Void wins" is the accepted concurrent-edit bias.
10. Menu bundles are small enough to ship whole rather than as deltas.
11. Devices are MDM-managed, enabling certificate provisioning and kiosk mode.
12. Network printers, not Bluetooth.

---

## 8. Decisions that are hard or impossible to reverse

1. **Device-minted immutable `order_id` as the universal key.** Effectively
   permanent. There is no alternative compatible with offline operation.
2. **Append-only event log versus CRUD.** Reversing means rewriting every write
   path. Decide in month 1 and hold (ADR-0003).
3. **ZATCA EGS granularity.** Device-as-EGS survives either hardware outcome;
   controller-as-EGS does not (ADR-0006).
4. **External reference normalisation.** Changing it retroactively splits or merges
   order identities.
5. **HLC as the ordering primitive.** Include it in every event from day one even
   if nothing reads it initially; retrofitting invalidates stored orderings.
6. **Additive-only event schemas** (I-10).
7. **Payments as intent plus attempt** rather than a single row. Load-bearing for
   the whole unknown-outcome protocol; collapsing it later is a financial-model
   migration.
8. **Timezone and business-date representation.** Changing it reinterprets history.
