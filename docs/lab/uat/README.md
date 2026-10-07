# User acceptance test packs

Scripts that **representative business users** run, not engineers.

`ACC-006` requires cashier and kitchen user-acceptance testing plus documented
training readiness before executive acceptance. These packs are how that is
evidenced.

---

## How these differ from the acceptance scenarios

[`../test-plan.md`](../test-plan.md) holds `T-01`..`T-10` — system-level scenarios
with fault injection, run by the team, proving the platform behaves correctly
when things break.

These packs are the other half: **can a real cashier do their job on this?** A
system can pass every fault-injection test and still be unusable. Risk `R-09`
names exactly that failure — "management approves features but operational users
cannot perform real workflows".

| | Acceptance scenarios | UAT packs |
|---|---|---|
| Run by | The team | Representative users |
| Proves | The system is correct | People can operate it |
| Fails when | An invariant breaks | A person gets stuck or makes an error |

## The packs

Arabic versions of all seventeen are in [`ar/`](./ar/) — see the note at the end of
this file before using them.

| Pack | Who runs it | Covers |
|---|---|---|
| [`cashier`](./cashier.md) | Cashiers | Order entry, payment, shifts, cash, corrections |
| [`kitchen`](./kitchen.md) | Kitchen staff | Slips, barcode readiness, changes and cancellations |
| [`menu`](./menu.md) | Head office, branch managers | Menu authoring, publication, availability snooze |
| [`items`](./items.md) | The item master's owner, a branch worker | Items and units, sign-in, bulk upload — module 1's step 5 (ADR-0024) |
| [`suppliers`](./suppliers.md) | The supplier list's owner, the warehouse manager | Suppliers, what they sell, contact erasure, bulk upload — module 2's step 5 (ADR-0026) |
| [`transfer-prices`](./transfer-prices.md) | Whoever sets transfer prices, the warehouse manager, a branch worker | Prices per pack, from now or set ahead, withdrawal, history — module 3's step 5 (ADR-0027) |
| [`facilities`](./facilities.md) | Whoever keeps the branch list, the warehouse manager, a branch worker | Branches and facilities, each branch's ordering area, closing and reopening, history — module 4's step 5 (ADR-0028) |
| [`stock`](./stock.md) | Whoever keeps the warehouse's stock, the factory manager, a branch worker | Balances, write-offs and adjustments, counts stated late, below zero and its override, reversals, the stock card — module 5's step 5 (ADR-0029) |
| [`notifications`](./notifications.md) | Whoever looks after stock at the warehouse and the factory, the factory manager, the administrator, the accountant | The bell: told on the next click, what a notification says, marking read, opening one at its facility, who is never told, the idle sign-out with the console open — module 6's step 5 (ADR-0030) |
| [`stock-alerts`](./stock-alerts.md) | Whoever looks after the warehouse's stock, the administrator, the factory manager, the accountant, a cashier | What is low, minimums set in a pack and cleared, the bell when stock falls to a minimum, once per drop, the person who moved it told too — module 7's step 5 (ADR-0031) |
| [`purchase-orders`](./purchase-orders.md) | Whoever orders and receives the warehouse's stock, the accountant, the administrator, the factory manager, a cashier | Orders raised from a supplier's packs with their cost shown before sending, approval within a limit before VAT and never of one's own order, receipts into stock and their reversal, closing short and cancelling — module 8's step 5 (ADR-0032) |
| [`customer-app`](./customer-app.md) | Customers, or staff acting as them | Ordering, tracking, history, notifications |
| [`reporting`](./reporting.md) | Finance, operations | Standard reports reconciling to source |
| [`support`](./support.md) | IT, branch managers | Runbooks, alerts, incident handling |
| [`lab-readiness`](./lab-readiness.md) | The team | The lab can actually run the other packs |
| [`release-gate`](./release-gate.md) | Product Owner | Everything required is present before sign-off |
| [`executive-acceptance`](./executive-acceptance.md) | Owner, executives | The eight executive success conditions |

## Rules

**Users run the pack. Engineers watch and say nothing.** The moment an engineer
explains what to do, that step has passed for the wrong reason.

**Record where people hesitate, not only where they fail.** A cashier who pauses
for four seconds looking for the void button has found something real. Hesitation
is the earliest signal of a workflow that will cause errors under pressure.

**Run at realistic pace.** A cashier taking one order calmly proves little. Three
queued customers and a ringing phone is the condition that matters.

**A pack is not passed until the named user signs it.** Not the team's opinion of
whether they could do it.

---

## Before these are used

> **Arabic versions exist as of 2026-09-21: [`ar/`](./ar/), all nine packs; `items` and `suppliers` added 2026-10-04, `transfer-prices` and `facilities` 2026-10-05, `stock` and `notifications` 2026-10-06, `stock-alerts` 2026-10-07.**
>
> `PRG-014` requires user-facing material in both languages. The English packs
> here remain the source of truth — they are updated first and the Arabic
> follows.
>
> **The translation has not yet been reviewed by an Arabic speaker who does the
> job**, and that review is still required before a pack is handed to a
> participant. It was produced against the terminology already in
> `docs/requirements/requirements.yaml`, which carries all 387 requirements in
> both languages, so the terms are consistent with the requirement data rather
> than invented — but consistent is not the same as correct in a branch.
>
> A cashier reading formal Arabic nobody uses on the floor is being tested on
> the translation, not on the system. That is the same failure as running the
> pack in English, which is why the review gate stays until someone who works a
> till has read it.
>
> Recorded rather than quietly ignored.
