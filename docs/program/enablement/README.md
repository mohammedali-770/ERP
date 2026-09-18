# Enablement pack

Five short documents, each addressed to a **specific person outside engineering**,
each ending with something they fill in and hand back.

They exist because the programme is currently waiting on decisions and access
rather than on code. These convert that waiting into work that can happen in
parallel — and none of them depends on a decision being taken first.

---

| | Document | Who acts | Time for them | What it unblocks |
|---|---|---|---|---|
| 1 | [Branch network capability check](./01-network-capability-check.md) | **IT** | ~30 min | May decide the hardware standard outright (D-3) |
| 2 | [Payment provider questionnaire](./02-acquirer-questionnaire.md) | **Finance** | Send and wait | Makes the provider decision a comparison (D-1) |
| 3 | [Counsel brief — data residency](./03-counsel-brief-data-residency.md) | **Executive → legal** | Instruct now, weeks to answer | Production hosting (D-4) |
| 4 | [Tax invoicing — sandbox and one decision](./04-zatca-sandbox-request.md) | **Finance** | Days, plus one decision | Offline invoicing evidence (B-02) |
| 5 | [Cost comparison template](./05-cost-comparison-template.md) | **Whoever gathers quotes** | Ongoing | Tiered options (PRG-010, PRG-012) |
| 6 | [PBX vendor support ticket](./06-pbx-vendor-ticket.md) | **IT** | Minutes to send | B-07, and all call-centre work |
| 7 | [Credential rotation runbook](./07-credential-rotation-runbook.md) | **IT** | ~2h, plus a window | **B-06 — the only item where delay increases risk** |

---

## Two of these are more urgent than the rest

**Number 7 first.** It is the only item on any list where delay actively increases
risk rather than merely deferring work — credentials are exposed in a git history
and every day they stay valid is a day they could be used.

**Number 6 next**, because a vendor ticket has lead time and none exists yet.

Then number 1.

## Start with number 1 for everything else

It needs **two laptops and half an hour**. No iPads, no device management, none of
the new software.

It answers a binary question — does branch Wi-Fi let devices talk to each other —
and if the answer is no and cannot be changed, the hardware decision is settled
**today** rather than in month eight, before the software is built around an
assumption that turns out to be wrong.

That decomposition is deliberate. The full device-level test
(`spikes/lan-peer-sync/`) does need the till software and cannot run yet. The
network capability question underneath it does not, and it is the part that
actually decides the outcome.

## Number 3 next, because of lead time

Legal determinations take weeks. Nothing in the programme depends on that
instruction *starting*, and nothing can finish without it. Sending it is the
useful act; the answer can arrive later.

---

## What these are not

They are not a project plan, and they do not ask anyone to learn how the system
works. Each is written in the recipient's vocabulary, states plainly why they are
being asked, and ends with a table to complete.

If someone reads one and still does not know what to do, that is a defect in the
document — say so and it gets fixed.
