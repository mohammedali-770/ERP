# UAT — Ordering setup

**Run by:** two people, each at the participant's computer in turn, and each signing below.
- **The administrator** (Parts 1 to 3) says which warehouse or factory supplies branches
  with each item, and when each warehouse and factory stops taking today's orders.
- **The warehouse manager** (Parts 4 to 9 and 13) sets the branches' par levels: the stock
  a branch should have after a delivery.

With them, on a second computer: the administrator again (Parts 7 and 8), the factory
manager (Parts 10 and 11) and a cashier (Part 12). All are staff in those roles.
**Duration:** about ninety minutes.

This pack covers the ordering setup, on the screens built in module 9 step 3
([ADR-0033](../../adr/ADR-0033-ordering-setup.md) and its addenda). They sit under
**Ordering** in the menu:
- **Item sources:** every item, with the warehouse or factory that supplies branches with
  it, and an item's page where its source is set and cleared;
- **Order cut-off times:** every warehouse and factory with its cut-off, and a facility's
  page where its own cut-off is set and cleared;
- **Par levels:** a branch's par levels, and an item's page where its par is set and
  cleared.

It holds the owner's decisions of 2026-10-08:
- each item has one warehouse or factory that supplies every branch with it, of the item's
  brand (O1);
- each supplying warehouse and factory has one cut-off, read at its own time (O2);
- an order placed at or after the cut-off is for the next day, never refused (O3);
- a par is set per branch per item, entered in a pack, kept in the item's base unit, and
  always more than nothing (O4);
- the administrator sets sources and cut-offs. A par is set by the administrator, or by
  the manager of the facility that supplies the item, working there, for any branch. A
  branch's staff read only their own branch's pars and its suppliers' cut-offs (O5).

The pack evidences three proposed requirements:
- **`INV-P05`, an item's source.** Set, changed or cleared by someone permitted to, to a
  warehouse or factory of the item's brand, recorded with who, when and why.
- **`INV-P06`, a cut-off.** Set or cleared by someone permitted to, one per warehouse or
  factory, recorded with who, when and why, and read at the facility's own time.
- **`INV-P07`, a par level.** Set or cleared for an item at a branch, entered in a current
  pack, recorded with who, when and why; set only from the facility that supplies the item
  or organisation-wide; and read by a branch's staff for their own branch alone.

Some of their clauses are not shown here:
- **the day an order is for.** INV-P06's next-day rule dates an order when it is placed, and
  no order is placed in this module: branch orders are module 10. The rule itself,
  `erp.order_day_for()`, is tested at stated moments in pgTAP 190. `erp.order_day()`, which
  dates an order placed now and which module 10 will call, is raced against a cut-off change
  in flight in `db:check`. That an order keeps the day it was dated for when first placed is
  module 10's to build, and nothing evidences it yet: module 10's own pack will.
- **a source of another brand is refused.** The test data has no warehouse or factory of
  its second brand, so the pack shows only that none is offered (2.7). pgTAP 190 refuses a
  request that names one.
- **the races:** a par set while its item's source moves, a par set in a pack being
  retired, and two first settings at once, each held in `db:check` with two real sessions.

It exercises parts of three others without evidencing them, and signing it does not
deliver them:
- **`INV-014`, branch replenishment.** Nothing is ordered and nothing is suggested here: the
  par is what module 10 will suggest from.
- **`IAM-006`, access by branch.** Only for par levels: a cashier reads their own branch's,
  and no other.
- **`MFG-001`, factory production planning.** A cut-off decides which day's production an
  order lands in, once module 10 places orders.

This is step 5 of module 9: the module is switched on only after this pack is signed.

