# UAT — Purchase orders

**Run by:** the person who orders and receives stock at the warehouse (today the
warehouse manager), who raises orders, receives the goods and reverses a receipt made in
error. With them, on a second computer: the accountant approving and rejecting (Parts 5
and 10), the administrator setting the approval limit (Part 10), and the factory manager
and a cashier for a few minutes each (Part 12). All are staff in those roles, and each
signs below.
**Duration:** about two hours.

This pack covers purchase orders, on the screens built in module 8 step 3
([ADR-0032](../../adr/ADR-0032-purchase-orders.md) and its addenda):
- the **Purchase orders** entry: the orders at the warehouse or factory being worked at,
  a new order, and an order's page with its lines, receipts and history;
- receiving goods against an order, and reversing a receipt from its order;
- the **Approval limit** entry: the limit in force at a facility, set and cleared.

It holds the owner's decisions of 2026-10-07:
- one order goes to one warehouse or factory, from one supplier, for packs that supplier
  sells (P1);
- a price is a commitment, per pack, in riyals and halalas, with one VAT rate for the
  order; nothing here is an invoice or a payment (P2);
- an order whose total **before VAT** is within the facility's limit is approved when it
  is raised, unless whoever raised it also set the limit; any other waits for someone who
  may approve, and **nobody approves or rejects an order they raised** (P3);
- a receipt is reversed whole, once, from its order, as a stock movement is, and the
  order's lines open again (P4).

The pack evidences three proposed requirements:
- **`PRC-P01`, an order.** Raised for one warehouse or factory, from one supplier, for
  packs it sells, priced per pack in halalas with one VAT rate, numbered by its facility
  and day, recorded with who, when and why, and never changed once raised: it is
  cancelled, rejected or closed by a further decision.
- **`PRC-P02`, approval.** An order within the limit in force is approved when raised,
  recorded as approved by that limit; any other waits for someone permitted to approve
  there, other than its raiser; a limit is set or cleared only by someone permitted to,
  with who, when and why.
- **`INV-P04`, receipts.** Goods received against an approved order move into stock, line
  by line in the packs ordered, never more than is still to come; a receipt made in error
  is reversed whole, once, with a reason, taking the stock back out and reopening the
  lines; an order with goods received is not cancelled, and may be closed short.

Three of their clauses are not shown here, and the database's tests hold them (pgTAP 180
and `db:check`):
- **a reversal is refused once a count has covered the receipt's items.** No count is
  recorded in this session; the stock pack shows the same rule for a movement.
- **two orders raised at once are numbered one after the other**, a race `db:check`
  holds with two real sessions.
- **two receipts racing for the last of a line never take it past what was ordered**,
  likewise.

A limit set by the person who raises an order does not approve it: Part 10 shows that.

It exercises parts of four others without evidencing them, and signing it does not
deliver them:
- **`PRC-001`, purchasing and receiving.** No invoices, payments or supplier returns.
- **`PRC-002`, approval rules.** One limit per facility, by amount alone.
- **`PRC-004`, segregation of duties.** Only for approving: the same person may raise and
  receive.
- **`PRC-006`, partial deliveries.** A partial receipt and closing short exist; rejected
  quantities and their reasons are not recorded (question F).

Nobody is told by the bell of an order waiting, a decision or a receipt (question H). A
receipt puts stock in, so it never rings the low-stock bell; its reversal can, where it
takes stock to a minimum. No reversal in this session does.

This is step 5 of module 8: the module is switched on only after this pack is signed.

