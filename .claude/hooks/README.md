# Session hooks

One hook, version-controlled here rather than living only in a container that
gets reclaimed.

## Why this is in the repository

`stop-git-check.sh` is the Stop hook: it refuses to end a turn while work exists
only in this container. That is a good rule and the reason it is kept rather
than removed.

It arrived as `~/.claude/stop-hook-git-check.sh`, provided by the launcher and
wired up in `~/.claude/launcher-settings.json`. Both are outside the repository,
neither is reviewable in a pull request, and the environment manager restores
them — a correction made to that copy on 2026-09-21 at 07:50 was silently
reverted at 08:25, and the same false positive resumed. A rule that cannot be
corrected in a way that survives is the arrangement `github-controls.md` was
written about.

So the script is copied here verbatim, changed in one marked place, and wired by
[`../settings.json`](../settings.json) through `$CLAUDE_PROJECT_DIR`.

## The bug

`$upstream..HEAD` asks "which commits are missing from this branch's own remote
ref", when the question the hook is actually asking is "could any of this work
be lost".

Those differ after a pull request merges. The session rules require restarting
the branch from the new `origin/main` once its pull request has landed, so
`HEAD` becomes the merge commit — on `main`, published, unlosable — while
`origin/<branch>` still points at the pre-merge commit. The hook then reports
unpushed work on every subsequent turn, and the only thing that would satisfy it
is pushing `main`'s history back onto a feature branch.

Eleven pull requests merged on 2026-09-21, so this fired on most turns of that
day.

The fix counts commits that exist on **no remote ref** (`HEAD --not --remotes`),
which is the idiom the signing block in the same script already uses, for the
same reason. It is gated on `origin/<branch>` resolving, exactly as that block
is gated and for the reason its comments give: on a single-branch or shallow
clone there is no remote ref covering the branch's base, and `--not --remotes`
would then sweep in teammates' published commits. Where the gate does not hold,
the original comparison is kept unchanged.

## Evidence

Run against a scratch repository built to each shape, comparing the pristine
launcher script with this one:

| Shape | Launcher script | This script |
|---|---|---|
| Branch reset onto `main` after its PR merged, nothing local | **"1 unpushed commit"** | silent |
| The same, plus one genuinely local commit | "**2** unpushed commits" | "**1** unpushed commit" |
| Branch origin has never seen, `origin/HEAD` resolves | "1 unpushed, no remote branch" | identical |
| Uncommitted changes in the tree | refuses | refuses |

The second row is the one that matters. A fix that merely silenced the check
would have reported nothing there; this one reports the real commit and drops
the phantom.

## Still outstanding — an owner action, outside this repository

Hooks from every settings source are merged, so **the launcher's copy still runs
alongside this one**, and it is still the uncorrected version. Until it is
removed, the false positive continues regardless of what is in this directory.

Removing it means deleting the `Stop` hook entry from the session's cloud
environment settings — outside the repository, so no agent session may do it
(`CLAUDE.md` §1). Once it is gone, this file is the only Stop hook and the
behaviour above is what runs.
