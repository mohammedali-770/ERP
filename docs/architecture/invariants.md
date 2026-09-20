# Architectural invariants

These are the rules every later design must preserve. If a proposed change
violates one, the change is wrong regardless of how convenient it is.

Each invariant exists because the PRD requires it, and each is enforced
structurally wherever possible rather than by convention — a rule someone has to
remember is a rule that will eventually be forgotten at 2am during an incident.

---

## I-1 — Identity is minted at the edge, before any user feedback

No business object receives a server-assigned identifier. An identifier is
durably persisted (fsync'd) before the interface confirms anything to anyone.

**Because:** a branch must create orders with no central connectivity (OFF-001),
and every order needs an immutable internal identifier (POS-012).

**Enforced by:** UUIDv7 generation at the creating device; the identifier is the
primary key at central. See ADR-0005.

---

## I-2 — Every write is an append to the event log, in the same transaction as the outbox row

There is no code path that mutates business state without producing an event, and
no path that produces an event without durably queueing it for synchronisation.

**Because:** locally created events must enter a durable outbox and synchronise
automatically (OFF-005). The transactional outbox is what eliminates the entire
class of "we took the order but never told anyone" failures.

**Enforced by:** a single local transaction wrapping the business write and the
outbox insert. No publish-after-commit, no fire-and-forget.

---

## I-3 — No financial fact is ever merged

Merge is for replication, not arbitration. Where two devices can produce
contradictory financial facts, the system **detects and raises an incident**. It
does not pick a winner.

**Because:** financial and order events use append-only corrections rather than
destructive overwrites (OFF-009); posted entries are immutable and corrected
through controlled reversal (FIN-007).

**Enforced by:** partial unique indexes at central that fail the second writer,
producing an incident rather than an overwrite. See ADR-0003.

> **Consequence for tooling:** no offline-sync library that performs
> last-writer-wins row merging may be used. LWW on a financial row *is* the
> destructive overwrite the PRD prohibits. The sync layer moves opaque event
> blobs; projections are derived.

---

## I-4 — Ambiguity is a state, not an error

`UNKNOWN` is a first-class state with a mandatory reconciliation path, and it
**blocks retry**.

**Because:** an unknown payment outcome must be reconciled before another charge
is attempted (PAY-007), and an unknown order-creation outcome before an external
create is retried (OMS-011).

**Enforced by:** the payment and external-call state machines. From `UNKNOWN` the
only permitted action is a query. A retry requires a reconciliation result of
"not charged" / "not created".

---

## I-5 — No operational path calls central

Order entry, printing, shift operations and invoice issuance are local. Central is
downstream of everything operational.

**Because:** the branch must remain fully operational when its connection to the
central platform is unavailable (OFF-001, OFF-002), and printing must continue
during a central outage (OFF-010, PRN-013).

**Enforced by:** the branch runtime holds its own store, print queue, menu bundle
and ZATCA counter. Printing during an outage is a consequence of the structure,
not a feature that has to be implemented.

---

## I-6 — State transitions are monotonic

Once a terminal state is reached it is never re-opened. Contradicting later
evidence creates a dispute incident rather than flipping the state.

**Because:** a state machine that can move backwards is a state machine that will
eventually charge someone twice.

---

## I-7 — Snapshots live inside immutable event payloads

Price, tax, recipe version, address and customer details applicable at order time
are embedded in the event, not resolved by lookup at read time.

**Because:** the platform must preserve the snapshots applicable to an order after
master data changes (OMS-016), and historical sales must retain the values that
applied when the order was placed (MNU-015).

**Enforced by:** structure. Immunity to later master-data edits is not a rule
anyone has to remember.

---

## I-8 — Cached balances are verifiable against their ledger

Wallet, loyalty and stock balances are the sum of ledger entries. Where a balance
is materialised for performance, it is stamped with the event it was computed
through, so it can always be checked.

**Because:** wallet and loyalty balances use controlled ledgers and are never
edited by overwriting the balance (PAY-015, CRM-005).

**Enforced by:** an `as_of_event_id` on every materialised balance. A cached
balance that cannot be checked against its source is a balance that will silently
drift.

---

## I-9 — The controller is an optimisation, never a correctness requirement

Everything works with no branch controller present. A controller upgrades three
guarantees from *detect* to *prevent*; it does not enable anything.

**Because:** the preferred deployment avoids dedicated branch hardware (OFF-012),
and the decision is not yet made (OPN-003). See ADR-0004.

---

## I-10 — Event schemas are additive only

Fields are never removed or repurposed. Every event carries a `schema_version`.

**Because:** the log is the system of record. A field whose meaning changed is a
field that silently reinterprets history.