> What is being tested: **can the warehouse manager raise an order without help, see
> before sending what it will cost, receive what arrives against it in the packs they
> think in, and put right a receipt made in error, while nobody approves their own
> order?** If anyone in the session:
> - is offered Approve or Reject on an order they raised, or sees an order approved by
>   the person who raised it;
> - sees a total before sending that differs from the order's once raised;
> - receives more than is still to come on a line, or receives against an order not yet
>   approved;
> - sees stock that does not rise by what was received, or fall back by what was
>   reversed;
> - cancels an order with goods received against it;
> - sees an order at a facility they cannot work at, or of another facility than the one
>   chosen;
> - sees a receipt recorded twice after pressing Retry once;
>
> the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. Questions A to J are ADR-0032's ten for the owner; K to M are
ones the session's staff will meet.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Who raises, approves and receives orders, and who sets limits, in a real database? Should orders split to stay under a limit be caught? | In the test data, which is a fixture and not this answer: the warehouse manager raises and receives anywhere, the factory manager at the factory alone; the accountant approves and reads limits; the administrator does everything. A real database has one role, the administrator, who cannot approve their own orders by hand or by a limit they set: it needs a second person. Splits are not caught | |
| B | Should a pending order be editable, or is cancelling and raising again enough? | Never edited: cancelled and raised again | |
| C | Is "on hold" needed, beside waiting, approved and rejected? | No such state | |
| D | Is an order's business day the date it is raised at its facility, in its time zone? | Yes, as a stock movement's | |
| E | Is the number right: the facility's code, PO, the day, and a series per facility per day? | Yes: the first order of a day ends 0001 | |
| F | May a receipt exceed what was ordered, by a tolerance? Should rejected quantities be recorded, with a reason? | Never more than is still to come (6.2); nothing rejected is recorded | |
| G | May goods arrive in another pack than the one ordered? | No: a receipt line is in the pack ordered | |
| H | Who is told, and of what: an order waiting, a decision, a receipt? | Nobody, by the bell | |
| I | Where do the daily sheet's cash purchases go? | Not here: module 15, as receipts with no order | |
| J | Should a receipt dated before its order was raised be refused? And one dated before the order was approved? | The first is refused; the second is taken, since goods sometimes arrive on a phoned approval before it is recorded | |
| K | An order received in full stays approved, with nothing to receive or close (8.1). Should it close itself? | It stays approved; nothing more can be done with it | |
| L | A receipt on an order closed short may still be reversed (8.3). The order stays closed, with less received. Should that be refused? | It is allowed | |
| M | Where, and for which roles, are purchase orders switched on? | The test data opens them everywhere. A real database shows no Purchase orders or Approval limit until they are switched on, and then only to the administrator. They need suppliers, items and stock switched on where they are | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, facility, supplier, item, price and quantity in it is synthetic. **It is
  rebuilt just before the session** (`npm run db:reset`), so every order and stock figure
  is the test data's.
- The participant uses the test data's warehouse manager (1004), who works for the whole
  organisation and raises and receives orders everywhere. The accountant (1007), the
  administrator (1000), the factory manager (1008) and a cashier (1001) are the test
  data's too. The factory manager's role holds at the factory alone. The cashier signs in
  with the test data's PIN, 100001; after the rebuild, the team issues the other four a
  PIN: the test data holds none for them.
  **Do not use anyone's real employee number.**
- Purchase orders, approval limits, suppliers, items and stock are open everywhere in the
  test data. A real database ships them hidden (question M).
- The console starts in Arabic in a browser that has never been switched, and each person
  works in their own language. The language button (العربية / English) is at the corner of
  the sign-in card, and in the top bar after sign-in; the browser remembers the last
  choice. Whoever sits down at the second computer checks its language first. This version
  quotes the English labels; the Arabic version of this pack quotes the Arabic ones.
  Part 13 switches the participant's console to the other language, and back.
- The test database and its functions run on a machine other than the participant's (the
  second computer will do). Both consoles reach them over the network, not at 127.0.0.1,
  so that cutting the participant's network in Part 11 cuts them off: the team sets
  `VITE_ERP_FUNCTIONS_URL` to that machine's address, and lists in `ERP_ALLOWED_ORIGINS`
  the exact address each console's page is opened at.
- A second computer, placed where the observer can see both screens and the participant
  cannot see the second. Its people take turns, each signing out before the next signs in.
  Where the participant acts once a change is saved, the observer tells them when.
- Where a task says an item stands at a quantity, it is read on Current stock, which gives
  it in the item's storage unit: "150 Kilogram", "1254 Can".
