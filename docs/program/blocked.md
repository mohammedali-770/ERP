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

## B-04 — Warehouse system database identity · **ANSWERED 2026-10-01**

**Blocks:** nothing further — the database is identified
**Answered by:** reading the warehouse repository, read-only
**Related:** ADR-0011, ADR-0020, [`../estate/migration-map.md`](../estate/migration-map.md)

**The database is `warehouse-factory-system`, project ref `dyhkydedckizhxckryvq`,
region `eu-central-1`, Postgres 17, status `ACTIVE_HEALTHY`.** It is in the
organisation that already holds `spicy-meal-ordering`, and it is on the **free
plan**, which means no point-in-time recovery.

It is named in three places in the warehouse repository — its `CLAUDE.md:7`, its
`.env.example:3` and `docs/SYSTEM.md:95-96` — and confirmed against the live
account by a read-only project listing on 2026-10-01.

**This entry was not wrong when it was written.** On 2026-09-21 it recorded that
the organisation held exactly two projects and neither was this system. That was
true: the project was **created 2026-09-27T05:13:48Z**, six days later. The
blocker was overtaken by events rather than mistaken, and the reasoning below is
left intact because the route it identified is the one that paid off — the answer
came out of the repository, for free.

**What remains is not identity but residency and durability**, which is
[Q-20](./open-questions.md) and B-05: a payroll-adjacent financial record on a
free-tier project in Frankfurt.

The original entry follows, for the record.

The existing warehouse and factory system reads its database connection from an
untracked environment file, so its live database has not been identified.

**Narrowed on 2026-09-21 by reading the repository, read-only.** Most of what
this blocker was thought to withhold is already in the repository.

**The schema is not missing.** `ExsistingWarehouseFactorySystem` carries **59
migrations**, 2025-10-09 to 2026-05-07, which between them create **28 tables**.
`SETUP_GUIDE.md` names **18 of those 28** — not every table, as this entry
previously claimed. The ten it omits are the eight daily-snapshot tables
(`daily_production_entries`, `daily_process_entries`, `daily_supply_entries`,
`daily_withdrawal_entries`, `daily_employee_meal_entries`, `daily_item_snapshots`,
`daily_raw_material_snapshots`, `daily_factory_operations`) plus `order_history`
and `trigger_debug_log`. **The conclusion below still holds — the migrations carry
all 28 — but it rests on the migrations, not on the setup guide.** Checked
2026-09-22 by counting `create table` across all 59.

The 18 the guide does name:
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

Routes, cheapest first. **Reordered on 2026-09-22 after reading the repository:**

1. **The bolt.new project, `sb1-vseddlse`.** The repository's README is three
   lines, and one of them is an *Open in Bolt* badge pointing at
   `https://bolt.new/~/sb1-vseddlse`. This system was generated in bolt.new and
   runs in its WebContainer, where the `.env` holding `VITE_SUPABASE_URL` lives.
   **Whoever can open that project reads the ref directly.** This route was not
   previously listed and is cheaper than everything below it.
2. **The `.env` on the machine that builds or runs it.**
3. **The Supabase dashboard of the account that owns it.**

> **The route this entry previously called cheapest may not exist.** It named
> "the deployed application's JavaScript bundle", on the reasoning that Vite
> inlines `VITE_*` at build time — which is true, and is how the ref would be
> recovered *if the application were deployed somewhere*. Checked 2026-09-22:
> the repository has **no CI, no `.github/`, no `vercel.json`, no `netlify.toml`,
> no Dockerfile and no deployment reference in any file**, and its setup guide
> says the application "will start automatically", which is bolt.new's
> WebContainer rather than a host. Nothing in the repository evidences a
> deployed instance. If one exists, route 1's logic is sound and it is still the
> cheapest — but its existence is an assumption, and this entry presented it as
> a fact that would "answer in minutes".

**It is not in the Supabase account this programme can see.** Checked read-only:
the organisation `Spicy Meal Org` holds exactly two projects, and neither is this
system. `spicy-meal-ordering`'s migration history is ordering, loyalty, payments
and Lazywait from 2026-07-08 onward, and `whatsapp-inbox-simple`'s is thirteen
inbox migrations from September 2026 — neither shows any of the 59 above. So the
warehouse database lives in **a different Supabase account or organisation**, and
whoever holds it is a person, not a setting.

