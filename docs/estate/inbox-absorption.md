# Absorbing the WhatsApp inbox into the ERP

How `whatsapp-inbox-simple` becomes a feature of First Taste ERP rather than a
separate system — table by table, with what is lost if it is done carelessly.

**Surveyed read-only on 2026-09-20, re-verified read-only on 2026-09-21.** Nothing was modified. Where this document
says a thing must be captured, capturing it is an owner-approved action
(`CLAUDE.md` §1, §4), not something an agent session performs.

Related: [ADR-0018](../adr/ADR-0018-erp-database-home.md) — why the absorption
happens at the data seam and not by sharing a database. [B-08](../program/blocked.md)
— the live exposure found while surveying.

---

## The shape of the system

| | |
|---|---|
| Project | `whatsapp-inbox-simple`, ref `hdeahrxjfqqaveharziy`, `eu-central-1` |
| Tables | 21 — **15 live, 6 backups** |
| Migrations | 13, `20260910050840` … `20260915103419` |
| Functions | **7** in `public`; three are `SECURITY DEFINER` pinned to `search_path = public` |
| Edge functions | none · `pg_cron` none · `pg_net` none |
| Live rows | 1238 messages, 247 contacts, 691 AI runs, 412 FAQ variants, 279 answer gaps |

A small, self-contained system with no background machinery. That is what makes
absorbing it tractable.

---

## Five things that cannot be reconstructed later

Ordered by how completely they disappear. Each is cheap to capture now and
impossible afterwards — the same class as `business_date` (Q-06) and the call
identifier (Q-14).

### 1. The backup tables are not redundant copies

Dropping the four insecure backup tables would destroy the only version history
the AI knowledge base has. The live tables keep none.

**That is a reason to be careful about dropping them, not a reason to leave them
exposed.** B-08 originally read as a choice between the two; it is not. The
exposure is *privileges*, not existence — `revoke` plus `enable row level
security` shuts the write path and preserves every row, and the other 17 tables in
this database are already in exactly that state.
[`../program/enablement/08-inbox-exposure-remediation.md`](../program/enablement/08-inbox-exposure-remediation.md)
step 1 has the statements. Capture is then unhurried follow-up work rather than
a race, and what follows is about capture.

| Table | Divergence from live | Verdict |
|---|---|---|
| `inbox_bible_backup_v3` | **6 of 12 rows differ** | Capture — the only record of an earlier prompt state |
| `inbox_faq_backup_20260913` | **9 of 23 rows differ**, and 3 live keys did not yet exist | Capture — the only evidence of what customers were told before 13 Sep |
| `inbox_bible_backup_20260913` | 3 of 12 differ | Capture those 3 |
| `inbox_bible_backup_20260916` | 1 of 12 differs | Capture that 1; it is the only snapshot whose date is evidenced in data |
| `inbox_bible_backup_v1` | identical to live | Retire after noting its timestamp |
| `inbox_bible_backup_20260910` | 6 rows, all matching live | Retire after recording that the corpus doubled since |

**The naming actively misleads:** `v1` is current and disposable, while `v3` is
the most divergent and the most valuable. `AI-013` requires versioned approved
sources with references; drop these and it becomes retrospectively unsatisfiable.

### 2. The phrase normaliser does not exist in the database

`inbox_faq_variants` holds **412 hand-curated Arabic phrasings** whose `norm`
column is produced by an application-side normaliser. None of the seven SQL
functions normalises text. **The algorithm is not recoverable from the database** —
if that application code is lost, 412 curated variants become unusable, because
nothing can reproduce the form they were matched in.

Capture the normaliser's source, not just its output.

### 3. Customer identity is stored in a form `APP-004` forbids

`inbox_contacts.wa_id` is both the primary key and the raw Meta identifier —
digits, no `+`, written verbatim. `inbox_record_inbound` performs no
normalisation. `APP-004` requires one canonical stored mobile form, and `Q-07`
asks whether one person is one customer across brands.

