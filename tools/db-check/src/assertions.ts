/**
 * The structural invariants, as SQL that returns offending rows.
 *
 * Every assertion here corresponds to a failure that has actually occurred in a
 * live project in this estate, documented in ADR-0018 and B-08. They are written
 * as "find the violations" rather than "check a boolean" so a failure names the
 * object rather than only reporting false.
 */

export interface Assertion {
  readonly id: string;
  readonly title: string;
  /** Why this exists. Printed on failure, so the fix is obvious from the output. */
  readonly because: string;
  /** Returns one row per violation. Zero rows passes. */
  readonly sql: string;
}

export const ASSERTIONS: readonly Assertion[] = [
  {
    id: 'no-erp-object-in-public',
    title: 'public holds no ERP relation',
    because:
      'A table in public inherits default privileges granting anon and authenticated ' +
      'insert, update and delete, with RLS off. ADR-0018 §1 — the trap that has already ' +
      'fired four times in this estate.',
    sql: `select c.relname as violation
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p','v','m')`,
  },
  {
    id: 'no-extension-in-public',
    title: 'no extension is installed in public',
    because:
      'pg_trgm in public is what couples the estate inbox to a schema it should not ' +
      'depend on, and pins three SECURITY DEFINER functions to it.',
    sql: `select e.extname as violation
          from pg_extension e
          join pg_namespace n on n.oid = e.extnamespace
          where n.nspname = 'public' and e.extname <> 'plpgsql'`,
  },
  {
    id: 'api-roles-cannot-reach-erp',
    title: 'anon, authenticated and service_role hold no USAGE on erp',
    because:
      'service_role carries BYPASSRLS, which skips policy evaluation but not aclcheck. ' +
      'Withholding USAGE is what actually binds it (ADR-0018 §3).',
    sql: `select r.rolname as violation
          from pg_roles r
          where r.rolname in ('anon','authenticated','service_role')
            and has_schema_privilege(r.rolname, 'erp', 'USAGE')`,
  },
  {
    id: 'api-roles-hold-no-table-privilege',
    title: 'no erp table is reachable by anon or authenticated',
    because:
      'The inbox project protects tables with a hand-written revoke in every migration. ' +
      'That discipline failed four times out of nineteen.',
    sql: `select c.relname || ' -> ' || r.rolname as violation
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          cross join (select unnest(array['anon','authenticated']) as rolname) r
          where n.nspname = 'erp' and c.relkind in ('r','p')
            and (
              has_table_privilege(r.rolname, c.oid, 'SELECT') or
              has_table_privilege(r.rolname, c.oid, 'INSERT') or
              has_table_privilege(r.rolname, c.oid, 'UPDATE') or
              has_table_privilege(r.rolname, c.oid, 'DELETE')
            )`,
  },
  {
    id: 'default-privileges-grant-nothing-to-api-roles',
    title: 'default privileges in erp grant nothing to anon or authenticated',
    because:
      'The safe case must be the default. If a future migration forgets a revoke, ' +
      'nothing should happen — that is the whole difference from the inbox project.',
    sql: `select n.nspname || ' ' || d.defaclobjtype::text as violation
          from pg_default_acl d
          join pg_namespace n on n.oid = d.defaclnamespace
          where n.nspname = 'erp'
            and (array_to_string(d.defaclacl, ',') like '%anon=%'
              or array_to_string(d.defaclacl, ',') like '%authenticated=%')`,
  },
  {
    id: 'functions-pin-search-path',
    title: 'every erp function pins its search_path',
    because:
      'An unpinned search_path is how a SECURITY DEFINER function is hijacked by a ' +
      'shadowing object. Four functions in the estate inbox carry that defect today.',
    sql: `select p.proname as violation
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'erp'
            and not exists (
              select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
              where cfg like 'search_path=%'
            )`,
  },
  {
    id: 'event-log-has-no-update-or-delete-grant',
    title: 'erp_app holds no UPDATE or DELETE on event_log',
    because:
      'ADR-0003 protection one. The grant is absent rather than revoked, so no future ' +
      'migration restores it by forgetting a line.',
    sql: `select 'erp_app has ' || priv as violation
          from (select unnest(array['UPDATE','DELETE']) as priv) p
          where has_table_privilege('erp_app', 'erp.event_log', p.priv)`,
  },
  {
    id: 'event-log-append-only-trigger-exists',
    title: 'event_log carries a BEFORE UPDATE OR DELETE trigger',
    because:
      'ADR-0003 protection two. Both are required, because "a migration accidentally ' +
      'rewrote history" is not a recoverable event.',
    sql: `select 'missing' as violation
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = 'erp.event_log'::regclass
              and not t.tgisinternal
              and (t.tgtype & 2) = 2            -- BEFORE
              and (t.tgtype & 16) = 16          -- UPDATE
              and (t.tgtype & 8) = 8            -- DELETE
          )`,
  },
  {
    id: 'rls-enabled-on-every-erp-table',
    title: 'every erp table has row-level security enabled',
    because:
      'Four tables in the estate inbox have RLS switched off and are writable with the ' +
      'anon key. Enabled-with-no-policy denies; disabled exposes.',
    sql: `select c.relname as violation
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'erp' and c.relkind in ('r','p')
            and c.relispartition = false
            and c.relrowsecurity = false`,
  },
  {
    id: 'partial-unique-indexes-present',
    title: 'the three conflict-detection indexes exist and are partial',
    because:
      'Invariant I-3 — no financial fact is ever merged. A full unique index here would ' +
      'forbid history; the WHERE clause is the mechanism, not a detail.',
    sql: `select expected.name as violation
          from (values ('ux_one_live_intent'),('ux_one_open_shift'),('ux_one_open_drawer')) as expected(name)
          where not exists (
            select 1 from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
            join pg_namespace n on n.oid = ic.relnamespace
            where n.nspname = 'erp' and ic.relname = expected.name
              and i.indisunique and i.indpred is not null
          )`,
  },
];

