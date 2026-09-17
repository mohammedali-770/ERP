# Spike: payment unknown-outcome reconciliation

**Retires the design risk behind D-1**, which is frozen pending provider selection.
**Runnable now** — it needs no provider.

```
npm run spike:payment-reconciliation
```

---

## Why this exists while payments are frozen

Sixteen F1 requirements sit behind a payment provider decision that has not been
taken. That blocks *integration*. It does not have to block *design*.

This spike proves the protocol against a simulator, so when a provider is chosen
the remaining work is wiring rather than thinking. It also produces a number the
selection needs: **how much the query-by-reference capability is actually worth.**

## What it proves

| Property | Requirement |
|---|---|
| A charge is refused from `UNKNOWN` — the provider is never contacted | PAY-007, NFR-004 |
| Zero double charges under induced ambiguity | NFR-004, T-04 |
| Zero payments attached to more than one order | NFR-004 |
| A retried refund issues exactly one refund | PAY-011, T-05 |
| An order is frozen for payment activity while any intent is unresolved | PAY-007 |
| Unresolvable outcomes escalate rather than guess | PAY-007 |
| The resolution source is recorded permanently | — |

## Control cases

Two, because a harness that cannot fail is not evidence:

1. **Blind retry from `UNKNOWN`** — what a naive implementation does, since
   retrying is the normal response to a failed request. The simulated provider
   does not deduplicate, so customers are charged twice. Detected.
2. **Truncated reference** — see below. Detected.

Both must fail for the run to report a pass.

---

## What this spike found

**Deriving the terminal reference by truncating the intent identifier is unsafe.**

Terminal protocols cap the merchant reference at a small number of characters, so
the full identifier usually cannot be sent and something shorter must be derived.
The obvious approach is to take the first N characters.

For UUIDv7 that is wrong, and quietly so: **its leading characters are a
timestamp.** Two intents created in the same millisecond share that prefix
entirely and receive the *same* payment reference. A reconciliation query for one
order then returns the other order's outcome — precisely the misattribution
NFR-004 forbids.

The fix is to hash rather than truncate, so every bit of the identifier
contributes to every output character. `src/reference.ts` does this, and the tests
demonstrate the failure as well as the fix.

This hazard is the reason question **A2** in the
[provider questionnaire](../../docs/program/enablement/02-acquirer-questionnaire.md)
asks for the exact reference field width, and why `collisionProbability()` exists
— when an acquirer states a width, somebody has to judge whether it survives the
transaction volume.

---

## The number the provider selection needs

The ladder tries, in order: the terminal on the counter, the gateway, the
settlement file, then a person reading a printed slip.

The terminal query is the only rung that works **with no connectivity** — which is
exactly when branches must keep trading (OFF-001). So its value is concentrated in
outages, and the spike measures it there:

| During an outage, per 500 transactions | With query-by-reference | Without |
|---|---|---|
| Ambiguous outcomes | ~51 | ~51 |
| **Needing a cashier to stop and check a slip** | **~8** | **~51** |
| Double charges | 0 | 0 |

**Roughly a sixfold difference in service interruptions.** The safety guard holds
either way — customers are never charged twice regardless of the provider. What
changes is how often a cashier stops mid-service to reconcile by hand.

That is the trade to price during selection, and it does not appear on any rate
card.

---

## Structure

| File | Contents |
|---|---|
| `src/provider.ts` | Simulated acquirer, gateway and terminal. **Holds ground truth about whether money moved; our system does not.** Injects lost responses, unreachable rungs, declines |
| `src/reference.ts` | Short-reference derivation, the safe and unsafe variants, and a collision estimator |
| `src/reconciler.ts` | The protocol: the charge guard, the ladder, refund idempotency |
| `src/scenario.ts` | Fault injection and measurement |
| `src/cli.ts` | Runner, control cases, and the outage cost comparison |

Double charges are counted from the **provider's** record, never from ours —
because our records are exactly what can be wrong.

---

## What this does not prove

It is a simulator. It cannot tell you whether a real acquirer honours
query-by-reference, how wide its reference field is, or how its terminal behaves
when a cable is pulled mid-transaction. Those need the
[real hardware spike](../../docs/program/blocked.md), which is blocked on B-01.

What it does establish is that **the protocol is correct given a provider that
behaves as specified** — so when one is chosen, the open question is integration,
not design.
