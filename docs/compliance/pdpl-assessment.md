# Personal data assessment

Requirements: SEC-005 · SEC-008 · SEC-009 · SEC-012 · CRM-011 · DLV-010 · HR-015
Related: Q-07 · ADR-0002 · ADR-0012

> **Scope note.** A product-controls assessment, not legal advice. SEC-009
> requires processing to be assessed against applicable Saudi personal-data
> requirements **before production**, by someone qualified to do it. This
> document prepares that assessment; it does not substitute for it.

---

## Personal data inventory

| Category | Fields | Subject | Where | Sensitivity |
|---|---|---|---|---|
| Customer identity | Mobile (canonical), name, verification state | Customer | CRM, orders | Medium |
| Customer location | Address, coordinates, short address, directions | Customer | Orders, delivery | **High** — reveals home |
| Order history | Items, times, branches, amounts | Customer | Orders | Medium |
| Payment metadata | Card scheme, last four, provider reference | Customer | Payments | **High** |
| Communications | Notification and message history, consent state | Customer | CRM, marketing | Medium |
| Call recordings | Audio, linked cases | Customer | Call centre | **High** |
| Employee identity | Identity documents, contact, contract | Employee | HR | **High** |
| Payroll | Salary, allowances, deductions, bank details | Employee | HR, finance | **Critical** |
| Attendance | Times, locations, device, biometric source | Employee | HR | **High** — location tracking |
| Performance | Evaluations, disciplinary records | Employee | HR | **High** |
| Driver telemetry | Assignment, status, customer contact during delivery | Employee + customer | Delivery | **High** |
| Service ratings | Dimension scores, free-text comments, attributed employee, submitting customer | **Employee + customer** | Ratings, CRM | **High** — an identified customer's opinion of a named employee |

---

## Controls by requirement

### Masking and restricted export (SEC-005)

Payroll, payment, personal and financial fields support masking and restricted
export. Report exports respect the viewer's permissions and masking — **RPT-003
is explicit that export does not bypass access control**, which is the usual way
this control fails.

### Retention and deletion (SEC-008, CRM-011)

Retention schedules per category, with approved deletion or anonymisation
workflows. Consent, communication preference, retention and deletion are recorded
and enforced.

The existing estate already runs a working account-deletion queue with an audit
record that survives the account it deleted. **That is a migration source, not a
thing to rebuild.**

Tension to resolve deliberately: financial records must be retained for statutory
periods while personal data may need deleting. Resolution is **anonymisation of
the personal fields with the financial record preserved** — the transaction
survives, the person does not. This needs confirming with whoever advises on both
obligations.

### Least privilege and access review (SEC-004)

Access limited to assigned companies, brands, branches, departments and functions
(IAM-006). Payroll and sensitive HR data visible only to specifically authorised
roles (HR-015). Periodic access review.

### Ratings (RTG-P09, RTG-P11, RTG-P12)

Proposed requirements, and a new flow in **both** directions: a rating links an
identified customer to a named employee's performance record.

| Control | Requirement |
|---|---|
| The rated employee never learns who rated them — not a name, not a masked number, not an order that identifies one, at any time | `RTG-P12` |
| The employee sees their own ratings in aggregate and may contest one, with the original retained | `RTG-P09`, `RTG-P10` |
| No automated decision about a person is taken from a rating | `RTG-P11` |

**`RTG-P11` is the PDPL-relevant one.** A rating that automatically affected pay,
discipline, scheduling or work allocation would be automated decision-making about
an identified individual with a significant effect on them. Keeping the human in
the loop is a design decision in ADR-0017 and a compliance position here; the two
must not drift apart.

Free-text comments are the harder half of `RTG-P12`: customers write *"the lady at
the counter, I come every Thursday"*, which identifies both parties in one
sentence. Comments reaching an employee view are aggregated or withheld, never
passed through verbatim.

Open: whether a rating may be weighed in a formal evaluation (`Q-15`). If it may,
it becomes part of an employment record and its retention, disclosure and
challenge obligations change.

### Purpose limitation for delivery (DLV-010)

Customer location and contact exposed **only for the active delivery**, retained
per approved policy. A driver's app does not become a customer database.

### Non-production data (SEC-012)

Production data is never copied into development or testing without approved
masking. The lab uses synthetic data (LAB-004, LAB-005).

### AI boundaries (AI-014)

Customer, employee and financial data must not reach an AI provider beyond the
approved purpose and configuration. This is a hard boundary, enforced at the tool
layer (AI-002) rather than by prompt instruction.

---

## A known exposure the assessment must cover

**Asterisk core dumps in a repository's git history.** The `yeastarissue`
repository contains three process-memory snapshots of 202–451 MB taken from the
PBX. A core dump captures whatever was in memory at the moment of the crash, which
for a telephony platform can include **customer telephone numbers, call audio
buffers and SIP credentials**.

This is recorded here, and not only in `blocked.md` (B-06), because the security
remedy and the privacy remedy differ:

| Concern | Remedy |
|---|---|
| Security | Rotate every credential — they are in git history, so deleting the file is not enough |
| **Privacy** | Determine whether personal data was contained, what categories, and what the retention and deletion obligations are |

The privacy question cannot be answered by assuming the answer. Somebody has to
establish what those dumps actually contain before deciding whether this is a
notifiable matter, and that determination belongs with whoever advises on Saudi
personal-data requirements rather than with engineering.

---

## Questions the assessment must answer

1. **Is one person one customer across brands?** (Q-07, ADR-0012) Determines
   whether personal data crosses a brand boundary. A privacy question, not only a
   product one.
2. **Does residency apply differently to employee and payroll data than to customer
   data?** (ADR-0002) They are separate determinations.
3. **What is the lawful basis for each processing purpose** — order fulfilment,
   marketing, loyalty, attendance monitoring, call recording?
4. **Attendance location capture (HR-004, HR-005)** is employee monitoring. What
   notice and basis does it require?
5. **Call recording (CC-006)** — what notice, retention and access rules apply?
6. **Cross-border transfer** — if any processor sits outside the Kingdom, what
   safeguards are required?
7. **Diagnostic bundles and core dumps** (above) — what obligations attach to
   process-memory snapshots that may contain customer data, and what is the
   correct handling and retention rule for vendor diagnostics generally?

---

## Consent model

- Customer notification consent is recorded per channel and purpose, with history.
- **Marketing consent posture is a recorded owner decision** and must survive
  migration rather than being silently re-decided when the app is re-pointed
  (see [`../estate/sma-absorption.md`](../estate/sma-absorption.md)).
- Consent state travels with the customer record; it is not a client-side setting.
