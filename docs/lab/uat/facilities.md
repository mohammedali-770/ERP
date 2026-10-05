# UAT — Branches and facilities

**Run by:** the person who will keep the branch list at head office (today the
administrator), plus the warehouse manager and a branch worker for the read-only parts
**Duration:** about an hour

This pack covers the facility master and the ordering area of each branch, on the screens
built in module 4 step 3 ([ADR-0028](../../adr/ADR-0028-facilities-and-branch-areas.md)
and its addenda). A branch worker is placed by assignment, and limited to it (`IAM-006`).
When they order, their phone must also be inside that branch's area (proposed
`IAM-P11`). The order check itself arrives with module 10, so this pack tests what that
check will read: the areas, as people keep them. This is step 5 of module 4: the module
is switched on only after this pack is signed.

> What is being tested: **can the person who keeps the branch list set each branch's area
> where its staff really stand, without help, and does the system keep every branch, and
> every change to it, for good?** If the participant can delete a facility, change its code,
> type or brand, change a closed facility without reopening it, or save an area that is not
> where they meant, the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. These are ADR-0028's open questions. Questions 2 to 4 decide how
module 10 uses the area, and are asked now because the participant knows the branches.

| # | Question | Today | Answer |
|---|---|---|---|
| A | What was the warehouse's "internal only" flag for, beyond hiding a branch from the area lookup? A central kitchen that orders nothing? A branch customers must not see? | Not carried | |
| B | Do managers and the administrator skip the area check when they order for a branch, as the warehouse let them? | Not decided: module 10 decides | |
| C | Is the distance from the branch kept on the order, as the warehouse kept it? It says where an employee stood, so it needs a notice and a retention period. | Not kept: the check stores nothing | |
| D | Is 100 m the right precision? Indoors a phone often reports 30 to 80 m, sometimes worse. | 100 m, as in the warehouse | |
| E | Who besides the administrator edits branches? Operations, for areas only, say? | The administrator alone | |
| F | What happens to the people assigned to a branch that closes? | Their roles stay; the closed branch admits no new work | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person and facility in it is synthetic.
- The participant, the warehouse manager and the branch worker each have a test account
  and a PIN. **Do not use their real employee numbers.**
- The participant brings the list of real branches from the warehouse system, and chooses
  two they know well. For each, they bring the point where its staff stand when they
  order, copied from a map on their phone (for example "24.713600, 46.675300"). The
  points are of business premises, not of any person.
- A second test account for the administrator, signed in by the observer on another
  computer, for Part 4.
- One unplugged network cable or a switched-off Wi-Fi, for Part 7.

---

## Part 1 · Finding facilities

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in, choose "Whole organisation", and open Branches and facilities | Found under Setup without help |
| 1.2 | Find the branch whose workers cannot order today | Test Branch Two found, and the participant can say why: it has no area |
| 1.3 | Find a branch by part of its Arabic name | Found |
| 1.4 | Show the closed facilities | The filter is found; none is closed yet |

## Part 2 · A new branch

| # | Task | Passes when |
|---|---|---|
| 2.1 | Create the first chosen branch with its real code, both names and its address, with a reason | Saved; its page shows it open, in Riyadh's time zone, flagged with no area |
| 2.2 | Create the second chosen branch, typing its code in small letters | Saved, with the code in capitals |
| 2.3 | Create a facility with Test Branch One's code | **Refused**; told the code is already used |
| 2.4 | Look for a way to change a branch's code, type or brand | **There is none.** The participant can say why: orders and people already name the branch by them |

## Part 3 · Where staff may order from

| # | Task | Passes when |
|---|---|---|
| 3.1 | On the first chosen branch, set the area by pasting the point copied from the map into Latitude | Both fields filled; saved; shown at 150 m |
| 3.2 | Open "View on a map" | The point is where the participant meant: the counter, not the car park or the next street |
| 3.3 | Move the area to a radius of 10 m | **Refused**; told a radius is 25 to 2000 m |
| 3.4 | Type a latitude with a comma for the decimal point (24,7136) | Told before anything is saved how to write it |
| 3.5 | Set the second branch's area by typing both numbers, with a radius the participant chooses | Saved; and the participant says why that radius (question D) |
| 3.6 | Remove the second branch's area, with a reason | Flagged again: its workers cannot order |
| 3.7 | Set it again | Saved |

## Part 4 · Names and addresses

| # | Task | Passes when |
|---|---|---|
| 4.1 | Change the first chosen branch's English address | Saved; shown on its page |
| 4.2 | Open the same branch's edit form. Meanwhile the observer, on the other computer, moves its area. Then save an address change | **Refused**; told someone changed it, and offered Reload. After Reload, saved |
| 4.3 | Clear the Arabic address and save | Saved with no Arabic address; the English one is untouched |

## Part 5 · Closing a branch

| # | Task | Passes when |
|---|---|---|
| 5.1 | Close the second chosen branch, with a reason | Shown as closed; no edit and no area change is offered |
| 5.2 | Look for it in the list | Not among the open ones; found among the closed |
| 5.3 | Look for a way to delete a facility | **There is none.** A facility is closed, never deleted |
| 5.4 | Reopen it | Open again, with its area as it was |

## Part 6 · History

| # | Task | Passes when |
|---|---|---|
| 6.1 | Read the first chosen branch's history | Every change, with who, when and why, the area's points included |
| 6.2 | Read Test Branch One's history | Its first entry reads "Before the record began", and the participant can say why it names no one |

## Part 7 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 7.1 | Start moving an area, cut the network, then press Save | Told the change may or may not have been saved; the form locks |
| 7.2 | Restore the network and press Retry | Saved once, or told it was already saved; one entry in the history, never two |

## Part 8 · Reading only (second and third participants)

| # | Task | Passes when |
|---|---|---|
| 8.1 | The warehouse manager signs in and opens Branches and facilities | Sees every branch and its area; told they can read but not change |
| 8.2 | The warehouse manager opens a branch | No edit, area or close button is offered |
| 8.3 | The branch worker signs in at their branch | There is no Branches and facilities entry |
| 8.4 | The branch worker types the address of the facilities page into the browser | Told they are not permitted; no branch is shown |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

| | |
|---|---|
| Blocking issues | |
| Where the participant hesitated | |
| Observer | |