- Who made each change: a history names the person signed in; anyone else is shown by a
  short code, and every person in the test data has the same one (Q-25).
- An order's number is the facility's code, "PO", its business day written as eight
  digits, and its place in that day's series: the first order the participant raises
  today ends in today's date and 0001. The rows below give only the series number.
- Where a change is refused, the console's own sentence is what the participant is judged
  on. Beneath it, for the team, the database's sentence is shown in English, with its
  name in square brackets.
- Every change asks for "Reason for this change", which is always filled in.
- Amounts are shown in riyals with two decimals, "SAR 287.50"; prices are typed in riyals,
  up to two decimals, and a VAT rate as a percentage.
- One unplugged network cable or a switched-off Wi-Fi, for Part 11, worked by the observer.
- The start state the parts rely on, as the test data builds it:
  - **at the central warehouse, five orders**, newest first:
    - 2 October, rice, 120 bags at 45.00, no VAT: **cancelled**, SAR 5,400.00;
    - 1 October (0002), chicken breast, 500 kg at 13.00, 15% VAT: **rejected**,
      SAR 7,475.00;
    - 1 October (0001), medium meal boxes from Gulf Packaging, 15 cartons at 400.00, 15%
      VAT: **approved** by the accountant, SAR 6,900.00, nothing received;
    - 30 September (0002), from Corner Grocer: rice, 20 bags (a bag is 5 kg) at 45.00, and
      cola, 10 cartons (a carton is 24 cans) at 36.00, no VAT: **approved when raised**,
      within the limit, SAR 1,260.00, nothing received;
    - 30 September (0001), chicken breast from Al Waha Poultry, 60 cartons (a carton is
      10 kg) at 125.00, 15% VAT: **waiting for approval**, SAR 8,625.00;
  - **at the factory, one order**: chicken breast, 200 kg at 12.50, 15% VAT, raised by the
    factory manager, waiting for approval, SAR 2,875.00;
  - **the warehouse's approval limit**: SAR 5,000.00 before VAT, set by the administrator.
    The factory has none;
  - **stock at the warehouse**: chicken breast 121.5 kg; basmati rice 100 kg; cola 1014
    cans;
  - **what the suppliers sell**: Al Waha Poultry, chicken breast by the kilogram and by
    the carton of 10; Corner Grocer, rice by the bag of 5 and cola by the carton of 24.

  Every figure below follows from these and from the changes the parts script.

---

## Part 1 · The orders

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in, and find where the console keeps purchase orders | **Purchase orders**, under Purchasing, found without help. Working for the whole organisation, it says stock is held at a warehouse or a factory, and to choose one under "Where you are working". There is no Approval limit entry |
| 1.2 | Choose the central warehouse under "Where you are working", and open Purchase orders | "Purchase orders at", the warehouse's code and name. Five orders, newest first, each with its business day, supplier, status, what has been received ("Nothing yet" on all five) and its total, as in the setup |
| 1.3 | Show only the orders waiting for approval | One: 30 September's chicken, SAR 8,625.00 |
| 1.4 | Show every state again, and open 30 September's rice and cola order | Approved. "Before VAT SAR 1,260.00", "VAT (0%) SAR 0.00", "Total SAR 1,260.00". Two lines: rice, Bag (5 Kilogram), 20 ordered at SAR 45.00, SAR 900.00, 0 received, 20 still to come; cola, Carton (24 Can), 10 at SAR 36.00, SAR 360.00, 0 received, 10 to come. Its history: "Raised · Approved", "Approved when raised: within the facility's limit." |

## Part 2 · An order within the limit

| # | Task | Passes when |
|---|---|---|
| 2.1 | Back on the list, press Raise an order, and search for the supplier SUP-OLD | "No active supplier matches.": the test data's former oil trader has stopped, and a stopped supplier takes no order |
| 2.2 | Find Al Waha Poultry instead, add a line of 2 cartons of chicken breast at 125 riyals a carton, leave VAT at 15, and give a reason | Before anything is sent the line reads SAR 250.00, and the order "Before VAT SAR 250.00", "VAT SAR 37.50", "Total SAR 287.50". Only what the supplier sells is offered |
| 2.3 | Raise it | "Order raised." The order opens, numbered with today's date and 0001, **Approved**: "Approved when raised: within the facility's limit." No Approve or Reject is offered; Receive goods is |

