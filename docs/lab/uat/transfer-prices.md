# UAT — Transfer prices

**Run by:** the person who will set transfer prices at head office (today the accountant),
plus the warehouse manager and a branch worker for the read-only parts
**Duration:** about an hour

Covers what a branch is charged for each pack it orders from the warehouse, and the
conversion seam it names (`INV-005`: a price is set on a pack, never on an item in the
abstract), on the screens built in module 3 step 3 ([ADR-0027](../../adr/ADR-0027-transfer-prices.md)
and its addenda). This is step 5 of module 3: the module is switched on only after this
pack is signed.

> What is being tested: **can the person who sets transfer prices keep them right without
> help, and does the system keep what a branch was charged fixed for good?** If the
> participant can change or delete a price, put a price into effect earlier than the
> moment it was set, withdraw a price that is already in effect, or record a price that
> changes nothing, the pack fails outright.

---

## Before the session — answered by the owner

The screens behave as below today. Each answer either confirms that or changes the screens
before this pack is run. These are ADR-0027's open questions.

| # | Question | Today | Answer |
|---|---|---|---|
| A | Does a transfer ever carry VAT, for example if a brand is its own legal entity? (For the accountant and counsel.) | No VAT on any transfer, as in the warehouse | |
| B | Does a branch, or a brand, ever need its own price for the same pack? | One price per pack, for every branch of the item's brand | |
| C | Who besides the administrator and the accountant may set prices? Does a change need a second person to approve it? | The administrator and the accountant; one person decides | |
| D | Is a price of 0 ever right, or should it be refused like a negative one? | 0 is allowed: it is a decision, recorded with a reason | |
| E | When should a price set ahead take effect? | The form offers midnight, Riyadh time, and any other time can be typed | |

## Setup — the team, before the participant arrives

- The console runs against a test database built from the repository, never a live one.
  Every person, item and price in it is synthetic.
- The participant, the warehouse manager and the branch worker each have a test account
  and a PIN. **Do not use their real employee numbers.**
- The participant chooses three real items from the warehouse's current price list
  beforehand, with the packs they are ordered in. The team creates them in the test
  database with the right packs, unpriced. Today's warehouse price for each is written
  on a card for Part 2.
- The seed's cola carton (the 330 ml can's carton of 12), retired with a price on record, serves Part 5.2.
- One unplugged network cable or a switched-off Wi-Fi, for Part 7.

---

## Part 1 · Finding prices

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in and open Transfer prices | Found under Inventory without help |
| 1.2 | Find the chicken carton and say its price now, and the next price set for it | Read correctly from the list, with the date the next one starts |
| 1.3 | Find a pack that has no price | Found; the participant can say an order for it would be refused |
| 1.4 | Find an item by part of its Arabic name | Found |
| 1.5 | Open one of the three chosen items | Its packs are listed, each unpriced |

## Part 2 · A price from now

| # | Task | Passes when |
|---|---|---|
| 2.1 | Price the first chosen item's carton at today's warehouse price, from now, with a reason | Saved; shown as the price in force |
| 2.2 | Price a second pack typing the amount with Arabic digits (١٢٫٥٠) | Saved as 12.50 riyals |
| 2.3 | Type a price with three decimals (12.555) | Told before anything is saved that a price has at most two decimals |
| 2.4 | Set the same price again on the same pack | **Refused**; told that price is already in force |
| 2.5 | Look for a way to change or delete a price | **There is none.** The participant can say why: a branch may already have been charged it |

## Part 3 · A price set ahead

| # | Task | Passes when |
|---|---|---|
| 3.1 | Choose "from a date and time" and set a new price from the 1st of next month | Saved; shown as set ahead, at midnight Riyadh time on that date |
| 3.2 | Choose "from a date and time" and press Set price without a date | **Nothing is saved**, and nothing takes effect now |
| 3.3 | Go back to the list | The new price is shown as the next price, beside the one in force |
| 3.4 | Set a price from a date in the past | **Refused**; told a price is never set earlier than now |
| 3.5 | Set a second price for the same moment as 3.1 | **Refused**; told to withdraw the first or choose another moment |
| 3.6 | Set the price from 3.1 again, from a date between now and 3.1's | **Refused**; told the pack already moves to that price later |

## Part 4 · Taking back a price set ahead

| # | Task | Passes when |
|---|---|---|
| 4.1 | Withdraw the price set in 3.1, giving a reason | Shown as withdrawn; still on record |
| 4.2 | Look for Withdraw on the price in force | **There is none.** The participant can say why |
| 4.3 | Look for a way to bring the withdrawn price back | **There is none**: a withdrawal is final; a new price is set instead |

## Part 5 · Zero and retired packs

| # | Task | Passes when |
|---|---|---|
| 5.1 | Price the third chosen item's single piece at 0, with a reason | Saved, shown as SAR 0.00 — and the participant says whether that is right (question D) |
| 5.2 | Open the cola's prices | Its price history is still shown; no new price is offered for that pack |

## Part 6 · History

| # | Task | Passes when |
|---|---|---|
| 6.1 | Read the history of the first chosen item | Every price set and withdrawn, with who, when and why |
| 6.2 | Say what a branch ordering that carton on 1.1's day was charged | Read correctly from the history |

## Part 7 · When the connection drops

| # | Task | Passes when |
|---|---|---|
| 7.1 | Start setting a price, cut the network, then press Set price | Told the change may or may not have been saved; the form locks |
| 7.2 | Restore the network and press Retry | Saved once, or told it was already saved; never two prices |

## Part 8 · Reading only (second and third participants)

| # | Task | Passes when |
|---|---|---|
| 8.1 | The warehouse manager signs in and opens Transfer prices | Sees every price; told they can read but not change |
| 8.2 | The warehouse manager opens an item's prices | No Set price form and no Withdraw is offered |
| 8.3 | The branch worker signs in at their branch and opens Transfer prices | Sees their own brand's items only |
| 8.4 | The branch worker types the address of another brand's item's prices into the browser | Told there is no such item; nothing about it is shown |

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
