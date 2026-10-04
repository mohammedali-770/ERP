/**
 * The items function end to end: the real router, the real driver, the real routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * Two parts, against the synthetic seed, which opens inventory.items as `pilot` for the
 * suites (migration 0012 alone leaves it hidden, as every real database is until
 * operations signs off the process mapping) and lets a branch worker read items at
 * their branch:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads the items of their
 *      branch, and is refused 403 organisation-wide, where they hold no role. Both answers
 *      come through the role the functions use: a read that works, and a refusal from the
 *      gate rather than a permission error from a missing grant.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      Writes need the administrator, who has no PIN in the seed, so the transaction sets
 *      one through erp.set_pin() — which erp_edge may call, as erp_app, because the
 *      routes trust the actor they are given; that is exactly the gap withSession closes
 *      for requests — and signs them in. Each request then goes through the router and
 *      the driver as in production, each in its own savepoint, so erp_edge's privilege on
 *      every route is exercised. The rollback leaves the local database as it found it,
 *      which the test then checks against things the transaction did change.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { items } from '../../_shared/items.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const BRAND = '01936f00-0000-7000-8000-000000000201';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const adminUrl = Deno.env.get('ERP_TEST_ADMIN_URL');
if (adminUrl === undefined) throw new Error('ERP_TEST_ADMIN_URL is not set: point it at a local stack');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname)) {
  throw new Error('refusing a database that is not on this machine');
}

const call = (token: string, method: string, path: string, body?: unknown) =>
  new Request(`http://edge.test/functions/v1/items${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** erp_edge's connection string, with a password set for the run and cleared after it. */
async function asErpEdge<T>(run: (url: string) => Promise<T>): Promise<T> {
  const owner = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  const password = crypto.randomUUID();
  await owner.unsafe(`alter role erp_edge password '${password}'`);
  const edgeUrl = new URL(adminUrl!);
  edgeUrl.username = 'erp_edge';
  edgeUrl.password = password;
  try {
    return await run(edgeUrl.toString());
  } finally {
    await owner.unsafe('alter role erp_edge password null');
    await owner.end();
  }
}

