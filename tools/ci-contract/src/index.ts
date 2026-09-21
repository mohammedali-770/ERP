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
 *
 * The same file also decides how many times each check runs. That is not a name
 * mismatch, so the comparison above cannot see it, and it is checked separately
 * at the bottom of this file.
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

// ---------------------------------------------------------------------------
// How many times each check runs
// ---------------------------------------------------------------------------

/** The default branch. A pull request's base here, never its head. */
const DEFAULT_BRANCH = 'main';

/**
 * The body of the workflow's top-level `on:` block: every following line that
 * is indented, commented or blank, stopping at the next key in column zero.
 *
 * Written as a run of lines rather than a lazy match with a `$` lookahead,
 * because under the `m` flag `$` matches at the end of the *first* line — which
 * silently captured `pull_request:` alone and reported "no push trigger" for a
 * workflow that had one.
 */
function onBlock(ciYaml: string): string {
  return /^on:[ \t]*\n((?:[ \t]+.*\n?|[ \t]*\n)*)/m.exec(ciYaml)?.[1] ?? '';
}

/** Whether the workflow runs on `pull_request`. Comment lines are not keys. */
export function runsOnPullRequest(ciYaml: string): boolean {
  return /^ {2}pull_request:/m.test(onBlock(ciYaml));
}

/**
 * The branch patterns that trigger the workflow on `push`.
 *
 * A `push:` with no `branches:` list matches every branch, and so does one
 * written with `branches-ignore`; both are reported as `**` rather than as
 * nothing, so that neither reads as "narrow" when it is not.
 */
export function pushBranches(ciYaml: string): string[] {
  const push = /^ {2}push:[ \t]*\n((?: {4,}.*\n?|[ \t]*\n)*)/m.exec(onBlock(ciYaml) + '\n');
  if (!push) return [];
  const body = push[1]!;
  const inline = /^ {4}branches:[ \t]*\[(.*)\][ \t]*$/m.exec(body);
  if (inline) {
    return inline[1]!.split(',').map((b) => b.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const block = /^ {4}branches:[ \t]*\n((?: {6}- .*\n?)+)/m.exec(body);
  if (block) {
    return [...block[1]!.matchAll(/^ {6}- (.*)$/gm)]
      .map((m) => m[1]!.trim().replace(/^['"]|['"]$/g, ''));
  }
  return ['**'];
}

/**
 * Push patterns that make the workflow run every job a second time for a commit
 * that is already the head of a pull request.
 *
 * GitHub raises `push` for `refs/heads/<branch>` and `pull_request` for
 * `refs/pull/<n>/merge`. Those are different `github.ref` values, so a
 * `concurrency` group keyed on the ref never collapses the pair —
 * `cancel-in-progress` does nothing here. Both suites report check runs against
 * the same head commit, and a required check resolves to the *latest* run of
 * that name, so the pull request stays blocked until the slower, redundant
 * suite finishes. It costs double the runner minutes to learn nothing.
 */
export function duplicatedRunBranches(ciYaml: string): string[] {
  if (!runsOnPullRequest(ciYaml)) return [];
  return pushBranches(ciYaml).filter((pattern) => pattern !== DEFAULT_BRANCH);
}

export function readDuplicatedRunBranches(root = '.'): string[] {
  return duplicatedRunBranches(readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8'));
}
