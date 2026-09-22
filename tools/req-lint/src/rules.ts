/**
 * Traceability rules enforced in CI.
 *
 * These exist so the requirement baseline stays trustworthy without depending on
 * anyone remembering to check it. Each rule maps to a stated PRD obligation.
 */
import type { Requirement } from '../../prd-extract/src/extract.ts';
import type { Node } from '../../prd-extract/src/yaml.ts';

export interface Finding {
  rule: string;
  severity: 'error' | 'warning';
  requirement: string | null;
  message: string;
}

export interface LintContext {
  requirements: Requirement[];
  annotations: Record<string, Record<string, Node>>;
  adrIds: Set<string>;
  /** Requirement IDs frozen by a previous approved baseline, if one exists. */
  baseline: Set<string> | null;
  /** Concatenated text of every ADR, used to check that decisions are referenced. */
  adrCorpus: string;
}

const list = (v: Node | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

/** PRG-015: IDs are stable after approval; changed wording is versioned, not silently replaced. */
export function ruleStableIds(ctx: LintContext): Finding[] {
  if (!ctx.baseline) return [];
  const current = new Set(ctx.requirements.map((r) => r.id));
  const findings: Finding[] = [];
  for (const id of ctx.baseline) {
    if (!current.has(id)) {
      findings.push({
        rule: 'stable-ids',
        severity: 'error',
        requirement: id,
        message: `${id} was in the approved baseline but is absent from the catalogue. PRG-015 requires a versioned revision, not removal.`,
      });
    }
  }
  return findings;
}

export function ruleUniqueIds(ctx: LintContext): Finding[] {
  const seen = new Map<string, number>();
  for (const r of ctx.requirements) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([id, n]) => ({
      rule: 'unique-ids',
      severity: 'error' as const,
      requirement: id,
      message: `${id} appears ${n} times in the catalogue.`,
    }));
}

export function ruleBilingual(ctx: LintContext): Finding[] {
  const findings: Finding[] = [];
  for (const r of ctx.requirements) {
    if (!r.text_en) findings.push({ rule: 'bilingual', severity: 'error', requirement: r.id, message: `${r.id} has no English text (PRG-014).` });
    if (!r.text_ar) findings.push({ rule: 'bilingual', severity: 'error', requirement: r.id, message: `${r.id} has no Arabic text (PRG-014).` });
  }
  return findings;
}

/**
 * Every ADR referenced by a requirement must exist on disk. A dangling reference
 * is worse than no reference: it reads as a decision that was made.
 */
export function ruleAdrRefsResolve(ctx: LintContext): Finding[] {
  const findings: Finding[] = [];
  for (const [id, ann] of Object.entries(ctx.annotations)) {
    for (const ref of list(ann['adr_refs'])) {
      if (!ctx.adrIds.has(ref)) {
        findings.push({ rule: 'adr-refs-resolve', severity: 'error', requirement: id, message: `${id} references ${ref}, which has no file in docs/adr/.` });
      }
    }
  }
  return findings;
}

/**
 * F0 exit gate: every F1/P0 requirement must name an owner and at least one
 * acceptance-test reference before F1 build starts. Reported as warnings until
 * the gate is declared, so the catalogue can be committed while ownership is
 * still being assigned. `--gate f0-exit` promotes them to errors.
 */
export function ruleF1Coverage(ctx: LintContext, gateActive: boolean): Finding[] {
  const severity = gateActive ? 'error' : 'warning';
  const findings: Finding[] = [];
  for (const r of ctx.requirements) {
    if (r.phase !== 'F1' || r.priority !== 'P0') continue;
    const ann = ctx.annotations[r.id] ?? {};
    if (!ann['owner']) {
      findings.push({ rule: 'f1-coverage', severity, requirement: r.id, message: `${r.id} (F1/P0) has no owner.` });
    }
    if (list(ann['test_refs']).length === 0) {
      findings.push({ rule: 'f1-coverage', severity, requirement: r.id, message: `${r.id} (F1/P0) has no acceptance-test reference.` });
    }
  }
  return findings;
}

