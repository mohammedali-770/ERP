# Executive evidence package

The artifact executive management reviews before granting production approval
(REL-001, REL-003). Structured from PRD §8.3.

**Filled progressively, not written in month 9.** Each section names where its
evidence comes from, so it accumulates as the work happens.

---

## 1. Executive success conditions

The PRD's own eight conditions (§1). Each is a yes or no with evidence, not a
narrative.

| # | Condition | Evidence | Status |
|---|---|---|---|
| 1 | No accepted orders lost or duplicated | T-01 | ☐ |
| 2 | Receipt and kitchen printing reliable under simultaneous multi-channel load | T-01, T-03 | ☐ |
| 3 | Payments, refunds, shifts and cash closing reconcile accurately | T-04, T-05, T-08 | ☐ |
| 4 | Branch operates fully during connectivity loss and synchronises correctly | T-02 | ☐ |
| 5 | ZATCA documents and deferred synchronisation meet current requirements | T-09 | ☐ |
| 6 | Cashiers and kitchen users can learn and operate the workflow safely | UAT | ☐ |
| 7 | Management reports reconcile to source transactions | Reporting reconciliation | ☐ |
| 8 | Sustained testing above 200 orders per hour per branch | T-01 | ☐ |

## 2. Signed UAT results

Representative cashier, kitchen, operations and finance users (ACC-006). Signed by
the users, not summarised by the team.

- Participants, roles, branches represented
- Scenarios executed and outcomes
- Usability findings and their disposition
- Training readiness statement

## 3. Load and failure test results

Reconciled counts, not summaries (ACC-008):

- Orders submitted / accepted / at central / printed / completed
- Payments attempted / captured / reconciled / refunded
- Print jobs queued / printed / failed / reprinted
- **Every discrepancy explained individually.** "Within tolerance" is not an
  explanation.

## 4. Offline and recovery evidence

- Outage duration, transaction volume during outage, catch-up time
- Synchronisation exceptions raised and how each was resolved
- Duplicate scan across every aggregate showing zero duplication
- Conflict incidents raised and their resolution path

## 5. ZATCA and payment certification

- Sandbox or certification evidence applicable to the release
- Counter-chain integrity export per EGS unit
- Payment provider certification status
- **If B-01 is unresolved at this point, say so here plainly** — a partial milestone
  reported as complete is worse than a partial milestone

## 6. Security review

- Vulnerability assessment and dependency review (SEC-015)
- Penetration test scope and findings
- Open findings with severity, owner and target date
- Access review outcome

## 7. Open defects

All critical and high defects affecting order, payment, printing, ZATCA, security
or synchronisation are **closed or formally accepted** before production approval
(ACC-009). Formal acceptance means a named person accepted a named risk.

## 8. Operating readiness

- Runbooks covering the SUP-009 set: internet outage, printer failure, terminal
  failure, payment uncertainty, sync backlog, ZATCA queue, data restore, security
  incident
- Support model and escalation path
- Monitoring and alerting coverage
- Training material and completion records

## 9. Hardware and cost recommendation

The completed [`hardware-decision-matrix.md`](./hardware-decision-matrix.md) with
measured results, plus tiered production cost and reliability options (PRG-010,
PRG-012).

## 10. Recommendation

A plain statement: production-ready, or not, and for which branches under which
conditions.

**REL-001 is explicit — the ERP stays out of production until stable end-to-end
operation is demonstrated and owner or executive management approves. A completed
development milestone is not an approval, and this package does not confer one.**

---

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Product Owner | | | |
| Finance | | | |
| IT and system administration | | | |
| Operations | | | |
| Owner / executive management | | | |
