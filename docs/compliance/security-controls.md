# Security control matrix

Maps SEC-001..015 to concrete mechanisms and owners. Requirements are obligations;
this is how each is met.

Owner: IT and system administration unless stated.

| Req | Obligation | Mechanism |
|---|---|---|
| SEC-001 | Security designed into every module | Invariants and review gates (`../program/governance.md` §6); security review required for identity, permission and audit changes |
| SEC-002 | Encryption in transit; sensitive data at rest with managed keys | TLS everywhere including device↔peer (mutual TLS, per-device certificates at enrolment); encrypted device store (OFF-004); platform-managed keys at rest |
| SEC-003 | Secrets outside source code, rotated | Platform secret storage; **no secret in a table, ever** — the existing estate's pattern of storing a secret *reference* rather than a value is the model; rotation is a documented owner-approved action |
| SEC-004 | Least privilege, segregation of duties, periodic review | Role capabilities (IAM-003); requester cannot approve their own transaction (PRC-004); scheduled access review with recorded outcome |
| SEC-005 | Masking and restricted export | Field-level masking by role; exports respect viewer permissions (RPT-003) |
| SEC-006 | Audit logs: actor, action, target, before/after, time, device, source, outcome | The event log **is** the audit trail (ADR-0003) — not a parallel mechanism that can drift; privileged actions additionally recorded per IAM-008 |
| SEC-007 | Audit access restricted, monitored, protected from alteration | Append-only enforced by revoked grants **and** a trigger; per-device hash chain makes tampering detectable; audit reads are themselves audited |
| SEC-008 | Retention schedules, approved deletion or anonymisation | Per-category schedules (`pdpl-assessment.md`); anonymise personal fields while preserving financial records |
| SEC-009 | Saudi personal-data assessment before production | `pdpl-assessment.md`; **qualified assessment is an F0 exit item** |
| SEC-010 | Scoped credentials, validation, timeout, retry, rate limit, circuit breaker | Per-connector; every adapter carries all six plus a named operational owner (PRD §6.3) |
| SEC-011 | Webhooks authenticated and replay-protected | Signature verification with timing-safe comparison; replay window plus idempotent handling by event identifier |
| SEC-012 | No unmasked production data in dev or test | Lab uses synthetic data (LAB-004); copying production data is an owner-approved action requiring masking |
| SEC-013 | Backups encrypted, restore-tested, credential-isolated | Per the chosen RPO/RTO tier (ADR-0009); **restore exercises are scheduled with recorded outcomes** — a backup never restored is not a backup |
| SEC-014 | Documented incident detection, containment, recovery, evidence, notification | Incident runbook (SUP-009 set); severity, ownership and escalation defined before an incident, not during |
| SEC-015 | Vulnerability assessment, dependency review, penetration testing before production | F2 gate; scope proportionate to risk; dependency licences and replacement options documented (PRG-007) |

---

## Controls that are structural rather than procedural

Worth calling out, because these cannot be forgotten under pressure:

- **Append-only enforcement** — two independent mechanisms (revoked grants and a
  trigger), because "a migration accidentally rewrote history" is unrecoverable.
- **Realtime publications carry identifiers and change kinds only, never full
  rows** — inherited from the existing estate. A subscriber cannot receive data its
  policies would deny, because the data is not in the channel.
- **Alert payloads carry no personal data.** Operational alerting reaches inboxes
  and phones; keeping it non-PII by construction means an alerting misconfiguration
  is not a data breach.
- **Audit tables written exclusively by triggers**, so no write path can escape the
  audit by forgetting to call it.
- **Secrets stored by reference, not by value**, so a table read never yields a
  credential.

---

## AI-specific controls

| Req | Control |
|---|---|
| AI-002 | AI acts through explicit tools and permissions, never unrestricted database access |
| AI-011 | Financial postings, price changes, out-of-rule refunds, payroll, HR actions, access changes and deletion **always require human authorisation** |
| AI-012 | Every AI action records model identity, trigger, inputs, tools, output, approvals, result |
| AI-014 | Hard boundary on what may reach an AI provider — enforced at the tool layer, not by instruction |
| AI-015 | Kill switches, rate limits, cost limits, rollback or compensation |
| AI-018 | The AI auditor produces findings; it does not replace statutory audit, legal accountability or executive approval |

The governing principle: **an AI agent's permissions are a subset of a human
role's, and the sensitive actions in AI-011 are outside every AI role.**
