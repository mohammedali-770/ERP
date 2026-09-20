/**
 * npm run db:check
 *
 * Applies every migration to a throwaway PostgreSQL cluster in filename order,
 * then asserts the structural invariants. No Docker, no dependency.
 *
 * What this proves: the migrations apply cleanly, in order, from nothing — which
 * is requirement 3's core claim — and that the security posture ADR-0018
 * specified actually holds in the built database rather than only in prose.
 *
 * What it does NOT prove: Supabase behaviour. Storage policies, auth and
 * PostgREST exposure need the real stack, and are the pgTAP suite's job
 * (`npm run db:test`). This runs in more places; that one runs deeper.
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadMigrations, duplicateVersions, unrecognisedFiles } from './migrations.ts';
import { ASSERTIONS, SEED_ASSERTIONS, type Assertion } from './assertions.ts';
import { findPostgresBin, startCluster, type Cluster } from './cluster.ts';
import { planSeed } from './seed.ts';
import { readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const CONFIG = 'supabase/config.toml';

function fail(message: string): never {
  console.error(`\n  db-check: ${message}`);
  process.exit(1);
}

const binDir = findPostgresBin();
if (!binDir) {
  fail(
    'no PostgreSQL server binaries found (initdb, pg_ctl).\n' +
    '  Install postgresql locally, or run the full stack check instead: npm run db:test',
  );
}

const files = readdirSync(MIGRATIONS_DIR);
const migrations = loadMigrations(MIGRATIONS_DIR);

const seed = planSeed(CONFIG);
if (seed.missing.length > 0) {
  fail(`config.toml declares seed files that do not exist: ${seed.missing.join(', ')}`);
}
if (seed.undeclared.length > 0) {
  fail(
    `these seed files exist but config.toml does not list them, so they never load: ${seed.undeclared.join(', ')}`,
  );
}

const stray = unrecognisedFiles(files);
if (stray.length > 0) {
  fail(`these .sql files are not migrations and would never be applied: ${stray.join(', ')}`);
}
const dupes = duplicateVersions(migrations);
if (dupes.length > 0) {
  fail(`two migrations share a version, so their order is ambiguous: ${dupes.join(', ')}`);
}
if (migrations.length === 0) fail(`no migrations found in ${MIGRATIONS_DIR}`);

console.log('db-check — migrations applied to a scratch cluster, then asserted\n');
console.log(`  postgres    ${binDir}`);
console.log(`  migrations  ${migrations.length}`);
console.log(`  seed files  ${seed.files.length}\n`);

const started = Date.now();
let cluster: Cluster | null = null;
let failures = 0;

try {
  cluster = startCluster(binDir);

  for (const m of migrations) {
    try {
      cluster.file(join(MIGRATIONS_DIR, m.file));
      console.log(`  applied  ${m.file}`);
    } catch (error) {
      console.error(`  FAILED   ${m.file}`);
      console.error(String(error).split('\n').map((l) => `           ${l}`).join('\n'));
      fail(`migration ${m.file} did not apply. The chain stops here — later migrations were not attempted.`);
    }
  }

  for (const file of seed.files) {
    try {
      cluster.file(file);
      console.log(`  applied  ${file}`);
    } catch (error) {
      console.error(String(error));
      fail(`the seed file ${file} did not load against a freshly migrated database.`);
    }
  }

  const check = (c: Cluster, group: string, list: readonly Assertion[]): void => {
    console.log(`\n  ${group}\n`);
    for (const a of list) {
      const rows = c.sql(a.sql).split('\n').map((r) => r.trim()).filter(Boolean);
      if (rows.length === 0) {
        console.log(`  pass  ${a.title}`);
      } else {
        failures++;
        console.log(`  FAIL  ${a.title}`);
        console.log(`        ${a.because}`);
        for (const r of rows.slice(0, 8)) console.log(`        · ${r}`);
        if (rows.length > 8) console.log(`        · ... and ${rows.length - 8} more`);
      }
    }
  };

  check(cluster, 'Structural assertions', ASSERTIONS);
  if (seed.files.length > 0) check(cluster, 'Seed assertions', SEED_ASSERTIONS);

  // Catalogue reads cannot see an ALTER DEFAULT PRIVILEGES that names the wrong
  // role: it is present, correct-looking, and inert. The only way to know is to
  // create a table the way a future migration will and ask who can reach it.
  console.log('');
  cluster.sql('create table erp.__default_privilege_probe (id int)');
  const reachable = cluster
    .sql(`select r.rolname
          from (select unnest(array['anon','authenticated','service_role']) as rolname) r
          where has_table_privilege(r.rolname, 'erp.__default_privilege_probe', 'SELECT')
             or has_table_privilege(r.rolname, 'erp.__default_privilege_probe', 'INSERT')`)
    .split('\n').map((x) => x.trim()).filter(Boolean);
  cluster.sql('drop table erp.__default_privilege_probe');
  if (reachable.length === 0) {
    console.log('  pass  a newly created erp table is reachable by no API role');
  } else {
    failures++;
    console.log(`  FAIL  a new erp table is reachable by: ${reachable.join(', ')}`);
    console.log('        The default privileges are set for a role that does not create these tables.');
  }

  // Requirement 3's actual claim is not "db reset runs" but "db reset recreates
  // the COMPLETE database" — which is only meaningful if it lands in the same
  // place every time. Build it a second time and compare the data.
  if (seed.files.length > 0) {
    console.log('');
    const second = 'erp_check_again';
    cluster.createDatabase(second);
    for (const m of migrations) cluster.fileIn(second, join(MIGRATIONS_DIR, m.file));
    for (const file of seed.files) cluster.fileIn(second, file);
    const a = cluster.dumpData(cluster.database);
    const b = cluster.dumpData(second);
    if (a === b) {
      console.log('  pass  a second build from scratch produces identical data');
    } else {
      failures++;
      console.log('  FAIL  two builds from the same files differ — the seed is not deterministic');
      console.log('        A seed that varies means a regression run does not start from a known state (LAB-005).');
    }
  }

  // Asserted by attempting the write, not by reading the catalogue: a trigger
  // that exists and does not fire is the failure this is looking for.
  console.log('');
  let triggerHeld = false;
  try {
    cluster.sql(`update erp.event_log set event_type = 'tampered' where true`);
  } catch (error) {
    triggerHeld = /append-only/i.test(String(error));
  }
  if (triggerHeld) {
    console.log('  pass  event_log rejects UPDATE at runtime, not only on paper');
  } else {
    failures++;
    console.log('  FAIL  event_log accepted an UPDATE — ADR-0003 protection two is not working');
  }
} finally {
  cluster?.stop();
}

const elapsed = Date.now() - started;
console.log(`\n  wall time ${elapsed} ms`);
console.log(`\n  ${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
