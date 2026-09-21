# Hosting and recovery — cost comparison template

**For:** whoever gathers quotes
**Unblocks:** B-05 — §2 of the data residency gate, the costed options
**Satisfies:** `PRG-010` (tiered cost options before any infrastructure
commitment) and `PRG-012` (recovery targets selected from costed tiers)

The structure to fill in as quotes arrive. Filling it is the work; the shape is
here so nobody has to invent it under time pressure.

---

## Two decisions, and they interact

**Where** the system runs, and **how much loss** is acceptable when something
fails. A cheap hosting option with an expensive recovery requirement may cost more
than the reverse, so they are costed together.

---

## Part 1 · Where it runs

Three options to price. The choice depends on a legal determination that has been
requested separately — but **the prices can be gathered before the answer
arrives**, and should be.

| | Option | Shape | Residency |
|---|---|---|---|
| **A** | Stay as-is | Current managed platform, Europe or Asia region | Outside the Kingdom |
| **B** | In-Kingdom | Self-managed database and services, Saudi cloud provider | Inside |
| **C** | Split | Regulated categories in the Kingdom, the rest as-is | Mixed |

### Per option, price these

| Line | A | B | C |
|---|---|---|---|
| Platform or hosting, monthly | | | |
| Database, monthly | | | |
| Storage, monthly, and growth per year | | | |
| Data transfer | | | |
| Backup storage | | | |
| Monitoring and logging | | | |
| **Recurring subtotal, monthly** | | | |
| One-off setup | | | |
| **Staff effort to operate, days per month** | | | |
| **Three-year total** | | | |

> **The line most often understated is staff effort.** Option A includes
> operational work the platform does for us — patching, backups, failover,
> scaling. Option B means someone does that work. Price it as salary, not as
> zero.

### The migration line, priced honestly

Moving **from** option A **to** B or C is not a database export. Price each
separately:

| Item | Estimate |
|---|---|
| Moving the data itself | Usually days |
| Re-implementing scheduled jobs the platform currently runs | |
| Re-implementing secret storage and rotation | |
| Rebuilding the permission model, **and re-verifying it is correct** | |
| Re-testing everything end to end | |
| **Migration total** | |

> The permission-model line is the one to scrutinise. Rebuilding it is
> straightforward; proving the rebuild is correct, for a system holding payroll
> and financial records, is not.

---

## Part 2 · How much loss is acceptable

Two numbers, in plain terms:

- **How much recent data could we afford to lose** if the central system failed?
- **How long could it be unavailable** before the business is seriously harmed?

### Something that makes the cheaper tiers more defensible than usual

**Branches keep trading with no central connection.** Tills, printing, cash and
shift handling all work offline and synchronise afterwards. So a central outage
does not stop sales.

What it does stop is management reporting, cross-branch functions and
integrations. That is real, but it is a different kind of harm from "the tills
stopped", and the tier chosen should reflect that rather than buying protection
against a failure the design already absorbs.

### Tiers to price

| | Data loss | Downtime | Shape | Monthly cost | Effort to prove it works |
|---|---|---|---|---|---|
| **1** | Up to 24h | Up to 8h | Daily backup, manual restore | | |
| **2** | Up to 1h | Up to 1h | Point-in-time recovery, scripted restore | | |
| **3** | Up to 5 min | Up to 15 min | Point-in-time plus warm standby | | |
| **4** | Near zero | Minutes | Multi-region with automatic failover | | |

### The column people forget

**Effort to prove it works.** A backup that has never been restored is not a
backup — it is an assumption. Every tier needs a scheduled restore exercise with a
recorded result, and that recurring effort is part of its cost.

---

## Part 3 · What goes to executives

One page:

1. The three hosting options with three-year totals, migration cost shown separately
2. The four recovery tiers with monthly costs
3. A recommendation, with its reasoning
4. **What is still unknown** — stated rather than smoothed over

---

## Note on sequencing

The hosting decision needs the legal determination. **The prices do not.** Gather
them now, so that when the determination arrives the decision takes a meeting
rather than a quarter.

---

*Background: `docs/adr/ADR-0002`, `docs/adr/ADR-0009`,
`docs/compliance/data-residency-gate.md`.*
