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

---

## Consent model

- Customer notification consent is recorded per channel and purpose, with history.
- **Marketing consent posture is a recorded owner decision** and must survive
  migration rather than being silently re-decided when the app is re-pointed
  (see [`../estate/sma-absorption.md`](../estate/sma-absorption.md)).
- Consent state travels with the customer record; it is not a client-side setting.
