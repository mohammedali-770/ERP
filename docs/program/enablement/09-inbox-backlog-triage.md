# The WhatsApp inbox asked for help 165 times

**For:** Owner, and whoever is accountable for inbox operations
**Unblocks:** B-09 — and answers [Q-17](../open-questions.md)
**Time needed:** ten minutes to read; the first hour of work needs no decision at all

---

## What happened and what it means

The WhatsApp inbox has an AI that answers customers. When it cannot answer, it
sets a flag and hands the conversation to a human. That is working correctly.

**Nobody is on the other end of the handoff.**

Measured read-only on 2026-09-21:

| | |
|---|---|
| Customers flagged as needing a human, **never given one** | **78** |
| Of those, where the AI **explicitly handed off** | **77** |
| **Handoffs made and ignored** | **165** |
| Most handoffs for one person | **20** |
| Notifications ever sent to a human, all time | **0** |
| Conversations ever marked claimed, or handled | **0**, and **0** |
| Complaints logged | **6** |

The AI wrote a note each time explaining why it was handing off. All 78 have one.
It did not fail quietly — it asked 165 times.

## This is not an old backlog

| Last heard from them | Customers |
|---|---|
| **Within 24 hours** | 6 |
| **Within 7 days** | **62** |
| Over 7 days ago | 16 |
| Over 14 days ago | 2 |

**62 of the 78 are live conversations.** Most of these people are still reachable
and most of them still want the thing they asked for. The oldest has been waiting
since 3 September.

What they wanted, by conversation: **orders 33 · delivery 18 · complaints 4**
(between them, 23 separate handoffs) · everything else about 35.

---

## What to do this morning — no decision required

**Open the inbox and start working the flagged conversations, newest first.**

That is it. Nothing below this line needs to happen before it, and nothing below
this line helps anyone until it does.

The flagged conversations are already recorded and already visible. **Fixing the
notification system is not what gets these 78 people an answer** — it is what
stops the next 78 from accumulating. Those are different problems and only one of
them has customers waiting.

Suggested order, if it helps:

1. **The 6 complaints.** Someone complained, was handed off, and heard nothing.
2. **The 6 active in the last 24 hours** — still in the conversation.
3. **The remaining 56 from the last 7 days.**
4. The 16 older ones, on the assumption most are gone.

---

## Two questions only a person can answer

These are [Q-17](../open-questions.md), and they decide what gets built. **They
are not technical questions** — the database cannot answer either of them.

We know someone uses this inbox: there are 18 human replies, the most recent on
2026-09-20. So it is not that nobody opens it. But that person replied to 12
customers while 78 flagged ones sat untouched.

> **1. When you open the inbox, do you see which conversations the AI flagged for
> you?**
>
> …
>
> **2. Whose job is it to clear those?**
>
> …

**If the answer to 1 is no**, the flag exists but is not shown, and that is a
small fix in the application.

**If the answer to 2 is "nobody"**, then nothing is broken in the software, and no
amount of engineering produces a person. Notifications would be delivered to
someone who was never asked to receive them.

Those two have almost nothing in common, which is why this asks rather than
assumes.

---

## For whoever holds the inbox application's source

The source is **not in any repository we can see from here.** Three things in it
would settle the technical half of Q-17 in about five minutes:

1. Does the manager-facing page ever call **`pushManager.subscribe()`**?
2. Is a **VAPID key** configured for web push?
3. Does any code path **insert into `inbox_push_subscriptions`**?

If all three are no, the channel was never finished and the empty table is
expected rather than a fault. If any is yes, it was wired and is failing silently.

**Separately, and more important than this question:** please confirm where that
source lives. `docs/estate/inbox-absorption.md` §2 records that the Arabic phrase
normaliser behind 412 curated variants exists **only** in application code — if
that code is not in a repository anyone can find, the risk is larger than a
notification channel.

---

## Record when done

| | Done | By | Date |
|---|---|---|---|
| The 6 complaints answered | ☐ | | |
| The 6 active-today conversations answered | ☐ | | |
| The remaining recent conversations worked through | ☐ | | |
| Question 1 answered above | ☐ | | |
| Question 2 answered above | ☐ | | |
| Location of the application source confirmed | ☐ | | |

**How many of the 78 turned out to still want something?**

> …

That number decides whether this was an expensive outage or a near miss, and it is
worth writing down before the impression fades. Then close B-09 in
[`../blocked.md`](../blocked.md) and answer Q-17 in
[`../open-questions.md`](../open-questions.md).
