/**
 * The stock function end to end: the real router, the real driver, 0020's routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As facilities.test.ts, two parts, against the synthetic seed, which opens
 * inventory.stock as `pilot` (0020 alone leaves it hidden), seeds WH-001 and FA-001 with
 * an opening count and a few movements (0070), lets the managers write at their own
 * facilities, and gives the override to the administrator and the factory manager only:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads stock at their branch,
 *      which holds none, and reads nothing at the warehouse or writes anything anywhere.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      The administrator, the warehouse manager and the factory manager have no PIN in the
 *      seed, so the transaction gives them one through erp.set_pin() and signs them in.
 *      Every request goes through the router and the driver in its own savepoint, and the
 *      rollback is checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { stock } from '../../_shared/stock.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACTORY_MANAGER = '01936f00-0000-7000-8000-000000000908';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
/** Chicken breast: kilograms (factor 1) and cartons of 10 kg. 121.5 kg at WH-001, -10 kg at FA-001. */
const CHICKEN = '01936f00-0000-7000-8000-000000004101';
const KG = '01936f00-0000-7000-8000-000000004201';
const CARTON = '01936f00-0000-7000-8000-000000004203';
/** The second brand's meal box, in pieces: a conversion no facility of the first brand holds. */
const OTHER_BRAND_PIECE = '01936f00-0000-7000-8000-000000004227';
/** WH-001's opening count, and the waste the seed recorded after it. */
const OPENING = '01936f00-0000-7000-8000-000000005701';
const SEEDED_WASTE = '01936f00-0000-7000-8000-000000005703';

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
  new Request(`http://edge.test/functions/v1/stock${path}`, {
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

Deno.test('as erp_edge, a cashier reads their branch\'s stock, which is none, and nothing else', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    const own = await stock(call(signedIn.token, 'GET', `?facility_id=${BRANCH_ONE}`), deps);
    equal([own.status, (await own.json()).balances], [200, []], 'a branch holds no stock record (Q-06)');
    const warehouse = await stock(call(signedIn.token, 'GET', `?facility_id=${WAREHOUSE}`), deps);
    const body = await warehouse.json();
    equal([warehouse.status, body.status], [403, 'forbidden'], 'a cashier reads nothing at the warehouse');
    assert(/may not read on capability inventory\.stock/.test(body.message), `the gate's own words: ${body.message}`);
    const waste = await stock(call(signedIn.token, 'POST', '/adjustments', {
      decision_id: crypto.randomUUID(), facility_id: WAREHOUSE, kind: 'waste',
      lines: [{ item_unit_id: KG, quantity: '1' }], reason: 'A cashier tries.',
    }), deps);
    equal([waste.status, (await waste.json()).status], [403, 'forbidden'], 'a cashier writes off nothing');
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every stock route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
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
      const send = async (method: string, path: string, body?: unknown, token = manager.token): Promise<{ http: number; body: Row }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await stock(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };
      const chicken = async (facility = WAREHOUSE): Promise<Row> => {
        const page = await send('GET', `?facility_id=${facility}&search=RM-CHK-BREAST&limit=500`, undefined, admin.token);
        equal(page.http, 200, `read at ${facility}`);
        const row = (page.body.balances as Row[]).find((b) => b.item_id === CHICKEN);
        assert(row !== undefined, `chicken is held at ${facility}`);
        return row;
      };

      await t.step('a balance reads back as decimal text, with every pack\'s factor as text', async () => {
        const row = await chicken();
        equal([row.on_hand, row.last_counted_at !== null], ['121.5', true], 'WH-001 holds 121.5 kg, counted');
        const carton = (row.units as Row[]).find((u) => u.item_unit_id === CARTON);
        equal(carton?.factor, '10', 'a carton is 10 kg, as text');
        equal((await chicken(FACTORY)).on_hand, '-10', 'FA-001 stands below zero after the override (D1)');
        const negative = await send('GET', `?facility_id=${FACTORY}&negative=true`, undefined, admin.token);
        equal((negative.body.balances as Row[]).map((b) => b.item_id), [CHICKEN], 'only what stands below zero');
      });

      await t.step('a decision reads back with what it posted and what it found, as text, at its own facility only', async () => {
        const opening = await send('GET', `/decisions/${OPENING}?facility_id=${WAREHOUSE}`);
        equal(opening.http, 200, 'the opening count');
        const d = opening.body.decision as Row;
        equal(d.kind, 'count', 'a count');
        const found = (d.counted as Row[]).find((c) => c.item_unit_id === CARTON);
        equal([found?.quantity, found?.base_quantity], ['12', '120'], 'twelve cartons, 120 kg');
        const elsewhere = await send('GET', `/decisions/${OPENING}?facility_id=${FACTORY}`, undefined, admin.token);
        equal([elsewhere.http, elsewhere.body.constraint], [404, 'stock_decision_exists'],
          'a decision asked at another facility is answered as a missing one');
      });

      const counted = id();
      await t.step('a count stated late names its offset, and posts what it found less the book at its moment', async () => {
        const body = {
          decision_id: counted, facility_id: WAREHOUSE, counted_at: '2026-10-01T09:00:00+03:00',
          lines: [{ item_unit_id: CARTON, quantity: '12' }, { item_unit_id: KG, quantity: '0.5' }], reason,
        };
        equal(await send('POST', '/counts', body), { http: 200, body: { status: 'ok', decision_id: counted } }, 'counted');
        const row = await chicken();
        equal([row.on_hand, row.last_counted_at, row.as_of_decision_id], ['120.5', '2026-10-01T06:00:00.000Z', counted],
          '120.5 kg found, counted at 09:00 Riyadh, which is 06:00 UTC');
        const naive = await send('POST', '/counts', { ...body, decision_id: id(), counted_at: '2026-10-01T09:00:00' });
        equal([naive.http, naive.body], [400, { status: 'malformed', field: 'counted_at' }],
          'a moment without its offset would be read as UTC, three hours out');
        const decision = (await send('GET', `/decisions/${counted}?facility_id=${WAREHOUSE}`)).body.decision as Row;
        equal((decision.entries as Row[]).map((e) => [e.direction, e.quantity, e.unit_key]), [['out', '1', 'kg']],
          'the variance, in the base unit');
      });

      const wasted = id();
      await t.step('a waste after the count goes through, and a retry is answered as a retry', async () => {
        const body = {
          decision_id: wasted, facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: '1.5' }], reason,
        };
        equal(await send('POST', '/adjustments', body), { http: 200, body: { status: 'ok', decision_id: wasted } }, 'wasted');
        equal((await chicken()).on_hand, '119', '1.5 kg out');
        const retry = await send('POST', '/adjustments', { ...body, lines: [{ item_unit_id: KG, quantity: '99' }] });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'stock_decision_pkey'], 'retry');
        equal((await chicken()).on_hand, '119', 'the retry moved nothing');
        const confirm = await send('GET', `/decisions/${wasted}?facility_id=${WAREHOUSE}`);
        equal([confirm.http, (confirm.body.decision as Row).reason], [200, reason], 'the console confirms a retry at its facility');
      });

      await t.step('a movement is never dated at or before the last count, nor within a stated count\'s minute', async () => {
        for (const at of ['2026-10-01T08:59:00+03:00', '2026-10-01T06:00:00Z', '2026-10-01T09:00:30+03:00']) {
          const r = await send('POST', '/adjustments', {
            decision_id: id(), facility_id: WAREHOUSE, kind: 'damage', occurred_at: at, lines: [{ item_unit_id: KG, quantity: '1' }], reason,
          });
          equal([r.http, r.body.status, r.body.constraint], [422, 'refused', 'stock_backdated_before_count'], at);
        }
        const future = await send('POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'damage', occurred_at: '2099-01-01T00:00:00+03:00',
          lines: [{ item_unit_id: KG, quantity: '1' }], reason,
        });
        equal([future.http, future.body.constraint], [422, 'stock_not_in_future'], 'nor in the future');
      });

      await t.step('stock never goes below zero without a person who may override, and their reason (D1)', async () => {
        const body = {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: CARTON, quantity: '20' }], reason,
        };
        const refused = await send('POST', '/adjustments', body);
        equal([refused.http, refused.body.status, refused.body.constraint], [422, 'refused', 'stock_would_go_negative'], 'refused');
        assert(typeof refused.body.message === 'string' && refused.body.message.length > 0, 'in the route\'s words');
        const unpermitted = await send('POST', '/adjustments', { ...body, override_reason: 'Delivery not yet entered.' });
        equal([unpermitted.http, unpermitted.body.status], [403, 'forbidden'], 'the warehouse manager may not override');
        equal((await chicken()).on_hand, '119', 'nothing moved');

        const atFactory = {
          decision_id: id(), facility_id: FACTORY, kind: 'waste', lines: [{ item_unit_id: CARTON, quantity: '1' }],
          override_reason: 'Delivery not yet entered.', reason,
        };
        equal((await send('POST', '/adjustments', atFactory, factory.token)).http, 200, 'the factory manager overrides at the factory');
        equal((await chicken(FACTORY)).on_hand, '-20', 'and the factory stands at -20 kg');
        const notTheirs = await send('POST', '/adjustments', { ...body, decision_id: id(), override_reason: 'Elsewhere.' }, factory.token);
        equal([notTheirs.http, notTheirs.body.status], [403, 'forbidden'], 'but not at the warehouse');
      });

      await t.step('a reversal mirrors its target, once', async () => {
        const undo = id();
        const r = await send('POST', `/decisions/${wasted}/reverse`, { decision_id: undo, facility_id: WAREHOUSE, reason });
        equal(r, { http: 200, body: { status: 'ok', decision_id: undo } }, 'reversed');
        equal((await chicken()).on_hand, '120.5', 'the 1.5 kg is back');
        const again = await send('POST', `/decisions/${wasted}/reverse`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([again.http, again.body.status, again.body.constraint], [409, 'conflict', 'stock_already_reversed'], 'once');
        const seeded = await send('POST', `/decisions/${SEEDED_WASTE}/reverse`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([seeded.http, seeded.body.constraint], [422, 'stock_reversal_counted_since'],
          'a decision a count has since covered is corrected by counting, not by reversing');
        const count = await send('POST', `/decisions/${counted}/reverse`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([count.http, count.body.constraint], [422, 'stock_decision_is_not_reversible'], 'a count is not reversed');
        const elsewhere = await send('POST', `/decisions/${wasted}/reverse`, { decision_id: id(), facility_id: FACTORY, reason }, admin.token);
        equal([elsewhere.http, elsewhere.body.constraint], [404, 'stock_decision_exists'], 'nor from another facility');
      });

      await t.step('its history holds every decision, newest first, paged by seq', async () => {
        const page = await send('GET', `/items/${CHICKEN}?facility_id=${WAREHOUSE}`);
        const kinds = (page.body.decisions as Row[]).map((d) => d.kind);
        equal(kinds, ['reversal', 'waste', 'count', 'waste', 'count'], 'history');
        equal(page.body.next_before, null, 'one page');
        const first = await send('GET', `/items/${CHICKEN}?facility_id=${WAREHOUSE}&limit=2`);
        equal((first.body.decisions as Row[]).map((d) => d.kind), ['reversal', 'waste'], 'the newest two');
        assert(/^\d+$/.test(first.body.next_before), `the next page ends before a seq, as text: ${first.body.next_before}`);
        const second = await send('GET', `/items/${CHICKEN}?facility_id=${WAREHOUSE}&limit=2&before=${first.body.next_before}`);
        equal((second.body.decisions as Row[]).map((d) => d.kind), ['count', 'waste'], 'the two before them');
        const decision = (page.body.decisions as Row[]).find((d) => d.decision_id === counted);
        equal([decision?.counted, decision?.quantity_out], ['120.5', '1'], 'a count shows what it found and its variance, as text');
      });

      await t.step('a branch, a facility left out, another brand\'s pack and a quantity sent as a number are refused', async () => {
        const branch = await send('POST', '/adjustments', {
          decision_id: id(), facility_id: BRANCH_ONE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: '1' }], reason,
        }, admin.token);
        equal([branch.http, branch.body.status, branch.body.constraint], [422, 'refused', 'stock_branch_business_day_undecided'],
          'a branch holds no stock yet (Q-06)');
        const unnamed = await send('GET', '', undefined, admin.token);
        equal([unnamed.http, unnamed.body.constraint], [422, 'stock_facility_required'], 'a read names its facility');
        const other = await send('POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: OTHER_BRAND_PIECE, quantity: '1' }], reason,
        });
        equal([other.http, other.body.status, other.body.constraint], [404, 'not_found', 'item_unit_exists'],
          'another brand\'s pack is answered as a missing one');
        const numeric = await send('POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: 1.5 }], reason,
        });
        equal([numeric.http, numeric.body], [400, { status: 'malformed', field: 'lines[0].quantity' }], 'a quantity is decimal text');
        const places = await send('POST', '/adjustments', {
          decision_id: id(), facility_id: WAREHOUSE, kind: 'waste', lines: [{ item_unit_id: KG, quantity: '0.1234567' }], reason,
        });
        equal([places.http, places.body.constraint], [422, 'stock_quantity_is_valid'], 'six places at most, by 0020\'s rule');
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
        (select count(*)::int from erp.stock_decision where reason = ${reason}) as decisions,
        (select on_hand::text from erp.stock_balance where facility_id = ${WAREHOUSE}::uuid and item_id = ${CHICKEN}::uuid) as on_hand,
        (select count(*)::int from erp.person_credential
          where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid, ${FACTORY_MANAGER}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['on_hand'], left?.['pins']], [0, '121.5', 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
