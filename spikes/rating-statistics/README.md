# Spike: rating statistics

Proves the two arithmetic rules that protect employees from the ratings feature.
**Needs no data and no service.**

```
npm run spike:rating-statistics
```

Requirements `RTG-P03`, `RTG-P04`, `RTG-P05` in
[`proposed.yaml`](../../docs/requirements/proposed.yaml) — **proposed, not yet
approved.** Reasoning in
[ADR-0017](../../docs/adr/ADR-0017-ratings-and-feedback.md); design in
[`ratings-and-feedback.md`](../../docs/architecture/ratings-and-feedback.md).

The simulator knows each person's true quality. **Nothing that scores or ranks is
ever shown it.** That gap is what makes a wrong naming measurable: we can ask,
after the fact, whether the person the system called worst really was.

---

## Gate A — sample size and ranking

100 cashiers, very unequal exposure (4 to 800 orders in a period), a 25% response
rate, 300 periods. Each period draws ratings **twice** from the same unchanged
population, so each period yields two ranking decisions — 600 in total.

| | Correct method | Control: raw-mean league table |
|---|---|---|
| Named someone **above the population median** | **2** (0.3%) | **263** (43.8%) |
| Named someone truly in the bottom decile | 325 (54.2%) | 89 (14.8%) |
| Median ratings behind the naming | **36** | **1** |
| Named an unrankable person | 0 | 600 |
| Scores shown below the threshold | 0 | — no threshold — |

**Read the last two rows first.** The league table names a person as the worst
performer on the strength of **one rating**, and in 44% of cases that person is
better than half their colleagues. This is not a subtle statistical point; it is
someone being called in for a conversation they did not earn.

## The finding that is reported rather than gated

Two draws from the **same unchanged population**, in the same period:

| | Correct method | Control |
|---|---|---|
| Bottom-three agreement | 0.67 of 3 | 0.32 of 3 |
| Named nobody in common | 43.7% | 69.7% |

The correct method is twice as stable, and still disagrees with itself about who
the bottom three are in **43.7% of periods**. Nothing changed between the draws
except the luck of which customers happened to respond.

So this spike proves less than it might look like, and the honest conclusion is
larger than the gate:

> **The threshold and the lower bound stop the system naming the wrong person.
> They do not make a bottom-three list mean anything.**

That is why it is reported and not gated. A gate here would have been satisfiable
by tuning the bound, and a green check would have hidden the result. It supports
ADR-0017's framing directly: the feature identifies **who to thank and who to
help** — individuals whose figures warrant a conversation — and does not rank
people. Anyone who later asks for a league table should be shown this table.

## Gate B — attribution

60,000 orders. Baseline and degraded runs share one pre-generated order list, and
each concern draws from its own random stream, so **the kitchen is degraded by
33pp and not one driver outcome or one response decision changes.** Under a
correct mapping the expected driver movement is therefore not "small" — it is
exactly zero, and any movement at all is leakage.

| | Correct attribution (`RTG-P03`) | Control: fan-out to everyone who touched the order |
|---|---|---|
| Largest driver score movement | **0.00pp** | **19.04pp** |
| Mean driver movement | 0.00pp | 17.66pp |
| Drivers losing more than 5pp | **0** | **30 of 30** |

Every driver in the control is downgraded for a kitchen they do not work in.
This is ADR-0017's first failure mode — *a driver rated on a missing item* — as a
number.

## Control cases

| Control | Breaks | Must produce |
|---|---|---|
| Raw-mean league table | `RTG-P04`, `RTG-P05` | Above-median people named worst, on 1–2 ratings |
| Fan-out attribution | `RTG-P03` | Drivers downgraded when only the kitchen changed |

Each control **replaces** the mechanism rather than running beside it. The
callback-engine spike's first control was a no-op precisely because the broken
path still ran the correct check, and that mistake is easy to repeat.

The harness reports **FAIL** if either control passes, whatever the gates say.

## Proving the gates bite

Run with the threshold effectively removed:

```
npm run spike:rating-statistics -- --min-sample 1
```

Gate A fails: the named-worst is above the median in **33.5%** of decisions, on a
median of **2** ratings. The threshold is doing the work the requirement claims.

## What this does not model

- **Response bias correlated with the outcome.** Customers who rate are not a
  random sample, and here they are drawn independently of the experience. Real
  dissatisfaction raises the response rate, which shifts the sample itself — it
  cannot be arithmetically corrected, which is why `RTG-P06` records the response
  rate beside every figure rather than adjusting for it.
- **Free-text comments**, which carry customer identity far more often than
  structured fields and are the harder half of `RTG-P12`.
- **Retaliation and gaming.** Both are real and neither is a statistics problem.

## Reproducing

Deterministic for a given seed:

```
npm run spike:rating-statistics -- --seed 20260918 --periods 300 --min-sample 30
```

A machine-readable report is written to `out/report.json`, so the evidence
package is assembled from artifacts rather than transcribed.
