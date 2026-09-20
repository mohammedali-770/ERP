# Open questions

Decisions the PRD does not settle, surfaced during F0. Each is **cheap now and
expensive later**, which is why they are recorded rather than left to be discovered
during implementation.

These extend the PRD's own twelve open decisions (OPN-001..012), which are tracked
in [`../adr/README.md`](../adr/README.md).

Format: question · who decides · when it gets expensive.

---

## Q-01 — Are receipt numbers per-device or branch-gapless?

**Decides:** Finance · **Expensive after:** first production branch

The design mints human-readable order numbers as per-device sequences, so three
iPads never collide without coordinating. A **gapless per-branch** sequence needs
a branch coordinator and is incompatible with pure iPad-only offline operation.

ZATCA's own gapless requirement is satisfied separately by the per-EGS invoice
counter (ADR-0006), so **this is a finance preference, not a compliance
constraint** — but changing it after branches are live means renumbering history.

---

## Q-02 — What happens when a B2B customer wants a tax invoice during an outage?

**Decides:** Finance and Product Owner · **Expensive after:** F1 UAT

Standard B2B invoices require ZATCA clearance *before* issuance, so they cannot be
issued offline. Simplified B2C invoices report within 24 hours and are fine.

The PRD (PAY-016, PAY-017) reads as though all document types behave alike. They do
not. Someone must decide whether an offline B2B request queues or is refused, and
what the cashier is told to say. This is a customer-facing policy, not an
engineering detail.

Related: ADR-0006, B-02.

---

## Q-03 — Does "void" win over "add" on concurrent order edits?

**Decides:** Operations and Finance · **Expensive after:** F1 build

When two devices edit one order during a partition, the merge rule decides the
bias. **"Void wins" means under-charging rather than charging customers for items
they cancelled.**

Defensible, and the recommended default — but it is a business policy that should
be signed off, not absorbed as an implementation accident.

---

## Q-04 — LAN printers, not Bluetooth?

**Decides:** IT and Operations · **Expensive after:** hardware procurement

A LAN thermal printer is reachable from all three iPads, which is the precondition
for print-job failover between devices. **Bluetooth pairing is effectively
one-to-one and eliminates failover entirely.**

Cheap to decide now. An estate-wide swap later.

---

## Q-05 — Does the acquirer's terminal support query-by-reference?

**Decides:** Finance, during provider selection · **Expensive after:** provider contract

The single most important question in payment provider selection. See B-01 and
ADR-0008. If the answer is no, the operational cost of human attestation must be
priced into the business case before signing, not discovered afterwards.

---

## Q-06 — Is `business_date` set at shift open?

**Decides:** Finance · **Expensive after:** first month-end close

A branch closing at 02:00 books those sales to the prior business day. Deriving
the business date from calendar midnight is a classic mistake, and unwinding it
means reinterpreting stored history.

The design assumes shift-open. Confirm it.

---

## Q-07 — Is one person one customer across brands?

**Decides:** Product Owner, with privacy advice · **Expensive after:** second brand launch

PRG-004 requires per-domain cross-brand sharing rules, and OPN-009 defers them. The
customer-identity question is the sharpest one, because it determines whether a
person's order history and personal data cross a brand boundary — a privacy
question under Saudi personal-data requirements, not only a product one.

Related: ADR-0012.

---

## Q-08 — Where is the warehouse system's database?

**Decides:** IT · **Expensive after:** F3 planning starts

See B-04. A question, not a project — but F3 cannot be scoped without it.

---

## Q-09 — What is the actual payment provider state today?

**Decides:** IT and Finance · **Expensive after:** any payment planning

Reconnaissance found one provider configured in the live database in test mode and
disabled, while the operations console ships administration for a different
provider. **Nothing should be planned on top of that ambiguity.** Confirm which is
real before B-01 is even discussed.

---

## Q-10 — Should the paused Supabase projects be archived?

**Decides:** IT · **Expensive after:** never, but they accumulate risk

Three paused projects and several superseded repositories. Confirm abandonment,
export and checksum the data (ADR-0011 principle 2), then archive — so nobody
reads the wrong system a year from now.

Separately: four backup tables in the WhatsApp inbox project have row-level
security disabled. **Corrected 2026-09-20 — this entry understated it twice.**
They are anon-**writable**, not merely readable: `anon` holds insert, update and
delete as well as select. And dropping them is **not** the cheap remedy — a
read-only survey found they are not redundant copies. `inbox_bible_backup_v3`
differs from live in 6 of 12 rows and `inbox_faq_backup_20260913` in 9 of 23, so
they are the only surviving record of what the AI knew and what customers were
told before 13 September. Now tracked as **B-08**, with what to capture first in
[`../estate/inbox-absorption.md`](../estate/inbox-absorption.md).

**Not acted on** — that project is outside this repository's scope, and any
change there is an owner-approved action.

---

## Q-11 — Is whole-order kitchen readiness acceptable for the branches in scope?

**Decides:** Operations · **Expensive after:** F1 UAT

PRN-009 fixes whole-order readiness for the first workflow and defers station-level
readiness (OPN-010). Multi-station kitchens get no partial visibility in F1.
Operations should confirm that is acceptable **before** UAT rather than during it.

Related: ADR-0007.