> What is being tested: **can the administrator say, without help, where each item comes
> from and when each warehouse and factory stops taking today's orders; can each manager
> set the par levels of what their facility supplies, in the packs they think in; and does
> each branch see its own and nothing else?** If anyone in the session:
> - sees a par saved at another figure than the one typed, in the pack chosen or in the
>   base unit;
> - working at the warehouse, can set the par of an item the factory supplies, or working at
>   the factory, one the warehouse supplies;
> - other than the administrator, is offered a change to an item's source or a cut-off;
> - sees a cut-off saved at another time than the one typed;
> - at a branch, sees another branch's par levels, or is offered any change;
> - has their change recorded over someone else's without being told;
> - sees a change recorded twice after pressing Retry once;
>
> the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. Questions A to E are ADR-0033's five for the owner; F to J are
ones the session's staff will meet.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Should a cut-off of 00:00 be allowed? | Allowed: every order to that facility is then for the next day, as in the warehouse system. To have none, the cut-off is cleared (3.7) | |
| B | The warehouse system kept a par of 0 apart from "no par": on that branch's New Order it showed "Par 0" and an optional on-hand field. Here 0 is refused (4.5), and no per-branch way to show that field remains. Is that right? | Refused before sending; a par is cleared instead | |
| C | Whose time zone dates an order: the supplying facility's, or the branch's? | The supplying facility's, named on its cut-off page (3.4). Every facility is in Riyadh today, so the two cannot yet differ | |
| D | Can a warehouse ever supply two brands? | No: a source must be of the item's brand | |
| E | Who sets par levels in a real database, and who reads them? | In the test data, which is a fixture and not this answer: the factory manager sets them from the factory alone. The warehouse manager sets them organisation-wide, so any item's (Part 4), or from a warehouse or factory, that facility's items alone (Part 6), and never from a branch. The branch's own staff read them. A real database has one role, the administrator | |
| F | When an item's source moves or is cleared, its par levels stay (Part 8). A moved item's par is then set by the new source's manager (Part 10); a cleared one's can only be cleared, organisation-wide. Should moving or clearing a source clear its pars, or ask first? | They stay | |
| G | A changed cut-off takes effect at once, and an order already placed keeps its day. Should a change be scheduled ahead, from a date, as a transfer price can be? | At once | |
| H | A cut-off is changed only while working at its facility (3.3). Is having to switch there right, or should the administrator change any from the whole organisation? | Switch to the facility | |
| I | O5 says a branch's staff read their suppliers' cut-offs. The console shows them every warehouse's and factory's cut-off of their brand, and every item's source, those that supply them nothing included (ADR-0033 §7). The test data cannot show the difference: its warehouse and its factory both supply the first branch. Should they see only their own suppliers'? | Every one of their brand's | |
| J | Where, and for which roles, are item sources, cut-offs and par levels switched on? | The test data opens them everywhere. A real database shows no Ordering entries until they are switched on, and then only to the administrator. Par levels must be switched on at every branch the pilot covers, as well as at the warehouse and the factory, or no par can be set there (Part 11) | |

## Setup — the team, before the participants arrive

- The console runs against a test database built from the repository, never a live one.
  Every person, facility, item, pack and setting in it is synthetic. **It is rebuilt just
  before the session** (`npm run db:reset`), so every source, cut-off and par is the test
  data's.
- The participants use the test data's administrator (1000) and warehouse manager (1004).
  The warehouse manager works for the whole organisation. The factory manager (1008) and a
  cashier (1001) are the test data's too: the factory manager's role holds at the factory
  alone, and the cashier's at the first branch alone. The cashier signs in with the test
  data's PIN, 100001; after the rebuild, the team issues the other three a PIN: the test
  data holds none for them.
  **Do not use anyone's real employee number.**
- Item sources, cut-offs and par levels are open everywhere in the test data. A real
  database ships them hidden (question J).
- The console starts in Arabic in a browser that has never been switched, and each person
  works in their own language. The language button (العربية / English) is at the corner of
  the sign-in card, and in the top bar after sign-in; the browser remembers the last
  choice. Whoever sits down at either computer checks its language first. This version
  quotes the English labels; the Arabic version of this pack quotes the Arabic ones.
  Part 13 switches the warehouse manager's console to the other language, and back.
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
  Where the participant acts once a change is saved, the observer tells them when.
- In Part 11 the team changes the test database three times, between tasks, as a pilot
  would by migration: par levels first take no changes at the second branch, are then not
  switched on there, and are switched back on before Part 12. The team prepares all three
  statements beforehand, and the observer tells the factory manager when each of the first
  two is done.
- Who made each change: a history names the person signed in; anyone else is shown by a
  short code, and every person in the test data has the same one (Q-25).
- Where a change is refused, the console's own sentence is what the participant is judged
  on. Beneath it, for the team, the database's sentence is shown in English, with its
  name in square brackets.
