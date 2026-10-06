/**
 * The notifications function end to end: the real router, the real driver, 0021's routes,
 * and the stock function that rings the bell.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As stock.test.ts, two parts, against the synthetic seed, which opens
 * platform.notifications as `pilot` (0021 alone leaves it hidden), gives every role a
 * bell, holds no notification, and leaves FA-001's chicken breast at -10 kg:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier has a bell, empty, and marking
 *      all of it marks nothing.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      The factory manager overrides at FA-001 through the stock function, which is what
 *      rings the bell; the administrator and the warehouse manager read, count, page and
 *      mark it through the notifications function. Every request runs in its own
 *      savepoint, and the rollback is checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { notifications } from '../../_shared/notifications.ts';
import { stock } from '../../_shared/stock.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACTORY_MANAGER = '01936f00-0000-7000-8000-000000000908';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
/** Chicken breast in cartons of 10 kg: -10 kg at FA-001 in the seed. */
const CHICKEN = '01936f00-0000-7000-8000-000000004101';
const CARTON = '01936f00-0000-7000-8000-000000004203';

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

Deno.test('as erp_edge, a cashier has a bell, empty, and marking all of it marks nothing', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    const list = await notifications(call('notifications', signedIn.token, 'GET', `?facility_id=${BRANCH_ONE}`), deps);
    equal([list.status, await list.json()], [200, { status: 'ok', notifications: [], next_before: null }], 'an empty bell');
    const unread = await notifications(call('notifications', signedIn.token, 'GET', `/unread?facility_id=${BRANCH_ONE}`), deps);
    equal([unread.status, await unread.json()], [200, { status: 'ok', unread: 0 }], 'nothing unread');
    const mark = await notifications(call('notifications', signedIn.token, 'POST', '/read', { facility_id: BRANCH_ONE, all: true }), deps);
    equal([mark.status, await mark.json()], [200, { status: 'ok', marked: 0 }], 'marking all marks nothing, and is no error');
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every notification route, as erp_edge, rung by the stock function, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8);
  const reason = `Integration test ${suffix}.`;
  const id = () => crypto.randomUUID();
  const overrides: string[] = [];
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${FACTORY_MANAGER}::uuid, '100908', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const admin = await db.signIn('1000', '100900');
      const manager = await db.signIn('1004', '100904');
      const factory = await db.signIn('1008', '100908');
      assert(admin.status === 'ok' && manager.status === 'ok' && factory.status === 'ok',
        'the administrator and both managers sign in');
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Row }) { super('refused'); }
      }
      const send = async (fn: 'notifications' | 'stock', token: string, method: string, path: string, body?: unknown):
        Promise<{ http: number; body: Row }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const deps = { db: makeDb(sp), allowedOrigins: new Set<string>() };
            const request = call(fn, token, method, path, body);
            const response = await (fn === 'stock' ? stock(request, deps) : notifications(request, deps));
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };
      const bell = (token: string, query = '') => send('notifications', token, 'GET', `?facility_id=${WAREHOUSE}${query}`);
      const unread = async (token: string) =>
        (await send('notifications', token, 'GET', `/unread?facility_id=${WAREHOUSE}`)).body.unread;
      const override = async () => {
        const decisionId = id();
        const r = await send('stock', factory.token, 'POST', '/adjustments', {
          decision_id: decisionId, facility_id: FACTORY, kind: 'waste', lines: [{ item_unit_id: CARTON, quantity: '1' }],
          override_reason: 'Delivery not yet entered.', reason,
        });
        equal(r.http, 200, 'the factory manager overrides at the factory');
        overrides.push(decisionId);
        return decisionId;
      };

      await t.step('an override at the factory rings the bell of those who read stock there, and not the actor\'s', async () => {
        equal(await unread(manager.token), 0, 'nothing before');
        const decisionId = await override();
        const page = await bell(manager.token);
        equal(page.http, 200, 'the warehouse manager reads their bell at the warehouse');
        const [n, ...rest] = page.body.notifications as Row[];
        equal(rest.length, 0, 'one notification');
        assert(n !== undefined, 'one notification');
        equal([n.kind, n.facility_id, n.facility_code, n.stock_decision_id, n.read_at],
          ['stock_below_zero', FACTORY, 'FA-001', decisionId, null], 'about the decision, at the factory, unread');
        equal((n.items as Row[]).map((i) => [i.item_id, i.code, i.on_hand, i.base_unit_key]),
          [[CHICKEN, 'RM-CHK-BREAST', '-20', 'kg']], 'the item, named now, at the balance the decision left, as text');
        assert(/^[1-9]\d*$/.test(n.seq), `the seq is decimal text: ${n.seq}`);
        assert(typeof n.created_at === 'string' && typeof (n.items as Row[])[0].name_ar === 'string', 'a moment and an Arabic name');
        equal(await unread(manager.token), 1, 'one unread');
        equal(await unread(admin.token), 1, 'the administrator is told too');
        const own = await send('notifications', factory.token, 'GET', `?facility_id=${FACTORY}`);
        equal([own.http, own.body.notifications], [200, []], 'the person who overrode is not told of their own act');
      });

      await t.step('the bell pages newest first, ending before a seq', async () => {
        const second = await override();
        const first = await bell(manager.token, '&limit=1');
        equal((first.body.notifications as Row[]).map((n) => n.stock_decision_id), [second], 'the newest');
        assert(/^[1-9]\d*$/.test(first.body.next_before), `a full page says where the next ends: ${first.body.next_before}`);
        const next = await bell(manager.token, `&limit=1&before=${first.body.next_before}`);
        equal((next.body.notifications as Row[]).map((n) => n.stock_decision_id), [overrides[0]], 'the one before it');
        equal(((next.body.notifications as Row[])[0]!.items as Row[])[0]!.on_hand, '-20',
          'each names the balance its own decision left');
        equal(((first.body.notifications as Row[])[0]!.items as Row[])[0]!.on_hand, '-30', 'and the second its own');
      });

      await t.step('marking read is the reader\'s own, once, and idempotent', async () => {
        const mine = (await bell(manager.token)).body.notifications as Row[];
        const theirs = (await bell(admin.token)).body.notifications as Row[];
        const stranger = await send('notifications', factory.token, 'POST', '/read',
          { facility_id: FACTORY, notification_ids: [mine[0]!.notification_id] });
        equal(stranger.body, { status: 'ok', marked: 0 }, 'nobody marks another\'s notification, even naming it');
        const one = await send('notifications', manager.token, 'POST', '/read',
          { facility_id: WAREHOUSE, notification_ids: [mine[0]!.notification_id] });
        equal(one.body, { status: 'ok', marked: 1 }, 'one marked');
        const again = await send('notifications', manager.token, 'POST', '/read',
          { facility_id: WAREHOUSE, notification_ids: [mine[0]!.notification_id] });
        equal(again.body, { status: 'ok', marked: 0 }, 'a retry marks nothing and is no error');
        equal(await unread(manager.token), 1, 'one left');
        const read = ((await bell(manager.token)).body.notifications as Row[]).find((n) => n.notification_id === mine[0]!.notification_id);
        assert(typeof read?.read_at === 'string', 'and it shows when it was read');
        equal(await unread(admin.token), 2, 'the administrator\'s copies are their own');
        const all = await send('notifications', admin.token, 'POST', '/read', { facility_id: WAREHOUSE, all: true });
        equal([all.body, await unread(admin.token)], [{ status: 'ok', marked: 2 }, 0], 'all, said');
        equal(theirs.length, 2, 'the administrator was told of both');
      });

      await t.step('an empty mark, a page past 100 and a cursor that is a moment are refused before the database', async () => {
        const empty = await send('notifications', manager.token, 'POST', '/read', { facility_id: WAREHOUSE, notification_ids: [] });
        equal([empty.http, empty.body], [400, { status: 'malformed', field: 'notification_ids' }], 'never read as all');
        const big = await bell(manager.token, '&limit=101');
        equal([big.http, big.body], [400, { status: 'malformed', field: 'limit' }], 'a page holds at most 100');
        const when = await bell(manager.token, '&before=2026-10-06T08:00:00Z');
        equal([when.http, when.body], [400, { status: 'malformed', field: 'before' }], 'a page ends before a seq');
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
        (select count(*)::int from erp.notification) as notifications,
        (select count(*)::int from erp.stock_decision where reason = ${reason}) as decisions,
        (select count(*)::int from erp.person_credential
          where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid, ${FACTORY_MANAGER}::uuid)) as pins`;
    equal([left?.['notifications'], left?.['decisions'], left?.['pins']], [0, 0, 0], 'after the rollback');
    equal(overrides.length, 2, 'both overrides were made');
  } finally {
    await owner.end();
  }
}));
