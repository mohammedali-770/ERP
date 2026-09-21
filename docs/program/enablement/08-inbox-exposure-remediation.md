# Closing the WhatsApp inbox exposure

**For:** IT, with the Owner approving each step
**Unblocks:** B-08
**Time needed:** about 45 minutes for steps 1 and 2; steps 3 and 4 need a decision first

---

## What happened and what it means

While assessing `whatsapp-inbox-simple` (`hdeahrxjfqqaveharziy`) as a possible
home for the ERP database, a read-only survey found four security problems. They
were recorded in B-08 on 2026-09-20 and **re-verified read-only on 2026-09-21**.
All four are still live, and a fifth was found on re-verification.

Nothing in this document has been executed. **No agent session may write to this
project** (`CLAUDE.md` §1), and permission changes are owner-approved in any case
(§4). Every statement below is for a person to run deliberately.

**This is a working system with customers on it.** Last inbound message at
05:12:56 on 2026-09-21; 1336 messages; 260 contacts, up from 247 the day before.
Assume anything you change is in use.

## What is exposed

Ordered by **who can reach it**, which is what should drive the order you work in.

| | Problem | Reachable by | Blast radius |
|---|---|---|---|
| **1** | Four backup tables with RLS off and `anon` holding INSERT, UPDATE and DELETE | **Anyone with the anon key — it ships in the client bundle** | **Highest.** A write path into the AI's knowledge base. A wrong answer could be *planted*, not merely read |
| **2** | `access_token`, `app_secret` and `verify_token` stored in plaintext in `public.inbox_config` | Anything holding the service-role key or database credentials | WhatsApp account takeover — send as you, read your traffic |
| **3** | `inbox_managers.login_code`, a 10-character plaintext code, is the entire manager authentication mechanism | Same as above | Full inbox access as a manager |
| **5** | `EXECUTE` on three write-path functions granted to `PUBLIC` | `anon`, but see below | **None today.** Latent — see step 2 |

**Finding 4 is not in this table and is not IT's to fix.** It is a live customer
problem and has been split into its own blocker, [B-09](../blocked.md).

> **Note what is *not* exposed.** The other 17 tables in this database already
> have RLS enabled, no policies, and no `anon` or `authenticated` privileges —
> which is exactly the configuration step 1 puts the four backup tables into. This
> is not a novel change. It is making four tables match the other seventeen.

---

## Order matters

Step 1 is the only one reachable with a key that ships to customers' browsers. Do
it first even if you do nothing else today. Steps 3 and 4 need a decision before
they can be done safely.

### 1 · Close the anon write path — *do this first*

**Do not drop these tables.** B-08 originally framed the fix that way and then
warned that dropping destroys evidence. Both are true, and both are avoidable: the
exposure is *privileges*, not existence. Revoking closes the hole and preserves
every row, which takes the evidence-capture problem off the critical path
entirely. Read [`../../estate/inbox-absorption.md`](../../estate/inbox-absorption.md)
§1 for why those rows matter — `inbox_bible_backup_v3` differs from live in 6 of
12 rows and is the only record of an earlier prompt state.

Run for each of the four tables:

```sql
revoke all on public.inbox_bible_backup_v3       from anon, authenticated, public;
revoke all on public.inbox_faq_backup_20260913   from anon, authenticated, public;
revoke all on public.inbox_bible_backup_20260913 from anon, authenticated, public;
revoke all on public.inbox_bible_backup_20260916 from anon, authenticated, public;

alter table public.inbox_bible_backup_v3       enable row level security;
alter table public.inbox_faq_backup_20260913   enable row level security;
alter table public.inbox_bible_backup_20260913 enable row level security;
alter table public.inbox_bible_backup_20260916 enable row level security;
```

`from ... public` matters: a privilege can be held through `PUBLIC` rather than
granted to the role directly, and revoking only from `anon` would leave it in
place.

**Verify — this must return four rows, all false and all true:**

```sql
select c.relname,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
       c.relrowsecurity                             as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like '%backup%2026%' or c.relname = 'inbox_bible_backup_v3'
order by 1;
```

**Breaks if done wrong:** nothing should use these tables — they are backups. If
something does, it is using `service_role`, which is unaffected by this change.

