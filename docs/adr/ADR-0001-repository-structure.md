# ADR-0001 — Repository structure

- **Status:** Accepted
- **Date:** 2026-09-17
- **PRD decisions:** OPN-005 · PRG-009
- **Deciders:** Product Owner

## Context

PRG-009 defers repository organisation until after architecture design, and
requires that the result support independent deployment where operational risk
demands it. The PRD names payments, printing, synchronisation and AI as the
high-risk components needing clear isolation and ownership.

The team is small and AI-assisted. The existing estate (`SMA`) is already a
single monorepo holding a mobile app, a web console and the complete backend
definition, and it works — 185 tests and nine CI workflows across one repo.

## Decision

**A single monorepo with enforced service boundaries.**

- `packages/contracts` holds shared types and schemas; everything else depends on
  it and nothing depends on an application.
- `services/*` are separate workspaces with their own `package.json`, so a service
  can be extracted to its own deployment unit — or its own repository — without
  restructuring its callers.
- `apps/*` are delivery surfaces (POS, management console) and hold no domain logic.
- `spikes/*` are throwaway proving code, excluded from production builds.

Boundaries are enforced by `tools/boundary-check`, which parses every import in
the repository and fails CI on a violation. It is a check, not a convention:
a service that reaches into another service's internals breaks the build.

TypeScript project references were considered for this and rejected. Node 22 runs
the TypeScript sources directly by stripping types, so there is no emit step for
references to hang off; adding one purely to police imports would mean maintaining
a build pipeline the runtime does not use. An explicit check is both simpler and
more honest about what is actually enforced.

## Consequences

- One clone, one install, one CI run. Refactoring across a boundary stays a single
  reviewable change, which matters while boundaries are still moving.
- Independent deployment stays available without being paid for now.
- The monorepo will eventually need build caching. That is a tooling problem with
  known answers, and is cheaper than premature repository splitting.
- **Risk:** monorepos erode boundaries under deadline pressure. `npm run boundary:check`
  is the guard, and it runs in CI.

## Alternatives

**Repository per service.** Maximum isolation, rejected for now: coordination cost
across ~6 repositories during the foundation phase outweighs the benefit while the
boundaries are still being discovered.

**Single deployable, no internal boundaries.** Simplest, rejected: it reserves no
isolation for exactly the components the PRD says must be isolated.
