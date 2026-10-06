# UAT — Stock and movements

**Run by:** the person who keeps the warehouse's stock (today the warehouse manager), plus
the factory manager for Part 5 and a branch worker for Part 10
**Duration:** about an hour and a half

This pack covers stock at a warehouse and a factory, on the screens built in module 5
step 3 ([ADR-0029](../../adr/ADR-0029-stock-ledger.md) and its addenda):
- the balances;
- each item's stock card;
- write-offs and adjustments;
- counts, and reversals.

It holds the owner's decisions of 2026-10-05:
- stock below zero is refused unless a permitted person records it with a reason
  (proposed `INV-P02`);
- there is no second approval;
- a movement belongs to its facility's calendar day, and a late entry states its moment,
  never at or before the item's last count (proposed `INV-P01`);
- stock is held per facility.

The pack evidences the control of negative stock (`INV-008`) and the two proposed
requirements above. It exercises parts of three others without evidencing them, and
signing it does not deliver them:
- **`INV-009`, counts.** Full, partial and late counts and recounts are tested. Blind
  counts are not built (question B), and variances are not approved: the owner decided
  on no second approval (D2), recorded as a departure from `INV-009`.
- **`INV-006`, movements.** Only waste, damage, expiry and adjustment are recorded here.
  Receipts, issues, transfers, returns and production arrive with their own modules.
- **`INV-007`, what a movement records.** Each records its user, moment, quantity, pack
  and facility, but no source document, batch or approval state yet.

This is step 5 of module 5: the module is switched on only after this pack is signed.

> What is being tested: **can the person who keeps the warehouse's stock record what
> happens to it, count it and correct their mistakes, without help, and does the system
> keep every entry for good and every balance true to its entries?** If the participant
> can:
> - edit or delete a movement or a count;
> - take stock below zero without a permitted person's reason;
> - date a movement before a count that already covered it;
> - reverse the same movement twice;
> - see a balance that does not add up to its stock card;
>
> the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. These are ADR-0029's open questions, the ones staff will meet;
the rest wait for the modules that need them.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Who may let stock go below zero, and at which facilities? | The administrator, and the factory manager at the factory. The warehouse manager may not | |
| B | Are counts ever blind, the counter not shown the book first? `INV-009` asks for them; until they are built, this pack does not evidence it | No: whoever counts can read the balance | |
| C | A count that shows a balance below zero after later movements is shown, not refused. Is that right? | Shown | |
| D | Does any movement back to zero or above clear an item from "below zero", or only a count? | Any movement | |
| E | Should the stock left at a closed facility be written off without reopening it? | No: a closed facility takes no entries until reopened | |
| F | Reasons are free text kept for good, so a reason naming a person cannot be erased. Should each kind have a list of reasons instead? | Free text. The participant is asked not to name anyone | |
| G | Should a count that corrects a mistyped count be linked to it? | Not linked: both stand | |
| H | How late may an entry be? A movement may be stated any time after the item's last count | No limit beyond the last count | |
| I | After a lost connection, Start over finds nothing saved and unlocks the form under a new entry. If the first attempt still arrives, it is recorded too, and reversed by hand. Keep that, or keep the old entry until the person leaves the form? | New entry, as on the facility forms | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, facility, item and quantity in it is synthetic.
- The participant, the factory manager and a branch worker each have a test account and
  a PIN. **Do not use their real employee numbers.**
- The participant brings a printed count sheet from the warehouse system, for three or
  four items they know, so the count in Part 4 is done the way they do it today. The
  quantities on it are entered as found in the test warehouse, not copied from the real
  one.
- A second computer, signed in by the observer as the factory manager, for Part 5.
- One unplugged network cable or a switched-off Wi-Fi, for Part 8.
- The session starts after 09:00, so the moments stated in Parts 2 and 4 (06:30, 07:00, 08:00) are earlier the same day.
- **The participant is asked, before starting, not to name any person in a reason**
  (question F).

---

## Part 1 · Finding stock

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in and open Current stock | Found under Inventory without help. Signed in for the whole organisation, the page asks for a warehouse or factory |
| 1.2 | Choose the central warehouse under "Where you are working" | Its balances are shown, each in the item's base unit, with when it was last counted |
| 1.3 | Find the chicken breast by part of its Arabic name | Found |
| 1.4 | Open its stock card and say what happened to it since the opening count | The participant reads the waste, and says who recorded it and why |

## Part 2 · Writing off

