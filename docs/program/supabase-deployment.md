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
hand, the project's name typed to confirm, and held until the environment's reviewer
approves that run. A run links (§2), resets the project from the migrations and the
synthetic seed (§5), and deploys the twelve edge functions.

What the owner sets, and never in a file:

1. **A GitHub environment named `staging`** (repository Settings, Environments), before
   the first run:
   - deployment branches: `main` only;
   - required reviewer: the owner's account, so every run waits for an approval in
     GitHub's own interface;
   - two **environment** secrets, never repository secrets. A repository secret is
     readable by a workflow on any branch, and agent sessions push branches here; an
     environment secret reaches only a job that the environment has admitted.

   **What this enforces, and what it does not.** It keeps both secrets from every
   workflow on a pushed branch. It does not tell the owner from an agent: agent sessions
   here act as the owner's own GitHub account (`mohammedali-770`, an administrator), so to
   GitHub a run an agent started, or an approval it gave, is the owner's. And `main`'s
   copy of the workflow can change through a merge that needs no approval
   ([`github-controls.md`](github-controls.md), "Why zero required approvals"), while the
   approval screen does not show what the run will execute. So the approval is the
   owner's choice, as merging is, and CLAUDE.md §3 and §4 are what keep an agent from
   making it; nothing in GitHub does. Approve only a run you started yourself, after
   reading it as 4 says. What would separate the two: §1's organisation of its own with
   a token that reaches only staging, or a GitHub identity for agent sessions with no
   administrator or deployment-review rights. A second human reviewer is not enough on
   its own: GitHub proceeds on any one listed reviewer's approval, and an administrator
   can bypass the environment's rules or change them.
2. **`SUPABASE_ACCESS_TOKEN`**, a **scoped** personal access token (Supabase, Account,
   Access tokens; scoped tokens are in public alpha there). Resource access: **Project**,
   `first-taste-erp-staging` alone. Permissions, every other one left at None:
   - **Project Settings: Read**, for the workflow's check that the project is staging
     and running;
   - **API Keys: Read-write**, because `supabase link` reads the secret key with
     `reveal`, which Read does not cover (found 2026-10-25, when a token with Read was
     refused);
   - **Connection Pooling: Read**: `supabase link` reads the pooler's address, and the CLI
     reaches the database through it. Without it the CLI falls back to the direct host,
     `db.olrqvewevfndvqwwkner.supabase.co`, which Supabase serves over IPv6 unless the
     IPv4 add-on is bought, and GitHub's hosted runners have no IPv6;
   - **Edge Functions: Read-write**, to deploy the functions.

   Since 2026-10-25 the workflow asks for the one project rather than listing the
   account's, so no account-wide permission is needed. A classic token instead reaches
   every project in the account, `spicy-meal-ordering` and `warehouse-factory-system`
   included, and can run SQL as `postgres` on any of them without a database password:
   never use one here. Even scoped, the token is the owner's to hold, and the
   environment does not keep it from an agent acting as the owner (1).
3. **`STAGING_DB_PASSWORD`**, the staging database's password. The connector generated one
   nobody holds, so it is reset in the dashboard first (Project Settings, Database), and
   kept in the password manager as well: GitHub never shows a secret again, and 5 needs
   it. The workflow refuses to run without it: with no password the CLI would make a
   login role of its own on the project from the token alone, which no migration
   created.
4. **Each run**, by the owner, from the Actions tab: `Deploy to staging`, from `main`, the
   name typed. Then open the pending run and note the commit it shows: the run executes
   that commit, whatever `main` shows by the time it is approved. Read
   `.github/workflows/staging-deploy.yml` at that commit, and what has changed since the
   last run you approved, and only then approve the pending deployment. A paused project
   is resumed first ("When staging is paused", below): a run cannot reach its database.
5. **`erp_edge`'s password**, after the first run has created the role, from `psql` and
   never in the dashboard's SQL editor: Supabase logs every DDL statement `postgres` runs,
   `alter role … password` included, and the editor keeps what it ran. Connect with
   `psql` 16 or later as `postgres`, with the session pooler's connection string from the
   Connect panel and the password left out of it, so that `psql` asks for
   `STAGING_DB_PASSWORD`. Then run `\password erp_edge` and type a new password, kept in
   the password manager. `psql` sends only a SCRAM verifier, so the password itself
   reaches neither the server's log nor `psql`'s history. A reset keeps roles, which
   belong to the cluster, so this survives later runs.
6. **`ERP_DATABASE_URL`**, an edge function secret, in the dashboard (Edge Functions,
   Secrets): the transaction pooler's connection string from the Connect panel, with the
   user `erp_edge.olrqvewevfndvqwwkner`, `erp_edge`'s password, and `?sslmode=require` on
   the end; and "Enforce SSL" turned on under Project Settings, Database. The driver is
   set for the pooler: one connection, no prepared statements.
