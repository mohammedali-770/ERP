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
**Ready to send:** [`enablement/02-acquirer-questionnaire.md`](./enablement/02-acquirer-questionnaire.md)
— asks the decisive query-by-reference question as A1, and turns the choice into
a comparison rather than research
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

- Two of the ten acceptance scenarios cannot be **evidenced**: `T-04` (payment
  uncertainty) and `T-05` (automatic refund). Both are already **proved in
  simulation** by [`spikes/payment-reconciliation`](../../spikes/payment-reconciliation)
  — zero double charges under induced ambiguity, refunds idempotent under retry.
  What is missing is the provider-side half of their evidence: a transaction list
  to reconcile ours against. That is a narrower gap than "cannot be evidenced"
  suggests on its own.
- ACC-003 (accurate payments, refunds, cash shifts and blind closing) cannot be
  signed off, so **the F1 milestone would be partial even if everything else lands.**
- A payment terminal (ECR) spike **has not been written and could not usefully be**:
  unlike the reconciliation logic, the thing under test *is* the terminal protocol,
  so there is nothing meaningful to simulate. It needs the real acquirer and
  terminal, and inducing timeouts against production is not an option.

### What proceeds regardless

The payment state machine, intent/attempt/outcome model, refund idempotency and
reconciliation ladder are built and tested against a simulator. The provider is a
replaceable adapter. When selection happens, the work is integration, not design.

### Recommended action

**Put this to executive management now.** Not because the decision itself has a
long lead time, but because of what has to happen after it: the decision calendar
in [`executive-decision-pack.md`](./executive-decision-pack.md) puts **D-1 at
month 5** of the nine-month `REL-004` milestone, and says plainly that below that
point "payment integration and certification cannot finish inside the window".
The constraint is the **four months of integration and certification runway** the
decision leaves behind it, not the decision.

Presented as **D-1** in
[`executive-decision-pack.md`](./executive-decision-pack.md), with the
query-by-reference question, the cost of the human-attestation fallback, and the
month-5 deadline stated.

---

## B-02 — ZATCA sandbox onboarding

**Blocks:** Deferred synchronisation, clearance, signatures and certificates · the
remaining half of T-09
**Unblocked by:** Finance, with ZATCA onboarding credentials
**Ready to send:** [`enablement/04-zatca-sandbox-request.md`](./enablement/04-zatca-sandbox-request.md)
— covers **both** halves this entry names: the access request and the business
decision about a B2B invoice requested during an outage
**Related:** ADR-0006 · [`spikes/zatca-counter-chain`](../../spikes/zatca-counter-chain)

**Narrowed on 2026-09-21, by building the half that was never blocked.**

This entry said B-02 blocks "the ZATCA offline-issuance spike". No such spike
existed — and T-09 already recorded, in its own words, that "the local counter and
hash chain could be proved without sandbox credentials; the
deferred-synchronisation half could not". ADR-0006 went further and said counter
reuse after a restore "is tested explicitly in the ZATCA spike", present tense,
about a spike that had never been written.

[`spikes/zatca-counter-chain`](../../spikes/zatca-counter-chain) now proves that
half and runs in CI: per-unit counters incrementing by exactly one with no gaps,
the previous-invoice-hash chain verified end to end from the genesis PIH, a
restart that rewinds nothing, and the restore-from-backup case ADR-0006 calls a
compliance breach — a restored device refuses to issue until it has reconciled
against the issuance log. Three controls must fail for the run to mean anything:
an undetected restore, one counter shared across devices, and a relinked invoice.

**What is still genuinely blocked** needs ZATCA to be reachable and is not
simulated, because simulating a clearance response would manufacture confidence
rather than evidence: deferred synchronisation, clearance, signatures,
certificates and registered device identities.

Also still needed: the **business decision, not only credentials**.

Also needs a **business decision, not only credentials**: what happens when a
business customer requests a tax invoice during a connectivity outage. Standard
B2B invoices require clearance before issuance and cannot be issued offline.
Somebody must decide whether the request queues or is refused, and what the cashier
says.

**Cost of staying blocked:** lower than recorded. PAY-016..018's counter and chain
properties are now proven, and `ACC-005` has partial producible evidence rather
than none. **PAY-019 and the deferred-synchronisation half remain unproven**, and
ACC-005 cannot be closed until clearance is exercised against the sandbox.

---

## B-03 — Branch access for the two procedure spikes

