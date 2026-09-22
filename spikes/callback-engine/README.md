# Spike: abandoned-call callback engine

Proves the abandoned-call recovery rules before the integration is built.
**Needs no PBX.**

```
npm run spike:callback-engine
```

Requirements `CC-P01`..`CC-P08` in
[`proposed.yaml`](../../docs/requirements/proposed.yaml) — **proposed, not yet
approved.** Design in
[`call-centre-integration.md`](../../docs/architecture/call-centre-integration.md).

---

## The race this exists to prove

```
t0  caller gives up waiting in the queue   → entry queued
t1  caller orders through the app instead  → order recorded
t2  an agent finally becomes free          → engine wakes
t3  engine decides whether to call         → MUST see the t1 order
```

If suppression is evaluated at **t0** rather than **t3**, the customer is phoned
after they have already ordered. That is the single most likely way this feature
irritates people, and it is the natural implementation — having checked once when
the entry was created, there seems no reason to check again.

**The control case is exactly that implementation.** It places **91 calls to
customers who had already ordered** in a 500-abandonment run, and the harness
fails if it does not.

## Gates

| Property | Requirement |
|---|---|
| Nobody called after ordering, through any channel | `CC-P03` |
| One attempt per abandoned call | `CC-P06` |
| One open entry per caller number at a time | `CC-P02` |
| No call once the staleness window has elapsed | `CC-P04` |
| No call outside operating hours | `CC-P07` |
| Every entry reaches exactly one terminal state | `CC-P08` |

## Typical run

1000 abandonments, agents scarce, a third of callers ordering for themselves
while they wait:

| Outcome | Count |
|---|---|
| Connected — recovered | 461 (46%) |
| Suppressed — ordered anyway | 171 |
| Unanswered | 282 |
| Unreachable — caller ID withheld | 62 |
| Expired — too slow | 24 |
| **Called after ordering** | **0** |

The suppressed and expired counts matter as much as the recovered one: they are
calls the system correctly chose *not* to make.

---

## Two things this spike got wrong first

Recorded because the corrections are the useful part.

**1. The measurement was number-scoped when it should have been entry-scoped.**
The first run reported 43 wrong calls and 351 duplicates. Both were measurement
errors, not engine errors: a customer who abandons at 10:00 and again at 14:00 has
two separate intents and legitimately receives two callbacks, and an order placed
before the second abandonment should not suppress it. `CC-P06` is one attempt per
*abandoned call*, not per number.

**2. The control case was a no-op.** It set suppression to happen at queue time
but left the correct dial-time check running, so the correct behaviour masked the
broken one and the control reported zero wrong calls. A naive implementation would
not re-check — that is the whole bug — so the control now genuinely skips the
dial-time check.

Both are the same lesson the other spikes taught: **a control case that passes
means the harness has proved nothing.**

## Structure

| File | Contents |
|---|---|
| `src/engine.ts` | The engine: lifecycle, suppression, expiry, operating hours |
| `src/scenario.ts` | Concurrent abandonments, orders and agent availability |
| `src/cli.ts` | Runner and the control case |

The engine takes its outside world as ports — orders, agent availability, dial —
so the spike drives it deterministically and the real adapter can implement the
same interface.

## What this does not prove

Which CDR fields identify an abandonment on the live PBX. That needs the real box,
and no connection to it exists: its credentials are exposed and unrotated
([B-06](../../docs/program/blocked.md)), and its stability is unresolved with the
vendor ([B-07](../../docs/program/blocked.md)). An earlier version of this note
said the API "was returning errors" — that claim was retracted on 2026-09-21, when
the failures turned out to date from October 2025 and to have never been retested.
The assumption is flagged in the design.
