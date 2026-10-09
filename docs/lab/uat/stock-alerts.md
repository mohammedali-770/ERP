# UAT — Stock alerts

**Run by:** the person who looks after stock at the warehouse (today the warehouse
manager), who sets the minimums and is told when stock falls to one. With them, on a
second computer: the administrator making entries at the warehouse (Parts 5 and 6), the
factory manager at the factory (Part 8), and the accountant and a cashier for a few minutes
each (Part 10). All are staff in those roles, and each signs below.
**Duration:** about an hour and a half.

This pack covers stock alerts, on the screens built in module 7 step 3
([ADR-0031](../../adr/ADR-0031-stock-alerts.md) and its addenda):
- the **Stock alerts** entry, listing what is at or below its minimum at the warehouse or
  factory being worked at;
- an item's minimum page: what is on hand, the minimum as entered, its history, and Set
  minimum and Clear minimum;
- the bell's second kind, "Stock fell to its minimum at", rung when a movement takes stock
  to or below its minimum.

It holds the owner's decisions of 2026-10-07:
- a minimum only, per item, per warehouse or factory: INV-013's maximum, safety stock and
  reorder values come later (A1);
- the bell rings when a movement takes stock from above its minimum to at or below it,
  and rings again only after the stock has gone back above and falls again; every item at
  or below its minimum is always listed (A2);
- the person whose movement took stock low is told too (A3). A movement that takes stock
  below zero still tells everyone but its maker (the notifications pack).

The pack evidences two proposed requirements:
- **`INV-P03`, minimums and the list.** A permitted person sets or clears a minimum for
  an item at a warehouse or factory, entered in a current pack and recorded with who, when
  and why, and every item at or below its minimum there is listed, an item never moved
  there counting as none on hand.
- **`SUP-P04`, the bell.** A movement that takes an item from above its minimum to at or
  below it tells the people who may read that facility's stock alerts, stock and items,
  the person who made it included, naming the item, the balance left and the minimum; it
  tells nobody again until the item has gone back above; setting or raising a minimum
  tells nobody.

Two of their clauses are not shown here, and the database's tests hold them (pgTAP 170):
- **who is told needs stock alerts, not stock and items alone.** Nobody in the test data
  reads a warehouse's or the factory's stock and items without its stock alerts, so
  nobody the session shows going untold is untold for that reason alone.
- **who made each change.** A history names the person signed in; anyone else is shown
  by a short code, and every person in the test data has the same one.

It exercises parts of three others without evidencing them, and signing it does not
deliver them:
- **`INV-013`, minimum, maximum, safety stock and reorder values.** Only the minimum
  exists (A1).
- **`SUP-P01`, who is told.** Its rule for the person who acted now depends on the kind:
  told of stock falling to a minimum (Parts 4 and 8), not of stock taken below zero
  (Part 6). The rest of it is the notifications pack's.
- **`SUP-005`, alerts.** Each crossing tells each person once. There is no severity,
  ownership or escalation.

A count that finds stock at or below its minimum, where it was above it, rings the bell
too (question C). No part of this
session records a count past a minimum: the stock pack's counts are its own, and the
database's own tests hold this.

This is step 5 of module 7: the module is switched on only after this pack is signed.

> What is being tested: **can the warehouse manager see, without help, which items at the
> warehouse are at or below their minimums, set and change those minimums in the packs
> they think in, and learn from the bell when a movement takes an item there, once each
> time?** If anyone in the session:
> - finds an item at or below its minimum missing from the list, or one above it listed
>   as low;
> - is told twice for one fall, without the stock having gone back above in between;
> - is told when a minimum is set or raised, rather than when stock moves;
> - is told of a facility whose stock they cannot read: the accountant or the cashier of
>   anything, the factory manager of the warehouse;
> - sets a minimum anywhere but a warehouse or factory they may work at, or one of none;
> - sees a minimum recorded twice after pressing Retry once;
>
> the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. These are ADR-0031's four questions for the owner, and three that
the session's staff will meet.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Who sets minimums, and who reads them, in a real database? | In the test data, which is a fixture and not this answer: the warehouse manager anywhere, the factory manager at the factory alone, and the administrator; a general manager reads them. A real database has one role, the administrator, who may set and read them at any warehouse or factory. Giving them to others is a permission change, approved on its own | |
| B | Who is told when stock falls to a minimum? | Everyone who may read that facility's stock alerts, stock and items, the person who moved the stock included, and nobody else | |
| C | Should a count that finds stock at or below its minimum, where it was above it, ring the bell? | It does: a count only finds what is there, but it is often how a shortfall is found | |
| D | When one entry takes several items to their minimums, one notification naming them all, or one per item? | One per entry, naming each item, as a below-zero notification does (6.4) | |
| E | In the warehouse system a minimum of 0 meant none, and its form offered 0. Here a minimum is more than nothing, and none is cleared. When real minimums are brought across, should a 0 become no minimum? | Yes, as the team plans it: refused here, cleared instead (2.4) | |
| F | Raising a minimum to or above what is on hand lists the item as low at once, but rings nothing: no stock moved. Should it ring? | It rings nothing (3.5; and 3.2 and 7.2, where there was no minimum before) | |
| G | Where, and for which roles, are stock alerts switched on? | The test data opens them everywhere. A real database shows no Stock alerts until they are switched on, and then only to the administrator. They need stock and items switched on where they are, as the bell does to ring | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, facility, item and quantity in it is synthetic. **It is rebuilt just
  before the session** (`npm run db:reset`), so every bell starts empty and every
  minimum is the test data's.
