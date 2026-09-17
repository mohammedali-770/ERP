# Executive decision pack

**For:** Owner and executive management
**From:** Product Owner
**Date:** 17 September 2026
**Status:** Awaiting decisions

---

## The one page

Four decisions determine whether the nine-month lab milestone (REL-004) arrives
complete. **None of them is an engineering question.** Each has a recommendation
below; what is needed is confirmation or correction.

| | Decision | Who decides | By when | If it slips |
|---|---|---|---|---|
| **D-1** | **Payment provider and terminal integration** | Owner / executive | **Month 5** | 16 requirements and 3 acceptance gates cannot be evidenced. The milestone is partial. |
| **D-2** | **Commit to an append-only event log** | Product Owner | **Month 1** | Every write path is rebuilt later. A half-committed answer is worse than either choice. |
| **D-3** | **Branch hardware standard** | Executive, on lab evidence | **Month 2** | Hardware budget stays unknown. Deciding it in month 8, where the plan currently puts it, means changing course after the build assumes an answer. |
| **D-4** | **Production hosting and data residency** | Executive, on legal determination | Before production | Not urgent for the lab. Gets more expensive every week the platform surface grows. |

**D-3 is not blocked on a decision. It is blocked on a request.** Somebody needs
to give the team access to a real branch network for half a day. Until then the
hardware standard cannot be evidenced, and OFF-014 forbids approving hardware
without that evidence.

### The shortest path

If only one thing happens this week, make it **D-1**. It has the longest lead
time, and unlike the others it cannot be compressed later by working harder.

---

## Where the programme actually stands

Phase F0 is substantially complete. The requirement baseline (387 requirements),
architecture, decision records, estate map, compliance gates, lab design and
risk-proving harnesses are all written, and continuous integration is green.

The F0 exit checklist has **17 open items** once this document closes the first of
them. **One is engineering's to close by writing something.**

| Kind | Count |
|---|---|
| Needs an executive or owner decision | 4 |
| Needs someone assigned to a small task | 7 |
| Needs access or physical work | 3 |
| Needs an external party | 2 |
| Engineering's to close | 1 |

The programme is waiting on people, not on code. That is the situation this
document exists to change.

---

## D-1 · Payment provider and terminal integration

> **The question.** Which payment provider and terminal integration will the ERP
> use, and can its terminal be *asked* what happened to a transaction?

**Status:** No provider selected. A freeze is in force covering payment
initiation, verification, webhooks, provider configuration, refund logic and
financial reconciliation. The existing system carries three provisional
integrations, none live: one configured in test mode and disabled, one built but
inert with its migration unapplied, one historical. Automatic refund processing is
deliberately switched off.

### What it blocks

- **16 F1 requirements**: `PAY-001` to `PAY-012` and `PAY-016` to `PAY-019`
- **`ACC-003`** — executive acceptance requires accurate payments, refunds, cash
  shifts and blind closing
- **`T-04`** (payment uncertainty) and **`T-05`** (automatic refund) — 2 of the 10
  minimum acceptance scenarios
- The payment terminal spike, which needs the real acquirer and terminal; inducing
  timeouts against production is not an option

### The question that matters most

Beneath "which provider" sits one technical question that will set the operating
cost of every branch for years:

> **Does the terminal protocol let us query a transaction by our own reference,
> and is the reference field wide enough to carry it?**

The architecture's guarantee that no customer is ever charged twice rests on being
able to **ask** the terminal what happened rather than retrying and hoping. If the
answer is yes, reconciliation is automatic and costs nothing per transaction.

If the answer is no, the fallback is a cashier confirming against the printed slip
on every ambiguous transaction. That works — but it is a **recurring labour cost
in every branch, every day, forever**, and it must be priced into the selection
rather than discovered after a contract is signed.

### Recommendation

1. **Put this to a decision within four weeks.** The selection itself will take
   time; integration and certification take longer.
2. **Make query-by-reference a selection criterion, not a discovery.** Ask every
   candidate acquirer directly, in writing, before shortlisting.
3. **Price the human-attestation fallback** for any candidate that cannot support
   it, at realistic branch volumes.
