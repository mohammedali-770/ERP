# Brief to counsel — data residency

**For:** Executive management, to instruct legal counsel
**Unblocks:** B-05 / D-4 — §1 of the data residency gate
**Time needed:** instruct now; a determination may take weeks
**Checked:** 2026-09-21
**Purpose:** get one determination that answers every question the programme needs,
rather than three rounds of partial answers

> **This is a request for a legal determination. It is not legal advice and this
> document does not attempt to give any.** Everything below is a description of
> what the system will hold and where, so counsel can advise on it.

---

## The question in one sentence

**For each category of data the new system will hold, does Saudi law require that
data to be stored inside the Kingdom — and under what conditions may it be stored
or processed outside?**

---

## Why it is asked per category, not once

The system will hold customer data, employee data, payroll, financial records and
tax documents. These may not share the same answer. A determination covering only
"customer data" would leave the programme unable to decide anything.

---

## What the system will hold

| # | Category | Includes | Volume, roughly |
|---|---|---|---|
| 1 | **Customer identity** | Name, mobile number, verification status | One record per customer |
| 2 | **Customer location** | Delivery address, map coordinates, national short address, directions | One or more per customer |
| 3 | **Order history** | Items, times, branches, amounts | Ongoing, per transaction |
| 4 | **Payment metadata** | Card scheme, last four digits, provider reference. **No full card numbers** | Per transaction |
| 5 | **Customer communications** | Notification history, consent preferences, support cases, call recordings | Ongoing |
| 6 | **Employee identity** | Identity documents, contact details, contracts | One per employee |
| 7 | **Payroll** | Salary, allowances, deductions, bank details, end-of-service entitlement | Monthly, per employee |
| 8 | **Attendance** | Clock-in times, **locations**, device used, biometric source | Daily, per employee |
| 9 | **Performance and disciplinary** | Evaluations, disciplinary records | Occasional |
| 10 | **Financial records** | Ledger, invoices, supplier records, settlements | Ongoing |
| 11 | **Tax documents** | Electronic invoices, cryptographic counters and certificates | Per transaction |
| 12 | **Operational telemetry** | System logs, performance metrics, error traces | Continuous |

---

## The current position

*Verified 2026-09-21 against the platform's published region list and recorded in
[`data-residency-gate.md`](../../compliance/data-residency-gate.md).*

The existing systems run on a managed cloud platform. **Live data sits in one
region: `eu-central-1`, Frankfurt.** A second project in Singapore exists but is
paused and holds nothing relevant to this programme, so the live cross-border
footprint is **one region, not two**.

That platform publishes **17 regions, none of them in the Middle East or any Gulf
state.**

**One point matters more than the rest, because it removes an option counsel might
otherwise assume exists.** All 17 of those regions are Amazon Web Services
regions, and **AWS has no live Saudi region** — it was announced in March 2024,
targeted for 2026, and is still undeployed. So moving this platform into the
Kingdom is not a configuration change. It requires two sequential events, neither
committed and neither within our control: AWS launching its Saudi region, and then
the platform adopting it.

Other providers **do** operate live Saudi regions today — Google Cloud (Dammam),
Oracle (Jeddah and Riyadh), Huawei, Alibaba and Tencent (Riyadh) — but the current
platform does not run on any of them. **In-Kingdom hosting therefore means
changing platform, self-hosting, or splitting the data.** That is a real cost, and
it is why the determination below is worth getting right rather than quickly.

So today, categories 1 to 3 are already held outside the Kingdom. The new system
would add categories 6 to 11 unless the hosting arrangement changes.

Development and testing will continue on that platform. **The question is what
production requires**, and that decision has not been taken.

---

## What counsel is asked to determine

**Q1 — Residency.** For each of the twelve categories, does Saudi law require
storage within the Kingdom? Where the answer is conditional, what are the
conditions?

**Q2 — Transfer.** Where storage outside the Kingdom is permitted, what safeguards,
contractual terms, consents or notifications are required?

**Q3 — Processing versus storage.** Is there a distinction between storing data
abroad and merely processing it abroad — for example, a backup held in the Kingdom
but a service that reads it from elsewhere?

**Q4 — Employee monitoring.** Attendance capture records **where** an employee was
when they clocked in (category 8). What notice, consent or basis does that
require, and does it change the residency position?

**Q5 — Call recording.** Customer service calls may be recorded and linked to
customer records (category 5). What notice and retention rules apply?

**Q6 — Retention and deletion.** Where a customer or employee asks for deletion but
the underlying transaction must be retained for statutory periods, what is the
correct treatment? *The system is designed to remove personal details while
preserving the financial record — we would like that confirmed or corrected.*

**Q7 — Cross-brand identity.** The company expects to operate further brands. If
one person orders from two brands, may their identity and history be shared across
them, or must each brand hold a separate record? *(This is also
[Q-07](../open-questions.md) in the programme's open questions — the answer
settles both.)*

**Q8 — Sector-specific rules.** Do payroll, tax or financial records carry any
obligations beyond general data protection law?

---

## What is needed back

A written determination per category — **in the Kingdom required / permitted
outside under conditions / permitted outside** — with the conditions stated where
applicable.

That single table is what the programme needs. Everything else follows from it.

---

## Timing and why it matters now

Nothing depends on this starting; nothing can finish without it. Production
hosting cannot be committed until it is answered, and the cost of moving grows
every week the system makes deeper use of its current platform's features.

**Starting the instruction is itself the useful act.** An answer in three months is
fine. An answer that has not been requested in three months is not.

---

*Background: [ADR-0002](../../adr/ADR-0002-hosting-and-data-residency.md),
[`data-residency-gate.md`](../../compliance/data-residency-gate.md),
[`pdpl-assessment.md`](../../compliance/pdpl-assessment.md).*
