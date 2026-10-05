/**
 * The facilities function end to end: the real router, the real driver, 0019's routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As transfer-prices.test.ts, two parts, against the synthetic seed, which opens
 * org.facilities as `pilot` (0019 alone leaves it hidden), lets the administrator write,
 * and lets the managers read:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier reads nothing of the
 *      capability and changes nothing. A branch worker is placed by assignment, and needs
 *      no list of areas (ADR-0028 §4).
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      The administrator and the warehouse manager have no PIN in the seed, so the
 *      transaction gives them one through erp.set_pin() and signs them in. Every request
 *      goes through the router and the driver in its own savepoint, and the rollback is
 *      checked afterwards.
 *
 * Another brand's facility is not here: the seed's second brand owns none, and erp_edge
 * can make no operating unit to hold one. pgTAP 140 covers brand-private reads, as the
 * owner, with a brand of its own.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { facilities } from '../../_shared/facilities.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const UNIT = '01936f00-0000-7000-8000-000000000301';
/** BR-001, with an area at 24.713600, 46.675300, 150 m, recorded by …5601. */
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const BRANCH_ONE_STAMP = '01936f00-0000-7000-8000-000000005601';
/** BR-002, with no area, recorded by …5602. */
const BRANCH_TWO = '01936f00-0000-7000-8000-000000000402';
const BRANCH_TWO_STAMP = '01936f00-0000-7000-8000-000000005602';

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
  new Request(`http://edge.test/functions/v1/facilities${path}`, {
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

Deno.test('as erp_edge, a cashier reads no facility and changes none', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    for (const path of [`?facility_id=${BRANCH_ONE}`, `/${BRANCH_ONE}?facility_id=${BRANCH_ONE}`]) {
      const read = await facilities(call(signedIn.token, 'GET', path), deps);
      const body = await read.json();
      equal([read.status, body.status], [403, 'forbidden'], `a cashier reads no facility: ${path}`);
      assert(/may not read on capability org\.facilities/.test(body.message), `the gate's own words: ${body.message}`);
    }
    const area = await facilities(call(signedIn.token, 'POST', `/${BRANCH_ONE}/area`, {
      decision_id: crypto.randomUUID(), expected_decision_id: BRANCH_ONE_STAMP,
      latitude: '24.000000', longitude: '46.000000', radius_m: 2000, reason: 'A cashier tries.',
    }), deps);
    equal([area.status, (await area.json()).status], [403, 'forbidden'], 'a cashier moves no area');
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every facilities route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8);
  const reason = `Integration test ${suffix}.`;
  const id = () => crypto.randomUUID();
  const created = id();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const admin = await db.signIn('1000', '100900');
      const manager = await db.signIn('1004', '100904');
      assert(admin.status === 'ok' && manager.status === 'ok', 'the administrator and the warehouse manager sign in');
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Row }) { super('refused'); }
      }
      const send = async (method: string, path: string, body?: unknown, token = admin.token): Promise<{ http: number; body: Row }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await facilities(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };
      const read = async (facility: string): Promise<Row> => (await send('GET', `/${facility}`)).body.facility;

      await t.step('a facility reads back with its area as decimal text and its stamp', async () => {
        const one = await read(BRANCH_ONE);
        equal([one.code, one.latitude, one.longitude, one.geofence_radius_m, one.status, one.as_of_decision_id],
          ['BR-001', '24.713600', '46.675300', 150, 'open', BRANCH_ONE_STAMP], 'BR-001');
        const two = await read(BRANCH_TWO);
        equal([two.latitude, two.longitude, two.geofence_radius_m], [null, null, null], 'BR-002 has no area');
      });

      const first = id();
      await t.step('the administrator creates a branch, and a retry is answered as a retry', async () => {
        const body = {
          decision_id: first, facility_id: created, operating_unit_id: UNIT, facility_type: 'branch', code: `BR-T${suffix.slice(0, 4).toUpperCase()}`,
          name_en: 'Integration Branch', name_ar: 'فرع الاختبار', address_en: null, address_ar: 'شارع الاختبار', reason,
        };
        equal(await send('POST', '', body), { http: 200, body: { status: 'ok', decision_id: first } }, 'created');
        const mine = await read(created);
        equal([mine.name_ar, mine.address_ar, mine.status, mine.as_of_decision_id, mine.tz_name],
          ['فرع الاختبار', 'شارع الاختبار', 'open', first, 'Asia/Riyadh'], 'read back');
        const retry = await send('POST', '', { ...body, facility_id: id(), code: 'BR-OTHER' });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'facility_decision_pkey'], 'retry');
        const taken = await send('POST', '', { ...body, decision_id: id(), facility_id: id(), code: 'BR-001' });
        equal([taken.http, taken.body.status, taken.body.constraint], [409, 'conflict', 'facility_code_key'], 'a code taken');
      });

      let stamp = first;
      await t.step('an amendment needs the stamp it was read at', async () => {
        const amend = {
          expected_decision_id: stamp, name_en: 'Integration Branch', name_ar: 'فرع الاختبار',
          address_en: 'Test Road', address_ar: 'شارع الاختبار', reason,
        };
        const next = id();
        equal((await send('POST', `/${created}/amend`, { ...amend, decision_id: next })).http, 200, 'amended');
        stamp = next;
        equal((await read(created)).address_en, 'Test Road', 'read back');
        const stale = await send('POST', `/${created}/amend`, { ...amend, decision_id: id(), address_en: 'Old Road' });
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'facility_stale'], 'stale');
      });

      await t.step('an area is set as decimal text, rounded to six places by nobody but the database', async () => {
        const next = id();
        const r = await send('POST', `/${created}/area`, {
          decision_id: next, expected_decision_id: stamp, latitude: '24.774265', longitude: '46.738586', radius_m: null, reason,
        });
        equal(r.http, 200, 'set');
        stamp = next;
        const mine = await read(created);
        equal([mine.latitude, mine.longitude, mine.geofence_radius_m], ['24.774265', '46.738586', 150],
          'a point without a radius is 150 m');
      });

      await t.step('the area rules come back in the route\'s own words', async () => {
        const base = { expected_decision_id: stamp, reason };
        const off = await send('POST', `/${created}/area`, { ...base, decision_id: id(), latitude: '91', longitude: '46', radius_m: 150 });
        equal([off.http, off.body.status, off.body.constraint], [422, 'invalid', 'facility_area_is_on_earth'], 'off the earth');
        const half = await send('POST', `/${created}/area`, { ...base, decision_id: id(), latitude: '24', longitude: null, radius_m: 150 });
        equal([half.http, half.body.constraint], [422, 'facility_area_is_whole'], 'half an area');
        const wide = await send('POST', `/${created}/area`, { ...base, decision_id: id(), latitude: '24', longitude: '46', radius_m: 2001 });
        equal([wide.http, wide.body.constraint], [422, 'facility_radius_is_metres'], 'too wide');
        const huge = await send('POST', `/${created}/area`, { ...base, decision_id: id(), latitude: '999.5', longitude: '46', radius_m: 150 });
        equal([huge.http, huge.body.constraint], [422, 'facility_area_is_on_earth'],
          'a value past numeric(9,6) is the route\'s refusal, not PostgreSQL\'s overflow');
      });

      await t.step('an area is removed on purpose, all three null', async () => {
        const next = id();
        equal((await send('POST', `/${created}/area`, {
          decision_id: next, expected_decision_id: stamp, latitude: null, longitude: null, radius_m: null, reason,
        })).http, 200, 'removed');
        stamp = next;
        const mine = await read(created);
        equal([mine.latitude, mine.longitude, mine.geofence_radius_m], [null, null, null], 'no area');
      });

      await t.step('a closed facility changes nothing until it is reopened', async () => {
        const closing = id();
        equal((await send('POST', `/${created}/status`, { decision_id: closing, expected_decision_id: stamp, status: 'closed', reason })).http,
          200, 'closed');
        stamp = closing;
        const again = await send('POST', `/${created}/status`, { decision_id: id(), expected_decision_id: stamp, status: 'closed', reason });
        equal([again.http, again.body.status, again.body.constraint], [422, 'refused', 'facility_status_unchanged'], 'already closed');
        const amend = await send('POST', `/${created}/amend`, {
          decision_id: id(), expected_decision_id: stamp, name_en: 'Renamed', name_ar: 'فرع الاختبار',
          address_en: null, address_ar: null, reason,
        });
        equal([amend.http, amend.body.status, amend.body.constraint], [422, 'refused', 'facility_is_closed'], 'closed');
        const open: Row[] = (await send('GET', '?limit=500')).body.facilities;
        assert(!open.some((f) => f.facility_id === created), 'a list shows open facilities by default');
        const closed: Row[] = (await send('GET', '?status=closed&limit=500')).body.facilities;
        assert(closed.some((f) => f.facility_id === created), 'and closed ones when asked');
        const reopening = id();
        equal((await send('POST', `/${created}/status`, { decision_id: reopening, expected_decision_id: stamp, status: 'open', reason })).http,
          200, 'reopened');
        stamp = reopening;
        equal((await read(created)).status, 'open', 'open again');
      });

      await t.step('the warehouse manager reads, at a branch or organisation-wide, and may change nothing', async () => {
        const atBranch = await send('GET', `?facility_id=${BRANCH_ONE}&limit=500`, undefined, manager.token);
        equal(atBranch.http, 200, 'reads at a branch');
        assert((atBranch.body.facilities as Row[]).some((f) => f.code === 'BR-001'), 'BR-001 is listed');
        equal((await send('GET', `/${BRANCH_TWO}/history`, undefined, manager.token)).http, 200, 'reads a history');
        for (const [path, body] of [
          ['', { decision_id: id(), facility_id: id(), operating_unit_id: UNIT, facility_type: 'office', code: 'OF-T', name_en: 'O', name_ar: 'م', reason }],
          [`/${BRANCH_TWO}/amend`, { decision_id: id(), expected_decision_id: BRANCH_TWO_STAMP, name_en: 'X', name_ar: 'س', address_en: null, address_ar: null, reason }],
          [`/${BRANCH_TWO}/area`, { decision_id: id(), expected_decision_id: BRANCH_TWO_STAMP, latitude: '24.6', longitude: '46.7', radius_m: 150, reason }],
          [`/${BRANCH_TWO}/status`, { decision_id: id(), expected_decision_id: BRANCH_TWO_STAMP, status: 'closed', reason }],
        ] as const) {
          const r = await send('POST', path, body, manager.token);
          equal([r.http, r.body.status], [403, 'forbidden'], `the manager may not: ${path || 'create'}`);
        }
      });

      await t.step('its history holds every decision, in order, with who and why', async () => {
        const decisions: Row[] = (await send('GET', `/${created}/history`)).body.decisions;
        equal(decisions.map((d) => [d.kind, d.status]), [
          ['facility_created', 'open'], ['facility_amended', 'open'], ['facility_located', 'open'],
          ['facility_located', 'open'], ['facility_status_changed', 'closed'], ['facility_status_changed', 'open'],
        ], 'history');
        assert(decisions.every((d) => d.actor_id === ADMIN && d.reason === reason), 'every decision names its actor and reason');
        equal([decisions[2]?.latitude, decisions[3]?.latitude], ['24.774265', null], 'the area as it was, then none');
      });

      await t.step('a facility or an operating unit that does not exist is 404', async () => {
        const missing = await send('GET', `/${id()}`);
        equal([missing.http, missing.body.status, missing.body.constraint], [404, 'not_found', 'facility_exists'], 'facility');
        const unit = await send('POST', '', {
          decision_id: id(), facility_id: id(), operating_unit_id: id(), facility_type: 'branch', code: 'BR-NOUNIT',
          name_en: 'No Unit', name_ar: 'بلا وحدة', reason,
        });
        equal([unit.http, unit.body.constraint], [404, 'operating_unit_exists'], 'operating unit');
        const status = await send('POST', `/${id()}/status`, { decision_id: id(), expected_decision_id: id(), status: 'closed', reason });
        equal([status.http, status.body.constraint], [404, 'facility_exists'], 'status');
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
        (select count(*)::int from erp.facility_decision where reason = ${reason}) as decisions,
        (select count(*)::int from erp.facility where facility_id = ${created}::uuid) as facilities,
        (select count(*)::int from erp.person_credential where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid)) as pins`;
    equal([left?.['decisions'], left?.['facilities'], left?.['pins']], [0, 0, 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