4. **Confirm what is actually configured today** before anything else — the live
   database and the operations console currently disagree about which provider is
   in use. This is a ten-minute check that nobody has been asked to do.

### What proceeds regardless

The payment state machine, the intent-attempt-outcome model, refund idempotency
and the reconciliation ladder are all designed and can be built and tested against
a simulator. The provider is a replaceable adapter. **When the decision lands, the
work is integration, not design.** That is deliberate, and it is what keeps this
blocker from stopping everything else.

**Reference:** `docs/adr/ADR-0008` · `docs/program/blocked.md` B-01 ·
`docs/program/open-questions.md` Q-05, Q-09

---

## D-2 · Commit to an append-only event log

> **The question.** Is the system of record an append-only log of events, with all
> queryable state derived from it — yes or no?

**Status:** Proposed, undecided. This is the one architectural decision that
cannot be deferred past month one.

### Why it cannot wait

The requirement document forbids destructive change to business facts in five
separate places — posted entries immutable and corrected by reversal (`FIN-007`),
financial corrections append-only during conflict resolution (`OFF-009`), posted
transactions never physically deleted (`POS-028`), wallet and loyalty balances as
ledgers rather than overwritten numbers (`PAY-015`, `CRM-005`).

Those are not five features. They are one architectural property stated five
times, and an append-only log is how it is satisfied structurally rather than by
asking everyone to remember a rule.

**The reason for the deadline is not the cost of choosing — it is the cost of
choosing halfway.** A system where some records are event-sourced and some are
not has the query awkwardness of one approach and the integrity guarantees of
neither, and the boundary between them becomes a permanent source of defects.
Reversing the decision later means rewriting every write path in the system.

### What it costs

Every read goes through a derived view. Developers must think in events, which is
a real learning curve. Storage grows monotonically, so retention is design work
rather than an afterthought.

### Recommendation

**Accept.** The programme's single Critical risk is duplicate or conflicting
financial records under offline synchronisation, and this is the architecture that
addresses it directly — the risk harnesses built during F0 demonstrate the
mechanism working under fault injection.

If the learning curve is judged too steep, the honest alternative is conventional
storage with explicit audit tables and a **written acceptance** that `OFF-009` and
`FIN-007` are enforced by convention rather than by structure. That is a worse
system, but a coherent one. What must not happen is drifting into a half-answer.

**Reference:** `docs/adr/ADR-0003`

---

## D-3 · Branch hardware standard

> **The question.** iPads alone, Windows terminals at each till, or iPads with a
> small branch controller?

**Status:** Undecided by design. The requirement document's preferred outcome is
no extra branch hardware (`OFF-012`), with Windows or a controller as approved
fallbacks (`OFF-013`). `OFF-014` forbids approving any hardware model before
printing, offline, recovery and load tests pass in the lab.

### This is blocked on a request, not a decision

Two measurements settle it, and **both can be taken in a single week**:

1. **Does branch Wi-Fi permit devices to talk to each other?** Many managed
   networks block this by default. If it cannot be changed across the estate,
   iPads cannot coordinate and a controller becomes mandatory.
2. **Does iOS keep the application running well enough** to serve a full trading
   day and drive printers?

The first is a network configuration check — **half a day of somebody's time**,
not an engineering project. It is the cheapest decisive test in the programme and
it can change the hardware budget.

**What is needed to start: two laptops and half an hour at one branch.** The
decisive question — does the access point let devices reach each other — needs
none of the till software, and is written up for IT as
[`enablement/01-network-capability-check.md`](./enablement/01-network-capability-check.md).
The fuller device-level test does need the application and comes later. Nobody has
been asked for either.

### Why the timing matters

The current plan places the hardware comparison in month 8. By then the build has
assumed an answer. Taking the measurement in week 2 converts a late, expensive
surprise into an early, cheap fact — and if the answer is "controller required",
the budget conversation happens while there is still time to have it.

### One thing worth knowing

The synchronisation design works identically in all three options — a controller
is an optimisation, never a correctness requirement. **What genuinely needs a
controller is printing, peripherals and unattended operation**, not
synchronisation. Anyone arguing the controller on synchronisation grounds has
misread the design; anyone arguing against it on cost grounds should look at the
printing criteria first.

### Recommendation

