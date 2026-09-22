# Dispatch — who gets what, and what to say

The nine documents in this folder are written, fact-checked and bilingual. **None
has been sent.** This is the list that turns that around: one entry per document,
with the covering note to paste and what should come back.

**Nothing here is sent by engineering.** Four of these leave the company — to
banks, to legal counsel, to a tax authority and to a vendor — and go out over a
person's name, not a repository's. This file prepares them; a person sends them.

> **Fill in the sent column as you go.** A document that went out three weeks ago
> with no reply is a different problem from one that was never sent, and they look
> identical from here.

## Two documents must not be forwarded whole

**These are written for the person named at the top, not for the party they will
eventually reach**, and two of them say things that should not travel further:

- **2** carries a section headed *"Before sending — one thing to check
  internally"*, which states that card payments have never run and that our own
  records disagree about which provider is configured. It also carries our scoring
  weights. **Finance forwards sections A–E only** — the five `## Section …`
  headings and nothing after them. A previous version of this note said a
  provider-facing extract "exists as a separate file"; **it did not**, and Finance
  would have gone looking for something that was never in the repository.
- **6** is a document *about* a ticket. Only the `## Draft` block is the ticket.
  **Paste that block**; the material around it is guidance for the sender. A
  de-quoted, paste-ready copy is
  [`extracts/06-ticket-body.md`](./extracts/06-ticket-body.md), kept in step with
  the source by `req-lint`.

Everything else can go to its named recipient as it stands.

---

## Order, and why

Taken from [`README.md`](./README.md) rather than re-derived:

| | Document | Why now |
|---|---|---|
| **1st** | **8, step 1 only** | The only exposure reachable with a key that ships in a client bundle. A handful of SQL. The rest of 8 can wait for a decision; that step cannot |
| **2nd** | **9** | 78 customers asked for a human. 62 are still in live conversations. Needs no decision and no engineering — someone opening the inbox |
| **3rd** | **7** | Credentials sit in a git history. Every day they stay valid is a day they can be used |
| **4th** | **6** | A vendor ticket has lead time and none exists yet |
| **5th** | **3** | Legal determinations take weeks. Starting it is the useful act; the answer can arrive later |
| then | 1, 2, 4, 5 | Real, but none has a clock running on it the way the five above do |

---

## 1 · Branch network capability check → **IT**

*Internal. Attach the markdown or paste it.*

> **Subject:** Half-hour test at one branch — decides the till hardware standard
>
> This needs two laptops and about thirty minutes at one branch. No iPads, no
> device management, none of the new software.
>
> It answers one question: does the branch Wi-Fi let two devices talk directly to
> each other? If it does not and cannot be changed, every branch needs a small
> computer installed to coordinate the tills — a real cost, and a decision
> currently scheduled for month eight. This test can settle it this month instead.
>
> The document has the steps and a results table at the end. Please fill that in
> and send it back, including "we could not get branch access" if that is the
> answer — that is also a result.

**Comes back:** the results table. **Clears:** the network half of B-03 — the iPad
and printer half still needs a branch visit.

---

## 2 · Payment provider questionnaire → **Finance**, who sends it onward

*Leaves the company. **Send the provider extract, not this document** — see above.*

> **Subject:** Capability questions for payment providers — before we compare fees
>
> Attached are the questions to put to each candidate bank or payment provider.
> Please ask for written answers rather than a sales call, and for the technical
> documentation behind any "yes".
>
> Section A is the one that matters. It asks whether we can later ask a terminal
> what happened to a specific transaction. A provider who cannot do that forces a
> cashier to check a printed slip by hand every time a reader times out — a
> permanent daily cost in every branch that appears on no rate card.
>
> Two things worth knowing before you start: card payments have never actually run
> on our current setup — every live order to date has been cash — so there is
> nothing to migrate and no switching cost. And our own records disagree about
> which provider is even configured; confirming that is a ten-minute check worth
> doing first.