**`.env` was never committed, and that is now verified rather than assumed.** The
repository has two commits in its entire reachable history, `.gitignore` covered
`.env` in the first of them, and no `supabase.co` host or project-ref-shaped
string appears anywhere in the working tree or that history. So the ref genuinely
is not recoverable from the repository, by any route.

**The predecessor cannot be used as a substitute.** `SpicyMealFactoryWarehouse`
is public and is the better-engineered of the two — 49 migrations, vitest,
prettier, full Supabase CLI tooling, and an `.env.example` pointing at
`http://127.0.0.1:54321`, so it was built local-first and names no hosted project
either. **49 migrations against 59 is a different schema state**, so its database,
if it has one, is not safe to assume is this one's.

**Cost of staying blocked:** lower than recorded, because the schema is in hand
and F3 scoping is no longer waiting on this. Sizing and drift still are. Resolve
it early; it is a question, and **route 1 above may answer it in minutes for
whoever can open that bolt project.**

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

On **26 July 2026** the watchdog restarted Asterisk three times — at 05:01, 15:42
and 20:57 — and three Asterisk core dumps were produced whose filenames carry signal
11. **Two of the three are evidenced as user-visible outages**; `web_error.log`
records every client dropping at 15:42 and 20:57 and nothing at 05:01.

**Nothing in the diagnostic bundle records a vendor reply, a ticket or a
resolution.** Whether anyone raised one outside the bundle is a pre-send check on
the ticket, not something this entry can settle.

**Re-examined against the diagnostic bundle on 2026-09-21**, which corrected one
claim and added one finding, and **again on 2026-09-22**, which corrected three
more and added two. The 2026-09-22 pass read the archive directly rather than the
earlier write-up.

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
allocation failure in the FEC ethernet receive path. It occurs **once**, about
three hours after the third restart rather than at any of them.

> **Corrected 2026-09-22 — "marginal memory envelope" overstated it.** The
> `Mem-Info` was read as leaving "roughly 57 MB genuinely allocatable", and that
> figure is arithmetically right (free 87,726 pages less free_cma 73,614). But
> read on its own it says the appliance was nearly out of memory, and it was not:
> free was **350,904 kB against a min watermark of 22,528 kB**, about fifteen
> times it, with **11,909 free order-0 blocks**. A `GFP_ATOMIC` request cannot
> reclaim and cannot use CMA pages, so the ~57 MB is the pool that request could
> draw on — with ~64 MB in writeback at the time. That points at atomic-reserve
> and CMA composition under writeback pressure, not at exhaustion. The ticket now
> gives the vendor both figures and asks rather than concludes.

**Added — the process generations outnumber the logged restarts.** `trace-old.log`
and `trace-new.log` carry periodic process captures. The distinct `/bin/asterisk`
PIDs across them, in order, are **9096 · 9130 · 19360 · 22677 · 13362** — five
generations, so **at least four** restarts against the three `astguard.log`
records. Two of them (`9130`, `19360`) are core dumps, and the capture showing
9130 at 433 MB resident matches its 413 MB dump, which is also what dates the
dumps to this window: the archive's own timestamps are all packaging time.

**Corrected — the three restarts are not one homogeneous fault.** The 05:01 event
is **86 seconds after a cold boot** (`messages` logs `Booting Linux on physical
CPU 0x0` at 05:00:20) and astguard reports `asterisk run twice` — a duplicate
process, not an unresponsive one — recovering in about a second. The 15:42 and
20:57 events both report `asterisk didnot done===restart` / `can not connect to
asterisk` and take 21–22 seconds. `web_error.log` records client disconnections
in the two later windows and **none at 05:01**. Calling all three segfaults, as
this entry and ADR-0016 both did, is not supported.

**Corrected — no log records a segfault at all.** `Segmentation fault`, `SIGSEGV`,
`signal 11` and `core dump` appear in **zero** non-core files in the bundle. The
crash attribution rests entirely on the `.11` suffix in the three core filenames.
That is a fair reading of the default `core_pattern`, but it is an inference, and
every document here had stated it as a logged fact.