Approve the branch-network access request this week. Decide the standard in month
2 on the evidence, not before and not in month 8.

**Reference:** `docs/adr/ADR-0004` · `docs/lab/hardware-decision-matrix.md` ·
`docs/program/blocked.md` B-03

---

## D-4 · Production hosting and data residency

> **The question.** Does Saudi law require the ERP's data to be held inside the
> Kingdom — and if so, which categories?

**Status:** Undetermined. Not blocking lab work. **Absolutely blocking
production.**

### The situation, plainly

The existing systems run outside the Kingdom, on a platform that offers no Saudi
region. Today that means customer names, mobile numbers and delivery addresses are
held abroad. The ERP will additionally hold employee records, payroll, financial
records and tax documents.

The lab will run on the same platform, which is the right call for the lab. **It
confers no presumption about production**, and this document exists partly to make
sure that presumption is never quietly made.

### What the decision needs

1. **A qualified legal determination, per data category.** Customer data, employee
   data, payroll, financial records and tax documents may not have the same
   answer. A determination covering only "customer data" does not close this.
2. **Tiered costed options** (`PRG-010`) — stay as-is, in-Kingdom hosting, or a
   split where regulated categories move and the rest does not.
3. **An honest migration estimate**, which is the number most likely to be
   understated. Moving the data is a day's work. Moving the scheduling, secrets
   handling and permission model that the platform provides is not.

### Recommendation

Commission the legal determination now — it has a lead time and nothing else
depends on it starting. Treat the costed options as a month 3–4 deliverable.

**Do not let this be decided by inertia.** The exposure grows quietly every week
the system uses more of the platform's own features, and that trend is itself
something executives should see rather than discover.

**Reference:** `docs/adr/ADR-0002` · `docs/compliance/data-residency-gate.md` ·
`docs/program/blocked.md` B-05

---

## Decisions that are yours but not urgent

| Decision | Needs first | Reference |
|---|---|---|
| **Recovery targets** — how much data loss and downtime is acceptable, and at what cost | Costed tiers. **No recommendation is possible until these exist**, and manufacturing one would be dishonest | ADR-0009, `PRG-012` |
| **Historical data migration scope** | A data audit. Recommended default is opening balances only, with history left in the source system as a read-only archive | ADR-0011 |
| **Whether to feed Lazywait data into the ERP before cutover** | A reporting requirement. Recommendation: **do not**, unless executives genuinely need a single view before 2028 | ADR-0010 |

---

## Six small decisions for Finance and Operations

Each of these is cheap to settle now and expensive to change after go-live. Each
has a recommended answer — the ask is **confirm or correct**, not research.

| | Question | Recommended | Why it matters later |
|---|---|---|---|
| **Q-01** | Are receipt numbers sequential per till, or gapless per branch? | **Per till** | Gapless per branch needs a branch server and rules out the iPad-only option. The tax authority's own gapless requirement is met separately, so this is a finance preference, not a compliance constraint |
| **Q-02** | A business customer wants a tax invoice during an internet outage. What happens? | **Refuse with a clear message** | Business invoices need clearance *before* issue and cannot be produced offline. Consumer invoices can. Somebody must decide what the cashier says |
| **Q-03** | Two tills edit one order during an outage. Does a cancellation win over an addition? | **Cancellation wins** | Biases toward under-charging rather than charging customers for items they cancelled |
| **Q-04** | Network printers or Bluetooth? | **Network** | Bluetooth pairs to one device, so a print job cannot move to another till when one sleeps. Cheap now; an estate-wide swap later |
| **Q-06** | Does a sale at 01:00 belong to yesterday's trading day? | **Yes — the day is set when the shift opens** | Deriving it from midnight splits a night's trading across two days in every report |
| **Q-11** | Is whole-order kitchen readiness acceptable, or is per-station needed? | **Whole-order for the first release** | Multi-station kitchens get no partial visibility. Confirm this is acceptable before user testing, not during |

**Reference:** `docs/program/open-questions.md`

---

## Not decisions — things that need an owner

The largest single category of blocked work is not waiting for judgement. It is
waiting for somebody to be named.

Each of the first five has been written up as a short document the named person
can act on **without engineering present** — see
[`enablement/`](./enablement/README.md).

