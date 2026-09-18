# Ratings and feedback

How customers rate their experience, how that reaches the people who can act on
it, and what the system must refuse to do with it.

The reasoning behind every rule here is in
[ADR-0017](../adr/ADR-0017-ratings-and-feedback.md). Requirements `RTG-P01`..`RTG-P12`
in [`proposed.yaml`](../requirements/proposed.yaml) are **proposed, not yet
approved** — they originate from a business request rather than the PRD.

---

## The shape

```
customer  ──rates an order──►  rating (one per order, inside a window)
                                    │
                        dimension → role mapping   (configuration)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
          branch view          cashier view          driver view
              │                     │                     │
              └──────── aggregate, with n and uncertainty ─┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            manager: coach, thank           employee: see own, contest
```

**Nothing downstream of the aggregate is automated.** There is no path from a
rating to pay, to a disciplinary record, to a shift, or to the order-allocation
queue. That absence is the design (`RTG-P11`), and it is the property most worth
protecting in review.

---

## Capture — `RTG-P01`, `RTG-P02`

A rating is tied to **exactly one completed order**, and one order admits at most
one rating. The order identifier is the natural idempotency key, exactly as it is
for payments in [`core-transaction-design.md`](./core-transaction-design.md): a
customer who taps *submit* twice on a flaky connection has rated once.

Ratings are accepted only inside a configurable window after completion. The
window exists because a rating of a meal eaten three weeks ago measures memory,
not service.

The customer rates **dimensions of their experience**. They are never presented
with an employee's name to score. This is not a UI preference — `RTG-P01` states
it, because the moment a named individual appears on a rating screen the feature
becomes something else.

Ratings belong to the order's `business_date`, not to the wall clock of
submission, so a rating submitted at 01:30 for a trading day that has not yet
closed reports against that day. This is the same rule the rest of the system
uses, and it matters here because it is the only one that makes a branch's daily
figures reconcile with its orders.

## Dimensions and attribution — `RTG-P03`

Each dimension attributes only to the roles that could affect it. The mapping is
**recorded configuration, not logic in code**, because it will turn out to be
wrong in some detail and correcting it must not require a release.

| Dimension | Attributes to |
|---|---|
| Order accuracy | Cashier or ordering channel; kitchen |
| Food quality and temperature | Kitchen, branch — **not the driver** |
| Speed of service | Branch; driver for the delivery leg only |
| Courtesy at the counter | Cashier |
| Delivery experience | Driver |
| Overall | Branch only, never an individual |

Two consequences follow from the table and are easy to lose:

- **A whole-order score is never fanned out to everyone who touched the order.**
  That is the natural implementation and it is wrong: a driver's average then
  tracks the kitchen. `spikes/rating-statistics/` measures exactly this, and its
  control case is that implementation.
- **"Overall" attributes to the branch alone.** It is the dimension customers
  answer most and reason about least, so it is the one least safe to attach to a
  person.

Attribution is resolved from the order's own record of who served it — the
cashier who took it, the driver who delivered it — not from a roster lookup at
reporting time. A shift swap months later must not silently re-attribute a rating
to someone who was not there.

## Aggregation — `RTG-P04`, `RTG-P05`, `RTG-P06`, `RTG-P07`

### No score below the minimum sample

Below the configured threshold the system reports **insufficient data**. Not a
provisional score, not a greyed-out number, not a number with a warning beside
it: any displayed figure will be read, quoted and acted on, whatever caveat is
printed next to it.

### Every aggregate carries `n` and its uncertainty

A mean without a sample size is a claim without evidence. Aggregates are
displayed with both, and **ranking never uses a raw mean** — it uses a lower
confidence bound, which shrinks sparse samples toward the population and so
stops three ratings from outranking three hundred in either direction.

This is the rule most likely to be quietly undone later by someone adding a
league table, which is why it is proved by a spike rather than asserted in a
document.

### Response rate travels with the figure

Customers who rate are not a random sample of customers (`RTG-P06`). This is
recorded, not corrected — no arithmetic repairs a biased sample, and pretending
otherwise would be worse than showing the bias. Two aggregates with materially
different response rates are not presented as directly comparable.