7. **An administrator's PIN**, if anyone is to make changes on staging. The seed gives the
   synthetic administrator, employee number `1000`, none. After a run, in `psql` as in 5,
   typed at a prompt and sent as a bound parameter, so that neither `psql`'s history nor
   the statement the server sees holds the digits. Two inputs, in this order, never
   pasted together. First this line on its own, then the six digits at `PIN:`:

   ```
   \prompt 'PIN: ' pin
   ```

   Then, once the prompt has been answered, these two lines:

   ```
   select erp.set_pin(gen_random_uuid(), '01936f00-0000-7000-8000-000000000900', $1,
     'Staging administrator PIN.', '01936f00-0000-7000-8000-000000000900', now()) \bind :pin \g
   ```

   Pasted as one, the block fails: `\prompt` takes the `select` as its own arguments, or
   leaves the digits typed after it at `psql`'s prompt, where they are sent as SQL and
   kept in its history. `\bind :pin`, not `:'pin'`, which would send the quotes too and
   be refused as not six digits. `\prompt` shows the digits as they are typed. To
   confirm, `select updated_at from erp.person_credential where person_id =
   '01936f00-0000-7000-8000-000000000900';` shows the moment just now; a PIN set some
   other way, or none, shows an older one or no row. The administrator is both the actor
   and the person, which its role permits. The next run's reset erases the PIN, as
   it erases everything but roles. Until it is set, only the seeded cashiers can sign
   in, and their PINs are in clear in `supabase/seeds/0015_identity.sql`, which is
   public: anyone can sign in to staging as them (Q-24's note of 2026-10-15).
8. **The console on Vercel**: import the repository with `apps/console` as its root
   directory; `apps/console/vercel.json` gives the install, build and output. Its install
   runs `npm ci` at the repository root, where the workspace's lockfile is, so leave
   "Include files outside the root directory in the Build Step" on under the Root
   Directory setting: it is on for every project created since 2020, and with it off the
   install cannot reach the lockfile and fails. Before the
   first deployment, set `VITE_ERP_FUNCTIONS_URL` to
   `https://olrqvewevfndvqwwkner.supabase.co/functions/v1` for Production and Preview. It
   is read at build time, and a build without it still succeeds but calls the local
   stack's `http://127.0.0.1:54321/functions/v1` (`apps/console/src/App.tsx`), so every
   sign-in on that deployment fails as a network error; a deployment built before the
   variable was set is redeployed. Turn off auto-assigning custom domains to production
   deployments (Project Settings, Environments, Production), so a push to `main` builds a
   staged production deployment and the console's production address moves only when the
   owner promotes one, as the database moves only when the owner runs the workflow.
9. **`ERP_ALLOWED_ORIGINS`**, the second edge function secret, once Vercel has assigned the
   console's address: the production domain shown under the Vercel project's Settings,
   Domains, as `https://` and the domain, with no path and no trailing slash; any other
   address, a preview's say, comma-separated after it. Each entry must be an exact
   origin, and no wildcard is accepted, so a preview's own address is refused unless it
   is named. Until it is set, the functions answer no browser.

The CLI bundles the functions in its own edge-runtime image, from `deno.json`'s import
map; `deno.lock` binds CI's `deno check --frozen`, not that bundle. The pgTAP suites (§4)
are not part of the workflow: run against the project they need the pgTAP extension
enabled there, which is a further change of its own.

### When staging is paused

**The organisation is on Supabase's Free plan**, so staging is paused after a week of low
database activity. Supabase emails a warning about a week before, and again once it is
paused. A paid plan is never paused
([Supabase, "Project Pausing"](https://supabase.com/docs/guides/platform/free-project-pausing)).
Staging was found paused (`INACTIVE`) on 2026-10-25, ten days after it was created, with
nothing using it.

- **While it is paused, nothing answers:** not the database, not the functions, not the
  console's sign-in. A `Deploy to staging` run cannot reach the database either, and
  fails.
- **Resuming is the owner's**, as any change to a hosted project is: the Supabase
  dashboard, the organisation, the project, **Resume project**. Supabase says it returns
  to its previous state, data and configuration included.
- **It can be resumed for up to a year after the pause**, as Supabase's page said on
  2026-10-25 (an older page of theirs gives 90 days). After that it cannot be resumed,
  and staging would be a new project with a new ref: in `STAGING_REF` and wherever this
  runbook names it, with items 3 and 5–9 done again for it (`STAGING_DB_PASSWORD`,
  `erp_edge`'s password, `ERP_DATABASE_URL`, the PIN, `VITE_ERP_FUNCTIONS_URL` and
  `ERP_ALLOWED_ORIGINS`). It would be rebuilt from `main`, not from a backup: staging
  holds nothing that `main` and the seed do not.
- **After a resume, check that the functions still reach the database.** Supabase's
  daily backups do not keep the passwords of custom roles, and `erp_edge` is one
  ([Supabase, "Database Backups"](https://supabase.com/docs/guides/platform/backups)).
  The Free plan has no daily backups, and the docs do not say whether a resume keeps
  them. If sign-in fails where it worked before the pause, set `erp_edge`'s password
  again (5) and `ERP_DATABASE_URL` with it (6).
- **Keeping it awake** takes a few database requests a day, which using the site gives
  it; a week of nobody using it lets it pause again. Moving the organisation to a paid
  plan stops pausing altogether, and is the owner's decision.

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
