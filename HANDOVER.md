# Handover — for the next AI session on this repository

Written 2026-10-16 by the previous agent session, at the owner's request, when the owner
stopped that session. It records where the work stands, what is waiting on whom, what was
done but not pushed, and how work has been done here.

**`CLAUDE.md` is binding and this does not replace it.** Read it first, then this. Where
the two disagree, `CLAUDE.md` wins.

This file lives on `claude/planning-session-65wym0`, which is the head of held PR #68, so
it shows in that PR's diff. It is not on `main`.

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
   - Any write to it is owner-approved, one action at a time.
   - The previous session applied migrations there only with the owner's explicit
     approval, and only through the connector.
4. **Merging is the owner's.**
   - Never merge a PR.
   - Never approve a pending deployment.
   - Never dispatch the `Deploy to staging` workflow.
5. **Agent sessions act as the owner's own GitHub account** (`mohammedali-770`, an
   administrator). So GitHub cannot tell an agent's merge, dispatch or approval from the
   owner's, and `main`'s ruleset needs zero approvals
   ([`docs/program/github-controls.md`](docs/program/github-controls.md), "Why zero required
   approvals"). Only the rules above stop an agent. Behave accordingly.
6. **Branches.**
   - The session's designated branch has been `claude/planning-session-65wym0`.
   - Pushing to any other branch needs the owner's explicit permission. It was given once,
     for `claude/staging-deploy`.
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
  5. a staff-testing (UAT) pack;
  6. switch-on by migration, held until staff sign the pack and operations sign the
     process mapping (MFG-012).
- **`main` is at `11384c1`** (PR #67's merge).
- **Modules 1–9 have steps 1–5 on `main`:** items and units, suppliers, transfer prices,
  facilities, stock and movements, notifications, stock alerts, purchase orders and
  receipts, and ordering setup.
- **Switch-ons are drafted and held for modules 5–9:**
  - modules 5–8 in closed PRs #48, #53, #58 and #63;
  - module 9 in open PR #68.
- **Modules 1–4 have no switch-on drafted.** Every held pilot needs module 1 (items) open
  organisation-wide first.
- **Module 10, branch orders, is the next module to build.** It is the largest one, and it
  dates orders through `erp.order_day()` from module 9.
- **The UAT packs are run by real staff, not by agents.** All 18 have Arabic copies under
  `docs/lab/uat/ar/`, which need review by a native speaker before use. Each pack waits
  on the owner's answers to its questions and on a session with staff.

---

## 2. Open pull requests

### PR #68 — HELD: module 9 switch-on (ordering setup as a pilot organisation-wide)

- **Branch:** `claude/planning-session-65wym0`. **Head:** `4548b54` before this handover's
  commit. CI was green and it had no merge conflict.
- **Do not merge.** It merges only once its seven preconditions hold, listed in the PR
  body. Among them:
  - staff sign the ordering-setup pack;
  - operations sign off the process mapping;
  - items are open organisation-wide;
  - the owner answers the pack's ten questions, Q-29 and Q-30;
  - the migration takes a fresh timestamp later than every migration merged by then (Q-23).
- **What it adds:**
  - `supabase/migrations/20261008000200_ordering_setup_pilot_organisation_wide.sql`;
  - ADR-0033's step 6 addendum;
  - Q-29 and Q-30 in `docs/program/open-questions.md`;
  - Q-23 extended;
  - row 9 of the consolidation plan;
  - question J and Part 11 of the ordering-setup pack (en and ar).
- **The established pattern when the owner closes a held PR:** a later commit on the branch
  removes the migration file and keeps the docs, and the docs reach `main` with the next
  PR, as happened after #48, #53, #58 and #63.
- **This handover's files** (`HANDOVER.md`, `docs/handover/`) ride on this branch too.
  When the docs go to `main`, decide with the owner whether these go with them.

### PR #69 — Staging: a manual, reviewer-gated deploy workflow, and the console's Vercel settings

- **Branch:** `claude/staging-deploy`. **Head:** `d817a1b`.
- **State:** all six checks green, no merge conflict. The one Codex thread is answered and
  resolved. It waits on the owner.
- **What it adds:**
  - `.github/workflows/staging-deploy.yml`, run by `workflow_dispatch` from `main` only,
    inside the GitHub environment `staging`. It runs `supabase link`, then
    `supabase db reset --linked`, then `supabase functions deploy`, with CLI 2.34.3.
  - `apps/console/vercel.json`.
  - The runbook section "Staging, as built" in
    [`docs/program/supabase-deployment.md`](docs/program/supabase-deployment.md).
  - ADR-0018's addendum.
  - An inventory row.
  - A Q-24 note.
  - A fix to `tools/db-check/src/seed.ts`, which had read a comment as the `[db.seed]`
    section.
- **The owner's setup steps, in order** (the PR body and the runbook give the detail):
  1. Create the `staging` environment: main-only, the owner as reviewer, and environment
     secrets `SUPABASE_ACCESS_TOKEN` and `STAGING_DB_PASSWORD`.
  2. Reset the staging database password.
  3. Merge.
  4. Dispatch the workflow, read it at the commit the run shows, and approve.
  5. Set `erp_edge`'s password with `psql`'s `\password`, never in the SQL editor, which
     Supabase logs.
  6. Set `ERP_DATABASE_URL`: the transaction pooler string with `sslmode=require`.
  7. Import the repository in Vercel:
     - Root Directory `apps/console`;
     - `VITE_ERP_FUNCTIONS_URL` set before the first build;
     - auto-assigned production domains off.
  8. Set `ERP_ALLOWED_ORIGINS` to the console's exact origin.
- **After the first run**, if the owner asks, verify staging read-only:
  - Compare a catalogue fingerprint of the hosted `erp` schema with a local build from the
    same migrations. Hash the columns, constraints, indexes, function definitions and
    ACLs, triggers, policies, RLS, table ACLs, views, roles and default ACLs. Expect
    platform differences: PostgreSQL 17's `m` (MAINTAIN) privilege in owner ACLs,
    creator memberships, and roles being cluster-level.
  - Check the seed's rows exist.
  - Check the twelve functions are listed.

---

## 3. Staging, as it actually is today

- **Created 2026-10-15** at the owner's instruction, in Spicy Meal Org (`bcwztszkdbnhidhmibyv`).
- **Migrations 1–10 are applied**, through the Supabase connector's `apply_migration`. The
  connector records each version as the time it was applied, not the file's number.
- **Migration 11 (identity) is not applied.** It timed out twice: the connector fails at
  about 60 s on payloads of roughly 45 KB or more. Nothing of it was applied.
- **The edge-function bundles (about 100 KB each) cannot go through the connector either.**
  That is why the workflow exists.
- **The workflow's first `db reset --linked` rebuilds everything from the files.** It
  truncates `supabase_migrations` history and drops user schemas, keeping roles. The
  CLI's v2.34.3 source was read to confirm this.
- **`erp_edge` does not exist on staging yet:** it comes with migration 0014. So the
  capability-log grant fixed in §4 is not exploitable there today.
- **Known exposures**, recorded in the runbook and Q-24:
  - The seed's synthetic cashier PINs are in clear in this public repository, so anyone can
    sign in to staging as those cashiers.
  - Staging's `sign_in_log` grows until a rebuild.
- **The access token reaches every project in the account.** The durable fix, staging in a
  Supabase organisation of its own, is the owner's to make (runbook §1).
- **Vercel is not set up yet.**

---

## 4. Work done but not pushed — preserved as patches

The owner stopped the session before deciding whether these two branches could be pushed.
They exist only as the patch files below; the container that held the branches is gone
when the session ends. **Pushing either needs the owner's permission for a new branch;
merging, and running either on staging, is the owner's.**

To restore a branch exactly:

```bash
git fetch origin main
git checkout -b claude/<name> origin/main
git am docs/handover/patches/<name>/*.patch
```

Both were checked to apply cleanly to `11384c1` and to reproduce the original trees byte for
byte.

### 4a. `ci-pin-database-runner` — one line, and urgent

- **Patch:** [`docs/handover/patches/ci-pin-database-runner/`](docs/handover/patches/ci-pin-database-runner/), one commit.
- **The problem:**
  - GitHub's annotation on `main`'s "Database schema" runs: "The ubuntu-latest label will
    migrate to Ubuntu 26 beginning October 19, 2026" (actions/runner-images#14748).
  - The 26.04 image installs PostgreSQL 18 alone, under `/usr/lib/postgresql/18/bin`, off
    PATH.
  - `tools/db-check/src/cluster.ts` looks only for versions 17, 16 and 15, then PATH.
- **The consequence:** from then on, `db:check` and `db:fixtures` fail on every run, on
  `main` and every PR.
- **The fix:** pin that one job (`database` in `.github/workflows/ci.yml`) to
  `ubuntu-24.04`, which keeps PostgreSQL 16.
- **Kept apart from 4b** so it can merge first. `npm run verify` passed with it.
- **Later:** move the job, and add 18 to `PG_BIN_CANDIDATES`, only after both checks have
  passed on 18.

### 4b. `capability-decision-writer` — three commits

- **Patch:** [`docs/handover/patches/capability-decision-writer/`](docs/handover/patches/capability-decision-writer/).
- **Found by a sweep** of the repository's checks against what `CLAUDE.md` says they
  enforce (§5).

**Migration 0025**, `supabase/migrations/20261016000100_capability_decision_has_one_writer.sql`:
- It revokes `erp_app`'s INSERT on `erp.capability_decision` and drops the policy
  `erp_app_append`.
- 0010 granted both. Every decision has always gone through `erp.decide_capability()`,
  which writes as the owner, so nothing used them.
- But `erp_edge` is `erp_app`, so the edge credential could append a permanent decision
  that function would refuse: an actor who never decided, a protected capability closed,
  a state that never followed.
- The log refuses UPDATE, DELETE and TRUNCATE to everyone, so such a row could never be
  corrected.
- 0011 had stated the one-writer rule for its own log and named 0010 as the exception.
- **This is a permission change.** Its merge and its deployment are each the owner's.
- **Re-date PR #68's held migration** later than `20261016000100` when it comes back (Q-23).

**`tools/db-check`:**
- `every-decision-log-is-append-only` also refuses INSERT, for `erp_app` on any log but
  `erp.event_log`, and for `erp_read` on any log.
- `no-erp-object-in-public` covers sequences, foreign tables, composite types, routines and
  domain, enum and range types, not only tables and views. Extension members are left to
  `no-extension-in-public`.
- `every-runtime-definer-route-is-gated`:
  - strips comments, quoted strings and quoted identifiers in one left-to-right regex
    pass;
  - ends a line comment at `\n` or `\r`, as the scanner does;
  - requires `erp.assert_permitted(` standing alone, after a non-identifier character, so
    `noterp.assert_permitted(` does not count;
  - reports any route that sets `standard_conforming_strings`.
- **Documented residuals:** nested comments, backslash-escaped quotes in `E''` strings and
  dollar quotes inside a body. No route has any of them.
- **The runner** reads every assertion through `select chr(30) || coalesce(replace(v.violation::text, chr(30), ' '), '') …`
  and splits on chr(30). A NULL, blank, whitespace-only or multi-line violation now
  counts exactly once; before, a NULL violation passed.
- **`fail()` now stops the scratch cluster.** Before, `process.exit()` skipped the
  `finally` and left a postmaster running.
- **Three runtime controls run on every `db:check`:**
  - a blank-violation reader test;
  - a routine, a sequence and a domain left in `public`;
  - three probe routes for the gate:
    - one that only mentions the gate;
    - one that calls it past every lexical trap;
    - one that sets `standard_conforming_strings` off.

**pgTAP:**
- suite 060 asserts the runtime holds no INSERT on the log (`plan(21)`);
- suite 010 mirrors the wider `public` check.

**Docs:**
- four rows of `CLAUDE.md`'s enforced table;
- an addendum to ADR-0022;
- the consolidation plan's note on 0010.

**Verification at `cd679f7`:**
- `npm run db:check` passes: 133 checks, the controls included.
- `db:fixtures` passes.
- Every pgTAP suite but 040 passes. 040 needs Supabase's storage schema.
- `verify` passes: 695 tests.
- `secret:scan` and `dep:policy` pass.
- **Thirteen copies of the tree** each reverted one piece. Each made `db:check` fail with
  exactly the matching check. The pieces:
  - 0025 removed;
  - the old `public` query;
  - the raw `strpos`;
  - the line-based reader;
  - comments stripped before strings;
  - no identifier branch;
  - a comment ending only at a newline;
  - the `btrim` wrapper;
  - the needle without its left boundary;
  - no report for the setting;
  - no separator replacement;
  - identifiers read last;
  - identifiers read first.
- **The pgTAP assertions** fail with the grant restored, or with a function left in
  `public`.
- **The `fail()` change** was checked on two paths: a control naming a missing assertion,
  and a migration that fails to apply. Both exit 1 and leave no postmaster.
- **Reviews:** one independent review, then a confirming review of the follow-ups. Every
  upheld finding was fixed. The commits record each round.

**It overlaps PR #69 in two places**, neither on the same lines:
- `CLAUDE.md`: a different hunk.
- `tools/db-check`: #69 changes `seed.ts`, this changes `assertions.ts` and `cli.ts`.

Whichever merges second should be brought up to date with `main`, and `db:check` re-run.

---

## 5. The sweep's remaining findings

The sweep covered:
- plans and roadmaps;
- stale documentation;
- defects in tooling;
- `CLAUDE.md` rows whose enforcer does not enforce them;
- deferred follow-ups.

It found 54 items, merged into 25, each verified by a second agent. Rows 1–4 are done in
§4b. The rest, ranked and all fixable in the repository unless marked, with paths at
`11384c1`. **Re-verify each before acting.** These are leads, not facts.

| # | Finding | Kind | Size | Where |
|---|---|---|---|---|
| 5 | Four req-lint rules listed as enforced cannot fail as claimed. (a) The 22 test references in `proposed.yaml` are never resolved. (b) An unreferenced spike or pack is only a warning. (c) Citations in migration headers are never read. (d) A missing baseline or backlog, or a reformatted risk register, switches a rule off | unenforced rule | M | `tools/req-lint/src/rules.ts:135-139, 247, 255, 32, 276, 375`; `tools/req-lint/src/cli.ts:92-97, 343`; `CLAUDE.md` rows for those rules |
| 6 | No test proves hiding `inventory.stock_alerts` or `procurement.purchase_limits` stops their writes; every other module capability has one (e.g. `080_items_test.sql:100-106`) | test gap | S | `supabase/tests/170_stock_alerts_test.sql:340`; `180_purchase_orders_test.sql:247` |
| 7 | `db:fixtures` finds no write fixture in suites 160–190, and only 16 of about 100 in 150; 13 `throws_like` fixtures are unseen | unenforced rule | M | `tools/db-fixtures/src/parse.ts:33`; `tools/db-fixtures/src/cli.ts:92` |
| 8 | `db:fixtures` reads the seed list with its own regex (first `sql_paths =` anywhere), the class of bug PR #69 fixed in db-check; reuse `parseSeedPaths` after #69 merges | defect | S | `tools/db-fixtures/src/cli.ts:36-42, 87` |
| 9 | Two db:check checks name their targets instead of discovering or pinning them: the item guard triggers don't pin `tgfoid`, and one projection check lists rather than discovers | unenforced rule | S | `tools/db-check/src/assertions.ts:388-399, 1412-1433` |
| 10 | `docs/architecture/invariants.md`'s "Enforced today" table and SEC-006 predate modules 2–9 (I-7 says no such line exists yet, but seven tables reference `item_unit_seam`) | stale doc | S | `docs/architecture/invariants.md:12-28`; `docs/compliance/security-controls.md:15` |
| 11 | `CLAUDE.md`'s descriptive lines are dated: the packs "need Arabic translation" (all 18 are translated; native review remains); `supabase/` "none is deployed, no hosted project exists" (PR #69 updates this); no mention of the consolidation plan | stale doc | S | `CLAUDE.md` "What this repository is" |
| 12 | Process mappings awaiting operations' sign-off describe modules 7–8 as not built; the notifications pack's question D asks something ADR-0031 answered | stale doc | S | `docs/estate/process-mapping-notifications.md:47-78`; `process-mapping-stock.md:102-110`; `docs/lab/uat/notifications.md:18, 92` (+ `ar/`) |
| 13 | Five UAT packs' "connection drops" part cannot pass as written (all-local setup; Vite reloads lose Retry); `stock-alerts.md:117-124` has wording that works | follow-up | S | `docs/lab/uat/{items,suppliers,transfer-prices,facilities,stock}.md` (+ `ar/`); ADR-0033:595-600 |
| 14 | Settled decisions still shown open or superseded: the estate map states ADR-0020's two databases; B-04 and D-2 shown open; Q-20 points at a D-6 that does not exist | stale doc | S | `docs/estate/migration-map.md:45-47, 104`; `docs/estate/inventory.md`; `docs/program/f0-exit-criteria.md:77`; `docs/program/open-questions.md`; `docs/program/executive-decision-pack.md` |
| 15 | Merge-gate text says "five" blocked requirements (req:lint reports four: PRN-014, OFF-012, OFF-013, OFF-014); governance §2 says "the four CI checks" and "required reviews" (the ruleset has six checks, 0 approvals) | stale doc | S | `.github/workflows/f0-gate.yml:10-13`; `docs/program/github-controls.md:91-92`; `docs/program/governance.md:44-46` |
| 16 | Landing and setup docs stop at 2026-10-04: the console README stops at module 4, the supabase README names 5 of 12 functions, the spikes index calls the ZATCA spike wholly blocked, `.env.example` documents an unread `ERP_ENV` and omits the variables the code reads | stale doc | S | `README.md`; `apps/console/README.md`; `supabase/README.md:18-21`; `spikes/README.md`; `.env.example` |
| 17 | Roadmap and architecture docs never revised for ADR-0021 ("no implementation before their phase" for inventory and procurement), and they credit boundary:check, which never scans `supabase/` | stale doc | S | `docs/program/roadmap.md`; `docs/architecture/overview.md`; `docs/domain/bounded-contexts.md` |
| 18 | No db:check rule that capability state, person status and roles equal the latest decision about them, though every route's gate reads them; the two logs also lack an ordering column such a check needs | unenforced rule | M | `tools/db-check/src/assertions.ts`; `supabase/migrations/20261001000100_capability_registry.sql`; `20261002000100_identity.sql` |
| 19 | "The seed is synthetic" scans only `erp.event_log`; supplier contacts (SEC-008) are never scanned, and PR #69 loads this seed into staging from a public repo | unenforced rule | M | `tools/db-check/src/assertions.ts:1145-1164`; `supabase/tests/050_seed_is_synthetic_test.sql`; `supabase/seeds/0050_suppliers.sql` |
| 20 | Three latent checker gaps: dropping tools' `src` from tsconfig leaves the CLIs untypechecked with checks green; same-line and dynamic imports cross a service boundary unseen; two console "latest check" tests will miss the next widened stock kind | defect | S each | `tools/dep-policy/src/rules.ts:393`; `tools/boundary-check/src/rules.ts:72-73`; `apps/console/test/stock.test.ts:212-216`; `apps/console/test/notifications.test.ts:189-192` |
| 21 | A real database has no way to get its organisation: only the seed creates a company, brand or operating unit, so production could hold no facility or item, and no switch-on anchored on a warehouse can work. Record it as an open question (Q-31, after #68's Q-29 and Q-30) | plan gap, owner decision | S to record | `supabase/migrations/20260920000300_organisation_hierarchy.sql`; `supabase/seeds/0010_organisation.sql`; ADR-0028:240-248 |
| 22 | Module 1's and both imports' refusals fall back to "A value is not valid." with English underneath (about 16 rules); ADR-0024 makes wording a gate on staff testing | follow-up | M | `apps/console/src/messages.ts`; ADR-0024:313-321 |
| 23 | Phase 3 carry-overs have no plan; the warehouse's purchase-order print file was read but appears in no "Not here" list; language is stored per browser, so a shared computer keeps the last person's | plan gap | S to record | `docs/program/consolidation-plan.md`; `docs/estate/process-mapping-purchase-orders.md`; `apps/console/src/session.ts:69-80` |
| 24 | Switch-ons for modules 1, 2 and 4 are not drafted, and module 4 is in no precondition list; all held pilots need module 1. Drafting is engineering work; the scope is the owner's to confirm | plan | L | `docs/program/consolidation-plan.md:229-232` |
| 25 | "View as" (CAP-P11): two docs still say it waits on sessions (shipped 2026-10-03); it appears as no next step, and `preview` is hard-coded `false` | follow-up | S docs / L build | ADR-0022:123; `docs/program/consolidation-plan.md:149-152`; `apps/console/src/viewer.ts:26` |

**Owner-gated items the documents say are pending:**
- **Staff testing:** a session with real staff for each module's pack, after the owner
  answers the pack's questions.
- **Arabic review:** a native speaker reviews the Arabic packs.
- **Operations sign-off** of all nine process mappings (MFG-012).
- **Open questions:** Q-23 to Q-30, the F0 checklist's human lines, executive decisions
  D-1, D-3 and D-4, and Q-20 (data residency) before any real data.
- **Every merge**, the staging setup, and whether staging moves to its own Supabase
  organisation.

---

## 6. How work has been done here

This is what the owner has accepted and expects.

- **One module step per PR**, from the designated branch.
  - A held switch-on is opened as a PR titled `HELD — …` and closed, never merged.
  - Its docs reach `main` with the next PR, once the migration file is removed from the
    branch.
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
- **Commit messages:**
  - plain prose, saying what changed and why, and what was verified;
  - a `Requirements:` line with real identifiers;
  - end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and a
    `Claude-Session:` line, as the session's instructions give;
  - no model identifiers anywhere in the repository or a PR.
- **PR bodies:**
  - What it does, what it holds back, how it was verified, and what is the owner's.
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
  container had `/usr/lib/postgresql/16/bin`. Run as root, the tools drop to the
  `postgres` user themselves. They need no Docker.
- **The pgTAP suites without Docker.** `supabase start` and `npm run db:test` need a Docker
  daemon, which the cloud container did not have. Instead:
  1. Build a scratch database from the files, in order:
     - every file in `supabase/migrations/`, sorted;
     - then the seed files in the order of `sql_paths` in `supabase/config.toml`.
  2. Run `create schema tap; create extension pgtap schema tap`.
  3. Run each suite with `PGOPTIONS='-c search_path=public,tap' psql -X -t -A -f supabase/tests/NNN_….sql`.
     Look for `not ok` lines.
  4. Skip suite 040, which needs Supabase's `storage` schema.

  The previous session drove a local cluster on port 55510 with a socket in `/tmp/erp-e2e`,
  started with `pg_ctl` through `setpriv` as `postgres`.
- **psql pitfalls:**
  - Always use `-X -P pager=off`.
  - Never give `\g` an argument that looks like a filename: it once wrote a stray file
    into the repository root.
  - To bind a prompted value, use `\bind :name`. `:'name'` sends the quotes too.
- **The Supabase connector (MCP):**
  - `execute_sql` is fine for read-only queries.
  - `apply_migration` records apply-time versions and times out on large files.
  - It cannot deploy the edge functions.
  - Never point any of it at the live refs in §0.
- **GitHub:**
  - Prefer the `mcp__github__*` tools.
  - `gh api` works through the session's proxy.
  - The MCP servers sometimes disconnect after a container restart and reconnect later.
- **Restarts:** the container restarted twice during the last session; `/tmp` and `/root`
  survived both. It is reclaimed when the session ends, so anything unpushed is lost.
  That is why §4's patches are committed.
- **Subscriptions:** PR activity subscriptions and scheduled check-ins were all cancelled
  when the owner stopped the session. None is running.

---

## 8. Suggested first steps for the next session

1. Read `CLAUDE.md`, this file, `docs/program/consolidation-plan.md` and
   `docs/program/open-questions.md`.
2. Run `git fetch` and check PRs #68 and #69. The owner may have acted on them since.
3. **Ask the owner about §4a before 2026-10-19:** whether to push the CI pin as its own
   branch and PR. After that date, every PR's "Database schema" check can fail for a
   reason none of them caused.
4. Ask the owner whether to push §4b as its own branch and PR.
5. Then, only as the owner directs: the remaining sweep items in §5, starting with rows 8,
   6 and 5; module 10; or modules 1–4's switch-on drafts.
