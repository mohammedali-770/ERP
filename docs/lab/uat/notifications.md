# UAT — Notifications

**Run by:** the person who looks after stock at the warehouse and the factory (today the
warehouse manager), who is told when stock is taken below zero; with the factory manager
on a second computer making those entries, and short parts for the administrator (Parts 7
and 9) and the accountant (Part 13). All four are staff in those roles, and each signs
below.
**Duration:** about two hours, plus a break of at least 35 minutes in Part 11: about two
and three-quarter hours in all. The accountant is needed only at the end, for Part 13.

This pack covers the notification bell, on the screens built in module 6 step 3
([ADR-0030](../../adr/ADR-0030-notifications.md) and its addenda):
- the bell in the top bar, and its count of what is unread;
- the page listing the person's own notifications;
- marking them read, one at a time or all at once;
- opening one, at the facility it happened at.

The bell has one kind of notification so far: stock taken below zero by a permitted
person who stated a reason. That entry is the stock pack's override (`INV-P02`, its
control of `INV-008`); this pack tests only who is told of it, and what they are told.

It holds the owner's decisions of 2026-10-06:
- the bell inside the console only: no phone push, email, WhatsApp or till message (N1);
- a notification goes to whoever may open what it is about, at the facility where it
  happened, never to the person whose entry raised it, and holds no person's name and no
  reason (proposed `SUP-P01`);
- a notification is kept 90 days, and is changed only by being marked read, once, by its
  own recipient (proposed `SUP-P02`);
- stock taken below zero by an override tells the people who may read that facility's
  stock and items; a count does not (proposed `SUP-P03`).

The pack evidences proposed `SUP-P03`: stock taken below zero by an override tells those
who may read that facility's stock and items, naming each item and the balance the entry
left, and a count tells nobody.

It exercises parts of five others without evidencing them, and signing it does not
deliver them:
- **`SUP-P01`, who is told.** The session shows who is told and who is not: only those
  who may open the entry, at the facility where it happened, never the person who made
  it, and nothing on the bell naming anyone or giving a reason (Parts 3, 5, 7, 9 and 13).
  It does not show three of its clauses. What a notification stores: the bell reads item
  codes and names when it is opened, but what the row holds is proved by the database's
  own tests. That a notification stops being shown once its reader may no longer open
  what it is about: no screen yet takes away a person's access, so the database's own
  tests hold it. That who is told is decided when the entry is made: nobody's access
  changes in the session.
- **`SUP-P02`, kept 90 days.** A notification is marked read once, by its own recipient,
  and by nobody else (4.2, Part 7). Nothing in a session is 90 days old, so neither the
  deletion nor the hiding of anything older is seen. The database's own tests hold both,
  and when the deletion runs is question F.
- **`SUP-005`, alerts.** Each entry tells each person once. There is no severity,
  ownership, escalation, or deduplication beyond that (question E): this module provides
  what they will be built on.
- **`SUP-006`, channels.** Only the console's own bell exists. Phone push, email,
  WhatsApp and till messages each arrive as their own approved step (N1).
- **`SUP-007`, what reaches whom.** It is tested here for one kind, on one channel. Each
  later kind and channel has to show it again.

This is step 5 of module 6: the module is switched on only after this pack is signed.

