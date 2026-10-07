/**
 * The purchase-orders function end to end: the real router, the real driver, 0023's
 * routes, and the stock a receipt moves, read through the stock function.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As stock-alerts.test.ts, two parts, against the synthetic seed, which opens both
 * purchasing capabilities as `pilot` (0023 alone leaves them hidden), sets a limit of
 * 5,000.00 at WH-001 and seeds six orders (0080), and lets the warehouse manager raise and
 * receive, and the accountant approve:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads no orders and raises none.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK,
 *      each request in its own savepoint, the rollback checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { purchaseOrders } from '../../_shared/purchase-orders.ts';
import { stock } from '../../_shared/stock.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const ACCOUNTANT = '01936f00-0000-7000-8000-000000000907';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
const POULTRY = '01936f00-0000-7000-8000-000000005101';
/** Chicken in cartons of 10 kg, which the poultry supplier sells. */
const CARTON = '01936f00-0000-7000-8000-000000004203';
const RICE = '01936f00-0000-7000-8000-000000004111';
/** The seed's orders: chicken, pending; rice and cola, approved by the limit; the factory's. */
const PENDING = '01936f00-0000-7000-8000-000000005901';
const RICE_AND_COLA = '01936f00-0000-7000-8000-000000005902';
const AT_FACTORY = '01936f00-0000-7000-8000-000000005906';
const WAREHOUSE_LIMIT = '01936f00-0000-7000-8000-000000006101';

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