**Blocks:** `spikes/lan-peer-sync` · `spikes/ios-durability` · ADR-0004 (the
hardware decision) · acceptance evidence for `PRN-014`, `OFF-012`, `OFF-013` and
`OFF-014`, which name no other test
**Unblocked by:** IT, with access to a real branch network, real iPads and a
real LAN printer — or a faithful replica of each
**Ready to send:** [`enablement/01-network-capability-check.md`](./enablement/01-network-capability-check.md)
— covers the **network half only**: two laptops, thirty minutes, no iPads and no
till software. The iPad and printer halves still need a branch visit.

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

**`POS-008` was on that list and should not have been.** Re-read on 2026-09-21:
the other four name the lab explicitly — "the lab shall compare", "no hardware
model shall be approved before … tests are passed in the HQ lab". `POS-008` says
something different: *operational correctness, transaction integrity and
recoverability shall take priority over minimizing order-entry seconds.* That is
a priority rule about a trade-off, not a claim about branch Wi-Fi or iPad
durability, and it is the only one of the five owned by Operations management
rather than IT.

It is exercised by `spikes/offline-sync`, which sustains throughput while proving
zero lost and zero duplicated accepted orders — the trade-off actually being made
— and which runs in CI today. That reference has been **added**, not substituted:
the two procedure spikes stay, because the hardware choice does bear on whether
the priority is maintainable. **Operations management still needs to confirm it**,
per the seeding note in `annotations.yaml`. The warning count is now four.

**This is the cheapest high-value test in the programme and should run in week 1–2.**

The decisive part needs **two laptops and half an hour** — no iPads, no device
management, none of the till software. Written up for IT as
[`enablement/01-network-capability-check.md`](./enablement/01-network-capability-check.md).
The full device-level spike does need the application and comes later.

**Cost of staying blocked:** the hardware decision drifts toward month 8, where
OFF-014 requires it to be settled by evidence anyway — at which point changing
course is expensive.

**A wider question came out of this.** `evidence-is-producible` inspects only
`SPIKE-` references, so it cannot see that **57 requirements rest solely on lab
scenarios (`T-xx`, `UAT-xx`) that need an HQ lab which does not exist yet**.
There is a defensible reason — a blocked spike was meant to produce evidence at
F0, a lab scenario during F1 acceptance — but that distinction is written down
nowhere and the gate's meaning depends on it. Raised as
[Q-18](./open-questions.md).

---

## B-04 — Warehouse system database identity

**Blocks:** F3 migration scoping
**Unblocked by:** Whoever holds the deployment environment for that system
**Related:** ADR-0011, [`../estate/migration-map.md`](../estate/migration-map.md)

The existing warehouse and factory system reads its database connection from an
untracked environment file, so its live database has not been identified.

**Narrowed on 2026-09-21 by reading the repository, read-only.** Most of what
this blocker was thought to withhold is already in the repository.

**The schema is not missing.** `ExsistingWarehouseFactorySystem` carries **59
migrations**, 2025-10-09 to 2026-05-07, and `SETUP_GUIDE.md` names every table:
`profiles`, `branches`, `items`, `orders`, `order_items`, `suppliers`,
`warehouse_units`, `raw_materials`, `warehouse_purchase_orders`,
`warehouse_po_items`, `raw_material_purchase_orders`, `raw_material_po_items`,
`production_batches`, `production_inputs`, `production_outputs`,
`warehouse_stock`, `factory_stock`, `stock_adjustments`. The domain model that
F3 treats as its de-facto specification is fully recoverable **without** the live
database. So this entry's claim that no migration can be *scoped* is too strong:
**scoping can start now. Sizing cannot**, because row counts, data quality and any
drift between those migrations and what is actually deployed all need the
database itself.

**Where the identity actually lives.** `src/lib/supabase.ts` reads
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `.env` is gitignored, which is
why it was never in the repository. **`VITE_SUPABASE_URL` is the answer** — it is
`https://<project-ref>.supabase.co`, and the ref is the database's identity.

Three routes, cheapest first:

1. **The deployed application's JavaScript bundle.** Vite inlines `VITE_*` at
   build time, so the project ref is already baked into whatever is serving the
   app. Anyone who can load it can read the ref out of the bundle — no server
   access, no credentials, no waiting on anyone.
2. **The `.env` on the machine that builds or deploys it.**
3. **The Supabase dashboard of the account that owns it.**

