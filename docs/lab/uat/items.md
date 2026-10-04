# UAT — Items and units

**Run by:** the person who will own the item master at head office (today the
administrator), plus one branch worker for the read-only part
**Duration:** about ninety minutes

Covers `INV-002` and `INV-005`, on the screens built in module 1 step 3
([ADR-0024](../../adr/ADR-0024-item-master-and-units.md) and its addenda), and the
sign-in they sit behind (`IAM-P02`, `IAM-008`). This is step 5 of module 1: the module
is switched on only after this pack is signed.

> What is being tested: **can the person who owns the item list keep it correct
> without help, and does the system stop them making an item mean two things?** If
> the participant can change what an item is once it exists — its code, kind,
> storage unit or brand — or can give one unit two different sizes on one item, the
> pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the
screens before this pack is run.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Should an upload be refused when an item changed after its file was exported? | The file wins, as it did in the warehouse | |
| B | Who besides the administrator may change items? A factory manager for raw ingredients, say? | The administrator alone | |
| C | Should codes be typed, or generated per kind? Codes are reserved forever, so this is costly to change later | Typed: up to 24 of A–Z, 0–9, `.`, `_`, `-` | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a
  live one. Every person and item in it is synthetic.
- The participant has a test account and a PIN. **Do not use their real
  employee number:** step 1.2 locks an account.
- A spreadsheet of ten real items from the warehouse's current list, chosen by the
  participant, ready to save as CSV. Its header names all eight columns the upload screen
  lists, the two descriptions included, even where every description is blank.
- One unplugged network cable or a switched-off Wi-Fi, for Part 8.

---

## Part 1 · Signing in

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in with employee number and PIN | Reaches the home screen; the language is Arabic, right to left |
| 1.2 | On a second test account, type a wrong PIN five times | Each attempt says how many remain; the fifth locks the account and says until when |
| 1.3 | Type the PIN with Arabic digits (١٢٣…) | Signs in exactly as with 123… |
| 1.4 | Switch to English and back | Every label changes; nothing typed is lost |
| 1.5 | Sign out, then press Back in the browser | Back at the sign-in screen, not inside the console |

## Part 2 · Finding items

| # | Task | Passes when |
|---|---|---|
| 2.1 | Find an item by part of its Arabic name | Found without help |
| 2.2 | Find an item by its code | Found |
| 2.3 | Show only packaging | The list holds packaging and nothing else |
| 2.4 | Show retired items | Retired ones appear, visibly marked |
| 2.5 | Open an item and say what its storage unit is | Read correctly from the page |

## Part 3 · Creating an item

| # | Task | Passes when |
|---|---|---|
| 3.1 | Create a raw ingredient stored in grams, with Arabic and English names | Created; both names appear where expected |
| 3.2 | Give it an English description only | Told to write both descriptions or neither, **before** anything is saved |
| 3.3 | Create a second item with the first one's code | Refused; told the code is already in use |
| 3.4 | Look for a way to change the first item's code, kind or storage unit | **There is none.** The participant can say why |

## Part 4 · Units

| # | Task | Passes when |
|---|---|---|
| 4.1 | Add kilograms to the gram item, leaving the size empty | Added as 1 kg = 1000 g, worked out by the system |
| 4.2 | Add a 25 kg bag | Asked for the size; recorded as 1 bag = 25000 g |
| 4.3 | Try to add a second bag, of 20 kg, while the first is active | **Not possible:** Bag is not offered, and the form says to retire the active one first |
| 4.4 | Retire the 25 kg bag, then add a 20 kg one | Both appear: the old one retired, the new one active |
| 4.5 | Look for a way to retire the storage unit itself | There is none |

## Part 5 · Changing an item

| # | Task | Passes when |
|---|---|---|
| 5.1 | Correct an item's Arabic name, giving a reason | Saved; the history shows who, when and the reason |
| 5.2 | Open the same item on two screens; change it on one, then save on the other | The second save is refused; told someone changed it; Reload shows the change |
| 5.3 | Retire an item, then reinstate it | Both changes appear in the history with their reasons |

## Part 6 · Bulk upload

| # | Task | Passes when |
|---|---|---|
| 6.1 | Save the prepared spreadsheet as **CSV UTF-8** and upload it | All ten saved; the screen says how many were created and updated |
| 6.2 | Upload the same file again | Nothing created twice; reported as unchanged |
| 6.3 | Break one line (an unknown kind) and upload | **Nothing is saved**; the broken line is named |
| 6.4 | Save the spreadsheet as plain CSV, not UTF-8, and upload | Refused, and told how to save it instead |
| 6.5 | Put an inch mark in a name (`12" plate`) and upload | The name is saved as written; no rows are merged or lost |

## Part 7 · A branch worker (second participant)

| # | Task | Passes when |
|---|---|---|
| 7.1 | Sign in and open Items | Sees their branch's items only; told they can read but not change |
| 7.2 | Look for Create, Upload or Edit | None is offered |
| 7.3 | Type the address of the create screen into the browser | Told they may not; nothing can be saved |

## Part 8 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 8.1 | Start adding a unit, cut the network, then press Add | Told the change may or may not have been saved; the form locks |
| 8.2 | Restore the network and press Retry | Saved once, or told it was already saved; never two copies |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |
| | | | | |

| | |
|---|---|
| Blocking issues | |
| Where the participant hesitated | |
| Observer | |
