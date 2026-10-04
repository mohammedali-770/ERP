/**
 * The suppliers function end to end: the real router, the real driver, 0016's routes.
 *
 *   eval "$(supabase status -o env)"
 *   ERP_TEST_ADMIN_URL="$DB_URL" deno test --config supabase/functions/deno.json --frozen \
 *     --allow-net --allow-env --allow-read supabase/functions/_deno/test/
 *
 * As items.test.ts, two parts, against the synthetic seed, which opens
 * procurement.suppliers as `pilot` (0016 alone leaves it hidden) and lets the managers
 * and the accountant read it:
 *
 *   1. AS ERP_EDGE, over its own login: a signed-in cashier is refused 403 at their branch
 *      and organisation-wide. A branch worker reads nothing of suppliers (ADR-0026 §5),
 *      and the refusal is the gate's, not a permission error from a missing grant.
 *
 *   2. EVERY ROUTE, AS ERP_EDGE, in one transaction on its own login that is ROLLED BACK.
 *      The administrator and the warehouse manager have no PIN in the seed, so the
 *      transaction gives them one through erp.set_pin() and signs them in. Every request
 *      goes through the router and the driver in its own savepoint, every field written
 *      is read back where it was written, and the rollback is checked afterwards.
 *
 * LOCAL ONLY, as sessions.test.ts: it refuses any database not on this machine.
 */
import postgres from 'postgres';
import { connect, makeDb } from '../db.ts';
import { suppliers } from '../../_shared/suppliers.ts';

