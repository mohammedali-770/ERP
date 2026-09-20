import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, RULES } from '../src/rules.ts';

// Synthetic fixtures. None is a real credential — every one is zeros or an
// obvious placeholder.
//
// They are ASSEMBLED AT RUNTIME rather than written as literals, because
// GitHub's push protection rejected this file when they were literals: its
// scanner matched the placeholder Supabase token on sight. That is the rules
// below being right, not wrong, and the answer is to stop the shape existing in
// the source rather than to ask for an exemption — an allowlisted secret today
// is an allowlisted secret when it is real.
const z = (n: number): string => '0'.repeat(n);
const join = (...parts: string[]): string => parts.join('');

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['jwt', join('const key = "ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJyb2xlIjoiYW5vbiJ9', '.', 'c2lnbmF0dXJlX3BsYWNlaG9sZGVy', '"')],
  ['supabase-access-token', join('SUPABASE_ACCESS_TOKEN=', 'sbp', '_', z(40))],
  ['supabase-secret-key', join('key = ', 'sb', '_secret_', z(24))],
  ['postgres-url-with-password', join('postgresql://erp_app:', 'placeholder-pw', '@db.example.co:5432/postgres')],
  ['private-key', join('-----BEGIN RSA ', 'PRIVATE KEY', '-----')],
  ['aws-access-key', join('AKIA', z(16))],
  ['generic-assignment', join('client_secret = "', z(28), '"')],
];

for (const [ruleId, sample] of FIXTURES) {
  test(`rule ${ruleId} fires`, () => {
    const found = scan('sample.txt', sample);
    assert.ok(found.some((f) => f.ruleId === ruleId), `${ruleId} did not match its own fixture`);
  });
}

test('ordinary prose about secrets does not fire', () => {
  const prose = [
    'Secrets are stored by reference, not by value (SEC-003).',
    'The access token lives in public.inbox_config; the value is not reproduced here.',
    'Set SUPABASE_DB_PASSWORD in your local .env, which is gitignored.',
    'password: ""',
  ].join('\n');
  assert.deepEqual(scan('doc.md', prose), []);
});

test('a finding never carries the matched value', () => {
  const [, sample] = FIXTURES[0]!;
  const found = scan('sample.txt', sample);
  const serialised = JSON.stringify(found);
  assert.ok(!serialised.includes(sample), 'the scanner leaked the secret it found');
  assert.ok(!serialised.includes(join('ey', 'JhbGciOi')), 'the scanner leaked a fragment');
});

test('an allowance is scoped to one file and one rule', () => {
  const sample = FIXTURES.find(([id]) => id === 'private-key')![1];
  const allowances = [{ file: 'a.txt', ruleId: 'private-key', reason: 'fixture' }];
  assert.deepEqual(scan('a.txt', sample, allowances), []);
  assert.equal(scan('b.txt', sample, allowances).length, 1, 'the allowance leaked to another file');
});

test('every rule has a fixture', () => {
  // Otherwise a rule can be added, never match anything, and look like coverage.
  const covered = new Set(FIXTURES.map(([id]) => id));
  const missing = RULES.map((r) => r.id).filter((id) => !covered.has(id));
  assert.deepEqual(missing, [], 'rules without a fixture proving they fire');
});