**What was ruled out.** `messages` contains no OOM kill and no
`No space left on device`; `nginx_error.log` spans 2024-05 to 2026-07 and shows
five routine notices on the incident day; the 124 `Internal Server Error` entries
in `apigateway.log` are all from **2026-02-11**. A disk-exhaustion theory was
tested against the bundle and is **not supported**.

**The bundle carries a stale subdirectory, and it has been misread before.** Its
`asterisk/` directory is a snapshot from **11 April 2026 running firmware
37.22.0.17**, not from the incident. Reading `asterisk/pbxlog.*` as incident
evidence gives answers three months out of date; the first pass on 2026-09-22 did
exactly that before catching it. The incident-day logs are the top-level ones.

**The appliance's serial is in the bundle: `3632D4574233`** (`basicsrv-run.log`,
`analytics.log`), with MAC `44:db:d2:00:f2:32`. The ticket no longer asks IT to
look either up — it asks them to confirm the serial. Neither is a credential; the
bundle's actual secrets are B-06's business and are named there by file.

**Firmware.** Running **37.23.0.123 (V24.3), released 2026-07-20 — six days
before the crashes.** Current GA is **37.24.0.73 (V25.2)**, 2026-09-15. Neither
V25.1 nor V25.2 release notes list an Asterisk crash, watchdog or stability fix,
so **upgrading is not a known remedy** and the ticket now asks that explicitly
rather than assuming it.

**Why this blocks rather than merely complicates:** building a screen pop on a
platform that restarts its telephony service three times in a day produces an ERP that appears broken when it is not,
and makes every integration defect ambiguous — ours or theirs? The design already
assumes reconnection and backfills after an outage, so the architecture survives
this. The *diagnosis* of future problems does not.

**Cost of staying blocked:** low today, because CC work is F2. It becomes the
critical path the moment call-centre work starts, and a vendor ticket has lead
time.

**Ready to send:** [`enablement/06-pbx-vendor-ticket.md`](./enablement/06-pbx-vendor-ticket.md)
— drafted with the evidence assembled; confirm the serial, fill in three fields
and send.

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

## B-10 — The warehouse system's authorisation surface, and a published demo password

> **Re-scoped down the same day it was opened.** This entry was written `**URGENT**`
> and described as an open incident, on the assumption that the warehouse system was
> in production. It is not. Checked read-only on 2026-10-01: **seven of its eight
> accounts are demo accounts**, against 18 items, 5 branches and 6 suppliers, with all
> five actors in `stock_movements` demo users. There is no business data behind the
> exposure.
>
> **What that changes:** the severity, not the facts. Every finding below is still
> true and still verified. What it is *not* is an emergency — it is a test project
> that should be tidied up, and under [ADR-0021](../adr/ADR-0021-one-project.md) it is
> decommissioned entirely at the end of the consolidation.
>
> **What to still do, and it is cheap:** confirm whether public sign-up is open and
> close it; enable leaked-password protection; set the demo profiles `is_active =
> false`. The deletion warning below no longer protects anything of value, but the
> advice stands on its own merits until the project is deleted outright.

**Blocks:** nothing. Housekeeping on a system scheduled for decommission
**Unblocked by:** IT and the owner, on the live `warehouse-factory-system` project
**Related:** ADR-0020, B-06 (same class), [`../estate/inventory.md`](../estate/inventory.md)

**Found 2026-10-01 while evaluating the consolidation. Verified against the live
project by Supabase's own security advisors, observed 06:57Z that day, and against
the warehouse repository read-only.**

Three facts that compound:

| | |
|---|---|
| **50 `SECURITY DEFINER` functions in `public`** are executable by the `authenticated` role over `/rest/v1/rpc/…` | Supabase advisor `authenticated_security_definer_function_executable`, count 50 |
| **Leaked-password protection is disabled** | Supabase advisor `auth_leaked_password_protection` |
| **A demo login's password is committed in the warehouse repository** | its `docs/SYSTEM.md:142-143` — named here by location only, never by value |

Those 50 functions run with the owner's rights and include `admin_delete_user`,
`admin_enable_user`, `close_month`, `reopen_month`, `set_stock_cost`,
`set_item_unit_price`, `void_supplier_invoice`, `record_supplier_payment`,
`import_master_data`, `import_opening_stock` and `accounting_journal`.