/**
 * Every test reference must resolve to something that exists.
 *
 * The F0 exit gate requires each F1/P0 requirement to name an acceptance test.
 * Without this rule that check is satisfied by *any* non-empty string, which is
 * exactly what happened: thirteen of twenty-three references — every `SPIKE-*`
 * and every `UAT-*` — pointed at nothing, and the gate passed anyway.
 *
 * A requirement whose test reference resolves to nothing is an untested
 * requirement wearing the appearance of a tested one, which is worse than an
 * obviously untested one.
 */
export interface TestArtifacts {
  /** Scenario identifiers defined in the acceptance test plan. */
  readonly scenarios: ReadonlySet<string>;
  /** Spike directory names that exist on disk. */
  readonly spikes: ReadonlySet<string>;
  /**
   * Spikes that can actually be run — those with a harness. The rest are
   * procedures written for a person to carry out against hardware, and cannot
   * produce evidence until someone does.
   */
  readonly executableSpikes: ReadonlySet<string>;
  /** UAT pack names that exist on disk. */
  readonly uatPacks: ReadonlySet<string>;
}

export function ruleTestRefsResolve(ctx: LintContext, artifacts: TestArtifacts): Finding[] {
  const findings: Finding[] = [];

  for (const [requirementId, ann] of Object.entries(ctx.annotations)) {
    for (const ref of list(ann['test_refs'])) {
      let resolves: boolean;
      let expected: string;

      if (ref.startsWith('SPIKE-')) {
        resolves = artifacts.spikes.has(ref.slice('SPIKE-'.length));
        expected = `a directory under spikes/`;
      } else if (ref.startsWith('UAT-')) {
        resolves = artifacts.uatPacks.has(ref.slice('UAT-'.length));
        expected = `a pack under docs/lab/uat/`;
      } else if (/^T-\d{2}$/.test(ref)) {
        resolves = artifacts.scenarios.has(ref);
        expected = `a scenario in docs/lab/test-plan.md`;
      } else {
        findings.push({
          rule: 'test-refs-resolve', severity: 'error', requirement: requirementId,
          message: `${requirementId} references "${ref}", which is not a recognised form. Use T-NN, SPIKE-<name> or UAT-<name>.`,
        });
        continue;
      }

      if (!resolves) {
        findings.push({
          rule: 'test-refs-resolve', severity: 'error', requirement: requirementId,
          message: `${requirementId} references "${ref}", which does not resolve to ${expected}.`,
        });
      }
    }
  }
  return findings;
}

/**
 * A reference that resolves is not the same as evidence that exists.
 *
 * `ruleTestRefsResolve` checks that a test reference points at something real.
 * It does not check that the something can produce a result. Two of the spikes
 * are procedures rather than harnesses — they test physical properties of the
 * branch network and of iOS, which a simulation would not prove — so they run
 * only when someone has the hardware, and until then they yield nothing.
 *
 * Five requirements named those two procedures as their ONLY acceptance test,
 * and so counted toward a satisfied F0 gate while being untested by that gate's
 * own definition. That is the same failure `ruleTestRefsResolve` was written to
 * catch, one level up: a requirement wearing the appearance of a tested one.
 *
 * Reported as a warning day to day, because the requirement is correctly
 * specified and the gap is a blocker rather than a mistake. Promoted to an error
 * under `--gate f0-exit`, because the gate's question is whether F1 build may
 * start, and the honest answer for these is not yet.
 */
