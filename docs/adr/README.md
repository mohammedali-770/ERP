# Architecture decision records

One file per decision. A decision is recorded here when it is expensive to
reverse, when it constrains later work, or when someone six months from now would
otherwise have to guess why the system is shaped this way.

**Status values**

| Status | Meaning |
|---|---|
| `Proposed` | Written up, not yet decided. Carries a recommendation. |
| `Accepted` | Decided. Binding on implementation. |
| `Superseded by ADR-NNNN` | Replaced. Kept for the record; never deleted. |
| `Rejected` | Considered and declined, with the reasoning kept. |

Most ADRs here are **Proposed**. The PRD requires architecture and hosting
decisions to be approved by executive management after a costed study
(PRG-010, PRG-011), so this repository proposes; it does not decide.

**Coverage of the PRD's open decisions.** Section 10.2 of the PRD lists twelve
open decisions, `OPN-001` to `OPN-012`. Each maps to an ADR below, and
`npm run req:lint` fails if one stops being referenced.

| PRD decision | ADR | Subject |
|---|---|---|
| OPN-001 | [ADR-0002](./ADR-0002-hosting-and-data-residency.md) | Central hosting model and Saudi data residency |
| OPN-002 | [ADR-0009](./ADR-0009-rpo-rto-tiers.md) | Recovery point and recovery time targets |
| OPN-003 | [ADR-0004](./ADR-0004-branch-runtime-and-deployment.md) | iPad-only, Windows POS, or iPad plus controller |
| OPN-004 | [ADR-0008](./ADR-0008-payment-provider-and-terminal.md) | mada terminal integration method and provider |
| OPN-005 | [ADR-0001](./ADR-0001-repository-structure.md) | Repository structure |
| OPN-006 | [ADR-0010](./ADR-0010-lazywait-coexistence.md) | Lazywait data feed into the ERP before 2028 |
| OPN-007 | [ADR-0011](./ADR-0011-historical-migration-scope.md) | Historical migration scope and retention |
| OPN-008 | [ADR-0011](./ADR-0011-historical-migration-scope.md) | Branch cutover sequence from 1 January 2028 |
| OPN-009 | [ADR-0012](./ADR-0012-cross-brand-data-sharing.md) | Cross-brand sharing rules by data type |
| OPN-010 | [ADR-0007](./ADR-0007-kitchen-readiness-workflow.md) | Kitchen station and partial-readiness barcode workflow |
| OPN-011 | [ADR-0013](./ADR-0013-social-connectors.md) | Social-platform connector availability |
| OPN-012 | [ADR-0014](./ADR-0014-employee-app-scope.md) | Employee-app additions beyond confirmed functions |

**Decisions this programme added.** These are not in the PRD's list but are just
as hard to reverse, and were surfaced during F0 architecture work.

| ADR | Subject |
|---|---|
| [ADR-0003](./ADR-0003-event-sourced-core.md) | Append-only event log as the system of record |
| [ADR-0005](./ADR-0005-identifiers-and-idempotency.md) | Device-minted identifiers as idempotency keys |
| [ADR-0006](./ADR-0006-zatca-egs-granularity.md) | ZATCA EGS unit granularity and offline invoicing |
| [ADR-0015](./ADR-0015-estate-consolidation.md) | Relationship between the ERP and the existing estate |
| [ADR-0016](./ADR-0016-call-centre-integration.md) | The reachable PBX surface, and designing for a platform that restarts |
| [ADR-0017](./ADR-0017-ratings-and-feedback.md) | What ratings are for, and what they must never automatically do |
| [ADR-0018](./ADR-0018-erp-database-home.md) | Where the ERP's database lives, and why not beside the live inbox |
| [ADR-0019](./ADR-0019-vertical-slice-before-layers.md) | Prove one order end to end before building breadth |
| [ADR-0020](./ADR-0020-consolidation-direction.md) | The warehouse system and the ERP stay in two databases — superseded by ADR-0021 |
| [ADR-0021](./ADR-0021-one-project.md) | One project: the warehouse system is rebuilt into the ERP |
| [ADR-0022](./ADR-0022-identity-and-authentication.md) | Identity is `erp`-native, and the runtime never reads a credential |
| [ADR-0023](./ADR-0023-edge-functions-hold-the-erp-credential.md) | Edge functions hold the ERP's database credential |
| [ADR-0024](./ADR-0024-item-master-and-units.md) | One item master, and conversions that cannot be read two ways |
| [ADR-0025](./ADR-0025-sessions-and-the-edge-layer.md) | Sessions, and an edge layer in which a caller cannot name the actor |
| [ADR-0026](./ADR-0026-suppliers.md) | Suppliers, and what each one sells, named down to the pack |
| [ADR-0027](./ADR-0027-transfer-prices.md) | Transfer prices: what a branch is charged for a pack, from when |
| [ADR-0028](./ADR-0028-facilities-and-branch-areas.md) | Facilities: branches made a master, and the area a branch worker orders from |
| [ADR-0029](./ADR-0029-stock-ledger.md) | Stock: a ledger at each warehouse and factory, posted through one seam |
| [ADR-0030](./ADR-0030-notifications.md) | Notifications: an in-app bell, rung by the records people can open |
