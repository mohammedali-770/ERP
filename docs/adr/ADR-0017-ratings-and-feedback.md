# ADR-0017 — Ratings and feedback

- **Status:** Proposed
- **Date:** 2026-09-18
- **Requirements:** `RTG-P01`..`RTG-P12` (proposed) · HR-014 · HR-016 · DLV-009 · DLV-010 · AI-011 · AI-019 · CRM-009
- **Deciders:** Product Owner, with HR consulted

## Context

The business wants to rate cashiers and drivers, and wants customers to rate
branches, cashiers and drivers.

The PRD has performance *measurement* — driver and delivery measures (DLV-009),
agent metrics (CC-007), HR evaluations (HR-014) — but nothing customer-submitted
about individuals. This is new behaviour, and it is the kind that can quietly do
real harm to real employees if built naively.

Four failure modes are worth naming before the decisions, because each decision
below exists to prevent one:

1. **Scoring someone on an outcome they cannot control.** A cashier rated on cold
   food. A driver rated on a missing item. The number is meaningless and the
   person cannot improve it.
2. **False precision from small samples.** A driver with three ratings and one bad
   one has a 3.0 average. Displayed as a score it looks like a fact; it is noise,
   and it can put someone bottom of a list they should never have been ranked in.
3. **Consequence without recourse.** A rating that affects someone's pay, shifts
   or work allocation, which they cannot see or contest.
4. **Exposing a customer to the person they criticised.** A driver has been to
   the customer's home.

## Decisions

### 1. Purpose is recognition and coaching only

**Ratings carry no automatic consequence.** Not pay, not discipline, not
scheduling, not work allocation. `RTG-P11` states this as a requirement rather
than a convention, at P0, because it is the constraint everything else depends on.

Using ratings for any of those later is a **separate decision requiring approval
and — for pay in particular — legal review before it is built**, not a
configuration change. Systems drift toward the use their data enables; writing
the boundary into the requirement makes crossing it visible.

This also happens to match what the data is statistically fit for. Most staff will
never accumulate enough ratings for an individual score to be defensible. It is
honest to build something that identifies who to thank and who to help, and
dishonest to build something that pretends to rank people.

### 2. Customers rate the service; attribution is internal

The customer rates *their order* or *their delivery*, across dimensions. They are
never shown an employee's name to score.

Management sees which cashier and driver the rating attributes to (`RTG-P03`).
That keeps the data useful without putting an employee's name in front of an angry
customer, and without the retaliation dynamic that naming creates.

**The customer's identity is never disclosed to the rated employee** (`RTG-P12`),
including after the order closes. DLV-010 already restricts customer contact data
to the active delivery; a rating must not become the exception that reopens it.

### 3. Every dimension attributes only to roles that could affect it

A recorded, configurable mapping. Indicatively:

| Dimension | Attributes to |
|---|---|
| Order accuracy | Cashier or ordering channel, kitchen |
| Food quality and temperature | Kitchen, branch — **not the driver** |
| Speed of service | Branch; driver for the delivery leg only |
| Courtesy at the counter | Cashier |
| Delivery experience | Driver |
| Overall | Branch only, never an individual |

The mapping is a decision recorded in configuration, not logic buried in code, so
it can be corrected when it turns out to be wrong — and it will.

### 4. Computed measures and human judgement are never merged

Operational measures the system computes — cash variance, void rate, delivery
times, failed deliveries — sit alongside a manager's assessment. **They are never
combined into one number** (`RTG-P08`).

A blended score hides which part is fact and which is judgement, which makes it
impossible to discuss. "Your delivery times are in the bottom quartile" is
actionable. "Your score is 2.8" is not.

### 5. Staff see their own ratings and may contest them

Visible in aggregate, without customer identity (`RTG-P09`). Contestable with
evidence, the original retained, the outcome recorded (`RTG-P10`).

This mirrors AI-019, which the PRD already requires for AI findings. **A customer
rating deserves at least the protection the PRD gives an algorithm's opinion.**

### 6. No score below a minimum sample, and no ranking on a raw mean

`RTG-P04` and `RTG-P05`. Below the threshold the system reports *insufficient
data* — not a provisional score, not a greyed-out number.

Above it, every aggregate carries its sample size and uncertainty, and ranking
never uses a bare average. The statistics are proven by
`spikes/rating-statistics/`, because this is the decision most likely to be
quietly undone by someone adding a league table later.

That spike found more than it was built to check. A raw-mean league table names
someone who is **better than half their colleagues** as the worst performer in
44% of cases, on a median of **one rating** — which is the decision above,
confirmed. But it also showed that even done correctly, with a 30-rating
threshold and a lower confidence bound, the bottom three changes completely
between two draws from an *unchanged* population in 43.7% of periods.

So the threshold and the lower bound stop the system naming the wrong person.
**They do not make a bottom-three list mean anything**, and no arithmetic will.
That is a finding about the feature, not about the method, and it is why the
decision is phrased as identifying who to help rather than as ranking done
carefully.

## Consequences

- The feature identifies **who to thank and who to help**. It does not rank people,
  and anyone expecting a leaderboard should be told that now rather than after it
  is built.
- Response bias is recorded, not corrected (`RTG-P06`). Customers who rate are not
  a random sample, and no amount of arithmetic fixes that — so the sample size and
  response rate travel with every figure.
- Ratings accompanying a complaint or refund are flagged and reported separately
  (`RTG-P07`). They are legitimate signal but not independent observation, and
  averaging them in overstates dissatisfaction among people who did not complain.
- **This needs HR involvement before implementation**, not only product. Anything
  recording an opinion about a named employee touches employment practice, however
  carefully it is scoped.

## Alternatives

**Named individual ratings, as ride-hailing apps do.** Rejected. It raises service
standards in businesses where the worker and customer never meet again — but a
delivery driver has been to that customer's home, and the asymmetry of naming one
party to the other is not one to create casually.

**A single blended score per person.** Rejected, per decision 4. It is more
convenient to display and impossible to act on.

**Ratings feeding work allocation.** Rejected for now. It compounds: a driver with
one early bad rating gets fewer orders, so fewer chances to recover, so the early
rating becomes permanent. If it is ever revisited it needs a deliberate floor.
