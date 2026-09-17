# F0 exit criteria

The checklist that gates F1 build. F0 is complete when every line is true —
not when the calendar says month 2.

Run `npm run req:lint -- --gate f0-exit` to check the mechanical items.

---

## Requirements baseline

- [x] All 387 requirements extracted reproducibly from the source PRD
- [x] Phase distribution verified: F0 33 · F1 164 · F2 19 · F3 37 · F4 81 · F5 49 · F6 2 · Future 2
- [x] Every requirement carries both languages (PRG-014)
- [x] Requirement IDs unique, and stability enforced in CI (PRG-015)
- [x] Every F1/P0 requirement names an owner and an acceptance test
- [ ] **Owners have confirmed their assignments** — currently seeded, not confirmed (Q-12)
- [x] Baseline frozen: [`baseline.txt`](../requirements/baseline.txt) written — 387 identifiers, enforced in CI

## Architecture

- [x] Layered overview with bounded contexts named and owned
- [x] Invariants recorded, each tied to the requirements demanding it
- [x] Core transactional design addressing R-02 (the Critical risk)
- [x] Deterministic conflict rules for all five contested entities (OFF-008)
- [ ] **ADR-0003 (event-sourced core) accepted or rejected** — must be decided in month 1, not drifted into
- [ ] Architecture reviewed and approved by the Product Owner

## Decisions

- [x] All twelve PRD open decisions (OPN-001..012) mapped to ADRs
- [x] ADR coverage enforced in CI
- [ ] Hosting and residency gate criteria agreed (ADR-0002) — **blocks production, not F1**
- [ ] Tiered cost options prepared (PRG-010)
- [ ] RPO/RTO tiers costed for executive selection (PRG-012, ADR-0009)

## Risk retirement

- [x] Spike harnesses built with numeric pass/fail gates
- [x] Each harness carries a control case proving it detects the failure it tests
- [ ] **`lan-peer-sync` executed on a real branch network** (B-03) — can force the hardware decision
- [ ] **`ios-durability` executed on real devices**
- [x] `offline-sync` sustained-load run passed — zero lost, zero duplicated at 245/h per branch
- [x] `print-queue` run passed — no lost kitchen slips, no silent duplicate invoice
- [x] `shift-conflict` run passed — 7/7 properties hold
- [ ] **ADR-0004 hardware decision evidenced** (OFF-014 forbids approving hardware without this)

## Estate

- [x] Inventory of every Supabase project and repository
- [x] Migration map classifying every asset
- [x] Lazywait surface documented endpoint by endpoint
- [x] SMA absorption planned module by module
- [ ] Warehouse system database identified (B-04, Q-08)
- [ ] Current payment provider state confirmed (Q-09)

## Compliance

- [x] ZATCA plan with the offline B2B constraint surfaced
- [x] PDPL assessment scope and personal-data inventory
- [x] Residency gate criteria and evidence checklist
- [x] Security control matrix mapping SEC-001..015
- [ ] Specialist ZATCA review commissioned (PAY-019)
- [ ] Privacy advice obtained on cross-brand customer identity (Q-07)

## Lab

- [x] Lab design specified (LAB-001..005)
- [x] Hardware decision matrix with the measurements that decide it
- [x] T-01..T-10 expanded into executable specifications
- [x] Evidence package template
- [ ] Lab physically built and accepting test traffic
- [ ] Representative cashier and kitchen users identified for UAT

## Governance

- [x] Change-control rules adopted
- [x] Review requirements by change type
- [x] Blocked list and open questions maintained
- [ ] Process owners appointed per domain (PRD §3.2)
- [x] **B-01 put to executive management** with its lead time stated — [`executive-decision-pack.md`](./executive-decision-pack.md) D-1

---

## The three that actually gate F1

Everything above matters. These three stop F1 if unresolved:

1. **ADR-0003 decided.** Event-sourced or not. A half-event-sourced system is worse
   than either, and the choice cannot be deferred past month 1.
2. **ADR-0004 evidenced.** The hardware standard, decided by spike results rather
   than preference. OFF-014 is explicit about this.
3. **B-01 escalated.** Not resolved — escalated. If executive management knows the
   cost and chooses to wait, that is a decision. Discovering it in month 7 is not.

All three are presented for decision in
[`executive-decision-pack.md`](./executive-decision-pack.md), as D-2, D-3 and D-1
respectively.