**It is not in the Supabase account this programme can see.** Checked read-only:
the organisation `Spicy Meal Org` holds exactly two projects, and neither is this
system. `spicy-meal-ordering`'s migration history is ordering, loyalty, payments
and Lazywait from 2026-07-08 onward, and `whatsapp-inbox-simple`'s is thirteen
inbox migrations from September 2026 — neither shows any of the 59 above. So the
warehouse database lives in **a different Supabase account or organisation**, and
whoever holds it is a person, not a setting.

**Cost of staying blocked:** lower than recorded, because the schema is in hand
and F3 scoping is no longer waiting on this. Sizing and drift still are. Resolve
it early; it is a question, and route 1 above may answer it in minutes.

---

## B-05 — Hosting and data residency determination

**Blocks:** Any production deployment
**Unblocked by:** Executive management, on a qualified legal determination plus costed options
**Ready to send:** both halves are already drafted —
[`enablement/03-counsel-brief-data-residency.md`](./enablement/03-counsel-brief-data-residency.md)
for the determination (§1 of the gate) and
[`enablement/05-cost-comparison-template.md`](./enablement/05-cost-comparison-template.md)
for the costed options (§2). **Instructing counsel has weeks of lead time and
depends on nothing**, so it is the part to start today
**Related:** ADR-0002, [`../compliance/data-residency-gate.md`](../compliance/data-residency-gate.md)

Not blocking lab work. **Blocking production**, absolutely. Recorded here so it is
never passed by inertia.

---

## B-06 — Credentials exposed in a repository's git history · **URGENT**

**Blocks:** Any call-centre integration work (do not build against known-exposed credentials)
**Unblocked by:** IT, by rotating them
**Related:** ADR-0016 · `../compliance/pdpl-assessment.md`

The `yeastarissue` repository contains a PBX diagnostic bundle with plaintext
credentials. **Inventoried against the bundle on 2026-09-21** — counts are exact,
and no value was read into this repository or any report.

| Configuration | Exposed | Count |
|---|---|---|
| `asterisk/pjsip_auth.conf` → `trunk-SIP-auth`, `pjsip_outreg.conf` → `trunk-SIP-registeration` | **SIP trunk credential** | **1** |
| `asterisk/users.conf` | Extension secrets | **44** |
| `asterisk/manager.conf` | AMI account secrets — `LinkusUser`, `basicsrv` | 2 |
| `openapi.log` | OpenAPI client identifier **and secret** | 1 |
| `asterisk/cdr_redis.conf` | Redis password | 1 |
| `asterisk/res_config_mysql.conf`, `voicemail_mysql.conf` | Database user, password and schema | 1 set |
| `asterisk/voicemail.conf` | Voicemail passwords | 2 |

**The trunk credential was not previously listed, and it belongs at the top.** An
extension secret lets someone register a handset to *your PBX*, which needs network
reach to it. A **trunk** credential authenticates the PBX to the **carrier** —
stolen, it places calls billed to your account from anywhere, without touching the
PBX at all. That is the standard toll-fraud route and the most expensive item here.
Whether that trunk is live should be confirmed rather than assumed.

**The extension count was also understated.** The rotation runbook asked whether to
rotate "every extension, or only those in the bundle (116–135, 222)". That range is
the 21 Linkus clients that happened to be *online* during the crash, not what the
bundle exposes: `users.conf` carries **44** secrets, for extensions across 100–137,
140, 150, 200, 201 and 222–224. The choice it offered rested on an undercount.

**Exposure shape, corrected.** This entry said the credentials are in *git history*,
so deleting the file would not remove them. They are in **the current tree of the
default branch** — the bundle is still the repository's HEAD content. The history
is three commits and the repository holds one tar and a 14-byte README.

| | |
|---|---|
| Committed | **2026-07-27 07:18**, merged 07:24 — exposed **~8 weeks** |
| Collaborators | **1** — the owner, `admin`. No other account has access |
| Visibility | Private |

**That makes removal unusually cheap.** The force-push hazard that normally makes
history rewriting a careful operation does not really apply: there is one
collaborator and no other clone to invalidate. And once the bundle has been sent to
Yeastar through their support channel — which B-07's ticket requires anyway — the
repository has no remaining purpose, so **deleting it outright removes the exposure
completely**, history included, with no rewrite at all. That is the owner's call and
should follow rotation, not precede it.

**Do not read anything into GitHub not having flagged this.** Secret scanning
detects known provider token formats; SIP, AMI and Redis passwords in Asterisk
config files are not among them. Silence here is not evidence of safety.

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
client dropped simultaneously.

**No vendor reply, ticket or resolution appears anywhere on record.**

