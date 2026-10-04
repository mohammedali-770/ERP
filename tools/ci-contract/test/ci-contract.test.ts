import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  workflowJobNames, rulesetRequiredChecks, documentedRequiredChecks, compare, readContract,
  runsOnPullRequest, duplicatedRunBranches, readDuplicatedRunBranches,
} from '../src/index.ts';

test('every required check is produced by a real job', () => {
  // The failure this prevents has no error message: the pull request waits
  // forever on a check that will never report.
  const { requiredButNeverReported } = readContract();
  assert.deepEqual(requiredButNeverReported, []);
});

test('the controls document and the ruleset name the same checks', () => {
  const { documentedButNotRequired, requiredButNotDocumented } = readContract();
  assert.deepEqual(documentedButNotRequired, [], 'documented as required but not in the ruleset');
  assert.deepEqual(requiredButNotDocumented, [], 'required by the ruleset but undocumented');
});

test('job names are read at job depth, not step depth', () => {
  const yaml = [
    'name: CI',
    'jobs:',
    '  build:',
    '    name: Typecheck and tests',
    '    steps:',
    '      - name: Typecheck',
    '      - name: Tests',
  ].join('\n');
  // The workflow's own name and the step names must not be mistaken for jobs —
  // requiring "CI" or "Typecheck" would brick every merge.
  assert.deepEqual(workflowJobNames(yaml), ['Typecheck and tests']);
});

test('required checks are read from the right rule', () => {
  const ruleset = JSON.stringify({
    rules: [
      { type: 'deletion' },
      { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'A' }, { context: 'B' }] } },
    ],
  });
  assert.deepEqual(rulesetRequiredChecks(ruleset), ['A', 'B']);
});

test('a ruleset with no status-check rule yields none rather than throwing', () => {
  assert.deepEqual(rulesetRequiredChecks(JSON.stringify({ rules: [{ type: 'deletion' }] })), []);
});

test('the documented table is read from its own section', () => {
  const md = [
    '### Required status checks',
    '',
    '| Check | What fails it |',
    '|---|---|',
    '| `Requirement baseline` | something |',
    '| `Risk spikes` | something else |',
    '',
    '### Deliberately not required: `F0 exit criteria`',
    '',
    '| `Should not be picked up` | no |',
  ].join('\n');
  // The deliberately-excluded gate lives in the next section and must not be
  // read as required — that is the one check that would block every merge.
  assert.deepEqual(documentedRequiredChecks(md), ['Requirement baseline', 'Risk spikes']);
});

test('a typo in any one of the three places is reported', () => {
  const r = compare(['Database schema'], ['Database Schema'], ['Database schema']);
  assert.deepEqual(r.requiredButNeverReported, ['Database Schema'], 'case matters to GitHub');
  assert.deepEqual(r.documentedButNotRequired, ['Database schema']);
});

test('no job runs twice for the same commit', () => {
  // push on refs/heads/<branch> and pull_request on refs/pull/<n>/merge are
  // different refs, so the concurrency group never collapses them. Both report
  // against the same head, and a required check resolves to the latest run of
  // that name — so the pull request waits for the redundant suite.
  assert.deepEqual(readDuplicatedRunBranches(), []);
});

test('the pull_request trigger is what makes checks report on a pull request', () => {
  // Without it the six required checks never report on a pull request, and
  // every merge blocks forever with no error — the same brick as a typo.
  assert.equal(runsOnPullRequest(readFileSync('.github/workflows/ci.yml', 'utf8')), true);
});

test('a push on every branch is reported as duplication, a push on main is not', () => {
  const on = (push: string) => `name: CI\non:\n  pull_request:\n${push}\npermissions:\n  contents: read\n`;
  assert.deepEqual(duplicatedRunBranches(on("  push:\n    branches: ['**']")), ['**']);
  assert.deepEqual(duplicatedRunBranches(on('  push:\n    branches: [main]')), []);
  assert.deepEqual(duplicatedRunBranches(on('  push:')), ['**'], 'no filter means every branch');
  assert.deepEqual(duplicatedRunBranches(on('  push:\n    branches-ignore: [docs]')), ['**'], 'ignore-lists are not narrow');
  assert.deepEqual(duplicatedRunBranches(on('  push:\n    branches:\n      - main\n      - release/*')), ['release/*'], 'block lists too');
});

