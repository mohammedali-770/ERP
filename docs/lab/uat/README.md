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

| Pack | Who runs it | Covers |
|---|---|---|
| [`cashier`](./cashier.md) | Cashiers | Order entry, payment, shifts, cash, corrections |
| [`kitchen`](./kitchen.md) | Kitchen staff | Slips, barcode readiness, changes and cancellations |
| [`menu`](./menu.md) | Head office, branch managers | Menu authoring, publication, availability snooze |
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

> **These are written in English. The people who will run the cashier and kitchen
> packs work in Arabic.**
>
> `PRG-014` requires user-facing material in both languages. These packs are
> structured as engineering artifacts here; **the versions actually handed to
> cashiers and kitchen staff must be translated before use**, and the translation
> should be checked by someone who does the job rather than only by a translator.
>
> Recorded rather than quietly ignored. Running a UAT in a participant's second
> language measures their English, not the system.
