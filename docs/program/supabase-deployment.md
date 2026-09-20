# Creating the hosted Supabase project, and promoting to it

Written 2026-09-20, to be executed around **April–May 2027** — roughly 6–8 weeks
before a production date no earlier than June 2027 ([ADR-0018](../adr/ADR-0018-erp-database-home.md)).

It is written now, eighteen months early and while the reasoning is fresh,
because the alternative is writing it in April 2027 under time pressure with
UAT waiting.

> **Every step here is an owner-approved action.** `governance.md` §3 lists "any
> write to a live database" and "applying a migration" among the actions
> requiring explicit human approval, and §4 forbids `supabase db push` and
> migration repair against production permanently. **Approval for one step is
> never approval for the next.** No agent session performs any of this.

---

## Before you start

| | Check | Why |
|---|---|---|
| 1 | `npm run verify` green, and `Database stack` green in CI | The migrations are proven against a real stack before they meet a real project |
| 2 | ADR-0002 resolved, or explicitly accepted as outstanding | Hosting and data residency is a **blocking gate before any production deployment** (B-05). A staging project is not production; a production project may not be created before this closes |
| 3 | The region decided and recorded in ADR-0002 | Supabase offers no Saudi region. That is a recorded fact, not a preference, and the choice must be deliberate |
| 4 | A plan for `SEC-013` | Backups encrypted, restore exercised, isolated from ordinary application credentials |

---

## 1. Create the project

In the dashboard, not from a script — creation is once, and a script that
creates projects is a script that can create the wrong one.

- **Name:** `first-taste-erp-staging`, then later `first-taste-erp-production`.
  Two projects, never one promoted in place: the staging project is where a
  migration is proved, and proving it in production is not proving it.
- **Organisation:** its own, not the organisation holding
  `spicy-meal-ordering` and `whatsapp-inbox-simple`. The account-level free-tier
  cap that forced this decision does not apply to a paid plan, and separating
  the organisations makes "never write to the live estate" an access-control
  fact rather than a rule someone remembers.
- **Region:** as recorded in ADR-0002.
- **Database password:** generated, stored in the password manager, never in a
  file. `.env.example` names `SUPABASE_DB_PASSWORD` and holds no value.

Record the project ref in `docs/estate/inventory.md` the same day.

## 2. Link, and confirm what you are linked to

```bash
supabase login                      # uses SUPABASE_ACCESS_TOKEN, never committed
supabase link --project-ref <ref>
supabase projects list              # confirm the linked ref is the one you meant
```

**Confirm before every subsequent command.** The failure this prevents is
running a migration against the wrong project, which is unrecoverable in the
sense that matters: the ledger has been appended to.

## 3. Promote the migrations

```bash
supabase migration list             # local versus remote, before touching anything
supabase db push --dry-run          # read what it will do
supabase db push                    # one owner-approved action
```

`db push` is the sanctioned path here and is **not** the prohibited one — the
prohibition is against `db push` to *production* as a way of applying ad-hoc
schema, and against `migration repair`. Pushing a reviewed, merged, CI-proven
migration history to a freshly created **staging** project is the documented
workflow.

**Against production, push one migration at a time**, each followed by read-only
verification, as §4 requires.

**If `migration list` shows drift, stop.** Repair is permanently forbidden. Drift
against a project this repository owns means someone changed the database outside
this repository, and the answer is to find out who and why, not to reconcile the
ledger.

## 4. Verify, read-only

```bash
supabase inspect db table-stats
supabase test db --linked           # the pgTAP suites, against the real project
```

Then, in the dashboard's advisor, confirm **zero** of:

- a relation in `public` — nothing ERP-owned belongs there
- RLS disabled on any `erp` table
- a function with a mutable `search_path`
- an extension installed in `public`

Each of those is a real finding from the estate's inbox project (B-08), and
`npm run db:check` asserts all four locally. Seeing them clean here confirms the
hosted project inherited the posture rather than only the tables.

## 5. Seed — staging only

```bash
supabase db reset --linked          # STAGING ONLY. Never against production.
```

`supabase/seed.sql` is synthetic and `SEC-012` forbids production data in
development or testing without approved masking. **Production is never seeded**;
it starts empty and is populated by the migration of real data, which is its own
approved plan and not this document.

## 6. Configuration that is not in this repository

Set in the dashboard, never committed:

| | Where |
|---|---|
| Database password | Password manager |
| Service role key | Platform secret store; never in a file, never in a log |
| SMTP, auth providers | Dashboard |
| Point-in-time recovery, backup schedule | Dashboard — `SEC-013` |
| Network restrictions | Dashboard |

`npm run secret:scan` runs in CI over every tracked file and fails the build on a
credential shape, so the rule is enforced rather than remembered.

---

## Rollback

There is no `down` migration and there will not be. A migration is appended,
never reversed: a mistake is corrected by a **new** migration that moves forward,
because a `down` that has run against real data is a second untested schema
change made in a hurry.

For an unrecoverable structural error on a project with no real data yet: delete
the project and recreate it from these files. That option disappears the day real
data lands, which is the day this runbook stops being cheap — schedule
accordingly.
