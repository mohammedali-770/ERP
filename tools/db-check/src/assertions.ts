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

/**
 * Every append-only log, found by name: each %_log, %_decision and %_ledger table in erp
 * (a predicate on pg_class c). One copy, read by every-decision-log-is-append-only below
 * and by cli.ts's runtime probe, so the catalogue check and the attempted writes cannot
 * cover different tables. 0020's stock_ledger is the first %_ledger.
 */
export const LOG_BY_NAME =
  `(c.relname like '%\\_log' or c.relname like '%\\_decision' or c.relname like '%\\_ledger')`;

export const ASSERTIONS: readonly Assertion[] = [
  {
    id: 'database-is-utf8',
    title: 'the database is UTF8 with a Unicode character type, as Supabase\'s is',
    because:
      'In SQL_ASCII, length() counts bytes, so every Arabic string measures about twice ' +
      'its length; with ctype C, lower(), upper() and [[:space:]] are ASCII-only. The ' +
      'scratch cluster took both from the environment and disagreed with the real database ' +
      'about non-ASCII text wherever LANG was unset. Found when an 11-character Arabic unit ' +
      'name failed a 12-character check in 0012. The encoding is also checked before any ' +
      'migration runs (cluster.ts); this catches the character type, and a fallback to C ' +
      'on a machine with no UTF-8 locale installed.',
    sql: `select 'database ' || datname || ' is ' || pg_encoding_to_char(encoding) || ' with ctype ' || datctype as violation
          from pg_database
          where datname = current_database()
            and (pg_encoding_to_char(encoding) <> 'UTF8' or datctype in ('C', 'POSIX'))`,
  },
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
      'That discipline failed four times out of nineteen. SELECT, INSERT and UPDATE are ' +
      'checked per column too: a column-level grant reaches a table as surely as a table ' +
      'one, and has_table_privilege does not see it.',
    sql: `select c.relname || ' -> ' || r.rolname as violation
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          cross join (select unnest(array['anon','authenticated']) as rolname) r
          where n.nspname = 'erp' and c.relkind in ('r','p')
            and (
              has_any_column_privilege(r.rolname, c.oid, 'SELECT') or
              has_any_column_privilege(r.rolname, c.oid, 'INSERT') or
              has_any_column_privilege(r.rolname, c.oid, 'UPDATE') or
              has_table_privilege(r.rolname, c.oid, 'DELETE') or
              has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
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
    title: 'erp_app holds no UPDATE, DELETE or TRUNCATE on event_log',
    because:
      'ADR-0003 protection one. The grant is absent rather than revoked, so no future ' +
      'migration restores it by forgetting a line. UPDATE is checked per column too, since ' +
      'a column-level grant also lets a role rewrite a row. Its partitions are checked by ' +
      'every-decision-log-is-append-only.',
    sql: `select 'erp_app has ' || p.priv as violation
          from (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
          where case p.priv
                  when 'UPDATE' then has_any_column_privilege('erp_app', 'erp.event_log', 'UPDATE')
                  else has_table_privilege('erp_app', 'erp.event_log', p.priv)
                end`,
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
  {
    id: 'projection-stamp-is-mandatory',
    title: 'every projection stamp column is NOT NULL',
    because:
      'Invariant I-8 — a materialised row carries the record it was computed through, ' +
      'so it can always be checked. A nullable stamp permits a row that cannot be ' +
      'checked against its log at all, which is the failure the column exists to ' +
      'prevent. Migration 0006 left all four nullable; 0009 fixed it. ' +
      'The table list USED to be four names written out here, which meant a fifth ' +
      'projection passed this assertion while proving nothing about itself. It now ' +
      'discovers the columns by name, so a projection cannot be added without being ' +
      'covered — 0010 was the fifth and is how the gap was noticed.',
    sql: `select c.relname || '.' || a.attname as violation
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'erp'
            and c.relkind in ('r', 'p')
            and a.attnum > 0
            and not a.attisdropped
            and a.attname like 'as\\_of\\_%\\_id'
            and not a.attnotnull`,
  },
  {
    id: 'projection-stamp-is-a-foreign-key-where-it-can-be',
    title: 'every projection stamp that can be a foreign key is one',
    because:
      'The four event-log projections cannot have one: erp.event_log is partitioned ' +
      'on business_date, so its primary key is composite and a single-column ' +
      'reference is unavailable (0009 says so in full) — projection-stamp-resolves-' +
      'to-a-real-event stands in for it. Every other log is unpartitioned, so its ' +
      'stamps are enforced by structure, which is strictly stronger than a tool, and ' +
      'dropping one would silently downgrade the guarantee. This USED to name ' +
      'erp.capability_state alone; 0011 added three more stamped projections, and a ' +
      'name list would have passed them unchecked — so it now discovers the columns, ' +
      'and as_of_event_id is the one exception, named with its reason.',
    sql: `select c.relname || '.' || a.attname as violation
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'erp'
            and c.relkind in ('r', 'p')
            and c.relispartition = false
            and a.attnum > 0
            and not a.attisdropped
            and a.attname like 'as\\_of\\_%\\_id'
            and a.attname <> 'as_of_event_id'
            and not exists (
              select 1 from pg_constraint k
              where k.conrelid = c.oid and k.contype = 'f' and k.conkey = array[a.attnum]
            )`,
  },
  {
    id: 'no-erp-function-is-executable-by-public',
    title: 'no erp function is executable by PUBLIC',
    because:
      'PostgreSQL grants EXECUTE on every new function to PUBLIC as a GLOBAL default, ' +
      'and 0002\'s `alter default privileges … in schema erp revoke … on functions` ' +
      'cannot undo it: a per-schema revoke only reverses a per-schema grant. So every ' +
      'erp function was callable by anyone with USAGE on the schema — including ' +
      'erp_read, which could call SECURITY DEFINER functions that write. 0011 revokes ' +
      'it; this catches the next migration that adds a function and forgets to.',
    sql: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as violation
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'erp'
            and exists (
              select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            )`,
  },
  {
    id: 'credential-tables-are-unreachable',
    title: 'no role but the owner holds any privilege on a credential table',
    because:
      'A PIN hash is checked by erp.verify_pin(), which is SECURITY DEFINER and ' +
      'answers with a status, so no role ever needs to read one. 0002 default-grants ' +
      'SELECT on every new erp table to erp_read, which put the hash in the reporting ' +
      'role\'s reach until 0011 revoked it. Discovered by name, so a credential table ' +
      'added later is covered without anyone remembering to list it: a table named for ' +
      'credentials, or one with a column named for a token. erp.session holds only a ' +
      'token\'s SHA-256 (0014), and is unreachable all the same: the routes answer for it.',
    sql: `with credential as (
            select c.oid, c.relname, c.relowner, c.relacl
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'erp'
              and c.relkind in ('r', 'p')
              and (c.relname like '%credential%'
                   or exists (select 1 from pg_attribute t
                               where t.attrelid = c.oid and t.attnum > 0 and not t.attisdropped
                                 and t.attname like '%token%'))
          )
          select c.relname || ' — ' || a.privilege_type || ' to ' ||
                 coalesce(r.rolname, 'PUBLIC') as violation
          from credential c
          cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          left join pg_roles r on r.oid = a.grantee
          where a.grantee <> c.relowner
          union all
          -- A column-level grant reaches a column as surely as a table grant reaches the
          -- table, and relacl does not show it (found in review).
          select c.relname || '.' || t.attname || ' — ' || a.privilege_type || ' to ' ||
                 coalesce(r.rolname, 'PUBLIC')
          from credential c
          join pg_attribute t on t.attrelid = c.oid and t.attnum > 0 and not t.attisdropped
          cross join lateral aclexplode(t.attacl) a
          left join pg_roles r on r.oid = a.grantee
          where a.grantee <> c.relowner`,
  },
  {
    id: 'every-decision-log-is-append-only',
    title: 'every decision log, and every partition of one, refuses UPDATE, DELETE and TRUNCATE, by trigger and by grant',
    because:
      'A log that can be edited answers nothing. Discovered by name — every %_log, %_decision ' +
      'and %_ledger table, event_log, sign_in_log and stock_ledger among them — and through ' +
      'pg_inherits, so a ' +
      'new log or partition is covered ' +
      'without being listed. Each needs an enabled BEFORE UPDATE OR DELETE trigger with no ' +
      'WHEN clause, an enabled BEFORE TRUNCATE trigger (no UPDATE or DELETE trigger sees ' +
      'TRUNCATE), and no write grant to erp_app or erp_read, UPDATE checked per column. A ' +
      'partitioned log also needs a ROW trigger: PostgreSQL fires a partitioned table\'s ' +
      'statement triggers only for statements that name the parent, so 0004\'s statement ' +
      'trigger never fired for "delete from erp.event_log_default", and the owner could ' +
      'delete every event (0013). Row triggers are cloned onto partitions; statement ' +
      'triggers are not, which is why each partition needs its own TRUNCATE trigger. That ' +
      'the triggers actually REFUSE is proved at runtime, below, on every table found here.',
    sql: `with recursive logs as (
            select c.oid, c.relname, c.relkind
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'erp' and c.relkind in ('r', 'p') and not c.relispartition
              and ${LOG_BY_NAME}
          ),
          partitions as (
            select i.inhrelid as oid from logs l join pg_inherits i on i.inhparent = l.oid
            union all
            select i.inhrelid from partitions p join pg_inherits i on i.inhparent = p.oid
          ),
          guarded as (
            select oid, relname, relkind from logs
            union all
            select c.oid, c.relname, c.relkind from partitions p join pg_class c on c.oid = p.oid
          )
          select g.relname || ': ' || p.problem as violation
          from guarded g
          cross join lateral (
            -- A trigger cloned from a partitioned parent counts: on PostgreSQL 14 and
            -- earlier it is marked internal, and tgparentid names its parent.
            select 'no enabled, unconditional BEFORE UPDATE OR DELETE trigger' as problem
             where not exists (
               select 1 from pg_trigger t
               where t.tgrelid = g.oid and (not t.tgisinternal or t.tgparentid <> 0)
                 and t.tgenabled in ('O', 'A') and t.tgqual is null
                 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 8) = 8)
            union all select 'no enabled, unconditional BEFORE TRUNCATE trigger'
             where not exists (
               select 1 from pg_trigger t
               where t.tgrelid = g.oid and not t.tgisinternal
                 and t.tgenabled in ('O', 'A') and t.tgqual is null
                 and (t.tgtype & 2) = 2 and (t.tgtype & 32) = 32)
            union all select 'partitioned, with no ROW trigger to reach its partitions'
             where g.relkind = 'p' and not exists (
               select 1 from pg_trigger t
               where t.tgrelid = g.oid and not t.tgisinternal
                 and t.tgenabled in ('O', 'A') and t.tgqual is null and (t.tgtype & 1) = 1
                 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 8) = 8)
            union all select 'erp_app may UPDATE' where has_any_column_privilege('erp_app', g.oid, 'UPDATE')
            union all select 'erp_app may DELETE or TRUNCATE'
             where has_table_privilege('erp_app', g.oid, 'DELETE') or has_table_privilege('erp_app', g.oid, 'TRUNCATE')
            union all select 'erp_read may UPDATE, DELETE or TRUNCATE'
             where has_any_column_privilege('erp_read', g.oid, 'UPDATE')
                or has_table_privilege('erp_read', g.oid, 'DELETE') or has_table_privilege('erp_read', g.oid, 'TRUNCATE')
          ) p`,
  },
  {
    id: 'no-foreign-key-cascades-or-nulls-in-erp',
    title: 'no foreign key in erp cascades, nulls or defaults on delete or update',
    because:
      'B-11: the warehouse system cascades in 51 places and nulls the actor of a stock ' +
      'movement when a user is deleted, so removing a person or an item silently rewrote ' +
      'history. Here records are retired, never deleted, and a reference that could ' +
      'change underneath a row is refused. It passes for every migration so far; it binds ' +
      'every Phase 4 module from 0012 on.',
    sql: `select c.conrelid::regclass::text || ' ' || c.conname as violation
          from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
          where n.nspname = 'erp' and c.contype = 'f'
            and (c.confdeltype in ('c', 'n', 'd') or c.confupdtype in ('c', 'n', 'd'))`,
  },
  {
    id: 'item-guard-triggers-exist',
    title: 'erp.item and erp.item_unit carry their enabled guard triggers, TRUNCATE included',
    because:
      'INV-002, INV-005, B-11: an item\'s identity and a conversion\'s factor are fixed, and ' +
      'neither is ever deleted, only because 0012\'s triggers say so — and they bind the ' +
      'owner too. A seed written to be consistent passes with the triggers gone, so their ' +
      'presence is checked here directly: a BEFORE row trigger on UPDATE and DELETE (and ' +
      'INSERT, for conversions), and a BEFORE TRUNCATE statement trigger, since row ' +
      'triggers do not fire for TRUNCATE.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.item'::regclass,      27, 1, 'BEFORE UPDATE OR DELETE row trigger'),
                  ('erp.item_unit'::regclass, 31, 1, 'BEFORE INSERT OR UPDATE OR DELETE row trigger'),
                  ('erp.item'::regclass,      34, 0, 'BEFORE TRUNCATE statement trigger'),
                  ('erp.item_unit'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger')
               ) as x(rel, mask, row_bit, what)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'supplier-guard-triggers-exist',
    title: 'erp.supplier and erp.supplier_item carry their enabled guard triggers, TRUNCATE included',
    because:
      'PRC-005, I-7, B-11: a supplier\'s code and a supply\'s supplier and conversion are ' +
      'fixed, a retired supply stays retired, and neither is ever deleted, only because ' +
      '0016\'s triggers say so — and they bind the owner too. A consistent seed passes with ' +
      'the triggers gone, so their presence is checked directly, as item-guard-triggers-exist ' +
      'does for 0012: a BEFORE UPDATE OR DELETE row trigger and a BEFORE TRUNCATE statement ' +
      'trigger on each, each firing the function 0016 wrote for it.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.supplier'::regclass,      27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.supplier_is_fixed()'::regprocedure),
                  ('erp.supplier_item'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.supplier_item_is_fixed()'::regprocedure),
                  ('erp.supplier'::regclass,      34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.supplier_tables_are_never_truncated()'::regprocedure),
                  ('erp.supplier_item'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.supplier_tables_are_never_truncated()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'transfer-price-guard-triggers-exist',
    title: 'erp.transfer_price carries its enabled guard triggers, TRUNCATE included',
    because:
      'INV-017, I-7, B-11: a price\'s pack, amount and moment are fixed, a price in effect is ' +
      'never withdrawn, a withdrawal is final, and no price is ever deleted, only because ' +
      '0018\'s triggers say so — and they bind the owner too. A consistent seed passes with ' +
      'the triggers gone, so their presence is checked directly, as supplier-guard-triggers-exist ' +
      'does for 0016.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.transfer_price'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.transfer_price_is_fixed()'::regprocedure),
                  ('erp.transfer_price'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.transfer_prices_are_never_truncated()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'facility-guard-triggers-exist',
    title: 'erp.facility carries its enabled guard triggers, TRUNCATE included',
    because:
      'PRG-002, B-11, Q-22: a facility\'s code, type, brand and time zone are fixed and no facility ' +
      'is ever deleted, only because 0019\'s triggers say so — and they bind the owner too. Every ' +
      'role, order, shift and device points at a facility, so a branch moved to another brand or ' +
      'given another time zone would rewrite what they mean after the fact. A consistent seed ' +
      'passes with the triggers gone, so their presence is checked directly.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.facility'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.facility_is_fixed()'::regprocedure),
                  ('erp.facility'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.facilities_are_never_truncated()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'notification-guard-triggers-exist',
    title: 'erp.notification carries its enabled guard triggers, and stock below zero its producer',
    because:
      'N3 (ADR-0030): a notification changes once, from unread to read, and is deleted only past ' +
      '90 days, only because 0021\'s triggers say so, binding the owner too. N4: stock taken below ' +
      'zero by an override tells anyone only because two triggers on erp.stock_balance say so: ' +
      'ordinary AFTER INSERT and AFTER UPDATE statement triggers, with their transition tables and no ' +
      'WHEN, fired when the seam\'s one balance statement ends, reading what that decision left. A ' +
      'constraint trigger can be deferred or hurried by SET CONSTRAINTS, which needs no privilege; the ' +
      'first design was one, on the decision, and review found it told nobody when hurried and ' +
      'reported the wrong balance when deferred past a second decision. The second was a row ' +
      'trigger, which review found redid the whole notification once per item. A consistent seed ' +
      'passes with any of them gone.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.notification'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.notification_guard()'::regprocedure),
                  ('erp.notification'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.notification_guard()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)
          union all
          select 'erp.stock_balance: no enabled AFTER ' || x.what || ' statement trigger with its transition ' ||
                 'tables, not a constraint trigger and with no WHEN, calling erp.notify_stock_below_zero()'
          from (values (4, 'INSERT', false), (16, 'UPDATE', true)) as x(event, what, needs_old)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = 'erp.stock_balance'::regclass and not t.tgisinternal
              and t.tgfoid = 'erp.notify_stock_below_zero()'::regprocedure
              and t.tgenabled in ('O', 'A') and t.tgconstraint = 0 and t.tgqual is null
              and (t.tgtype & x.event) = x.event and (t.tgtype & 3) = 0
              and t.tgnewtable = 'new_rows' and (not x.needs_old or t.tgoldtable = 'old_rows'))`,
  },
  {
    id: 'stock-guard-triggers-exist',
    title: 'erp.stock_balance carries its enabled guard triggers, TRUNCATE included',
    because:
      'I-8, B-11: a balance is the sum of its ledger, so it stays the balance of one facility ' +
      'and item and is never deleted, only because 0020\'s triggers say so — and they bind the ' +
      'owner too. The three stock logs are covered by every-decision-log-is-append-only. A ' +
      'consistent seed passes with the triggers gone, so their presence is checked directly.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.stock_balance'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.stock_balance_is_fixed()'::regprocedure),
                  ('erp.stock_balance'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.stock_balances_are_never_truncated()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'stock-minimum-guard-triggers-exist',
    title: 'erp.stock_minimum carries its enabled guard triggers, and stock falling to a minimum its producer',
    because:
      'I-8, B-11: a minimum stays the minimum of one facility and item and is cleared, never ' +
      'deleted, only because 0022\'s triggers say so, binding the owner too; its log is covered by ' +
      'every-decision-log-is-append-only. A2 (ADR-0031): stock falling to its minimum tells anyone ' +
      'only because an AFTER UPDATE statement trigger on erp.stock_balance says so, with both ' +
      'transition tables, since a crossing is the balance before the posting against the balance ' +
      'after it. Not a constraint trigger and with no WHEN, for 0021\'s reasons. A consistent seed ' +
      'passes with any of them gone.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.stock_minimum'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.stock_minimum_is_fixed()'::regprocedure),
                  ('erp.stock_minimum'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.stock_minimum_is_fixed()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)
          union all
          select 'erp.stock_balance: no enabled AFTER UPDATE statement trigger with both transition tables, ' ||
                 'not a constraint trigger and with no WHEN, calling erp.notify_stock_low()'
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = 'erp.stock_balance'::regclass and not t.tgisinternal
              and t.tgfoid = 'erp.notify_stock_low()'::regprocedure
              and t.tgenabled in ('O', 'A') and t.tgconstraint = 0 and t.tgqual is null
              and (t.tgtype & 16) = 16 and (t.tgtype & 3) = 0
              and t.tgnewtable = 'new_rows' and t.tgoldtable = 'old_rows')`,
  },
  {
    id: 'purchase-guard-triggers-exist',
    title: 'erp.purchase_order and erp.purchase_limit carry their guards, and an order\'s lines and receipts refuse every change',
    because:
      'I-8, B-11, ADR-0032: an order is fixed as raised and its state moves only forward, a limit stays ' +
      'its facility\'s and is cleared, never deleted, and an order\'s lines, its receipts and their lines ' +
      'are written once — only because 0023\'s triggers say so, binding the owner too. The two logs are ' +
      'covered by every-decision-log-is-append-only; these four tables are not logs by name, so they are ' +
      'named here. A consistent seed passes with any of them gone.',
    sql: `select x.rel::text || ': no enabled ' || x.what as violation
          from (values
                  ('erp.purchase_order'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.purchase_order_is_fixed()'::regprocedure),
                  ('erp.purchase_order'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.purchase_order_is_fixed()'::regprocedure),
                  ('erp.purchase_limit'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.purchase_limit_is_fixed()'::regprocedure),
                  ('erp.purchase_limit'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.purchase_limit_is_fixed()'::regprocedure),
                  ('erp.purchase_order_line'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure),
                  ('erp.purchase_order_line'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure),
                  ('erp.purchase_receipt'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure),
                  ('erp.purchase_receipt'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure),
                  ('erp.purchase_receipt_line'::regclass, 27, 1, 'BEFORE UPDATE OR DELETE row trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure),
                  ('erp.purchase_receipt_line'::regclass, 34, 0, 'BEFORE TRUNCATE statement trigger',
                   'erp.purchase_record_is_fixed()'::regprocedure)
               ) as x(rel, mask, row_bit, what, fn)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = x.rel and not t.tgisinternal and t.tgfoid = x.fn
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'every-runtime-definer-route-is-gated',
    title: 'every SECURITY DEFINER function the runtime may call contains a call to erp.assert_permitted()',
    because:
      'A definer function runs as its owner, so the capability gate and the permission check ' +
      'are the only thing standing between the runtime and the tables it writes. 0012\'s ' +
      'review found the gate proved on 2 of its 9 routes by tests; this finds a missing gate ' +
      'on any route, in any module, by reading the catalogue. It reads the source, so it ' +
      'proves the call is written, not that it runs first: each module\'s pgTAP suite proves ' +
      'that, route by route. The exceptions are the session routes, which are how a person ' +
      'comes to be named at all, so there is nobody yet to ask (ADR-0025): erp.sign_in(), ' +
      'erp.resolve_session() and erp.sign_out(), which ends only the session its own token ' +
      'proves. erp.verify_pin() is no longer one: since 0014 the runtime cannot call it, ' +
      'and granting it back would be a way round the sign-in log, so this would report it. ' +
      'The exceptions are named by signature, not by name: an overload such as ' +
      'erp.sign_out(uuid) is reported like any other route (found in review).',
    sql: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as violation
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'erp'
            and p.prosecdef
            and has_function_privilege('erp_app', p.oid, 'EXECUTE')
            and p.oid::regprocedure::text not in
                ('erp.sign_in(text,text)', 'erp.resolve_session(text)', 'erp.sign_out(text)')
            and strpos(p.prosrc, 'erp.assert_permitted(') = 0`,
  },
  {
    id: 'session-guard-triggers-exist',
    title: 'erp.session carries its enabled guard triggers, TRUNCATE included',
    because:
      'ADR-0025: a session\'s person, token and lifetime are fixed when it starts, an ended ' +
      'session never reopens, and none is deleted, because the sign-in log names it. Only ' +
      '0014\'s triggers say so, and they bind the owner too. A BEFORE UPDATE OR DELETE row ' +
      'trigger, and a BEFORE TRUNCATE statement trigger, which row triggers do not see. Both ' +
      'must fire erp.session_guard(): a trigger of the right shape that calls something else ' +
      'guards nothing (found in review). That the function still refuses is pgTAP 090\'s job.',
    sql: `select 'erp.session: no enabled ' || x.what as violation
          from (values (27, 1, 'BEFORE UPDATE OR DELETE row trigger'),
                       (34, 0, 'BEFORE TRUNCATE statement trigger')) as x(mask, row_bit, what)
          where not exists (
            select 1 from pg_trigger t
            where t.tgrelid = 'erp.session'::regclass and not t.tgisinternal
              and t.tgfoid = 'erp.session_guard()'::regprocedure
              and t.tgenabled in ('O', 'A') and t.tgqual is null
              and (t.tgtype & x.mask) = x.mask and (t.tgtype & 1) = x.row_bit)`,
  },
  {
    id: 'erp-edge-is-erp-app-and-nothing-more',
    title: 'erp_edge logs in, is a member of erp_app alone, and holds nothing of its own',
    because:
      'ADR-0023: the edge functions hold the database credential, and erp_edge is what it ' +
      'logs in as. It must be able to do exactly what the runtime can and nothing more: no ' +
      'second role, no superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS, no grant ' +
      'of its own on any erp object, and a connection limit. And no password from a ' +
      'migration — one in the repository would be a credential in the repository; it is set ' +
      'out of band (0014). INHERIT, because a transaction-mode pooler keeps no SET ROLE.',
    sql: `with edge as (select * from pg_roles where rolname = 'erp_edge')
          select 'erp_edge does not exist' as violation where not exists (select 1 from edge)
          union all
          select 'erp_edge ' || p.problem
          from edge e
          cross join lateral (
            select 'cannot log in' as problem where not e.rolcanlogin
            union all select 'does not inherit, so erp_app''s grants do not reach it' where not e.rolinherit
            union all select 'is a superuser' where e.rolsuper
            union all select 'may create roles' where e.rolcreaterole
            union all select 'may create databases' where e.rolcreatedb
            union all select 'may replicate' where e.rolreplication
            union all select 'bypasses row-level security' where e.rolbypassrls
            union all select 'has no connection limit' where e.rolconnlimit < 0
            union all select 'has a password set by a migration'
             where exists (select 1 from pg_authid a where a.oid = e.oid and a.rolpassword is not null)
            union all select 'is not a member of erp_app'
             where not exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                                where m.member = e.oid and g.rolname = 'erp_app')
            union all select 'is also a member of ' || g.rolname
             from pg_auth_members m join pg_roles g on g.oid = m.roleid
             where m.member = e.oid and g.rolname <> 'erp_app'
            union all select 'holds a grant of its own on ' || c.oid::regclass::text
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             cross join lateral aclexplode(c.relacl) a
             where n.nspname = 'erp' and a.grantee = e.oid
            union all select 'holds a column grant of its own on ' || c.oid::regclass::text || '.' || t.attname
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute t on t.attrelid = c.oid and t.attnum > 0 and not t.attisdropped
             cross join lateral aclexplode(t.attacl) a
             where n.nspname = 'erp' and a.grantee = e.oid
            union all select 'holds a grant of its own on ' || p.oid::regprocedure::text
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             cross join lateral aclexplode(p.proacl) a
             where n.nspname = 'erp' and a.grantee = e.oid
            union all select 'holds a grant of its own on schema ' || n.nspname
             from pg_namespace n cross join lateral aclexplode(n.nspacl) a
             where a.grantee = e.oid
          ) p`,
  },
];

/**
 * The stock ledger's invariants (0020, ADR-0029). Seed assertions, because they hold rows
 * to rules, and exported apart because cli.ts asks them again after its two-session
 * probes have posted through the routes: a race the routes lost would show here.
 */
export const STOCK_ASSERTIONS: readonly Assertion[] = [
  {
    id: 'stock-balances-match-their-ledger',
    title: 'every stock balance equals its ledger, and none went below zero unless overridden',
    because:
      'I-8 and ledger-primitives: the ledger is the master and a balance its sum, so each ' +
      'balance must EQUAL the sum of its entries, be stamped with the latest decision that ' +
      'touched it, and carry the moment of its latest count; every facility and item with an ' +
      'entry or a count line has one. The warehouse kept the counter as the master and the ' +
      'movements as its side effect, and they drifted. And D1: replayed in the order the ' +
      'decisions were applied (seq, drawn under the balance lock), no decision took an item ' +
      'below zero without an override, and none recorded an override it did not need.',
    sql: `with sums as (
            select e.facility_id, e.item_id,
                   sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end) as total
            from erp.stock_ledger e group by e.facility_id, e.item_id
          ),
          counted as (
            select c.facility_id, c.item_id, max(c.occurred_at) as last
            from erp.stock_count_log c group by c.facility_id, c.item_id
          ),
          touched as (
            select e.facility_id, e.item_id, e.decision_id from erp.stock_ledger e
            union
            select c.facility_id, c.item_id, c.decision_id from erp.stock_count_log c
          ),
          latest as (
            select distinct on (t.facility_id, t.item_id) t.facility_id, t.item_id, t.decision_id
            from touched t join erp.stock_decision d on d.decision_id = t.decision_id
            order by t.facility_id, t.item_id, d.seq desc
          ),
          deltas as (
            select e.facility_id, e.item_id, d.decision_id, d.seq, d.kind, d.override_reason,
                   sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end) as delta
            from erp.stock_ledger e join erp.stock_decision d on d.decision_id = e.decision_id
            group by e.facility_id, e.item_id, d.decision_id, d.seq, d.kind, d.override_reason
          ),
          running as (
            select x.*, sum(x.delta) over (partition by x.facility_id, x.item_id order by x.seq) as after
            from deltas x
          )
          select 'balance ' || b.facility_id || '/' || b.item_id || ' is ' || b.on_hand
                 || ', its entries sum to ' || coalesce(s.total, 0) as violation
          from erp.stock_balance b
          left join sums s on s.facility_id = b.facility_id and s.item_id = b.item_id
          where b.on_hand <> coalesce(s.total, 0)
          union all
          select 'balance ' || b.facility_id || '/' || b.item_id || ' is stamped ' || b.as_of_decision_id
                 || ', not the latest decision about it, ' || coalesce(l.decision_id::text, 'none')
          from erp.stock_balance b
          left join latest l on l.facility_id = b.facility_id and l.item_id = b.item_id
          where l.decision_id is distinct from b.as_of_decision_id
          union all
          select 'balance ' || b.facility_id || '/' || b.item_id || ' was last counted at '
                 || coalesce(b.last_counted_at::text, 'never') || ', its counts say ' || coalesce(c.last::text, 'never')
          from erp.stock_balance b
          left join counted c on c.facility_id = b.facility_id and c.item_id = b.item_id
          where b.last_counted_at is distinct from c.last
          union all
          select 'no balance for ' || t.facility_id || '/' || t.item_id
          from (select distinct facility_id, item_id from touched) t
          where not exists (select 1 from erp.stock_balance b
                             where b.facility_id = t.facility_id and b.item_id = t.item_id)
          union all
          select 'decision ' || r.decision_id || ' took ' || r.facility_id || '/' || r.item_id || ' to ' || r.after
                 || ' with no override'
          from running r
          where r.kind <> 'count' and r.override_reason is null and r.delta < 0 and r.after < 0
          union all
          select 'decision ' || d.decision_id || ' records an override it did not need'
          from erp.stock_decision d
          where d.override_reason is not null
            and not exists (select 1 from running r where r.decision_id = d.decision_id and r.delta < 0 and r.after < 0)`,
  },
  {
    id: 'stock-ledger-matches-its-decisions',
    title: 'every stock decision is dated by D3, has its lines, and a reversal mirrors its target',
    because:
      'D3 (ADR-0029): a warehouse\'s or a factory\'s business day is the calendar date of the ' +
      'moment in the facility\'s time zone, and no branch or office holds stock until a ' +
      'branch\'s business day is decided (Q-06) — a date stamped on an append-only ledger can ' +
      'never be corrected. Nothing is recorded at or before a count of the item made earlier, ' +
      'and a count never shares a moment with a movement, or it is counted twice. What a count ' +
      'posts is what it found less the book at its moment. A reversal ' +
      'undoes an adjustment or a write-off whole: one mirrored entry per entry, the same ' +
      'conversion and quantity, the other way (I-6, I-7). Foreign keys bind each entry to its ' +
      'decision\'s kind, facility and moment and a reversal to its target\'s; these are the ' +
      'rules no key can state.',
    sql: `select 'decision ' || d.decision_id || ': business day ' || d.business_date
                 || ' is not the date of ' || d.occurred_at || ' at ' || f.code as violation
          from erp.stock_decision d join erp.facility f on f.facility_id = d.facility_id
          where f.facility_type in ('warehouse', 'factory')
            and d.business_date <> (d.occurred_at at time zone f.tz_name)::date
          union all
          select 'decision ' || d.decision_id || ' is at ' || f.code || ', a ' || f.facility_type
          from erp.stock_decision d join erp.facility f on f.facility_id = d.facility_id
          where f.facility_type not in ('warehouse', 'factory')
          union all
          select 'decision ' || d.decision_id || ' has no lines'
          from erp.stock_decision d
          where (d.kind <> 'count' and not exists (select 1 from erp.stock_ledger e where e.decision_id = d.decision_id))
             or (d.kind = 'count' and not exists (select 1 from erp.stock_count_log c where c.decision_id = d.decision_id))
          union all
          select 'reversal ' || d.decision_id || ' reverses a ' || t.kind
          from erp.stock_decision d join erp.stock_decision t on t.decision_id = d.reverses_decision_id
          where t.kind not in ('adjustment', 'waste', 'damage', 'expiry', 'receipt')
          union all
          select 'reversal ' || d.decision_id || ' does not mirror ' || d.reverses_decision_id || ' whole'
          from erp.stock_decision d
          where d.kind = 'reversal'
            and ((select count(*) from erp.stock_ledger t where t.decision_id = d.reverses_decision_id)
                 <> (select count(*) from erp.stock_ledger r where r.decision_id = d.decision_id)
                 or exists (
                   select 1 from erp.stock_ledger r
                   left join erp.stock_ledger t on t.entry_id = r.reverses_entry_id
                   where r.decision_id = d.decision_id
                     and (t.entry_id is null or t.decision_id <> d.reverses_decision_id or t.direction = r.direction
                          or (t.item_id, t.item_unit_id, t.unit_key, t.factor, t.quantity, t.base_quantity)
                             is distinct from (r.item_id, r.item_unit_id, r.unit_key, r.factor, r.quantity, r.base_quantity))))
          union all
          select 'count ' || e.decision_id || ' posts ' || i.code || '''s variance in ' || e.unit_key
                 || ', not its base unit, or more than once'
          from erp.stock_ledger e join erp.item i on i.item_id = e.item_id
          where e.kind = 'count'
            and (e.unit_key <> i.base_unit_key
                 or exists (select 1 from erp.stock_ledger o
                             where o.decision_id = e.decision_id and o.item_id = e.item_id and o.line_no <> e.line_no))
          union all
          select 'decision ' || e.decision_id || ' is dated at or before the count ' || c.decision_id
                 || ' of the same item, recorded before it'
          from erp.stock_ledger e
          join erp.stock_decision d on d.decision_id = e.decision_id
          join erp.stock_count_log c on c.facility_id = e.facility_id and c.item_id = e.item_id
          join erp.stock_decision cd on cd.decision_id = c.decision_id
          where cd.seq < d.seq
            and (e.occurred_at <= c.occurred_at
                 or (cd.moment_stated and e.kind <> 'count'
                     and e.occurred_at < date_trunc('minute', c.occurred_at) + interval '1 minute'))
          union all
          select 'decision ' || c.decision_id || ' is dated at or before the count ' || p.decision_id
                 || ' of the same item, recorded before it'
          from erp.stock_count_log c
          join erp.stock_decision cd on cd.decision_id = c.decision_id
          join erp.stock_count_log p on p.facility_id = c.facility_id and p.item_id = c.item_id
          join erp.stock_decision pd on pd.decision_id = p.decision_id
          where pd.seq < cd.seq and c.occurred_at <= p.occurred_at
          union all
          -- What a count posted is what it found less the book as it stood at its moment,
          -- as known when it was recorded: every earlier decision's entries dated at or
          -- before it. A balance kept equal to its entries says nothing about this; a count
          -- that read a stale book would pass every other check (found in review).
          select 'count ' || k.decision_id || ' posted ' || coalesce(v.variance, 0) || ' for ' || k.item_id
                 || ', not what it found less the book at its moment'
          from (select c.decision_id, c.facility_id, c.item_id, c.occurred_at, sum(c.base_quantity) as found
                  from erp.stock_count_log c
                 group by c.decision_id, c.facility_id, c.item_id, c.occurred_at) k
          join erp.stock_decision kd on kd.decision_id = k.decision_id
          left join lateral (
            select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end) as variance
              from erp.stock_ledger e where e.decision_id = k.decision_id and e.item_id = k.item_id) v on true
          where k.found - coalesce((
                  select sum(case e.direction when 'in' then e.base_quantity else -e.base_quantity end)
                    from erp.stock_ledger e join erp.stock_decision d on d.decision_id = e.decision_id
                   where e.facility_id = k.facility_id and e.item_id = k.item_id
                     and d.seq < kd.seq and e.occurred_at <= k.occurred_at), 0)
                <> coalesce(v.variance, 0)
          union all
          -- A stated count holds its whole minute; a count made now, its instant.
          select 'count ' || c.decision_id || ' shares its moment with ' || e.decision_id
          from erp.stock_count_log c
          join erp.stock_decision cd on cd.decision_id = c.decision_id
          join erp.stock_ledger e on e.facility_id = c.facility_id and e.item_id = c.item_id and e.kind <> 'count'
                                  and (e.occurred_at = c.occurred_at
                                       or (cd.moment_stated
                                           and e.occurred_at >= date_trunc('minute', c.occurred_at)
                                           and e.occurred_at < date_trunc('minute', c.occurred_at) + interval '1 minute'))`,
  },
  {
    id: 'purchase-orders-match-their-decisions',
    title: 'every purchase order is what its raise recorded, in the state its latest decision put in force, decided by the rules',
    because:
      'I-8, ADR-0032: an order\'s facts must EQUAL its raise — supplier, number, day, VAT rate and ' +
      'amounts — and its state and stamp its latest decision. Its subtotal is its lines\' amounts, its ' +
      'VAT the rate on the subtotal rounded to the halala, its number its facility\'s code and business ' +
      'day, which is the date it was raised there. Each line orders a pack its supplier supplies. P3: an ' +
      'order approved when raised was within a limit set at its facility, before VAT; every other ' +
      'approval or rejection was by someone other than whoever raised it (PRC-004), of an order then ' +
      'pending. Approved by a limit or a person, an order\'s amounts are a commitment others read, so ' +
      'one that drifted from its record would be a commitment nobody made.',
    sql: `select 'order ' || o.number || ' does not equal its raise' as violation
          from erp.purchase_order o
          join erp.purchase_order_decision r on r.decision_id = o.raised_decision_id
          where (r.kind, r.purchase_order_id, r.facility_id, r.supplier_id, r.number, r.business_date, r.day_seq,
                 r.currency, r.vat_rate_bp, r.subtotal_minor, r.vat_minor, r.total_minor, r.actor_id)
                is distinct from
                ('order_raised', o.purchase_order_id, o.facility_id, o.supplier_id, o.number, o.business_date, o.day_seq,
                 o.currency, o.vat_rate_bp, o.subtotal_minor, o.vat_minor, o.total_minor, o.raised_by)
          union all
          select 'order ' || o.number || ' is not in the state of its latest decision'
          from erp.purchase_order o
          join erp.purchase_order_decision d on d.decision_id = o.as_of_decision_id
          where d.state <> o.state
             or exists (select 1 from erp.purchase_order_decision l
                         where l.purchase_order_id = o.purchase_order_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' is about no order at its facility'
          from erp.purchase_order_decision d
          where not exists (select 1 from erp.purchase_order o
                             where o.purchase_order_id = d.purchase_order_id and o.facility_id = d.facility_id)
          union all
          select 'order ' || o.number || '''s amounts are not its lines'''
          from erp.purchase_order o
          where o.subtotal_minor <> (select coalesce(sum(l.amount_minor), -1) from erp.purchase_order_line l
                                      where l.purchase_order_id = o.purchase_order_id)
             or o.vat_minor <> round(o.subtotal_minor::numeric * o.vat_rate_bp / 10000)
             or o.total_minor <> o.subtotal_minor + o.vat_minor
          union all
          select 'order ' || o.number || ' is not numbered by its facility and day'
          from erp.purchase_order o join erp.facility f on f.facility_id = o.facility_id
          where o.business_date <> (o.raised_at at time zone f.tz_name)::date
             or o.number <> f.code || '-PO-' || to_char(o.business_date, 'YYYYMMDD') || '-'
                             || lpad(o.day_seq::text, greatest(4, length(o.day_seq::text)), '0')
          union all
          select 'order ' || o.number || ' line ' || l.line_no || ' orders a pack its supplier does not supply'
          from erp.purchase_order o
          join erp.purchase_order_line l on l.purchase_order_id = o.purchase_order_id
          join erp.supplier_item si on si.supplier_item_id = l.supplier_item_id
          where si.supplier_id <> o.supplier_id or si.item_unit_id <> l.item_unit_id
          union all
          select 'order ' || o.number || ' was approved when raised without a limit that allowed it'
          from erp.purchase_order o
          join erp.purchase_order_decision r on r.decision_id = o.raised_decision_id
          left join erp.purchase_limit_decision m on m.decision_id = r.limit_decision_id
          where r.state = 'approved'
            and (m.decision_id is null or m.kind <> 'limit_set' or m.facility_id <> o.facility_id
                 or o.subtotal_minor > m.limit_minor)
          union all
          select 'order ' || o.number || ' was ' || d.state || ' by whoever raised it, or when it was not pending'
          from erp.purchase_order o
          join erp.purchase_order_decision d on d.purchase_order_id = o.purchase_order_id
          where d.kind in ('order_approved', 'order_rejected')
            and (d.actor_id = o.raised_by
                 or (select p.state from erp.purchase_order_decision p
                      where p.purchase_order_id = d.purchase_order_id and p.seq < d.seq
                      order by p.seq desc limit 1) is distinct from 'pending')`,
  },
  {
    id: 'purchase-receipts-match-their-orders',
    title: 'every receipt is a stock receipt against an approved order, line for ledger line, and never more than was ordered',
    because:
      'ADR-0032 P4: what an order has received is never stored, it is the sum of its receipts not ' +
      'reversed, so it is only as true as the binding between a receipt and the stock it posted. Keys ' +
      'bind each receipt line to its ledger line and its order line; these are the rules no key can ' +
      'state: every receipt decision has its receipt and every ledger line of one its receipt line, ' +
      'nothing arrives against an order that was not approved, and no order line has received more ' +
      'than it ordered. Asked again after the two-session probes, where two receipts raced one line.',
    sql: `select 'stock decision ' || d.decision_id || ' is a receipt against no order' as violation
          from erp.stock_decision d
          where d.kind = 'receipt' and not exists (select 1 from erp.purchase_receipt r where r.decision_id = d.decision_id)
          union all
          select 'receipt ' || e.decision_id || ' posted line ' || e.line_no || ' against no order line'
          from erp.stock_ledger e
          where e.kind = 'receipt'
            and not exists (select 1 from erp.purchase_receipt_line r where r.decision_id = e.decision_id and r.line_no = e.line_no)
          union all
          select 'receipt ' || r.decision_id || ' is against ' || o.number || ', which is ' || o.state
          from erp.purchase_receipt r join erp.purchase_order o on o.purchase_order_id = r.purchase_order_id
          where o.state not in ('approved', 'closed')
             or exists (select 1 from erp.purchase_order_decision c
                         where c.purchase_order_id = o.purchase_order_id and c.kind = 'order_closed'
                           and c.recorded_at < (select sd.recorded_at from erp.stock_decision sd where sd.decision_id = r.decision_id))
          union all
          select 'order ' || o.number || ' line ' || l.line_no || ' has received more than it ordered'
          from erp.purchase_order o
          join erp.purchase_order_line l on l.purchase_order_id = o.purchase_order_id
          where l.quantity < (select coalesce(sum(r.quantity), 0) from erp.purchase_receipt_line r
                               where r.purchase_order_id = l.purchase_order_id and r.order_line_no = l.line_no
                                 and not exists (select 1 from erp.stock_decision v where v.reverses_decision_id = r.decision_id))`,
  },
  {
    id: 'purchase-limits-match-their-decisions',
    title: 'every approval limit equals the latest decision about it',
    because:
      'I-8, as stock-minimums-match-their-decisions holds it for 0022: an order is approved when raised ' +
      'by reading the projection, not the log (ADR-0032 P3), so a limit that drifted from its decision ' +
      'would approve orders against a figure nobody set.',
    sql: `select 'limit at ' || m.facility_id as violation
          from erp.purchase_limit m
          left join erp.purchase_limit_decision d on d.decision_id = m.as_of_decision_id
          where d.decision_id is null
             or (d.facility_id, d.limit_minor, d.currency) is distinct from (m.facility_id, m.limit_minor, m.currency)
             or exists (select 1 from erp.purchase_limit_decision l where l.facility_id = m.facility_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names no limit'
          from erp.purchase_limit_decision d
          where not exists (select 1 from erp.purchase_limit m where m.facility_id = d.facility_id)`,
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
          from unnest(array['erp.company','erp.facility','erp.orders','erp.event_log',
                             'erp.item','erp.item_unit','erp.item_decision']) as t
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
  {
    id: 'cashier-actors-resolve-to-a-person',
    title: 'every cashier named by the event log is a person',
    because:
      'erp.event_log.actor_id deliberately carries no foreign key: actor_type admits ' +
      'integrations, whose identifiers are not people, the envelope contract declares ' +
      'it nullable, and I-5 forbids an operational write that needs a central lookup. ' +
      'So for the cashier rows, this is the check that stands in for the constraint — ' +
      'the same arrangement as projection-stamp-resolves-to-a-real-event.',
    sql: `select distinct e.actor_id::text as violation
          from erp.event_log e
          where e.actor_type = 'cashier'
            and (e.actor_id is null
                 or not exists (select 1 from erp.person p where p.person_id = e.actor_id))`,
  },
  {
    id: 'item-projections-match-their-decisions',
    title: 'every item and conversion equals the latest decision about it',
    because:
      'I-8 asks that a projection row name the record that produced it. erp.item_decision ' +
      'carries whole states, so 0012 can ask more: that the row EQUALS that record, and that ' +
      'no later decision about the same subject exists. It also stands in for the foreign ' +
      'keys the log deliberately lacks — every decision must name a real item and ' +
      'conversion — as projection-stamp-resolves-to-a-real-event does for the event log.',
    sql: `select 'item ' || i.code as violation
          from erp.item i
          left join erp.item_decision d on d.decision_id = i.as_of_decision_id
          where d.decision_id is null
             or d.kind not in ('item_created', 'item_amended', 'item_status_changed')
             or (d.code, d.item_kind, d.base_unit_key, d.brand_id, d.name_en, d.name_ar,
                 d.description_en, d.description_ar, d.picture_path, d.status)
                is distinct from
                (i.code, i.item_kind, i.base_unit_key, i.brand_id, i.name_en, i.name_ar,
                 i.description_en, i.description_ar, i.picture_path, i.status)
             or exists (select 1 from erp.item_decision l
                         where l.item_id = i.item_id and l.item_unit_id is null and l.seq > d.seq)
          union all
          select 'conversion ' || u.item_unit_id
          from erp.item_unit u
          left join erp.item_decision d on d.decision_id = u.as_of_decision_id
          where d.decision_id is null
             or d.kind not in ('unit_added', 'unit_retired')
             or (d.item_id, d.unit_key, d.factor, d.status) is distinct from (u.item_id, u.unit_key, u.factor, u.status)
             or exists (select 1 from erp.item_decision l
                         where l.item_unit_id = u.item_unit_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names nothing'
          from erp.item_decision d
          where not exists (select 1 from erp.item i where i.item_id = d.item_id)
             or (d.item_unit_id is not null
                 and not exists (select 1 from erp.item_unit u
                                  where u.item_unit_id = d.item_unit_id and u.item_id = d.item_id))`,
  },
  {
    id: 'item-units-are-consistent',
    title: 'every item has one active base conversion at 1, and same-dimension conversions agree',
    because:
      'INV-005: a quantity in any unit must have exactly one meaning in the base unit. The ' +
      'warehouse let an item exist with no ratio and then read it as 1, and let a ratio be ' +
      'edited under the stock it described. 0012 enforces this by trigger and pgTAP 080 ' +
      'tests the trigger; this holds it over the seeded data, so a seed that contradicts ' +
      'INV-005 fails the build even where the trigger is absent. Whether the triggers exist ' +
      'is item-guard-triggers-exist\'s job.',
    sql: `select i.code || ': no single active base conversion at factor 1' as violation
          from erp.item i
          where (select count(*) from erp.item_unit u
                  where u.item_id = i.item_id and u.unit_key = i.base_unit_key
                    and u.status = 'active' and u.factor = 1) <> 1
             or exists (select 1 from erp.item_unit u
                         where u.item_id = i.item_id and u.unit_key = i.base_unit_key
                           and (u.status <> 'active' or u.factor <> 1))
          union all
          select i.code || ': ' || a.unit_key || ' and ' || b.unit_key || ' disagree'
          from erp.item_unit a
          join erp.item_unit b on b.item_id = a.item_id and b.item_unit_id > a.item_unit_id
          join erp.unit ua on ua.unit_key = a.unit_key
          join erp.unit ub on ub.unit_key = b.unit_key
          join erp.item i on i.item_id = a.item_id
          where a.status = 'active' and b.status = 'active'
            and ua.dimension = ub.dimension and ua.dimension <> 'pack'
            and a.factor * ub.per_reference <> b.factor * ua.per_reference`,
  },
  {
    id: 'supplier-projections-match-their-decisions',
    title: 'every supplier and supply equals the latest decision about it, and no decision holds a contact',
    because:
      'I-8, as item-projections-match-their-decisions holds it for 0012: erp.supplier_decision ' +
      'carries whole states, so each supplier\'s business record and each supply must EQUAL ' +
      'its stamp, with no later decision about the same subject, and every decision must name ' +
      'a real supplier and supply. A supply\'s copy of its conversion must match its decision ' +
      'too, since the decision is what a purchase order line will be read against. Contacts ' +
      'are not compared, because they are not decided: SEC-008 keeps them out of the log, and ' +
      'that is checked here as the absence of any contact column on it.',
    sql: `select 'supplier ' || s.code as violation
          from erp.supplier s
          left join erp.supplier_decision d on d.decision_id = s.as_of_decision_id
          where d.decision_id is null
             or d.kind not in ('supplier_created', 'supplier_amended', 'supplier_status_changed', 'supplier_contact_changed')
             or (d.code, d.name_en, d.name_ar, d.vat_number, d.cr_number, d.payment_terms_days, d.status)
                is distinct from
                (s.code, s.name_en, s.name_ar, s.vat_number, s.cr_number, s.payment_terms_days, s.status)
             or exists (select 1 from erp.supplier_decision l
                         where l.supplier_id = s.supplier_id and l.supplier_item_id is null and l.seq > d.seq)
          union all
          select 'supply ' || x.supplier_item_id
          from erp.supplier_item x
          left join erp.supplier_decision d on d.decision_id = x.as_of_decision_id
          where d.decision_id is null
             or d.kind not in ('supply_added', 'supply_amended', 'supply_retired')
             or (d.supplier_id, d.item_unit_id, d.item_id, d.unit_key, d.factor, d.supplier_code, d.preferred, d.status)
                is distinct from
                (x.supplier_id, x.item_unit_id, x.item_id, x.unit_key, x.factor, x.supplier_code, x.preferred, x.status)
             or exists (select 1 from erp.supplier_decision l
                         where l.supplier_item_id = x.supplier_item_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names nothing'
          from erp.supplier_decision d
          where not exists (select 1 from erp.supplier s where s.supplier_id = d.supplier_id)
             or (d.supplier_item_id is not null
                 and not exists (select 1 from erp.supplier_item x
                                  where x.supplier_item_id = d.supplier_item_id and x.supplier_id = d.supplier_id))
          union all
          select 'erp.supplier_decision has a contact column: ' || a.attname
          from pg_attribute a
          where a.attrelid = 'erp.supplier_decision'::regclass and a.attnum > 0 and not a.attisdropped
            and a.attname in ('contact_person', 'phone', 'email', 'address')`,
  },
  {
    id: 'stock-minimums-match-their-decisions',
    title: 'every stock minimum equals the latest decision about it',
    because:
      'I-8, as supplier-projections-match-their-decisions holds it for 0016: each minimum must ' +
      'EQUAL its stamp — the facility, the item and the base quantity, empty once cleared — with ' +
      'no later decision about the same item at the same facility, and every decision must be ' +
      'about a minimum that exists. The bell reads the projection, not the log (ADR-0031), so a ' +
      'minimum that drifted from its decision would ring at a figure nobody set.',
    sql: `select 'minimum of ' || m.item_id || ' at ' || m.facility_id as violation
          from erp.stock_minimum m
          left join erp.stock_minimum_decision d on d.decision_id = m.as_of_decision_id
          where d.decision_id is null
             or (d.facility_id, d.item_id, d.minimum) is distinct from (m.facility_id, m.item_id, m.minimum)
             or exists (select 1 from erp.stock_minimum_decision l
                         where l.facility_id = m.facility_id and l.item_id = m.item_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names no minimum'
          from erp.stock_minimum_decision d
          where not exists (select 1 from erp.stock_minimum m
                             where m.facility_id = d.facility_id and m.item_id = d.item_id)`,
  },
  {
    id: 'transfer-prices-match-their-decisions',
    title: 'every transfer price equals the latest decision about it, and none was backdated',
    because:
      'I-8, as supplier-projections-match-their-decisions holds it for 0016: each price must ' +
      'EQUAL its stamp, with no later decision about it, and every decision must name a real ' +
      'price on the same pack. And the rule a branch order will rely on (I-7): no price was ' +
      'ever set to take effect before the decision that set it, and none was withdrawn once ' +
      'in effect — otherwise "what a carton cost on the 3rd" could change after the 3rd. Nor ' +
      'does any active price repeat the one before it. The routes refuse all three; this holds ' +
      'every row, the seed\'s included, to them.',
    sql: `select 'price ' || p.price_id as violation
          from erp.transfer_price p
          left join erp.transfer_price_decision d on d.decision_id = p.as_of_decision_id
          where d.decision_id is null
             or (d.price_id, d.item_unit_id, d.item_id, d.unit_key, d.factor, d.price_minor, d.currency,
                 d.effective_from, d.status)
                is distinct from
                (p.price_id, p.item_unit_id, p.item_id, p.unit_key, p.factor, p.price_minor, p.currency,
                 p.effective_from, p.status)
             or exists (select 1 from erp.transfer_price_decision l where l.price_id = p.price_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names nothing'
          from erp.transfer_price_decision d
          where not exists (select 1 from erp.transfer_price p
                             where p.price_id = d.price_id and p.item_unit_id = d.item_unit_id)
          union all
          -- The pack, amount, currency and moment are fixed for a price's life, so every
          -- decision about it agrees on them, and its first decision is its one price_set
          -- (found in review: a history claiming another amount passed).
          select 'price ' || d.price_id || ': its decisions disagree on what it is'
          from erp.transfer_price_decision d
          group by d.price_id
          having count(distinct (d.item_unit_id, d.item_id, d.unit_key, d.factor, d.price_minor, d.currency,
                                 d.effective_from)) > 1
          union all
          select 'price ' || f.price_id || ': its first decision is not its one price_set'
          from (select d.price_id,
                       (array_agg(d.kind order by d.seq))[1] as first_kind,
                       count(*) filter (where d.kind = 'price_set') as sets
                from erp.transfer_price_decision d group by d.price_id) f
          where f.first_kind <> 'price_set' or f.sets <> 1
          union all
          select 'decision ' || d.decision_id || ' set a price before it was decided'
          from erp.transfer_price_decision d
          where d.kind = 'price_set' and d.effective_from < d.decided_at
          union all
          select 'decision ' || d.decision_id || ' withdrew a price already in effect'
          from erp.transfer_price_decision d
          where d.kind = 'price_withdrawn' and d.effective_from <= d.decided_at
          union all
          -- A price that changes nothing: the same as the active price before it. Setting
          -- one out of order, or withdrawing the price between two equal ones, made one
          -- (found in review); both routes refuse it now.
          select 'price ' || x.price_id || ' repeats the price before it'
          from (select p.price_id, p.price_minor, p.currency,
                       lag(p.price_minor) over w as prev_minor, lag(p.currency) over w as prev_currency
                from erp.transfer_price p where p.status = 'active'
                window w as (partition by p.item_unit_id order by p.effective_from)) x
          where (x.prev_minor, x.prev_currency) = (x.price_minor, x.currency)`,
  },
  {
    id: 'facilities-match-their-decisions',
    title: 'every facility equals the latest decision about it, and its history agrees with itself',
    because:
      'I-8, as transfer-prices-match-their-decisions holds it for 0018: each facility must EQUAL ' +
      'its stamp, with no later decision about it, and every decision must name a real facility ' +
      'with the same fixed fields — code, type, brand and time zone never change, so no decision ' +
      'about a facility may disagree on them. Its first decision is its one creation or record, ' +
      'and a decision with no actor is a record of a facility that predates the log, never a ' +
      'change somebody made. The routes and triggers hold all of it; this holds every row, the ' +
      'seed\'s and 0019\'s backfill included.',
    sql: `select 'facility ' || f.code as violation
          from erp.facility f
          left join erp.facility_decision d on d.decision_id = f.as_of_decision_id
          where d.decision_id is null
             or (d.facility_id, d.operating_unit_id, d.facility_type, d.code, d.name_en, d.name_ar, d.address_en,
                 d.address_ar, d.tz_name, d.latitude, d.longitude, d.geofence_radius_m, d.status)
                is distinct from
                (f.facility_id, f.operating_unit_id, f.facility_type, f.code, f.name_en, f.name_ar, f.address_en,
                 f.address_ar, f.tz_name, f.latitude, f.longitude, f.geofence_radius_m, f.status)
             or exists (select 1 from erp.facility_decision l where l.facility_id = f.facility_id and l.seq > d.seq)
          union all
          select 'decision ' || d.decision_id || ' names no facility, or disagrees with it on what is fixed'
          from erp.facility_decision d
          where not exists (select 1 from erp.facility f
                             where f.facility_id = d.facility_id and f.operating_unit_id = d.operating_unit_id
                               and f.facility_type = d.facility_type and f.code = d.code and f.tz_name = d.tz_name)
          union all
          select 'facility ' || x.facility_id || ': its first decision is not its one creation or record'
          from (select d.facility_id,
                       (array_agg(d.kind order by d.seq))[1] as first_kind,
                       count(*) filter (where d.kind in ('facility_created', 'facility_recorded')) as births
                from erp.facility_decision d group by d.facility_id) x
          where x.first_kind not in ('facility_created', 'facility_recorded') or x.births <> 1`,
  },
  ...STOCK_ASSERTIONS,
  {
    id: 'projection-stamp-resolves-to-a-real-event',
    title: 'every as_of_event_id names an event that exists',
    because:
      'NOT NULL only forces a value; it cannot force a TRUE one. erp.event_log is ' +
      'partitioned on business_date, so its primary key is composite and a ' +
      'single-column foreign key from the projections is not available (migration ' +
      '0009 says so in full). This assertion is what stands in its place — without ' +
      'it, I-8 guarantees a stamp rather than a verifiable one.',
    sql: `select t || ' ' || id::text as violation
          from (
            select 'orders'             as t, order_id::text            as id, as_of_event_id from erp.orders
            union all
            select 'payment_intents',       payment_intent_id::text,        as_of_event_id from erp.payment_intents
            union all
            select 'shifts',                shift_id::text,                 as_of_event_id from erp.shifts
            union all
            select 'drawer_assignments',    drawer_assignment_id::text,     as_of_event_id from erp.drawer_assignments
          ) stamped
          where not exists (
            select 1 from erp.event_log e where e.event_id = stamped.as_of_event_id
          )`,
  },
];
