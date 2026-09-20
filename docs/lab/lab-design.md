# HQ lab design

Requirements: LAB-001..005 · OFF-014 · NFR-016

LAB-001 requires a complete ERP and POS lab at head office **before any production
branch rollout**. This is not a staging environment; it is a physical branch
simulator with fault injection.

---

## What the lab represents

One complete branch (LAB-002):

| Element | Specification | Why |
|---|---|---|
| POS devices | **3**, matching the candidate hardware | POS-009 baseline; three is where peer coordination gets interesting |
| Receipt printer | Network thermal | Q-04 — LAN, not Bluetooth |
| Kitchen printer | Network thermal, separate station | PRN-002 concurrent load |
| Barcode reader | Matching production intent | PRN-007, PRN-008 |
| Payment terminal | Real terminal, or simulator | Blocked on B-01 for a real one |
| Network controls | Managed switch and AP with configurable isolation, latency and loss | LAB-003 |
| Branch controller | Present but **switchable** | Must prove both ADR-0004 options |

The controller being switchable matters: OFF-014 forbids approving hardware before
the comparison, and a lab that can only run one configuration cannot make the
comparison.

## Fault injection (LAB-003)

Controlled, repeatable, scripted — not "unplug the cable and see":

- Central disconnection, at chosen moments in a transaction
- Latency and packet loss injection
- Device restart and force-quit
- Printer power loss and paper-out
- Service failure at the central end
- **Clock skew injection** on individual devices
- **AP client isolation toggling** — the setting that decides ADR-0004

## Environments (LAB-004)

Non-production payment, ZATCA and external-channel environments, or approved
simulators. **No production credentials. No production customer data** (SEC-012).

## Test data (LAB-005)

Repeatable, version-controlled, synthetic. Regenerable from seed so a regression
run starts from an identical state.

Must include the awkward cases, because these are where bugs live: bilingual
product names, modifier groups with minimums and maximums, combos with child
selections, split tenders, partial refunds, scheduled orders, and orders that
cross midnight relative to the business date.

---

## What the lab must be able to rehearse

Beyond feature testing:

- **The ten acceptance scenarios** (T-01..T-10), repeatably — see [`test-plan.md`](./test-plan.md)
- **Sustained load** above 200 orders/hour from four concurrent channels (NFR-001, NFR-002)
- **A restore exercise** against the chosen RPO/RTO tier (SEC-013, ADR-0009)
- **Cashier and kitchen UAT** with representative users (ACC-006) — packs in
  [`uat/`](./uat/README.md)
- **Training mode**, isolated from financial, stock and ZATCA records (POS-029)

## Access and safety

The lab is where destructive testing happens, so the boundary must be structural:
separate project and credentials from anything live, no network path to production
systems, and synthetic ZATCA identities only — a lab device must not hold a
production EGS certificate.
