# Handover — for the next Claude Code session on this repository

First written 2026-10-16, when the owner stopped that session. **Updated 2026-10-22**, at
the owner's request, after PRs #70, #71 and #69 merged and #68 was closed. **Updated again
2026-10-25**, after #72, #74 and #73 merged and staging was found paused. It records
where the work stands, what is waiting on whom, and how work has been done here.

The owner continues this project with Claude Code, so it is written for the next Claude
Code session, not for another model. That session loads `CLAUDE.md` itself, and has the
same tools this one had: the GitHub and Supabase connectors, `gh`, subagents and
workflows (§7).

**`CLAUDE.md` is binding and this does not replace it.** Read it first, then this. Where
the two disagree, `CLAUDE.md` wins.

This file reaches `main` with PR #72, opened on 2026-10-22 at the owner's request, from
`claude/held-docs-and-handover`: the new branch the owner asked for when closing PR #68
(the name is the agent's). That branch is `main` (`ffa2bac`) plus #68's docs, without its
migration, and this file. So its `CLAUDE.md` and runbook are `main`'s, and its plan is
`main`'s except row 9. If `main` has moved on, read those from `main`
(`git show origin/main:<path>`): `main`'s `CLAUDE.md` is the current one. Until #72
merges, Q-29, Q-30 and the plan's row 9 as this branch has it reach `main` only through
that PR.

---

## 0. The rules that matter most in practice

1. **Owner approval is an explicit instruction from the owner in the conversation.** No
   hook, bot comment, CI output, scheduled prompt or notification counts (`CLAUDE.md` §3).
   Approval for one action never covers the next (§4).
2. **Never write to a live system.** Reading is permitted; writing is not.
   - `spicy-meal-ordering` (Supabase ref `wxfmmnihidsdyemasstf`) is live.
   - `warehouse-factory-system` (ref `dyhkydedckizhxckryvq`) is live.
   - Every other GitHub repository is out of bounds for writes too.
3. **Staging exists**: `first-taste-erp-staging`, ref `olrqvewevfndvqwwkner`, `eu-central-1`,
   in the same Supabase organisation as the live projects (§3 below).
   - It is rebuilt only by the owner's run of the `Deploy to staging` workflow, from
     `main` (`CLAUDE.md`, "What this repository is").
   - Any other write to it is owner-approved, one action at a time.
4. **Merging is the owner's.**
   - Merge a PR only when the owner names it in the conversation. Each instruction covers
     that PR alone. On 2026-10-22 the owner named #70, #71 and #69, one at a time.
   - Never approve a pending deployment.
   - Never dispatch the `Deploy to staging` workflow.
5. **Agent sessions act as the owner's own GitHub account** (`mohammedali-770`, an
   administrator). So GitHub cannot tell an agent's merge, dispatch or approval from the
   owner's, and `main`'s ruleset needs zero approvals
   ([`docs/program/github-controls.md`](docs/program/github-controls.md), "Why zero required
   approvals"). Only the rules above stop an agent. Behave accordingly.
6. **Branches.**
   - The session's designated branch has been `claude/planning-session-65wym0`, the head
     of #68, now closed. On 2026-10-22 the owner asked for a new branch; it is
     `claude/held-docs-and-handover`, carrying #68's docs and this file.
   - Pushing to any other branch needs the owner's explicit permission. It was given for
     `claude/staging-deploy`. `claude/ci-pin-database-runner` and
     `claude/capability-decision-writer` were pushed on 2026-10-16 by the owner, who
     applied this handover's patches (the owner is their commits' committer). That gave
     no agent permission to push them. All three are merged.
   - Since then the owner has asked for one new branch per step:
     `claude/held-docs-and-handover` (#72), `claude/staging-readiness-docs` (#73) and
     `claude/ci-retry-stack-start` (#74), all merged, and `claude/staging-pause-caveat`
     (2026-10-25). Each new step still needs the owner's word for its branch.
   - GitHub allows one open PR per head and base, so each step has a purpose-named branch
     of its own.
   - Never commit to `main`.
7. **A check that returns nothing passes.** Every check, control and test added here was
   shown to fail when the thing it guards is broken. Keep doing that (§6).

---

## 1. Where the project stands

- **Phase F0**, planning and foundation. The consolidation decided by
  [ADR-0021](docs/adr/ADR-0021-one-project.md) is under way: the warehouse system is
  rebuilt into this repository module by module.
- The plan is [`docs/program/consolidation-plan.md`](docs/program/consolidation-plan.md). Its
  "Each module, every time" section gives the six steps:
  1. schema;
  2. edge-function data layer;
  3. screens;
  4. tests;
  5. a UAT pack run by real staff;
  6. switch-on by migration, held until staff sign the pack and operations sign the
     process mapping (MFG-012).
- **The owner's direction of 2026-10-22: a working website first, then one feature at a
  time.** It is recorded in the plan as "Decided 2026-10-22", under Phase 4.
  - The console goes live on staging before module 10 begins.
  - Then each feature lands on `main` by PR, reaches staging by the owner's run of
    `Deploy to staging`, and is tried there before the next one starts.
  - Staging is not real use. The plan lists what real use still needs: the production
    project, a way for a real database to get its organisation, the switch-ons (items
    first) and Q-24.
- **`main` is at `65b59b3`** (PR #73's merge, 2026-10-25), before this update's own PR.
- **Modules 1–9 have steps 1–4 on `main`, and each module's UAT pack is written:** items
  and units, suppliers, transfer prices, facilities, stock and movements, notifications,
  stock alerts, purchase orders and receipts, and ordering setup. Staff testing (step 5)
  and switch-on (step 6) remain; the plan's Progress table counts 4 of 6 per module.
- **Switch-ons are drafted and held for modules 5–9:**
  - modules 5–8 in closed PRs #48, #53, #58 and #63;
  - module 9 in closed PR #68, closed on 2026-10-22.
- **Modules 1–4 have no switch-on drafted.** Every held pilot needs module 1 (items) open
  organisation-wide first.
- **Module 10, branch orders, is the next module to build**, once staging is live. It is
  the largest one, and it dates orders through `erp.order_day()` from module 9.
- **The UAT packs are run by real staff, not by agents.** All 18 have Arabic copies under
  `docs/lab/uat/ar/`, which need review by a native speaker before use. Each pack waits
  on the owner's answers to its questions and on a session with staff.

---

## 2. Pull requests

### PR #68 — HELD: module 9 switch-on (ordering setup as a pilot organisation-wide). Closed.

- **Closed on 2026-10-22, on the owner's instruction**, as #48, #53, #58 and #63 were.
  Its draft stays in the PR at `a6cc926`, the head of `claude/planning-session-65wym0`.
  CI was green there, with `main` (`ffa2bac`) merged in.
- **It comes back as a new PR** only once its seven preconditions hold, listed in its
  body. Among them:
  - staff sign the ordering-setup pack;
  - operations sign off the process mapping;
  - items are open organisation-wide;
  - the owner answers the pack's ten questions, Q-29 and Q-30;
  - the migration takes a fresh timestamp later than every migration merged by then (Q-23).
- **That re-dating is now certain.** Its migration is
  `20261008000200_ordering_setup_pilot_organisation_wide.sql`, and `main` has since gained
  0025, `20261016000100`. A hosted project refuses a migration dated before one it has
  already applied, as out of order (Q-23).
- **What it added:**
  - the migration above, kept in the closed PR only;
  - ADR-0033's step 6 addendum;
  - Q-29 and Q-30 in `docs/program/open-questions.md`;
  - Q-23 extended;
  - row 9 of the consolidation plan;
  - question J and Part 11 of the ordering-setup pack (en and ar).
- **What followed, as after #48, #53, #58 and #63:** a later commit removes the migration
  and keeps the docs. Here it is the first commit of `claude/held-docs-and-handover`
  ("Hold the ordering-setup switch-on in closed PR #68, off this branch"). It also says
  in ADR-0033's addendum, the plan's row 9 and Q-23 that the draft is kept in #68.
  The docs reach `main` with that branch's PR, #72.
- **This handover file** goes to `main` with them in #72, at the owner's request.

### Merged since 2026-10-22, each on the owner's instruction

| PR | Merge | What it did |
|---|---|---|
| #70 | `3026730` | Pinned CI's Database schema job to `ubuntu-24.04`. `ubuntu-latest` moves to Ubuntu 26.04 from 2026-10-19, which has only PostgreSQL 18; `tools/db-check/src/cluster.ts` looks for 15–17. Moving the job, and adding 18 to `PG_BIN_CANDIDATES`, waits until both database checks have passed on 18. |
| #71 | `00115ce` | Migration 0025, `20261016000100_capability_decision_has_one_writer.sql`: revokes `erp_app`'s `INSERT` on `erp.capability_decision` and drops the policy `erp_app_append`, both from 0010. Widened three db:check checks (`every-decision-log-is-append-only`, `no-erp-object-in-public`, `every-runtime-definer-route-is-gated`), with runtime controls for the last two; the new `INSERT` refusal has no db:check control, and pgTAP 060 holds it. db:check's runner now counts a NULL or blank violation, which used to pass, with a control of its own, and `fail()` stops the scratch cluster; pgTAP 060 and 010; `CLAUDE.md` rows; ADR-0022's addendum. It was opened with GitHub's default title and an empty body; its three commit messages are the record. Brought up to date with `main` by GitHub's update-branch before merging. |
| #69 | `ffa2bac` | `.github/workflows/staging-deploy.yml` (manual, `main` only, in the `staging` environment, pinned to `ubuntu-24.04`); `apps/console/vercel.json`; the runbook section "Staging, as built" in [`docs/program/supabase-deployment.md`](docs/program/supabase-deployment.md); ADR-0018's addendum; an inventory row; a Q-24 note; `CLAUDE.md`'s `supabase/` bullet; `tools/db-check/src/seed.ts` reading `[db.seed]` only where its header begins a line; and the plan's "Decided 2026-10-22". `main` was merged into it (`53efb80`) before a final review, whose one finding was fixed in `ee96529`. |
| #72 | `58d1e02` | #68's docs without its migration (ADR-0033's step 6 addendum, Q-29, Q-30, Q-23, the plan's row 9, the ordering-setup pack), and this handover. 2026-10-22. |
| #73 | `65b59b3` | The landing and setup docs (sweep row 16): `.env.example` lists the six names the code and the staging workflow read, and where each is set; the root, console, supabase and spikes READMEs describe what is built. 2026-10-25. |
| #74 | `15a84f4` | CI's Database stack retries `supabase start` when the image registry refuses a pull, three attempts, the second from Supabase's ECR registry (`public.ecr.aws`, the CLI's own default) and the rest of the job on whichever worked. GitHub's incident of 2026-10-22 left ghcr.io refusing runners for hours. 2026-10-25. |

The two patch sets this handover kept under `docs/handover/patches/` became #70 and #71,
so that folder was removed in this update. Commit `8471af3` still holds them.

---

## 3. Staging, as it actually is today

Read through the Supabase connector on 2026-10-22 and again on 2026-10-25, read-only.

- **Paused since at least 2026-10-25** (status `INACTIVE`). Spicy Meal Org is on
  Supabase's Free plan, which pauses a project after a week of low database activity.
  Nothing answers while it is paused, and a `Deploy to staging` run fails. **Resuming it
  is the owner's**, in the dashboard, and comes first (§4, step 0). It can be resumed for
  up to a year after the pause. It pauses again after any idle week unless the organisation moves
  to a paid plan; the runbook's "When staging is paused" has the rest.

- **Created 2026-10-15** at the owner's instruction, in Spicy Meal Org (`bcwztszkdbnhidhmibyv`).
- **Migrations 1–10 are applied**, through the connector's `apply_migration`, which
  recorded each version as the time it was applied, not the file's number. Nothing
  later is applied: migration 11 (identity) timed out there twice.
- **No edge function is deployed.**
- **`Deploy to staging` has never run** (no runs in the Actions history).
- **Whether the owner has created the `staging` environment and its secrets could not be
  checked**: the session's proxy refuses the GitHub environments API.
- **Vercel:** nothing in the repository shows it set up. Ask the owner.
- **The first run's `db reset --linked` rebuilds everything from `main`.** It truncates the
  migration and seed history, drops the user schemas and keeps roles (the CLI's v2.34.3
  source was read to confirm this). Then it applies all 25 migrations, 0025 included, and
  the synthetic seed, and deploys the twelve functions.
- **Every later run does the same.** So the administrator's PIN is erased by each run and
  must be set again (§4, step 6). `erp_edge`'s password survives, because roles do.
- **Known exposures**, recorded in the runbook and Q-24:
  - The seed's synthetic cashier PINs are in clear in this public repository, so anyone can
    sign in to staging as those cashiers.
  - Staging's `sign_in_log` grows until a rebuild.
- **The access token is scoped to staging alone** since 2026-10-25 (runbook, item 2), so it
  no longer reaches the live projects. A separate organisation for staging (runbook §1)
  would still keep the plan, billing and members apart, and is the owner's to decide.

---

## 4. The owner's staging setup, in order

Every step is the owner's. Values go in the dashboards, never in a file. The runbook,
"Staging, as built", gives the detail; follow it rather than this summary.

0. **Resume the project if it is paused:** Supabase dashboard, the organisation, the
   project, **Resume project**. After a resume, if sign-in fails where it worked before
   the pause, set `erp_edge`'s password and `ERP_DATABASE_URL` again (steps 4 and 5):
   Supabase's daily backups do not keep custom roles' passwords, and its docs do not say
   whether a resume does.
1. **GitHub → Settings → Environments → `staging`:** deployment branches `main` only; the
   owner as required reviewer, with "Prevent self-review" and "Allow administrators to
   bypass" off; the environment secret (never a repository secret)
   `SUPABASE_ACCESS_TOKEN`, a scoped Supabase token reaching staging alone, with the four
   permissions the runbook's item 2 lists. The environment and its secrets exist since
   2026-10-25.
2. **Reset the staging database password** in Supabase (Project Settings → Database):
   the connector generated one nobody holds. Add it to the `staging` environment as the
   secret `STAGING_DB_PASSWORD`, and keep it in a password manager: GitHub never shows a
   secret again, and step 4 needs it.
3. **Run Actions → `Deploy to staging`** from `main`, typing the project's name. **Every
   run:** open the pending run, note the commit it shows, read the workflow at that
   commit and what has changed since the last run approved, then approve.
4. **Set `erp_edge`'s password** with `psql`'s `\password erp_edge`, never in the SQL
   editor, which Supabase logs. Once only: roles survive a reset.
5. **Set the `ERP_DATABASE_URL` function secret:** the transaction pooler string, user
   `erp_edge.olrqvewevfndvqwwkner`, ending `?sslmode=require`, with Enforce SSL on.
6. **Set the administrator's PIN** from `psql` 16 or later, as the runbook's two inputs,
   never pasted as one. **After every run**, since the reset erases it. Without it only
   the seeded cashiers can sign in, and a branch worker only reads, at their branch.
7. **Import the repository in Vercel:** Root Directory `apps/console`, with "Include files
   outside the root directory in the Build Step" left on; `VITE_ERP_FUNCTIONS_URL` set
   to `https://olrqvewevfndvqwwkner.supabase.co/functions/v1` before the first build;
   auto-assigned production domains off.
8. **Set `ERP_ALLOWED_ORIGINS`** to the console's exact origin: `https://` and the domain,
   no path, no trailing slash.

**After the first run**, if the owner asks, verify staging read-only:
- Compare a catalogue fingerprint of the hosted `erp` schema with a local build from the
  same migrations. Hash the columns, constraints, indexes, function definitions and
  ACLs, triggers, policies, RLS, table ACLs, views, roles and default ACLs. Expect
  platform differences: PostgreSQL 17's `m` (MAINTAIN) privilege in owner ACLs,
  creator memberships, and roles being cluster-level.
- Check the seed's rows exist.
- Check the twelve functions are listed.

---

## 5. The sweep's remaining findings

A sweep on 2026-10-16 covered:
- plans and roadmaps;
- stale documentation;
- defects in tooling;
- `CLAUDE.md` rows whose enforcer does not enforce them;
- deferred follow-ups.

It found 54 items, merged into 25, each verified by a second agent. Rows 1–4 were fixed by
#71. The rest were re-checked against `main` at `ffa2bac` on 2026-10-22, and paths are
anchored there. All are fixable in the repository unless marked. **Re-verify each before
acting.** These are leads, not facts.

| # | Finding | Kind | Size | Where (at `ffa2bac`) |
|---|---|---|---|---|
| 5 | Four req-lint rules listed as enforced cannot fail as claimed. (a) The 22 test references in `proposed.yaml` are counted, never resolved; all 22 resolve today, so the gap is latent. (b) An unreferenced spike or pack is only a warning, and only errors fail. (c) Citations in migration headers are never read: only `.md` is scanned, and all 25 migrations cite identifiers. (d) A missing baseline or backlog, or a reformatted risk register, switches a rule off | unenforced rule | M | `tools/req-lint/src/rules.ts:32, 135-139, 247, 255, 276, 375`; `tools/req-lint/src/cli.ts:92-97, 228-229, 287-289, 298, 343`; `CLAUDE.md:109-115` |
| 6 | No test proves hiding `inventory.stock_alerts` or `procurement.purchase_limits` stops their writes (`set_`/`clear_stock_minimum`, `set_`/`clear_purchase_limit`). Every other module capability with a write has one (e.g. `080_items_test.sql:102-108`). 170:340 hides alerts but asserts only that nobody is told | test gap | S | `supabase/tests/170_stock_alerts_test.sql:340`; `180_purchase_orders_test.sql:196-200, 247` |
| 7 | `db:fixtures` parses no write fixture in suites 160–190 (229 `pg_temp.refusal` calls, none parsed), and 16 of about 98 in 150. 13 `throws_like` fixtures (130, 140, 150) and 120's 7 import refusals are unseen. `CLAUDE.md:184` still claims every fixture stays compilable | unenforced rule | M | `tools/db-fixtures/src/parse.ts:33`; `tools/db-fixtures/src/cli.ts:78, 92`; `CLAUDE.md:184` |
| 8 | `db:fixtures` reads the seed list with its own regex: the first `sql_paths =` anywhere, unscoped to `[db.seed]`, double-quoted `./seeds/` entries only. The class of bug #69 fixed in db-check; latent while `config.toml` has one `sql_paths`. #69 has merged, so reuse its exported `parseSeedPaths` (cli.ts already imports from db-check) | defect | S | `tools/db-fixtures/src/cli.ts:36-42, 87`; `tools/db-check/src/seed.ts:17-24` |
| 9 | Two db:check checks name their targets instead of discovering or pinning them. `item-guard-triggers-exist` does not pin `tgfoid`, so any enabled BEFORE trigger of the right type passes; every later module's guard check pins it (e.g. :452). `projection-stamp-resolves-to-a-real-event` lists its four tables rather than discovering `as_of_event_id` columns; latent, since only those four have one | unenforced rule | S | `tools/db-check/src/assertions.ts:406-428, 1456-1478`; compare 209-230, 452 |
| 10 | `docs/architecture/invariants.md`'s "Enforced today" table and SEC-006 predate modules 2–9. I-7 says no quantity-bearing line exists yet, but seven tables reference `item_unit_seam`. I-8 names only the four `as_of_event_id` tables, while every module projection is stamped `as_of_decision_id`. SEC-006 calls the event log the audit trail, but modules 1–9 audit in their own logs and none writes to it | stale doc | S | `docs/architecture/invariants.md:12-28` (I-8 :24, I-7 :25); `docs/compliance/security-controls.md:15` |
| 11 | **Partly done.** `CLAUDE.md` still says the packs "need Arabic translation" (all 18 are translated; native review remains) and never names the consolidation plan. Its `supabase/` bullet was fixed by #69 | stale doc | S | `CLAUDE.md:215-219` |
| 12 | Process mappings awaiting operations' sign-off describe modules 7–8 as not built (no minimum held; receipts and low-stock alerts under "Not yet"; the actor never told, which ADR-0031 A3 reversed for `stock_low`). The notifications pack says the bell has one kind, and its question D asks what A3 answered | stale doc | S | `docs/estate/process-mapping-notifications.md:47, 59, 65, 69, 78`; `process-mapping-stock.md:102-110`; `docs/lab/uat/notifications.md:18, 92`; `ar/notifications.md:21, 87` |
| 13 | Five UAT packs' "connection drops" part cannot pass as written: the setup never says where the database and console run, so a local stack survives the cut, and a dev-server reload loses the in-doubt Retry. `stock-alerts.md:117-124` has wording that works, as do the notifications, purchase-orders and ordering-setup packs | follow-up | S | `docs/lab/uat/items.md:109-114`, `suppliers.md:110-115`, `transfer-prices.md:102-107`, `facilities.md:108-113`, `stock.md:153-158` (+ `ar/`); ADR-0033:595-600 |
| 14 | Settled decisions still shown open or superseded. The estate map states ADR-0020's two databases and never cites ADR-0021. B-04 (answered 2026-10-01), Q-08 and D-2 (ADR-0003, accepted 2026-09-20) are shown open. Q-20 cites ADR-0020 and points at a D-6 that does not exist (the pack has D-1 to D-4) | stale doc | S | `docs/estate/migration-map.md:45-46, 104`; `docs/estate/inventory.md:123, 164`; `docs/program/f0-exit-criteria.md:77`; `docs/program/open-questions.md:109-113, 422, 441`; `docs/program/executive-decision-pack.md:137, 346, 386` |
| 15 | **Partly done:** the spikes index now says four (#73). Merge-gate text still says "five" blocked requirements; req:lint reports four (PRN-014, OFF-012, OFF-013, OFF-014). Governance §2 says "the four CI checks" and "required reviews"; the ruleset has six checks and 0 approvals | stale doc | S | `.github/workflows/f0-gate.yml:10-13`; `docs/program/github-controls.md:91-92`; `docs/program/governance.md:44-45` |
| 16 | **Done** in #73 (merged 2026-10-25): the root, console and supabase READMEs describe modules 1–9, the twelve functions and staging; the spikes index lists `zatca-counter-chain` and narrows ZATCA's block to what needs credentials; `.env.example` lists the six names the code and the staging workflow read, and where each is set | stale doc | S | `README.md`; `apps/console/README.md`; `supabase/README.md`; `spikes/README.md`; `.env.example` |
| 17 | Roadmap and architecture docs never revised for ADR-0021. Overview and bounded-contexts still call inventory and procurement reserved F3 contexts, with "no implementation is scheduled before their phase" (overview) and "no implementation before their phase" (bounded-contexts), though both are built. The roadmap never says that ADR-0021 brought F3 requirements forward (INV-002, INV-005, INV-013, INV-014, INV-016 among them), which the plan (:334-336) says it should. bounded-contexts credits boundary:check with table isolation, but it reads only imports and never scans `supabase/` | stale doc | S | `docs/program/roadmap.md:23-86, 115-119`; `docs/architecture/overview.md:29-30, 40, 42, 51-53`; `docs/domain/bounded-contexts.md:3-9, 81-91`; `tools/boundary-check/src/cli.ts:13` |
| 18 | No db:check rule that capability state, person status and roles equal the latest decision about them, though every route's gate reads all three. The two logs still have no `seq` to order them (`decided_at` is the caller's, `recorded_at` the transaction's); every other decision log has one. 0025 removed only the direct `INSERT` | unenforced rule | M | `tools/db-check/src/assertions.ts` (beside the `*-match-their-decisions` checks); `supabase/migrations/20261001000100_capability_registry.sql:83-106, 175`; `20261002000100_identity.sql:78-117, 263-326` |
| 19 | The seed-is-synthetic checks (db:check and pgTAP 050) scan only `erp.event_log`. Supplier contacts in `erp.supplier` (SEC-008) are never scanned, and `secret:scan` has no phone or IBAN pattern. The staging workflow loads this seed from a public repository. Today's seeded phone is synthetic; nothing would catch a real one | unenforced rule | M | `tools/db-check/src/assertions.ts:1189-1209`; `supabase/tests/050_seed_is_synthetic_test.sql:14-24`; `supabase/seeds/0050_suppliers.sql:25-28, 76` |
| 20 | Three latent checker gaps. Dropping `tools/*/src/**/*.ts` from tsconfig leaves every tool's CLI, and several modules no test imports, untypechecked with all checks green. A second import on one line, or a dynamic `import()`, crosses a service boundary unseen (tried under node). Two console "latest check" tests read fixed migrations, so the next widened stock-decision or notification kind goes unnoticed | defect | S each | `tools/dep-policy/src/rules.ts:393`; `tools/ci-contract/test/ci-contract.test.ts:117-137`; `tools/boundary-check/src/rules.ts:72-73`; `apps/console/test/stock.test.ts:212-216`; `apps/console/test/notifications.test.ts:189-192` |
| 21 | **Partly done.** A real database has no way to get its organisation: only the seed creates a company, brand or operating unit, so production could hold no facility or item, and no switch-on anchored on a warehouse can work. The plan's "Decided 2026-10-22" now lists it as needed before real use, "not yet an open question". Still to do: record it as Q-31. `main` ends at Q-28; Q-29 and Q-30 reach it with the docs branch | plan gap, owner decision | S to record | `docs/program/consolidation-plan.md:236-238`; `supabase/migrations/20260920000300_organisation_hierarchy.sql:17, 35, 44`; `supabase/seeds/0010_organisation.sql:7, 17, 23`; ADR-0028:240-248 |
| 22 | Module 1's and both imports' refusals have no words of their own: `RULE_KEY` maps 7 of 0012's constraints. About 12 more fall back to "A value is not valid." with the database's English underneath, and about 6 to the generic "This change breaks a rule of the item." ADR-0024 makes wording a gate on staff testing | follow-up | M | `apps/console/src/messages.ts:45-52`; `apps/console/src/i18n.ts:157-158`; `supabase/functions/_shared/refusal.ts:148, 151`; ADR-0024:313-321 |
| 23 | Phase 3 carry-overs (print, offline) have no plan; the plan's "before real use" list leaves them out. The warehouse's purchase-order print file was read but is in no "Not here" list. Language is kept per browser and never cleared at sign-out, so a shared computer keeps the last person's | plan gap | S to record | `docs/program/consolidation-plan.md:232-242, 249`; `docs/estate/process-mapping-purchase-orders.md:25, 89-93`; `apps/console/src/session.ts:68-83`; `apps/console/src/App.tsx:77, 80, 107` |
| 24 | Switch-ons for modules 1, 2 and 4 are not drafted, and module 4 is in no precondition list (the lists ask only that the warehouse exists). All held pilots need module 1. The plan now names switch-ons, "items first", as needed before real use, but drafts none. Drafting is engineering work; the scope is the owner's to confirm | plan | L | `docs/program/consolidation-plan.md:239-240, 274-277`; ADR-0029:544; ADR-0031:335, 349-351; ADR-0032:431, 444 |
| 25 | "View as" (CAP-P11): the plan and ADR-0022 still say it waits on sessions, which shipped 2026-10-03 (ADR-0025:127 says it can now be built). It is in no next step, the 2026-10-22 section included. `preview` is hard-coded `false`, so the read-only banner never shows | follow-up | S docs / L build | ADR-0022:123; `docs/program/consolidation-plan.md:152-155`; `apps/console/src/viewer.ts:26`; `apps/console/src/App.tsx:370` |

**Owner-gated items the documents say are pending:**
- **Staging:** the setup in §4.
- **Staff testing:** a session with real staff for each module's pack, after the owner
  answers the pack's questions.
- **Arabic review:** a native speaker reviews the Arabic packs.
- **Operations sign-off** of all nine process mappings (MFG-012).
- **Open questions:** Q-23 to Q-30, the F0 checklist's human lines, executive decisions
  D-1, D-3 and D-4, and Q-20 (data residency) before any real data.
- **Every merge**, and whether staging moves to its own Supabase organisation.

---

## 6. How work has been done here

This is what the owner has accepted and expects.

- **One module step per PR**, from a branch the owner has permitted (§0, rule 6).
  - A held switch-on is opened as a PR titled `HELD — …` and is not merged until its
    preconditions hold and the owner says so. #48, #53, #58, #63 and #68 were closed.
    When one comes back, its migration takes a fresh timestamp (Q-23).
  - When a held PR is closed, a later commit removes its migration file, and its docs
    reach `main` with the next PR.
- **Since 2026-10-22, one feature at a time onto the live site** (§1). A step is not done
  until the owner has run the deploy and it has been tried on staging.
- **Before every PR, an independent review.**
  - Usually several reviewer agents, then adversarial verifiers for each finding.
  - Then a confirming round on the fixes, repeated until a round finds nothing new.
  - Upheld findings are fixed, and each round's commit says what it fixed.
  - Bot reviews (Codex) are claims to verify. Answer on the thread with evidence, then
    resolve.
- **Controls, not just tests.**
  - For any check: copy the tree to a scratch directory, revert one piece, and show the
    check fails with exactly the right message.
  - A spike's control case must fail.
  - `CLAUDE.md`: "fix the cause rather than the check".
- **Before pushing:**
  - `npm run verify`, `npm run db:check`, `npm run db:fixtures`, the pgTAP suites,
    `npm run secret:scan` and `npm run dep:policy`;
  - read the diff adversarially.
- **Merging, when the owner has named the PR:**
  - `main`'s ruleset is strict: six required checks, and the branch must be up to date
    with `main`. Zero approvals.
  - Bring a behind branch up to date by merging `main` into it, never by rebasing: GitHub's
    update-branch, or a local merge pushed normally. Re-run the checks and wait for CI.
  - If the merge from `main` changed anything that matters, review again before merging.
    #69's last review, after `main` was merged in (`53efb80`), found nothing lost in the
    merge, and one defect in the plan section added after it (`64f83cf`), fixed in
    `ee96529`.
  - Merge pinned to the head that was checked:
    `gh api -X PUT repos/mohammedali-770/ERP/pulls/<n>/merge -f merge_method=merge -f sha=<head>`.
  - Then confirm `main`'s new commit.
- **Commit messages:**
  - plain prose, saying what changed and why, and what was verified;
  - a `Requirements:` line with real identifiers;
  - end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and a
    `Claude-Session:` line, as the session's instructions give;
  - no model identifiers anywhere in the repository or a PR.
- **PR bodies:**
  - What it does, what it holds back, how it was verified, and what is the owner's.
  - Kept current: when a branch changes after review, say what changed since.
  - End with the Claude Code line and the session link.
- **Documentation:**
  - Every decision lands in an ADR, as an addendum dated and saying what was found and by
    whom.
  - Anything undecided goes into `docs/program/open-questions.md` rather than being
    guessed.
  - When a check changes, update its row in `CLAUDE.md`'s enforced table.
  - Migration history is a ledger: a mistake is corrected by a new migration, never by
    editing an old one.
- **Writing style:** plain English, short sentences, concrete facts, no hedging.

---

## 7. Practical notes on the environment

- **Node 22** runs TypeScript directly. `npm ci` comes first.
- **`db:check` and `db:fixtures` need PostgreSQL 15–17 server binaries.** The cloud
  container has `/usr/lib/postgresql/16/bin`. Run as root, the tools drop to the
  `postgres` user themselves. They need no Docker.
- **The pgTAP suites without Docker.** `supabase start` and `npm run db:test` need a Docker
  daemon, which the cloud container did not have. Instead:
  1. Make the cluster UTF8, as `tools/db-check/src/cluster.ts` does: `initdb -E UTF8
     --lc-collate=C --lc-ctype=C.utf8`. The container's locale is POSIX, so a plain
     `initdb` gives SQL_ASCII, where `length()` counts bytes and 0012's Arabic checks
     fail.
  2. Build a scratch database from the files, in order:
     - every file in `supabase/migrations/`, sorted;
     - then the seed files in the order of `sql_paths` in `supabase/config.toml`.
  3. pgTAP is not in a fresh container (absent on 2026-10-22). As root, install it first:
     `apt-get update && apt-get install -y postgresql-16-pgtap`. Then run
     `create schema tap; create extension pgtap schema tap`.
  4. Run each suite with `PGOPTIONS='-c search_path=public,tap' psql -X -t -A -f supabase/tests/NNN_….sql`.
     Look for `not ok` lines.
  5. Skip suite 040, which needs Supabase's `storage` schema.

  The 2026-10-16 session drove a local cluster on port 55510 with a socket in
  `/tmp/erp-e2e`, started with `pg_ctl` through `setpriv` as `postgres`.
- **psql pitfalls:**
  - Always use `-X -P pager=off`.
  - Never give `\g` an argument that looks like a filename: it once wrote a stray file
    into the repository root.
  - To bind a prompted value, use `\bind :name`. `:'name'` sends the quotes too.
- **The Supabase connector (MCP):**
  - `execute_sql`, `list_migrations` and `list_edge_functions` are fine for read-only
    checks.
  - `apply_migration` records apply-time versions and times out on large files.
  - It cannot deploy the edge functions.
  - Never point any of it at the live refs in §0.
- **GitHub:**
  - The `gh` CLI is installed and `gh api` works through the session's proxy, for PRs,
    checks, merges and update-branch.
  - The proxy refuses some paths, among them `repos/…/environments` (403).
  - The `mcp__github__*` tools work too. The MCP servers sometimes disconnect after a
    container restart and reconnect later.
- **Reviews with subagents.** Each review in these sessions ran reviewer agents, one per
  lens, then an adversarial verifier per finding (§6), on a read-only checkout so they
  could not touch the working tree. The Workflow tool runs that only when the owner has
  opted in to multi-agent work; otherwise use the Agent tool.
- **Restarts:** the container restarted several times during these sessions; `/tmp` and
  `/root` survived. It is reclaimed when the session ends, so anything unpushed is lost.
- **Subscriptions:** no PR subscription or scheduled check-in for this repository is
  running.

---

## 8. Suggested first steps for the next session

1. Read `CLAUDE.md`, this file, `docs/program/consolidation-plan.md` (above all "Decided
   2026-10-22") and `docs/program/open-questions.md`.
2. Run `git fetch`, and check the `Deploy to staging` runs and whether staging is paused
   (the Supabase connector's `get_project`, read-only). The owner may have acted since.
3. **If staging has been deployed**, offer the read-only verification in §4. If the owner
   reports the site not working, diagnose it read-only and fix the cause in the
   repository, by PR.
4. **If it has not**, the owner's setup in §4 comes first. Help with it when asked, but
   every step there is the owner's to take.
5. Then, one feature at a time and only as the owner directs. Ask first which branch the
   next step goes on (§0, rule 6). Then:
   - module 10;
   - the remaining sweep items in §5. Row 8 is now unblocked, since #69 has merged; rows
     6 and 5 come next. Row 21 still needs recording as Q-31;
   - modules 1–4's switch-on drafts.

   Each lands by PR, reaches staging by the owner's run, and is tried there before the
   next.
