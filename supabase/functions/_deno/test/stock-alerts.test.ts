/**
 * The stock-alerts function end to end: the real router, the real driver, 0022's routes,
 * and the bell they ring, read through the notifications function.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As stock.test.ts, two parts, against the synthetic seed, which opens
 * inventory.stock_alerts as `pilot` (0022 alone leaves it hidden), seeds minimums at
 * WH-001 and FA-001 (0075), and lets both managers set them where they hold stock:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier, who reads stock at their
 *      branch, reads no minimums anywhere and sets none.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK,
 *      each request in its own savepoint, the rollback checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { stockAlerts } from '../../_shared/stock-alerts.ts';
import { stock } from '../../_shared/stock.ts';
import { notifications } from '../../_shared/notifications.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACTORY_MANAGER = '01936f00-0000-7000-8000-000000000908';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
/** Chicken breast: 121.5 kg at WH-001, against a minimum of 10 cartons of 10 kg (0075). */
const CHICKEN = '01936f00-0000-7000-8000-000000004101';
const KG = '01936f00-0000-7000-8000-000000004201';
const CARTON = '01936f00-0000-7000-8000-000000004203';
/** Rice: a minimum set, then cleared. */
const RICE = '01936f00-0000-7000-8000-000000004111';
const RICE_BAG = '01936f00-0000-7000-8000-000000004226';
/** The second brand's meal box, in pieces: a conversion no facility of the first brand holds. */
const OTHER_BRAND_PIECE = '01936f00-0000-7000-8000-000000004227';
/** The seed's decision behind chicken's minimum at WH-001. */
const SEEDED_MINIMUM = '01936f00-0000-7000-8000-000000005801';

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

