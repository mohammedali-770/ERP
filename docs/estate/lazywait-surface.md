# The Lazywait surface to replace

OMS-002 requires Lazywait to be fully replaced as the long-term order and POS
platform. This document records **exactly what that means in interface terms**,
because the surface turns out to be far narrower than the PRD implies.

*Verified 2026-09-17 by read-only inspection of the live system.*

---

## The whole surface

**Three outbound calls, one inbound webhook, five mapping columns, one settings row.**

### Outbound — ERP → Lazywait

| Call | Purpose | Replaced by |
|---|---|---|
| Create order | Push a customer order into the POS | ERP order management owns the order outright (OMS-001) |
| Customer search | Look up a CRM customer identifier | ERP CRM (CRM-001) |
| Update online payment | Post a captured card payment back against the order | ERP payment ledger (PAY-006) |

### Inbound — Lazywait → ERP

One HMAC-signed webhook carrying order status.

**Critically, the existing design already treats its own database as the source of
truth**: the webhook updates only Lazywait's own status field and never
auto-flips local order state. That is the correct posture and the ERP should keep
it — it means removing Lazywait does not leave a hole where authority used to be,
because authority was never delegated.

### Catalogue pull

A separate job pulls the Lazywait catalogue — items, prices, categories, addon
groups — into a staging table, from which products, variants, categories and
modifiers are mapped.

**This inverts at cutover.** Today Lazywait is the menu authority and the ERP
mirrors it. Afterwards head office controls the menu in the ERP (MNU-001) and
Lazywait, if still running anywhere, becomes a consumer.

### Mapping columns

Five columns tie local records to Lazywait identifiers — on products, product
variants, categories, modifiers, branches, plus a customer identifier on profiles.
These are the seams. At cutover they stop being authoritative and become
historical provenance.

### Configuration

A single settings row holds the base URL, client identifier and secrets.

> **Observation:** the configured base URL currently points at a **development**
> Lazywait host. Whether production traffic uses a different endpoint needs
> confirming before any cutover planning treats today's integration as
> representative.

---

## The retry and ambiguity model — port this, do not re-derive it

The existing integration solved the problem OMS-011 and PAY-007 specify, in
production, against a real third party. It is the single most valuable thing to
carry forward.

**Lazywait's create-order call has no idempotency key.** The existing system
therefore never relies on the far side to deduplicate. Instead:

1. **A fenced pre-send gate** returns one of four outcomes before anything is sent:
   `ready_to_send`, `already_synced`, `ref_present_unverified`, `deadline_expired`.
2. **Outcomes are classified** `ok` / `safe_retry` / `ambiguous` / `terminal`.
3. **Ambiguous never re-sends.** It routes to a human confirmation queue with
   explicit operator actions.
4. **The response reference is stored before the state changes**, so a crash
   between the two leaves evidence that the order may exist rather than losing it.
5. Bounded retry schedule with a deadline and a stale-record reaper.

This is exactly the "query or confirm, never blindly retry" discipline that
[`../architecture/core-transaction-design.md`](../architecture/core-transaction-design.md)
§4 generalises. The ERP's version should be recognisably the same mechanism.

---

## Replacement sequence

| Step | What changes | Gate |
|---|---|---|
| 1 | ERP becomes menu authority; catalogue pull reverses direction | MNU-001, MNU-012 |
| 2 | ERP order management accepts orders directly; outbound create stops for ERP branches | OMS-001, REL-005 |
| 3 | Payment capture posts to the ERP ledger only | PAY-006 |
| 4 | Customer identity moves to ERP CRM | CRM-001 |
| 5 | Inbound webhook retired once no branch is on Lazywait | OMS-002, F6 |

Steps 1–4 apply **per branch** as branches cut over. Step 5 is the end state, from
1 January 2028 under the approved cutover plan (REL-006, ADR-0011).

## Coexistence

Whether to feed Lazywait data into the ERP for consolidated reporting during
2026–2027 is OPN-006, addressed in ADR-0010. The recommendation there is **not
to**, unless executive reporting genuinely requires a single view before cutover:
it adds a second write path into ERP projections purely for reporting, during the
exact period when the ERP's own integrity is still being proven.