- Every change asks for "Reason for this change", which is always filled in.
- A par is shown in the item's base unit and, beside it, as it was entered: "20 Kilogram ·
  4 Bag (Bag = 5 Kilogram)". On a branch's list, the pack entered is the second line. A par
  entered in the base unit has no second line.
- One unplugged network cable or a switched-off Wi-Fi, for Part 9, worked by the observer.
- The start state the parts rely on, as the test data builds it:
  - **sources**:
    - the central warehouse (WH-001) supplies the chicken breast, the cola, the medium meal
      boxes, the surface sanitiser and the basmati rice;
    - the central kitchen factory (FA-001) supplies the chicken strips;
    - the disposable gloves were supplied by the warehouse until 2 October, when their source
      was cleared: branches buy them locally;
    - the frying oil, the fryer basket and the fryer gasket have never had one;
  - **cut-offs**: the warehouse at 14:00; the factory at 11:00, which was 10:30 until
    3 October. Both in Asia/Riyadh;
  - **par levels at the first branch (BR-001)**: chicken breast 3 cartons (30 kg), chicken
    strips 2 trays (80 pieces), cola 2 cartons (48 cans);
  - **par levels at the second branch (BR-002)**: chicken breast 20 kg; basmati rice 2 bags
    (10 kg) until 4 October, when it was cleared;
  - **the packs used below**: chicken breast, a carton of 10 kg; rice, a bag of 5 kg;
    chicken strips, a tray of 40 pieces; frying oil, a bucket of 18 litres; cola, a carton
    of 24 cans. The cola's carton of 12 is retired.

  Every figure below follows from these and from the changes the parts script.

---

## Part 1 · Where each item comes from (administrator)

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in, and find where the console keeps where each item comes from | **Ordering**, in the menu, found without help, with three entries: Item sources, Order cut-off times and Par levels |
| 1.2 | Open Item sources | Every item, by code, with what supplies branches with it. WH-001 for the chicken breast, the cola, the medium meal boxes, the sanitiser and the rice; FA-001 for the chicken strips. "No source" for the gloves, the frying oil, the fryer basket and the fryer gasket, and for a retired frying oil. The second brand's meal box is listed too, with no source: working for the whole organisation, every brand's items are. No note says the participant cannot change them |
| 1.3 | Under "Supplied by", choose FA-001, then WH-001, then "Any facility" | FA-001: the chicken strips alone. WH-001: five items. "Any facility": every item again |

## Part 2 · Setting and clearing a source

| # | Task | Passes when |
|---|---|---|
| 2.1 | Open the frying oil (RM-FRYING-OIL) | "Supplied by: No source", and "No source has been set for this item." Set the source offers two: FA-001 (Factory) and WH-001 (Warehouse), the brand's open factory and warehouse, and nothing else. There is no Clear the source |
| 2.2 | The warehouse will buy frying oil in for the branches: set its source to WH-001, with a reason | "Saved." "Supplied by: WH-001 — Central Warehouse (synthetic)". The history shows "Source set" under the administrator's own name, with the reason. WH-001 is no longer offered; Clear the source is |
| 2.3 | Back on the list, open the disposable gloves (OP-GLOVES) | No source. Its history: set to WH-001 on 1 October, then cleared on 2 October, "Synthetic: branches buy gloves locally now." |
| 2.4 | The warehouse stocks gloves again: set their source to WH-001, with a reason | Supplied by WH-001. Three decisions in the history, the newest first |
| 2.5 | Back on the list, open the surface sanitiser (CL-SANITISER), and press Clear the source | Before anything is cleared, it says: "No facility will then supply branches with this item, so it cannot be ordered. Its par levels stay, and can be cleared only organisation-wide until it has a source again." |
| 2.6 | Branches will buy it locally: clear it, with a reason | "Supplied by: No source". Two decisions in the history. Nothing left to clear; Set the source offers both again |
| 2.7 | Back on the list, open the second brand's medium meal box (B2-PKG-MEAL-BOX-M) | "Supplied by: No source", and "No other open warehouse or factory of this item's brand can supply it." No facility is offered: the test data has none of that brand |

## Part 3 · Order cut-off times