Every downstream table keys on `wa_id` as text. Deciding the canonical form
before absorption is cheap; re-keying 1238 messages and 691 AI runs afterwards is
not.

### 4. Menu and branch history was never kept

`inbox_menu_items` holds 52 items and 72 prices as a **flat global snapshot with
no effective dating and no version history**. `MNU-011` and `MNU-015` require
both, so historical answers retain the prices that applied at the time. That
history does not exist and cannot be back-filled — `inbox_ai_runs` records which
FAQ key was selected but never the answer text.

`inbox_branches.aliases` is the opposite problem: only 4 of 17 rows carry them,
but they are **customer vernacular harvested from real conversations** —
landmark names, district nicknames. Nothing regenerates that; it came from
people talking.

### 5. Counters with no events behind them

`inbox_answer_gaps.occurrences` is a bare counter — 279 rows, 394 occurrences —
with no event rows behind it. `AI-020` wants coverage measured over time; the
history is already gone and only the running totals survive.

---

## Table-by-table map

`absorb` — its data moves into an ERP concept · `supersede` — the ERP has a
better home and this becomes a view or retires · `retain` — inbox-specific,
stays with its connector · `retire` — disposable once recorded.

### Identity and conversation

| Table | Rows | → | ERP home | Requirements |
|---|---|---|---|---|
| `inbox_contacts` | 247 | absorb | CRM customer, one profile per verified mobile | `CRM-001` `CRM-002` `APP-003` `APP-004` `SEC-008` |
| `inbox_messages` | 1238 | absorb | Unified inbox conversation and transcript | `MKT-004` `MKT-005` `CRM-007` `SEC-005` `SEC-008` |
| `inbox_managers` | 1 | **supersede** | IAM employees, roles, capabilities | `IAM-001` `IAM-002` `IAM-003` `SEC-003` |
| `inbox_push_subscriptions` | 0 | supersede | ERP notification delivery | `SUP-005` `SUP-006` `IAM-006` |

**`inbox_managers` cannot travel.** `login_code` is a unique **plaintext shared
code** and is the entire authentication mechanism. `IAM-001` requires an employee
identity and password, `IAM-002` requires MFA for administrators, and `SEC-003`
forbids storing credentials this way. It is replaced, not migrated.

**`inbox_messages` is bulk personal data.** The raw `jsonb` is the entire Meta
webhook payload — profile name, phone number, message text, media identifiers —
across 1238 rows, unmasked, with no retention rule. `SEC-005`, `SEC-008` and
`CRM-011` all attach the moment it moves, and `SEC-012` forbids it reaching
non-production unmasked.

**A zero-row table that is a finding, not an absence.** `inbox_push_subscriptions`
is empty while `inbox_contacts.last_notified_at` exists to throttle notifications
to it. That was recorded here as "may be silently dead". **It was measured on
2026-09-21 and it is dead: 84 contacts flagged `needs_human`, 78 of them never
sent a human reply, and not one notification ever dispatched.** Raised as
[B-09](../program/blocked.md), with [Q-17](../program/open-questions.md) asking
the question that decides the remedy — whether anyone was ever meant to work that
queue.

### Knowledge and answer quality

| Table | Rows | → | ERP home | Requirements |
|---|---|---|---|---|
| `inbox_bible` | 12 | absorb | Versioned AI knowledge source | `AI-013` `AI-008` `MNU-001` |
| `inbox_faq` | 26 | absorb | Approved answer set | `AI-008` `AI-002` `CRM-007` |
| `inbox_faq_variants` | 412 | absorb | Intent-matching phrase set | `AI-008` `AI-020` `PRG-014` |
| `inbox_answer_gaps` | 279 | absorb | AI coverage measurement | `AI-020` `AI-017` `SEC-008` |
| `inbox_reply_reports` | 0 | absorb | AI finding challenge record | `AI-019` `AI-012` |
| `inbox_auto_fixes` | 0 | supersede | ERP AI action log | `AI-012` `AI-015` `SEC-006` |

