/**
 * The transfer-prices function end to end: the real router, the real driver, 0018's routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As suppliers.test.ts, two parts, against the synthetic seed, which opens
 * inventory.transfer_prices as `pilot` (0018 alone leaves it hidden), lets the accountant
 * set prices, and lets the managers and a branch worker read them:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads the price list at their
 *      branch, within their brand, and may set nothing. Another brand's item is answered
 *      as a missing one.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      The accountant and the warehouse manager have no PIN in the seed, so the
 *      transaction gives them one through erp.set_pin() and signs them in. Every request
 *      goes through the router and the driver in its own savepoint, and the rollback is
 *      checked afterwards.
 *
 * ONE TRANSACTION, ONE now(). The reads mark "in force" by now(), the transaction's
 * start, and a price set "from now" takes effect at the clock, a moment later. So inside
 * this test a price just set is not yet in force by the reads, as it would be in the
 * next request in production. The test reads it back as a price, not as the one in force.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { transferPrices } from '../../_shared/transfer-prices.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const ACCOUNTANT = '01936f00-0000-7000-8000-000000000907';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
/** RM-CHICKEN-WHOLE and its carton of 10: 18500, then 19000, then 19500 set ahead for 2099. */
const CHICKEN = '01936f00-0000-7000-8000-000000004101';
const CHICKEN_CARTON = '01936f00-0000-7000-8000-000000004203';
/** The carton's 19000, in effect since 2026-09-15. */
const CHICKEN_NOW = '01936f00-0000-7000-8000-000000005402';
/** PK-MEAL-BOX-M, and its pack of 50, which has no price. */
const MEAL_BOX = '01936f00-0000-7000-8000-000000004104';
const MEAL_BOX_PACK = '01936f00-0000-7000-8000-000000004213';
/** The SECOND brand's meal box, priced 150 a piece. */
const SECOND_BRAND_BOX = '01936f00-0000-7000-8000-000000004112';

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
  new Request(`http://edge.test/functions/v1/transfer-prices${path}`, {
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

Deno.test('as erp_edge, a cashier reads the prices at their branch, within their brand, and sets none', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    const list = await transferPrices(call(signedIn.token, 'GET', `?facility_id=${BRANCH_ONE}&limit=500`), deps);
    equal(list.status, 200, 'the list at their branch');
    const rows: Row[] = (await list.json()).prices;
    const carton = rows.find((r) => r.item_unit_id === CHICKEN_CARTON);
    equal([carton?.price_minor, carton?.currency, carton?.next_price_minor], [19000, 'SAR', 19500],
      'the carton\'s price now and next, as whole numbers of halalas');
    assert(!rows.some((r) => r.item_id === SECOND_BRAND_BOX), 'no row of another brand\'s item');
    assert(rows.some((r) => r.item_unit_id === MEAL_BOX_PACK && r.price_id === null), 'an unpriced pack is listed, unpriced');

    const other = await transferPrices(call(signedIn.token, 'GET', `/items/${SECOND_BRAND_BOX}?facility_id=${BRANCH_ONE}`), deps);
    const otherBody = await other.json();
    equal([other.status, otherBody.constraint], [404, 'item_exists'], 'another brand\'s item is answered as a missing one');

    const set = await transferPrices(call(signedIn.token, 'POST', '', {
      decision_id: crypto.randomUUID(), price_id: crypto.randomUUID(), item_unit_id: MEAL_BOX_PACK, price_minor: 1,
      currency: 'SAR', reason: 'A cashier tries.',
    }), deps);
    const setBody = await set.json();
    equal([set.status, setBody.status], [403, 'forbidden'], 'a cashier sets no price');
    assert(/may not write on capability inventory\.transfer_prices/.test(setBody.message), `the gate's own words: ${setBody.message}`);
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every transfer-prices route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8);
  const reason = `Integration test ${suffix}.`;
  const id = () => crypto.randomUUID();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ACCOUNTANT}::uuid, '100907', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const accountant = await db.signIn('1007', '100907');
      const manager = await db.signIn('1004', '100904');
      assert(accountant.status === 'ok' && manager.status === 'ok', 'the accountant and the warehouse manager sign in');
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Row }) { super('refused'); }
      }
      const send = async (method: string, path: string, body?: unknown, token = accountant.token): Promise<{ http: number; body: Row }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await transferPrices(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };
      const pricesOf = async (item: string): Promise<Row[]> => (await send('GET', `/items/${item}`)).body.prices;

      await t.step('an item\'s prices, every one ever set, amounts as numbers, the one in force marked', async () => {
        const prices = (await pricesOf(CHICKEN)).filter((p) => p.item_unit_id === CHICKEN_CARTON);
        equal(prices.map((p) => [p.price_minor, p.status, p.in_force]),
          [[20000, 'withdrawn', false], [19500, 'active', false], [19000, 'active', true], [18500, 'active', false]],
          'newest moment first');
      });

      const first = id();
      const firstPrice = id();
      await t.step('the accountant prices the unpriced pack, from now', async () => {
        const r = await send('POST', '', {
          decision_id: first, price_id: firstPrice, item_unit_id: MEAL_BOX_PACK, price_minor: 1200, currency: 'SAR', reason,
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: first } }, 'set');
        const mine = (await pricesOf(MEAL_BOX)).find((p) => p.price_id === firstPrice);
        equal([mine?.price_minor, mine?.currency, mine?.status], [1200, 'SAR', 'active'], 'read back');
      });

      await t.step('a retry is answered as a retry, whatever it carries', async () => {
        const r = await send('POST', '', {
          decision_id: first, price_id: id(), item_unit_id: MEAL_BOX_PACK, price_minor: 1300, currency: 'SAR', reason,
        });
        equal([r.http, r.body.status, r.body.constraint], [409, 'already_recorded', 'transfer_price_decision_pkey'], 'retry');
      });

      const ahead = id();
      await t.step('a price set ahead keeps the offset it was given', async () => {
        const r = await send('POST', '', {
          decision_id: id(), price_id: ahead, item_unit_id: MEAL_BOX_PACK, price_minor: 1400, currency: 'SAR',
          effective_from: '2099-06-01T00:00:00+03:00', reason,
        });
        equal(r.http, 200, 'set ahead');
        const mine = (await pricesOf(MEAL_BOX)).find((p) => p.price_id === ahead);
        equal(new Date(mine?.effective_from).toISOString(), '2099-05-31T21:00:00.000Z', 'midnight in Riyadh, not in UTC');
      });

      await t.step('the rules come back in the route\'s own words', async () => {
        const base = { price_id: id(), item_unit_id: MEAL_BOX_PACK, currency: 'SAR', reason };
        const past = await send('POST', '', { ...base, decision_id: id(), price_minor: 1500, effective_from: '2020-01-01T00:00:00Z' });
        equal([past.http, past.body.status, past.body.constraint], [422, 'invalid', 'transfer_price_not_backdated'], 'backdated');
        assert(past.body.hint === 'An order already placed keeps the price it was placed at.', `the hint reaches the person: ${past.body.hint}`);
        const next = await send('POST', '', { ...base, decision_id: id(), price_minor: 1400, effective_from: '2099-03-01T00:00:00+03:00' });
        equal([next.http, next.body.status, next.body.constraint], [422, 'refused', 'transfer_price_same_as_next'], 'the next price repeated');
        const moment = await send('POST', '', { ...base, decision_id: id(), price_minor: 1600, effective_from: '2099-06-01T00:00:00+03:00' });
        equal([moment.http, moment.body.status, moment.body.constraint], [409, 'conflict', 'transfer_price_one_per_moment'], 'one per moment');
        const usd = await send('POST', '', { ...base, decision_id: id(), price_minor: 1500, currency: 'USD' });
        equal([usd.http, usd.body.constraint], [422, 'transfer_price_currency_is_known'], 'another currency');
        const negative = await send('POST', '', { ...base, decision_id: id(), price_minor: -1 });
        equal([negative.http, negative.body.constraint], [422, 'transfer_price_is_minor_units'], 'a negative amount');
        const inEffect = await send('POST', `/${CHICKEN_NOW}/withdraw`, { decision_id: id(), reason });
        equal([inEffect.http, inEffect.body.status, inEffect.body.constraint], [422, 'refused', 'transfer_price_in_effect'], 'in effect');
      });

      await t.step('the warehouse manager reads, and may not set or withdraw', async () => {
        equal((await send('GET', `/items/${MEAL_BOX}`, undefined, manager.token)).http, 200, 'reads');
        const set = await send('POST', '', {
          decision_id: id(), price_id: id(), item_unit_id: MEAL_BOX_PACK, price_minor: 1700, currency: 'SAR', reason,
        }, manager.token);
        equal([set.http, set.body.status], [403, 'forbidden'], 'set');
        const withdraw = await send('POST', `/${ahead}/withdraw`, { decision_id: id(), reason }, manager.token);
        equal([withdraw.http, withdraw.body.status], [403, 'forbidden'], 'withdraw');
      });

      await t.step('a price set ahead is withdrawn, and stays on record', async () => {
        const r = await send('POST', `/${ahead}/withdraw`, { decision_id: id(), reason });
        equal(r.http, 200, 'withdrawn');
        const mine = (await pricesOf(MEAL_BOX)).find((p) => p.price_id === ahead);
        equal(mine?.status, 'withdrawn', 'on record as withdrawn');
        const again = await send('POST', `/${ahead}/withdraw`, { decision_id: id(), reason });
        equal([again.http, again.body.constraint], [422, 'transfer_price_already_withdrawn'], 'final');
      });

      await t.step('its history holds every decision, in order, amounts as numbers', async () => {
        const decisions: Row[] = (await send('GET', `/items/${MEAL_BOX}/history`)).body.decisions;
        const mine = decisions.filter((d) => d.reason === reason);
        equal(mine.map((d) => [d.kind, d.price_minor]), [['price_set', 1200], ['price_set', 1400], ['price_withdrawn', 1400]], 'history');
      });

      await t.step('at a branch, another brand is not revealed; organisation-wide, it is', async () => {
        const everywhere: Row[] = (await send('GET', '?limit=500')).body.prices;
        equal(everywhere.find((r) => r.item_id === SECOND_BRAND_BOX)?.price_minor, 150, 'organisation-wide');
        const atBranch: Row[] = (await send('GET', `?facility_id=${BRANCH_ONE}&limit=500`)).body.prices;
        assert(!atBranch.some((r) => r.item_id === SECOND_BRAND_BOX), 'not at a first-brand branch');
        for (const path of [`/items/${SECOND_BRAND_BOX}`, `/items/${SECOND_BRAND_BOX}/history`]) {
          const r = await send('GET', `${path}?facility_id=${BRANCH_ONE}`);
          equal([r.http, r.body.constraint], [404, 'item_exists'], path);
        }
      });

      await t.step('a conversion, a price or an item that does not exist is 404', async () => {
        const unit = await send('POST', '', {
          decision_id: id(), price_id: id(), item_unit_id: id(), price_minor: 100, currency: 'SAR', reason,
        });
        equal([unit.http, unit.body.status, unit.body.constraint], [404, 'not_found', 'item_unit_exists'], 'conversion');
        const price = await send('POST', `/${id()}/withdraw`, { decision_id: id(), reason });
        equal([price.http, price.body.constraint], [404, 'transfer_price_exists'], 'price');
        const item = await send('GET', `/items/${id()}`);
        equal([item.http, item.body.constraint], [404, 'item_exists'], 'item');
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
        (select count(*)::int from erp.transfer_price_decision where reason = ${reason}) as decisions,
        (select count(*)::int from erp.transfer_price where item_unit_id = ${MEAL_BOX_PACK}::uuid) as prices,
        (select count(*)::int from erp.person_credential where person_id in (${ACCOUNTANT}::uuid, ${MANAGER}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['prices'], left?.['pins']], [0, 0, 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
