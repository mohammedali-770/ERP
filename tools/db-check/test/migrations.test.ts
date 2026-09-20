import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderMigrations, duplicateVersions, unrecognisedFiles, MIGRATION_NAME } from '../src/migrations.ts';

test('migrations order by version, not by directory listing', () => {
  // readdirSync order is not guaranteed, and applying 0002 before 0001 fails in
  // ways that look like a SQL bug rather than an ordering bug.
  const ordered = orderMigrations([
    '20260920000300_third.sql',
    '20260920000100_first.sql',
    '20260920000200_second.sql',
  ]);
  assert.deepEqual(ordered.map((m) => m.name), ['first', 'second', 'third']);
});

test('non-migration files are ignored, not applied', () => {
  const ordered = orderMigrations(['README.md', '.gitkeep', '20260920000100_first.sql']);
  assert.equal(ordered.length, 1);
});

test('a .sql file that is not a migration is reported rather than skipped silently', () => {
  // A typo in the timestamp means the file is never applied, and nothing says so.
  assert.deepEqual(unrecognisedFiles(['2026092000010_typo.sql', '20260920000100_ok.sql']), ['2026092000010_typo.sql']);
  assert.deepEqual(unrecognisedFiles(['notes.md']), []);
});

test('two migrations sharing a version is ambiguous history', () => {
  const ordered = orderMigrations(['20260920000100_a.sql', '20260920000100_b.sql']);
  assert.deepEqual(duplicateVersions(ordered), ['20260920000100']);
});

test('the naming rule matches what the Supabase CLI writes', () => {
  assert.ok(MIGRATION_NAME.test('20260920000100_extensions_and_schemas.sql'));
  assert.ok(!MIGRATION_NAME.test('20260920000100-extensions.sql'), 'hyphen is not the separator');
  assert.ok(!MIGRATION_NAME.test('20260920000100_Extensions.sql'), 'uppercase would break CLI round-tripping');
  assert.ok(!MIGRATION_NAME.test('0001_first.sql'), 'a short version sorts wrongly against a timestamp');
});