test('without pull_request there is no duplication to report', () => {
  // A push-only workflow runs each job once, whatever its branch filter says.
  assert.deepEqual(duplicatedRunBranches("name: CI\non:\n  push:\n    branches: ['**']\n\npermissions:\n"), []);
});

/**
 * The npm test glob and tsconfig's include list must cover the same workspace
 * roots, or a test can be run without being typechecked — or typechecked without
 * being run.
 *
 * Both halves had actually happened. Until 2026-10-01 the test glob covered
 * packages, tools and spikes while tsconfig's include covered packages, tools and
 * spikes for TESTS but services and apps only for SRC. So a test under a service's
 * own test directory was neither executed nor typechecked, and CLAUDE.md's "tests
 * that would fail without your change" was satisfiable there by a file nothing
 * ran. ADR-0021 brings services and an application into this repository, which is
 * when that stops being theoretical.
 */
function testRootsFromNpmScript(): string[] {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  return [...pkg.scripts.test!.matchAll(/"([a-z-]+)\/\*\/test\/[^"]*"/g)].map((m) => m[1]!).sort();
}

function testRootsFromTsconfig(): string[] {
  // Comments are legal in tsconfig.json and this one has them.
  const raw = readFileSync('tsconfig.json', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const tsconfig = JSON.parse(raw) as { include: string[] };
  return tsconfig.include
    .map((pattern) => /^([a-z-]+)\/\*\/test\//.exec(pattern)?.[1])
    .filter((root): root is string => root !== undefined)
    .sort();
}

test('the test glob and tsconfig cover the same workspace roots', () => {
  assert.deepEqual(
    testRootsFromNpmScript(),
    testRootsFromTsconfig(),
    'a root in one list and not the other means tests that are run but not typechecked, or the reverse',
  );
});

test('every workspace root that can hold tests is covered', () => {
  // spikes deliberately included: they carry control cases that must compile.
  const expected = ['apps', 'packages', 'services', 'spikes', 'tools'];
  assert.deepEqual(testRootsFromNpmScript(), expected);
});

/**
 * The two functions above compare WORKSPACE roots, which is all the test glob held until
 * the edge functions arrived. supabase/functions/_shared/test is not a workspace — an edge
 * function is deployed on its own, so it cannot be one — and their pattern does not see
 * it. So the same promise is also checked directory by directory, for every glob the test
 * script runs: the directory it runs must lie inside something tsconfig includes.
 */
function testDirsFromNpmScript(): string[] {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  return [...pkg.scripts.test!.matchAll(/"([^"]+)\/[^"/]+"/g)].map((m) => m[1]!).sort();
}

function includeDirsFromTsconfig(): string[] {
  const raw = readFileSync('tsconfig.json', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const tsconfig = JSON.parse(raw) as { include: string[] };
  return tsconfig.include.map((pattern) => pattern.replace(/\/\*\*\/\*\.ts$/, ''));
}

/** True when the include directory contains the test directory, `*` matching one segment. */
function covers(include: string, dir: string): boolean {
  const a = include.split('/');
  const b = dir.split('/');
  return a.length <= b.length && a.every((segment, i) => segment === b[i] || (segment === '*' && b[i] !== undefined));
}

test('every directory the test script runs is typechecked', () => {
  const includes = includeDirsFromTsconfig();
  const untyped = testDirsFromNpmScript().filter((dir) => !includes.some((include) => covers(include, dir)));
  assert.deepEqual(untyped, [], 'run by npm test but in no tsconfig include, so a type error there passes');
});

test('the edge functions\' shared code is tested and typechecked', () => {
  // ADR-0025: _shared/ holds every handler and withSession, kept free of Deno and the
  // driver precisely so that Node can run its tests. Dropping the glob would leave the
  // one place the actor is decided tested by nothing on every pull request.
  assert.ok(testDirsFromNpmScript().includes('supabase/functions/_shared/test'));
  assert.ok(includeDirsFromTsconfig().includes('supabase/functions/_shared'));
});

test('the coverage check reads a glob the way the shell does', () => {
  assert.equal(covers('apps/*/test', 'apps/*/test'), true);
  assert.equal(covers('supabase/functions/_shared', 'supabase/functions/_shared/test'), true);
  assert.equal(covers('supabase/functions/_shared/test', 'supabase/functions/_shared'), false);
  assert.equal(covers('supabase/functions/_deno', 'supabase/functions/_shared/test'), false);
});