## Part 3 · Caught before sending

| # | Task | Passes when |
|---|---|---|
| 3.1 | Raise another: Corner Grocer, a line of 10 bags of rice at 45, and a second line of 5 bags of rice at 45 | **Refused before sending**: "Line 2 orders the same pack as line 1. Put the quantities on one line." |
| 3.2 | Remove line 2, and type the price as 45.555 | **Refused before sending**: "Line 1: the price is in riyals, with up to two decimals." |
| 3.3 | Put the price back to 45, and the VAT rate to 115 | **Refused before sending**: the VAT rate is a percentage from 0 to 100 |
| 3.4 | Set the VAT rate to 0, give a reason, and raise it | Before sending: SAR 450.00 before VAT, SAR 0.00 VAT, SAR 450.00 in all. Raised: 0002, Approved when raised |

## Part 4 · Over the limit

| # | Task | Passes when |
|---|---|---|
| 4.1 | Raise an order from Al Waha Poultry: 50 cartons of chicken breast at 125, VAT 15 | Before sending: SAR 6,250.00 before VAT, SAR 937.50 VAT, **SAR 7,187.50** in all |
| 4.2 | Raise it | 0003, **Waiting for approval**: 6,250.00 before VAT is over the 5,000.00 limit. No Approve is offered to the participant, and no Receive goods; Cancel order is. Note whether the participant expected the limit to count the VAT |

## Part 5 · Approval (accountant)

| # | Task | Passes when |
|---|---|---|
| 5.1 | On the second computer, the accountant signs in and chooses the central warehouse | Purchase orders and Approval limit, under Purchasing. On Purchase orders, no "Raise an order", and no note that they cannot change orders |
| 5.2 | The accountant opens today's 0003, presses Approve, gives a reason, and approves | Approved. No Cancel order was offered to them |
| 5.3 | The accountant opens 30 September's chicken (SAR 8,625.00), and rejects it with a reason | Rejected. Its history: raised by someone shown as a short code, then rejected under the accountant's own name, with their reason |
| 5.4 | The accountant opens Approval limit | "Limit before VAT: SAR 5,000.00", with its history; no form to change it |
| 5.5 | The participant opens today's 0003 again | Approved, by someone shown as a short code; Receive goods is offered |

## Part 6 · Receiving

| # | Task | Passes when |
|---|---|---|
| 6.1 | The participant opens 30 September's rice and cola order | Receive goods: rice, 20 Bag still to come; cola, 10 Carton |
| 6.2 | Enter 21 bags of rice, and receive | **Refused before sending**: "Line 1: that is more than is still to come." |
| 6.3 | Enter 10 bags of rice and 10 cartons of cola, delivery note DN-2207, received now, and receive | "Received into stock." Received: Part. Rice: 10 received, 10 still to come; cola: 10 received, 0 to come. Receipts: one, DN-2207, "1. 10 Bag · RM-RICE", "2. 10 Carton" with the cola's code. On Current stock: rice **150 Kilogram**, cola **1254 Can** |

## Part 7 · A receipt made in error

| # | Task | Passes when |
|---|---|---|
| 7.1 | On the receipt, press its time | The stock decision: "Receipt", reason "Received against a purchase order"; rice Bag (5), In, 10, 50 in the base unit; cola Carton (24), In, 10, 240. **No Reverse is offered here**: a receipt is reversed from its order |
| 7.2 | Back on the order, press Reverse on the receipt, give a reason, and reverse | The receipt reads "Reversed". Received: Nothing yet; 20 bags and 10 cartons still to come. On Current stock: rice **100 Kilogram**, cola **1014 Can** |
| 7.3 | Look for a way to reverse it again | None: a receipt is reversed once |

## Part 8 · In full, and closed short

