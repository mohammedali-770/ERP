# Nine-month roadmap

Derived from PRD §9.1, **resequenced for what the estate already provides**.

The PRD's roadmap assumes a greenfield build. Reconnaissance found a live
production backend implementing a meaningful share of F1 behaviour, so some work
is absorption rather than construction — and some work is blocked that the PRD
assumes is available.

---

## What changed from the PRD's sequence, and why

| Change | Reason |
|---|---|
| **Risk spikes pulled to weeks 1–2** | The LAN peer-sync and iOS durability spikes can force the hardware decision immediately. The PRD puts hardware comparison in month 8, where OFF-014 requires evidence anyway — but by then changing course is expensive. |
| **Payments moved behind a gate** | The provider is unselected and frozen (B-01). Month 7 in the PRD assumes payment integration is available. It is not. |
| **Estate absorption added as a workstream** | Not in the PRD at all, because the PRD does not know the estate exists. |
| **Order-integrity machinery pulled forward** | It already exists and works; porting it early de-risks everything downstream. |

---

## Workstreams

The requirement-level decomposition of these is [`f1-backlog.md`](./f1-backlog.md),
which assigns every one of the 164 F1 requirements to an epic and is checked in CI.


Parallel, with dependencies noted. Not phases — several run throughout.

### W1 · Foundation *(months 1–3)*
Organisation model, identity and capabilities, configuration, audit, the event log
and projection framework. **Gates everything else.**
Requirements: PRG-002, IAM-001..010, SEC-001..008.

### W2 · Risk retirement *(weeks 1–8, front-loaded)*
The spikes. Six run today against simulators; two need physical hardware and a
real branch network (B-03).
**Outputs decide ADR-0004**, which the hardware budget depends on.

### W3 · Menu and availability *(months 2–4)*
Head-office menu authority, versioning, effective dating, multi-channel
publication, timed snooze. Substantially an absorption of existing behaviour.
Requirements: MNU-001..016.

### W4 · Order management *(months 3–6)*
Order lifecycle, channels, external references, exception queue, snapshots.
Ports the existing idempotency and ambiguity handling.
Requirements: OMS-001..018.

### W5 · Branch runtime and offline *(months 3–7)*
Local store, outbox, sync protocol, conflict resolution, recovery.
**The highest-risk construction work.** Depends on W2 outputs.
Requirements: OFF-001..014.

### W6 · POS application *(months 4–8)*
Cashier workflows, shifts, cash, blind close, bilingual interface.
**Genuine greenfield** — no estate asset to absorb.
Requirements: POS-001..030.

### W7 · Printing *(months 4–7)*
Durable queue, templates, leases, reprints, barcode readiness.
Depends on W2's print spike and the hardware decision.
Requirements: PRN-001..014.

### W8 · Payments and ZATCA *(months 5–9, **gated**)*
State machine, reconciliation ladder and refund idempotency build against a
simulator from month 5. **Provider integration cannot start until B-01 lifts.**
ZATCA work needs sandbox credentials (B-02).
Requirements: PAY-001..019.

### W9 · Customer app migration *(months 6–9)*
Per-module re-pointing at ERP services. See
[`../estate/sma-absorption.md`](../estate/sma-absorption.md).
Requirements: APP-001..015.

### W10 · Reporting and monitoring *(months 5–9)*
Essential management reporting, branch and integration health, alerting.
Ports existing operations alerting.
Requirements: RPT-001/003/006/008/009, SUP-004..009.

### W11 · Lab, UAT and evidence *(months 1–9, continuous)*
Lab build, test packs, the T-01..T-10 scenarios, UAT, the executive evidence
package. **Evidence accumulates continuously** rather than being assembled in
month 9.
Requirements: LAB-001..005, ACC-001..009.

---

## Milestones

| When | Milestone | Gate |
|---|---|---|
| **End month 2** | **F0 exit** | ADRs accepted; `req-lint --gate f0-exit` green; spikes reported; **hardware decision evidenced** |
| End month 4 | Foundation + menu | One approved menu publishing to a channel |
| End month 6 | Orders + offline core | Branch operates offline and reconciles without duplication |
| End month 7 | Integrated branch | Full order lifecycle, printing, simulated payments |
| End month 8 | Load and failure testing | T-01..T-10 executed; >200 orders/hour sustained (NFR-001) |
| **End month 9** | **F1 lab release** | Cashier and kitchen UAT, defect closure, executive evidence, production-readiness recommendation |

---

## The honest risk to the nine-month milestone

**If B-01 (payment provider) does not lift by roughly month 5, the F1 milestone
will be partial.** ACC-003, T-04 and T-05 cannot be evidenced without a real
provider, and REL-004 defines the milestone as covering POS, menu and order
management *with their essential platform dependencies* — payments among them.

This is not a reason to delay everything else. It is a reason to put the decision
in front of executive management now, with the lead time stated.

---

## After month 9

Controlled hardening and any approved new-branch rollout (REL-005) while F3 and F4
modules are built. Existing-branch migration from 1 January 2028 under the approved
cutover plan (REL-006, ADR-0011).
