# UAT — Menu management

**Run by:** head office menu owner, plus a branch manager for the availability part
**Duration:** about two hours

Covers `MNU-001`..`MNU-016`.

> The asymmetry being tested: **head office controls prices, branches control
> availability only** (`MNU-001`, `MNU-002`). If a branch manager can change a
> price here, the pack fails outright.

---

## Part 1 · Authoring (head office)

| # | Task | Passes when |
|---|---|---|
| 1.1 | Create a product with Arabic and English names | Both stored; both appear where expected |
| 1.2 | Add sizes with different prices | Correct per size |
| 1.3 | Create a modifier group with a minimum and maximum | Limits enforced when ordering |
| 1.4 | Create two mutually exclusive choices | Selecting one clears the other |
| 1.5 | Build a combo with child selections | Choices behave as intended |
| 1.6 | Set a price that starts next Monday | Today's price unchanged; scheduled one visible |

## Part 2 · Publication

| # | Task | Passes when |
|---|---|---|
| 2.1 | Publish to one branch only | Other branches unaffected |
| 2.2 | Publish different prices per channel | Each channel shows its own |
| 2.3 | Send a change for review, then approve it | Draft, review, approve and publish are distinct |
| 2.4 | Roll back a publication | Previous version restored; history retained |
| 2.5 | Check who approved a past change | Recorded and findable |

## Part 3 · Availability (branch manager)

| # | Task | Passes when |
|---|---|---|
| 3.1 | Mark an item unavailable with a return time | Required to pick a time, not optional |
| 3.2 | Check every channel | Gone from till, app and call centre promptly |
| 3.3 | Wait for the return time | Comes back **automatically**, no action needed |
| 3.4 | Check the history | Shows who made it unavailable and why it returned |
| 3.5 | **Try to change a selling price** | **Refused.** You cannot |

## Part 4 · When a channel fails

| # | Task | Passes when |
|---|---|---|
| 4.1 | Publish with one delivery connector unreachable | Other channels update; failure is reported |
| 4.2 | Find out which channel is stale | Visible without technical access |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |

| | |
|---|---|
| Blocking issues | |
| Observer | |
