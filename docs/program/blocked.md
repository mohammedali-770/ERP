# Blocked work

Work that cannot proceed, what unblocks it, and what it costs to stay blocked.

**This document exists so blockers are visible in month 1 rather than discovered
in month 7.** Every entry names who can unblock it.

Reviewed at every phase gate.

---

## B-01 — Payment provider selection · **CRITICAL**

**Blocks:** 16 F1 requirements (PAY-001..019 within F1) · ACC-003 · T-04 · T-05
**Unblocked by:** Owner / executive management
**Related:** ADR-0008

### What is blocked

No payment provider has been selected. The existing estate carries provisional
integrations for three providers, none of them live: one configured in test mode
and disabled, one built but inert with its migration unapplied, one historical.
Automatic refund processing is deliberately switched off. A freeze is in force
covering payment initiation, verification, webhooks, provider configuration,
refund logic and financial reconciliation.

### Why it cannot be worked around

The unknown-outcome protocol — the thing that makes NFR-004 ("no confirmed payment
charged twice") achievable — depends on a capability only the chosen provider can
confirm: **can the terminal be asked what happened, by our reference?**

If it can, reconciliation is automatic and cheap. If it cannot, the fallback is
human attestation against the printed slip, which works but carries a **large
recurring operational cost per branch per day** that must be priced into the
business case, not absorbed silently by cashiers.

We cannot design around the answer. We can only build against a simulator and wait.

### Cost of staying blocked

- Three of the ten executive acceptance scenarios cannot be evidenced.
- ACC-003 (accurate payments, refunds, cash shifts and blind closing) cannot be
  signed off, so **the F1 milestone would be partial even if everything else lands.**
- The payment ECR spike cannot run: it needs the real acquirer and terminal, and
  inducing timeouts against production is not an option.

### What proceeds regardless

The payment state machine, intent/attempt/outcome model, refund idempotency and
reconciliation ladder are built and tested against a simulator. The provider is a
replaceable adapter. When selection happens, the work is integration, not design.

### Recommended action

**Put this to executive management now.** The decision has a nine-month lead time
attached to it, and the PRD's own milestone depends on it.

---

## B-02 — ZATCA sandbox onboarding

**Blocks:** The ZATCA offline-issuance spike · ACC-005 · T-09
**Unblocked by:** Finance, with ZATCA onboarding credentials
**Related:** ADR-0006

Testing offline invoice issuance, counter chains and deferred synchronisation
requires sandbox credentials and registered device identities. Without them the
design in ADR-0006 is unvalidated.

Also needs a **business decision, not only credentials**: what happens when a
business customer requests a tax invoice during a connectivity outage. Standard
B2B invoices require clearance before issuance and cannot be issued offline.
Somebody must decide whether the request queues or is refused, and what the cashier
says.

**Cost of staying blocked:** PAY-016..019 remain designed but unproven, and
ACC-005 cannot be evidenced.

---

## B-03 — Branch network access for the LAN peer-sync spike

**Blocks:** `spikes/lan-peer-sync` · ADR-0004 (the hardware decision)
**Unblocked by:** IT, with access to a real branch network or a faithful replica

The iPad-only deployment assumes branch Wi-Fi permits client-to-client traffic and
mDNS discovery. **Many managed networks enable access-point client isolation by
default.** If it cannot be disabled on the production estate, peer replication is
impossible and a branch controller becomes mandatory.

**This is the cheapest high-value test in the programme and should run in week 1–2.**
It is a network configuration check, not an engineering effort, and it can change
the hardware budget.

**Cost of staying blocked:** the hardware decision drifts toward month 8, where
OFF-014 requires it to be settled by evidence anyway — at which point changing
course is expensive.

---

## B-04 — Warehouse system database identity

**Blocks:** F3 migration scoping
**Unblocked by:** Whoever holds the deployment environment for that system
**Related:** ADR-0011, [`../estate/migration-map.md`](../estate/migration-map.md)

The existing warehouse and factory system reads its database connection from an
untracked environment file, so its live database has not been identified. Its
domain model is F3's de-facto specification, but no migration can be scoped — or
even sized — until the data behind it is located.

**Cost of staying blocked:** low now, high from F3. Resolve it early; it is a
question, not a project.

---

## B-05 — Hosting and data residency determination

**Blocks:** Any production deployment
**Unblocked by:** Executive management, on a qualified legal determination plus costed options
**Related:** ADR-0002, [`../compliance/data-residency-gate.md`](../compliance/data-residency-gate.md)

Not blocking lab work. **Blocking production**, absolutely. Recorded here so it is
never passed by inertia.

---

## Not blocked, but frequently assumed to be

| Thing | Status |
|---|---|
| Lazywait replacement | **Not blocked.** The surface is three endpoints and a webhook |
| Offline and sync design | **Not blocked.** Spikes run against a local database |
| Print durability | **Not blocked** for the queue design; physical printer testing needs lab hardware |
| Menu, orders, identity | **Not blocked.** Proceed |