| # | Task | Passes when |
|---|---|---|
| 3.1 | Open Order cut-off times | FA-001 at 11:00 and WH-001 at 14:00, each in Asia/Riyadh. "You can see the cut-offs here. A cut-off is changed while working at its facility." |
| 3.2 | Open FA-001 | "This cut-off is changed while working at FA-001." "Cut-off: 11:00". Its history: 11:00, set on 3 October, and 10:30 before it. No form |
| 3.3 | Choose WH-001 under "Where you are working", and open Order cut-off times again | "You can change the cut-off of the facility you are working at: open it from the list." Only WH-001 opens; FA-001 is not a link |
| 3.4 | Open WH-001, type 24:00 and a reason, and press Set the cut-off | The form names the time zone: "at the facility's own time (Asia/Riyadh)". **Refused before sending**: "Enter a time from 00:00 to 23:59, such as 14:00." |
| 3.5 | Type 1330, as a phone's number pad would, and set it | "Saved." "Cut-off: 13:30". The history shows "Cut-off set · 13:30" under the administrator's own name, with the reason typed |
| 3.6 | Type 13:30, and set it again | Refused: "That is already the cut-off." The "Saved." from 3.5 is gone. Nothing more is recorded |
| 3.7 | Press Clear the cut-off | Before anything is cleared, it says: "Every order to this facility will then be for the day it is placed." Once cleared: "Cut-off: No cut-off" |
| 3.8 | Picking starts at two again: set 14:00, with a reason | "Cut-off: 14:00". The history shows four, the newest first: set at 14:00, cleared, set at 13:30, and the test data's 14:00 |

## Part 4 · Par levels at a branch (warehouse manager)

| # | Task | Passes when |
|---|---|---|
| 4.1 | The administrator signs out; the warehouse manager signs in, and opens Item sources, then the chicken breast | Ordering has the same three entries. "You can see the item sources here, but not change them. They are set organisation-wide." The chicken breast's page has no form |
| 4.2 | Open Par levels | "Choose a branch to see and set its par levels." BR-001 and BR-002, and no warehouse or factory |
| 4.3 | Choose BR-001 | Three par levels, each with what supplies it: cola 48 Can (2 Carton), WH-001; chicken breast 30 Kilogram (3 Carton), WH-001; chicken strips 80 Piece (2 Tray), FA-001 |
| 4.4 | Under "Set a par level for an item", search for rice, and open it | "Par level: No par level", "Supplied by: WH-001", and "No par level has been set for this item at this branch." The packs offered: "Bag = 5 Kilogram" and "Kilogram = 1 Kilogram" |
| 4.5 | Choose the bag, type 0 and a reason, and set it | **Refused before sending**: "Enter a par level of up to twelve digits and six decimals, more than nothing." |
| 4.6 | Type 4 instead, and set it | "Saved." "Par level: 20 Kilogram · 4 Bag (Bag = 5 Kilogram)". The history shows it under the participant's own name, with the reason typed |
| 4.7 | Back at BR-001, open the chicken breast, and set 2.5 cartons | "Par level: 25 Kilogram · 2.5 Carton (Carton = 10 Kilogram)". The 3 cartons before it stay in the history |
| 4.8 | Back at BR-001, open the cola | "Par level: 48 Can · 2 Carton (Carton = 24 Can)". The packs offered are the current ones, "Can = 1 Can" and "Carton = 24 Can": the retired carton of 12 is not |
| 4.9 | Press Clear the par level, and clear it with a reason | Before anything is cleared, it says: "The item will have no par level at this branch: nothing is suggested for it when the branch orders." The history shows the clearing under the participant's own name, with the reason. Back at BR-001, the cola is no longer listed: chicken breast 25 Kilogram (2.5 Carton), rice 20 Kilogram (4 Bag), chicken strips 80 Piece (2 Tray) |

## Part 5 · Set again, and an item no facility supplies

| # | Task | Passes when |
|---|---|---|
| 5.1 | Back to the branches, and choose BR-002 | One par level: chicken breast 20 Kilogram, WH-001. No rice |
| 5.2 | Search for rice, and open it | "Par level: No par level". Its history: 10 Kilogram (2 Bag) on 2 October, then cleared on 4 October, "Synthetic: rice is off the menu at this branch." |
| 5.3 | Rice is back on the menu: set 3 bags, with a reason | "Par level: 15 Kilogram · 3 Bag (Bag = 5 Kilogram)". Three decisions in the history |
| 5.4 | Back at BR-002, search for the sanitiser, and open it | "No facility supplies this item: set its source first. A par level it has can still be cleared organisation-wide." "Supplied by: No source". No form |