- The participant uses the test data's warehouse manager (1004), who works for the whole
  organisation and reads and writes stock and its minimums everywhere. The administrator
  (1000), the factory manager (1008), the accountant (1007) and a cashier (1001) are the
  test data's too. The factory manager's role holds at the factory alone. The cashier
  signs in with the test data's PIN, 100001; after the rebuild, the team issues the other
  four a PIN: the test data holds none for them.
  **Do not use anyone's real employee number.**
- Stock alerts, stock and items are open everywhere in the test data. A real database
  ships them hidden (question G).
- The console starts in Arabic in a browser that has never been switched, and each person
  works in their own language. The language button (العربية / English) is at the corner of
  the sign-in card, and in the top bar after sign-in; the browser remembers the last
  choice. Whoever sits down at the second computer checks its language first. This version
  quotes the English labels; the Arabic version of this pack quotes the Arabic ones.
  Part 11 switches the participant's console to the other language, and back.
- The test database and its functions run on a machine other than the participant's (the
  second computer will do). Both consoles reach them over the network, not at 127.0.0.1,
  so that cutting the participant's network in Part 9 cuts them off: the team sets
  `VITE_ERP_FUNCTIONS_URL` to that machine's address, and lists in `ERP_ALLOWED_ORIGINS`
  the exact address each console's page is opened at. Each console is served as a built page
  (`npm run build`, then `npm run preview -- --host`, in `apps/console`, with
  `VITE_ERP_FUNCTIONS_URL` set for the build), never by the development server. When the network
  returns, the development server's page reloads itself, and loses the change in doubt and its Retry.
- A second computer, placed where the observer can see both screens and the participant
  cannot see the second. Its people take turns, each signing out before the next signs in.
  Where the participant acts once an entry is saved, the observer tells them when.
- Where a task says an item stands at a quantity after an entry is saved, it is read on
  Current stock: the page a saved entry opens shows its lines, not the balance.
- Where the page gives a minimum in a pack, it also gives the pack's size in brackets, as
  in 2.1: "(Carton = 10 Kilogram)". The rows below leave the brackets out.
- Where a change is refused, the console's own sentence is what the participant is judged
  on. Beneath it, for the team, the database's sentence is shown in English, with its
  name in square brackets.
- Every change asks for "Reason for this change", which is always filled in. The
  administrator fills in "Reason for going below zero" only where a task says so.
- Quantities below are written kg, l, pieces, boxes and so on; the screens name each unit
  in full, in the console's language: Kilogram, Litre, Piece, Box, Can, Bottle, Bucket,
  Pack, Tray and Carton in English.
- One unplugged network cable or a switched-off Wi-Fi, for Part 9, worked by the observer.
- The start state the parts rely on, as the test data builds it:
  - at the central warehouse: chicken breast 121.5 kg, its minimum 10 cartons (a carton
    is 10 kg), so 100 kg; surface sanitiser 40 l, its minimum 10 bottles (a bottle is
    5 l), so 50 l; basmati rice 100 kg, whose minimum was set and then cleared; medium
    meal boxes 500 pieces (a pack is 50, a carton 200), with no minimum; frying oil
    108 l (a bucket is 18 l), with no minimum; cola 1014 cans (a carton is 24; the
    carton of 12 it once came in is retired), with no minimum; no disposable gloves, and
    none ever moved there;
  - at the factory: chicken breast -10 kg, its minimum 20 kg; chicken strips 172 pieces,
    its minimum 5 trays (a tray is 40), so 200 pieces.

  Every figure below follows from these and from the entries the parts script.

---

