/**
 * Pulls the write fixtures out of a pgTAP suite.
 *
 * A pgTAP file's `throws_ok` and `lives_ok` cases carry a SQL statement and the
 * SQLSTATE it is asserted to produce. Parsing them out is what lets the
 * statements run against a plain cluster, with no pgTAP and no Docker.
 *
 * Only write fixtures are extracted. Catalogue assertions (`has_index`, `is`,
 * `ok`) are not, because `db:check` already covers that ground and duplicating
 * it here would mean two places to update for one fact.
 */

export interface Fixture {
  readonly kind: 'throws_ok' | 'lives_ok';
  /** The SQLSTATE the suite asserts, or null for `lives_ok` — which asserts none. */
  readonly want: string | null;
  readonly statement: string;
  /** The suite's own description, so a failure names the test a reader will look for. */
  readonly description: string;
}

/**
 * A pgTAP assertion's SQL is wrapped in `$$ … $$`. Anything after it up to the
 * closing paren carries the expected SQLSTATE and the description.
 *
 * The call is terminated on `);` at end of line rather than on a newline before
 * the paren: every suite in this repository writes these across several lines,
 * but a one-line `select throws_ok($$ … $$, '23505', null, 'x');` is equally
 * valid pgTAP and an earlier version of this regex could not see it at all. A
 * fixture the parser cannot see is a fixture that is silently not checked,
 * which is worse than one that fails.
 */
const ASSERTION = /select\s+(throws_ok|lives_ok)\(\s*\$\$([\s\S]*?)\$\$\s*,([\s\S]*?)\)\s*;[ \t]*(?=\r?\n|$)/g;

/** A five-character SQLSTATE, e.g. '23502'. Quoted, and exactly five. */
const SQLSTATE = /'([0-9A-Za-z]{5})'/;

/**
 * The description is the last quoted string in the tail. Taking the last one
 * rather than the longest matters: a description can be shorter than an
 * SQLSTATE-adjacent argument, and taking the first would return the SQLSTATE.
 */
function description(tail: string): string {
  const quoted = tail.match(/'((?:[^']|'')*)'/g) ?? [];
  const last = quoted.at(-1);
  return last ? last.slice(1, -1).replaceAll("''", "'") : '(no description)';
}

export function parseFixtures(sql: string): Fixture[] {
  const out: Fixture[] = [];
  for (const m of sql.matchAll(ASSERTION)) {
    const kind = m[1] as Fixture['kind'];
    const tail = m[3] ?? '';
    out.push({
      kind,
      want: kind === 'throws_ok' ? (SQLSTATE.exec(tail)?.[1] ?? null) : null,
      statement: (m[2] ?? '').trim(),
      description: description(tail),
    });
  }
  return out;
}

/** What a fixture is expected to produce, as the runner reports it. */
export function expected(f: Fixture): string {
  return f.want ?? 'NONE';
}
