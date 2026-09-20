# Risk spikes

Runnable proving code with numeric pass/fail gates, retiring the irreversible
risks **before** the architecture is committed.

**This is throwaway code.** It exists to produce evidence, not to be extended into
the product. It implements exactly the mechanisms the design claims, so a failure
here is a real design failure rather than a modelling artefact.

---

## The control-case rule

**A spike that cannot fail is not evidence.**

Every executable spike carries a control case that deliberately breaks the
mechanism under test and asserts the harness detects it. A run that passes its
scenario but whose control case also passes reports **FAIL** — because it has
proved nothing.

This is not hypothetical. Four of the spikes caught something real on their first
run — three a defect in the mechanism or the harness, one a gate that was wrong
rather than a mechanism that was:

- The **offline-sync** control case did not fail on its first run, which exposed
  that the prefix-acknowledgement check short-circuited before the idempotency key
  was ever reached. The scenario had been passing without exercising the mechanism
  it claimed to prove.
- The **payment-reconciliation** spike surfaced an unsafe short-reference
  derivation: truncating a UUIDv7 keeps only its timestamp, so two intents in one
  millisecond receive the same payment reference — a payment attached to the wrong
  order. See that spike's README.
- The **callback-engine** control was a no-op on its first run, because the broken
  path still ran the correct check alongside it. Its measurement was also
  number-scoped where the requirement is per abandoned call, reporting correct
  behaviour as a defect. Both are written up in that spike's README.
- The **rating-statistics** spike failed its own first run on a gate that was
  wrong rather than a mechanism that was: it demanded the bottom-three list be
  stable between two draws from an unchanged population, which neither method
  achieves. The gate was replaced by one on the harm — naming someone who is
  above the median — and the instability was kept as a **reported finding**,
  because it argues against publishing a bottom-three at all. A gate there would
  have been tuned until it passed, and the result would have been buried.

---

## Executable now

| Spike | Retires | Gate | Run |
|---|---|---|---|
| [`offline-sync`](./offline-sync) | **R-02 (Critical)** | Zero lost, zero duplicated business orders at 250 orders/h across 3 branches with link flapping, crashes, clock skew and lost responses | `npm run spike:offline-sync` |
| [`print-queue`](./print-queue) | **R-01 (High)** | Zero lost kitchen slips, no silent duplicate invoice, every document identifiable | `npm run spike:print-queue` |
| [`shift-conflict`](./shift-conflict) | T-08 | Deterministic merge, zero cash lost, append-only correction, tamper-evident blind count | `npm run spike:shift-conflict` |
| [`payment-reconciliation`](./payment-reconciliation) | **D-1 design risk** | Zero double charges and zero misattribution under induced ambiguity; refunds idempotent | `npm run spike:payment-reconciliation` |
| [`callback-engine`](./callback-engine) | CC-P01..P08 design risk | Nobody called after ordering; no duplicates, stale or out-of-hours calls | `npm run spike:callback-engine` |
| [`rating-statistics`](./rating-statistics) | RTG-P03..P05 design risk | Nobody scored below the minimum sample; the person named worst is not above the median; no driver moved by a kitchen | `npm run spike:rating-statistics` |

Each writes a machine-readable report to `<spike>/out/report.json`, so the
executive evidence package is assembled from artifacts rather than written up.

Results are deterministic for a given seed, so a failing run is reproducible from
its seed alone.

## Blocked on physical hardware

These test properties of the branch network and of iOS. **A simulation of either
would prove nothing**, so they are written as procedures rather than code.

| Spike | Decides | Blocked by |
|---|---|---|
| [`lan-peer-sync`](./lan-peer-sync) | **ADR-0004** — can eliminate iPad-only on its own | B-03 |
| [`ios-durability`](./ios-durability) | **ADR-0004** — printing and unattended operation | B-03 |

**Both should run in week 1–2.** The branch-network check in particular is a
configuration question, not an engineering effort, and it can change the hardware
budget. Running it in week 2 rather than month 8 is the difference between a fact
and an expensive surprise.

**A procedure is not evidence until someone runs it.** `req-lint` distinguishes
these two from the runnable spikes, and reports a requirement that names only them
as having no acceptance evidence — five do. Before that check existed, those five
satisfied the F0 exit gate by citing a document.

## Blocked on external parties

| Spike | Needs | Blocked by |
|---|---|---|
| Payment ECR unknown-outcome harness | The real acquirer and terminal; cannot be run against production | B-01 |
| ZATCA offline issuance | Sandbox onboarding credentials | B-02 |
