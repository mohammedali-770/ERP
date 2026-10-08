/**
 * The ordering-setup function end to end: the real router, the real driver, 0024's routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As stock-alerts.test.ts, two parts, against the synthetic seed, which opens
 * ordering.setup and ordering.par_levels as `pilot` (0024 alone leaves them hidden) and
 * holds 0085's sources, cut-offs and pars:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads their own branch's pars
 *      and the cut-offs of their brand's warehouses and factories, reads no other branch's
 *      pars, and sets nothing.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK,
 *      each request in its own savepoint, the rollback checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { orderingSetup } from '../../_shared/ordering-setup.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const FACTORY_MANAGER = '01936f00-0000-7000-8000-000000000908';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const BRANCH_TWO = '01936f00-0000-7000-8000-000000000402';
const WAREHOUSE = '01936f00-0000-7000-8000-000000000403';
const FACTORY = '01936f00-0000-7000-8000-000000000404';
/** Chicken breast, supplied by WH-001: 3 cartons at BR-001, 20 kg at BR-002 (0085). */
const CHICKEN = '01936f00-0000-7000-8000-000000004101';
const CARTON = '01936f00-0000-7000-8000-000000004203';
/** Chicken strips, made at FA-001: 2 trays of 40 at BR-001, none at BR-002. */
const STRIPS = '01936f00-0000-7000-8000-000000004102';
const TRAY = '01936f00-0000-7000-8000-000000004207';
/** Cola, from WH-001: cartons of 24. */
const COLA_CARTON = '01936f00-0000-7000-8000-000000004210';
/** Frying oil: never had a source. Gloves: a source, then cleared. */
const OIL = '01936f00-0000-7000-8000-000000004110';
const GLOVES = '01936f00-0000-7000-8000-000000004106';
/** The second brand's meal box, in pieces: a conversion no branch of the first brand holds. */
const OTHER_BRAND_PIECE = '01936f00-0000-7000-8000-000000004227';
/** The seed's decisions: WH-001's and FA-001's cut-offs, BR-002's chicken par. */
const SEEDED_WAREHOUSE_CUTOFF = '01936f00-0000-7000-8000-000000006211';
const SEEDED_FACTORY_CUTOFF = '01936f00-0000-7000-8000-000000006213';
const SEEDED_BRANCH_TWO_CHICKEN = '01936f00-0000-7000-8000-000000006224';

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
  new Request(`http://edge.test/functions/v1/ordering-setup${path}`, {
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

Deno.test('as erp_edge, a cashier reads their own branch\'s pars and their brand\'s cut-offs, and sets nothing', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    const send = async (method: string, path: string, body?: unknown) => {
      const response = await orderingSetup(call(signedIn.token, method, path, body), deps);
      return { http: response.status, body: await response.json() as Row };
    };
    const pars = await send('GET', `/pars/${BRANCH_ONE}?facility_id=${BRANCH_ONE}`);
    equal((pars.body.pars as Row[]).map((p) => [p.code, p.par, p.unit_key, p.quantity]),
      [['FP-COLA-330', '48', 'carton', '2'], ['RM-CHK-BREAST', '30', 'carton', '3'], ['SF-CHK-STRIPS', '80', 'tray', '2']],
      'their branch\'s pars, as entered and in the base unit, as text');
    const cutoffs = await send('GET', `/cutoffs?facility_id=${BRANCH_ONE}`);
    equal((cutoffs.body.cutoffs as Row[]).map((c) => [c.code, c.cutoff]), [['FA-001', '11:00'], ['WH-001', '14:00']],
      'the cut-offs of every warehouse and factory of their brand, as HH:MM');
    const first = await send('GET', `/pars/${BRANCH_ONE}?facility_id=${BRANCH_ONE}&limit=1`);
    equal([(first.body.pars as Row[]).map((p) => p.code), first.body.next_after], [['FP-COLA-330'], 'FP-COLA-330'],
      'a full page names where the next one starts');
    const next = await send('GET', `/pars/${BRANCH_ONE}?facility_id=${BRANCH_ONE}&limit=1&after=${first.body.next_after}`);
    equal((next.body.pars as Row[]).map((p) => p.code), ['RM-CHK-BREAST'], 'and the next page starts after it');
    const fromOwn = await send('GET', `/pars/${BRANCH_TWO}?facility_id=${BRANCH_ONE}`);
    equal([fromOwn.http, fromOwn.body.constraint], [422, 'par_level_read_scope'], 'no other branch\'s pars from their own');
    const atOther = await send('GET', `/pars/${BRANCH_TWO}?facility_id=${BRANCH_TWO}`);
    equal([atOther.http, atOther.body.status], [403, 'forbidden'], 'nor at the other branch');
    const set = await send('POST', `/pars/${BRANCH_ONE}`, {
      decision_id: crypto.randomUUID(), facility_id: BRANCH_ONE, item_unit_id: CARTON, quantity: '5',
      expected_decision_id: null, reason: 'A cashier tries.',
    });
    equal([set.http, set.body.status], [403, 'forbidden'], 'a cashier sets no par');
    assert(/ordering\.par_levels/.test(set.body.message), `the gate's own words: ${set.body.message}`);
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every ordering-setup route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
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
      const send = async (method: string, path: string, body: unknown, token: string) => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await orderingSetup(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() as Row };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };

      await t.step('sources: listed, set, retried, confirmed, refused when stale or unchanged, and cleared', async () => {
        const list = await send('GET', '/sources?limit=500', undefined, admin.token);
        const of = (code: string) => (list.body.sources as Row[]).find((s) => s.code === code);
        equal([of('SF-CHK-STRIPS')?.facility_code, of('OP-GLOVES')?.facility_id, of('RM-FRYING-OIL')?.as_of_decision_id],
          ['FA-001', null, null], 'strips from the factory; gloves cleared; frying oil never had one');
        const narrowed = await send('GET', `/sources?supplied_by=${FACTORY}`, undefined, admin.token);
        equal((narrowed.body.sources as Row[]).map((s) => s.code), ['SF-CHK-STRIPS'], 'what the factory supplies');
        const atFactory = await send('GET', `/sources?facility_id=${FACTORY}&supplied_by=${FACTORY}`, undefined, factory.token);
        equal((atFactory.body.sources as Row[]).map((s) => s.code), ['SF-CHK-STRIPS'], 'read by its manager, at the factory');
        const stripsHistory = await send('GET', `/sources/${STRIPS}?facility_id=${FACTORY}`, undefined, factory.token);
        equal((stripsHistory.body.decisions as Row[]).map((d) => [d.kind, d.facility_code, d.is_current]),
          [['source_set', 'FA-001', true]], 'and its history, at the factory');
        const page = await send('GET', '/sources?limit=2', undefined, admin.token);
        const after = await send('GET', `/sources?limit=2&after=${page.body.next_after}`, undefined, admin.token);
        equal([(page.body.sources as Row[]).map((s) => s.code), page.body.next_after, (after.body.sources as Row[])[0]?.code],
          [['B2-PKG-MEAL-BOX-M', 'CL-SANITISER'], 'CL-SANITISER', 'EQ-FRYER-BASKET'],
          'the list pages by code: organisation-wide, the second brand\'s item among them');

        const set = id();
        const body = { decision_id: set, supplied_by: WAREHOUSE, expected_decision_id: null, reason };
        equal(await send('POST', `/sources/${OIL}`, body, admin.token), { http: 200, body: { status: 'ok', decision_id: set } },
          'the administrator gives the frying oil a source');
        const retry = await send('POST', `/sources/${OIL}`, body, admin.token);
        equal([retry.http, retry.body.status, retry.body.constraint],
          [409, 'already_recorded', 'replenishment_source_decision_pkey'], 'a retry is answered as one');
        const history = await send('GET', `/sources/${OIL}`, undefined, admin.token);
        const first = (history.body.decisions as Row[])[0];
        equal([first?.decision_id, first?.kind, first?.facility_code, first?.is_current], [set, 'source_set', 'WH-001', true],
          'and the console confirms it through the history');
        assert(/^\d+$/.test(String(first?.seq)), 'a seq, as text');
        const stale = await send('POST', `/sources/${OIL}`, { ...body, decision_id: id(), supplied_by: FACTORY }, admin.token);
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'replenishment_source_stale'],
          'a form that read "never" after it was set is stale');
        const same = await send('POST', `/sources/${OIL}`, { ...body, decision_id: id(), expected_decision_id: set }, admin.token);
        equal([same.http, same.body.constraint], [422, 'replenishment_source_unchanged'], 'set to what it already is');
        const byManager = await send('POST', `/sources/${OIL}`, { ...body, decision_id: id(), expected_decision_id: set },
          manager.token);
        equal([byManager.http, byManager.body.status], [403, 'forbidden'], 'the warehouse manager sets no source');
        const cleared = id();
        equal(await send('POST', `/sources/${OIL}/clear`, { decision_id: cleared, expected_decision_id: set, reason },
          admin.token), { http: 200, body: { status: 'ok', decision_id: cleared } }, 'cleared');
        const gloves = await send('POST', `/sources/${GLOVES}/clear`,
          { decision_id: id(), expected_decision_id: (of('OP-GLOVES')?.as_of_decision_id), reason }, admin.token);
        equal([gloves.http, gloves.body.constraint], [422, 'replenishment_source_not_set'], 'nothing left to clear');
      });

      await t.step('cut-offs: as HH:MM both ways, a time of day by 0024\'s rule, the administrator\'s alone', async () => {
        const set = id();
        const body = { decision_id: set, cutoff: '15:30', expected_decision_id: SEEDED_WAREHOUSE_CUTOFF, reason };
        equal(await send('POST', `/cutoffs/${WAREHOUSE}`, body, admin.token), { http: 200, body: { status: 'ok', decision_id: set } },
          'the warehouse\'s cut-off moved to 15:30');
        const list = await send('GET', `/cutoffs?facility_id=${BRANCH_ONE}`, undefined, admin.token);
        equal((list.body.cutoffs as Row[]).map((c) => [c.code, c.cutoff, c.as_of_decision_id]),
          [['FA-001', '11:00', SEEDED_FACTORY_CUTOFF], ['WH-001', '15:30', set]], 'and listed as the branch reads it');
        const history = await send('GET', `/cutoffs/${WAREHOUSE}`, undefined, admin.token);
        equal((history.body.decisions as Row[]).map((d) => [d.cutoff, d.is_current]), [['15:30', true], ['14:00', false]],
          'its history, newest first');
        const newest = await send('GET', `/cutoffs/${WAREHOUSE}?limit=1`, undefined, admin.token);
        const older = await send('GET', `/cutoffs/${WAREHOUSE}?limit=1&before=${newest.body.next_before}`, undefined, admin.token);
        equal([(newest.body.decisions as Row[]).map((d) => d.cutoff), (older.body.decisions as Row[]).map((d) => d.cutoff)],
          [['15:30'], ['14:00']], 'paged by seq, sent back as text');
        const retry = await send('POST', `/cutoffs/${WAREHOUSE}`, body, admin.token);
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'order_cutoff_decision_pkey'],
          'a retry is answered as one');
        const midnight = await send('POST', `/cutoffs/${WAREHOUSE}`,
          { ...body, decision_id: id(), cutoff: '24:00', expected_decision_id: set }, admin.token);
        equal([midnight.http, midnight.body.status, midnight.body.constraint], [422, 'invalid', 'order_cutoff_is_valid'],
          '24:00 is shaped as a time, and refused by 0024 by name');
        const numeric = await send('POST', `/cutoffs/${WAREHOUSE}`, { ...body, decision_id: id(), cutoff: 1530 }, admin.token);
        equal([numeric.http, numeric.body], [400, { status: 'malformed', field: 'cutoff' }], 'a cut-off is text');
        const byFactory = await send('POST', `/cutoffs/${FACTORY}`,
          { decision_id: id(), cutoff: '12:00', expected_decision_id: SEEDED_FACTORY_CUTOFF, reason }, factory.token);
        equal([byFactory.http, byFactory.body.status], [403, 'forbidden'], 'the factory manager does not move its cut-off');
        const cleared = id();
        equal(await send('POST', `/cutoffs/${FACTORY}/clear`,
          { decision_id: cleared, expected_decision_id: SEEDED_FACTORY_CUTOFF, reason }, admin.token),
          { http: 200, body: { status: 'ok', decision_id: cleared } }, 'the factory\'s cut-off cleared');
        const none = await send('GET', `/cutoffs?facility_id=${BRANCH_ONE}`, undefined, admin.token);
        equal((none.body.cutoffs as Row[]).find((c) => c.code === 'FA-001')?.cutoff, null, 'and listed as none');
      });

      await t.step('pars: set from the facility that supplies the item, retried, confirmed, and kept as entered', async () => {
        const set = id();
        const body = {
          decision_id: set, facility_id: FACTORY, item_unit_id: TRAY, quantity: '1.5', expected_decision_id: null, reason,
        };
        equal(await send('POST', `/pars/${BRANCH_TWO}`, body, factory.token), { http: 200, body: { status: 'ok', decision_id: set } },
          'the factory manager, at the factory, gives BR-002 a par of strips');
        const list = await send('GET', `/pars/${BRANCH_TWO}?facility_id=${FACTORY}`, undefined, factory.token);
        equal((list.body.pars as Row[]).map((p) => [p.code, p.par, p.unit_key, p.quantity, p.factor, p.as_of_decision_id]),
          [['SF-CHK-STRIPS', '60', 'tray', '1.5', '40', set]], '1.5 trays of 40 is 60 pieces, as text: only what the factory supplies');
        const retry = await send('POST', `/pars/${BRANCH_TWO}`, { ...body, quantity: '9' }, factory.token);
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'par_level_decision_pkey'],
          'a retry is answered as one');
        const history = await send('GET', `/pars/${BRANCH_TWO}/items/${STRIPS}?facility_id=${FACTORY}`, undefined, factory.token);
        const first = (history.body.decisions as Row[])[0];
        equal([first?.decision_id, first?.par, first?.quantity, first?.is_current], [set, '60', '1.5', true],
          'and the console confirms it, asked from where it was set');
        const stale = await send('POST', `/pars/${BRANCH_TWO}`, { ...body, decision_id: id(), quantity: '2' }, factory.token);
        equal([stale.http, stale.body.status], [409, 'stale'], 'a form that read "none" after it was set is stale');
        const same = await send('POST', `/pars/${BRANCH_TWO}`,
          { ...body, decision_id: id(), quantity: '1.5', expected_decision_id: set }, factory.token);
        equal([same.http, same.body.constraint, same.body.message],
          [422, 'par_level_unchanged', 'the par of SF-CHK-STRIPS at BR-002 is already 60 piece'], 'unchanged, named in its unit');
      });

      await t.step('pars: refused from another supplier, when the place is not stated, and for another brand\'s pack', async () => {
        const base = { facility_id: FACTORY, item_unit_id: CARTON, quantity: '2', expected_decision_id: SEEDED_BRANCH_TWO_CHICKEN, reason };
        const chicken = await send('POST', `/pars/${BRANCH_TWO}`, { ...base, decision_id: id() }, factory.token);
        equal([chicken.http, chicken.body.status, chicken.body.constraint], [422, 'refused', 'par_level_not_its_source'],
          'the factory manager sets no par of what the warehouse supplies');
        const unstated = await send('POST', `/pars/${BRANCH_TWO}`, {
          decision_id: id(), item_unit_id: CARTON, quantity: '2', expected_decision_id: SEEDED_BRANCH_TWO_CHICKEN, reason,
        }, admin.token);
        equal([unstated.http, unstated.body], [400, { status: 'malformed', field: 'facility_id' }],
          'where a par is set from is stated, never assumed to be the organisation');
        const numeric = await send('POST', `/pars/${BRANCH_TWO}`, { ...base, decision_id: id(), facility_id: WAREHOUSE, quantity: 2 },
          manager.token);
        equal([numeric.http, numeric.body], [400, { status: 'malformed', field: 'quantity' }], 'a par is decimal text');
        const other = await send('POST', `/pars/${BRANCH_TWO}`,
          { ...base, decision_id: id(), facility_id: null, item_unit_id: OTHER_BRAND_PIECE, quantity: '1', expected_decision_id: null },
          admin.token);
        equal([other.http, other.body.status, other.body.constraint], [404, 'not_found', 'item_unit_exists'],
          'another brand\'s pack is answered as a missing one');
        const zero = await send('POST', `/pars/${BRANCH_TWO}`, { ...base, decision_id: id(), facility_id: WAREHOUSE, quantity: '0' },
          manager.token);
        equal([zero.http, zero.body.constraint, zero.body.hint], [422, 'par_level_is_valid', 'To have no par, clear it.'],
          'a par is more than nothing');
      });

      await t.step('pars: set organisation-wide, and cleared from the supplying facility', async () => {
        const org = id();
        equal(await send('POST', `/pars/${BRANCH_TWO}`, {
          decision_id: org, facility_id: null, item_unit_id: COLA_CARTON, quantity: '1', expected_decision_id: null, reason,
        }, admin.token), { http: 200, body: { status: 'ok', decision_id: org } }, 'the administrator sets a par organisation-wide');
        const cleared = id();
        equal(await send('POST', `/pars/${BRANCH_TWO}/items/${CHICKEN}/clear`, {
          decision_id: cleared, facility_id: WAREHOUSE, expected_decision_id: SEEDED_BRANCH_TWO_CHICKEN, reason,
        }, manager.token), { http: 200, body: { status: 'ok', decision_id: cleared } }, 'the warehouse manager clears BR-002\'s chicken');
        const list = await send('GET', `/pars/${BRANCH_TWO}?facility_id=${BRANCH_TWO}`, undefined, admin.token);
        equal((list.body.pars as Row[]).map((p) => [p.code, p.par]), [['FP-COLA-330', '24'], ['SF-CHK-STRIPS', '60']],
          'cola at a carton of 24, the strips set above, and the chicken cleared');
        const twice = await send('POST', `/pars/${BRANCH_TWO}/items/${CHICKEN}/clear`, {
          decision_id: id(), facility_id: WAREHOUSE, expected_decision_id: cleared, reason,
        }, manager.token);
        equal([twice.http, twice.body.constraint], [422, 'par_level_not_set'], 'nothing left to clear');
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
        (select count(*)::int from erp.replenishment_source_decision where reason = ${reason})
        + (select count(*)::int from erp.order_cutoff_decision where reason = ${reason})
        + (select count(*)::int from erp.par_level_decision where reason = ${reason}) as decisions,
        (select left(cutoff::text, 5) from erp.order_cutoff where facility_id = ${WAREHOUSE}::uuid) as cutoff,
        (select par::text from erp.par_level where facility_id = ${BRANCH_TWO}::uuid and item_id = ${CHICKEN}::uuid) as par,
        (select count(*)::int from erp.person_credential
          where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid, ${FACTORY_MANAGER}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['cutoff'], left?.['par'], left?.['pins']], [0, '14:00', '20', 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
