/**
 * Starts one edge function: reads its configuration, connects, and serves.
 *
 *   ERP_DATABASE_URL     erp_edge's connection string. Set by the owner on a hosted
 *                        project, as an approved action of its own (CLAUDE.md §4).
 *   ERP_ALLOWED_ORIGINS  the browser origins admitted, comma-separated; see
 *                        ../_shared/http.ts. Unset admits no browser.
 *
 * Both are read once, at start, so a missing or malformed value stops the function
 * before it answers anything rather than on the first request.
 */
import { connect } from './db.ts';
import { parseAllowedOrigins, type Endpoint } from '../_shared/http.ts';

export function serve(endpoint: Endpoint): void {
  const url = Deno.env.get('ERP_DATABASE_URL');
  if (url === undefined || url === '') throw new Error('ERP_DATABASE_URL is not set');
  const deps = { db: connect(url), allowedOrigins: parseAllowedOrigins(Deno.env.get('ERP_ALLOWED_ORIGINS')) };
  Deno.serve((request) => endpoint(request, deps));
}
