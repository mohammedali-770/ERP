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
  // Every log every-decision-log-is-append-only discovers — each %_log and %_decision
  // table — and every partition of one. That assertion proves the triggers exist; only an
  // attempted write proves they refuse. A partition is tried by name because naming it
  // is what slipped past 0004's statement trigger (0013). Each attempt runs in a
  // transaction that is rolled back, so an unprotected table is reported without being
  // changed. TRUNCATE takes CASCADE, or a log that others reference would be refused for
  // that instead of by its trigger. And a refusal counts only if it names the table tried:
  // CASCADE reaches other logs, and truncating a parent reaches its partitions, whose own
  // triggers would otherwise refuse on its behalf (found by this check's controls).
  //
  // An EMPTY table is a partition made ahead of its dates, legitimately. UPDATE and DELETE
  // there touch no row, so a row trigger has nothing to fire on and proves nothing either
  // way; what does exist is asserted by every-decision-log-is-append-only, which requires
  // the enabled trigger on every partition. So an empty table is still tried with
  // TRUNCATE, which statement triggers refuse on an empty table, and its UPDATE and
  // DELETE are reported as not tried rather than failed. A row is never fabricated in a
  // log to make one fire (found in review).
  const guarded = cluster
    .sql(`with recursive logs as (
            select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'erp' and c.relkind in ('r', 'p') and not c.relispartition
              and (c.relname like '%\\_log' or c.relname like '%\\_decision')
          ),
          partitions as (
            select i.inhrelid as oid from logs l join pg_inherits i on i.inhparent = l.oid
            union all
            select i.inhrelid from partitions p join pg_inherits i on i.inhparent = p.oid
          )
          select c.relname from pg_class c
          where c.oid in (select oid from logs union all select oid from partitions)
          order by 1`)
    .split('\n').map((x) => x.trim()).filter(Boolean);
  for (const table of guarded) {
    const column = cluster
      .sql(`select attname from pg_attribute where attrelid = 'erp.${table}'::regclass and attnum = 1`).trim();
    const unrefused: string[] = [];
    for (const [op, statement] of [
      ['UPDATE', `update erp.${table} set ${column} = ${column} where true`],
      ['DELETE', `delete from erp.${table} where true`],
      ['TRUNCATE', `truncate erp.${table} cascade`],
    ] as const) {
      let refused = false;
      try {
        cluster.sql(`begin; ${statement}; rollback;`);
      } catch (error) {
        // Every log's trigger says "<log> is append-only (...): <OP> denied on <table>".
        refused = new RegExp(`append-only .*: ${op} denied on ${table}(\\s|$)`, 'm').test(String(error));
      }
      if (!refused) unrefused.push(op);
    }
    const empty = cluster.sql(`select not exists (select 1 from erp.${table})`).trim() === 't';
    const failed = empty ? unrefused.filter((op) => op === 'TRUNCATE') : unrefused;
    if (failed.length > 0) {
      failures++;
      console.log(`  FAIL  ${table} did not itself refuse ${failed.join(', ')} — a log that can be edited answers nothing`);
    } else if (unrefused.length > 0) {
      console.log(`  pass  ${table} rejects TRUNCATE at runtime; it is empty, so UPDATE and DELETE had no row ` +
        'to refuse and were not tried (its row trigger is asserted by every-decision-log-is-append-only)');
    } else {
      console.log(`  pass  ${table} rejects UPDATE, DELETE and TRUNCATE at runtime`);
    }
  }

  // A retry that OVERLAPS its original must still be answered as a retry: 23505 naming
  // the log's primary key (item_decision_pkey, supplier_decision_pkey), the one answer the
  // edge reads back through the module's history read.
  // Checked by SQLSTATE and constraint, which is what the edge matches, not by wording.
  // Two sessions, one decision id, for every item and supplier write route. The original commits only
  // once the retry is seen waiting on a lock, so the overlap is arranged rather than
  // hoped for. Without erp.assert_item_decision_is_new()'s
  // lock, both passed its check before either committed, and the retry came back "has
  // changed since it was read" although the original had succeeded (found in review).
  // Last, because the originals commit: an amendment, a retirement, a conversion added, a
  // conversion retired and an item created, all on the synthetic seed.
  console.log('');
  const id = (tail: string) => `'01936f00-0000-7000-8000-${tail}'::uuid`;
  const admin = id('000000000900');
  // [route, call, the decision log's primary key the retry must name]
  const routes: ReadonlyArray<readonly [string, (decision: string) => string, string?]> = [
    ['amend_item', (d) => `select erp.amend_item(${d}, ${id('000000004111')}, ${id('000000004342')},
       'Basmati rice, aged (synthetic)', 'أرز بسمتي معتق (تجريبي)', null, null, null, 'db-check retry probe', ${admin}, now())`],
    ['change_item_status', (d) => `select erp.change_item_status(${d}, ${id('000000004108')}, ${id('000000004315')},
       'retired', 'db-check retry probe', ${admin}, now())`],
    ['add_item_unit', (d) => `select erp.add_item_unit(${d}, ${id('0000000d0101')}, ${id('000000004107')}, 'carton', 10,
       'db-check retry probe', ${admin}, now())`],
    ['retire_item_unit', (d) => `select erp.retire_item_unit(${d}, ${id('000000004203')}, 'db-check retry probe', ${admin}, now())`],
    ['create_item', (d) => `select erp.create_item(${d}, ${id('0000000d0102')}, ${id('0000000d0103')}, ${id('0000000d0104')},
       ${id('000000000201')}, 'ZZ-RETRY-PROBE', 'packaging', 'piece', 'Retry probe lid (synthetic)', 'غطاء فحص الإعادة (تجريبي)',
       null, null, null, 'db-check retry probe', ${admin}, now())`],
    // 0016's seven write routes, against its seed: the same lock, under its own log.
    ['amend_supplier', (d) => `select erp.amend_supplier(${d}, ${id('000000005102')}, ${id('000000005303')},
       'Gulf Packaging Co. (synthetic)', 'الخليج للتغليف (تجريبي)', '310000000000103', '1010000002', 60,
       'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    ['change_supplier_status', (d) => `select erp.change_supplier_status(${d}, ${id('000000005105')}, ${id('000000005309')},
       'retired', 'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    ['set_supplier_contact', (d) => `select erp.set_supplier_contact(${d}, ${id('000000005103')}, ${id('000000005304')},
       null, '+966550000002', null, null, ${admin}, now())`, 'supplier_decision_pkey'],
    ['add_supplier_item', (d) => `select erp.add_supplier_item(${d}, ${id('0000000d0201')}, ${id('000000005102')},
       ${id('000000004213')}, null, false, 'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    ['amend_supplier_item', (d) => `select erp.amend_supplier_item(${d}, ${id('000000005202')}, ${id('000000005312')},
       'WP-CB-KG', false, 'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    ['retire_supplier_item', (d) => `select erp.retire_supplier_item(${d}, ${id('000000005203')},
       'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    ['create_supplier', (d) => `select erp.create_supplier(${d}, ${id('0000000d0202')}, 'ZZ-RETRY-PROBE',
       'Retry probe supplier (synthetic)', 'مورد فحص الإعادة (تجريبي)', null, null, 30,
       'db-check retry probe', ${admin}, now())`, 'supplier_decision_pkey'],
    // An import sent twice while the first is still running: its rows' decision ids are
    // the first sending's, so the second must be answered as a retry, not as "nothing was
    // saved" when the first saved everything.
    ['import_suppliers', (d) => `select erp.import_suppliers(${admin}, 'db-check retry probe', now(),
       jsonb_build_array(jsonb_build_object('code', 'ZZ-RETRY-IMPORT', 'name_en', 'Retry probe import (synthetic)',
         'name_ar', 'استيراد فحص الإعادة (تجريبي)', 'payment_terms_days', '30', 'decision_id', ${d},
         'contact_decision_id', ${id('0000000d0203')}, 'supplier_id', ${id('0000000d0204')})))`, 'supplier_decision_pkey'],
  ];
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorOf = (r: { status: number | null; stderr: string }) =>
    r.status === 0 ? 'nothing (it succeeded)' : (r.stderr.split('\n').find((l) => l.includes('ERROR')) ?? r.stderr).replace(/^.*ERROR:\s*/, '');
  const isRetrySignal = (stderr: string, constraint: string) =>
    /ERROR:\s+23505:/.test(stderr) && new RegExp(`CONSTRAINT NAME:\\s+${constraint}(\\s|$)`, 'm').test(stderr);
  for (const [index, [route, call, constraint = 'item_decision_pkey']] of routes.entries()) {
    const decision = id(`0000000d${String(index + 1).padStart(4, '0')}`);
    const original = cluster.sqlConcurrently(`begin; ${call(decision)};
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = 'erp_retry_duplicate' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, 'erp_retry_original');
    // The retry starts only once the original has written, and so holds its locks.
    for (let i = 0; i < 400; i++) {
      const written = cluster.sql(`select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                                    where a.application_name = 'erp_retry_original'
                                      and l.locktype = 'transactionid' and l.granted)`).trim() === 't';
      if (written) break;
      await pause(25);
    }
    const retry = cluster.sqlConcurrently(call(decision), 'erp_retry_duplicate');
    const [first, second] = await Promise.all([original, retry]);
    if (first.status === 0 && isRetrySignal(second.stderr, constraint)) {
      console.log(`  pass  ${route}: a retry that overlaps its original is answered as a retry`);
    } else {
      failures++;
      console.log(`  FAIL  ${route}: an overlapping retry was answered "${errorOf(second)}"` +
        (first.status === 0 ? ', not as a retry, although the original succeeded' : `; the original failed too: ${errorOf(first)}`));
    }
  }
} finally {
  cluster?.stop();
}

const elapsed = Date.now() - started;
console.log(`\n  wall time ${elapsed} ms`);
console.log(`\n  ${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