**Re-examined against the diagnostic bundle on 2026-09-21**, which corrected one
claim and added one finding.

**Corrected — the `get_token` failure is not part of this incident.** This entry
and ADR-0016 both read as though `POST /openapi/v1.0/get_token` was failing
alongside the crashes. The bundle's `openapi.log` is **six lines**: six requests
from five source addresses between **15:20:01 and 15:23:06 on 14 October 2025**,
nine months before the crashes, each returning **HTTP 200** with
`{"errcode":-2,"errmsg":"INTERNAL SERVER ERROR"}` in the body — not HTTP 500.
There are no 2026 entries in that log at all. It has not been retested since, so
whether it still happens is unknown. Sending it to the vendor as a concurrent
symptom would have pointed them at the wrong year.

**Added — a kernel memory allocation failure, previously unrecorded.** At
**00:00:09 on 2026-07-27** the kernel logged an `order:0` `GFP_ATOMIC` page
allocation failure in the FEC ethernet receive path. The accompanying `Mem-Info`
shows ~2 GB RAM, **zero swap**, ~640 MB reserved to CMA, ~1 GB anonymous in use
and ~64 MB in writeback — leaving roughly **57 MB genuinely allocatable**. It
occurs **once**, and not at any of the three crash times, so it is evidence of a
marginal memory envelope rather than a demonstrated cause.

**What was ruled out.** `messages` contains no OOM kill and no
`No space left on device`; `nginx_error.log` spans 2024-05 to 2026-07 and shows
five routine notices on the incident day; the 124 `Internal Server Error` entries
in `apigateway.log` are all from **2026-02-11**. A disk-exhaustion theory was
tested against the bundle and is **not supported**.

**Firmware.** Running **37.23.0.123 (V24.3), released 2026-07-20 — six days
before the crashes.** Current GA is **37.24.0.73 (V25.2)**, 2026-09-15. Neither
V25.1 nor V25.2 release notes list an Asterisk crash, watchdog or stability fix,
so **upgrading is not a known remedy** and the ticket now asks that explicitly
rather than assuming it.

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
**Act on it with:** [`enablement/08-inbox-exposure-remediation.md`](./enablement/08-inbox-exposure-remediation.md)

Found on 2026-09-20 during a read-only survey of `whatsapp-inbox-simple`
(`hdeahrxjfqqaveharziy`), while assessing it as a possible home for the ERP
database (ADR-0018). **Re-verified read-only on 2026-09-21: all findings still
live.** Neither survey wrote anything; none of the below has been acted on.

| | Finding | Reachable by |
|---|---|---|
| 1 | **Four backup tables are anon-writable.** `inbox_bible_backup_v3`, `inbox_faq_backup_20260913`, `inbox_bible_backup_20260913`, `inbox_bible_backup_20260916` carry `anon=arwdDxtm` with RLS disabled — insert, update and delete, not only select | **The anon key, which ships in the client bundle** |
| 2 | **Three secrets are in plaintext** in `public.inbox_config` — `access_token`, `app_secret` **and `verify_token`**. Supabase Vault 0.3.1 is installed in this project and unused for them | Service-role key or database credentials |
| 3 | **`inbox_managers.login_code` is a plaintext shared code**, 10 characters, and is the entire authentication mechanism for the inbox's managers | Service-role key or database credentials |
| 5 | **`EXECUTE` on `inbox_record_inbound`, `inbox_apply_status` and `inbox_claim_ai_run` is granted to `PUBLIC`** — the Postgres default, not a decision | `anon`, but see below |

