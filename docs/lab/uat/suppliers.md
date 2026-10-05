# UAT — Suppliers

**Run by:** the person who will own the supplier list at head office (today the
administrator), plus the warehouse manager for the read-only part
**Duration:** about seventy-five minutes

Covers `PRC-005`, the supplier half of `INV-005` (what a supplier sells is named down to
the pack) and `SEC-008` (contact details can be erased), on the screens built in module 2
step 3 ([ADR-0026](../../adr/ADR-0026-suppliers.md) and its addenda). This is step 5 of
module 2: the module is switched on only after this pack is signed.

> What is being tested: **can the person who owns the supplier list keep it correct
> without help, and does the system keep a supplier's identity and history intact?** If
> the participant can change a supplier's code once it exists, delete a supplier, see a
> contact detail anywhere in the history, or record the same supplier selling the same
> pack twice at once, the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the
screens before this pack is run. ADR-0026 records the rest of the open questions —
banking, category, contracts, performance — none of which this pack touches.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Who besides the administrator may change suppliers? Purchasing staff, say? | The administrator alone; the managers and the accountant read | |
| B | Should an upload be refused when a supplier changed after its file was exported? | The file wins, as it did in the warehouse: a blank cell clears that field, contacts included | |
| C | Is one preferred supplier per item enough, or does a branch need its own? | One per item, for the whole organisation | |
| D | For a supplier no longer used, should its contact details be erased after a period? | Kept until someone erases them | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, item and supplier in it is synthetic.
- The participant and the warehouse manager each have a test account and a PIN. **Do not
  use their real employee numbers.**
- A spreadsheet of five real suppliers from the warehouse's current list, chosen by the
  participant, ready to save as CSV. **Its header names all ten columns the upload screen
  lists**, even where a column is blank for every supplier: a column left out is refused,
  never read as "clear this".
- Contact details in that spreadsheet are invented, or used with the supplier's
  agreement: the session records what is typed.
- One unplugged network cable or a switched-off Wi-Fi, for Part 7.

---

## Part 1 · Finding suppliers

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in and open Suppliers | Found under Purchasing without help |
| 1.2 | Find a supplier by part of its Arabic name | Found |
| 1.3 | Find a supplier by its code | Found |
| 1.4 | Show retired suppliers | They appear, visibly marked |
| 1.5 | Open a supplier and say its payment terms and VAT number | Read correctly from the page |

## Part 2 · Creating and changing a supplier

| # | Task | Passes when |
|---|---|---|
| 2.1 | Create a supplier with Arabic and English names, a VAT number and 45 days' terms | Created; the page shows what was typed |
| 2.2 | Type the VAT number with Arabic digits (٣١٠…) | Saved as the same number, shown in Western digits |
| 2.3 | Give a VAT number of 14 digits | Told what a VAT number must be **before** anything is saved |
| 2.4 | Create a second supplier with the first one's code | Refused; told the code is already in use |
| 2.5 | Look for a way to change a supplier's code | **There is none.** The participant can say why |
| 2.6 | Change the payment terms, giving a reason | Saved; the history shows who, when and the reason |
| 2.7 | Open the same supplier on two screens; change it on one, then save on the other | The second save is refused; told someone changed it; Reload shows the change |

## Part 3 · Contact details

| # | Task | Passes when |
|---|---|---|
| 3.1 | Add a contact person, phone and email | Saved; **no reason is asked** |
| 3.2 | Read the supplier's history | It says the contact changed, and when — **never the name, phone or email** |
| 3.3 | Erase the contact details | Asked to confirm; then erased; the history says "erased", never what they were |
| 3.4 | Say why the contact form asks no reason | The participant can say that the history keeps reasons for good, and a contact is personal |

## Part 4 · What a supplier sells

| # | Task | Passes when |
|---|---|---|
| 4.1 | Record that the supplier sells an item by the carton, with their own code for it | Shown in "What they sell", with the pack and its size |
| 4.2 | Try to make it the preferred supplier of an item that already has one | **Refused**, and told to make the other one not preferred first |
| 4.3 | Try to record the same carton again for the same supplier | **Not offered** while the first is active |
| 4.4 | Change their own code for the carton | Saved; shown in the history |
| 4.5 | Stop the supply | Shown as stopped; it offers no further change |
| 4.6 | Open the item's page | "Who sells it" lists the supplier, with the stopped supply marked |

## Part 5 · Retiring a supplier

| # | Task | Passes when |
|---|---|---|
| 5.1 | Retire the supplier, giving a reason | Retired; adding something it sells is no longer offered |
| 5.2 | Look for a way to delete a supplier | **There is none** |
| 5.3 | Erase a retired supplier's contact details | Possible: an erasure request does not wait for a reinstatement |
| 5.4 | Reinstate it | Active again; what it sold is still there |

## Part 6 · Bulk upload

| # | Task | Passes when |
|---|---|---|
| 6.1 | Save the prepared spreadsheet as **CSV UTF-8** and upload it | All five saved; the screen says how many were created and updated |
| 6.2 | Upload the same file again | Nothing created twice; reported as unchanged |
| 6.3 | Delete the contact columns from the header and upload | **Refused before anything is sent**, naming the missing columns |
| 6.4 | Break one line (terms of "thirty") and upload | **Nothing is saved**, and the broken line is named |
| 6.5 | Blank one supplier's phone cell and upload | That phone is cleared, and only that one — the participant says whether that is what they expect (question B) |

## Part 7 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 7.1 | Start changing payment terms, cut the network, then press Save | Told the change may or may not have been saved; the form locks |
| 7.2 | Restore the network and press Retry | Saved once, or told it was already saved; never two changes |

## Part 8 · The warehouse manager (second participant)

| # | Task | Passes when |
|---|---|---|
| 8.1 | Sign in and open Suppliers | Sees every supplier; told they can read but not change |
| 8.2 | Look for Create, Upload, Edit, contact changes or Retire | None is offered |
| 8.3 | Type the address of the create screen into the browser | Told they may not; nothing can be saved |
| 8.4 | Open an item and read who sells it | Shown |

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
