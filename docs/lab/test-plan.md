# Acceptance test plan

The PRD's ten minimum acceptance scenarios (§8.2), expanded into executable
specifications. Each states setup, injection, expected result and the evidence
captured.

These are the scenarios referenced by `test_refs` in the requirement catalogue, so
`npm run req:lint -- --gate f0-exit` fails if a scenario stops being referenced.

**Evidence accumulates continuously.** A scenario run produces a machine-readable
result, so the executive evidence package is assembled from real artifacts rather
than written up in month 9.

---

## T-01 · Concurrent order intake

**Covers:** NFR-001, NFR-002, NFR-003, ACC-001, ACC-008, OMS-001, POS-009..012

**Setup.** Lab branch, 3 POS devices, all four intake sources active: cashier,
customer app, call centre, delivery-platform connector.

**Injection.** Sustain **above 200 orders/hour** for a minimum of 4 hours. Include
repeated taps, delayed responses, connection drops mid-submit, and 5% duplicate
webhook delivery from the delivery connector.

**Expected.**
- Zero lost accepted orders. *Accepted* means the `OrderAccepted` event was fsync'd
  locally (`../architecture/core-transaction-design.md` §0).
- Zero duplicate business orders.
- Every exception explainable and in the exception queue with an owner.

**Evidence.** Reconciliation of orders submitted vs. orders at central vs. prints
vs. final states; exception queue export; throughput and latency series.

---

## T-02 · Central internet outage

**Covers:** OFF-001..011, ACC-004, NFR-016

**Setup.** Branch trading normally with active cash orders and kitchen printing.

**Injection.** Disconnect central mid-transaction. Continue trading offline for a
sustained period. Restore connectivity.

**Expected.**
- Branch continues: order entry, local menu, cash, kitchen printing, barcode
  readiness, shift operations (OFF-002).
- Queued events, dashboards and ZATCA documents synchronise **exactly once**,
  without corruption.
- Synchronisation backlog and last-successful-sync visible throughout (OFF-007).

**Evidence.** Event counts before and after; duplicate scan of every aggregate;
backlog drain curve; operator screenshots showing sync state.

---

## T-03 · Printer failure

**Covers:** PRN-002..006, PRN-012, NFR-005, ACC-002

**Setup.** Simultaneous orders across channels, kitchen printer active.

**Injection.** Stop the kitchen printer mid-load. Restore it. Retry and reroute
jobs to the fallback printer.

**Expected.**
- Cashier sees print state without technical access (POS-018).
- No missing production slips; no unidentifiable duplicates.
- Reprints are labelled and carry a reason and user (POS-019).
- Queue survives application and device restart (PRN-004).

**Evidence.** Job ledger with states and attempts; physical slip count vs. job
count; photographs of reprint labelling.

---

## T-04 · Payment uncertainty

**Covers:** PAY-005..009, OMS-011, NFR-004, APP-012, APP-013 · **Blocked by B-01**

**Setup.** Order at payment, terminal or gateway integrated.

**Injection.** Delay or drop the provider response **after** the provider has
processed the charge. Repeat with: app kill mid-transaction, cable pull, ambiguous
response code, signature-invalid response. **Minimum 100 induced ambiguities.**

**Expected.**
- The intent enters `UNKNOWN` and **no retry is attempted**.
- The reconciliation ladder resolves at least 99 of 100 within 60 seconds.
- **Zero double charges. Zero payments attached to the wrong order.**
- The cashier screen blocks and says, in both languages, *do not swipe again*.

**Evidence.** Intent and attempt ledger; provider-side transaction list reconciled
against ours; resolution source recorded per case.

---

## T-05 · Automatic refund

**Covers:** PAY-010, PAY-011, PAY-012, ACC-003 · **Blocked by B-01**

**Setup.** A paid order that fails under a rule eligible for automatic refund.

**Injection.** Trigger the failure. Separately, force a refund call to time out and
be retried.

**Expected.**
- Exactly **one** refund issued, tracked and reconciled.
- Retry is idempotent on the refund identifier — never matched by amount and time.
- Pending, rejected or mismatched outcomes alert finance (PAY-011).

