/**
 * The edge layer end to end: the real handlers, through the real postgres.js connection,
 * logged in as erp_edge, against a database built from supabase/migrations and the seed.
 *
 *   eval "$(supabase status -o env)"     # sets DB_URL for the local stack
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * It proves what ADR-0023 rests on and pgTAP cannot reach: the edge connects as a login
 * role that is not service_role, and every route it needs works through that connection
 * and nothing more does.
 *
 * LOCAL ONLY. It sets erp_edge's password to a random value for the run and clears it
 * afterwards, so it refuses any database that is not on this machine: a hosted
 * project's password is the owner's to set (CLAUDE.md §4). CI runs it against the
 * Database stack job's throwaway containers.
 *
 * The employee number and PIN that succeed are the synthetic ones
 * supabase/seeds/0015_identity.sql seeds. The one that fails is a random number nobody
 * holds, so repeated local runs neither lock a seeded person nor move the counters
 * pgTAP 070 and 090 count from; 090 also counts only its own attempts. What the run
 * commits — a signed-out session and two log rows — stays until the next `db reset`.
 */
import postgres from 'postgres';
import { connect, type Connection } from '../db.ts';
import { session, signIn, signOut } from '../../_shared/handlers.ts';
import type { Deps } from '../../_shared/http.ts';

const CASHIER = '01936f00-0000-7000-8000-000000000901';
const BRANCH = '01936f00-0000-7000-8000-000000000401';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const adminUrl = Deno.env.get('ERP_TEST_ADMIN_URL');
if (adminUrl === undefined) throw new Error('ERP_TEST_ADMIN_URL is not set: point it at a local stack');
const admin = new URL(adminUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(admin.hostname)) {
  throw new Error(`refusing ${admin.hostname}: this test sets a role password, and only on a local database`);
}

Deno.test('the edge signs in, resolves and signs out through erp_edge', async (t) => {
  const owner = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const password = crypto.randomUUID();
  await owner.unsafe(`alter role erp_edge password '${password}'`);

  const edgeUrl = new URL(adminUrl);
  edgeUrl.username = 'erp_edge';
  edgeUrl.password = password;
  const edge = postgres(edgeUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });
  const db: Connection = connect(edgeUrl.toString());
  const deps: Deps = { db, allowedOrigins: new Set() };
  const [started] = await owner`select clock_timestamp() as at`;
  const nobody = `7${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(9, '0').slice(0, 9)}`;

  try {
    await t.step('it is connected as erp_edge, which is not service_role', async () => {
      const [row] = await edge`select current_user as who, pg_has_role('service_role', 'member') as service`;
      equal(row?.['who'], 'erp_edge', 'current_user');
      equal(row?.['service'], false, 'member of service_role');
    });

    await t.step('and can read no credential or session directly', async () => {
      for (const table of ['erp.person_credential', 'erp.session', 'erp.sign_in_log']) {
        let refused = '';
        try {
          await edge.unsafe(`select 1 from ${table} limit 1`);
        } catch (error) {
          refused = String((error as { code?: string }).code);
        }
        equal(refused, '42501', `reading ${table}`);
      }
    });

    let token = '';
    await t.step('a correct PIN signs in and returns a token', async () => {
      const response = await signIn(new Request('http://edge.test/sign-in', {
        method: 'POST', body: JSON.stringify({ employee_number: '1001', pin: '100001' }),
      }), deps);
      equal(response.status, 200, 'status');
      const body = await response.json();
      equal(body.status, 'ok', 'answer');
      equal(body.person_id, CASHIER, 'person');
      assert(/^[0-9a-f]{64}$/.test(body.token), 'a token of 32 bytes, as hex');
      token = body.token;
    });

    await t.step('the token resolves to the person who signed in', async () => {
      const response = await session(new Request('http://edge.test/session', {
        headers: { authorization: `Bearer ${token}` },
      }), deps);
      equal(response.status, 200, 'status');
      equal((await response.json()).person_id, CASHIER, 'person');
    });

    await t.step('erp.viewer(), as erp_edge, is the cashier\'s at their branch, and nothing organisation-wide', async () => {
      const at = async (facility: string | null) => {
        const response = await session(new Request(`http://edge.test/session${facility === null ? '' : `?facility_id=${facility}`}`, {
          headers: { authorization: `Bearer ${token}` },
        }), deps);
        equal(response.status, 200, 'status');
        return (await response.json()).viewer;
      };
      const branch = await at(BRANCH);
      equal(branch.person.person_id, CASHIER, 'the session\'s person');
      equal(branch.facility_id, BRANCH, 'at the branch asked for');
      equal(branch.org_wide, false, 'a branch role');
      equal(branch.facilities.map((f: { code: string }) => f.code), ['BR-001'], 'where they can work');
      assert(branch.permissions.includes('inventory.items:read'), 'reads items at the branch');
      equal(branch.permissions.includes('inventory.items:write'), false, 'writes no item');
      equal(branch.states['inventory.items'], 'pilot', 'the seed opens items as a pilot');
      assert(branch.units.length > 0 && branch.brands.length > 0, 'the forms\' reference data');
      equal((await at(null)).permissions, [], 'organisation-wide, a branch role grants nothing');
    });

    await t.step('a number nobody holds is refused, and both attempts were recorded', async () => {
      const response = await signIn(new Request('http://edge.test/sign-in', {
        method: 'POST', body: JSON.stringify({ employee_number: nobody, pin: '000000' }),
      }), deps);
      equal(response.status, 401, 'status');
      equal(await response.json(), { status: 'wrong', attempts_left: 4 }, 'answer');
      const rows = await owner`select outcome, person_id from erp.sign_in_log
                               where attempted_at >= ${started?.['at']} order by attempted_at`;
      equal(rows.map((r) => [r['outcome'], r['person_id']]),
        [['ok', CASHIER], ['wrong', null]], 'this run\'s attempts, in order');
    });

    await t.step('signing out ends the session', async () => {
      const out = await signOut(new Request('http://edge.test/sign-out', {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      }), deps);
      equal(out.status, 200, 'sign-out status');
      const after = await session(new Request('http://edge.test/session', {
        headers: { authorization: `Bearer ${token}` },
      }), deps);
      equal(after.status, 401, 'status after sign-out');
      equal(await after.json(), { status: 'ended' }, 'answer after sign-out');
    });
  } finally {
    await db.end();
    await edge.end();
    await owner.unsafe('alter role erp_edge password null');
    await owner.end();
  }
});
