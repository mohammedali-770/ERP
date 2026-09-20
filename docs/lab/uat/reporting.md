# UAT — Reporting

**Run by:** finance, plus an operations manager
**Duration:** about two hours
**Requires:** a lab day with enough real-shaped transactions to reconcile

Covers `RPT-001`, `RPT-003`, `RPT-006`, `RPT-008`, `RPT-009`, and `ACC-007`.

> `ACC-007` requires reports to **reconcile to source transactions**. The test is
> not whether a report renders. It is whether finance believes the number.

---

## Part 1 · Reconciliation

| # | Task | Passes when |
|---|---|---|
| 1.1 | Take the day's sales total and prove it from the transactions | Reconciles **exactly**, not approximately |
| 1.2 | Drill from a total to one order | Possible without a technical query |
| 1.3 | Reconcile a cashier's shift against their payments | Matches, including the variance |
| 1.4 | Reconcile tax against the invoices issued | Matches |
| 1.5 | Reconcile refunds against payments | Every refund traces to its payment |

> **Any discrepancy in Part 1 fails the pack**, however small. "Close enough" in
> reconciliation is how errors become permanent.

## Part 2 · Standard reports

| # | Task | Passes when |
|---|---|---|
| 2.1 | Net sales, orders, average order value for a day | Present, correct |
| 2.2 | Item mix | Matches what was sold |
| 2.3 | Discounts and refunds | Separately visible, not netted away |
| 2.4 | Sales by payment method | Totals match Part 1 |
| 2.5 | Demand by hour | Plausible against observed load |
| 2.6 | Preparation and readiness times | Present |
| 2.7 | Print failures and sync backlog | Visible without technical access |

## Part 3 · Using them

| # | Task | Passes when |
|---|---|---|
| 3.1 | Export to Excel | Opens, numbers are numbers, Arabic renders |
| 3.2 | Export as PDF | Readable and printable |
| 3.3 | Check a masked field as a user without permission | **Still masked in the export** |
| 3.4 | Find when a dashboard last updated | Freshness stated, not assumed |
| 3.5 | Find the definition of a figure you do not recognise | Documented and reachable |

> **3.3 is the one that fails quietly.** Export is the usual way access control
> gets bypassed — the screen masks, the spreadsheet does not.

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |

**Does finance trust these numbers enough to use them?** ☐ Yes ☐ No ☐ With changes

| | |
|---|---|
| Discrepancies found | |
| Observer | |
