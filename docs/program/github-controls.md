# GitHub controls

The repository settings that make [`governance.md`](./governance.md) §2 and §3
mechanisms rather than promises.

This document exists because those rules were fully written and **entirely
unconfigured**: `main` was not protected, no check was required, and the rule
"never commit directly to a protected branch" did not name a branch. A rule
enforced only by whoever happens to be working is the arrangement this
programme's own history says fails.

> **These settings are applied by the owner in the repository's Settings.** No
> agent session has a tool for branch protection, which is correct —
> `governance.md` §3 lists permission configuration as an owner-approved action.
> This document is the specification and the record; applying it is a human act.

---

## Intended configuration — `main`

Settings → Branches → Add branch ruleset (or classic branch protection) for
`main`:

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | **on** | governance §2 — every change arrives by pull request |
| Required approvals | **1** | governance §2 — explicit human owner approval before merge |
| Dismiss stale approvals on new commits | **on** | An approval is of a diff, not of a branch name |
| Require status checks to pass | **on** | |
| Require branches to be up to date before merging | **on** | A branch that was green against an older `main` has not been tested against the one it will join |
| Block force pushes | **on** | governance §3 — history rewriting is an owner-approved action |
| Block deletions | **on** | governance §3 — branch deletion likewise |

### Required status checks

The four jobs in [`ci.yml`](../../.github/workflows/ci.yml), by their **job
names** as GitHub reports them:

| Check | What fails it |
|---|---|
| `Requirement baseline` | The catalogue, risk register or index is stale, or traceability breaks |
| `Bounded-context boundaries` | A service imports another service |
| `Typecheck and tests` | Either fails |
| `Risk spikes` | Any spike fails, **or a control case passes** |
| `Database schema` | A migration does not apply, a structural invariant is broken, the seed is not reproducible, or a credential-shaped string is committed |
| `Database stack` | `supabase db reset` does not rebuild the database, or a pgTAP suite fails |

A required check whose name does not exactly match a job blocks every merge with
no way to satisfy it, so these are copied from the workflow rather than from
memory.

### Deliberately **not** required: `F0 exit criteria`

[`f0-gate.yml`](../../.github/workflows/f0-gate.yml) is **expected red** until
B-03 lifts — five requirements name only the two procedure spikes, which have no
harness, so they have no acceptance evidence and the gate says so. Requiring it
would block every merge on a blocker that no pull request can clear.

`f0-gate.yml` carries the note "make it required once the gate is declared".
**This document is where that happens.** When B-03 lifts and the gate goes green,
add `F0 exit criteria` to the required checks above and record the date below.

### Administrators

Whether the ruleset applies to administrators is the owner's call. On a
repository with one administrator, bypass is the difference between a control and
a reminder — but an owner who cannot merge their own hotfix is a real cost.
**Either choice is defensible; leaving it unrecorded is not.** Record it below.

---

## Current state

| | |
|---|---|
| `main` protected | **Not yet** — to be applied |
| Required checks configured | **Not yet** — six now, not four (two database jobs added 2026-09-20) |
| Administrators included | **Not recorded** |
| Last verified | 2026-09-20 |

Checked at every phase gate, because the gap between this table and the table
above is the only thing that says whether the rules are running.

---

## What is deliberately not configured

- **GitHub Issues, labels, milestones or a project board.** Blockers, open
  questions, the F1 backlog and the risk register live in `docs/program/` as
  markdown, and several are machine-checked by `req:lint` — every risk cited must
  exist in the register, every F1 requirement must belong to an epic. A second
  copy in GitHub Issues would be one the linter cannot see, and two sources of
  truth about what is blocked is worse than one that is occasionally out of date.
- **CODEOWNERS.** governance §6 maps change types to reviewers — Finance for
  payments, Privacy for personal data, Product Owner for anything in `docs/adr/`.
  Those roles have no GitHub accounts yet, and a CODEOWNERS file naming one person
  as all seven reviewers would record a fiction. Worth adding when the accounts
  exist; not before.