export function ruleEvidenceIsProducible(
  ctx: LintContext,
  artifacts: TestArtifacts,
  gateActive: boolean,
  blockedBy: string,
): Finding[] {
  const severity = gateActive ? 'error' : 'warning';
  const findings: Finding[] = [];

  for (const [requirementId, ann] of Object.entries(ctx.annotations)) {
    const refs = list(ann['test_refs']);
    if (refs.length === 0) continue;

    const procedures = refs.filter(
      (ref) =>
        ref.startsWith('SPIKE-') &&
        artifacts.spikes.has(ref.slice('SPIKE-'.length)) &&
        !artifacts.executableSpikes.has(ref.slice('SPIKE-'.length)),
    );
    if (procedures.length !== refs.length) continue;

    findings.push({
      rule: 'evidence-is-producible',
      severity,
      requirement: requirementId,
      message:
        `${requirementId} is evidenced only by ${procedures.join(', ')}, which are procedures with no harness ` +
        `and cannot run until ${blockedBy} lifts. It has no acceptance evidence and no way to get any.`,
    });
  }
  return findings;
}

/**
 * The converse check: every artifact built to prove something must be named by
 * something it proves.
 *
 * `ruleTestRefsResolve` catches a reference pointing at nothing. Nothing caught
 * the opposite — a spike or a UAT pack that no requirement references — so three
 * spikes and nine packs could be built, run in CI, and traced to no obligation
 * at all. An unreferenced artifact is work whose purpose is recorded only in the
 * memory of whoever built it.
 */
export function ruleArtifactsAreReferenced(
  ctx: LintContext,
  artifacts: TestArtifacts,
  extraRefs: readonly string[] = [],
): Finding[] {
  const referenced = new Set<string>(extraRefs);
  for (const ann of Object.values(ctx.annotations)) {
    for (const ref of list(ann['test_refs'])) referenced.add(ref);
  }

  const findings: Finding[] = [];
  for (const spike of artifacts.executableSpikes) {
    if (!referenced.has(`SPIKE-${spike}`)) {
      findings.push({
        rule: 'artifacts-are-referenced', severity: 'warning', requirement: null,
        message: `spikes/${spike} is run in CI but no requirement names it. What does it prove?`,
      });
    }
  }
  for (const pack of artifacts.uatPacks) {
    if (!referenced.has(`UAT-${pack}`)) {
      findings.push({
        rule: 'artifacts-are-referenced', severity: 'warning', requirement: null,
        message: `docs/lab/uat/${pack}.md exists but no requirement names it.`,
      });
    }
  }
  return findings;
}

/**
 * Every risk identifier cited in a document must exist in the register.
 *
 * `R-02 (Critical)` is quoted as the reason the offline-sync spike exists, and
 * similar citations appear in eight files. Until the register was extracted from
 * the PRD they resolved to nothing in this repository, and the `R-` prefix was on
 * the list of things the citation rule deliberately ignores — so this was the one
 * class of cross-reference that nothing checked.
 */
export function ruleRiskCitationsResolve(
  citations: ReadonlyArray<{ file: string; id: string }>,
  riskIds: ReadonlySet<string>,
): Finding[] {
  if (riskIds.size === 0) return [];
  return citations
    .filter((c) => !riskIds.has(c.id))
    .map((c) => ({
      rule: 'risk-citations-resolve',
      severity: 'error' as const,
      requirement: c.id,
      message: `${c.file} cites ${c.id}, which is not in the risk register (docs/program/risk-register.md).`,
    }));
}

/**
 * The proposed register must be well formed, and its identifiers must never
 * collide with the approved baseline.
 *
 * A proposed requirement carries no authority. If one could take an identifier
 * that an approved requirement already uses — or that a future PRD revision would
 * assign — a reader could mistake a proposal for a decision, which is precisely
 * what the separate `<MODULE>-P<NN>` form exists to prevent.
 */
export interface ProposedEntry {
  id: string;
  module: string;
  text_en: string;
  text_ar: string;
  owner?: string;
  test_refs?: string[];
}