const call = (fn: string, token: string, method: string, path: string, body?: unknown) =>
  new Request(`http://edge.test/functions/v1/${fn}${path}`, {
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

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.test('as erp_edge, a cashier reads no minimums and sets none', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    for (const facility of [BRANCH_ONE, WAREHOUSE]) {
      const list = await stockAlerts(call('stock-alerts', signedIn.token, 'GET', `?facility_id=${facility}`), deps);
      const body = await list.json();
      equal([list.status, body.status], [403, 'forbidden'], `a cashier reads no minimums at ${facility}`);
      assert(/inventory\.stock_alerts/.test(body.message), `the gate's own words: ${body.message}`);
    }
    const set = await stockAlerts(call('stock-alerts', signedIn.token, 'POST', '/minimums', {
      decision_id: crypto.randomUUID(), facility_id: WAREHOUSE, item_unit_id: KG, quantity: '1',
      expected_decision_id: SEEDED_MINIMUM, reason: 'A cashier tries.',
    }), deps);
    equal([set.status, (await set.json()).status], [403, 'forbidden'], 'a cashier sets nothing');
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every stock-alerts route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8);
  const reason = `Integration test ${suffix}.`;
  const id = () => crypto.randomUUID();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${FACTORY_MANAGER}::uuid, '100908', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const admin = await db.signIn('1000', '100900');
      const manager = await db.signIn('1004', '100904');
      const factory = await db.signIn('1008', '100908');
      assert(admin.status === 'ok' && manager.status === 'ok' && factory.status === 'ok',
        'the administrator and both managers sign in');
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Row }) { super('refused'); }
      }
      const routers = { 'stock-alerts': stockAlerts, stock, notifications } as const;
      const through = async (fn: keyof typeof routers, method: string, path: string, body: unknown, token: string) => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await routers[fn](call(fn, token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() as Row };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };
      const send = (method: string, path: string, body?: unknown, token = manager.token) =>
        through('stock-alerts', method, path, body, token);
      const minimumOf = async (item: string): Promise<Row | undefined> => {
        const page = await send('GET', `?facility_id=${WAREHOUSE}&limit=500`);
        equal(page.http, 200, 'the list at WH-001');
        return (page.body.minimums as Row[]).find((m) => m.item_id === item);
      };

      await t.step('the list reads as decimal text: what is low, and as what each was entered', async () => {
        const page = await send('GET', `?facility_id=${WAREHOUSE}`);
        equal((page.body.minimums as Row[]).map((m) => [m.code, m.minimum, m.on_hand, m.is_low]),
          [['CL-SANITISER', '50', '40', true], ['RM-CHK-BREAST', '100', '121.5', false]],
          'sanitiser is low, chicken is not, and rice, cleared, is not listed');
        const chicken = await minimumOf(CHICKEN);
        equal([chicken?.unit_key, chicken?.quantity, chicken?.factor, chicken?.as_of_decision_id],
          ['carton', '10', '10', SEEDED_MINIMUM], '10 cartons of 10 kg, stamped');
        const low = await send('GET', `?facility_id=${WAREHOUSE}&low=true`);
        equal((low.body.minimums as Row[]).map((m) => m.code), ['CL-SANITISER'], 'the low ones alone');
        const unnamed = await send('GET', '', undefined, admin.token);
        equal([unnamed.http, unnamed.body.constraint], [422, 'stock_facility_required'], 'a read names its facility');
      });

      await t.step('an item\'s history, newest first, marks the decision in force', async () => {
        const page = await send('GET', `/items/${RICE}?facility_id=${WAREHOUSE}`);
        equal((page.body.decisions as Row[]).map((d) => [d.kind, d.minimum, d.is_current]),
          [['minimum_cleared', null, true], ['minimum_set', '100', false]], 'rice: cleared, after 20 bags');
        assert(/^\d+$/.test(String((page.body.decisions as Row[])[0]?.seq)), 'a seq, as text');
      });

      const raised = id();
      await t.step('a minimum set in a pack is kept as entered, and a retry is answered as a retry', async () => {
        const body = {
          decision_id: raised, facility_id: WAREHOUSE, item_unit_id: CARTON, quantity: '12',
          expected_decision_id: SEEDED_MINIMUM, reason,
        };
        equal(await send('POST', '/minimums', body), { http: 200, body: { status: 'ok', decision_id: raised } }, 'set');
        const chicken = await minimumOf(CHICKEN);
        equal([chicken?.minimum, chicken?.quantity, chicken?.is_low, chicken?.as_of_decision_id],
          ['120', '12', false, raised], '12 cartons is 120 kg, and 121.5 kg is above it');
        const retry = await send('POST', '/minimums', { ...body, quantity: '99' });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'stock_minimum_decision_pkey'], 'retry');
        const history = await send('GET', `/items/${CHICKEN}?facility_id=${WAREHOUSE}`);
        const first = (history.body.decisions as Row[])[0];
        equal([first?.decision_id, first?.reason, first?.is_current], [raised, reason, true], 'the console confirms it');
        const stale = await send('POST', '/minimums', { ...body, decision_id: id(), quantity: '11' });
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'stock_minimum_stale'],
          'a form read before it is stale');
        const same = await send('POST', '/minimums', {
          ...body, decision_id: id(), item_unit_id: KG, quantity: '120', expected_decision_id: raised,
        });
        equal([same.http, same.body.status, same.body.constraint], [422, 'refused', 'stock_minimum_unchanged'],
          '120 kg is the 12 cartons already in force');
      });

      await t.step('a waste past the minimum rings the bell, for the manager who recorded it too', async () => {
        const waste = await through('stock', 'POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: '2' }], reason,
        }, manager.token);
        equal(waste.http, 200, 'wasted 2 kg: 121.5 to 119.5, past 120');
        for (const [who, token] of [['the warehouse manager, who wasted it', manager.token], ['the administrator', admin.token]] as const) {
          const bell = await through('notifications', 'GET', `?facility_id=${WAREHOUSE}`, undefined, token);
          const n = (bell.body.notifications as Row[])[0];
          equal([n?.kind, n?.facility_code, n?.read_at], ['stock_low', 'WH-001', null], `${who} is told`);
          equal((n?.items as Row[]).map((i) => [i.code, i.on_hand, i.minimum]), [['RM-CHK-BREAST', '119.5', '120']],
            'the item, the balance left and the minimum crossed, as text');
        }
        equal((await minimumOf(CHICKEN))?.is_low, true, 'and it is listed low');
        const again = await through('stock', 'POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: '1' }], reason,
        }, manager.token);
        equal(again.http, 200, 'another kilogram out, while low');
        const bell = await through('notifications', 'GET', `?facility_id=${WAREHOUSE}`, undefined, manager.token);
        equal((bell.body.notifications as Row[]).filter((n) => n.kind === 'stock_low').length, 1, 'once per drop');
      });

      await t.step('none, a number, another brand\'s pack, a branch and another facility\'s manager are refused', async () => {
        const base = { facility_id: WAREHOUSE, item_unit_id: KG, expected_decision_id: raised, reason };
        const none = await send('POST', '/minimums', { ...base, decision_id: id(), quantity: '0' });
        equal([none.http, none.body.status, none.body.constraint, none.body.hint],
          [422, 'invalid', 'stock_minimum_is_valid', 'To have no minimum, clear it.'], 'a minimum is more than nothing');
        const numeric = await send('POST', '/minimums', { ...base, decision_id: id(), quantity: 80 });
        equal([numeric.http, numeric.body], [400, { status: 'malformed', field: 'quantity' }], 'a quantity is decimal text');
        const stampless = await send('POST', '/minimums', { decision_id: id(), facility_id: WAREHOUSE, item_unit_id: KG, quantity: '80', reason });
        equal([stampless.http, stampless.body], [400, { status: 'malformed', field: 'expected_decision_id' }],
          'a stamp left out is not read as none');
        const other = await send('POST', '/minimums', { ...base, decision_id: id(), item_unit_id: OTHER_BRAND_PIECE, quantity: '1' });
        equal([other.http, other.body.status, other.body.constraint], [404, 'not_found', 'item_unit_exists'],
          'another brand\'s pack is answered as a missing one');
        const branch = await send('POST', '/minimums', {
          ...base, decision_id: id(), facility_id: BRANCH_ONE, quantity: '1', expected_decision_id: null,
        }, admin.token);
        equal([branch.http, branch.body.constraint], [422, 'stock_branch_business_day_undecided'], 'a branch holds no minimum (Q-06)');
        const elsewhere = await send('POST', '/minimums', { ...base, decision_id: id(), quantity: '80' }, factory.token);
        equal([elsewhere.http, elsewhere.body.status], [403, 'forbidden'], 'the factory manager sets none at the warehouse');
      });

      await t.step('a cleared minimum is set again against the decision that cleared it, not as none', async () => {
        const history = await send('GET', `/items/${RICE}?facility_id=${WAREHOUSE}`);
        const current = (history.body.decisions as Row[]).find((d) => d.is_current);
        equal(current?.kind, 'minimum_cleared', 'rice\'s decision in force is its clearing');
        const asNone = await send('POST', '/minimums', {
          decision_id: id(), facility_id: WAREHOUSE, item_unit_id: RICE_BAG, quantity: '10', expected_decision_id: null, reason,
        });
        equal([asNone.http, asNone.body.constraint], [409, 'stock_minimum_stale'], 'null says it never had one, and it had');
        const again = id();
        const set = await send('POST', '/minimums', {
          decision_id: again, facility_id: WAREHOUSE, item_unit_id: RICE_BAG, quantity: '10',
          expected_decision_id: current?.decision_id, reason,
        });
        equal(set, { http: 200, body: { status: 'ok', decision_id: again } }, 'set again from its clearing');
        equal((await minimumOf(RICE))?.minimum, '50', '10 bags of 5 kg');
      });

      await t.step('a decision id used elsewhere is answered as recorded, and the item\'s history shows it was not a retry', async () => {
        const fromFactory = '01936f00-0000-7000-8000-000000005805';
        const r = await send('POST', '/minimums', {
          decision_id: fromFactory, facility_id: WAREHOUSE, item_unit_id: KG, quantity: '1', expected_decision_id: null, reason,
        }, admin.token);
        equal([r.http, r.body.status], [409, 'already_recorded'], 'an id is checked against every facility and item');
        const history = await send('GET', `/items/${CHICKEN}?facility_id=${WAREHOUSE}`);
        equal((history.body.decisions as Row[]).some((d) => d.decision_id === fromFactory), false,
          'and the history the console confirms against does not hold it: a collision');
      });

      await t.step('a minimum cleared is no longer listed, and clearing it twice is refused', async () => {
        const cleared = id();
        const r = await send('POST', `/items/${CHICKEN}/clear`, {
          decision_id: cleared, facility_id: WAREHOUSE, expected_decision_id: raised, reason,
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: cleared } }, 'cleared');
        equal(await minimumOf(CHICKEN), undefined, 'and gone from the list');
        const twice = await send('POST', `/items/${CHICKEN}/clear`, {
          decision_id: id(), facility_id: WAREHOUSE, expected_decision_id: cleared, reason,
        });
        equal([twice.http, twice.body.constraint], [422, 'stock_minimum_not_set'], 'nothing left to clear');
      });

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await edge.end();
  }
  // The rollback is checked, not assumed, against what the transaction did change.
  const owner = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  try {
    const [left] = await owner`select
        (select count(*)::int from erp.stock_minimum_decision where reason = ${reason}) as decisions,
        (select minimum::text from erp.stock_minimum where facility_id = ${WAREHOUSE}::uuid and item_id = ${CHICKEN}::uuid) as minimum,
        (select count(*)::int from erp.notification) as notifications,
        (select count(*)::int from erp.person_credential
          where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid, ${FACTORY_MANAGER}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['minimum'], left?.['notifications'], left?.['pins']], [0, '100', 0, 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
