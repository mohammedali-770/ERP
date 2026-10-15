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

The seed, `supabase/seeds/*.sql` in the order `config.toml`'s `[db.seed]` lists, is
synthetic, and `SEC-012` forbids production data in development or testing without
approved masking. **Production is never seeded**; it starts empty and is populated by
the migration of real data, which is its own approved plan and not this document.

## Staging, as built (2026-10-15)

On the owner's instruction, staging exists ahead of the schedule at the top of this
document: `first-taste-erp-staging`, ref `olrqvewevfndvqwwkner`, `eu-central-1`, in the
same organisation as the live projects (ADR-0018's addendum of 2026-10-15). It was
created through the Supabase connector, which could not carry the larger migrations, so
it is built by `.github/workflows/staging-deploy.yml` instead: from `main` only, run by
hand, the project's name typed to confirm, and held until the owner approves that run.
A run links (§2), resets the project from the migrations and the synthetic seed (§5),
and deploys the twelve edge functions.

What the owner sets, and never in a file:

1. **A GitHub environment named `staging`** (repository Settings, Environments), before
   the first run:
   - deployment branches: `main` only;
   - required reviewer: the owner, so every run waits for the owner's approval in
     GitHub's own interface;
   - two **environment** secrets, never repository secrets. A repository secret is
     readable by a workflow on any branch, and agent sessions push branches here; an
     environment secret reaches only a job that the environment has admitted.
2. **`SUPABASE_ACCESS_TOKEN`**, a personal access token. It reaches every project in the
   account, `spicy-meal-ordering` and `warehouse-factory-system` included, and can run SQL
   as `postgres` on any of them without a database password. The environment is what
   keeps it to approved runs from `main`, and the workflow's checks are what keep those on
   staging. The durable fix is §1's: staging in an organisation of its own, and a token
   from an account that belongs to that organisation alone.
3. **`STAGING_DB_PASSWORD`**, the staging database's password. The connector generated one
   nobody holds, so it is reset in the dashboard first (Project Settings, Database). The
   workflow refuses to run without it: with no password the CLI would make a login role
   of its own on the project from the token alone, which no migration created.
4. **Each run**, from the Actions tab: `Deploy to staging`, from `main`, the name typed;
   then approve the pending deployment.
5. **`erp_edge`'s password**, after the first run has created the role, in the dashboard's
   SQL editor: `alter role erp_edge with password '…';`, a new password kept in the password
   manager. A reset keeps roles, which belong to the cluster, so this survives later runs.
6. **The edge functions' two secrets**, in the dashboard (Edge Functions, Secrets):
   - `ERP_DATABASE_URL`: the transaction pooler's connection string from the dashboard's
     Connect panel, with the user `erp_edge.olrqvewevfndvqwwkner`, `erp_edge`'s password,
     and `?sslmode=require` on the end; and "Enforce SSL" turned on under Project
     Settings, Database. The driver is set for the pooler: one connection, no prepared
     statements.
   - `ERP_ALLOWED_ORIGINS`: the console's exact origin, or several, comma-separated. No
     wildcard is accepted, so a Vercel preview's own address is refused unless it is named.
7. **An administrator's PIN**, if anyone is to make changes on staging. The seed gives the
   synthetic administrator, employee number `1000`, none. After a run, in the SQL editor,
   with six digits of the owner's choosing in place of `…`:

   ```sql
   select erp.set_pin(gen_random_uuid(), '01936f00-0000-7000-8000-000000000900', '…',
     'Staging administrator PIN.', '01936f00-0000-7000-8000-000000000900', now());
   ```

   The administrator is both the actor and the person, which its role permits. The next
   run's reset erases the PIN, as it erases everything but roles. Until it is set, only the seeded cashiers can sign in, and their
   PINs are in clear in `supabase/seeds/0015_identity.sql`, which is public: anyone can
   sign in to staging as them (Q-24's note of 2026-10-15).
8. **The console on Vercel**: import the repository with `apps/console` as its root
   directory; `apps/console/vercel.json` gives the install, build and output. Before the
   first deployment, set `VITE_ERP_FUNCTIONS_URL` to
   `https://olrqvewevfndvqwwkner.supabase.co/functions/v1` for Production and Preview: it
   is read at build time, so a deployment built without it has no address to call. Turn
   off auto-assigning custom domains to production deployments (Project Settings,
   Environments, Production), so a push to `main` builds a staged production deployment
   and the console's production address moves only when the owner promotes one, as the
   database moves only when the owner runs the workflow.

The CLI bundles the functions in its own edge-runtime image, from `deno.json`'s import
map; `deno.lock` binds CI's `deno check --frozen`, not that bundle. The pgTAP suites (§4)
are not part of the workflow: run against the project they need the pgTAP extension
enabled there, which is a further change of its own.

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
