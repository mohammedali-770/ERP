/**
 * The required-check names live in three places that must agree:
 *
 *   .github/workflows/ci.yml          the jobs that actually run
 *   .github/rulesets/main.json        what GitHub will require before a merge
 *   docs/program/github-controls.md   what a human reads
 *
 * github-controls.md states the hazard plainly: "A required check whose name
 * does not exactly match a job blocks every merge with no way to satisfy it."
 * There is no error message for that case — the pull request simply waits
 * forever on a check that will never report. Three copies of a string, one of
 * which silently bricks the repository, is worth a test.
 */
import { readFileSync } from 'node:fs';

/**
 * Job display names from a workflow. Matched at four-space indentation, which
 * is where a job's `name:` sits — a step's `name:` is deeper and prefixed with
 * `- `, and the workflow's own `name:` is at column zero.
 */
export function workflowJobNames(ciYaml: string): string[] {
  return [...ciYaml.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1]!.trim());
}

/** Required status check contexts from a GitHub ruleset payload. */
export function rulesetRequiredChecks(rulesetJson: string): string[] {
  const ruleset = JSON.parse(rulesetJson) as {
    rules?: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
  };
  const rule = ruleset.rules?.find((r) => r.type === 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((c) => c.context);
}

/**
 * Check names from the "Required status checks" table in the controls document —
 * the leading backticked cell of each row.
 */
export function documentedRequiredChecks(markdown: string): string[] {
  const section = /### Required status checks([\s\S]*?)(?=\n### |\n## |$)/.exec(markdown);
  if (!section) return [];
  return [...section[1]!.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
}

export interface ContractResult {
  /** Required by the ruleset but no job produces it — blocks every merge, forever. */
  readonly requiredButNeverReported: string[];
  /** Documented as required but absent from the ruleset — the document is a fiction. */
  readonly documentedButNotRequired: string[];
  /** Required by the ruleset but missing from the document. */
  readonly requiredButNotDocumented: string[];
}

export function compare(jobs: readonly string[], required: readonly string[], documented: readonly string[]): ContractResult {
  const jobSet = new Set(jobs);
  const requiredSet = new Set(required);
  const documentedSet = new Set(documented);
  return {
    requiredButNeverReported: required.filter((c) => !jobSet.has(c)),
    documentedButNotRequired: documented.filter((c) => !requiredSet.has(c)),
    requiredButNotDocumented: required.filter((c) => !documentedSet.has(c)),
  };
}

export function readContract(root = '.'): ContractResult {
  return compare(
    workflowJobNames(readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8')),
    rulesetRequiredChecks(readFileSync(`${root}/.github/rulesets/main.json`, 'utf8')),
    documentedRequiredChecks(readFileSync(`${root}/docs/program/github-controls.md`, 'utf8')),
  );
}