## Part 6 · From the warehouse

| # | Task | Passes when |
|---|---|---|
| 6.1 | Choose WH-001 under "Where you are working", and open Par levels | "Choose a branch to see and set the par levels of the items WH-001 supplies." |
| 6.2 | Choose BR-001 | "Only the items WH-001 supplies are listed, and set, from here." Chicken breast 25 Kilogram and rice 20 Kilogram. The chicken strips, which the factory supplies, are not listed |
| 6.3 | Search for strips | "No items match." |
| 6.4 | Search for oil, open the frying oil, and set 1 bucket, with a reason | "Supplied by: WH-001", since 2.2. The packs offered: "Bucket = 18 Litre" and "Litre = 1 Litre". Saved: "Par level: 18 Litre · 1 Bucket (Bucket = 18 Litre)" |

## Part 7 · Two people, one par (administrator, on the second computer)

| # | Task | Passes when |
|---|---|---|
| 7.1 | The participant goes back to the branches, chooses BR-002, and opens the chicken breast. On the second computer, the administrator signs in, opens Par levels, chooses BR-002, opens the chicken breast, and sets 25 kilograms | The participant's page says "Par level: 20 Kilogram". The administrator's says "Par level: 25 Kilogram" once saved, and the observer tells the participant |
| 7.2 | The participant, without reloading, sets 30 kilograms, with a reason | "Someone changed this par level after you opened it. It is shown as it is now; make your change again." "Par level: 25 Kilogram". The newest decision in the history is the administrator's, shown by a short code. Nothing of the participant's is recorded |
| 7.3 | The participant sets 30 kilograms again | "Saved." "Par level: 30 Kilogram" |

## Part 8 · A source moves, and one is cleared (administrator, on the second computer)

| # | Task | Passes when |
|---|---|---|
| 8.1 | The factory will portion chicken breast for the branches from now on. On the second computer, the administrator opens Item sources, then the chicken breast, and sets its source to FA-001, with a reason | "Saved." "Supplied by: FA-001 — Central Kitchen Factory (synthetic)". The observer tells the participant |
| 8.2 | The participant, whose page still shows the chicken breast at BR-002 supplied by WH-001, sets 35 kilograms without reloading, with a reason | Refused: "Another facility supplies this item: its par level is set there, or organisation-wide." The page then says "This item is supplied by FA-001: its par level is set there, or organisation-wide." It shows no form, and neither the par nor its history: from WH-001, the item's par is no longer read |
| 8.3 | On the second computer, the administrator opens Par levels, chooses BR-002, and opens the chicken breast | "Par level: 30 Kilogram". The newest decision is the participant's 30, shown by a short code: nothing at 35 was recorded |
| 8.4 | Branches will buy frying oil locally. On the second computer, the administrator opens Item sources, then the frying oil, and clears its source, with a reason. Then they open Par levels, choose BR-001, and open the frying oil | At BR-001 the frying oil is still listed, 18 Litre (1 Bucket), with "No source". Its page: "Par level: 18 Litre · 1 Bucket (Bucket = 18 Litre)", "Supplied by: No source", and "No facility supplies this item: set its source first. A par level it has can still be cleared organisation-wide." Clear the par level is offered; Set the par level is not. The administrator leaves it, and signs out |
| 8.5 | The participant goes back to the branches, chooses BR-001, and searches for chicken | One par level: rice 20 Kilogram (4 Bag). Neither the chicken breast nor the frying oil is listed from WH-001 any more, and the search finds "No items match." Neither par is lost: Part 10 shows the chicken breast's from the factory, and Part 12 the frying oil's at the branch (question F) |

## Part 9 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 9.1 | The participant goes back to the branches, chooses BR-002, and opens the rice (15 Kilogram). The observer cuts the participant's network, and the participant sets 4 bags, with a reason | Told "The server did not answer, so this change may or may not have been saved. Retry sends exactly the same change and cannot record it twice. Start over checks what is saved first.", with Retry and Start over; the form is locked |
| 9.2 | The observer restores the network, and the participant presses Retry | "Saved." "Par level: 20 Kilogram · 4 Bag (Bag = 5 Kilogram)", and one new decision in the history |

