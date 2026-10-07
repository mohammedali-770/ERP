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
import { ASSERTIONS, LOG_BY_NAME, SEED_ASSERTIONS, STOCK_ASSERTIONS, type Assertion } from './assertions.ts';
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
  // Every log every-decision-log-is-append-only discovers — each %_log, %_decision and
  // %_ledger table, by the one predicate both read — and every partition of one. That assertion proves the triggers exist; only an
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
              and ${LOG_BY_NAME}
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
    // The first column a plain UPDATE may set to itself. An identity column refuses that in
    // the rewriter, before any trigger fires — "can only be updated to DEFAULT" — so a log
    // whose first column were one would read as unprotected. None is today: stock_ledger,
    // the first log with an identity besides seq, was declared decision_id first for this
    // reason; this keeps the next one from depending on column order (found in review).
    const column = cluster
      .sql(`select attname from pg_attribute where attrelid = 'erp.${table}'::regclass and attnum > 0
              and not attisdropped and attidentity = '' and attgenerated = '' order by attnum limit 1`).trim();
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
  // Checked by SQLSTATE, constraint and the server routine that raised it, which is what
  // the edge matches, not by wording.
  // Two sessions, one decision id, for every item, supplier and transfer price write route
  // and both imports. The original commits only
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
    // The same for 0012's import, which swallowed the retry as a failed line until 0017.
    ['import_items', (d) => `select erp.import_items(${admin}, 'db-check retry probe', now(),
       jsonb_build_array(jsonb_build_object('code', 'ZZ-RETRY-IMPORT', 'item_kind', 'packaging', 'base_unit_key', 'piece',
         'brand_id', ${id('000000000201')}, 'name_en', 'Retry probe import (synthetic)',
         'name_ar', 'استيراد فحص الإعادة (تجريبي)', 'decision_id', ${d}, 'item_id', ${id('0000000d0105')},
         'base_unit_decision_id', ${id('0000000d0106')}, 'base_item_unit_id', ${id('0000000d0107')})))`],
    // 0018's two write routes, against its seed: the same lock, under its own log. A price
    // for the meal box's unpriced pack of 50, from now; and the chicken carton's price set
    // ahead from 2099, withdrawn.
    ['set_transfer_price', (d) => `select erp.set_transfer_price(${d}, ${id('0000000d0301')}, ${id('000000004213')},
       1200, 'SAR', null, 'db-check retry probe', ${admin}, now())`, 'transfer_price_decision_pkey'],
    ['withdraw_transfer_price', (d) => `select erp.withdraw_transfer_price(${d}, ${id('000000005403')},
       'db-check retry probe', ${admin}, now())`, 'transfer_price_decision_pkey'],
    // 0019's four write routes, against its seed: the same lock, under its own log. A new
    // warehouse; BR-002 renamed from its seeded record; BR-001's area widened from its
    // seeded record; and the new warehouse closed, from the decision that created it —
    // index 16's, so its decision id is …d0017.
    ['create_facility', (d) => `select erp.create_facility(${d}, ${id('0000000d0501')}, ${id('000000000301')}, 'warehouse',
       'WH-RETRY-PROBE', 'Retry probe warehouse (synthetic)', 'مستودع فحص الإعادة (تجريبي)', null, null,
       'db-check retry probe', ${admin}, now())`, 'facility_decision_pkey'],
    ['amend_facility', (d) => `select erp.amend_facility(${d}, ${id('000000000402')}, ${id('000000005602')},
       'Test Branch Two (renamed)', 'الفرع التجريبي الثاني (معدل)', null, null, 'db-check retry probe', ${admin}, now())`,
     'facility_decision_pkey'],
    ['set_facility_area', (d) => `select erp.set_facility_area(${d}, ${id('000000000401')}, ${id('000000005601')},
       24.713600, 46.675300, 200, 'db-check retry probe', ${admin}, now())`, 'facility_decision_pkey'],
    ['change_facility_status', (d) => `select erp.change_facility_status(${d}, ${id('0000000d0501')}, ${id('0000000d0017')},
       'closed', 'db-check retry probe', ${admin}, now())`, 'facility_decision_pkey'],
    // 0020's three write routes, against 0070's seed: the same lock, under its own log. A
    // kilogram of rice wasted at WH-001; the factory's strips counted; WH-001's chicken
    // waste reversed. Each passes the route's every rule the first time, so the retry is
    // refused for being one, and for nothing else.
    ['record_stock_adjustment', (d) => `select erp.record_stock_adjustment(${d}, ${id('000000000403')}, 'waste', null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004225", "quantity": "1"}]'::jsonb,
       'db-check retry probe', null, ${admin}, now())`, 'stock_decision_pkey'],
    ['record_stock_count', (d) => `select erp.record_stock_count(${d}, ${id('000000000404')}, null,
       '[{"item_unit_id": "01936f00-0000-7000-8000-000000004205", "quantity": "170"}]'::jsonb,
       'db-check retry probe', ${admin}, now())`, 'stock_decision_pkey'],
    ['reverse_stock_decision', (d) => `select erp.reverse_stock_decision(${d}, ${id('000000000403')}, ${id('000000005703')},
       'db-check retry probe', null, ${admin}, now())`, 'stock_decision_pkey'],
    // 0022's two write routes, against 0075's seed: the same lock, under its own log.
    // WH-001's chicken minimum lowered to 80 kg, and FA-001's strips' cleared, each from
    // the decision the seed stamped it with.
    ['set_stock_minimum', (d) => `select erp.set_stock_minimum(${d}, ${id('000000000403')}, ${id('000000004201')}, '80',
       ${id('000000005801')}, 'db-check retry probe', ${admin}, now())`, 'stock_minimum_decision_pkey'],
    ['clear_stock_minimum', (d) => `select erp.clear_stock_minimum(${d}, ${id('000000000404')}, ${id('000000004102')},
       ${id('000000005805')}, 'db-check retry probe', ${admin}, now())`, 'stock_minimum_decision_pkey'],
  ];
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorOf = (r: { status: number | null; stderr: string }) =>
    r.status === 0 ? 'nothing (it succeeded)' : (r.stderr.split('\n').find((l) => l.includes('ERROR')) ?? r.stderr).replace(/^.*ERROR:\s*/, '');
  // And raised by a route (exec_stmt_raise, plpgsql's RAISE), as the edge requires: the
  // same constraint raised by PostgreSQL itself (_bt_check_unique) is a collision, which
  // the edge answers as a conflict. Without the lock, a create's retry collides natively
  // on the log's primary key, and SQLSTATE and constraint alone would pass it (found in
  // module 2 step 2's review).
  const isRetrySignal = (stderr: string, constraint: string) =>
    /ERROR:\s+23505:/.test(stderr) && new RegExp(`CONSTRAINT NAME:\\s+${constraint}(\\s|$)`, 'm').test(stderr)
    && /LOCATION:\s+exec_stmt_raise,/.test(stderr);
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

  // An order priced while its pack is being retired must wait for the retirement and then
  // be refused: erp.transfer_price_at() checks the pack under the item's share lock, which
  // retire_item_unit() takes for update. Checked by the caller alone, through an unlocked
  // read, the order saw the pack active, the retirement committed, and the order was
  // charged a price for a pack that no longer existed (found in review). The meal box's
  // carton of 200, priced in the seed; the retirement commits only once the order is seen
  // waiting on a lock, so the overlap is arranged, as above.
  {
    const retirement = cluster.sqlConcurrently(`begin;
      select erp.retire_item_unit(${id('0000000d0401')}, ${id('000000004212')}, 'db-check price probe', ${admin}, now());
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = 'erp_price_order' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, 'erp_price_retirement');
    for (let i = 0; i < 400; i++) {
      const written = cluster.sql(`select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                                    where a.application_name = 'erp_price_retirement'
                                      and l.locktype = 'transactionid' and l.granted)`).trim() === 't';
      if (written) break;
      await pause(25);
    }
    const order = cluster.sqlConcurrently(`select erp.transfer_price_at(${id('000000004212')}, now())`, 'erp_price_order');
    const [retired, priced] = await Promise.all([retirement, order]);
    const refused = /ERROR:\s+23001:/.test(priced.stderr)
      && /CONSTRAINT NAME:\s+transfer_price_conversion_is_active(\s|$)/m.test(priced.stderr);
    if (retired.status === 0 && refused) {
      console.log('  pass  transfer_price_at: an order priced while its pack is retired waits, and is refused');
    } else {
      failures++;
      console.log(`  FAIL  transfer_price_at: an order priced while its pack was retired was answered "${errorOf(priced)}"` +
        (retired.status === 0 ? '' : `; the retirement failed too: ${errorOf(retired)}`));
    }
  }

  // A minimum set in a pack while the pack is being retired must wait for the retirement
  // and then be refused: erp.set_stock_minimum() reads the pack again under the item's share
  // lock, which retire_item_unit() takes for update. Read only before it waited, a pack
  // retired meanwhile was taken as current, and the minimum named a retired carton (found
  // in review). The gloves' carton of 10 at WH-001, which nothing else here uses.
  {
    const retirement = cluster.sqlConcurrently(`begin;
      select erp.retire_item_unit(${id('0000000d0402')}, ${id('000000004218')}, 'db-check minimum probe', ${admin}, now());
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = 'erp_minimum_set' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, 'erp_minimum_retirement');
    for (let i = 0; i < 400; i++) {
      const written = cluster.sql(`select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                                    where a.application_name = 'erp_minimum_retirement'
                                      and l.locktype = 'transactionid' and l.granted)`).trim() === 't';
      if (written) break;
      await pause(25);
    }
    const set = cluster.sqlConcurrently(`select erp.set_stock_minimum(${id('0000000d0701')}, ${id('000000000403')},
      ${id('000000004218')}, '2', null, 'db-check minimum probe', ${admin}, now())`, 'erp_minimum_set');
    const [retired, minimum] = await Promise.all([retirement, set]);
    const refused = /ERROR:\s+23001:/.test(minimum.stderr)
      && /CONSTRAINT NAME:\s+stock_minimum_pack_is_retired(\s|$)/m.test(minimum.stderr);
    if (retired.status === 0 && refused) {
      console.log('  pass  set_stock_minimum: a minimum set while its pack is retired waits, and is refused');
    } else {
      failures++;
      console.log(`  FAIL  set_stock_minimum: a minimum set while its pack was retired was answered "${errorOf(minimum)}"` +
        (retired.status === 0 ? '' : `; the retirement failed too: ${errorOf(retired)}`));
    }
  }

  // An order checked against a branch's area while the branch is being closed must wait
  // for the closure and then be refused: erp.assert_at_facility() reads the facility under
  // its share lock, which every facility route takes for update. Without it, the order
  // saw the branch open, the closure committed, and a closed branch took an order. BR-001,
  // whose stamp is the area probe's decision above (index 18, …d0019); the closure commits
  // only once the order is seen waiting on a lock, as above.
  {
    const closure = cluster.sqlConcurrently(`begin;
      select erp.change_facility_status(${id('0000000d0502')}, ${id('000000000401')}, ${id('0000000d0019')}, 'closed',
        'db-check area probe', ${admin}, now());
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = 'erp_area_order' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, 'erp_area_closure');
    for (let i = 0; i < 400; i++) {
      const written = cluster.sql(`select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                                    where a.application_name = 'erp_area_closure'
                                      and l.locktype = 'transactionid' and l.granted)`).trim() === 't';
      if (written) break;
      await pause(25);
    }
    const order = cluster.sqlConcurrently(`select erp.assert_at_facility(${id('000000000401')}, 24.713600, 46.675300, 10)`,
      'erp_area_order');
    const [closed, checked] = await Promise.all([closure, order]);
    const refused = /ERROR:\s+23001:/.test(checked.stderr)
      && /CONSTRAINT NAME:\s+facility_admits_no_new_work(\s|$)/m.test(checked.stderr);
    if (closed.status === 0 && refused) {
      console.log('  pass  assert_at_facility: an order checked while its branch is closed waits, and is refused');
    } else {
      failures++;
      console.log(`  FAIL  assert_at_facility: an order checked while its branch was closed was answered "${errorOf(checked)}"` +
        (closed.status === 0 ? '' : `; the closure failed too: ${errorOf(closed)}`));
    }
  }

  // STOCK (0020). Every writer of a balance takes erp.lock_stock()'s key lock, and every
  // rule that reads the balance is judged after it. Each race below is two real sessions,
  // the first holding its transaction open until the second is seen waiting on a lock, as
  // above; all at WH-001, on items no earlier probe touched. Without the lock — the draft
  // locked balance ROWS, which do not exist before an item's first movement — each of them
  // went wrong (found in review).
  const warehouse = id('000000000403');
  const manager = id('000000000904');
  const lines = (...l: ReadonlyArray<readonly [string, string, string?]>) => `'${JSON.stringify(
    l.map(([unit, quantity, direction]) => ({ item_unit_id: `01936f00-0000-7000-8000-${unit}`, quantity,
      ...(direction ? { direction } : {}) })))}'::jsonb`;
  const adjust = (decision: string, kind: string, at: string, body: string) =>
    `select erp.record_stock_adjustment(${id(decision)}, ${warehouse}, '${kind}', ${at}, ${body},
       'db-check stock probe', null, ${manager}, now())`;
  const count = (decision: string, body: string) =>
    `select erp.record_stock_count(${id(decision)}, ${warehouse}, null, ${body}, 'db-check stock probe', ${manager}, now())`;
  const raisedAs = (stderr: string, state: string, constraint: string) =>
    new RegExp(`ERROR:\\s+${state}:`).test(stderr)
    && new RegExp(`CONSTRAINT NAME:\\s+${constraint}(\\s|$)`, 'm').test(stderr)
    && /LOCATION:\s+exec_stmt_raise,/.test(stderr);
  const overlap = async (held: string, waiter: string, tag: string) => {
    const holder = `erp_${tag}_held`;
    const waiting = `erp_${tag}_waiter`;
    const first = cluster!.sqlConcurrently(`begin; ${held};
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = '${waiting}' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, holder);
    for (let i = 0; i < 400; i++) {
      const written = cluster!.sql(`select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                                     where a.application_name = '${holder}'
                                       and l.locktype = 'transactionid' and l.granted)`).trim() === 't';
      if (written) break;
      await pause(25);
    }
    return Promise.all([first, cluster!.sqlConcurrently(waiter, waiting)]);
  };
  const report = (ok: boolean, pass: string, fail: string) => {
    if (ok) console.log(`  pass  ${pass}`);
    else { failures++; console.log(`  FAIL  ${fail}`); }
  };
  console.log('');
  {
    // D1: two outward adjustments, each within the 108 l of frying oil held, together beyond
    // it. The second must wait and then be refused; read before the first committed, it
    // took the oil to -12 with nobody's override.
    const take = (d: string) => adjust(d, 'adjustment', 'null', lines(['000000004223', '60', 'out']));
    const [first, second] = await overlap(take('0000000d0601'), take('0000000d0602'), 'stock_negative');
    report(first.status === 0 && raisedAs(second.stderr, '23001', 'stock_would_go_negative'),
      'post_stock: two withdrawals that together overdraw an item — the second waits, and is refused',
      `post_stock: the second of two overdrawing withdrawals was answered "${errorOf(second)}"` +
        (first.status === 0 ? '' : `; the first failed too: ${errorOf(first)}`));
  }
  {
    // The first movements of two items that have no balance yet, listed in opposite orders.
    // The draft's placeholder rows, inserted in line order, deadlocked here (40P01); both
    // must be recorded. This guards against bringing placeholders back. It does not test the
    // key lock: the balances are written per item in item order, so without any lock these
    // two still cannot deadlock. The next probe but two does (found in review).
    const gloves = ['000000004217', '2', 'in'] as const;
    const basket = ['000000004220', '1', 'in'] as const;
    const [first, second] = await overlap(adjust('0000000d0603', 'adjustment', 'null', lines(gloves, basket)),
      adjust('0000000d0604', 'adjustment', 'null', lines(basket, gloves)), 'stock_first');
    report(first.status === 0 && second.status === 0,
      'post_stock: two first movements of the same new items, in opposite orders, are both recorded',
      `post_stock: two first movements in opposite orders were answered "${errorOf(first)}" and "${errorOf(second)}"`);
  }
  {
    // Two reversals of one adjustment, with different ids. The second must be refused by
    // the route, under its own name — not by the unique key's own words, which the edge
    // answers as a bare conflict.
    const reverse = (d: string) => `select erp.reverse_stock_decision(${id(d)}, ${warehouse}, ${id('000000005704')},
       'db-check stock probe', null, ${manager}, now())`;
    const [first, second] = await overlap(reverse('0000000d0605'), reverse('0000000d0606'), 'stock_reversal');
    report(first.status === 0 && raisedAs(second.stderr, '23505', 'stock_already_reversed'),
      'reverse_stock_decision: a second reversal of one decision waits, and is refused as already reversed',
      `reverse_stock_decision: a second reversal was answered "${errorOf(second)}"` +
        (first.status === 0 ? '' : `; the first failed too: ${errorOf(first)}`));
  }
  {
    // A count racing a waste dated before it. The count must wait and read the book with the
    // waste in it: 40 l held, 10 l wasted an hour ago, 35 l found now — so 35 l. Read before
    // the waste committed, the count posted -5 against 40, the waste then took 10 more, and
    // the balance said 25 with 35 on the shelf.
    const [waste, counted] = await overlap(
      adjust('0000000d0607', 'waste', "now() - interval '1 hour'", lines(['000000004216', '2'])),
      count('0000000d0608', lines(['000000004216', '7'])), 'stock_count');
    // The balance AND its ledger: without the lock the count still wrote 35 over the
    // waste's 30, so the balance read right while the entries summed to 25 (found by this
    // probe's control).
    const [onHand, entries] = cluster.sql(`select b.on_hand, (select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end)
                                            from erp.stock_ledger e where e.facility_id = b.facility_id and e.item_id = b.item_id)
                                         from erp.stock_balance b
                                        where b.facility_id = ${warehouse} and b.item_id = ${id('000000004105')}`).trim().split('|');
    report(waste.status === 0 && counted.status === 0 && Number(onHand) === 35 && Number(entries) === 35,
      'record_stock_count: a count racing a waste dated before it waits, and the balance and its entries equal what was found',
      `record_stock_count: a count racing an earlier waste left a balance of ${onHand} l and entries summing to ${entries}` +
        ` against 35 found ("${errorOf(waste)}", "${errorOf(counted)}")`);
  }
  {
    // A count racing an item's FIRST movement, dated before the count: what a row lock
    // cannot cover, because there is no row yet to lock. 10 strips put in an hour ago, 10
    // found now, so nothing to post. Under row locks, the count read no balance, posted +10
    // and wrote 10 over the movement's 10, so the balance read right and its entries said 20
    // (found in review).
    const [movement, counted] = await overlap(
      adjust('0000000d0611', 'adjustment', "now() - interval '1 hour'", lines(['000000004205', '10', 'in'])),
      count('0000000d0612', lines(['000000004205', '10'])), 'stock_unborn');
    const [onHand, entries] = cluster.sql(`select b.on_hand, (select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end)
                                            from erp.stock_ledger e where e.facility_id = b.facility_id and e.item_id = b.item_id)
                                         from erp.stock_balance b
                                        where b.facility_id = ${warehouse} and b.item_id = ${id('000000004102')}`).trim().split('|');
    report(movement.status === 0 && counted.status === 0 && Number(onHand) === 10 && Number(entries) === 10,
      'record_stock_count: a count racing an item\'s first movement waits on the key lock, and posts nothing it did not find',
      `record_stock_count: a count racing an item's first movement left a balance of ${onHand} and entries summing to ${entries}` +
        ` against 10 found ("${errorOf(movement)}", "${errorOf(counted)}")`);
  }
  {
    // "Now" is the clock once the lock is held. The waste's transaction begins first, then
    // waits behind a count of the same item made "now"; it must be dated after the count and
    // recorded. Dated from its own transaction's start, it fell before the count it waited
    // for and was refused as backdated (0018's finding, for stock).
    const waiting = 'erp_stock_now_waiter';
    const holder = 'erp_stock_now_held';
    const waste = cluster.sqlConcurrently(`begin; select now();
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
                            where a.application_name = '${holder}' and l.locktype = 'transactionid' and l.granted);
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      ${adjust('0000000d0609', 'waste', 'null', lines(['000000004211', '10']))};
      commit;`, waiting);
    for (let i = 0; i < 400; i++) {
      const started = cluster.sql(`select exists (select 1 from pg_stat_activity
                                    where application_name = '${waiting}' and xact_start is not null)`).trim() === 't';
      if (started) break;
      await pause(25);
    }
    const held = cluster.sqlConcurrently(`begin; ${count('0000000d0610', lines(['000000004211', '500']))};
      do $wait$ begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          exit when exists (select 1 from pg_stat_activity
                            where application_name = '${waiting}' and wait_event_type = 'Lock');
          perform pg_sleep(0.025);
        end loop;
      end $wait$;
      commit;`, holder);
    const [counted, wasted] = await Promise.all([held, waste]);
    const after = cluster.sql(`select (select occurred_at from erp.stock_decision where decision_id = ${id('0000000d0609')})
                                    > (select occurred_at from erp.stock_decision where decision_id = ${id('0000000d0610')})`).trim();
    report(counted.status === 0 && wasted.status === 0 && after === 't',
      'post_stock: a movement made "now" that waited behind a count is dated after it, and recorded',
      `post_stock: a "now" movement that waited behind a count was answered "${errorOf(wasted)}"` +
        (counted.status === 0 ? '' : `; the count failed too: ${errorOf(counted)}`));
  }

  // And the ledger's rules again, over everything the probes above posted through the
  // routes, races included.
  check(cluster, 'Stock assertions, after the probes', STOCK_ASSERTIONS);
} finally {
  cluster?.stop();
}

const elapsed = Date.now() - started;
console.log(`\n  wall time ${elapsed} ms`);
console.log(`\n  ${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