Deno.test('as erp_edge, a cashier reads no orders and raises none', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    for (const facility of [BRANCH_ONE, WAREHOUSE]) {
      const list = await purchaseOrders(call('purchase-orders', signedIn.token, 'GET', `?facility_id=${facility}`), deps);
      const body = await list.json();
      equal([list.status, body.status], [403, 'forbidden'], `a cashier reads no orders at ${facility}`);
    }
    const raise = await purchaseOrders(call('purchase-orders', signedIn.token, 'POST', '', {
      decision_id: crypto.randomUUID(), purchase_order_id: crypto.randomUUID(), facility_id: WAREHOUSE, supplier_id: POULTRY,
      vat_rate_bp: 1500, lines: [{ item_unit_id: CARTON, quantity: '1', price_minor: 12500 }], reason: 'A cashier tries.',
    }), deps);
    equal([raise.status, (await raise.json()).status], [403, 'forbidden'], 'a cashier raises nothing');
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every purchase-orders route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8);
  const reason = `Integration test ${suffix}.`;
  const id = () => crypto.randomUUID();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${ACCOUNTANT}::uuid, '100907', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const admin = await db.signIn('1000', '100900');
      const manager = await db.signIn('1004', '100904');
      const accountant = await db.signIn('1007', '100907');
      assert(admin.status === 'ok' && manager.status === 'ok' && accountant.status === 'ok',
        'the administrator, the warehouse manager and the accountant sign in');
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Row }) { super('refused'); }
      }
      const routers = { 'purchase-orders': purchaseOrders, stock } as const;
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
        through('purchase-orders', method, path, body, token);
      const order = async (orderId: string, token = manager.token): Promise<Row> => {
        const r = await send('GET', `/${orderId}?facility_id=${WAREHOUSE}`, undefined, token);
        equal(r.http, 200, `the order ${orderId}`);
        return r.body.order as Row;
      };
      const riceOnHand = async (): Promise<string | undefined> => {
        const page = await through('stock', 'GET', `?facility_id=${WAREHOUSE}&search=RM-RICE`, undefined, manager.token);
        return (page.body.balances as Row[]).find((b) => b.item_id === RICE)?.on_hand;
      };

      await t.step('the list carries amounts as numbers, newest first, and only the warehouse\'s', async () => {
        const page = await send('GET', `?facility_id=${WAREHOUSE}`);
        const orders = page.body.orders as Row[];
        equal(orders.map((o) => [o.state, o.progress]),
          [['cancelled', 'none'], ['rejected', 'none'], ['approved', 'none'], ['approved', 'none'], ['pending', 'none']],
          'five orders at the warehouse');
        const chicken = orders.find((o) => o.purchase_order_id === PENDING);
        equal([chicken?.subtotal_minor, chicken?.vat_minor, chicken?.total_minor, chicken?.vat_rate_bp, typeof chicken?.seq],
          [750000, 112500, 862500, 1500, 'string'], 'halalas as numbers, a seq as text');
        // A business date is the facility's day as text: a date cast to a JavaScript Date
        // comes back as UTC midnight, a day early in Riyadh (the stock module's finding).
        assert(/^\d{4}-\d{2}-\d{2}$/.test(String(chicken?.business_date)), `a business date as text: ${chicken?.business_date}`);
        const pending = await send('GET', `?facility_id=${WAREHOUSE}&state=pending`);
        equal((pending.body.orders as Row[]).map((o) => o.purchase_order_id), [PENDING], 'one state');
        const unnamed = await send('GET', '', undefined, admin.token);
        equal([unnamed.http, unnamed.body.constraint], [422, 'stock_facility_required'], 'a read names its facility');
        const elsewhere = await send('GET', `/${AT_FACTORY}?facility_id=${WAREHOUSE}`);
        equal([elsewhere.http, elsewhere.body.constraint], [404, 'purchase_order_exists'],
          'the factory\'s order asked for at the warehouse answers as a missing one');
      });

      await t.step('an order reads whole: quantities as text, prices as numbers', async () => {
        const o = await order(RICE_AND_COLA);
        equal([o.state, o.progress, o.subtotal_minor, o.vat_minor], ['approved', 'none', 126000, 0], 'approved by the limit, 0% VAT');
        assert(/^\d{4}-\d{2}-\d{2}$/.test(String(o.business_date)), `a business date as text: ${o.business_date}`);
        equal((o.lines as Row[]).map((l) => [l.line_no, l.unit_key, l.quantity, l.price_minor, l.amount_minor, l.received, l.remaining]),
          [[1, 'bag', '20', 4500, 90000, '0', '20'], [2, 'carton', '10', 3600, 36000, '0', '10']], 'its lines');
        equal((o.decisions as Row[]).map((d) => [d.kind, d.state, d.limit_decision_id]),
          [['order_raised', 'approved', WAREHOUSE_LIMIT]], 'approved when raised, by the limit');
      });

      const small = id();
      await t.step('an order within the limit is approved when raised, and a retry is answered as a retry', async () => {
        const decision = id();
        const body = {
          decision_id: decision, purchase_order_id: small, facility_id: WAREHOUSE, supplier_id: POULTRY, vat_rate_bp: 1500,
          lines: [{ item_unit_id: CARTON, quantity: '2', price_minor: 12500 }], reason,
        };
        equal(await send('POST', '', body), { http: 200, body: { status: 'ok', decision_id: decision, purchase_order_id: small } }, 'raised');
        const o = await order(small);
        equal([o.state, o.subtotal_minor, o.vat_minor, o.total_minor], ['approved', 25000, 3750, 28750], '250.00 and 15% VAT');
        assert(/^WH-001-PO-\d{8}-\d{4}$/.test(o.number), `numbered by its facility and day: ${o.number}`);
        const retry = await send('POST', '', { ...body, vat_rate_bp: 0 });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'purchase_order_decision_pkey'], 'retry');
        equal(((await order(small)).decisions as Row[]).map((d) => d.decision_id), [decision], 'the console confirms it');
        const reused = await send('POST', '', { ...body, decision_id: id() });
        equal([reused.http, reused.body.status, reused.body.constraint], [409, 'conflict', 'purchase_order_raised_once'],
          'the same order id under another decision is a different order');
      });

      const large = id();
      await t.step('an order over the limit waits; its raiser does not approve it; the accountant does', async () => {
        const raised = await send('POST', '', {
          decision_id: id(), purchase_order_id: large, facility_id: WAREHOUSE, supplier_id: POULTRY, vat_rate_bp: 1500,
          lines: [{ item_unit_id: CARTON, quantity: '50', price_minor: 12500 }], reason,
        }, admin.token);
        equal(raised.http, 200, 'raised by the administrator');
        equal((await order(large)).state, 'pending', '6,250.00 is over the limit');
        const own = await send('POST', `/${large}/approve`, { decision_id: id(), facility_id: WAREHOUSE, reason }, admin.token);
        equal([own.http, own.body.status, own.body.constraint], [422, 'refused', 'purchase_order_self_approval'],
          'nobody approves an order they raised (PRC-004)');
        const notTheirs = await send('POST', `/${large}/approve`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([notTheirs.http, notTheirs.body.status], [403, 'forbidden'], 'the warehouse manager does not approve');
        const approval = id();
        const approved = await send('POST', `/${large}/approve`, { decision_id: approval, facility_id: WAREHOUSE, reason }, accountant.token);
        equal(approved.http, 200, 'the accountant approves');
        equal((await order(large)).state, 'approved', 'approved');
        const retry = await send('POST', `/${large}/approve`, { decision_id: approval, facility_id: WAREHOUSE, reason }, accountant.token);
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'purchase_order_decision_pkey'],
          'an approval retried');
        assert(((await order(large)).decisions as Row[]).some((d) => d.decision_id === approval), 'the console confirms it');
      });

      let receipt = '';
      await t.step('goods received go into stock, and the order shows what is still to come', async () => {
        const before = await riceOnHand();
        receipt = id();
        const received = await send('POST', `/${RICE_AND_COLA}/receipts`, {
          decision_id: receipt, facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '5' }], delivery_note: 'DN-7',
        });
        equal(received, { http: 200, body: { status: 'ok', decision_id: receipt } }, 'received 5 bags');
        equal([before, await riceOnHand()], ['100', '125'], '5 bags of 5 kg in');
        const o = await order(RICE_AND_COLA);
        equal([o.progress, (o.lines as Row[])[0]?.received, (o.lines as Row[])[0]?.remaining], ['partial', '5', '15'], 'part arrived');
        equal((o.receipts as Row[]).map((r) => [r.decision_id, r.delivery_note, r.reversed_by_decision_id]),
          [[receipt, 'DN-7', null]], 'the receipt the console confirms a retry against');
        const retry = await send('POST', `/${RICE_AND_COLA}/receipts`, {
          decision_id: receipt, facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '5' }], delivery_note: 'DN-7',
        });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'stock_decision_pkey'],
          'a receipt retried');
        equal(await riceOnHand(), '125', 'and nothing more arrived');
        const over = await send('POST', `/${RICE_AND_COLA}/receipts`, {
          decision_id: id(), facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '16' }],
        });
        equal([over.http, over.body.constraint], [422, 'purchase_receipt_exceeds_order'], 'never more than is still to come');
        // The edge bounds a note's size; 0023 holds it to 64 characters once trimmed, and says so.
        const longNote = await send('POST', `/${RICE_AND_COLA}/receipts`, {
          decision_id: id(), facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '1' }], delivery_note: `  ${'N'.repeat(65)}  `,
        });
        equal([longNote.http, longNote.body.status, longNote.body.constraint], [422, 'invalid', 'purchase_receipt_delivery_note_is_canonical'],
          'a delivery note past 64 characters is 0023\'s refusal, worded');
        const numeric = await send('POST', `/${RICE_AND_COLA}/receipts`, {
          decision_id: id(), facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: 1 }],
        });
        equal([numeric.http, numeric.body], [400, { status: 'malformed', field: 'lines[0].quantity' }], 'a quantity is decimal text');
        const pending = await send('POST', `/${PENDING}/receipts`, {
          decision_id: id(), facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '1' }],
        });
        equal([pending.http, pending.body.constraint], [422, 'purchase_order_not_approved'], 'nothing arrives against a pending order');
      });

      await t.step('a receipt is reversed through its order, never the stock route, and the order reopens', async () => {
        const viaStock = await through('stock', 'POST', `/decisions/${receipt}/reverse`, {
          decision_id: id(), facility_id: WAREHOUSE, reason,
        }, manager.token);
        equal([viaStock.http, viaStock.body.constraint], [422, 'stock_receipt_reversed_through_its_order'], 'the stock route refuses');
        const reversal = id();
        const reversed = await send('POST', `/receipts/${receipt}/reverse`, { decision_id: reversal, facility_id: WAREHOUSE, reason });
        equal(reversed, { http: 200, body: { status: 'ok', decision_id: reversal } }, 'reversed');
        equal(await riceOnHand(), '100', 'the stock went back out');
        const o = await order(RICE_AND_COLA);
        equal([o.progress, (o.receipts as Row[])[0]?.reversed_by_decision_id], ['none', reversal], 'reopened, and the reversal shown');
        const retry = await send('POST', `/receipts/${receipt}/reverse`, { decision_id: reversal, facility_id: WAREHOUSE, reason });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'stock_decision_pkey'],
          'a reversal retried, which the order confirms');
        const again = await send('POST', `/receipts/${receipt}/reverse`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([again.http, again.body.status, again.body.constraint], [409, 'conflict', 'stock_already_reversed'], 'once');
      });

      await t.step('cancelling, closing and rejecting, each by its own path', async () => {
        const cancel = await send('POST', `/${small}/cancel`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal(cancel.http, 200, 'nothing received: cancelled');
        equal((await order(small)).state, 'cancelled', 'cancelled');
        const recv = await send('POST', `/${large}/receipts`, {
          decision_id: id(), facility_id: WAREHOUSE, lines: [{ line_no: 1, quantity: '10' }],
        });
        equal(recv.http, 200, 'ten of fifty cartons arrived');
        const cancelLarge = await send('POST', `/${large}/cancel`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal([cancelLarge.http, cancelLarge.body.constraint], [422, 'purchase_order_has_receipts'], 'not with goods received');
        const close = await send('POST', `/${large}/close`, { decision_id: id(), facility_id: WAREHOUSE, reason });
        equal(close.http, 200, 'closed short');
        equal([(await order(large)).state, (await order(large)).progress], ['closed', 'partial'], 'closed, part received');
        const reject = await send('POST', `/${PENDING}/reject`, { decision_id: id(), facility_id: WAREHOUSE, reason }, accountant.token);
        equal(reject.http, 200, 'the accountant rejects the pending chicken');
        equal((await order(PENDING)).state, 'rejected', 'rejected');
      });

      await t.step('limits: read by the approver, set and cleared only by the administrator, against their stamp', async () => {
        const history = await send('GET', `/limits?facility_id=${WAREHOUSE}`, undefined, accountant.token);
        equal((history.body.decisions as Row[]).map((d) => [d.kind, d.limit_minor, d.is_current]),
          [['limit_set', 500000, true]], 'the warehouse\'s limit, as a number');
        const managerReads = await send('GET', `/limits?facility_id=${WAREHOUSE}`);
        equal(managerReads.http, 403, 'the warehouse manager does not read the limits');
        const byApprover = await send('POST', '/limits', {
          decision_id: id(), facility_id: WAREHOUSE, limit_minor: 900000, currency: 'SAR', expected_decision_id: WAREHOUSE_LIMIT, reason,
        }, accountant.token);
        equal(byApprover.http, 403, 'the approver does not set the limit that approves without them');
        const set = id();
        equal(await send('POST', '/limits', {
          decision_id: set, facility_id: FACTORY, limit_minor: 300000, currency: 'SAR', expected_decision_id: null, reason,
        }, admin.token), { http: 200, body: { status: 'ok', decision_id: set } }, 'a first limit at the factory, against none');
        const retrySet = await send('POST', '/limits', {
          decision_id: set, facility_id: FACTORY, limit_minor: 300000, currency: 'SAR', expected_decision_id: null, reason,
        }, admin.token);
        equal([retrySet.http, retrySet.body.status, retrySet.body.constraint], [409, 'already_recorded', 'purchase_limit_decision_pkey'],
          'a limit retried');
        const factory = await send('GET', `/limits?facility_id=${FACTORY}`, undefined, admin.token);
        equal((factory.body.decisions as Row[]).map((d) => [d.decision_id, d.limit_minor]), [[set, 300000]], 'which the history confirms');
        const stale = await send('POST', '/limits', {
          decision_id: id(), facility_id: FACTORY, limit_minor: 400000, currency: 'SAR', expected_decision_id: null, reason,
        }, admin.token);
        equal([stale.http, stale.body.status], [409, 'stale'], 'a form read before it is stale');
        const asText = await send('POST', '/limits', {
          decision_id: id(), facility_id: FACTORY, limit_minor: '400000', currency: 'SAR', expected_decision_id: set, reason,
        }, admin.token);
        equal([asText.http, asText.body], [400, { status: 'malformed', field: 'limit_minor' }], 'an amount is a number');
        const cleared = id();
        equal(await send('POST', '/limits/clear', { decision_id: cleared, facility_id: FACTORY, expected_decision_id: set, reason }, admin.token),
          { http: 200, body: { status: 'ok', decision_id: cleared } }, 'cleared');
        const retryClear = await send('POST', '/limits/clear', { decision_id: cleared, facility_id: FACTORY, expected_decision_id: set, reason }, admin.token);
        equal([retryClear.http, retryClear.body.status, retryClear.body.constraint], [409, 'already_recorded', 'purchase_limit_decision_pkey'],
          'a clearing retried');
        const after = await send('GET', `/limits?facility_id=${FACTORY}`, undefined, admin.token);
        equal((after.body.decisions as Row[]).map((d) => [d.decision_id, d.limit_minor, d.is_current]),
          [[cleared, null, true], [set, 300000, false]], 'a cleared limit has no amount, and its clearing is in force');
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
        (select count(*)::int from erp.purchase_order_decision where reason = ${reason}) as decisions,
        (select count(*)::int from erp.purchase_receipt) as receipts,
        (select on_hand::text from erp.stock_balance where facility_id = ${WAREHOUSE}::uuid and item_id = ${RICE}::uuid) as rice,
        (select count(*)::int from erp.purchase_limit_decision) as limits,
        (select count(*)::int from erp.person_credential
          where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid, ${ACCOUNTANT}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['receipts'], left?.['rice'], left?.['limits'], left?.['pins']], [0, 0, '100', 1, 0],
      'after the rollback');
  } finally {
    await owner.end();
  }
}));
