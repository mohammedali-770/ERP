# Call-centre integration

How the ERP talks to the Yeastar PBX, and how abandoned calls are recovered.

Constraints and their evidence are in [ADR-0016](../adr/ADR-0016-call-centre-integration.md).
**Implementation is blocked on B-07** (PBX stability) and partly on the Call
Center Console licensing question.

---

## The surface

One authenticated HTTPS API plus one event stream. Everything else on the PBX is
loopback-bound and unreachable.

```
ERP  ──HTTPS──►  {base}/openapi/v1.0/{endpoint}?access_token=…   (requests)
     ◄──WS/webhook──  events 30011, 30012, 30016, 30029, …        (push)
                 via *.ras.yeastar.com  (vendor cloud tunnel)
```

Every request carries a `User-Agent` header, which the PBX uses to identify the
calling application.

### Adapter rules

The connector obligations from PRD §6.3 apply in full: authentication, timeout,
retry, idempotency, validation, health monitoring, a named operational owner.
Three deserve emphasis here.

**Reconnection is the normal case, not the exception.** The adapter maintains a
cursor of the last event processed. On reconnect it backfills from CDR for the
gap rather than resuming blind. Without this, every PBX restart silently loses
that window's events — and the platform restarted three times in one day.

**Raw provider responses are retained separately from normalised conclusions.**
A CDR row and our interpretation of it are different things, and reconciliation
needs the original.

**Connector failure creates an exception; it never corrupts an order.** CC-008 is
structural: order entry has no code path that depends on the PBX being reachable.

---

## Requirement mapping

### CC-002, CC-003 · Screen pop

Event **`30016` (incoming call request)** carries the caller's number *before the
agent answers*. The ERP normalises it, resolves the customer, and pushes their
profile, recent orders and open cases to the agent's workspace.

This is the highest-value, lowest-effort part of the whole integration: one event
subscription and a lookup, and the agent answers already knowing who is calling
and what they last ordered.

Permissions apply (CC-003) — the agent sees what their role allows, not the
customer's full record.

**Number matching reuses the canonical normalisation APP-004 requires.** Caller ID
and the app's stored number arrive in different formats; that is exactly the
problem canonical normalisation exists to solve, and it must not be
re-implemented here.

Where caller ID is withheld, there is no pop. That is a normal outcome, not an
error, and the agent workspace should say so plainly rather than appearing to fail.

### CC-004 · Order entry

No PBX dependency. Call-centre agents use the same menu, pricing, availability
and order rules as every other channel — the workspace is a different surface on
the same order service, not a parallel path.

### CC-005 · Click to call

`POST /openapi/v1.0/call/dial` with `caller` = the agent's extension and
`callee` = the customer's number. Permission-checked on the ERP side before the
call is placed.

### CC-006 · Recordings

**Use `playtoextension` rather than downloading the file.**

The PBX plays the recording to an authorised extension. The audio never leaves the
PBX, so the ERP never stores a copy. That satisfies "linked to authorised cases
without exposing them broadly" far better than replicating recordings, and it
keeps call audio out of the ERP's personal-data surface entirely.

The ERP stores the *reference* and the authorisation decision; the PBX stores the
audio. Access is audited on our side.

### CC-007 · Metrics

| Measure | Source |
|---|---|
| Call volume, answer rate, handling time | CDR 2.0, call reports |
| Abandoned calls | CDR plus queue call status |
| Agent availability | Event `30029`, plus `agent_status` for reconciliation |
| Agent auto-pause, ring timeout | Events `30025`, `30026` |
| **Order conversion** | **ERP-side join — see below** |

> **Order conversion needs a decision now.** Attributing an order to the call that
> produced it requires the call identifier to be stored **on the order at
> creation**. It cannot be reconstructed afterwards. Recorded as Q-14.

Agent-level metrics depend on the Call Center Console, which is plan-gated
(ADR-0016).

### CC-009, CC-010 · Future voice agent

The API's **WebSocket audio streaming** is the interface to reserve. Nothing is
built now; the architectural space is held, and CC-010's prohibition on a voice
agent placing paid orders or issuing refunds without approved controls stands
whenever it is.

---

## Abandoned-call callback

Recovers callers who gave up waiting, by calling them back once an agent is free.

Requirements `CC-P01`..`CC-P08` in
[`proposed.yaml`](../requirements/proposed.yaml) — **proposed, not yet approved**,
because the PRD treats abandoned calls only as a metric.