export function ruleProposedRegister(
  ctx: LintContext,
  proposed: readonly ProposedEntry[] | null,
): Finding[] {
  if (proposed === null) return [];
  const findings: Finding[] = [];
  const approved = new Set(ctx.requirements.map((r) => r.id));
  const seen = new Set<string>();

  for (const p of proposed) {
    if (!PROPOSED_ID.test(p.id)) {
      findings.push({ rule: 'proposed-register', severity: 'error', requirement: p.id,
        message: `${p.id} is not a valid proposed identifier. Use <MODULE>-P<NN>, which cannot collide with an approved requirement.` });
      continue;
    }
    // Unreachable while approved identifiers are always <MODULE>-<NNN> and
    // proposed ones <MODULE>-P<NN>, since the format check above already rejects
    // anything else. Kept deliberately: if the approved format ever widens, this
    // is what stops a proposal quietly occupying an approved identifier, and the
    // cost of keeping it is one set lookup.
    if (approved.has(p.id)) {
      findings.push({ rule: 'proposed-register', severity: 'error', requirement: p.id,
        message: `${p.id} collides with an approved requirement. A proposal must never occupy an approved identifier.` });
    }
    if (seen.has(p.id)) {
      findings.push({ rule: 'proposed-register', severity: 'error', requirement: p.id,
        message: `${p.id} appears more than once in the proposed register.` });
    }
    seen.add(p.id);
    if (!p.text_en) findings.push({ rule: 'proposed-register', severity: 'error', requirement: p.id, message: `${p.id} has no English text (PRG-014).` });
    if (!p.text_ar) findings.push({ rule: 'proposed-register', severity: 'error', requirement: p.id, message: `${p.id} has no Arabic text (PRG-014).` });
  }
  return findings;
}

/** `<MODULE>-P<NN>` — the proposed identifier form. */
export const PROPOSED_ID = /^[A-Z]{2,4}-P\d{2}$/;

/**
 * Every requirement identifier cited in a document must exist in the catalogue.
 *
 * A citation to a requirement that does not exist reads as though the design is
 * grounded in an obligation nobody actually wrote down. This rule was added after
 * a real instance: the print design cited PRN-019 for the reprint label, but that
 * requirement is POS-019 — PRN stops at 015.
 */
export function ruleCitationsResolve(
  ctx: LintContext,
  citations: ReadonlyArray<{ file: string; id: string }>,
  proposedIds: ReadonlySet<string> = new Set(),
): Finding[] {
  const known = new Set(ctx.requirements.map((r) => r.id));
  return citations
    .filter((c) => !known.has(c.id) && !proposedIds.has(c.id))
    .map((c) => ({
      rule: 'citations-resolve',
      severity: 'error' as const,
      requirement: c.id,
      message: `${c.file} cites ${c.id}, which is in neither the requirement catalogue nor the proposed register.`,
    }));
}

/**
 * Every F1 requirement must appear in the F1 backlog.
 *
 * The backlog claims complete coverage. Without a check, that claim decays the
 * first time a requirement is added or an epic is reshaped, and a requirement
 * silently belonging to no epic is one nobody is building.
 */
export function ruleF1BacklogCoverage(ctx: LintContext, backlog: string | null): Finding[] {
  if (backlog === null) return [];
  return ctx.requirements
    .filter((r) => r.phase === 'F1')
    .filter((r) => !backlog.includes(r.id))
    .map((r) => ({
      rule: 'f1-backlog-coverage',
      severity: 'error' as const,
      requirement: r.id,
      message: `${r.id} (F1) does not appear in the F1 backlog — it belongs to no epic.`,
    }));
}

/**
 * Every PRD open decision (OPN-*) must map to an ADR that records how it was closed.
 *
 * An error rather than a warning, because `cli.ts` exits non-zero only on errors
 * and CLAUDE.md lists this rule under "things that are enforced, not suggested".
 * As a warning it could never fail, so the claim was false.
 */
