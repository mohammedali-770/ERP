# Documentation

| Directory | Contents |
|---|---|
| [`requirements/`](./requirements) | The 387-requirement baseline, generated from the source PRD, plus hand-maintained ownership annotations and a register of **proposed** requirements originating outside the PRD |
| [`architecture/`](./architecture) | Layered overview, the invariants every design must preserve, and the core transactional design |
| [`adr/`](./adr) | Architecture decision records, including all twelve of the PRD's open decisions |
| [`estate/`](./estate) | What already exists, what to absorb, what to supersede |
| [`domain/`](./domain) | Bounded contexts, canonical model, event catalogue, ledger primitives, snapshot rules |
| [`compliance/`](./compliance) | ZATCA, personal data, the residency gate, security controls |
| [`lab/`](./lab) | HQ lab design, hardware decision matrix, acceptance test plan, evidence template |
| [`program/`](./program) | Roadmap, F0 exit criteria, governance, blocked work, open questions |
| [`source/`](./source) | The source PRD, vendored so extraction is reproducible |

## Conventions

- **English prose, bilingual requirement data.** Engineering documents are English
  by owner decision; the requirement catalogue carries Arabic and English, as
  PRG-014 requires.
- **Generated files say so** in their first lines and must not be hand-edited.
- **Requirement identifiers are stable** (PRG-015). A revised requirement is
  versioned, never silently replaced, and CI fails if one disappears from an
  approved baseline.
- **Open questions are recorded, not guessed.** Anything unverified is in
  [`program/open-questions.md`](./program/open-questions.md) rather than stated as
  fact.