---

## Q-13 — Who owns the WhatsApp channel: Yeastar, or the existing inbox?

**Decides:** Product Owner · **Expensive after:** either system is wired to customers

The Yeastar PBX ships its own omnichannel messaging — WhatsApp channels, message
sessions, campaigns, templates. The estate **already runs a separate WhatsApp
inbox** with its own knowledge base, FAQ and guardrails.

Two systems can both claim that channel, and a WhatsApp number can only be
connected to one Business API endpoint at a time. Left undecided, this is
discovered as a collision when somebody tries to connect the second one.

Worth noting the existing inbox is the more capable product for customer service;
the PBX's messaging is more useful if the goal is one agent workspace handling
calls and messages together. That is a product decision, not a technical one.

Related: ADR-0013, ADR-0016.

---

## Q-14 — Is the call identifier stored on orders?

**Decides:** Product Owner · **Expensive after:** the first call-centre order

`CC-007` requires reporting **order conversion** — what share of calls became
orders. That needs the call identifier stored **on the order at the moment it is
created**.

It cannot be reconstructed afterwards. A call and an order that happened at
roughly the same time are not evidence that one caused the other, and no amount of
later analysis recovers the link.

This is the same class as `business_date` (Q-06) and the payment reference
derivation: a single field, free to add now, impossible to backfill. The decision
is simply whether to add it — and the answer should almost certainly be yes, even
if conversion reporting is never built, because the cost of being wrong is
asymmetric.

Related: `CC-007`, ADR-0016.

---

## Q-15 — May a human weigh a customer rating in an employee's evaluation?

**Decides:** HR, with the Product Owner · **Expensive after:** the first rating is collected

`RTG-P11` forbids ratings from **automatically** causing any pay, disciplinary,
scheduling or allocation consequence. It deliberately does not answer the next
question: whether a manager may consider them when writing the `HR-014`
evaluation.

That is HR's answer to give, not engineering's. It changes what must be built:

- **If no** — ratings stay a coaching surface, and the employee view is the whole
  feature.
- **If yes** — a rating becomes part of an employment record, and everything that
  implies follows: retention, disclosure to the employee before it is used, the
  challenge process in `RTG-P10` becoming a formal right rather than a courtesy,
  and almost certainly a Saudi labour-law review.

The same owner sets two values that look like configuration and are policy:

| Value | Why it is not an engineering choice |
|---|---|
| Minimum ratings before a score exists (`RTG-P04`) | It decides who is visible at all. `spikes/rating-statistics/` shows 30 works at a 25% response rate; the business decides what it is willing to act on |
| Window for accepting a rating (`RTG-P02`) | Longer collects more and measures memory rather than service |

**Collecting the data first and deciding afterwards is the failure mode.** Once
ratings exist, the pull toward using them for evaluation is strong and the
decision gets made by whoever builds the report.

Related: `RTG-P10`, `RTG-P11`, `HR-014`, ADR-0017.

---

## Q-16 — Does the ERP get its own Supabase project now, and at what cost?

**Decides:** Owner · **Expensive after:** the first migration is written

ADR-0002 already decides the lab platform, and B-05 blocks production only — so
an ERP lab project is authorised. It does not exist, because the account is at
the free-tier ceiling: **two active projects per account across every
organisation it owns**, currently `spicy-meal-ordering` and
`whatsapp-inbox-simple`. A separate organisation does not avoid this; the cap
follows the account, not the organisation.

Deferred on 2026-09-20, deliberately rather than by oversight. **An empty project
would buy a name and nothing else:** `supabase/` carries no migrations because
ADR-0003 is still Proposed, so there is nothing to put in it until that is
decided. Deciding ADR-0003 and provisioning the project belong in the same week.

| Option | Cost |
|---|---|
| Upgrade the organisation to a paid plan | A recurring charge, and the project exists the same day |
| Wait for ADR-0003 | Nothing, and nothing is lost — there is no schema to hold |
| Pause an existing project to free a slot | **Do not.** `whatsapp-inbox-simple` runs the live AI customer-service inbox, and `spicy-meal-ordering` is production. Freeing a slot this way stops a working service to save a subscription |
| Reuse `whatsapp-inbox-simple` as the ERP's database | **Investigated 2026-09-20 and recommended against** — ADR-0018. Not a cost question in the end: every new table in `public` is born writable by the anon key, `pg_trgm` in `public` ties the inbox's answer matching to a schema the ERP must avoid, and one instance means one connection pool and one migration ledger that cannot be repaired |

That last row is written down because the error message a future session will see
says "delete, pause or upgrade", and pausing looks like the free option.

Related: ADR-0002, ADR-0003, B-05, `../lab/lab-design.md`.

---

## Q-12 — Who owns each requirement, really?

**Decides:** Product Owner · **Expensive after:** F0 exit gate

`docs/requirements/annotations.yaml` carries a **seeded** initial assignment of
owners and acceptance tests for all 160 F1/P0 requirements, derived from the PRD's
role table. It satisfies the gate mechanically.

It has not been confirmed by the named owners. Module-level test fallbacks in
particular are a starting point, not a coverage claim. **Confirming these is F0
exit work**, and `npm run req:lint -- --gate f0-exit` is what holds the line.