### Complaint-attached ratings are separated

A rating submitted alongside a complaint or refund request is flagged and
reported separately (`RTG-P07`). It is legitimate signal — often the most
important signal — but it is not an independent observation, and averaging it in
overstates dissatisfaction among the customers who said nothing.

## Computed measures and judgement stay apart — `RTG-P08`

Operational measures the system computes — cash variance, void rate, delivery
times, failed deliveries, the driver measures `DLV-009` already requires — sit
**beside** a manager's assessment (`HR-014`) and the customer ratings. They are
never combined into one number.

A blended score hides which part is fact and which is opinion, which makes it
impossible to discuss and impossible to contest. *"Your deliveries run twelve
minutes over the branch median"* is a conversation. *"Your score is 2.8"* is not.

## What the employee sees, and can do — `RTG-P09`, `RTG-P10`

An employee sees the ratings attributed to them, in aggregate, with **no customer
identity of any kind** — not a name, not a masked number, not an order that
identifies one. They may contest a rating with evidence; the original is retained
and remains auditable, and the outcome of the challenge is recorded alongside it.

This mirrors `AI-019`, which the PRD already requires for AI-generated findings.
A customer's rating of a person deserves at least the protection the PRD gives an
algorithm's opinion of them.

## The consequence boundary — `RTG-P11`

The system must **refuse** to let a rating automatically drive:

- pay, bonus or deduction
- a disciplinary record or process
- scheduling or shift assignment
- order or delivery allocation

Allocation deserves its own sentence, because it is the one that looks harmless.
Feeding ratings into who gets the next delivery compounds: one early bad rating
means fewer orders, which means fewer chances to recover, which means the early
rating becomes permanent. The system would be manufacturing the evidence for its
own judgement.

Any of these uses is a **separate decision requiring approval, and for pay,
legal review** — not a configuration change. Systems drift toward the use their
data enables; writing the boundary into a requirement is what makes crossing it
visible.

## Privacy surface — `RTG-P12`

A rating links an identified customer to a named employee's performance record.
That is a new personal-data flow in both directions, assessed in
[`pdpl-assessment.md`](../compliance/pdpl-assessment.md).

`DLV-010` restricts a driver's access to customer contact data to the active
delivery. **A rating must not become the exception that reopens it.** The rated
employee never learns who rated them, at any time, including after the order
closes — and a driver has been to the customer's home.

Free-text comments carry customer identity more often than structured fields do,
because customers write *"the lady at the counter, I come every Thursday"*.
Comments reaching an employee view are therefore aggregated or withheld, never
passed through verbatim.

---

## Operational rules

The connector and service obligations in [`overview.md`](./overview.md) apply
unchanged. Three are worth naming here:

| Obligation | Here |
|---|---|
| Idempotency | Order identifier; a duplicate submission is absorbed, not counted twice |
| Validation | A rating referencing an order that does not exist, is not complete, or is outside the window is rejected at the boundary |
| Retention | Ratings are personal data about two subjects; retention follows `SEC-008` and `CRM-011`, and a contested rating's original survives the challenge |

## Sequencing

Phase **F5**, and it cannot start earlier: it depends on order completion, on the
canonical customer identity `APP-004` establishes, and on the per-order record of
who served it — which must be written **at order time**. Storing the serving
cashier and driver on the order is cheap now and impossible retrospectively, the
same class of problem as `business_date` and as the call identifier in `Q-14`.

| Step | Depends on |
|---|---|
| 1 | Approval of `RTG-P01`..`RTG-P12` and their folding into the PRD |
| 2 | HR's answer to `Q-15` — whether a human may weigh ratings in an evaluation |
| 3 | Order records carrying the serving cashier and driver |
| 4 | Capture and attribution |
| 5 | Aggregation, with the thresholds the spike sets |
| 6 | Employee view and challenge |

**Step 2 is not a formality.** Anything that records an opinion about a named
employee touches employment practice, however carefully it is scoped, and HR
owns that question rather than engineering.