> What is being tested: **can the warehouse manager learn from the bell, without help,
> that stock was taken below zero at a facility they look after, read what happened,
> open it and keep track of what they have read; and does the bell tell only the people
> who may open that entry, and nothing about who made the entry or why?** If anyone in the
> session:
> - is told of an entry they made themselves;
> - is told of an entry they could not open: the accountant of any, the factory manager
>   of one at the central warehouse;
> - finds a person's name, or a reason for going below zero, on the bell;
> - marks anyone's notification but their own, or marks their own unread again;
> - is told of a count, or of an entry that needed no reason for going below zero;
> - stays signed in past 30 minutes untouched, with nothing shown over the console in that
>   time (Part 11, or the team's own run of it);
>
> the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the system
before it is switched on. These are ADR-0030's seven questions for the owner, one of them
(A) already answered by the screens and asked here only for whether that is soon enough,
which staff will all meet or ask about; two of ADR-0029's, which decide who rings the bell
and what those told can read; and one neither decides: where the bell is switched on.

| # | Question | Today | Answer |
|---|---|---|---|
| A | How soon must a notification appear? | When the person next moves to another screen or another facility, marks one read, clicks the bell, or comes back to the console's tab. Never by itself: a bell that asked on its own every minute would keep a console left open on a desk signed in for good, past the 30 minutes untouched that sign it out. The one exception: if the computer shows the console's window again by itself, for instance when another program's window closes over it, the bell asks once (ADR-0030's accepted residual). No sound, no pop-up, nothing on a phone | |
| B | Which facility's notifications does the bell show? | Those of every facility the person may open, in one list, each with its facility's code, whichever facility they are working at. Opening one from elsewhere first switches "Where you are working" to its facility, and the person stays there | |
| C | A count can leave stock below zero: one entered late, before entries that took out more than it found. Should that tell anyone? | Nobody is told (Part 6) | |
| D | Low stock is the warehouse's most frequent alert. It needs a minimum per item and facility, planned for module 7. When it comes, should the person whose movement took stock low be told too, as the warehouse told the manager whose count caused it? | There is no low-stock alert yet. For stock below zero, the person who made the entry is never told: that is the owner's decision of 2026-10-06 (proposed `SUP-P01`), tested in Parts 5 and 9 | |
| E | Is stock taken below zero a warning, or something a general manager must see? `SUP-005` asks for severity, ownership and escalation | Every notification looks alike. Only those who may read that facility's stock and items are told, never the person who made the entry. In the test data: at the factory, the warehouse manager and whichever of the administrator and the factory manager did not make it; at the central warehouse, the warehouse manager alone, since only the administrator may take stock below zero there. A general manager who may read that facility's stock and items would be told today, like anyone else; the test data has the role but nobody in it. A real database tells only other administrators (question J) | |
| F | Notifications are kept 90 days. When does the deletion run? | Nothing older than 90 days is shown or counted, but it stays stored until the deletion is scheduled in the hosted system. The entry it was about is kept for good | |
| G | Should anything ever mark someone else's notification read? The warehouse system did, for a cancelled return | Never: each person's marks are their own (Part 7) | |
| H | Who may take stock below zero, and so ring the bell? (ADR-0029's question 2; the stock pack's question A) | In the test data, which is a fixture and not this answer: the administrator, and the factory manager at the factory; the warehouse manager may not. A real database has one role, the administrator, who may at any warehouse or factory | |
| I | The reason for going below zero is free text, kept for good, and everyone told can read it on the entry. Should each kind have a list of reasons? (ADR-0029's question 9; the stock pack's question F) | Free text. No screen asks anyone not to name a person; in this session the team asks the factory manager and the administrator before starting | |
| J | Where, and for which roles, is the bell switched on? | The test data opens it everywhere, for every role. A real database shows no bell until it is switched on, and then only to the administrator, the one role it has (0021). It rings only where stock and items are both switched on. Stock's switch-on is drafted, and held, for the central warehouse alone, where only the administrator may take stock below zero, so as drafted only other administrators would be told | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, facility, item and quantity in it is synthetic. **It is rebuilt just
  before the session** (`npm run db:reset`), so every bell starts empty: the test data
  holds no notification, and a database used for an earlier run, the stock pack's
  Part 5 among them, would already have rung some.
- The participant uses the test data's warehouse manager (1004), organisation-wide, who
  reads stock at the warehouse and the factory but may not take it below zero. The
  factory manager is the test data's (1008), whose role holds at the factory alone. A
  factory manager made organisation-wide would be told of the warehouse's entries, and
  9.6 would test nothing. The administrator (1000) and the accountant (1007) are the test
  data's too; the accountant is organisation-wide and reads no stock. After the rebuild,
  the team issues each of the four a PIN: the test data holds none for them, and a
  rebuild removes any issued before it. **Do not use anyone's real employee number.**
- The bell is open everywhere in the test data, for every role. A real database ships it
  hidden (question J).
- The test database and its functions run on a machine other than the participant's (the
  second computer will do). Both consoles reach them over the network, not at 127.0.0.1,
  so that cutting the participant's network in Part 10 cuts them off: the team sets
  `VITE_ERP_FUNCTIONS_URL` to the second computer's address. The functions refuse every
  request, sign-in included, from a page opened at an address they do not list, so the
  team lists in their `ERP_ALLOWED_ORIGINS` the exact address each console's page is
  opened at: `http://localhost:5173` where a computer runs the console itself, or the
  second computer's address and port if the participant opens the console from there. A console opened from another computer is served as a built page
  (`npm run build`, then `npm run preview -- --host`, in `apps/console`, with
  `VITE_ERP_FUNCTIONS_URL` set for the build), never by the development server. When the network
  returns, the development server's page reloads itself, and loses the change in doubt and its Retry.
