# UAT — Release gate

**Run by:** Product Owner
**When:** before the executive acceptance pack, not alongside it

Covers `REL-004`, and the completeness check `ACC-009` requires.

> This is a **completeness check, not a test**. It asks one question: is
> everything present that executives need in order to decide? Taking an
> incomplete package to executives wastes their time and damages the programme's
> credibility more than a delay would.

---

## Part 1 · Are the other packs done?

| Pack | Run? | Passed? | Signed by a real user? |
|---|---|---|---|
| Lab readiness | ☐ | ☐ | n/a |
| Cashier | ☐ | ☐ | ☐ |
| Kitchen | ☐ | ☐ | ☐ |
| Menu | ☐ | ☐ | ☐ |
| Customer app | ☐ | ☐ | ☐ |
| Reporting | ☐ | ☐ | ☐ |
| Support | ☐ | ☐ | ☐ |

**A pack signed by the team rather than by a user does not count as signed.**

## Part 2 · Are the acceptance scenarios evidenced?

| | Scenario | Evidence attached? |
|---|---|---|
| `T-01` | Concurrent order intake | ☐ |
| `T-02` | Central internet outage | ☐ |
| `T-03` | Printer failure | ☐ |
| `T-04` | Payment uncertainty | ☐ |
| `T-05` | Automatic refund | ☐ |
| `T-06` | Timed item unavailability | ☐ |
| `T-07` | Kitchen barcode | ☐ |
| `T-08` | Blind cash close | ☐ |
| `T-09` | Tax document deferred sync | ☐ |
| `T-10` | Security and permissions | ☐ |

**Where a scenario could not be run, state why.** `T-04`, `T-05` and `T-09` depend
on decisions and credentials outside the team's control — that is a legitimate
answer, and far better than an absent one.

## Part 3 · Defects

`ACC-009`: every critical and high defect affecting order, payment, printing, tax
documents, security or synchronisation is **closed or formally accepted**.

| | |
|---|---|
| Critical open | |
| High open | |
| Formally accepted, by whom | |

"Formally accepted" means a named person accepted a named risk. Not "we think it's
fine".

## Part 4 · Readiness

| | Present? |
|---|---|
| Runbooks for all eight failure modes | ☐ |
| Training material | ☐ |
| Support model and escalation path | ☐ |
| Monitoring and alerting coverage | ☐ |
| Hardware recommendation with measured evidence | ☐ |
| Tiered cost options | ☐ |

## Part 5 · The honest question

> **Is anything in this package presented as complete when it is not?**

Partial is acceptable and expected. Partial described as complete is not, and it
is the failure this step exists to catch.

| | |
|---|---|
| Known gaps, stated plainly | |
| Ready to go to executives? | ☐ Yes ☐ No |
| Product Owner | |
| Date | |
