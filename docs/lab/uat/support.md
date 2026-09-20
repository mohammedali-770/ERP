# UAT — Support and operations

**Run by:** IT, plus a branch manager
**Duration:** about three hours
**Requires:** the lab's fault injection

Covers `SUP-004`..`SUP-009`.

> Tests whether someone can **diagnose and recover** from the failures that will
> actually happen — using the runbooks, not by asking the person who built it.

---

## Part 1 · Do the runbooks work?

Each: inject the fault, hand the runbook to the participant, watch.

| # | Fault | Passes when |
|---|---|---|
| 1.1 | Branch internet lost | Participant confirms the branch keeps trading, and knows what will catch up later |
| 1.2 | Kitchen printer fails | Diagnosed and recovered; no lost or duplicated slips |
| 1.3 | A till dies mid-shift | Work continues; that till's state is recoverable |
| 1.4 | Payment outcome unclear | Correct resolution followed — **and the participant does not retry the card** |
| 1.5 | Sync backlog builds | Participant can see it and knows whether to act |
| 1.6 | Tax document queue stalls | Visible; escalation path clear |

> **1.4 again.** It appears in the cashier pack and here because the failure mode
> — "just try it again" — is the instinct of both roles and costs a customer a
> double charge.

## Part 2 · Alerts

| # | Task | Passes when |
|---|---|---|
| 2.1 | Trigger a printer failure alert | Reaches the right person, promptly |
| 2.2 | Trigger the same fault repeatedly | **Does not flood.** Deduplicated |
| 2.3 | Read an alert without system access | Enough to act on |
| 2.4 | Check an alert for customer data | **Contains none** |
| 2.5 | Leave a high-severity alert unacknowledged | Escalates |

## Part 3 · Health

| # | Task | Passes when |
|---|---|---|
| 3.1 | Is a given branch healthy right now? | Answerable in under a minute |
| 3.2 | When did this branch last sync successfully? | Visible |
| 3.3 | Which integrations are failing? | Visible |
| 3.4 | Restore from backup in the lab | Completes; data verified afterwards |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |

**Could this person handle a Friday evening incident alone?** ☐ Yes ☐ No

| | |
|---|---|
| Runbook gaps found | |
| Observer | |