## Part 1 · What is low

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in, and find where the console shows what is running low | **Stock alerts**, under Inventory, found without help. Working for the whole organisation, it says stock is held at a warehouse or a factory, and to choose one under "Where you are working" |
| 1.2 | Choose the central warehouse under "Where you are working", and open Stock alerts | "Minimums at", the warehouse's code and name. "Low only" is ticked, and one item is listed: the surface sanitiser, 40 Litre on hand against a minimum of 50 Litre, entered as 10 Bottle, marked Low |
| 1.3 | Untick "Low only" | Two: the chicken breast too, 121.5 Kilogram against 100 Kilogram, entered as 10 Carton, "Above minimum"; by code |
| 1.4 | Say how much more chicken breast can go out before it is low | Just under 21.5 kg: at 100 kg it is at its minimum, which counts as low. Note whether the participant read "at" as low |

## Part 2 · Changing a minimum

| # | Task | Passes when |
|---|---|---|
| 2.1 | Open the chicken breast | "Stock at" the warehouse: 121.5 Kilogram. "Minimum: 100 Kilogram · 10 Carton (Carton = 10 Kilogram)". Its history: one entry, set by someone shown as a short code |
| 2.2 | Raise its minimum to 12 cartons, with a reason | Saved: "Minimum: 120 Kilogram · 12 Carton". The history shows two, newest first, the newest by the participant, with their reason |
| 2.3 | Open any other screen, and look at the bell | **No number.** Setting or raising a minimum tells nobody (question F) |
| 2.4 | Back on the chicken breast, try a minimum of 0 cartons | **Refused before sending**: a minimum is more than nothing, and to have none, clear it. Note whether the participant expected 0 to mean "no minimum", as in the warehouse system (question E) |
| 2.5 | Choose Kilogram, and enter 120 | **Refused**: "That is already the minimum." Nothing is recorded |

## Part 3 · An item with no minimum

| # | Task | Passes when |
|---|---|---|
| 3.1 | From Stock alerts, under "Set a minimum for an item", find the disposable gloves, and open them | "Stock at" the warehouse: 0 Box, "nothing recorded here"; "No minimum here."; no history |
| 3.2 | Set a minimum of 2 boxes, with a reason | Saved. Back on Stock alerts, with "Low only" ticked, the gloves are listed: 0 Box against 2 Box, Low. An item never moved here counts as none on hand |
| 3.3 | Under "Set a minimum for an item", search for "frying" | One frying oil is offered. The test data's retired frying oil, a second item of the same name, is not: a retired item takes no new minimum |
| 3.4 | Open it, and set a minimum of 5 buckets | Saved: "Minimum: 90 Litre · 5 Bucket". On Stock alerts, with "Low only" ticked, it is not listed: 108 Litre is above 90 |
| 3.5 | Open the frying oil again, and raise its minimum to 6 buckets | Saved: "Minimum: 108 Litre · 6 Bucket". On Stock alerts it is listed Low, 108 Litre against 108 Litre: exactly at its minimum. The bell still shows no number: raising a minimum tells nobody (question F) |

## Part 4 · Told when stock falls to a minimum

| # | Task | Passes when |
|---|---|---|
| 4.1 | Open Current stock, then Record a movement, and record a waste of 2 kg of chicken breast, with a reason | Saved: the breast stands at 119.5 kg, below its new minimum of 120 |
| 4.2 | Open another screen | The bell shows 1, although the participant made the entry: the person who takes stock low is told too (A3) |
| 4.3 | Open the bell | "Stock fell to its minimum at" the warehouse's code, unread: chicken breast, 119.5 Kilogram · minimum 120 Kilogram |
| 4.4 | Record a waste of 1 more kg of chicken breast, then open another screen | Saved: the breast stands at 118.5 kg. **The bell still shows 1**: the breast was already low, so this tells nobody (A2). Note whether the participant expected a second |
| 4.5 | On the bell, press Open on the chicken breast | The 2 kg waste opens. The bell shows no number |

## Part 5 · Up, then down again (administrator)

| # | Task | Passes when |
|---|---|---|
| 5.1 | The participant records an adjustment of 1 carton of chicken breast, In, with a reason, then opens another screen | Saved: the breast stands at 128.5 kg, above its minimum again. No number on the bell |
| 5.2 | On the second computer, the administrator chooses the central warehouse and records a waste of 1 carton of chicken breast, with a reason | Saved: the breast stands at 118.5 kg |
| 5.3 | The participant opens another screen, then the bell | The bell showed 1: the breast fell again, at 118.5 Kilogram · minimum 120 Kilogram. Press Mark all read |
| 5.4 | The administrator opens another screen | Their bell shows 2: the participant's fall in Part 4, and their own. Both told of each |

## Part 6 · Below zero, past a minimum (administrator)

