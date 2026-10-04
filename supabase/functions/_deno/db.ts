/**
 * The one file that talks to PostgreSQL (ADR-0023, ADR-0025).
 *
 * postgres.js, pinned exactly in ../deno.json and locked in ../deno.lock, connecting as
 * erp_edge: a login role that is erp_app and nothing more (0014). It calls the session
 * routes and each module's routes, and nothing else; each answer is checked by
 * ../_shared before anything else sees it.
 *
 * max: 1 and prepare: false, because a hosted project is reached through Supavisor in
 * transaction mode, where consecutive statements can land on different server
 * connections: a prepared statement made on one would not exist on the next. One
 * connection per function instance, because an instance serves one request at a time
 * often enough that more would only hold server connections idle.
 *
 * Every parameter is cast to the type the route declares. postgres.js sends untyped
 * parameters, and a function call resolves by argument type, so the casts are what make
 * a renamed or retyped route fail loudly here instead of resolving to something else.
 *
 * The decision time is the database's now(), never the caller's clock.
 *
 * JSON goes through sql.json(). postgres.js learns each parameter's type from the server
 * and serializes a jsonb one itself, so a string already JSON-encoded arrives as a JSON
 * string, not as the array it spells: an import was refused "1 to 5000 rows" for a file
 * of two until the integration test found it.
 */
import postgres from 'postgres';
import {
  asSessionAnswer, asSignInAnswer, asSignOutAnswer,
  type Db,
} from '../_shared/db.ts';
import type { ImportSummary, Item } from '../_shared/items-db.ts';
import { asRefusal } from '../_shared/refusal.ts';

export interface Connection extends Db {
  end(): Promise<void>;
}

/** A postgres.js connection or transaction: anything that runs a tagged query. */
type Sql = postgres.Sql | postgres.TransactionSql;

/** A refusal the routes raise becomes a Refusal; anything else stays an error. */
async function run<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw asRefusal(error) ?? error;
  }
}

/** The routes, over any connection or transaction. connect() is the only production caller. */
export function makeDb(sql: Sql): Db {
  return {
    async signIn(employeeNumber, pin) {
      const [row] = await sql`select erp.sign_in(${employeeNumber}::text, ${pin}::text) as answer`;
      return asSignInAnswer(row?.['answer']);
    },
    async resolveSession(token) {
      const [row] = await sql`select erp.resolve_session(${token}::text) as answer`;
      return asSessionAnswer(row?.['answer']);
    },
    async signOut(token) {
      const [row] = await sql`select erp.sign_out(${token}::text) as answer`;
      return asSignOutAnswer(row?.['answer']);
    },

    listItems: (actor, q) => run(async () => (await sql`
      select * from erp.list_items(${actor}::uuid, ${q.facilityId}::uuid, ${q.brandId}::uuid, ${q.status}::text,
                                   ${q.itemKind}::text, ${q.search}::text, ${q.afterCode}::text, ${q.limit}::integer)`
    ) as unknown as Item[]),
    getItem: (actor, facilityId, itemId) => run(async () => {
      const [row] = await sql`select * from erp.get_item(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`;
      return row as unknown as Item;
    }),
    itemHistory: (actor, facilityId, itemId) => run(async () =>
      [...await sql`select * from erp.item_history(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`]),
    createItem: (actor, i) => run(async () => {
      await sql`select erp.create_item(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.baseUnitDecisionId}::uuid, ${i.baseItemUnitId}::uuid,
        ${i.brandId}::uuid, ${i.code}::text, ${i.itemKind}::text, ${i.baseUnitKey}::text,
        ${i.nameEn}::text, ${i.nameAr}::text, ${i.descriptionEn}::text, ${i.descriptionAr}::text,
        ${i.picturePath}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    amendItem: (actor, i) => run(async () => {
      await sql`select erp.amend_item(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.nameEn}::text, ${i.nameAr}::text, ${i.descriptionEn}::text, ${i.descriptionAr}::text,
        ${i.picturePath}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    changeItemStatus: (actor, i) => run(async () => {
      await sql`select erp.change_item_status(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.status}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    addItemUnit: (actor, i) => run(async () => {
      await sql`select erp.add_item_unit(
        ${i.decisionId}::uuid, ${i.itemUnitId}::uuid, ${i.itemId}::uuid, ${i.unitKey}::text,
        ${i.factor}::numeric, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    retireItemUnit: (actor, i) => run(async () => {
      await sql`select erp.retire_item_unit(
        ${i.decisionId}::uuid, ${i.itemUnitId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    importItems: (actor, reason, rows) => run(async () => {
      const [row] = await sql`select erp.import_items(
        ${actor}::uuid, ${reason}::text, now(), ${sql.json(rows as postgres.JSONValue)}::jsonb) as summary`;
      return row?.['summary'] as ImportSummary;
    }),
  };
}

export function connect(url: string): Connection {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: 'erp-edge' },
  });
  return { ...makeDb(sql), end: () => sql.end() };
}