- The console starts in Arabic in a browser that has never been switched, and each person
  works in their own language. The language button (العربية / English) sits at the corner
  of the sign-in card before sign-in, and in the top bar after it; the browser remembers
  the last choice through every sign-out. Before the participant arrives, the team signs
  in once and out again on each computer, to check that the functions answer, and leaves
  the participant's console in the participant's own language. Whoever sits down at the
  second computer checks its language first, since it keeps the last person's. This
  version quotes the English labels; the Arabic version of this pack quotes the Arabic
  ones. Part 12 switches the participant's console to the other language, and back.
- A second computer, placed where the observer can see both screens and the participant
  cannot see the second. The factory manager, the administrator and the accountant are
  staff in those roles, not the team; each is given these pages to follow and signs below.
  The factory manager is needed throughout, the administrator for Parts 7 and 9, and the
  accountant only for Part 13. They take turns at the second computer, each signing out
  before the next signs in. Where the participant acts once an entry is saved, the
  observer tells them when.
- After each save on the second computer, the console opens the saved entry. Before
  anything else, the observer writes down the time in its heading, for 3.3, as hh:mm on
  the 24-hour clock in Western digits: the two consoles may show the same minute in
  different digits and clocks when they run in different languages. The entry
  shows what it took out, not what is left, so whoever saved it then opens Current stock,
  and the observer writes down the item's balance there. Nothing is read aloud: the
  participant learns of an entry only from the bell.
- Every entry asks for "Reason for this change", which is always filled in. Where a task
  says "with a reason for going below zero", the second field, "Reason for going below
  zero", is filled in as well.
- Quantities below are written kg, pieces and boxes; the screens name each unit in full,
  in the console's language: Kilogram, Piece and Box in English.
- One unplugged network cable or a switched-off Wi-Fi, for Part 10, worked by the
  observer.
- The session starts after 09:00, so the count stated at 08:00 in Part 6 is earlier the
  same day, before every entry made in the session.
- Part 11 is a break of at least 35 minutes with the console left open. The 30 minutes
  are fixed in the database and cannot be shortened for a session without changing it.
  - Before Part 11, the team closes every other program on the participant's computer and
    turns off its pop-up notifications. A window opening or closing over the console makes
    the bell ask once by itself, which keeps the console signed in (ADR-0030's accepted
    residual).
  - During the break, the observer notes any window that opens or closes on that screen.
    If one does, the break runs on for 35 minutes from that moment. If the participant is
    still signed in at 11.3 and something did appear, Part 11 is run again, not failed.
  - If the session cannot hold the break, the team checks 11.1 and 11.3 in its own lab
    run instead, and the observer marks them there as checked by the team, not passed by
    the participant. The factory manager still records 11.2's entry at that point, and the
    participant signs out with Sign out and signs in again for 11.4, so that Parts 12 and
    13 start as written.
- The start state the parts rely on, as the test data builds it:
  - at the factory, chicken strips 172 pieces (a tray is 40); chicken breast -10 kg (a
    carton is 10 kg), which the test data starts below zero by an entry that told
    nobody; no disposable gloves;
  - at the central warehouse, basmati rice 100 kg (a bag is 5 kg).

  Every balance below follows from these and from the entries the parts script, which the
  factory manager and the administrator record exactly as written.
- **The factory manager and the administrator are asked, before starting, not to name any
  person in a reason for going below zero** (question I).

---

## Part 1 · Finding the bell

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in, and find where the console would tell you of something | The bell, in the top bar beside the participant's name, found without help; it is not in the menu. It shows no number |
| 1.2 | Open it | "Notifications", with "No notifications." |
| 1.3 | Say, from the page, whose notifications these are and how long they are kept | Their own, from every facility they may open, kept for 90 days. Note whether that is enough |

## Part 2 · Told on your next click

| # | Task | Passes when |
|---|---|---|
| 2.1 | The participant opens any screen from the menu and stays on it. On the second computer, the factory manager records a waste of 1 tray of chicken strips, typing a reason under "Reason for going below zero" anyway. Once it is saved, the participant opens another screen | Saved: the strips stand at 132 pieces, and the entry shows no reason for going below zero, since none was needed. The participant's bell still shows no number |
| 2.2 | The factory manager records a waste of 4 trays of chicken strips (160 pieces, where 132 are held), without a reason for going below zero | **Refused**; told they may allow it by stating why |
| 2.3 | The factory manager states why under "Reason for going below zero", and saves | Saved: the strips stand at -28 pieces |
| 2.4 | The participant watches the bell for a minute, touching nothing | **Nothing changes**: no number, no sound, no message. The bell asks only when the participant does something; one that asked by itself would keep a console left open signed in for good. Note whether the participant expected it at once |
| 2.5 | The participant opens another screen from the menu | The bell shows 1 |
| 2.6 | The participant opens a new browser tab and stays there. The factory manager records a waste of 1 carton of chicken breast, with a reason for going below zero: the breast is already below zero, so any write-off of it needs one. Once it is saved, the participant goes back to the console's tab, touching nothing else | Saved: the breast stands at -20 kg. Back on the console's tab, the bell shows 2 without a click |
| 2.7 | The participant says when the bell changes | When they move to another screen or come back to the console, not by itself. Note whether that is soon enough for their work (question A) |