| Task | Plausible owner | Unblocks | Effort | Ready |
|---|---|---|---|---|
| Check whether branch Wi-Fi lets devices talk to each other | IT | **D-3, the hardware standard** | **30 min, two laptops** | [✓](./enablement/01-network-capability-check.md) |
| Ask candidate payment providers the questions that matter | Finance | D-1 becomes a comparison | Send and wait | [✓](./enablement/02-acquirer-questionnaire.md) |
| Instruct counsel on data residency | Executive | D-4 | Weeks of lead time | [✓](./enablement/03-counsel-brief-data-residency.md) |
| Request tax-authority sandbox access | Finance | `ACC-005`, `T-09` | Days | [✓](./enablement/04-zatca-sandbox-request.md) |
| Gather hosting and recovery quotes | Whoever owns infrastructure | `PRG-010`, `PRG-012` | Ongoing | [✓](./enablement/05-cost-comparison-template.md) |
| Confirm which payment provider is actually configured today | IT / Finance | Clean start on D-1 | Ten minutes | |
| Identify the warehouse system's database | IT | Scoping the factory and warehouse phase | Minutes, once asked | |
| Appoint a process owner per business domain | Executive | Requirement sign-off, user testing | An email | |
| Name representative cashier and kitchen users for testing | Operations | `ACC-006` | An email | |
| Confirm requirement ownership | Domain owners | The F0 exit gate | An hour each | |

**Ten tasks. Most take under a day, and five already have the paperwork written.
Together they unblock more than any engineering effort available this month.**

---

## The decision calendar

The requirement document sets the milestone as nine months from approved kickoff
(`REL-004`) but fixes no kickoff date, so deadlines below are **months from
kickoff**. Calendar dates are shown only as an illustration, assuming kickoff at
this document's date.

| Month | What must be true | Illustrative date |
|---|---|---|
| **1** | D-2 decided. Branch network access granted. | Oct 2026 |
| **2** | D-3 evidenced and decided. F0 exit gate passed. | Nov 2026 |
| **3–4** | Costed hosting and recovery options prepared. | Dec–Jan |
| **5** | **D-1 decided.** Below this point, payment integration and certification cannot finish inside the window. | Feb 2027 |
| **6** | Branch operates offline and reconciles without duplication. | Mar 2027 |
| **8** | Load and failure testing complete, above 200 orders per hour. | May 2027 |
| **9** | **Lab milestone.** User testing, defect closure, evidence package, production-readiness recommendation. | Jun 2027 |
| — | Production use follows executive approval only (`REL-001`, `REL-003`). Existing branches stay on the current system to 31 December 2027. | |

---

## If nothing is decided

This is worth stating plainly rather than leaving to be discovered.

The nine-month milestone would arrive with **POS, menu and order management
working and demonstrable** — genuinely useful, and the bulk of the technical risk
retired. It would also arrive with:

- **Payments unevidenced.** `ACC-003` cannot be signed off. `T-04` and `T-05`
  cannot be run.
- **Tax invoicing unevidenced.** `ACC-005` and `T-09` need sandbox credentials
  nobody has requested.
- **No approved hardware standard**, because `OFF-014` forbids approving one
  without lab evidence that requires branch-network access.

That is a **partial milestone**. It would not be a failure of the build, and it
would not be recoverable by working harder in month eight — each of those gaps
traces to a decision or a request with a lead time attached.

The purpose of this document is to make that outcome avoidable while it still
easily is.

---

## Decision record

| | Decision | Outcome | Decided by | Date |
|---|---|---|---|---|
| D-1 | Payment provider and terminal integration | | | |
| D-2 | Append-only event log | | | |
| D-3 | Branch hardware standard | | | |
| D-4 | Production hosting and data residency | | | |

| Small decisions | Confirmed as recommended? | Corrections | Date |
|---|---|---|---|
| Q-01, Q-02, Q-03, Q-04, Q-06, Q-11 | | | |

Once recorded here, each decision is written into its decision record in
`docs/adr/` and its status changed from Proposed to Accepted. Continuous
integration verifies that every open decision in the requirement document remains
mapped to a record, so nothing can be quietly dropped.
