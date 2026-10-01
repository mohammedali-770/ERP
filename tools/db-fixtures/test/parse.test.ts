import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFixtures, expected, forPlpgsql } from '../src/parse.ts';

const THROWS = `
select throws_ok(
  $$ insert into erp.shifts (shift_id) values ('x') $$,
  '23505', null,
  'a second open shift for the same cashier collides'
);
`;

const LIVES = `
select lives_ok(
  $$ insert into erp.shifts (shift_id) values ('y') $$,
  'a closed shift is permitted — history is not forbidden'
);
`;

test('a throws_ok fixture yields its statement, SQLSTATE and description', () => {
  const [f] = parseFixtures(THROWS);
  assert.equal(f!.kind, 'throws_ok');
  assert.equal(f!.want, '23505');
  assert.equal(expected(f!), '23505');
  assert.match(f!.statement, /^insert into erp\.shifts/);
  assert.equal(f!.description, 'a second open shift for the same cashier collides');
});

test('a lives_ok fixture asserts no SQLSTATE at all', () => {
  const [f] = parseFixtures(LIVES);
  assert.equal(f!.kind, 'lives_ok');
  assert.equal(f!.want, null);
  assert.equal(expected(f!), 'NONE');
  assert.equal(f!.description, 'a closed shift is permitted — history is not forbidden');
});

test('the description is the LAST quoted string, not the first', () => {
  // The first is the SQLSTATE. Taking it would label every failure '23505',
  // and the report would name no test a reader could find.
  const [f] = parseFixtures(THROWS);
  assert.notEqual(f!.description, '23505');
});

test('catalogue assertions are not fixtures — only writes are run', () => {
  // has_index/is/ok read the catalogue and have no statement to execute.
  // db:check covers that ground; duplicating it would mean two places to edit.
  const sql = `select has_index('erp','shifts','ux_one_open_shift','one open shift');
               select is((select count(*) from pg_index), 3, 'three indexes');`;
  assert.deepEqual(parseFixtures(sql), []);
});

test('several fixtures in one file are returned in file order', () => {
  const fixtures = parseFixtures(THROWS + LIVES + THROWS);
  assert.deepEqual(fixtures.map((f) => f.kind), ['throws_ok', 'lives_ok', 'throws_ok']);
});

// --- Control. A parser that finds nothing makes every suite vacuously green ---

test('CONTROL: the real suites yield fixtures, so a silent parser break is caught', () => {
  // This test exists because the failure mode of a regex parser is finding
  // zero matches, and zero fixtures would report PASS while proving nothing.
  // It reads the actual suites rather than a sample, so a change to pgTAP
  // call formatting fails here rather than quietly disabling the check.
  const dir = 'supabase/tests';
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) => parseFixtures(readFileSync(join(dir, f), 'utf8')));

  assert.ok(found.length >= 8, `expected the suites to hold fixtures, parsed ${found.length}`);
  assert.ok(found.some((f) => f.kind === 'throws_ok'), 'no throws_ok fixture parsed');
  assert.ok(found.some((f) => f.kind === 'lives_ok'), 'no lives_ok fixture parsed');
  assert.ok(
    found.every((f) => f.statement.length > 0 && f.description !== '(no description)'),
    'a fixture parsed with an empty statement or no description',
  );
});

test('CONTROL: a fixture missing its stamp is visibly different from one that has it', () => {
  // The exact shape migration 0009 broke. If these ever parse identically the
  // runner cannot tell them apart and the check is worthless.
  const without = parseFixtures(`select throws_ok($$ insert into erp.shifts (shift_id, status) values ('a','open') $$, '23505', null, 'collides');`);
  const with_ = parseFixtures(`select throws_ok($$ insert into erp.shifts (shift_id, status, as_of_event_id) values ('a','open','e') $$, '23505', null, 'collides');`);
  assert.notEqual(without[0]!.statement, with_[0]!.statement);
  assert.match(with_[0]!.statement, /as_of_event_id/);
  assert.doesNotMatch(without[0]!.statement, /as_of_event_id/);
});

/**
 * plpgsql has no bare `select`, so a fixture that calls a void function has to be
 * rewritten before it can run inside the DO block this tool uses to catch a
 * SQLSTATE. Before this, such a fixture reported 42601 ("query has no destination")
 * when the function SUCCEEDED, and the function's own error when it failed — so a
 * lives_ok looked broken and a throws_ok looked correct for the wrong reason.
 */
test('a select fixture becomes perform, because plpgsql has no bare select', () => {
  assert.equal(forPlpgsql(" select erp.f('x')"), " perform erp.f('x')");
  assert.equal(forPlpgsql('SELECT 1'), 'perform 1');
});

test('every statement of a multi-statement fixture is reached', () => {
  assert.equal(
    forPlpgsql('set local role erp_app; select erp.f()'),
    'set local role erp_app; perform erp.f()',
  );
});

test('a statement that is not a select is left alone', () => {
  const insert = "insert into erp.t (a) values ('x')";
  assert.equal(forPlpgsql(insert), insert);
  assert.equal(forPlpgsql('update erp.t set a = 1'), 'update erp.t set a = 1');
  // `selection` must not be mangled into `performion` — the word boundary matters.
  assert.equal(forPlpgsql('selections()'), 'selections()');
});