Deno.test('as erp_edge, a cashier reads their branch\'s items and is refused organisation-wide', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    const atBranch = await items(call(signedIn.token, 'GET', `?facility_id=${BRANCH_ONE}`), deps);
    equal(atBranch.status, 200, 'a read at the branch');
    const listed = await atBranch.json();
    assert(listed.items.length > 0, 'the branch sees the seeded items');
    assert(listed.items.every((i: { brand_id: string }) => i.brand_id === BRAND), 'and only its own brand\'s');

    const everywhere = await items(call(signedIn.token, 'GET', ''), deps);
    equal(everywhere.status, 403, 'a read organisation-wide');
    const body = await everywhere.json();
    equal(body.status, 'forbidden', 'answer');
    assert(/may not read on capability inventory\.items/.test(body.message), `the gate's own words: ${body.message}`);
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every items route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const id = () => crypto.randomUUID();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const signedIn = await db.signIn('1000', '100900');
      assert(signedIn.status === 'ok', 'the administrator signs in');
      const token = signedIn.token;
      // Each request in a savepoint, as each is its own transaction in production: a
      // refusal aborts the transaction it is raised in, and must not take the next
      // request's with it. A refused request rolls its savepoint back.
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Record<string, unknown> }) { super('refused'); }
      }
      // deno-lint-ignore no-explicit-any
      const send = async (method: string, path: string, body?: unknown): Promise<{ http: number; body: any }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await items(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };

      const item = id();
      const created = id();
      const code = `zz-it-${suffix}`;
      await t.step('create', async () => {
        const r = await send('POST', '', {
          decision_id: created, item_id: item, base_unit_decision_id: id(), base_item_unit_id: id(),
          brand_id: BRAND, code, item_kind: 'packaging', base_unit_key: 'piece',
          name_en: `Integration lid ${suffix}`, name_ar: `غطاء ${suffix}`,
          description_en: `Fits the large box ${suffix}`, description_ar: `يناسب العلبة الكبيرة ${suffix}`,
          reason: 'Integration test.',
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: created } }, 'create');
      });

      let stamp = '';
      await t.step('get, with its canonical code and base conversion', async () => {
        const r = await send('GET', `/${item}`);
        equal(r.http, 200, 'status');
        equal(r.body.item.code, code.toUpperCase(), 'the code is canonical');
        // Every field read back where it was written: a driver that swapped two
        // parameters of the same type would otherwise pass.
        const it = r.body.item;
        equal([it.name_en, it.name_ar, it.description_en, it.description_ar, it.item_kind, it.base_unit_key, it.brand_id],
          [`Integration lid ${suffix}`, `غطاء ${suffix}`, `Fits the large box ${suffix}`, `يناسب العلبة الكبيرة ${suffix}`,
           'packaging', 'piece', BRAND], 'the fields');
        equal(r.body.item.units.map((u: { unit_key: string }) => u.unit_key), ['piece'], 'the base conversion');
        stamp = r.body.item.as_of_decision_id;
        equal(stamp, created, 'the stamp is the decision that created it');
      });

      await t.step('list finds it by search', async () => {
        const r = await send('GET', `?search=${encodeURIComponent(code)}&status=all`);
        equal(r.http, 200, 'status');
        equal(r.body.items.map((i: { item_id: string }) => i.item_id), [item], 'found');
      });

      await t.step('a name already in use is a conflict, in the edge\'s words, not PostgreSQL\'s', async () => {
        const r = await send('POST', '', {
          decision_id: id(), item_id: id(), base_unit_decision_id: id(), base_item_unit_id: id(),
          brand_id: BRAND, code: `${code}-dup`, item_kind: 'packaging', base_unit_key: 'piece',
          name_en: `Integration lid ${suffix}`, name_ar: `غطاء آخر ${suffix}`, reason: 'Duplicate name.',
        });
        equal(r.http, 409, 'status');
        equal(r.body, { status: 'conflict', message: 'a value that must be unique is already in use',
                        constraint: 'ux_item_active_name_en' }, 'answer');
      });

      await t.step('a retry of the create is answered as a retry', async () => {
        const r = await send('POST', '', {
          decision_id: created, item_id: id(), base_unit_decision_id: id(), base_item_unit_id: id(),
          brand_id: BRAND, code: `${code}-b`, item_kind: 'packaging', base_unit_key: 'piece',
          name_en: `Other ${suffix}`, name_ar: `آخر ${suffix}`, reason: 'Retry.',
        });
        equal(r.http, 409, 'status');
        equal([r.body.status, r.body.constraint], ['already_recorded', 'item_decision_pkey'], 'answer');
      });

      await t.step('amend, then a stale amend is refused', async () => {
        const amended = id();
        const r = await send('POST', `/${item}/amend`, {
          decision_id: amended, expected_decision_id: stamp,
          name_en: `Integration lid, large ${suffix}`, name_ar: `غطاء كبير ${suffix}`, reason: 'Renamed.',
          description_en: null, description_ar: null,
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: amended } }, 'amend');
        const after = (await send('GET', `/${item}`)).body.item;
        equal([after.name_en, after.name_ar, after.description_en, after.description_ar],
          [`Integration lid, large ${suffix}`, `غطاء كبير ${suffix}`, null, null], 'the amended fields');
        const stale = await send('POST', `/${item}/amend`, {
          decision_id: id(), expected_decision_id: stamp,
          name_en: `Lost update ${suffix}`, name_ar: `تحديث ضائع ${suffix}`, reason: 'Stale form.',
        });
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'item_stale'], 'stale');
        stamp = amended;
      });

      let carton = '';
      await t.step('add a conversion with an exact factor, then retire it', async () => {
        carton = id();
        const added = await send('POST', `/${item}/units`, {
          decision_id: id(), item_unit_id: carton, unit_key: 'carton', factor: '24', reason: 'Packs of 24.',
        });
        equal(added.http, 200, 'add');
        const got = await send('GET', `/${item}`);
        const unit = got.body.item.units.find((u: { item_unit_id: string }) => u.item_unit_id === carton);
        equal([unit?.unit_key, Number(unit?.factor), unit?.status], ['carton', 24, 'active'], 'the conversion');
        const retired = await send('POST', `/units/${carton}/retire`, {
          decision_id: id(), reason: 'Pack size changed.',
        });
        equal(retired.http, 200, 'retire');
        const again = await send('POST', `/units/${carton}/retire`, { decision_id: id(), reason: 'Twice.' });
        equal([again.http, again.body.status], [422, 'refused'], 'a retirement is final');
      });

      await t.step('retire the item', async () => {
        const r = await send('POST', `/${item}/status`, {
          decision_id: id(), expected_decision_id: stamp, status: 'retired', reason: 'Discontinued.',
        });
        equal(r.http, 200, 'retire');
      });

      await t.step('its history holds every decision, in order', async () => {
        const r = await send('GET', `/${item}/history`);
        equal(r.http, 200, 'status');
        equal(r.body.decisions.map((d: { kind: string }) => d.kind),
          ['item_created', 'unit_added', 'item_amended', 'unit_added', 'unit_retired', 'item_status_changed'],
          'the decisions');
      });

      await t.step('an import creates, and a refused one says which line failed', async () => {
        const row = (n: number, extra: Record<string, unknown> = {}) => ({
          line: String(n), decision_id: id(), item_id: id(), base_unit_decision_id: id(), base_item_unit_id: id(),
          brand_id: BRAND, code: `zz-imp-${suffix}-${n}`, item_kind: 'packaging', base_unit_key: 'piece',
          name_en: `Imported ${suffix} ${n}`, name_ar: `مستورد ${suffix} ${n}`, ...extra,
        });
        const ok = await send('POST', '/import', { reason: 'Opening catalogue.', rows: [row(1), row(2)] });
        equal(ok, { http: 200, body: { status: 'ok', created: 2, amended: 0, unchanged: 0 } }, 'import');
        const bad = await send('POST', '/import', { reason: 'Bad file.', rows: [row(3), row(4, { item_kind: 'gadget' })] });
        equal([bad.http, bad.body.status, bad.body.constraint], [422, 'invalid', 'item_import_refused'], 'refused');
        assert(/line 4/.test(bad.body.detail), `the failing line is named: ${bad.body.detail}`);
      });

      await t.step('an item that does not exist is 404', async () => {
        const r = await send('GET', `/${id()}`);
        equal([r.http, r.body.status, r.body.constraint], [404, 'not_found', 'item_exists'], 'missing');
      });

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await edge.end();
  }
  // The rollback is checked, not assumed, against what the transaction did change: items
  // it created, and the PIN it gave the administrator, who has none in the seed.
  const owner = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  try {
    const [left] = await owner`select
        (select count(*)::int from erp.item where code like ${'ZZ-%-' + suffix + '%'}) as items,
        (select count(*)::int from erp.person_credential where person_id = ${ADMIN}::uuid) as admin_pins`;
    equal([left?.['items'], left?.['admin_pins']], [0, 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
