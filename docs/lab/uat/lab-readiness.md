# UAT — Lab readiness

**Run by:** the team, before any other pack
**Duration:** about half a day

Covers `LAB-003`, `LAB-004`, `LAB-005`.

> **Run this first.** A UAT that fails because the lab was misconfigured wastes
> the participants' time and, worse, teaches them the system is unreliable when
> it may not be.

---

## Part 1 · Can the lab do what the packs need?

| # | Check | Ready when |
|---|---|---|
| 1.1 | Three tills, all active | Yes |
| 1.2 | Receipt and kitchen printers, separate | Yes |
| 1.3 | Barcode reader | Reads slips reliably |
| 1.4 | Payment terminal or simulator | Can be made to fail deliberately |
| 1.5 | Network controls | Disconnection, latency and loss are injectable |
| 1.6 | Branch controller | Present and **switchable** — both hardware options must be testable |

## Part 2 · Fault injection

Every fault the packs rely on, proven to work *before* participants arrive.

| # | Fault | Injectable and repeatable? |
|---|---|---|
| 2.1 | Central disconnection at a chosen moment | ☐ |
| 2.2 | Printer power loss and paper-out | ☐ |
| 2.3 | Device force-quit and restart | ☐ |
| 2.4 | Payment response dropped after processing | ☐ |
| 2.5 | Clock skew on one device | ☐ |
| 2.6 | Access-point client isolation toggled | ☐ |

## Part 3 · Test data

| # | Check | Ready when |
|---|---|---|
| 3.1 | Regenerable from seed | Identical state every time |
| 3.2 | Bilingual product names | Present |
| 3.3 | Modifier groups with minimums and maximums | Present |
| 3.4 | Combos with child selections | Present |
| 3.5 | Orders crossing midnight against the business date | Present |
| 3.6 | **No production data** | Confirmed — synthetic only |

## Part 4 · Isolation

| # | Check | Confirmed when |
|---|---|---|
| 4.1 | Separate credentials from anything live | ☐ |
| 4.2 | No network path to production | ☐ |
| 4.3 | Tax identities are test identities | ☐ — a lab device must never hold a production certificate |
| 4.4 | Payments are test-mode only | ☐ |

---

## Sign-off

| | |
|---|---|
| Lab ready for UAT? | ☐ Yes ☐ No |
| Gaps | |
| Prepared by | |
| Date | |
