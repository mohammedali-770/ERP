import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeedPaths } from '../src/seed.ts';

const CONFIG = `
project_id = "first-taste-erp"

[db]
port = 54322

[db.seed]
enabled = true
sql_paths = ["./seeds/0010_a.sql", "./seeds/0020_b.sql"]

[studio]
enabled = true
`;

test('seed paths are read from the [db.seed] section, in order', () => {
  // Order is not cosmetic: the organisation must exist before anything
  // references it, and the timestamp freeze must run last.
  assert.deepEqual(parseSeedPaths(CONFIG), ['./seeds/0010_a.sql', './seeds/0020_b.sql']);
});

test('a sql_paths in another section is not picked up', () => {
  const other = '[storage]\nsql_paths = ["./wrong.sql"]\n';
  assert.deepEqual(parseSeedPaths(other), []);
});

test('no [db.seed] section yields no files rather than throwing', () => {
  assert.deepEqual(parseSeedPaths('project_id = "x"\n'), []);
});

test('the list may span lines, as a formatter would write it', () => {
  const wrapped = '[db.seed]\nsql_paths = [\n  "./seeds/a.sql",\n  "./seeds/b.sql",\n]\n';
  assert.deepEqual(parseSeedPaths(wrapped), ['./seeds/a.sql', './seeds/b.sql']);
});

test('a comment naming the section is not the section', () => {
  // config.toml's header once said "the seed files [db.seed] lists", and the first
  // match ended at the next real section, so every seed file read as undeclared.
  const commented = `# loads the seed files [db.seed] lists\n\n[api]\nport = 1\n\n${CONFIG}`;
  assert.deepEqual(parseSeedPaths(commented), ['./seeds/0010_a.sql', './seeds/0020_b.sql']);
});

test('a commented-out sql_paths in the section is not read', () => {
  const config = '[db.seed]\n# sql_paths = ["./seeds/old.sql"]\nsql_paths = ["./seeds/a.sql"]\n';
  assert.deepEqual(parseSeedPaths(config), ['./seeds/a.sql']);
});

test('a header with a trailing comment or a CRLF line end is still the section', () => {
  assert.deepEqual(parseSeedPaths('[db.seed] # seeds\nsql_paths = ["./seeds/a.sql"]\n'), ['./seeds/a.sql']);
  assert.deepEqual(parseSeedPaths('[db.seed]\r\nsql_paths = ["./seeds/a.sql"]\r\n'), ['./seeds/a.sql']);
});