**Comes back:** written answers per provider, into the comparison table at the end
of the document. **Clears:** B-01 / D-1.

---

## 3 · Counsel brief, data residency → **Executive management**, who instructs counsel

*Leaves the company. Arabic version likely the one counsel wants — [`ar/03…`](./ar/03-counsel-brief-data-residency.md).*

> **Subject:** Instruction to counsel — where our data may legally be held
>
> This asks for one determination covering all twelve categories of data the new
> system will hold, rather than three rounds of partial answers. It describes what
> we hold and where; it does not attempt to give any legal view.
>
> The timing matters more than the speed. Nothing in the programme depends on this
> *starting*, and nothing can finish without it. An answer in three months is fine.
> An answer that has not been requested in three months is not.
>
> One fact in it is worth your attention before it goes: our current platform
> publishes seventeen regions and none is in the Kingdom or the Gulf, and all
> seventeen run on a provider that has no live Saudi region. So "just move it to a
> Saudi region" is not available to us. That is why the question is worth asking
> properly.

**Comes back:** a written determination per category. **Clears:** §1 of B-05 / D-4,
and answers Q-07.

---

## 4 · Tax invoicing — sandbox access and one decision → **Finance**

*The request leaves the company; the decision does not.*

> **Subject:** Two things on tax invoicing — one request, one decision
>
> **The request:** test-environment credentials, registered test device identities,
> test certificates and the current technical specification. Also, and with a long
> lead time, a specialist review of the invoicing design — worth commissioning
> early rather than doing thoroughly late.
>
> **The decision, which only the business can make:** a business customer asks for
> a tax invoice while the branch has no internet. A consumer invoice works offline;
> a business one cannot, because it must be cleared first and clearance needs the
> internet. Do we refuse and explain, take the order and issue the invoice when
> connectivity returns, or decline the sale? The document recommends the second
> with the first as fallback, but it is yours to decide — and it must be decided
> before staff are trained, because it determines what a cashier says at the
> counter during an outage.
>
> Worth knowing: half of this is already proved. The per-till counter and hash
> chain is built and tested. What credentials block is everything that requires
> talking to the authority.

**Comes back:** the option chosen, the cashier wording in both languages, and how
often this actually happens. **Clears:** B-02, answers Q-02.

---

## 5 · Cost comparison template → **whoever gathers quotes**

*Internal, though the quotes come from vendors.*

> **Subject:** Hosting and recovery costs — the shape to fill in
>
> Four options to price, not three. The fourth — running the same platform
> software ourselves on a Saudi cloud — was added because a comparison of only
> "stay as we are" and "rebuild from scratch" prices the two most expensive ends of
> the range and makes the decision look worse than it is.
>
> The document lists which Saudi providers are actually live today, so you know who
> to approach. Prices can be gathered now; they do not wait on the legal
> determination.
>
> The line most often understated is staff effort. Two of the four options mean
> someone here does the patching, backups and failover that our current platform
> does for us. Price that as salary, not as zero.

**Comes back:** the filled tables, and a note of any quote that could not be
obtained and why. **Clears:** §2 of B-05 (PRG-010, PRG-012).

---

## 6 · PBX support ticket → **IT**, who sends it to Yeastar

*Leaves the company. **Paste the `## Draft` block only**, and it stays English —
Yeastar's support works in English. Or send
[`extracts/06-ticket-body.md`](./extracts/06-ticket-body.md), which is that block
already de-quoted.*

> **Subject:** Please raise this with Yeastar support
>
> The evidence is already assembled from the diagnostic bundle, so this should take
> minutes rather than an afternoon of log reading. Confirm the serial we read out
> of the bundle, fill in the three bracketed fields — account, reseller, contact —
> check the facts against your records, and send.
>
> Where something is uncertain the document says so. Please say "we don't know"
> rather than guessing; a wrong detail costs more than a missing one.
>
> When it is sent, record the ticket reference against B-07. Until there is a
> reference, there is no ticket.

