/**
 * The one file that talks to PostgreSQL (ADR-0023, ADR-0025).
 *
 * postgres.js, pinned exactly in ../deno.json and locked in ../deno.lock, connecting as
 * erp_edge: a login role that is erp_app and nothing more (0014). It calls the four
 * session routes and nothing else; each answer is checked by ../_shared/db.ts before
 * anything else sees it.
 *
 * max: 1 and prepare: false, because a hosted project is reached through Supavisor in
 * transaction mode, where consecutive statements can land on different server
 * connections: a prepared statement made on one would not exist on the next. One
 * connection per function instance, because an instance serves one request at a time
 * often enough that more would only hold server connections idle.
 */
import postgres from 'postgres';
import {
  asSessionAnswer, asSignInAnswer, asSignOutAnswer,
  type Db,
} from '../_shared/db.ts';

export interface Connection extends Db {
  end(): Promise<void>;
}

export function connect(url: string): Connection {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: 'erp-edge' },
  });
  return {
    async signIn(employeeNumber, pin) {
      const [row] = await sql`select erp.sign_in(${employeeNumber}, ${pin}) as answer`;
      return asSignInAnswer(row?.['answer']);
    },
    async resolveSession(token) {
      const [row] = await sql`select erp.resolve_session(${token}) as answer`;
      return asSessionAnswer(row?.['answer']);
    },
    async signOut(token) {
      const [row] = await sql`select erp.sign_out(${token}) as answer`;
      return asSignOutAnswer(row?.['answer']);
    },
    end: () => sql.end(),
  };
}
