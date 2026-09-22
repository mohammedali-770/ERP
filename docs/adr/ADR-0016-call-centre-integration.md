# ADR-0016 — Yeastar call-centre integration

- **Status:** Proposed — **blocked on B-07 (PBX stability)**
- **Date:** 2026-09-17
- **PRD decisions:** CC-001 · CC-008 · CC-009
- **Deciders:** Product Owner, with IT

## Context

CC-001 requires integration with the Yeastar environment "through supported
interfaces". Establishing which interfaces those actually are turned out to
matter more than expected.

### What the hardware is

**A Yeastar P560 on firmware 37.23.0.123.** Not a P650 — no such model exists.
The P-Series appliance line is P520, P550, P560 and P570. A Saudi reseller
publishes a product page at a `/yeastar-p650/` URL that describes a P560, which
is a reasonable source of the confusion.

The firmware is above the 37.7.0.16 the API requires, so the interface is
supported on this box. Evidence: the diagnostic bundle in the `yeastarissue`
repository, filename `P560-SystemLog-37.23.0.123`, NXP i.MX8MM, 2 GB RAM.

### What is actually reachable

This is the finding that constrains the design:

| Surface | Reachable from the ERP? |
|---|---|
| **OpenAPI over HTTPS** | **Yes** — `{base}/openapi/v1.0/`, token auth, plus event push by WebSocket or webhook |
| AMI (port 5038) | **No** — bound with an ACL permitting `127.0.0.1` only |
| CDR feed | **No** — written to a loopback Redis list |
| Internal web API | **No** — Asterisk HTTP on `127.0.0.1:81` |

Access reaches the PBX through Yeastar's **RAS cloud tunnel**
(`*.ras.yeastar.com`), not a direct address.

### What the diagnostic bundle shows about stability

On the captured day, 26 July 2026:

- The watchdog restarted Asterisk **three times** — at 05:01, 15:42 and 20:57 —
  and three core dumps were produced whose filenames carry signal 11
- At the 15:42 and 20:57 restarts every Linkus softphone client dropped
  simultaneously, with nginx logging connection refused for every client websocket
- A kernel `order:0` `GFP_ATOMIC` page allocation failure in the ethernet receive
  path at 00:00:09 the following morning, on a 2 GB appliance with **no swap**
- A flood of `"no active collaboration"` errors from the third-party app module,
  which reads like a licensed integration slot that was never activated

Nothing in the bundle records a vendor reply, a ticket or a resolution.

> **Corrected 2026-09-21.** This list previously carried a fourth bullet saying
> `POST /openapi/v1.0/get_token` was returning `INTERNAL SERVER ERROR` on the
> captured day. Re-reading the bundle shows that is wrong: `openapi.log` holds
> six requests spanning three minutes on **14 October 2025**, nine months
> earlier, and contains no 2026 entries. The observation is real but belongs to a
> different date, and it is recorded accurately in
> [B-07](../program/blocked.md). The kernel allocation failure replaced it here
> because that one genuinely belongs to this incident. **Nothing in the decision
> below rested on the `get_token` claim** — OpenAPI is chosen as the integration
> surface on the grounds in §1, not on that error.

> **Corrected again 2026-09-22**, by reading the archive rather than the earlier
> write-up. Three things above were stated more strongly than the evidence
> supports. **No log in the bundle records a segfault** — the words
> `Segmentation fault`, `SIGSEGV`, `signal 11` and `core dump` appear in zero
> non-core files, so the crash attribution rests on the `.11` suffix in the core
> filenames and is an inference. **The three restarts are not one fault**: the
> 05:01 event is 86 seconds after a cold boot, reports a duplicate process rather
> than an unresponsive one, recovers in about a second, and drops no clients,
> while the other two share a signature and take 21–22 seconds. And **there were
> more restarts than the watchdog logged** — five distinct `/bin/asterisk` PIDs
> appear in the process captures (9096, 9130, 19360, 22677, 13362), implying at
> least four. B-07 carries the detail.
>
> **This strengthens §3 rather than weakening it.** Two unexplained crashes with
> core dumps, plus at least one restart the watchdog did not log, is if anything
> a worse diagnostic position than three understood ones. Nothing in the decisions
> below changes.

## Decision

### 1. OpenAPI is the only integration surface

Not a preference — a finding. AMI and direct CDR access would both be attractive
(lower latency, richer events) and both are unavailable without reconfiguring the
PBX's network exposure, which is not something to do casually on a system that
also terminates SIP.

### 2. Design for reconnection, not for a persistent connection

The adapter assumes it will be disconnected and will miss events. On reconnect it
**backfills from CDR** for the period it was absent rather than resuming as though
nothing happened.

This is observed behaviour, not caution. A design that assumes a stable socket
will silently lose events every time the PBX restarts — and it restarted three
times in one day.

### 3. PBX stability is a prerequisite, not a parallel workstream

**Integration work should not start in earnest until the segfaults are resolved
with the vendor.** Building a screen pop on a platform that crashes daily produces
an ERP that appears broken when it is not, and makes every integration defect
ambiguous — ours or theirs?

Recorded as B-07. A vendor ticket is the first action, and none is on record.

### 4. Reaffirm CC-008 with evidence

CC-008 requires that PBX integration failures not block manual order entry. That
was written as a sound principle. It is now an observed necessity: three times in
one day, every telephony client was unavailable. The adapter is optional by
construction, and order entry has no dependency on it.

### 5. Reserve the audio-streaming interface for CC-009

The API exposes **WebSocket audio streaming**. That is the concrete interface a
future AI voice agent would use, and CC-009's requirement to "reserve controlled
interfaces" now has a specific target rather than an intention.

CC-010's constraint stands regardless: no voice agent places paid orders, issues
refunds or makes sensitive changes without approved controls.

## Consequences

- The integration is simpler than it might have been — one authenticated HTTPS
  surface, one event stream — which is a benefit disguised as a constraint.
- Latency and availability now depend on a vendor cloud tunnel. That belongs in
  the integration's risk register and in any availability commitment.
- **Part of CC-007 is a purchase decision, not an engineering one.** The Call
  Center Console — queue panel, agent metrics, wallboard — requires the Enterprise
  or Ultimate plan. Which plan is active needs confirming before agent-level
  metrics are promised.
- Credentials for every one of these interfaces are currently exposed in a git
  history (B-06). No integration should be built against credentials already known
  to be compromised, so rotation precedes implementation.

## Alternatives

**Reconfigure AMI for external access.** Rejected. It would mean widening network
exposure on a device that terminates SIP, for a feed the OpenAPI event stream
already provides.

**Poll CDR instead of subscribing to events.** Rejected as the primary mechanism —
it cannot deliver a screen pop, which needs the caller's number *before* the agent
answers. Retained as the backfill mechanism after a disconnection, which is where
polling genuinely fits.
