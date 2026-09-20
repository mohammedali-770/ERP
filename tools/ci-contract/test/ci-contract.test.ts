import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workflowJobNames, rulesetRequiredChecks, documentedRequiredChecks, compare, readContract,
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
