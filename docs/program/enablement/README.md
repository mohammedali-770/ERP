# Enablement pack

Nine short documents, each addressed to a **specific person outside engineering**,
each ending with something they fill in and hand back.

They exist because the programme is currently waiting on decisions and access
rather than on code. These convert that waiting into work that can happen in
parallel — and none of them depends on a decision being taken first.

---

| | Document | Who acts | Time for them | What it unblocks |
|---|---|---|---|---|
| 1 | [Branch network capability check](./01-network-capability-check.md) | **IT** | ~30 min | **B-03** — and may decide the hardware standard outright (D-3) |
| 2 | [Payment provider questionnaire](./02-acquirer-questionnaire.md) | **Finance** | Send and wait | **B-01 / D-1** — makes the provider decision a comparison |
| 3 | [Counsel brief — data residency](./03-counsel-brief-data-residency.md) | **Executive → legal** | Instruct now, weeks to answer | **B-05 / D-4** — §1 of the residency gate |
| 4 | [Tax invoicing — sandbox and one decision](./04-zatca-sandbox-request.md) | **Finance** | Days, plus one decision | **B-02** — offline invoicing evidence |
| 5 | [Cost comparison template](./05-cost-comparison-template.md) | **Whoever gathers quotes** | Ongoing | **B-05** — §2 of the residency gate (PRG-010, PRG-012) |
| 6 | [PBX vendor support ticket](./06-pbx-vendor-ticket.md) | **IT** | Minutes to send | B-07, and all call-centre work |
| 7 | [Credential rotation runbook](./07-credential-rotation-runbook.md) | **IT** | ~2h, plus a window | **B-06 — delay increases risk** |
| 8 | [Closing the WhatsApp inbox exposure](./08-inbox-exposure-remediation.md) | **IT, Owner approving** | ~45 min for the urgent half | **B-08 — a live write path reachable with a public key** |
| 9 | [The inbox asked for help 165 times](./09-inbox-backlog-triage.md) | **Owner / operations** | Ten minutes to read | **B-09 and Q-17 — 78 customers waiting** |

---

## Four of these are more urgent than the rest

**Number 8, step 1, first.** It is a handful of SQL statements and it closes the
only exposure on any list that is reachable with a key that ships in a client
bundle — a write path into a live AI's knowledge base, where a wrong answer could
be *planted* rather than merely read. The rest of number 8 can wait for a
decision; that step cannot.

**Number 7 next.** Credentials are exposed in a git history and every day they
stay valid is a day they could be used.

**Number 6 after that**, because a vendor ticket has lead time and none exists yet.

Then number 1.

> **Number 9 is the one with people waiting.** When B-09 was raised this document
> said it deliberately had none, on the reasoning that no SQL closes it and it
> needed Q-17 answered first. That was half right: there is nothing to hand *IT*.
> But the Owner can act without Q-17 — 62 of those conversations are still live
> and can be worked today — so writing nothing left the only blocker whose cost
> falls on customers as the only one with no document. Number 9 fixes that, and
> asks Q-17 as two questions rather than waiting on it.

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

## Every blocker that has one now points back

Checked 2026-09-21. `blocked.md` linked five of these; four were invisible from
the entry someone would actually read. B-01 named the decision pack but not the
questionnaire, B-02 named neither, and B-05 was six lines that never mentioned a
drafted counsel brief and a costed-options template sitting in this folder. All
four now carry a **Ready to send** line, and every document here names what it
unblocks — so the pack navigates in both directions rather than one.

**B-04 is the only blocker with no document here, and correctly so.** Identifying
the warehouse database is one variable read out of a deployed bundle, not a task
worth a page.

---

## What these are not

They are not a project plan, and they do not ask anyone to learn how the system
works. Each is written in the recipient's vocabulary, states plainly why they are
being asked, and ends with a table to complete.

If someone reads one and still does not know what to do, that is a defect in the
document — say so and it gets fixed.