| # | Task | Passes when |
|---|---|---|
| 2.1 | Record a waste of 1.5 kg of chicken breast, now, typing the quantity with Arabic digits | Saved; the entry shows 1.5 out; the balance falls by 1.5 |
| 2.2 | Record a damage of one bottle of sanitiser that happened this morning at 08:00, entered now | Saved, dated 08:00, with today's business day |
| 2.3 | Record one entry for two items that expired together | One entry, two lines; each balance falls |
| 2.4 | Add the same pack of one item on two lines | Told before saving which line repeats which, and to add them together |
| 2.5 | Record a waste of 0 | Told the quantity must be more than nothing |
| 2.6 | Look for a way to edit or delete a saved entry | **There is none.** The participant can say what they would do instead: reverse it, or count |

## Part 3 · Adjustments

| # | Task | Passes when |
|---|---|---|
| 3.1 | Record a carton of cola found behind a rack, as an adjustment in | Saved; the balance rises by 24 cans |
| 3.2 | Record an adjustment line without choosing in or out | Told which line needs a direction |

## Part 4 · Counting

| # | Task | Passes when |
|---|---|---|
| 4.1 | Enter a count of the chicken breast made earlier today at 07:00 that was not entered at the time | Saved at 07:00, with today's business day. What it changed is measured against the book at 07:00, so the waste from 2.1, recorded after it, still counts |
| 4.2 | Record a waste of chicken breast dated 06:30 today, before that count | **Refused**; told nothing can be dated at or before the item's last count |
| 4.3 | Count the items on the printed sheet, chicken breast among them, now, in the packs they are found in: cartons and loose kilograms on separate lines | Saved; the entry shows what was found and what the count changed; each balance is now what was found |
| 4.4 | Count an item that has none left | Saved with 0; its balance is 0 |
| 4.5 | Count the cola in the retired 12-can carton, as stock already held | The retired pack is offered, marked retired, and the count is saved |
| 4.6 | Look for a way to undo a count | **There is none.** A count is corrected by counting again |

## Part 5 · Below zero

| # | Task | Passes when |
|---|---|---|
| 5.1 | Write off more chicken breast than the warehouse holds | **Refused**; told it would go below zero and that the participant may not allow it |
| 5.2 | On the second computer, the factory manager writes off more than the factory holds, without a reason for going below zero | **Refused**; told they may allow it by stating why |
| 5.3 | The factory manager states why, and saves | Saved; the reason is on the entry |
| 5.4 | The factory manager lists only what stands below zero | The item is listed, marked below zero |
| 5.5 | The factory manager counts it | It is no longer below zero |

## Part 6 · Correcting mistakes

| # | Task | Passes when |
|---|---|---|
| 6.1 | Record a waste of one bag of rice by mistake, then reverse it, with a reason | Saved; the waste is marked reversed; the balance is back |
| 6.2 | Try to reverse it again | **Not offered** |
| 6.3 | Reverse the chicken breast waste from 2.1, after the count in 4.3 covered it | **Refused**; told the count already corrected it |
| 6.4 | Read the stock card of the chicken breast | Every entry, newest first, with when it happened, its business day, in, out, what a count found, who and why. Entries are listed in the order they were entered: the late count of 4.1 is listed where it was entered, and shows 07:00 as when it happened |

## Part 7 · Leaving a long entry

| # | Task | Passes when |
|---|---|---|
| 7.1 | Start a count with three lines, then click Items in the menu | Asked whether to leave and lose the lines; choosing to stay keeps all three |
| 7.2 | Choose another facility under "Where you are working" with lines still typed | Asked first |

## Part 8 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 8.1 | Start a write-off, cut the network, then press Save | Told it may or may not have been saved; the form locks |
| 8.2 | Restore the network and press Retry | Saved once, or told it was already saved; one entry on the stock card, never two |

## Part 9 · Where stock is not

| # | Task | Passes when |
|---|---|---|
| 9.1 | Choose a branch under "Where you are working" and open Current stock | Told a branch holds no stock record yet |
| 9.2 | Choose the factory, and look for the warehouse's entries | Only the factory's stock is shown |

## Part 10 · Reading only (branch worker)

| # | Task | Passes when |
|---|---|---|
| 10.1 | The branch worker signs in at their branch and opens Current stock | Told a branch holds no stock record yet; nothing can be recorded |
| 10.2 | The branch worker looks for the warehouse in "Where you are working" | It is not offered |

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
| Arabic wording that read wrong | |
| Observer | |
