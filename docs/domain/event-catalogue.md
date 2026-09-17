# Event catalogue

The F1 event vocabulary. Events are the contract between contexts and the unit of
synchronisation between device and central.

Rules from ADR-0003 and I-10: **append-only, additive-only schema, `schema_version`
on every event, never remove or repurpose a field.**

---

## Envelope

Every event carries the same envelope, regardless of type:

```
event_id        uuid        -- UUIDv7, the idempotency key
device_id       uuid
device_seq      bigint      -- gapless per device
hlc             text        -- hybrid logical clock, sortable
occurred_at     timestamptz
tz_name         text        -- 'Asia/Riyadh'
business_date   date        -- set at shift open, NOT calendar midnight
branch_id       uuid
shift_id        uuid?
aggregate_type  text
aggregate_id    uuid
event_type      text
schema_version  int
payload         jsonb       -- canonical JSON, sorted keys
payload_hash    bytea
prev_hash       bytea       -- per-device hash chain
correlation_id  uuid?
causation_id    uuid?
actor_type      text        -- cashier | system | integration
actor_id        uuid?
```

---

## Order events

| Event | Meaning | Notes |
|---|---|---|
| `OrderCreated` | Identity minted | Emitted with the **first line item**, not at Send |
| `OrderLineAdded` | Line added, with full snapshot | See `snapshot-rules.md` |
| `OrderLineVoided` | Line removed | Void, never mutate — keeps the merge commutative |
| `OrderCustomerAttached` | Customer and address snapshot | APP-010 |
| `OrderSubmitted` | Sent for fulfilment | Totals and tax summary frozen |
| **`OrderAccepted`** | **Durably accepted** | **Defines "accepted" for ACC-001. Nothing may confirm or print before this fsyncs** |
| `OrderRouted` | Assigned to a branch | After serviceability, hours, availability (OMS-012) |
| `OrderReady` | Production complete | From barcode scan (PRN-008) |
| `OrderCompleted` | Handed over | |
| `OrderCancelled` | Cancelled with reason code | POS-021 |
| `OrderOwnershipRequested` / `Granted` / `Claimed` | Device handoff | Claim is the degraded path |
| `LateMutationRejected` | Mutation after terminal state | Recorded, never silently dropped |

## Payment events

| Event | Meaning | Notes |
|---|---|---|
| `PaymentIntentCreated` | A tender leg begins | One per leg; split payment is several (PAY-008) |
| `PaymentAttemptStarted` | Before the wire call | **Committed before the call** — this is what makes reconciliation possible |
| `PaymentAttemptCompleted` | Provider responded | Raw response retained |
| `PaymentAttemptUnknown` | Ambiguous outcome | Enters `UNKNOWN`; blocks retry |
| `PaymentOutcomeResolved` | Reconciliation concluded | Records the ladder rung that resolved it |
| `PaymentOutcomeAttested` | Human attestation | Lower confidence; always reviewed at close |
| `PaymentOutcomeDisputed` | Later evidence contradicts a terminal state | Incident, never a state flip (I-6) |
| `PaymentConflictIncident` | Two live intents on one order | Detection, not arbitration (I-3) |
| `RefundInitiated` / `RefundCompleted` / `RefundFailed` | Refund lifecycle | Idempotent on refund identifier |

## Shift and cash events

| Event | Meaning | Notes |
|---|---|---|
| `ShiftOpened` | Cashier opens a shift | Sets `business_date` |
| `ShiftDeviceJoined` | Cashier works another terminal | The normal case, not a conflict (POS-022) |
| `CashMovementRecorded` | Cash in or out | Against shift and drawer, never device |
| `ShiftCloseRequested` | Close begins | First HLC wins |
| `ShiftCloseCounted` | Blind count, **hash-committed** | Committed before variance is knowable (POS-024) |
| `ShiftVarianceComputed` | Expected vs counted | May be a different actor |
| `ShiftClosed` | Terminal | Never reopened |
| `ShiftClosedWithUnresolvedPayments` | Closed with unknowns outstanding | Supervisor acknowledged |
| `ShiftMergeRequired` | Duplicate open detected | Incident |
| `CashMovementReassigned` | Correction | Append-only (OFF-009) |

## Menu and availability events

| Event | Meaning | Notes |
|---|---|---|
| `MenuVersionPublished` | New approved version effective | MNU-005, MNU-010 |
| `ItemSnoozed` | Branch marks unavailable with return time | MNU-003 |
| `AvailabilityRestored` | Item available again | `reason: timer_expired` vs manual — MNU-004 |
| `PriceVarianceObserved` | Order priced from a stale bundle | Finance signal; **never a re-price** |
| `ChannelSyncFailed` | A channel did not receive the version | MNU-013; does not block other channels |

## Print events

| Event | Meaning | Notes |
|---|---|---|
| `PrintJobQueued` | Job created | **Same transaction as the causing event** |
| `PrintJobLeased` | A device took ownership | Short renewable lease |
| `PrintJobPrinted` | Confirmed printed | |
| `PrintJobFailed` / `PrintJobRetrying` | Failure and retry | Per-document-type bias |
| `PrintJobUnknown` | Send timed out | Query printer before retry (PRN-011) |
| `PrintJobReprinted` | New job linked to the original | Labelled "REPRINT #n" |

## Invoice events

| Event | Meaning | Notes |
|---|---|---|
| `InvoiceIssued` | Document issued, counter advanced | **Counter advance in the same transaction** |
| `InvoiceQueuedForSubmission` | Awaiting connectivity | PAY-017 |
| `InvoiceSubmitted` / `InvoiceAccepted` / `InvoiceRejected` | Authority response | Raw response retained |
| `CreditNoteIssued` / `DebitNoteIssued` | Corrections | Never an edited invoice |

## Sync events

| Event | Meaning |
|---|---|
| `SyncConflictDetected` | A merge produced an incident requiring human resolution |
| `DeviceResynced` | Full resync after an epoch change |
| `ClockSkewDetected` | Device clock outside tolerance; routes affected events to review |

---

## Naming rules

- **Past tense.** An event records something that happened. `OrderCancelled`, not
  `CancelOrder`.
- **No conditionals in a name.** `AvailabilityRestored` with a `reason` field, not
  `AvailabilityAutoRestored` and `AvailabilityManuallyRestored`.
- **Corrections are their own events**, never a flag on the original.