| # | Task | Passes when |
|---|---|---|
| 6.1 | The participant opens the medium meal boxes from Stock alerts, under "Set a minimum for an item", and sets a minimum of 2 packs | Saved: "Minimum: 100 Piece · 2 Pack"; "Stock at" the warehouse, 500 Piece |
| 6.2 | The participant opens the cola the same way, and looks at the packs offered; then sets a minimum of 1000 cans | Two packs: "Can = 1 Can" and "Carton = 24 Can". The carton of 12 is not offered: a minimum is entered in a current pack. Saved: "Minimum: 1000 Can"; "Stock at" the warehouse, 1014 Can |
| 6.3 | The administrator records one waste of two lines, 3 cartons of medium meal boxes (600 pieces, where 500 are held) and 1 carton of cola: first without a reason for going below zero, then with one | **Refused** at first; then saved: the boxes stand at -100 pieces, and the cola at 990 cans |
| 6.4 | The participant opens another screen, then the bell | The bell showed 2, for the one entry: "Stock went below zero at" the warehouse, naming the boxes alone, at -100 Piece; and "Stock fell to its minimum at" the warehouse, naming both items by code: the cola, 990 Can · minimum 1000 Can, then the boxes, -100 Piece · minimum 100 Piece. Press Mark all read |
| 6.5 | The administrator opens another screen | Their bell shows 3: told that the cola and the boxes fell to their minimums, not that the boxes went below zero, which they did themselves. Note whether that difference was expected |

## Part 7 · Clearing a minimum

| # | Task | Passes when |
|---|---|---|
| 7.1 | From Stock alerts, open the surface sanitiser, press Clear minimum, give a reason, and confirm | "No minimum here." Back on Stock alerts, the sanitiser is no longer listed, ticked or not |
| 7.2 | Open it again, from "Set a minimum for an item", and set a minimum of 8 bottles | Saved: "Minimum: 40 Litre · 8 Bottle". Its history, newest first: set, cleared, set. On Stock alerts it is Low, 40 against 40; the bell shows no number |

## Part 8 · At the factory (factory manager)

| # | Task | Passes when |
|---|---|---|
| 8.1 | The administrator signs out; the factory manager signs in on the second computer, and opens "Where you are working" | Only the factory is offered: they cannot work at the warehouse |
| 8.2 | The factory manager opens Stock alerts | "Minimums at" the factory: chicken breast -10 Kilogram against 20 Kilogram, and chicken strips 172 Piece against 200 Piece, entered as 5 Tray, both Low |
| 8.3 | The factory manager opens the chicken strips and sets a minimum of 3 trays | Saved: "Minimum: 120 Piece · 3 Tray". On Stock alerts, the strips are no longer low |
| 8.4 | The factory manager records a waste of 2 trays of chicken strips, then opens another screen | Saved: the strips stand at 92 pieces. Their bell shows 1: the strips fell to their minimum, and they are told of their own entry |
| 8.5 | The participant opens another screen, then the bell | The bell showed 1: "Stock fell to its minimum at" the factory's code, chicken strips 92 Piece · minimum 120 Piece, offering "Work at", the factory's code, "and open" |
| 8.6 | The factory manager opens their bell | One notification: the strips. None of the warehouse's |

## Part 9 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 9.1 | The participant, working at the central warehouse, opens the chicken breast. The observer cuts the participant's network, and the participant sets a minimum of 13 cartons, with a reason | Told the server did not answer, so the change may or may not have been saved, with Retry and Start over; the form is locked |
| 9.2 | The observer restores the network, and the participant presses Retry | Saved: "Minimum: 130 Kilogram · 13 Carton". The history shows it once |

Cut before the change is sent, the first attempt never reaches the server, so this part
shows the form locking while the answer is in doubt and Retry sending the change, not a
retry of a change already saved. That case, where the server records the change and only
its answer is lost, cannot be timed by hand: `db:check` holds it with two real sessions
sending one decision, and the edge's tests hold that the second is answered as already
recorded.

## Part 10 · Never told (accountant, cashier)

| # | Task | Passes when |
|---|---|---|
| 10.1 | The factory manager signs out; the accountant signs in on the second computer | No Stock alerts in the menu, and no number on the bell, although stock fell to a minimum in four entries today |
| 10.2 | The accountant signs out; the cashier signs in | No Stock alerts in the menu, and no number on the bell: a cashier's role holds nothing on stock alerts |

## Part 11 · The other language

| # | Task | Passes when |
|---|---|---|
| 11.1 | On Stock alerts at the warehouse, switch the console to the other language | Every label changes, and the page mirrors. In Arabic: «الحدود الدنيا في» and the warehouse's code, each low item marked «منخفض», and every quantity written in Western digits, read left to right |
| 11.2 | Open the bell | The newest reads that stock fell to its minimum at the factory's code, with the strips at 92 and their minimum of 120, in the console's language |
| 11.3 | Switch back | Every label is back in the participant's own language, and nothing on the page has changed |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

| | |
|---|---|
| Blocking issues | |
| Where the participant hesitated | |
| Arabic wording that read wrong | |
| Observer | |
