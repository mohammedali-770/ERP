/**
 * Runs every write fixture in the pgTAP suites against a scratch Postgres and
 * compares the SQLSTATE each produces with what the suite asserts.
 *
 *   npm run db:fixtures
 *
 * WHY THIS EXISTS. pgTAP runs only under `supabase test db`, which needs Docker
 * and the Supabase CLI. Neither is present in every environment that can change
 * the schema, so a migration can make a suite's fixtures uncompilable and
 * nothing says so until CI's Database stack job — the slowest check there is.
 *
 * That happened. Migration 0009 made as_of_event_id NOT NULL; five fixtures in
 * 030_conflict_detection_test.sql build projection rows by hand and supplied no
 * stamp, so they raised 23502 before reaching the index they exist to collide
 * with. `db:check` was green throughout, because it never reads the suites.
 *
 * This is NOT a pgTAP replacement. It proves the fixtures still do what the
 * file says they do; the suites remain the authority and still run in CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPostgresBin, startCluster, type Cluster } from '../../db-check/src/cluster.ts';
import { parseFixtures, expected, type Fixture } from './parse.ts';

const MIGRATIONS = 'supabase/migrations';
const SEEDS = 'supabase/seeds';
const TESTS = 'supabase/tests';

/** Ids the suites use for their own throwaway rows, cleaned between fixtures. */
const FIXTURE_ID = '%0000000e%';

function sqlFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

function seedOrder(): string[] {
  // config.toml declares the order; db:check already fails when the two
  // disagree, so reading it here would duplicate that check rather than add one.
  const toml = readFileSync('supabase/config.toml', 'utf8');
  const line = /sql_paths\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? '';
  return [...line.matchAll(/"\.\/seeds\/([^"]+)"/g)].map((m) => m[1]!);
}

/** Runs one statement and returns its SQLSTATE, or 'NONE' if it succeeded. */
function outcome(c: Cluster, statement: string): string {
  c.sql('truncate db_fixture_outcome');
  c.sql(`do $fixture$ begin
           ${statement};
           insert into db_fixture_outcome values ('NONE');
         exception when others then
           insert into db_fixture_outcome values (sqlstate);
         end $fixture$;`);
  return c.sql('select state from db_fixture_outcome').trim();
}

function reset(c: Cluster): void {
  // pgTAP rolls each suite back; this runs outside a transaction, so the rows a
  // fixture inserts are removed explicitly or the next collision test passes
  // for the wrong reason.
  for (const [table, key] of [
    ['erp.drawer_assignments', 'drawer_assignment_id'],
    ['erp.payment_intents', 'payment_intent_id'],
    ['erp.shifts', 'shift_id'],
  ] as const) {
    c.sql(`delete from ${table} where ${key}::text like '${FIXTURE_ID}'`);
  }
}

function main(): void {
  const binDir = findPostgresBin();
  if (!binDir) {
    console.error('db-fixtures: no PostgreSQL binaries found. Install postgresql-client and server.');
    process.exit(1);
  }

  const suites = sqlFiles(TESTS).map((f) => ({ file: f, fixtures: parseFixtures(readFileSync(join(TESTS, f), 'utf8')) }));
  const total = suites.reduce((n, s) => n + s.fixtures.length, 0);
  if (total === 0) {
    console.error('db-fixtures: no fixtures found in supabase/tests — the parser or the suites changed.');
    process.exit(1);
  }

  const cluster = startCluster(binDir, 'erp_fixtures');
  let failed = 0;
  try {
    for (const f of sqlFiles(MIGRATIONS)) cluster.file(join(MIGRATIONS, f));
    for (const f of seedOrder()) cluster.file(join(SEEDS, f));
    cluster.sql('create table db_fixture_outcome (state text)');

    console.log(`\n  db-fixtures: ${total} write fixture(s) in ${suites.filter((s) => s.fixtures.length).length} suite(s)\n`);
    for (const { file, fixtures } of suites) {
      if (fixtures.length === 0) continue;
      console.log(`  ${file}`);
      for (const fx of fixtures) {
        const got = outcome(cluster, fx.statement);
        const want = expected(fx);
        if (got === want) {
          console.log(`    pass  ${fx.description}`);
        } else {
          failed++;
          console.log(`    FAIL  ${fx.description}`);
          console.log(`          ${fx.kind} wanted ${want}, got ${got}`);
        }
        reset(cluster);
      }
      console.log('');
    }
  } finally {
    cluster.stop();
  }

  if (failed > 0) {
    console.error(`  FAIL — ${failed} fixture(s) do not behave as their suite asserts.`);
    console.error('  pgTAP will reject these. Fix the fixture, or the migration that broke it.\n');
    process.exit(1);
  }
  console.log('  PASS — every fixture behaves as its suite asserts\n');
}

main();