| # | Task | Passes when |
|---|---|---|
| 8.1 | Receive 20 bags of rice and 10 cartons of cola, delivery note DN-2208 | Received: **In full**. No Receive goods, no Close short, no Cancel order is offered; the order stays Approved (question K). Rice **200 Kilogram**, cola **1254 Can** |
| 8.2 | Open today's 0003 (50 cartons, approved by the accountant), and receive 20 cartons, delivery note DN-3101 | Received: Part; 30 still to come. Chicken breast **321.5 Kilogram**. Cancel order is no longer offered: goods have arrived |
| 8.3 | The supplier says the rest will not come: close the order short, with a reason | **Closed**, Received: Part. Nothing more can be received. Its receipt still offers Reverse (question L) |

## Part 9 · Cancelled

| # | Task | Passes when |
|---|---|---|
| 9.1 | Open 1 October's meal boxes (SAR 6,900.00, approved, nothing received), and cancel it with a reason | **Cancelled**. Nothing more is offered |

## Part 10 · The limit (administrator, accountant)

| # | Task | Passes when |
|---|---|---|
| 10.1 | The accountant signs out; the administrator signs in on the second computer, chooses the central warehouse, opens Approval limit, and sets it to 10,000, with a reason | "Limit before VAT: SAR 10,000.00"; its history shows two, both under the administrator's own name, the newest first |
| 10.2 | The participant raises 50 cartons of chicken breast at 125 again, VAT 15 | 0004, **Approved when raised**: 6,250.00 is within 10,000.00 |
| 10.3 | The administrator raises an order from Corner Grocer: 4 bags of rice at 45, VAT 0 | 0005, SAR 180.00, **Waiting for approval**, although it is within the limit: the administrator set the limit, so it does not approve their own order. "You raised this order, so someone else approves or rejects it. You can still cancel it." No Approve is offered |
| 10.4 | The administrator signs out; the accountant signs in, chooses the central warehouse, and opens 0005 | Approve and Reject are offered to the accountant. They leave it as it is |
| 10.5 | The accountant signs out; the administrator signs in, chooses the central warehouse, opens Approval limit, and clears it, with a reason | "No limit: every order waits for an approver." Its history shows three |

## Part 11 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 11.1 | The participant opens today's 0004. The observer cuts the participant's network, and the participant receives 5 cartons, delivery note DN-3102 | Told the server did not answer, so the change may or may not have been saved, with Retry and Start over; the form is locked |
| 11.2 | The observer restores the network, and the participant presses Retry | "Received into stock." One receipt, DN-3102; chicken breast **371.5 Kilogram** |

Cut before the receipt is sent, the first attempt never reaches the server, so this part
shows the form locking while the answer is in doubt and Retry sending the receipt, not a
retry of a receipt already saved. That case, where the server records the receipt and
only its answer is lost, cannot be timed by hand: `db:check` holds it with two real
sessions sending one decision, the edge's tests hold that the second is answered as
already recorded, and Start over then says it was saved.

## Part 12 · Elsewhere (factory manager, cashier)

| # | Task | Passes when |
|---|---|---|
| 12.1 | The administrator signs out; the factory manager signs in on the second computer, and opens Purchase orders | Only the factory is offered under "Where you are working". One order, SAR 2,875.00, waiting for approval; none of the warehouse's orders. No Approval limit entry |
| 12.2 | The factory manager opens that order | Raised by the factory manager, under their own name. Cancel order is offered; Approve and Reject are not: the factory manager approves nothing |
| 12.3 | The factory manager signs out; the cashier signs in | No Purchase orders and no Approval limit in the menu |

## Part 13 · The other language

| # | Task | Passes when |
|---|---|---|
| 13.1 | On today's 0003, switch the console to the other language | Every label changes, and the page mirrors. In Arabic: the state «مغلق», «قبل الضريبة» 6,250.00 ر.س, «الإجمالي» 7,187.50 ر.س; every amount and quantity in Western digits, read left to right. Dates and times are in Arabic-Indic digits, as on every Arabic page |
| 13.2 | Switch back | Every label is back in the participant's own language, and nothing on the page has changed |

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