## Part 3 · Reading what it says

| # | Task | Passes when |
|---|---|---|
| 3.1 | Open the bell | Two, newest first: the chicken breast above the chicken strips. Each reads "Stock went below zero at" and the factory's code, and is marked unread |
| 3.2 | Say where each happened | At the factory, matched by its code in "Where you are working": the bell shows the code, not the name. Note whether that is enough |
| 3.3 | Say when each happened | The time in the heading of each saved entry on the second computer, in Riyadh time, as the observer wrote it down, once what the participant reads is converted to the same digits and clock |
| 3.4 | Say which item, and how much is left | Chicken breast at -20 Kilogram; chicken strips at -28 Piece: each in red, in the item's base unit |
| 3.5 | Look on the bell for who did it, and why | **There is none**: neither a name nor a reason is on the bell. The reason is on the entry itself, and who made it, as a short code (Part 8) |

## Part 4 · Marking read

| # | Task | Passes when |
|---|---|---|
| 4.1 | Mark the chicken strips' notification read | It is no longer marked unread; the bell shows 1 |
| 4.2 | Look for a way to mark it unread again | **There is none.** A notification is marked read once |
| 4.3 | The factory manager records one waste with two lines: 1 carton of chicken breast and 1 tray of chicken strips, with a reason for going below zero | Saved, as one entry: the breast stands at -30 kg, the strips at -68 pieces. The participant's page does not change by itself |
| 4.4 | The participant clicks the bell | The list is read again: three, newest first. The newest is one notification naming both items, the breast at -30 kg and the strips at -68 pieces. The bell shows 2 |
| 4.5 | The factory manager records a waste of 1 carton of chicken breast, with a reason for going below zero. Once it is saved, and not before, the participant, without clicking the bell, presses Mark all read | Saved: the breast stands at -40 kg. Nothing is asked; the two unread on the page are marked read, and Mark all read goes. The bell shows 1: the entry saved after the page was read, which the participant has not seen yet. Note whether the participant expected 0 |
| 4.6 | Click the bell | The newest, the chicken breast at -40 kg, is at the top, marked unread |

## Part 5 · The person who made the entry is not told

| # | Task | Passes when |
|---|---|---|
| 5.1 | On the second computer, the factory manager opens another screen, then their bell | No number, and "No notifications.", although they have taken stock below zero by an override four times today |

## Part 6 · A count is not told

| # | Task | Passes when |
|---|---|---|
| 6.1 | The factory manager records a count of the chicken strips made at 08:00 this morning and not entered at the time: 4 trays found | Saved at 08:00. The only reason it asks for is "Reason for this change", as every entry does: a count has no "Reason for going below zero", though this one leaves the strips below zero. Measured against the book at 08:00, 172 pieces, it took off 12, and the entries made since still count: Current stock shows the strips at -80 pieces |
| 6.2 | The participant opens another screen | The bell still shows 1: a count tells nobody, even one that leaves stock below zero (question C) |
| 6.3 | The participant opens the bell, and reads the strips' balance on each notification naming them | Still -28 and -68: each shows what its own entry left, not the balance now. Note whether the participant read them as today's |

## Part 7 · Your marks are your own (administrator)

| # | Task | Passes when |
|---|---|---|
| 7.1 | The factory manager signs out of the second computer, and the administrator signs in | The administrator's bell shows 4: the factory manager's four entries, all unread, though the participant has read three of them |
| 7.2 | The administrator opens their bell and presses Mark all read | Their bell shows no number |
| 7.3 | The participant opens another screen | The participant's bell still shows 1: another person's marks do not touch theirs (question G) |

## Part 8 · Opening one

