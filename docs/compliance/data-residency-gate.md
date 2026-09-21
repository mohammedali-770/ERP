# Data residency gate

**This is a blocking gate before any production deployment.** It is not a
task; it is a condition.

Related: ADR-0002 · B-05 · OPN-001 · PRG-010 · PRG-011 · SEC-009

---

## Why this document exists separately

Gates get passed by inertia. The lab will work well on whatever platform it runs
on, and the path of least resistance is for that platform to become production
because nobody stopped to ask. This document exists to make that stop explicit.

**The lab's platform choice is not a production decision and confers no presumption.**

---

## The situation, stated plainly

The existing estate's live data is on Supabase in **`eu-central-1`** (Frankfurt).
A second project in `ap-southeast-1` exists but is an inactive, paused scratch
project with no ERP relevance ([`../estate/inventory.md`](../estate/inventory.md)),
so the live cross-border footprint is one region, not two.
**Supabase offers no Saudi region** — verified 2026-09-21 against Supabase's
published region list: 17 regions, none in the Middle East or any Gulf state.

Today that means customer names, mobile numbers and delivery addresses are held
outside the Kingdom. The ERP will additionally hold employee records, payroll,
financial records and ZATCA documents.

The owner has chosen Supabase-native for the lab, accepting lock-in (ADR-0015).
That choice is sound for the lab and is recorded with its cost.

---

## What the gate requires

### 1. A qualified legal determination

Not an engineering opinion. For **each** data category, does Saudi law require
in-Kingdom residency, and under what conditions?

| Category | Examples | Determination |
|---|---|---|
| Customer personal data | Name, mobile, address, order history | ☐ |
| Employee personal data | Identity, contract, documents | ☐ |
| Payroll and compensation | Salary, bank details, end-of-service | ☐ |
| Financial records | Ledger, invoices, settlements | ☐ |
| ZATCA documents | Invoices, counters, certificates | ☐ |
| Operational telemetry | Logs, metrics, traces | ☐ |

**These categories may not have the same answer.** A determination covering only
"customer data" does not close this gate.

### 2. Costed options (PRG-010)

At minimum three, each with its RPO/RTO tier (ADR-0009) and the operational effort
of proving it:

| Option | Shape | Residency posture |
|---|---|---|
| A | Stay on managed Supabase | Out of Kingdom |
| **B′** | **Self-hosted Supabase, in-Kingdom cloud** | In Kingdom |
| B | Self-managed Postgres, in-Kingdom cloud | In Kingdom |
| C | Hybrid — regulated categories in Kingdom, rest as-is | Split |

**B′ was not previously on this list and probably belongs above B.** Supabase is
open source and can be self-hosted, which keeps PostgREST, GoTrue, RLS, the RPC
surface and the storage API intact — and therefore avoids most of §3's expensive
list, which is what makes *leaving* Supabase costly rather than what makes
*moving* it costly. A costed study that offers only "stay" or "rewrite" is
comparing the two most expensive endpoints of a range.

#### What in-Kingdom actually means today

Facts as of **2026-09-21**, and worth re-checking rather than trusting, because
two of them are due to change before this programme reaches production:

| Provider | Saudi region | Status |
|---|---|---|
| Google Cloud | Dammam (`me-central2`) | **Live** — access via CNTXT, KSA-based customers |
| Oracle Cloud | Jeddah, Riyadh | **Live** |
| Huawei Cloud | Riyadh | **Live** |
| Alibaba Cloud | Riyadh (SCCC joint venture) | **Live** |
| Tencent Cloud | Saudi Arabia | **Live** |
| **AWS** | announced March 2024 | **Not live.** Targeted 2026, still undeployed as of mid-2026 |
| **Microsoft Azure** | Saudi Arabia East | **Not live.** Targeted Q4 2026 |

**The decisive chain, and the reason Option A cannot simply "add a region":** all
17 of Supabase's published regions are **AWS** regions, and **AWS has no live
Saudi region**. So managed Supabase in the Kingdom requires two sequential events,
neither committed and neither ours: AWS launching its Saudi region, *then* Supabase
adopting it. Nothing in the programme should be planned on that happening.

Which is what makes B′ interesting — every live Saudi region above belongs to a
provider Supabase does not run on, so self-hosting is the only route that keeps
the Supabase surface **and** lands in the Kingdom.

**None of this is a view on what the law requires.** It is vendor availability,
recorded so the costed study in §2 starts from what exists rather than from an
assumption, and so the determination in §1 can be read against real options.

### 3. An honest migration estimate

From the lab platform to each option. **This is the number most likely to be
understated**, so it should be built from the specifics, not assumed:

The expensive parts of leaving Supabase are not the data. They are:

- **`pg_cron`** — every scheduled job re-platformed onto an external scheduler
- **`pg_net`** — database-initiated HTTP calls re-homed into application services
- **Vault** — secret storage and rotation moved to a different mechanism
- **RLS as primary authorisation** — if authorisation lives in policies rather than
  a service layer, it must be rebuilt, and rebuilt *correctly*, which is harder
  than rebuilding it *at all*
- **`SECURITY DEFINER` RPCs** — the existing estate has roughly 190; the ERP will
  have its own

A database export is a day. This is not a day.

### 4. Executive sign-off

Recorded in ADR-0002, naming the option chosen and the residency determination it
rests on.

---

## Review cadence

**Every phase gate**, not only at F2. The longer the Supabase-native surface grows
before this is answered, the more expensive option B or C becomes. That trend is
itself information executives should see.

---

## What proceeds regardless

Lab and development work, unaffected. The architecture's own portability — plain
SQL migrations where practical, adapters for external providers — reduces but does
not eliminate the exposure, and this document does not pretend otherwise.

---

## Scope note

This is a product-controls document. It is **not legal advice** and does not
substitute for it. PRD §7.3 is explicit: ZATCA e-invoicing, payment-provider rules,
Saudi personal-data requirements and official HR-service capabilities must be
verified against current authoritative specifications before each production
release.
