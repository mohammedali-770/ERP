import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellTitle } from '../src/shell.ts';
import { APP_NAME } from '../src/index.ts';

/**
 * The first test under apps/*, which is the point: the test glob and tsconfig's
 * include were widened to cover apps/ and services/ in commit b16f693, and until
 * something actually ran here that was configuration rather than coverage.
 *
 * It tests a plain .ts module because node --test cannot load .tsx at all — see
 * the note in src/shell.ts. Component rendering needs a runner that transforms
 * JSX, which belongs inside this workspace under ADR-0021 §4 and is not here yet.
 */
test('the shell title names the application', () => {
  assert.equal(shellTitle(APP_NAME), 'First Taste ERP — console');
});

test('APP_NAME is the workspace it lives in', () => {
  assert.equal(APP_NAME, 'console');
});