| # | Task | Passes when |
|---|---|---|
| 8.1 | The participant chooses the central warehouse under "Where you are working", and opens the bell | The factory's notifications are still listed (question B). Each offers "Work at", the factory's code, "and open", not Open |
| 8.2 | Open Current stock, then Record a movement; add a line for 1 bag of basmati rice without saving, and click the bell | Asked whether to leave and lose the lines; choosing to stay keeps the line |
| 8.3 | Click the bell again, and choose to leave | The bell's page; the line was not saved |
| 8.4 | On the chicken breast at -40 kg, press "Work at … and open" | "Where you are working" now shows the factory, and the waste opens: the factory manager's reason for going below zero, and who made it, shown as a short code rather than a name. The bell shows no number. In the test data every person's short code reads the same eight characters, so it cannot tell the factory manager from the administrator (9.5 shows the same code). Note whether the participant needed to know who |
| 8.5 | Say where you are working now | At the factory, until the participant chooses otherwise. Note whether they noticed the switch |
| 8.6 | Press the Back link at the top of the page, not the browser's back arrow | Current stock at the factory: the chicken breast at -40 kg and the chicken strips at -80 pieces, both marked below zero. Note whether the participant reached for the browser's arrow, or expected Back to return to the bell |

## Part 9 · Who else is told (administrator, factory manager)

| # | Task | Passes when |
|---|---|---|
| 9.1 | On the second computer, the administrator chooses the factory, and records a waste of 1 box of disposable gloves, which the factory does not hold, with a reason for going below zero | Saved: the gloves stand at -1 box |
| 9.2 | The administrator chooses the central warehouse, and records a waste of 21 bags of basmati rice (105 kg, where 100 are held): first without a reason for going below zero, then with one | **Refused** at first, and told they may allow it by stating why; then saved: the rice stands at -5 kg |
| 9.3 | The administrator opens another screen | The administrator's bell shows no number: neither of their own entries told them |
| 9.4 | The participant, still at the factory, opens another screen, then the bell | The bell showed 2. Newest first: the rice, at the central warehouse's code, offering "Work at", the warehouse's code, "and open"; then the gloves, at the factory's code, at -1 box, offering Open |
| 9.5 | Open the gloves' notification | The waste opens at once; "Where you are working" stays the factory. The bell shows 1 |
| 9.6 | The administrator signs out; the factory manager signs in on the second computer and opens their bell | It shows 1: the administrator's gloves at the factory. Not the rice: the factory manager cannot open the warehouse's stock, so is not told of it |

## Part 10 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 10.1 | The participant clicks the bell. The observer then cuts the participant's network, and the participant presses Mark read on the rice | Told the server could not be reached; the rice stays marked unread |
| 10.2 | The observer restores the network, and the participant presses Mark read again | Marked, with no error; the bell shows no number |

## Part 11 · A break, with the console open

| # | Task | Passes when |
|---|---|---|
| 11.1 | The participant leaves the console open on the bell's page, and takes a break of at least 35 minutes, touching nothing on their computer | Nothing on the participant's screen changes while they are away |
| 11.2 | Early in the break, within its first ten minutes, so that the factory manager is not signed out for inactivity themselves, the factory manager records a waste of 1 carton of chicken breast, with a reason for going below zero | Saved: the breast stands at -50 kg |
| 11.3 | Back from the break, the participant opens another screen | Signed out at once, back at the sign-in page, and told either "You were signed out after 30 minutes without activity." or "Your session has ended. Sign in again." Both pass: opening a screen sends more than one request at once, and only one of them is told why. The observer writes down which was shown. If the screen had locked, this can happen as soon as the console shows again, before any click. The bell did not keep the console signed in |
| 11.4 | Sign in again, and open the bell | The bell showed 1. Its page lists the chicken breast at -50 kg first, unread, kept while they were away. "Where you are working" is the whole organisation again |

## Part 12 · The other language

| # | Task | Passes when |
|---|---|---|
| 12.1 | On the bell's page, switch the console to the other language | Every label changes, and the page mirrors: in Arabic it reads right to left and the bell sits toward the left of the top bar, in English the reverse. The newest still reads that stock went below zero at the factory's code, is marked unread, and shows the breast at -50 in red, shown as -50, not 50-, in either direction |
| 12.2 | Switch back | Every label is back in the participant's own language, and the page reads in its own direction again; nothing on it has changed |
| 12.3 | On the newest, the chicken breast at -50, say what the button naming the factory's code will do, then press it | "Where you are working" switches to the factory, and the waste opens. Working for the whole organisation, every factory notification carries the same button. Note whether the button's words say that the place of work changes: "Work at … and open" in English, «الانتقال إلى … وفتحه» ("go to … and open it") in Arabic |

## Part 13 · Never told (accountant)

| # | Task | Passes when |
|---|---|---|
| 13.1 | The factory manager signs out of the second computer, if not already signed out for inactivity; the accountant signs in | The bell is in the top bar, with no number, although stock was taken below zero by an override seven times today |
| 13.2 | The accountant opens the bell | "No notifications.": the accountant reads no stock, so is never told of it |

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
| Where the participant hesitated | |
| Arabic wording that read wrong | |
| Observer | |