**Row counts before you start,** so you can tell whether anything changed:
`inbox_bible_backup_v3` 12 · `inbox_faq_backup_20260913` 23 ·
`inbox_bible_backup_20260913` 12 · `inbox_bible_backup_20260916` 12. These match
what was recorded on 2026-09-20, so there is no evidence of tampering — though an
`UPDATE` would not have changed a count, so this is reassurance, not proof.

### 2 · Revoke PUBLIC execute on the write-path functions

**This is not currently exploitable, and should not be treated as an emergency.**
`inbox_record_inbound`, `inbox_apply_status` and `inbox_claim_ai_run` have
`EXECUTE` granted to `PUBLIC` — the PostgreSQL default, not a deliberate decision.
They are `SECURITY INVOKER`, so they run as the caller, and `anon` has no
privileges on the tables they touch. The calls would fail.

It matters because it is one keyword from being a public write path into the
message log: change any of them to `SECURITY DEFINER` and the grant becomes live
access. The three AI functions in this database *are* `SECURITY DEFINER`, and
correctly have `anon` execute revoked — so the pattern is already understood here.

```sql
revoke execute on function public.inbox_record_inbound(text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.inbox_apply_status(text, text, text)                                   from public, anon, authenticated;
revoke execute on function public.inbox_claim_ai_run(text, text)                                         from public, anon, authenticated;
```

**Verify — all three must be false:**

```sql
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('inbox_record_inbound', 'inbox_apply_status', 'inbox_claim_ai_run');
```

**Breaks if done wrong:** if the webhook handler calls these with the anon key
rather than `service_role`, inbound messages stop being recorded. **Check which
key the handler uses before running this.** If it turns out to use anon, that is a
larger finding than this step and should come back to the Owner.

### 3 · The three secrets — *decide before acting*

`public.inbox_config` holds `access_token`, `app_secret` and `verify_token` in
plaintext. **The values are not reproduced here or anywhere in this repository;
the location above is the whole of what is recorded.** Supabase Vault 0.3.1 is
already installed in this project and unused.

Two separate questions, and they have different answers:

- **Move them into Vault.** Right regardless. `SEC-002` and `SEC-003` require it,
  and nothing about this system depends on them living in a table column.
- **Rotate them at Meta.** Depends on *who has held the service-role key or the
  database password*, because that is the set of people who could have read these.
  Unlike B-06, these were never in a git history and are not reachable with the
  anon key. **That is the Owner's call, and it needs the honest answer to "who has
  had those credentials?" rather than an assumption.**

If you rotate, the WhatsApp integration stops working until the new values are in
place — so rotation needs a window and a tested path back.

### 4 · The manager login code — *stopgap, then replace*

One manager, active, a 10-character plaintext shared code. `SEC-003` forbids
storing a credential this way and `IAM-001`/`IAM-002` require a real employee
identity with MFA for administrators.

The absorption plan already says this mechanism is **replaced, not migrated** —
so the long-term answer is the ERP's identity model, not a better version of this.
The stopgap is to stop storing it in plaintext: `pgcrypto` 1.3 is available in the
`extensions` schema, so the code can be hashed and the login path changed to
compare hashes.

**This changes how a working system authenticates its only user. Do not do it
without the person who maintains the inbox application** — if the login path still
compares plaintext, hashing the column locks them out.

---

## What this does not fix

**78 customers asked for a human and have not received one.** That is B-09, it is
operational rather than technical, and no statement in this document touches it.
Please read it before you consider B-08 closed — the security work and the
customer backlog arrived in the same survey, and the backlog is the one with
people waiting on the other end.

---

## Record when done

| Step | Done | By | Date | Notes |
|---|---|---|---|---|
| 1 · Anon write path closed on four backup tables | ☐ | | | Verification query returned all-false / all-true? |
| 2 · PUBLIC execute revoked on three functions | ☐ | | | Which key does the webhook handler use? |
| 3a · Three secrets moved into Vault | ☐ | | | |
| 3b · Secrets rotated at Meta | ☐ | | | Or: decided not to, because … |
| 4 · Manager login code no longer plaintext | ☐ | | | |

**Who has held the service-role key or database password for this project?**

> …

Then close B-08 in [`../blocked.md`](../blocked.md) — and if step 3b was declined,
record the reasoning there rather than leaving it blank, because "we decided not
to" and "nobody got to it" look identical six months later.
