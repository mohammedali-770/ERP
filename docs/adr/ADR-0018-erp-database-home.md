# ADR-0018 — Where the ERP's database lives

- **Status:** Proposed — **the owner asked for the opposite of this recommendation; the decision is theirs**
- **Date:** 2026-09-20
- **Requirements:** SEC-002 · SEC-003 · SEC-006 · SEC-010 · NFR-004 · PRG-010 · AI-013
- **Deciders:** Owner
- **Related:** ADR-0002 · ADR-0003 · ADR-0015 · B-05 · Q-16 · [`../estate/inbox-absorption.md`](../estate/inbox-absorption.md)

## Context

The account is at the free-tier ceiling of two active projects (Q-16). Rather than
pay for a third, the owner proposed reusing the live `whatsapp-inbox-simple`
project as the ERP's database — the inbox keeps operating, the ERP's schema joins
it, and the inbox later becomes an ERP feature.

That is a reasonable thing to want, and it is cheap. It was investigated properly
rather than waved away: fifteen agents, read-only against the live project, four
survey lenses, three independent isolation designs, two judging lenses and three
adversarial refutation passes. **All three refuters broke it**, each with a
verified, concrete sequence rather than a general worry.

The designs themselves were sound and converged on the same mechanism — a
dedicated `erp` schema owned by a non-Supabase role, separation by `GRANT` rather
than RLS, `USAGE` withheld from `service_role`, PostgREST left exposing only
`public`. The problem is not the design. It is what one Postgres instance cannot
separate.

## What the investigation found

### 1. Every new table in `public` is born world-writable

`pg_default_acl` for grantor `postgres` in schema `public` grants `arwdDxtm` —
insert, select, update, delete, truncate, references, trigger — **to `anon` and
`authenticated`** on every table created there. New tables have RLS off by
default. The fifteen live inbox tables are safe only because each migration
hand-writes a counter-revoke.

**That discipline has already failed four times in this database.** Four backup
tables created outside the migration workflow carry `anon=arwdDxtm` with RLS
disabled — so they are anon-**writable**, not merely readable as `Q-10` recorded.

The refuter's scenario is one forgotten schema qualification: `SET ROLE` does not
reload role GUCs, so a migration run as `postgres` that writes
`create table payroll_run (...)` unqualified lands it in `public`, inherits that
ACL, and `pgrst_ddl_watch` publishes `/rest/v1/payroll_run` about a second later —
readable and writable with the anon key that ships in the inbox's own client
bundle.

### 2. `pg_trgm` lives in `public`, and the inbox depends on it

Three of the seven inbox functions — `inbox_faq_match`, `inbox_faq_match_many`,
`inbox_record_gap` — are `SECURITY DEFINER` pinned to `search_path = public` and
call `similarity()`. The ERP design deliberately omits `public` from its
search_path, so an ERP engineer meets `function similarity(text, text) does not
exist` and is pointed straight at the one object they must not move.

Supabase's own security advisor recommends moving `pg_trgm` out of `public`
**every single day**. Taking that advice stops the AI answering customers.

### 3. One instance, one connection pool, one backup timeline

`max_connections` is 60 and `idle_in_transaction_session_timeout` is 0. An ERP
migration that leaves a transaction open — a verifier that stops for a human, a
laptop that sleeps — stalls vacuum and ends in timeouts on the live inbound
webhook. No schema design reaches this; it is the instance, not the namespace.

`service_role` carries `BYPASSRLS`, and a project has exactly one service_role
key, held by the WhatsApp webhook runtime. Withholding `USAGE ON SCHEMA erp` does
bind it — `aclcheck` still applies — but the `postgres` credential remains a
single key to both systems.

### 4. The migration ledger collides

`supabase_migrations.schema_migrations` holds the inbox's thirteen rows;
`supabase/migrations/` in this repository holds a `.gitkeep`. Pointing the ERP at
this ref puts the CLI immediately into drift, whose only remedy is
`migration repair` — **permanently forbidden** by `CLAUDE.md` §5 and
`supabase/README.md`.

## Decision

**Recommended: the ERP gets its own Supabase project. `whatsapp-inbox-simple`
stays the inbox.**

This is not a rejection of what the owner wants. The inbox still becomes an ERP
feature — that absorption is planned in
[`inbox-absorption.md`](../estate/inbox-absorption.md), and it happens at the
**data** seam, which is where `migration-map.md` already classified this project:
*"Adjacent — integrate at the menu and branch data seam; do not absorb."*

Co-tenancy would merge the two systems at the **storage** layer, which is the one
layer that gives no benefit to the absorption and carries all of the risk. The
ERP will hold payroll and financial records; the control protecting them would be
a `REVOKE` line remembered in every future migration, behind a mechanism with a
demonstrated four-instance failure rate in this very database.

**Nothing needs deciding today.** ADR-0003 is still Proposed, so no ERP schema can
be written anywhere yet. The subscription decision and the ADR-0003 decision
belong in the same week, and that week is not this one.

### If co-tenancy is chosen anyway

It is the owner's call, and it can be done. The requirements, each an
owner-approved action in its own right and none of them executable from an agent
session:

1. A dedicated `erp` schema with its own `ALTER DEFAULT PRIVILEGES ... REVOKE ALL
   ON TABLES FROM anon, authenticated`, so the safe case is the default rather
   than the remembered one. **No ERP object in `public`, ever.**
2. The four anon-writable backup tables closed first — see B-08, and read
   `inbox-absorption.md` before touching them, because they are not redundant
   copies.
3. `pg_trgm` and the three pinned functions resolved as inbox maintenance, before
   ERP work starts, not during it.
4. A separate migration ledger for the ERP, since the shared one cannot be
   repaired.
5. `idle_in_transaction_session_timeout` set, and a connection budget agreed, so
   ERP work cannot starve the webhook.
6. Payroll and financial tables deferred until the ERP has left for its own
   project — the exposure that is least tolerable is the one this arrangement
   protects worst.

## Consequences

- **Q-16 is answered differently than expected.** The blocker was framed as a
  subscription question. It is a data-safety question that happens to have a
  subscription answer.
- **The inbox project gains value from this regardless.** The survey found
  exposures and losses that were going to bite whoever touched it — recorded in
  B-08 and in the absorption map.
- **The absorption plan exists now rather than later**, which was the owner's
  actual instruction and is the more valuable half of it.
