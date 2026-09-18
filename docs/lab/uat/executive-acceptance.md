# UAT — Executive acceptance

**Run by:** owner or executive management
**When:** after the release gate pack confirms the package is complete

Covers `ACC-001`..`ACC-008`, and `REL-001`/`REL-003` — production approval.

> **This is the final authority.** `REL-001` is explicit: the system stays out of
> production until stable end-to-end operation is demonstrated **and** owner or
> executive management approves. No development milestone confers that.

---

## The eight success conditions

Straight from the PRD. Each is yes or no with evidence — not a narrative.

| | Condition | Evidence | Met? |
|---|---|---|---|
| 1 | No accepted order lost or duplicated | `T-01` | ☐ |
| 2 | Receipt and kitchen printing reliable under simultaneous load | `T-01`, `T-03` | ☐ |
| 3 | Payments, refunds, shifts and cash closing reconcile | `T-04`, `T-05`, `T-08` | ☐ |
| 4 | Branch operates during connectivity loss and synchronises after | `T-02` | ☐ |
| 5 | Tax documents and deferred synchronisation meet requirements | `T-09` | ☐ |
| 6 | Cashiers and kitchen staff can learn and operate it safely | Cashier and kitchen packs | ☐ |
| 7 | Management reports reconcile to source transactions | Reporting pack | ☐ |
| 8 | Sustained testing above 200 orders per hour per branch | `T-01` | ☐ |

## What to ask the team

Questions that surface what a presentation smooths over:

1. **Which of the eight could you not fully evidence, and why?**
   A confident "all eight" deserves scrutiny. Conditions 3 and 5 depend on a
   payment provider and tax sandbox credentials that may not have been available.
2. **What did the cashiers actually say?** Not the pass rate — the comments.
3. **What is still open that you have accepted rather than fixed?**
4. **What would you fix first if given another month?**
5. **What are you least confident about?** A team that names nothing has either
   not looked or is not saying.

## The decision

| Outcome | Meaning |
|---|---|
| **Approved for production** | Eligible new branches may use it under the controlled rollout plan (`REL-005`) |
| **Approved with conditions** | State the conditions and who verifies them |
| **Not approved** | State what is required, and when it will be reconsidered |

**Approving a milestone is not approving production.** A complete lab release with
payments unevidenced is a real achievement and still not a production system.

## Record

| | |
|---|---|
| Conditions met | ___ of 8 |
| Conditions not met, and why | |
| Decision | |
| Conditions attached | |
| Reconsideration date, if not approved | |

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Owner / executive management | | | | |
| Product Owner | | | | |
| Finance | | | | |
| Operations | | | | |