/**
 * Assertions about the seed, which exist because "synthetic, no real data" and
 * "reproducible" are claims a reader cannot check and a reviewer will not.
 *
 * SEC-012 forbids production data in development or testing without approved
 * masking. The cheapest way to keep that true is to make a violation fail a
 * build.
 */
export const SEED_ASSERTIONS: readonly Assertion[] = [
  {
    id: 'seed-actually-loaded',
    title: 'the seed inserted rows',
    because:
      'A seed that silently inserts nothing still exits zero, and every test built ' +
      'on it then passes against an empty database.',
    sql: `select 'no rows in ' || t as violation
          from unnest(array['erp.company','erp.facility','erp.orders','erp.event_log']) as t
          where (xpath('/row/c/text()',
                 query_to_xml('select count(*) as c from ' || t, false, true, '')))[1]::text::int = 0`,
  },
  {
    id: 'seed-holds-no-real-mobile',
    title: 'no Saudi mobile number outside the synthetic block',
    because:
      'A real customer number in a seed is a personal-data leak that travels into ' +
      'every developer machine and every CI log (SEC-005, SEC-008, SEC-012).',
    sql: `select distinct substring(payload::text from '(\\+?9665[0-9]{8})') as violation
          from erp.event_log
          where payload::text ~ '\\+?9665[0-9]{8}'
            and substring(payload::text from '(\\+?9665[0-9]{8})') !~ '^\\+?9665[0-9]{2}00000'`,
  },
  {
    id: 'seed-holds-no-iban-or-card',
    title: 'no IBAN or card-shaped number anywhere in the seed',
    because:
      'Payroll and payment data must never appear in a development seed. Shape is ' +
      'the only check available, so shape is what is checked.',
    sql: `select distinct substring(payload::text from '(SA[0-9]{22}|[0-9]{13,19})') as violation
          from erp.event_log
          where payload::text ~ '(SA[0-9]{22}|\\m[0-9]{13,19}\\M)'`,
  },
];
