# Tax invoicing — sandbox access and one business decision

**For:** Finance
**Two separate things are needed.** One is a request. One is a decision only the
business can make.

> This describes what the system is designed to do so the right access can be
> requested. **It is not tax advice.** The design must be validated against the
> current official specification by a specialist before certification — that
> review is itself listed below.

---

## Part 1 · Sandbox access *(a request)*

The system must issue compliant electronic invoices, including while a branch has
no internet connection, and submit them once connectivity returns. **None of that
can be tested without test-environment access.**

### What to request

| | Item | Why |
|---|---|---|
| 1 | Test-environment credentials | To submit invoices without affecting live records |
| 2 | Registered test device identities | Each till is registered separately — see below |
| 3 | Test cryptographic certificates | Each till signs its own invoices |
| 4 | Current technical specification | The design must be validated against today's rules, not an older version |

### One design point worth knowing when you ask

**Each till is registered as its own invoicing unit**, rather than one registration
per branch shared between tills.

The reason is practical: each unit keeps its own invoice counter that must never
skip a number. If three tills shared one counter they would have to agree with
each other on every single sale — impossible when the internet is down, which is
exactly when the system must keep working.

This also means the number of registrations needed scales with tills, not
branches. Worth confirming when access is requested.

### Also needed, and it has a long lead time

**A specialist review of the invoicing design** against the current official
specification, before certification. Commissioning it early is worth more than
doing it thoroughly late.

---

## Part 2 · A decision only Finance can make

### The situation

There are two kinds of tax invoice, and they behave differently when the internet
is down:

| | Consumer invoice | Business invoice |
|---|---|---|
| Typical customer | Walk-in, delivery | A company buying for its business |
| Approval | Reported **afterwards**, within 24 hours | Must be cleared **before** it is issued |
| **Works offline?** | **Yes** | **No — clearance has to happen first** |

Consumer invoices working offline is what makes the whole offline design lawful.
Business invoices cannot work the same way, because approval must come first and
approval needs the internet.

### The question

**A business customer asks for a tax invoice while the branch has no internet. What
happens?**

There are three workable answers:

| | Option | What the customer experiences | Cost |
|---|---|---|---|
| **A** | **Refuse, explain, offer a consumer receipt** | Told the tax invoice will follow once systems are back, and given contact details | Simplest to build. Customer may be unhappy at the counter |
| **B** | **Take the order, issue the invoice automatically when connectivity returns** | Leaves with a receipt, gets the tax invoice by message or email later | More to build. A promise the system must keep |
| **C** | **Decline the sale entirely** | Cannot buy | Simplest of all, and the worst outcome |

**Recommendation: B, with A as the immediate fallback** — take the money, keep the
customer, issue the document when possible, and tell them clearly at the counter
that is what will happen.

What matters more than which option: **it must be decided before staff are
trained**, because it determines what a cashier says to a business customer during
an outage. Left undecided, each cashier will improvise differently.

### What is needed back

1. Which option, A, B or C.
2. The wording a cashier should use. Arabic and English.
3. How often this actually happens today — if business customers are rare during
   outages, option A costs almost nothing.

---

## Summary

| | Action | Owner | Lead time |
|---|---|---|---|
| 1 | Request sandbox credentials and test device identities | Finance | Days |
| 2 | Commission the specialist design review | Finance | **Weeks — start now** |
| 3 | Decide the business-invoice-during-outage question | Finance | An hour, once considered |

Until 1 is done, the offline invoicing design stays unproven and one of the
executive acceptance criteria cannot be evidenced.

---

*Background: `docs/adr/ADR-0006`, `docs/compliance/zatca-plan.md`,
`docs/program/blocked.md` B-02, `docs/program/open-questions.md` Q-02.*