### Why the state lives in the ERP

The suppression rule is "has this person ordered since they hung up?" — through
*any* channel, including the app. **The PBX cannot answer that question**; it
knows nothing about orders. So the callback queue, its rules and its outcomes are
ERP state, and the PBX supplies only three things: the abandonment, agent
availability, and the `dial`.

### Lifecycle

```
                    ┌──────────────► SUPPRESSED   (ordered since abandoning)
                    │
ABANDONED ─► ELIGIBLE ─────────────► EXPIRED      (staleness window elapsed)
                    │
                    ├──────────────► UNREACHABLE  (caller ID withheld)
                    │
                    └─► DIALLING ─┬─► CONNECTED   (agent and customer talking)
                                  └─► UNANSWERED  (one attempt, closed)
```

Every terminal state is recorded with its reason. An entry is never silently
dropped, because CC-P08 reports on why each one closed.

### The rules, and why each is shaped that way

**Suppression is evaluated immediately before dialling — never when queued.**

An order can arrive while the entry waits for a free agent. Checking at queue time
would call customers who have already ordered, which is the single most likely way
this feature irritates people. The check is cheap; the failure is not.

**One open entry per caller number.**

A customer who abandons three times in ten minutes gets one callback, not three.

**Staleness, not cooldown.**

No callback once the configured window has elapsed since abandonment. Calling
someone back long after they gave up is worse than not calling: they have ordered
elsewhere, or forgotten, and the call reads as incompetence rather than service.
Expired entries close and remain in the report.

**Agent first, then the customer.**

`dial` with `caller` = the agent's extension and `auto_answer` = yes connects the
agent, then dials the customer. The customer never answers to silence — which
matters especially for someone who already gave up waiting once.

The cost is honest: the agent is occupied while the customer's phone rings, and
that time is wasted if they do not answer. That trade was made deliberately.

**One attempt.**

An unanswered callback closes and is recorded. No automated redialling. A system
that rings a customer repeatedly is worse than one that misses them.

**Operating hours are enforced.**

No callbacks outside configured hours. An entry whose window elapses overnight
**expires rather than being deferred to the morning** — a callback about last
night's abandoned order is not a service.

### Interaction with PBX restarts

Given the observed instability, the engine cannot assume it saw every
abandonment. On reconnect it **re-queries CDR for the disconnection window** and
creates entries for abandonments it missed, subject to the same staleness rule —
which usually means a long outage produces no callbacks at all, correctly.

### The race that must not be got wrong

```
t0  caller abandons                    → entry ELIGIBLE
t1  caller orders through the app      → order recorded
t2  an agent becomes free              → engine wakes
t3  engine checks suppression          → MUST see the t1 order
```

If suppression is evaluated at t0 instead of t3, the customer is called after
ordering. This is the property the spike exists to prove.

### What the engine needs from each side

| From the PBX | From the ERP |
|---|---|
| Abandonment events, or CDR rows identifying them | Orders by normalised number since a timestamp, across all channels |
| Agent availability (`30029`, `agent_status`) | Operating hours per branch or queue |
| `dial` to place the callback | Consent and contact preferences |
| CDR for backfill after a disconnection | Audit of every callback placed and every suppression |

### Open design points

- **Which CDR fields identify an abandonment** needs confirming against the live
  box. The PBX tracks abandoned calls (they appear on its wallboard), but the exact
  field was not verifiable while the API was returning errors. Assumption, flagged.
- **Whether a callback counts as an outbound contact** for consent purposes. It
  services an inbound request, which is materially different from marketing — but
  it should be recorded and the privacy assessment should confirm the treatment.

---

## Sequencing

| | Step | Blocked by |
|---|---|---|
| 1 | Resolve the PBX segfaults with the vendor | **B-07** |
| 2 | Rotate the exposed credentials | **B-06** |
| 3 | Confirm the active subscription plan | — |
| 4 | Establish the API connection and event stream | 1, 2 |
| 5 | Screen pop (CC-002, CC-003) | 4 |
| 6 | Click to call, recordings (CC-005, CC-006) | 4 |
| 7 | Metrics (CC-007) | 3, 4 |
| 8 | Abandoned-call callback (CC-P01..P08) | 4, and approval of the proposed requirements |

Steps 1 to 3 are not engineering work. They are the three things that must happen
before any of the rest is worth starting.
