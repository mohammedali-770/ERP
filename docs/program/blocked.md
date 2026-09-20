# Blocked work

Work that cannot proceed, what unblocks it, and what it costs to stay blocked.

**This document exists so blockers are visible in month 1 rather than discovered
in month 7.** Every entry names who can unblock it.

Reviewed at every phase gate. The blockers needing an executive decision are
presented together in
[`executive-decision-pack.md`](./executive-decision-pack.md), and the
[`enablement/`](./enablement/) pack hands each blocker's owner something they can
act on without engineering present.

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

- Two of the ten acceptance scenarios cannot be evidenced: `T-04` (payment
  uncertainty) and `T-05` (automatic refund).
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

Presented as **D-1** in
[`executive-decision-pack.md`](./executive-decision-pack.md), with the
query-by-reference question, the cost of the human-attestation fallback, and the
month-5 deadline stated.

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

## B-03 — Branch access for the two procedure spikes

**Blocks:** `spikes/lan-peer-sync` · `spikes/ios-durability` · ADR-0004 (the
hardware decision) · acceptance evidence for `POS-008`, `PRN-014`, `OFF-012`,
`OFF-013` and `OFF-014`, which name no other test
**Unblocked by:** IT, with access to a real branch network, real iPads and a
real LAN printer — or a faithful replica of each

Both spikes are written as procedures rather than code because they test physical
properties, of the branch network and of iOS, that a simulation would not prove.
`req-lint` therefore treats a requirement evidenced only by them as having no
acceptance evidence, and says so under the F0 exit gate. Scoped to the network
alone until 2026-09-18, which left the iOS spike blocked by nothing anyone
tracked.

The iPad-only deployment assumes branch Wi-Fi permits client-to-client traffic and
mDNS discovery. **Many managed networks enable access-point client isolation by
default.** If it cannot be disabled on the production estate, peer replication is
impossible and a branch controller becomes mandatory.

**This is the cheapest high-value test in the programme and should run in week 1–2.**

The decisive part needs **two laptops and half an hour** — no iPads, no device
management, none of the till software. Written up for IT as
[`enablement/01-network-capability-check.md`](./enablement/01-network-capability-check.md).
The full device-level spike does need the application and comes later.

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

## B-06 — Credentials exposed in a repository's git history · **URGENT**

**Blocks:** Any call-centre integration work (do not build against known-exposed credentials)
**Unblocked by:** IT, by rotating them
**Related:** ADR-0016 · `../compliance/pdpl-assessment.md`

The `yeastarissue` repository contains a PBX diagnostic bundle with plaintext
credentials:

| Configuration | Exposed |
|---|---|
| `openapi.log` | OpenAPI client identifier **and secret** |
| `asterisk/manager.conf` | Both AMI account secrets |
| `asterisk/cdr_redis.conf` | Redis password |
| `asterisk/pjsip_auth.conf`, `users.conf` | SIP authentication |
| `res_config_mysql.conf`, `voicemail.conf` | Database and voicemail credentials |

The repository is private, which limits exposure — but these are in **git
history**, so deleting the file does not remove them. Every one should be rotated.

**There is a second exposure in the same bundle.** It contains three Asterisk core
dumps of 202–451 MB. A core dump is a snapshot of process memory, which for a PBX
can contain SIP credentials, call audio buffers and customer telephone numbers.
That makes this a personal-data question as well as a security one, and it is
recorded in the privacy assessment rather than treated as purely an IT matter.

**Cost of staying blocked:** building an integration against credentials already
known to be compromised means doing the work twice.

**Ready to execute:** [`enablement/07-credential-rotation-runbook.md`](./enablement/07-credential-rotation-runbook.md)
— which credentials, in what order, and what breaks if done wrong.

---

## B-07 — PBX platform stability unresolved

**Blocks:** Meaningful start on CC-001..CC-008 and the callback feature
**Unblocked by:** IT, with a vendor support ticket and a resolution
**Related:** ADR-0016

On the captured day the PBX's Asterisk process **segfaulted three times**. The
watchdog restarted it at 05:01, 15:42 and 20:57, and each time every softphone
client dropped simultaneously. Separately, `POST /openapi/v1.0/get_token` — the
call every integration begins with — was returning `INTERNAL SERVER ERROR`.

**No vendor reply, ticket or resolution appears anywhere on record.**

**Why this blocks rather than merely complicates:** building a screen pop on a
platform that crashes daily produces an ERP that appears broken when it is not,
and makes every integration defect ambiguous — ours or theirs? The design already
assumes reconnection and backfills after an outage, so the architecture survives
this. The *diagnosis* of future problems does not.

**Cost of staying blocked:** low today, because CC work is F2. It becomes the
critical path the moment call-centre work starts, and a vendor ticket has lead
time.

**Ready to send:** [`enablement/06-pbx-vendor-ticket.md`](./enablement/06-pbx-vendor-ticket.md)
— drafted with the evidence assembled; fill in three fields and send.

---

## B-08 — Live exposure in the WhatsApp inbox project · **URGENT**

**Blocks:** nothing in the ERP — recorded because it is live, not because it
blocks
**Unblocked by:** Owner or IT, as owner-approved actions against a live project

Found on 2026-09-20 during a read-only survey of `whatsapp-inbox-simple`
(`hdeahrxjfqqaveharziy`), while assessing it as a possible home for the ERP
database (ADR-0018). The survey wrote nothing; none of the below has been acted
on.

| | Finding |
|---|---|
| 1 | **Four backup tables are anon-writable.** `inbox_bible_backup_v3`, `inbox_faq_backup_20260913`, `inbox_bible_backup_20260913`, `inbox_bible_backup_20260916` carry `anon=arwdDxtm` with RLS disabled — insert, update and delete, not only select, with the anon key that ships in the client bundle |
| 2 | **The WhatsApp access token and app secret are in plaintext** in `public.inbox_config`. Supabase Vault is already installed in this project and unused for them. Same class as B-06 |
| 3 | **`inbox_managers.login_code` is a plaintext shared code** and is the entire authentication mechanism for the inbox's managers |
| 4 | **The escalation-to-human channel may be silently dead.** `inbox_push_subscriptions` has zero rows while `inbox_contacts.last_notified_at` exists to throttle notifications to it — worth checking today, independent of anything ERP |

**Why finding 1 is not simply "drop those tables".** They are not redundant
copies: `inbox_bible_backup_v3` differs from live in 6 of 12 rows and
`inbox_faq_backup_20260913` in 9 of 23. They are the only version history the AI
knowledge base has, and `AI-013` requires versioned approved sources. **Read
[`../estate/inbox-absorption.md`](../estate/inbox-absorption.md) §1 before
touching them** — it says which two are genuinely disposable and what to capture
from the other four first.

**Cost of staying blocked:** finding 1 is a live write path into the AI's
knowledge base, so a wrong answer could be planted rather than merely read.
Findings 2 and 3 are credential exposures on a working system. This is the same
shape as B-06: delay increases risk rather than deferring work.

**Related:** ADR-0018 · B-06 · Q-10 · `../compliance/security-controls.md`

---

## Not blocked, but frequently assumed to be

| Thing | Status |
|---|---|
| Lazywait replacement | **Not blocked.** The surface is three endpoints and a webhook |
| Offline and sync design | **Not blocked.** Spikes run against a local database |
| Print durability | **Not blocked** for the queue design; physical printer testing needs lab hardware |
| Menu, orders, identity | **Not blocked.** Proceed |