Cut before the change is sent, the first attempt never reaches the server, so this part
shows the form locking while the answer is in doubt and Retry sending the change, not a
retry of a change already saved. That case, where the server records the change and only
its answer is lost, cannot be timed by hand: `db:check` holds it with two real sessions
sending one decision, the edge's tests hold that the second is answered as already
recorded, and the browser run of module 9's screens holds that Start over then says it was
saved.

## Part 10 · The factory (factory manager, on the second computer)

| # | Task | Passes when |
|---|---|---|
| 10.1 | The factory manager signs in on the second computer | Only FA-001 is offered under "Where you are working". Ordering has the same three entries |
| 10.2 | Open Par levels, and choose BR-001 | "Choose a branch to see and set the par levels of the items FA-001 supplies." At BR-001: chicken breast 25 Kilogram (2.5 Carton) and chicken strips 80 Piece (2 Tray), both FA-001. No rice, no frying oil |
| 10.3 | Open the chicken breast, and set 3 cartons, with a reason | "Par level: 30 Kilogram · 3 Carton (Carton = 10 Kilogram)". Three decisions: the newest under the factory manager's own name, the two before it by a short code |
| 10.4 | Back to the branches, choose BR-002, and search for rice | "No items match.": the warehouse supplies it |
| 10.5 | Search for strips, open the chicken strips, and set 3 trays, with a reason | "Par level: 120 Piece · 3 Tray (Tray = 40 Piece)" |
| 10.6 | Open Order cut-off times, then FA-001 | "You can see the cut-offs here, but not change them." "Cut-off: 11:00", with its history, and no form. The factory manager is not told to change it while working there |

## Part 11 · A branch the pilot leaves out (the team, factory manager)

| # | Task | Passes when |
|---|---|---|
| 11.1 | The team records that par levels take no changes at BR-002, as a pilot that leaves it out would. The factory manager opens Par levels, chooses BR-002, then opens the chicken strips | "Par levels take no changes at this branch: they can be read, but not set or cleared." Chicken breast 30 Kilogram and chicken strips 120 Piece (3 Tray) are still listed; there is no "Set a par level for an item". The chicken strips' page has no form |
| 11.2 | The team records par levels as not switched on at BR-002. The factory manager presses Back, to BR-002's par levels | "Par levels are not switched on at this branch." Nothing is listed. Nothing says "not permitted" |

Before Part 12, the team switches par levels back on at BR-002.

## Part 12 · A branch's own (cashier)

| # | Task | Passes when |
|---|---|---|
| 12.1 | The factory manager signs out; the cashier signs in | Ordering has the same three entries |
| 12.2 | Open Par levels | BR-001's, at once, with no branch to choose: chicken breast 30 Kilogram (3 Carton), FA-001; frying oil 18 Litre (1 Bucket), "No source"; rice 20 Kilogram (4 Bag), WH-001; chicken strips 80 Piece (2 Tray), FA-001. "You can see the par levels here, but not change them." Nothing leads to another branch |
| 12.3 | Open the chicken breast | Its three decisions, each by a short code. No form |
| 12.4 | Open Order cut-off times, then Item sources | FA-001 at 11:00 and WH-001 at 14:00, "You can see the cut-offs here, but not change them.", and neither opens. "You can see the item sources here, but not change them." |
| 12.5 | The observer types into the cashier's console the address of BR-002's par levels, as a manager might send it: the console's address followed by `#par_levels/01936f00-0000-7000-8000-000000000402` | "A branch's par levels are read at the branch, at a facility that supplies it, or organisation-wide." Nothing is listed |

## Part 13 · The other language (warehouse manager)

| # | Task | Passes when |
|---|---|---|
| 13.1 | The participant opens Par levels, chooses BR-001, opens the rice, and switches the console to the other language. If the console signed them out while they waited, after 30 minutes idle, they sign in again first | Every label changes, and the page mirrors. In Arabic: «المستوى المستهدف: 20 كيلوغرام · 4 كيس (كيس = 5 كيلوغرام)» and «جهة التوريد: WH-001»; every quantity in Western digits, read left to right. The history's date and time are in Arabic-Indic digits, as on every Arabic page |
| 13.2 | Switch back | Every label is back in the participant's own language, and nothing on the page has changed |

---

## Sign-off

| Participant | Role | Passed? | Date | Signature |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |

| | |
|---|---|
| Blocking issues | |
| Where the participants hesitated | |
| Arabic wording that read wrong | |
| Observer | |