const ADMIN = '01936f00-0000-7000-8000-000000000900';
const MANAGER = '01936f00-0000-7000-8000-000000000904';
const BRANCH_ONE = '01936f00-0000-7000-8000-000000000401';
const SUP_PACK = '01936f00-0000-7000-8000-000000005102';
/** PK-MEAL-BOX-M, the first brand's, whose preferred supplier is SUP-PACK by the carton. */
const MEAL_BOX = '01936f00-0000-7000-8000-000000004104';
/** Its pack of 50, which nobody supplies. */
const MEAL_BOX_PACK = '01936f00-0000-7000-8000-000000004213';
/** SUP-B2, which sells only the SECOND brand's meal box. */
const SUP_B2 = '01936f00-0000-7000-8000-000000005105';
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
  new Request(`http://edge.test/functions/v1/suppliers${path}`, {
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

Deno.test('as erp_edge, a cashier reads nothing of suppliers, at their branch or anywhere', () => asErpEdge(async (url) => {
  const db = connect(url);
  try {
    const signedIn = await db.signIn('1001', '100001');
    assert(signedIn.status === 'ok', 'the seeded cashier signs in');
    const deps = { db, allowedOrigins: new Set<string>() };
    for (const path of [`?facility_id=${BRANCH_ONE}`, '', `/${SUP_PACK}?facility_id=${BRANCH_ONE}`]) {
      const r = await suppliers(call(signedIn.token, 'GET', path), deps);
      equal(r.status, 403, `a read of ${path || 'the list'}`);
      const body = await r.json();
      equal(body.status, 'forbidden', 'answer');
      assert(/may not read on capability procurement\.suppliers/.test(body.message), `the gate's own words: ${body.message}`);
    }
  } finally {
    await db.end();
  }
}));

class Rollback extends Error {}

Deno.test('every suppliers route, as erp_edge, through the router and the driver, rolled back', (t) => asErpEdge(async (url) => {
  const edge = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const id = () => crypto.randomUUID();
  try {
    await edge.begin(async (tx) => {
      await tx`select erp.set_pin(${id()}::uuid, ${ADMIN}::uuid, '100900', 'Integration test.', ${ADMIN}::uuid, now())`;
      await tx`select erp.set_pin(${id()}::uuid, ${MANAGER}::uuid, '100904', 'Integration test.', ${ADMIN}::uuid, now())`;
      const db = makeDb(tx);
      const deps = { db, allowedOrigins: new Set<string>() };
      const admin = await db.signIn('1000', '100900');
      const manager = await db.signIn('1004', '100904');
      assert(admin.status === 'ok' && manager.status === 'ok', 'the administrator and the warehouse manager sign in');
      // Each request in a savepoint, as each is its own transaction in production: a
      // refusal aborts the transaction it is raised in, and must not take the next
      // request's with it.
      class Refused extends Error {
        constructor(readonly answer: { http: number; body: Record<string, unknown> }) { super('refused'); }
      }
      // deno-lint-ignore no-explicit-any
      const send = async (method: string, path: string, body?: unknown, token = admin.token): Promise<{ http: number; body: any }> => {
        try {
          return await tx.savepoint(async (sp) => {
            const response = await suppliers(call(token, method, path, body), { ...deps, db: makeDb(sp) });
            const answer = { http: response.status, body: await response.json() };
            if (answer.http >= 400) throw new Refused(answer);
            return answer;
          });
        } catch (error) {
          if (error instanceof Refused) return error.answer;
          throw error;
        }
      };

      const supplier = id();
      const created = id();
      const code = `zz-it-${suffix}`;
      let stamp = '';
      await t.step('create, with digits typed on an Arabic keyboard', async () => {
        const r = await send('POST', '', {
          decision_id: created, supplier_id: supplier, code,
          name_en: `Integration Foods ${suffix}`, name_ar: `أغذية التكامل ${suffix}`,
          vat_number: '310000000000903', cr_number: '١٠١٠٠٠٠٠٠٩', payment_terms_days: 45, reason: 'Integration test.',
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: created } }, 'create');
      });

      await t.step('get, every field where it was written', async () => {
        const r = await send('GET', `/${supplier}?facility_id=${BRANCH_ONE}`);
        equal(r.http, 200, 'status');
        const s = r.body.supplier;
        // A driver that swapped two parameters of the same type would otherwise pass.
        equal([s.code, s.name_en, s.name_ar, s.vat_number, s.cr_number, s.payment_terms_days, s.status, s.supplies],
          [code.toUpperCase(), `Integration Foods ${suffix}`, `أغذية التكامل ${suffix}`, '310000000000903', '1010000009',
           45, 'active', []], 'the fields');
        equal([s.contact_person, s.phone, s.email, s.address], [null, null, null, null], 'no contact yet');
        stamp = s.as_of_decision_id;
        equal(stamp, created, 'the stamp is the decision that created it');
      });

      await t.step('the list finds it by search', async () => {
        const r = await send('GET', `?search=${encodeURIComponent(code)}&status=all`);
        equal(r.http, 200, 'status');
        equal(r.body.suppliers.map((s: { supplier_id: string }) => s.supplier_id), [supplier], 'found');
      });

      await t.step('a retry of the create is answered as a retry; a name in use is a conflict', async () => {
        const retry = await send('POST', '', {
          decision_id: created, supplier_id: id(), code: `${code}-b`, name_en: `Other ${suffix}`, name_ar: `آخر ${suffix}`,
          payment_terms_days: 30, reason: 'Retry.',
        });
        equal([retry.http, retry.body.status, retry.body.constraint], [409, 'already_recorded', 'supplier_decision_pkey'], 'retry');
        const dup = await send('POST', '', {
          decision_id: id(), supplier_id: id(), code: `${code}-c`, name_en: `Integration Foods ${suffix}`,
          name_ar: `أغذية أخرى ${suffix}`, payment_terms_days: 30, reason: 'Duplicate name.',
        });
        equal(dup.body, { status: 'conflict', message: 'a value that must be unique is already in use',
                          constraint: 'supplier_active_name_en_key' }, 'a native conflict, in the edge\'s words');
        const terms = await send('POST', '', {
          decision_id: id(), supplier_id: id(), code: `${code}-d`, name_en: `Terms ${suffix}`, name_ar: `شروط ${suffix}`,
          payment_terms_days: 400, reason: 'Too long.',
        });
        equal([terms.http, terms.body.status, terms.body.constraint], [422, 'invalid', 'supplier_payment_terms_are_days'],
          'the 0–365 rule is the database\'s');
      });

      await t.step('amend, then a stale amend is refused', async () => {
        const amended = id();
        const r = await send('POST', `/${supplier}/amend`, {
          decision_id: amended, expected_decision_id: stamp, name_en: `Integration Foods Co. ${suffix}`,
          name_ar: `شركة أغذية التكامل ${suffix}`, vat_number: null, cr_number: '1010000009', payment_terms_days: 0,
          reason: 'Registered as a company.',
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: amended } }, 'amend');
        const after = (await send('GET', `/${supplier}`)).body.supplier;
        equal([after.name_en, after.name_ar, after.vat_number, after.cr_number, after.payment_terms_days],
          [`Integration Foods Co. ${suffix}`, `شركة أغذية التكامل ${suffix}`, null, '1010000009', 0], 'the amended fields');
        const stale = await send('POST', `/${supplier}/amend`, {
          decision_id: id(), expected_decision_id: stamp, name_en: `Lost ${suffix}`, name_ar: `ضائع ${suffix}`,
          vat_number: null, cr_number: null, payment_terms_days: 30, reason: 'Stale form.',
        });
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'supplier_stale'], 'stale');
        stamp = amended;
      });

      await t.step('set the contact, then erase it', async () => {
        const set = id();
        const r = await send('POST', `/${supplier}/contact`, {
          decision_id: set, expected_decision_id: stamp, contact_person: 'Sales desk', phone: '+966 55 000 0009',
          email: 'Sales@Example.test', address: 'Unit 9, Industrial Area',
        });
        equal(r.http, 200, 'set');
        const after = (await send('GET', `/${supplier}`)).body.supplier;
        equal([after.contact_person, after.phone, after.email, after.address],
          ['Sales desk', '+966550000009', 'sales@example.test', 'Unit 9, Industrial Area'], 'the contact, canonical');
        const erased = id();
        const e = await send('POST', `/${supplier}/contact`, {
          decision_id: erased, expected_decision_id: set, contact_person: null, phone: null, email: null, address: null,
        });
        equal(e.http, 200, 'erase');
        const gone = (await send('GET', `/${supplier}`)).body.supplier;
        equal([gone.contact_person, gone.phone, gone.email, gone.address], [null, null, null, null], 'erased');
        stamp = erased;
      });

      const supply = id();
      let supplyStamp = '';
      await t.step('add a supply; a second preferred supplier for the item is refused', async () => {
        const taken = await send('POST', `/${supplier}/supplies`, {
          decision_id: id(), supplier_item_id: id(), item_unit_id: MEAL_BOX_PACK, supplier_code: null, preferred: true,
          reason: 'Preferred.',
        });
        equal([taken.http, taken.body.status, taken.body.constraint], [409, 'conflict', 'supplier_item_one_preferred'],
          'SUP-PACK already holds the item\'s preferred slot');
        supplyStamp = id();
        const r = await send('POST', `/${supplier}/supplies`, {
          decision_id: supplyStamp, supplier_item_id: supply, item_unit_id: MEAL_BOX_PACK, supplier_code: 'IF-50',
          preferred: false, reason: 'Sells packs of 50.',
        });
        equal(r, { http: 200, body: { status: 'ok', decision_id: supplyStamp } }, 'add');
        const got = (await send('GET', `/${supplier}?facility_id=${BRANCH_ONE}`)).body.supplier;
        const x = got.supplies.find((s: { supplier_item_id: string }) => s.supplier_item_id === supply);
        equal([x?.item_id, x?.item_unit_id, x?.unit_key, Number(x?.factor), x?.supplier_code, x?.preferred, x?.status],
          [MEAL_BOX, MEAL_BOX_PACK, 'pack', 50, 'IF-50', false, 'active'], 'the supply, copied from its conversion');
      });

      await t.step('amend the supply; who sells the item lists it after the preferred one', async () => {
        const amended = id();
        const r = await send('POST', `/supplies/${supply}/amend`, {
          decision_id: amended, expected_decision_id: supplyStamp, supplier_code: 'IF-50B', preferred: false,
          reason: 'Their code changed.',
        });
        equal(r.http, 200, 'amend');
        const stale = await send('POST', `/supplies/${supply}/amend`, {
          decision_id: id(), expected_decision_id: supplyStamp, supplier_code: null, preferred: false, reason: 'Stale.',
        });
        equal([stale.http, stale.body.status, stale.body.constraint], [409, 'stale', 'supplier_item_stale'], 'stale');
        const who = await send('GET', `/items/${MEAL_BOX}?facility_id=${BRANCH_ONE}`, undefined, manager.token);
        equal(who.http, 200, 'the warehouse manager reads who sells it');
        const rows = who.body.supplies as Array<{ supplier_item_id: string; supplier_id: string; their_code: string; preferred: boolean }>;
        equal(rows[0]?.supplier_id, SUP_PACK, 'the preferred supplier first');
        equal(rows.find((s) => s.supplier_item_id === supply)?.their_code, 'IF-50B', 'the amended code');
      });

      await t.step('the warehouse manager reads, and may not write', async () => {
        const list = await send('GET', `?facility_id=${BRANCH_ONE}`, undefined, manager.token);
        equal(list.http, 200, 'a read');
        const write = await send('POST', `/supplies/${supply}/retire`, { decision_id: id(), reason: 'Not mine.' }, manager.token);
        equal([write.http, write.body.status], [403, 'forbidden'], 'a write');
        assert(/may not write on capability procurement\.suppliers/.test(write.body.message), `the gate's words: ${write.body.message}`);
      });

      await t.step('retire the supply, for good', async () => {
        const r = await send('POST', `/supplies/${supply}/retire`, { decision_id: id(), reason: 'Pack discontinued.' });
        equal(r.http, 200, 'retire');
        const again = await send('POST', `/supplies/${supply}/retire`, { decision_id: id(), reason: 'Twice.' });
        equal([again.http, again.body.status, again.body.constraint], [422, 'refused', 'supplier_item_already_retired'], 'final');
      });

      await t.step('retire the supplier; it admits no new supply', async () => {
        const r = await send('POST', `/${supplier}/status`, {
          decision_id: id(), expected_decision_id: stamp, status: 'retired', reason: 'No longer used.',
        });
        equal(r.http, 200, 'retire');
        const add = await send('POST', `/${supplier}/supplies`, {
          decision_id: id(), supplier_item_id: id(), item_unit_id: MEAL_BOX_PACK, preferred: false, reason: 'After retirement.',
        });
        equal([add.http, add.body.status, add.body.constraint], [422, 'refused', 'supplier_is_retired'], 'refused');
      });

      await t.step('its history holds every decision, in order, and no contact value', async () => {
        const r = await send('GET', `/${supplier}/history?facility_id=${BRANCH_ONE}`);
        equal(r.http, 200, 'status');
        equal(r.body.decisions.map((d: { kind: string }) => d.kind),
          ['supplier_created', 'supplier_amended', 'supplier_contact_changed', 'supplier_contact_changed',
           'supply_added', 'supply_amended', 'supply_retired', 'supplier_status_changed'], 'the decisions');
        const text = JSON.stringify(r.body.decisions);
        assert(!/Sales desk|550000009|example\.test|Industrial Area/i.test(text), 'no contact value in the log');
        equal(r.body.decisions.filter((d: { kind: string }) => d.kind === 'supplier_contact_changed').map((d: { reason: string }) => d.reason),
          ['Contact details changed.', 'Contact details erased.'], 'the fixed reasons');
      });

      await t.step('an import creates, sent again changes nothing, and a refused one names its line', async () => {
        const row = (n: number, extra: Record<string, unknown> = {}) => ({
          line: String(n), decision_id: id(), contact_decision_id: id(), supplier_id: id(),
          code: `zz-imp-${suffix}-${n}`, name_en: `Imported ${suffix} ${n}`, name_ar: `مستورد ${suffix} ${n}`,
          vat_number: '', cr_number: '', payment_terms_days: '30', contact_person: n === 1 ? 'Desk' : '', phone: '',
          email: '', address: '', ...extra,
        });
        const rows = [row(1), row(2)];
        const ok = await send('POST', '/import', { reason: 'Opening list.', rows });
        equal(ok, { http: 200, body: { status: 'ok', created: 2, amended: 0, unchanged: 0 } }, 'import');
        const again = await send('POST', '/import', {
          reason: 'Opening list.', rows: rows.map((r) => ({ ...r, decision_id: id(), contact_decision_id: id() })),
        });
        equal(again.body, { status: 'ok', created: 0, amended: 0, unchanged: 2 }, 'a file sent again changes nothing');
        const bad = await send('POST', '/import', { reason: 'Bad file.', rows: [row(3), row(4, { payment_terms_days: 'thirty' })] });
        equal([bad.http, bad.body.status, bad.body.constraint], [422, 'invalid', 'supplier_import_refused'], 'refused');
        assert(/line 4/.test(bad.body.detail) && !/line 3/.test(bad.body.detail), `only the failing line is named: ${bad.body.detail}`);
      });

      await t.step('at a branch, another brand\'s supplies are not revealed, through all three reads', async () => {
        // The administrator is organisation-wide, so only the facility the driver passes
        // keeps the second brand's supply out of a first-brand branch's answers.
        const everywhere = (await send('GET', `/${SUP_B2}`)).body.supplier;
        equal(everywhere.supplies.length, 1, 'organisation-wide, SUP-B2 sells one thing');
        const atBranch = (await send('GET', `/${SUP_B2}?facility_id=${BRANCH_ONE}`)).body.supplier;
        equal(atBranch.supplies, [], 'at a first-brand branch, nothing');
        const history = (await send('GET', `/${SUP_B2}/history?facility_id=${BRANCH_ONE}`)).body.decisions;
        equal(history.map((d: { kind: string }) => d.kind), ['supplier_created'], 'its history hides the supply');
        const who = await send('GET', `/items/${SECOND_BRAND_BOX}?facility_id=${BRANCH_ONE}`);
        equal([who.http, who.body.constraint], [404, 'item_exists'], 'another brand\'s item is answered as missing');
      });

      await t.step('a supplier, a supply or an item that does not exist is 404', async () => {
        const s = await send('GET', `/${id()}`);
        equal([s.http, s.body.status, s.body.constraint], [404, 'not_found', 'supplier_exists'], 'supplier');
        const x = await send('POST', `/supplies/${id()}/retire`, { decision_id: id(), reason: 'Missing.' });
        equal([x.http, x.body.status, x.body.constraint], [404, 'not_found', 'supplier_item_exists'], 'supply');
        const i = await send('GET', `/items/${id()}`);
        equal([i.http, i.body.status, i.body.constraint], [404, 'not_found', 'item_exists'], 'item');
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
        (select count(*)::int from erp.supplier where code like ${'ZZ-%-' + suffix + '%'}) as suppliers,
        (select count(*)::int from erp.supplier_decision where code like ${'ZZ-%-' + suffix + '%'}) as decisions,
        (select count(*)::int from erp.person_credential where person_id in (${ADMIN}::uuid, ${MANAGER}::uuid)) as pins`;
    equal([left?.['suppliers'], left?.['decisions'], left?.['pins']], [0, 0, 0], 'after the rollback');
  } finally {
    await owner.end();
  }
}));