export function ruleOpenDecisionsHaveAdrs(ctx: LintContext, openDecisionIds: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const opn of openDecisionIds) {
    if (!ctx.adrCorpus.includes(opn)) {
      findings.push({ rule: 'open-decisions-have-adrs', severity: 'error', requirement: opn, message: `${opn} is not referenced by any ADR in docs/adr/.` });
    }
  }
  return findings;
}

/** One `verbatim-from` marker: a block that must still match the source it was copied from. */
export interface VerbatimClaim {
  /** The file carrying the marker, for the message. */
  file: string;
  /** The source the marker names, as written, for the message. */
  source: string;
  /** Lines in `file` that claim to be a copy. */
  claimed: string[];
  /**
   * The source section's lines, already de-quoted when the marker says `dequoted`,
   * or null when the source file or its section could not be found.
   */
  actual: string[] | null;
}

/**
 * A block copied from another document must still match it.
 *
 * Written because it did not. `06-pbx-vendor-ticket.md` carries a support ticket
 * that stays in English inside an otherwise-Arabic mirror, and is also extracted
 * de-quoted for pasting. A correction on 2026-09-21 rewrote the English evidence
 * section and left the Subject and Summary of all three copies asserting a fault
 * that belonged to a different year. Nothing caught it, because nothing checked
 * that the copies still agreed with their source.
 *
 * An error, not a warning: the copies are what actually leave the company.
 */
export function ruleVerbatimBlocksMatchSource(claims: ReadonlyArray<VerbatimClaim>): Finding[] {
  const findings: Finding[] = [];
  for (const c of claims) {
    if (c.actual === null) {
      findings.push({
        rule: 'verbatim-blocks-match-source', severity: 'error', requirement: null,
        message: `${c.file} declares verbatim-from ${c.source}, which names no section that exists.`,
      });
      continue;
    }
    if (c.claimed.length === 0) {
      findings.push({
        rule: 'verbatim-blocks-match-source', severity: 'error', requirement: null,
        message: `${c.file} declares verbatim-from ${c.source} but carries no block to compare.`,
      });
      continue;
    }
    const n = Math.max(c.claimed.length, c.actual.length);
    for (let i = 0; i < n; i++) {
      const got = c.claimed[i];
      const want = c.actual[i];
      if (got === want) continue;
      const detail =
        got === undefined ? `the copy ends early; the source still has ${JSON.stringify(want)}`
        : want === undefined ? `the copy has trailing ${JSON.stringify(got)} the source does not`
        : `copy has ${JSON.stringify(got)}, source has ${JSON.stringify(want)}`;
      findings.push({
        rule: 'verbatim-blocks-match-source', severity: 'error', requirement: null,
        message: `${c.file} has drifted from ${c.source} at block line ${i + 1}: ${detail}`,
      });
      break; // one finding per claim: the first difference is the one to fix
    }
  }
  return findings;
}

/**
 * The body of a markdown section, excluding its heading and surrounding blank lines.
 *
 * A section ends at the next heading of the same or higher level, or at a
 * top-level `---`. Returns null when no heading has that slug.
 */
export function sectionBody(text: string, slug: string): string[] | null {
  const lines = text.split('\n');
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (m && slugify(m[2]!) === slug) {
      start = i;
      level = m[1]!.length;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = /^(#{1,6})\s+/.exec(lines[i]!);
    if ((h && h[1]!.length <= level) || lines[i]!.trim() === '---') {
      end = i;
      break;
    }
  }
  return trimBlank(lines.slice(start + 1, end));
}

/** Drop leading and trailing blank lines. */
export function trimBlank(lines: string[]): string[] {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s]!.trim() === '') s++;
  while (e > s && lines[e - 1]!.trim() === '') e--;
  return lines.slice(s, e);
}

/** Strip one level of markdown blockquote, so a quoted draft can be compared with a pasteable one. */
export function dequote(lines: string[]): string[] {
  return lines.map((l) => (l.startsWith('> ') ? l.slice(2) : l === '>' ? '' : l));
}
