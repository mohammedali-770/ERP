# Supabase project definition

The ERP's database, functions and tests live here, vendored in-repo — the same
pattern the live Spicy Meal system uses, so the schema is reviewable in a pull
request rather than existing only in a dashboard.

**This repository is the source of truth for the database.** No hosted project
exists yet; development runs the stack locally in Docker. Creating the hosted
project is deferred to roughly 6–8 weeks before launch ([ADR-0018](../docs/adr/ADR-0018-erp-database-home.md)),
and when it arrives it is populated by promoting these files, never the reverse.

```
config.toml    local stack definition — committed, holds no credential
migrations/    plain SQL, one file per approved change, append-only history
seeds/         synthetic development fixtures, listed in config.toml's
               [db.seed] sql_paths — the CLI sends seed SQL over the wire, so a
               psql meta-command like \ir is a syntax error there
functions/     edge functions (none yet — nothing needs one)
tests/         pgTAP suites
```

---

## Working locally

```bash
supabase start          # or: npm run db:start
npm run db:reset        # rebuild from migrations + seed
npm run db:test         # pgTAP suites
npm run db:check        # structural gate, no Docker needed
```

The CLI is **not an npm dependency**. `CLAUDE.md` permits two, deliberately, and
a postinstall that downloads a binary is the supply-chain surface that rule
exists to avoid. Install it as a standalone binary; CI pins the same version in
[`ci.yml`](../.github/workflows/ci.yml).

### `db:check` versus `db:test`

They prove different things and neither replaces the other.

| | `db:check` | `db:test` |
|---|---|---|
| Needs | PostgreSQL | Docker + the CLI |
| Applies | every migration, in order, then the seed | the same, via `db reset` |
| Asserts | schema layout, roles, grants, default privileges, the append-only pair, the partial unique indexes, that the seed is synthetic and reproducible | all of that **plus** storage policies, auth and PostgREST exposure |
| Runs in | seconds, on every push, and in sessions without a container daemon | minutes |

`db:check` also builds the database **twice and compares the data**, because
requirement "a clean reset recreates the complete database" is only meaningful
if it lands in the same place every time (`LAB-005`).

---

## Production rules

Inherited from the live system and not negotiable here
([`../docs/program/governance.md`](../docs/program/governance.md)):

- **`supabase db push` and migration repair are permanently forbidden against
  production.** Schema changes go only through the approved migration workflow.
- Applying a migration to a hosted project is an **explicit owner-approved
  action**, one file at a time, each followed by read-only verification.
- Migration history is a ledger: appended to, never rewritten.

### The local exception, stated so nobody has to guess

**`supabase db reset` against the local container is the ordinary development
loop, and is not covered by any of the above.** It destroys a container that was
rebuilt from these files sixty seconds ago.

This is written down because the prohibitions say "against production" and
nothing said what that left permitted, so a careful reader would reasonably
refuse to run `db reset` at all. The line is: **anything local and rebuildable
from this directory is free; anything that touches a hosted project is
owner-approved, one action at a time.**

---

## The shape of the schema

`event_log` is the system of record and everything queryable is a projection
([ADR-0003](../docs/adr/ADR-0003-event-sourced-core.md), accepted 2026-09-20).
Append-only is enforced **twice** — `erp_app` holds no `UPDATE` or `DELETE`
grant, and a `BEFORE UPDATE OR DELETE` trigger raises — because "a migration
accidentally rewrote history" is not a recoverable event.

Nothing ERP-owned is ever created in `public`. A table there inherits default
privileges granting `anon` and `authenticated` insert, update and delete, with
RLS off; that trap has already fired four times in this estate. Everything lives
in `erp`, whose default privileges grant those roles nothing, so forgetting a
`REVOKE` is harmless and granting access is the deliberate act.

The three partial unique indexes in migration 0006 are copied verbatim from
[`core-transaction-design.md`](../docs/architecture/core-transaction-design.md).
They are not a tidiness measure: under a partition two devices can both create a
payment intent, and these are what turn that into a detected conflict rather
than a silent merge (invariant I-3, `NFR-004`).
