# Ledger primitives

Finance, wallet, loyalty and stock all need the same thing: a balance that is the
sum of an immutable history, never an overwritten number.

The PRD requires this in four separate places — FIN-007, PAY-015, CRM-005,
INV-006/007. **It is one pattern, implemented once.**

---

## The pattern

```
ledger_entry(
  entry_id        uuid PRIMARY KEY,
  ledger_type     text NOT NULL,     -- gl | wallet | loyalty | stock
  account_ref     text NOT NULL,     -- account, customer, item+location
  direction       text NOT NULL,     -- debit | credit  (in | out for stock)
  amount          numeric NOT NULL CHECK (amount > 0),
  unit            text NOT NULL,     -- currency code, points, or stock unit
  source_event_id uuid NOT NULL,     -- the event that caused this
  reverses_entry  uuid,              -- set only on a reversal
  posted_at       timestamptz NOT NULL,
  business_date   date NOT NULL,
  dimensions      jsonb NOT NULL     -- company, brand, branch, channel, cost centre, ...
)
```

**Rules, all four of which are load-bearing:**

1. **Entries are never updated or deleted.** Enforced by revoked grants and a
   trigger, as with the event log (ADR-0003).
2. **Corrections are new entries.** A reversal references the entry it reverses.
   Nothing is edited into correctness.
3. **`amount` is always positive**; `direction` carries the sign. This eliminates an
   entire class of sign-error bugs, and makes "sum of debits" and "sum of credits"
   independently checkable.
4. **Every entry names the event that caused it.** An entry with no cause is
   unexplainable, and an unexplainable financial entry is an audit finding.

---

## Balances

```sql
-- Authoritative: always correct, never cached.
SELECT SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END)
FROM ledger_entry WHERE ledger_type = $1 AND account_ref = $2;
```

Where performance demands a materialised balance, it carries the event it was
computed through:

```
balance_cache(ledger_type, account_ref, balance, as_of_event_id, computed_at)
```

**A cached balance that cannot be checked against its source is a balance that will
silently drift** (I-8). `as_of_event_id` makes verification a query, not an
investigation.

---

## Per-ledger specifics

### General ledger (FIN-001..020)

- Dimensions carry company, brand, branch, sales channel, department or cost centre,
  product, factory, warehouse (FIN-005) — so profitability by any dimension
  (FIN-006) is a grouping, not a rebuild.
- Posted entries immutable; corrections are reversal plus re-post (FIN-007).
- Period locks prevent posting to a closed period; controlled reopening is an
  audited action (FIN-016).
- Every report drills from summary to source transaction (FIN-020) — which works
  because `source_event_id` is always present.

### Customer wallet and store credit (PAY-015)

- Accrual, redemption, expiry, reversal, manual adjustment are all entries.
- Manual adjustment requires role authorisation and a reason (CRM-006).
- **The balance is never set.** There is no code path that writes a balance.

### Loyalty (CRM-005)

- Same structure; `unit` is points.
- Expiry is a scheduled entry, not a deletion of old entries — so the history of
  why a balance fell remains legible.
- Multipliers and campaigns affect the *accrual* entry's amount, never the existing
  balance.

### Stock (INV-006, INV-007)

- `direction` is in or out; `account_ref` is item plus location; `unit` is the stock
  unit.
- Every movement records source document, user, date, quantity, unit, location,
  batch and approval state (INV-007).
- Batch and expiry travel on the entry, enabling forward and backward traceability
  (MFG-008).
- Negative stock is prevented, or explicitly permitted by policy (INV-008) — a
  check at posting time, not a correction afterwards.

---

## Why one pattern rather than four

Four ledgers implemented separately means four places to get immutability wrong,
four reconciliation tools, four audit stories. The domains differ in what they
count; they do not differ in how counting works.

The one real divergence is stock's unit conversion (INV-005), which lives above the
ledger: entries are always in the item's stock unit, and conversion happens at the
boundary. An ambiguous conversion is rejected there rather than being stored as an
ambiguous entry.