**This is not a claim that anyone can call them successfully.** Each carries its
own role check inside, read from `profiles.role` through
`private.current_user_role()`, which is a sound design and better than trusting JWT
metadata. The finding is narrower and still serious: **the entire authorisation
model of a financial system is fifty internal checks, each individually reachable
over HTTP by any signed-in session.** One function missing its check is a full
compromise, and nothing outside the function bodies prevents that.

What makes it urgent rather than architectural is the third row. The warehouse
repository documents demo logins — including an admin — with their password, and
`docs/SYSTEM.md:1059-1062` states public sign-ups are still enabled on the live
project. **The sign-up claim is the repository's, not independently verified here**,
and it is the first thing to check, because it is the difference between a published
password and an open door.

**The order matters, and the obvious order is wrong.** The repository ships
`remove_demo_data()` (`20261011090000_demo_data_removal.sql`), and running it first
looks like the fix. It is not: the warehouse carries **51 `ON DELETE CASCADE`
constraints**, and deleting demo users runs `delete from auth.users`
(`:167`) while `stock_movements.created_by` is `on delete set null`
(`20260929200000_stock_ledger.sql:14`). On a free-tier project with no
point-in-time recovery, that destroys attribution and any opening balance derived
from it, irreversibly. **Do the non-destructive containment first:** confirm whether
public sign-up is open and close it; enable leaked-password protection; set the demo
profiles `is_active = false`, which `private.current_user_role()` already treats as
removing every right; rotate the documented password. Only then consider deletion,
and only after an export has been taken and verified.

**Cost of staying blocked:** this is not a cost-of-delay item. It is a live
exposure on the system that holds the business's stock, costing and supplier
payments.

---

## B-11 — Attribution is destroyed by design in the warehouse system

> **Re-scoped 2026-10-01.** Opened on the assumption that this system's history would
> become the ERP's opening balance. Under [ADR-0021](../adr/ADR-0021-one-project.md)
> it will not: there is no real history — 18 items and seven demo users — and the data
> is discarded rather than migrated. **So this blocks nothing.**
>
> It is kept, rather than deleted, because it is a **design lesson the rebuilt schema
> must not repeat**: an actor reference that nulls on delete, a delete that removes
> the actor, and no actor column on line-level tables. The ERP's `I-8` exists for the
> same reason — a record that cannot be checked against its ledger is the failure the
> invariant forbids. Phase 4 of the plan inherits this as a constraint on every table
> it writes, not as a migration risk.

**Blocks:** nothing. Retained as a design constraint on the rebuilt schema
**Unblocked by:** writing the new schema so it cannot happen again
**Related:** B-10, ADR-0020, [`../compliance/pdpl-assessment.md`](../compliance/pdpl-assessment.md)

**Found 2026-10-01, read-only.** Deleting a user erases who did what, rather than
preserving it:

- `stock_movements.created_by` is `references auth.users(id) **on delete set
  null**` — `20260929200000_stock_ledger.sql:14`
- `admin_delete_user` runs `DELETE FROM auth.users WHERE id = p_user_id` —
  `20260928090000_fix_known_issues.sql:234`, and again at
  `20261013100000_test_fixes_users_accounting_security.sql:102`
- **51 `ON DELETE CASCADE` constraints** across the migrations
- line-level tables carry no actor column at all

So an administrator removing a departed employee silently rewrites the history of
every stock movement that employee made, to "nobody". For a system whose data is
proposed as the opening balance of a repository that **will hold payroll and
financial records**, that is a finding and not a note.

This repository's own `I-8` exists because a cached balance must be checkable
against its ledger. The warehouse equivalent cannot be checked against anything:
the actor is gone and the deletion left no trace. Any migration that takes
warehouse history as authoritative inherits that gap, which is why this is recorded
before the migration rather than discovered during it.

**Cost of staying blocked:** low today and rising with every row. The fix is cheap
now (`on delete set null` → retain, plus an actor column on line tables) and
expensive after a cutover makes the history authoritative.

---

## Not blocked, but frequently assumed to be

| Thing | Status |
|---|---|
| Lazywait replacement | **Not blocked.** The surface is three endpoints and a webhook |
| Offline and sync design | **Not blocked.** Spikes run against a local database |
| Print durability | **Not blocked** for the queue design; physical printer testing needs lab hardware |
| Menu, orders, identity | **Not blocked.** Proceed |