**Comes back:** a ticket reference, then Yeastar's analysis. **Clears:** B-07, and
unblocks all call-centre work.

---

## 7 · Credential rotation runbook → **IT**

*Internal. **Time-sensitive.***

> **Subject:** Credentials exposed in a repository — rotation, in order
>
> A diagnostic bundle committed to a private repository contains plaintext
> credentials. They are in git history, so deleting the file does not remove them.
> There is no evidence of misuse and no way to rule it out, which is why rotation
> is the answer rather than monitoring.
>
> The order in the document matters. Start with the SIP trunk credential: it
> authenticates us to the carrier, and unlike everything else on the list it can be
> abused without any access to our network. That is the standard toll-fraud route,
> and it is worth asking the carrier for a recent spend check while you are in
> touch with them.
>
> The extension passwords need a maintenance window and re-provisioning, so plan
> that rather than starting it mid-service.

**Comes back:** the rotation table completed. **Clears:** B-06.

---

## 8 · WhatsApp inbox exposure → **IT, with the Owner approving each step**

*Internal. **Step 1 is the most urgent item on this page.***

> **Subject:** One SQL statement to run first — then three decisions
>
> Step 1 closes a write path into a live AI's knowledge base that is reachable with
> the key that ships in the customer app's bundle. A wrong answer could be planted
> there, not merely read. It is four `revoke` statements and four `alter table`
> statements, with a verification query, and it does not delete anything.
>
> Please do step 1 today even if nothing else. Steps 3 and 4 need decisions —
> whether to rotate the secrets at Meta depends on who has held the service-role
> key, which is a question for the Owner rather than a technical one.
>
> This is a working system with customers on it. Assume anything you change is in
> use.

**Comes back:** the verification query output, and the completed table. **Clears:**
B-08.

---

## 9 · The inbox asked for help 165 times → **Owner / operations**

*Internal. **The only item on this page with customers waiting.***

> **Subject:** 78 customers asked for a person and nobody came
>
> The inbox AI hands a conversation to a human when it cannot answer. That works.
> Nobody is on the other end. It asked 165 times and wrote a note each time
> explaining why.
>
> **62 of the 78 are still live conversations.** Most of these people are still
> reachable and most still want what they asked for. The oldest has been waiting
> since 3 September, and six of them logged complaints.
>
> The first hour needs no decision from anyone: open the inbox and work the flagged
> conversations, newest first. Fixing the notification system is what stops the
> next 78 accumulating — it is not what gets these 78 an answer.
>
> There are two questions in the document that only a person can answer, and they
> decide what gets built. Neither is technical.

**Comes back:** the six complaints answered first, then the recent conversations,
plus answers to the two questions. **Clears:** B-09, answers Q-17.

---

## Record what went out

| | Document | To | Sent | Date | Reply received | Closed |
|---|---|---|---|---|---|---|
| 8 | Inbox exposure, step 1 | IT + Owner | ☐ | | ☐ | ☐ |
| 9 | Inbox backlog | Owner | ☐ | | ☐ | ☐ |
| 7 | Credential rotation | IT | ☐ | | ☐ | ☐ |
| 6 | PBX ticket | IT → Yeastar | ☐ | | ☐ | ☐ |
| 3 | Counsel brief | Exec → counsel | ☐ | | ☐ | ☐ |
| 1 | Network check | IT | ☐ | | ☐ | ☐ |
| 2 | Provider questionnaire | Finance → providers | ☐ | | ☐ | ☐ |
| 4 | Tax invoicing | Finance | ☐ | | ☐ | ☐ |
| 5 | Cost template | Quote gatherer | ☐ | | ☐ | ☐ |

**A document sent and not replied to is still blocking.** When the sent box is
ticked and the reply box is not, the blocker in [`../blocked.md`](../blocked.md)
stays open and the entry should say who it is waiting on and since when.
