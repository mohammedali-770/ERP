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
 * Every requirement identifier cited in a document must exist in the catalogue.
 *
 * A citation to a requirement that does not exist reads as though the design is
 * grounded in an obligation nobody actually wrote down. This rule was added after
 * a real instance: the print design cited PRN-019 for the reprint label, but that
 * requirement is POS-019 — PRN stops at 015.
 */
export function ruleCitationsResolve(ctx: LintContext, citations: ReadonlyArray<{ file: string; id: string }>): Finding[] {
  const known = new Set(ctx.requirements.map((r) => r.id));
  return citations
    .filter((c) => !known.has(c.id))
    .map((c) => ({
      rule: 'citations-resolve',
      severity: 'error' as const,
      requirement: c.id,
      message: `${c.file} cites ${c.id}, which is not in the requirement catalogue.`,
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

/** Every PRD open decision (OPN-*) must map to an ADR that records how it was closed. */
export function ruleOpenDecisionsHaveAdrs(ctx: LintContext, openDecisionIds: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const opn of openDecisionIds) {
    if (!ctx.adrCorpus.includes(opn)) {
      findings.push({ rule: 'open-decisions-have-adrs', severity: 'warning', requirement: opn, message: `${opn} is not referenced by any ADR in docs/adr/.` });
    }
  }
  return findings;
}
