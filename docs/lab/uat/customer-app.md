# UAT — Customer application

**Run by:** people who are not on the project. Family, staff from other
departments — anyone who has not seen it being built.
**Duration:** about two hours

Covers `APP-001`..`APP-015`.

> **Do not use the team.** Anyone who watched this being built cannot un-know
> where things are, which is exactly what the pack measures.

---

## Part 1 · First use

| # | Task | Passes when |
|---|---|---|
| 1.1 | Sign in with your mobile number | Code arrives promptly; entry is obvious |
| 1.2 | Enter your number in a different format | Accepted — spaces, `+966`, leading zero |
| 1.3 | Find the nearest branch | Suggested sensibly |
| 1.4 | Use the app entirely in Arabic | Correct right-to-left layout throughout |

## Part 2 · Ordering

| # | Task | Passes when |
|---|---|---|
| 2.1 | Order three items, one with options | Cart matches what you chose |
| 2.2 | Add a delivery address on the map | Pin placement is workable |
| 2.3 | Try an order below the minimum | Told clearly, with the amount needed |
| 2.4 | Order an unavailable item | Not offered, or clearly marked |
| 2.5 | Place a pickup order | Branch and timing clear |

## Part 3 · When things go wrong

| # | Task | Passes when |
|---|---|---|
| 3.1 | Tap "pay" twice quickly | **One order, one charge** |
| 3.2 | Lose connection mid-payment | You can tell what happened; no ambiguity about whether you paid |
| 3.3 | Reopen the app after a failed order | State is clear, not blank or wrong |

## Part 4 · After ordering

| # | Task | Passes when |
|---|---|---|
| 4.1 | Follow your order's status | Understandable without explanation |
| 4.2 | Check status wording for a **delivery** order at "ready" | Does **not** say "ready for pickup" |
| 4.3 | Find an old order | Findable within a few taps |
| 4.4 | Turn off promotional notifications | Obvious where; takes effect |

> **4.2 is checked explicitly** because it is a bug that already happened in the
> live system: every delivery order passes through "ready", and for months it
> showed pickup wording before contradicting itself minutes later.

---

## Sign-off

| Participant | Relationship to the project | Passed? | Date | Signature |
|---|---|---|---|---|
| | *(must be "none"* | | | |

| | |
|---|---|
| Places people got stuck | |
| Observer | |
