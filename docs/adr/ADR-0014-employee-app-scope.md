# ADR-0014 — Employee application scope

- **Status:** Proposed
- **Date:** 2026-09-17
- **PRD decisions:** OPN-012 · EMP-001 · EMP-012 · DLV-005 · EMP-008
- **Deciders:** Product Owner, after department workshops

## Context

EMP-001 requires **one role-based application** for employees rather than separate
apps per job type. EMP-012 requires future functions to be added through modular
role permissions rather than new applications. OPN-012 defers additions beyond the
confirmed list to department workshops before F4 backlog approval.

The estate already contains a separate delivery application, which is precisely
the pattern EMP-001 forbids going forward.

## Decision

**One application, role-composed home screens, capability-gated features.**

- The app's surface is assembled from the signed-in employee's role capabilities.
  Driver functions appear only to authorised drivers and dispatchers (EMP-008);
  everyone else does not know they exist.
- Adding a function means adding a capability and a screen, never a new app or a
  new build target (EMP-012).
- The confirmed F4 scope is EMP-002..EMP-011: attendance, schedules, leave,
  payslips, announcements, tasks and checklists, approvals, driver functions,
  maintenance and IT requests, training, bilingual with role-specific home screens.

### What the workshops must produce

Not a wish list. For each proposed addition: which role needs it, what it replaces
today, and what data it touches. The last one matters most — a function that reads
payroll or customer personal data carries access-control and privacy consequences
(HR-015, DLV-010) that a task checklist does not.

## Consequences

- The existing separate delivery app is superseded rather than extended. Its
  functionality and any field-learned behaviour are input to DLV-005, but it should
  not survive as a second employee-facing application.
- Role-capability composition must exist in the identity service from the start
  (IAM-003, IAM-004); it cannot be retrofitted once screens assume a fixed layout.
- Scope growth is the main risk here. The workshops produce candidates; the F4
  backlog approval is where they are cut.