**Finding 4 has moved to [B-09](#b-09--customers-are-waiting-for-a-human-who-never-arrives--urgent).**
The survey recorded it as "may be silently dead"; re-verification confirmed it
dead and measured the cost, which turned out to be a customer problem rather than
a security one, with a different owner and no SQL that closes it.

**The reachability column is the correction that matters.** Only finding 1 is
reachable with a key that ships to customers' browsers. Findings 2 and 3 need
credentials that a limited set of people hold, and unlike B-06 were never in a git
history — so whether to rotate depends on who has held those credentials, which is
a question for the Owner rather than an assumption. Grouping all three as
"credential exposure" overstated 2 and 3 and understated 1.

**Finding 5 is latent, not live.** Those functions are `SECURITY INVOKER` and
`anon` holds no privileges on the tables they touch, so the calls would fail. It
is one keyword — `SECURITY DEFINER` — from becoming a public write path into the
message log, which is why it is worth closing, and why it is not an emergency.

**Why finding 1 is not simply "drop those tables" — and why it need not be.**
They are not redundant copies: `inbox_bible_backup_v3` differs from live in 6 of
12 rows and `inbox_faq_backup_20260913` in 9 of 23. They are the only version
history the AI knowledge base has, and `AI-013` requires versioned approved
sources. **But the exposure is privileges, not existence.** `revoke` plus
`enable row level security` shuts the write path and preserves every row, which
takes evidence capture off the critical path altogether. The other 17 tables in
this database are already in exactly that state, so this is not a novel
configuration. Read [`../estate/inbox-absorption.md`](../estate/inbox-absorption.md)
§1 before dropping anything later.

**Cost of staying blocked:** finding 1 is a live write path into the AI's
knowledge base, so a wrong answer could be planted rather than merely read. This
is the same shape as B-06: delay increases risk rather than deferring work.

**Related:** B-09 · ADR-0018 · B-06 · Q-10 · Q-17 · `../compliance/security-controls.md`

---

## B-09 — Customers are waiting for a human who never arrives · **URGENT**

**Blocks:** nothing in the ERP — recorded because it is live and has people on the
other end
**Unblocked by:** Owner, and whoever is accountable for inbox operations
**Act on it with:** [`enablement/09-inbox-backlog-triage.md`](./enablement/09-inbox-backlog-triage.md)
**Related:** B-08 · Q-17 · `AI-020` · `CRM-007` · `AI-012`

Found as finding 4 of B-08 and confirmed by measurement on 2026-09-21. The
original wording was "may be silently dead". It is dead, and the cost is
countable.

| | Measured 2026-09-21, read-only |
|---|---|
| Contacts flagged `needs_human` | **84** |
| Of those, **never sent a human reply** | **78** |
| Of those 78, where the AI **explicitly delegated** to a human | **77** |
| **Delegations made and ignored** (`inbox_ai_runs.status = 'delegated'`) | **165** |
| Most delegations for one person | **20** |
| Contacts carrying a `needs_human_note` | **78 — every one** |
| Notifications ever sent (`last_notified_at`) | **0**, across all 260 contacts |
| Conversations ever claimed, ever handled | **0** and **0** |
| `inbox_push_subscriptions` rows | **0** |
| Human outbound messages, all time | 18, against 449 from the AI |
| Complaints logged | **6**, between 2026-09-15 and 2026-09-18 |
| Oldest unanswered escalation | activity dating to **2026-09-03** |

**The AI did not fail quietly — it asked 165 times.** `delegated` is it
recognising its own limit and handing off, and it wrote a note every time saying
why. The handoff had no receiver. One customer was handed off twenty times.

**It is a live backlog, not a historical one:** 6 of the 78 were heard from in the
last 24 hours and **62 within 7 days**; only 16 have been quiet longer. By
subject: orders 33 contacts · delivery 18 · complaints 4 (23 delegations between
them) · everything else about 35.

**The obvious innocent explanation was checked and does not hold.** "People are
being helped, it just is not recorded" would show up as human outbound messages to
those contacts. Eighteen human replies exist in total and only six of them reached
a flagged contact, leaving 78 who asked for a human and received nothing.

**What is not yet known** is whether anyone is *supposed* to be working this
queue — whether `needs_human` was ever wired to a person, or was built and never
staffed. That is [Q-17](./open-questions.md), and it decides whether this is a
broken notification channel or an unowned process. **No fix should be designed
before that is answered**, because the two have different remedies.

**Helping these 78 people is not blocked on that, and should not wait for it.**
Every flagged conversation is already recorded and already visible to whoever
opens the inbox. A person can start working the 62 live ones today, with no code
change and no decision. Repairing notifications governs whether the queue *stays*
worked; it does nothing for the people already in it. Treating this as an
engineering task is the trap — it puts a build on the critical path of a customer
problem that does not need one.

**Cost of staying blocked:** 78 people are waiting now, six have complained, and
the counter rises with traffic — the most recent inbound message was 05:12:56 on
2026-09-21. This is the only blocker on this list where the cost is being paid by
customers rather than by the programme.

---

## Not blocked, but frequently assumed to be

| Thing | Status |
|---|---|
| Lazywait replacement | **Not blocked.** The surface is three endpoints and a webhook |
| Offline and sync design | **Not blocked.** Spikes run against a local database |
| Print durability | **Not blocked** for the queue design; physical printer testing needs lab hardware |
| Menu, orders, identity | **Not blocked.** Proceed |
