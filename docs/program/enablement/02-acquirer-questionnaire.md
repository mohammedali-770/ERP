# Payment provider capability questionnaire

**For:** Finance, to send to each candidate bank, acquirer or payment provider
**Unblocks:** B-01 / D-1
**Time needed:** an hour to adapt and send; then wait for replies
**Checked:** 2026-09-21
**Purpose:** turn the provider selection from research into a comparison

---

## Why these questions and not others

Most payment provider comparisons focus on fees. Fees matter, but they are easy to
compare and easy to renegotiate.

**The questions below determine something harder to change: how much staff time
every branch spends, every day, for the life of the system.** A provider whose
terminal cannot be asked "what happened to that transaction?" forces a cashier to
check a printed slip by hand every time a card reader times out. That is a
permanent labour cost, and it does not appear on any rate card.

Section A is the part that matters most. If a provider fails A1, that should weigh
more heavily than a difference in commission.

---

## How to use this

Send sections A to E to each candidate. Ask for written answers — not a sales
call. Where an answer is "yes", ask for the technical documentation that proves
it, because "yes" from a sales team and "yes" from an integration guide are
different things.

---

## Section A · Recovering from an uncertain transaction

*This is the section that matters most.*

**A1.** If our system sends a payment to the terminal and then loses the response
— network drop, timeout, the till is switched off mid-transaction — **can we later
ask the terminal what happened to that specific transaction, using our own
reference number?**

**A2.** If yes to A1: what is the **maximum length** of the reference field we can
send, and which characters are permitted?

**A3.** If yes to A1: can the same query be made **while the branch has no internet
connection**, directly to the terminal on the local network?

**A4.** If no to A1: what is the documented procedure for establishing whether a
customer was charged? How long does it take, and does it require a person to
telephone anyone?

**A5.** Can the same transaction reference be safely re-sent without risk of
charging the customer twice? What exactly does the terminal do if it receives a
repeat?

> **Why A3 matters:** branches must keep trading during an internet outage. A
> recovery procedure that needs the internet does not work in the situation it
> exists for.

---

## Section B · Refunds

**B1.** Can we supply our own unique reference on a refund request, so that if the
request is sent twice only one refund is issued?

**B2.** Can refunds be issued automatically by our system, without a person
logging into a portal?

**B3.** Are partial refunds supported, and can several partial refunds be issued
against one original payment?

**B4.** How quickly is a refund reflected in the settlement data we receive?

---

## Section C · Settlement and reconciliation

**C1.** In what format do we receive daily settlement data, and how is it
delivered — file, API, portal download?

**C2.** Does it itemise, per transaction: commission, fees, refunds, chargebacks,
and any amounts withheld?

**C3.** Does each settlement line carry **our** transaction reference, or only
yours? *(If only yours, reconciliation becomes a matching exercise rather than a
lookup.)*

**C4.** How are timing differences handled — a payment taken late on one day and
settled on the next?

---

## Section D · Testing before we commit

**D1.** Is a test environment available before contract signature?

**D2.** In that environment, can we deliberately cause **failures** — timeouts,
dropped responses, mid-transaction disconnection — to prove our recovery works?

**D3.** Are physical test terminals available on loan?

**D4.** What certification is required before going live, and how long does it
typically take?

> **Why D2 matters:** we cannot test failure handling against real customer
> transactions. A test environment that only demonstrates the happy path does not
> let us prove the system is safe.

---

## Section E · Commercial and operational

**E1.** Transaction fees by card type and payment method.

**E2.** Terminal costs — purchase or rental, and per branch.

**E3.** Support hours, response times, and escalation path for a branch that
cannot take payments.

**E4.** Notice period and exit terms, including whether transaction history can be
exported.

---

## Scoring

| | Question | Weight |
|---|---|---|
| **A1** | Query by our reference | **Decisive.** A "no" carries a permanent daily cost in every branch that must be quantified before comparing on price |
| **A3** | Query works offline | **High.** Recovery during an outage is the case that matters |
| **B1** | Refund idempotency | **High.** Without it, a retried refund can pay a customer twice |
| **D2** | Failure testing available | **High.** Without it we cannot prove safety before going live |
| **C3** | Our reference in settlement | Medium. Affects daily reconciliation effort |
| **E** | Commercial terms | Compare **after** the above, not before |

---

## Before sending — one thing to check internally

**Nothing is being replaced. Card payments have never run.**

The live database has a provider configured **in test mode with card payments
switched off**, and **every live order to date has been cash**
([`estate/inventory.md`](../../estate/inventory.md)). Separately, our records
disagree about which provider that even is: the database shows one, the
operations console offers administration for another
([`estate/migration-map.md`](../../estate/migration-map.md)).

That matters for how this conversation goes. There is **no migration risk, no
live transaction history to port and no switching cost** — so the selection can
be made on the questions below rather than on what is least disruptive to
replace. It also means nobody internally has operational experience of the
answers, which is why written documentation is asked for rather than assurances.

**Confirming which provider is actually configured is a ten-minute check and
worth doing first** — it is also [Q-09](../open-questions.md), still open.

---

## Recording the answers

One row per provider, so replies can be compared rather than read in sequence.
**Section A is the part that decides it**, so it is first.

| | Provider 1 | Provider 2 | Provider 3 |
|---|---|---|---|
| Name | | | |
| Date replied | | | |
| **A1 — query by our reference** | Yes / No | | |
| **A3 — query works offline** | Yes / No | | |
| A5 — safe to re-send | Yes / No | | |
| **B1 — refund idempotency** | Yes / No | | |
| **D2 — failure testing available** | Yes / No | | |
| C3 — our reference in settlement | Yes / No | | |
| D4 — certification lead time | | | |
| E1 — headline fees | | | |
| **Documentation supplied, or assurance only?** | | | |

**If A1 is "no" for a provider, what did they say the manual procedure is, and
how long does it take?**

> …

That answer is the permanent daily cost referred to above. It belongs in the
comparison in minutes-per-incident, not as a footnote — and it is the number most
likely to be left out of a fee comparison.

Then record the outcome against B-01 in [`../blocked.md`](../blocked.md).

---

*Background: [ADR-0008](../../adr/ADR-0008-payment-provider-and-terminal.md),
[`blocked.md`](../blocked.md) B-01,
[`executive-decision-pack.md`](../executive-decision-pack.md) D-1.
Section A answers [Q-05](../open-questions.md).*