**Evidence.** Refund ledger; provider refund list reconciled; alert delivery record.

---

## T-06 · Timed item unavailability

**Covers:** MNU-002, MNU-003, MNU-004, MNU-012, MNU-013

**Setup.** Item available across POS, customer app, call centre and a delivery
connector.

**Injection.** Branch user marks it unavailable with a return time. Observe all
channels. Wait for the timer. Additionally: snooze the same item concurrently from
two devices while offline, then reconnect.

**Expected.**
- All channels stop offering it promptly; a channel sync failure is reported
  without blocking the others (MNU-013).
- Automatic restore at the selected time, recorded as timer-expiry rather than a
  manual action.
- Concurrent snoozes resolve by the documented rule; **availability never widens
  beyond central** (`../architecture/core-transaction-design.md` §5).

**Evidence.** Per-channel availability timeline; transition audit showing actor and
reason.

---

## T-07 · Kitchen barcode

**Covers:** PRN-007, PRN-008, PRN-009

**Setup.** Order fired, kitchen slip printed.

**Injection.** Scan once. Scan again. Reprint the slip and scan the reprint. Scan a
slip belonging to a different order. Scan with an unauthorised account.

**Expected.**
- The correct order moves to `Ready` **once**.
- Duplicate scan is **harmless and logged**, not an error the kitchen must reason about.
- Wrong-order and unauthorised scans are rejected with a clear message and recorded.

**Evidence.** Order state timeline; scan log with device, user and outcome.

---

## T-08 · Blind cash close across terminals

**Covers:** POS-022..026, ACC-003

**Setup.** One cashier, one shift, trading across all three terminals.

**Injection.** Take cash on each terminal. Close the shift with a blind count.
Separately: attempt to view expected cash before submitting; attempt to close the
same shift from two devices; open a second shift for the same cashier on two
offline devices, then reconnect.

**Expected.**
- One shift reconciles cash from all three devices — responsibility follows the
  cashier, not the device.
- Expected cash is **not reachable** before the count is committed, including from
  the local database.
- Variance computed automatically and routed by tolerance and approval rules.
- Duplicate close: first wins, second is told. Duplicate open: deterministic merge
  with append-only cash reassignment and zero cash lost.

**Evidence.** Shift ledger; cash movement ledger with reassignments; count-commit
hash proving the count preceded the variance.

---

## T-09 · ZATCA deferred synchronisation

**Covers:** PAY-016..019, OFF-011, ACC-005 · **Blocked by B-02**

**Setup.** Three devices as three EGS units, central unreachable.

**Injection.** Issue eligible invoices offline across all three. Restart a device
mid-sequence. Restore one device from a backup taken earlier. Reconnect.
Additionally: request a B2B standard invoice while offline.

**Expected.**
- Documents valid locally; deferred records synchronise successfully.
- Counter chains unbroken and gapless **per unit**; previous-invoice-hash verified end to end.
- **A restored device does not reuse a counter value.**
- The B2B request behaves per the decision in Q-02 — queued or refused, never
  silently issued.

**Evidence.** Per-unit counter and hash chain export; sandbox acceptance responses.

---

## T-10 · Security and permissions

**Covers:** IAM-001..010, SEC-010, SEC-011, POS-015

**Setup.** Accounts for cashier, branch manager, finance, and system administrator.

**Injection.** Attempt sensitive actions from each: post-payment edit, void,
discount beyond limit, refund, price change, permission change, payroll read,
cross-branch data read, audit-log alteration. Attempt administrator actions without
completing multi-factor authentication. Replay a signed webhook.

**Expected.**
- Only permitted actions succeed.
- Denials, approvals and changes are all audited with actor, target, time and outcome.
- Administrator actions require MFA (IAM-002) — the role alone is insufficient.
- A replayed webhook is rejected (SEC-011).
- Audit logs cannot be altered through any application path (SEC-007).

**Evidence.** Attempt matrix with outcomes; audit-log export; failed-attempt records.

---

## Regression

LAB-005 requires repeatable test data and scripts for regression after every
material release. T-01 through T-10 are re-runnable from seed; T-01's harness
(`spikes/offline-sync`) is retained as a **permanent CI load test** rather than a
one-off milestone.