**`inbox_faq.answer_kind` is a dispatch opcode, not content.** Eight of 26 rows
carry empty `answer_ar`/`answer_en` and exist only to trigger behaviour —
`branch_delivery`, `branch_count`, `branch_hours`, `branch_info`, `menu_item`, and
three escalations. **A data-only migration silently turns those into blank
answers.**

**`inbox_bible` restates managed data.** Roughly 13.7 KB of its 37 KB repeats
prices, hours and payment rules that `MNU-001` and `MNU-009` place under
head-office control. Absorbing it verbatim creates a second source of truth for
figures the ERP already owns.

**Two zero-row tables must not be inherited as validated vocabulary.**
`inbox_reply_reports` has a schema and no exercised workflow, so its `CHECK`
enums are an untested taxonomy. `inbox_auto_fixes` has **no actor column at all** —
`reverted_at` with no `reverted_by` — which `SEC-006` explicitly requires.

### Reference data and AI accountability

| Table | Rows | → | ERP home | Requirements |
|---|---|---|---|---|
| `inbox_branches` | 17 | absorb | Facility in the company hierarchy | `PRG-002` `PRG-003` `APP-006` `MNU-005` |
| `inbox_menu_items` | 52 | **supersede** | Menu product and variant, effective-dated | `MNU-001` `MNU-011` `MNU-015` |
| `inbox_config` | 1 | **retain** | WhatsApp connector configuration | `SEC-002` `SEC-010` `MKT-009` |
| `inbox_ai_runs` | 691 | absorb | AI action and decision ledger | `AI-012` `AI-015` `SEC-006` |
| `inbox_guard_violations` | 40 | absorb | AI guardrail evidence | `AI-011` `AI-015` `AI-020` |

**`inbox_config` is retained but must be split before it moves.** `MKT-009`
requires connectors to be replaceable, so channel state belongs with its
connector. But the row holds a **WhatsApp access token and app secret in
plaintext** — the values are not reproduced here or anywhere in this repository;
the location is `public.inbox_config` in project `hdeahrxjfqqaveharziy`. They
belong in Vault, which is already installed. `SEC-002`, `SEC-003` and `SEC-010`
apply; this is the same class of finding as B-06 and is recorded in B-08.

**`inbox_guard_violations` is small and that is the point.** Forty rows is the
only record that the automation *refused to guess* — 33 `branch.unknown`
(not blocked), 3 `phone.foreign` (blocked). It is exactly the evidence `AI-020`
needs for harmful-action prevention and `AI-015` for guardrail effectiveness.

**`inbox_ai_runs` satisfies `AI-012` only partially.** Present: trigger, output,
result, cost proxies. Missing against what `AI-012` requires: model or agent
identity, the inputs, the tools used, and approvals.

---

## Sequence

Each step is an owner-approved action. None is startable before the one above it.

| | Step | Depends on |
|---|---|---|
| 1 | Close B-08 — `revoke` and enable RLS, which preserves every row; see §1 | — |
| 2 | Capture the six backup tables as a dated version history, then retire the two disposable ones | 1 |
| 3 | Capture the application-side phrase normaliser's source | — |
| 4 | Decide the canonical mobile form (`APP-004`) and whether one person is one customer (`Q-07`) | Product Owner |
| 5 | Answer `Q-13` — does the ERP's WhatsApp channel come from this inbox or from the PBX? Two systems can claim one number | Product Owner |
| 6 | Build the ERP's CRM, menu and intelligence contexts | ADR-0003, and the ERP's own project |
| 7 | Move the data, re-keyed to canonical identity | 4, 6 |
| 8 | Retire the standalone inbox; the connector stays, the system does not | 7 |

**Step 5 is not a formality.** `Q-13` has been open since the call-centre work,
and the Yeastar PBX ships its own WhatsApp capability. A WhatsApp number binds to
one Business API endpoint; deciding by collision is the failure mode.
