-- 0017 · An import sent again is a retry; an import that collides with itself is not
--
-- Requirements: INV-002 · INV-005 · PRC-005 · IAM-008
-- ADR-0024 · ADR-0026 §6 and its addendum · migrations 0012 and 0016
--
-- Two corrections to the two imports, erp.import_items() (0012) and
-- erp.import_suppliers() (0016). Both are applied and never edited; each is replaced here
-- in place, which keeps its owner and grants. Each body is its original, with the changes
-- below and nothing else.
--
-- 1. AN ITEMS FILE SENT AGAIN WHILE THE FIRST IS STILL RUNNING IS A RETRY. 0012 caught
--    every error inside a row as a failed line. The second sending waits on each row's
--    decision lock, then finds the decision recorded: erp.assert_item_decision_is_new()
--    raises 23505 on item_decision_pkey, the import caught it, and the whole file was
--    refused "nothing was saved", though the first sending had just saved all of it.
--    0016's import re-raises that answer instead, and ADR-0026 §6 recorded the gap here.
--    The items import now does the same.
--
-- 2. ONLY ANOTHER CALL'S DECISION IS A RETRY (found in review of the above). Re-raising
--    every 23505 on the log's key answered three things as "already recorded" that
--    saved nothing:
--      * one decision id on two rows of one file: the second row's retry check found
--        the first row's decision, recorded moments earlier by this same call;
--      * one decision id for two decisions of one row (a supplier's contact decision, an
--        item's base unit decision);
--      * an item's base-unit decision id already in the log, which erp.create_item()
--        does not check itself, so PostgreSQL raised the collision and the import
--        re-raised it whole, losing every other line's error.
--    So each import now refuses a decision id used twice in its file as a line error,
--    before any route runs, and re-raises only the retry check's own answer, read from
--    the error's context. The same constraint raised by PostgreSQL itself is a line
--    error again, as in 0012.
--
-- db:check's overlapping-retry probe runs two real sessions through both imports, and
-- requires the answer to have been raised by a route. pgTAP 120 holds the three cases.

create or replace function erp.import_items(
  p_actor_id   uuid,
  p_reason     text,
  p_decided_at timestamptz,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r           record;
  v_line      text;
  v_code      text;
  v_item      erp.item;
  v_seen      jsonb  := '{}'::jsonb;
  v_errors    text[] := '{}';
  v_created   integer := 0;
  v_amended   integer := 0;
  v_unchanged integer := 0;
  v_ids       jsonb  := '{}'::jsonb;
  v_id        text;
  v_constraint text;
  v_context   text;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'an import holds 1 to 5000 rows'
      using errcode = 'invalid_parameter_value', constraint = 'item_import_shape';
  end if;

  for r in select e.value as row, e.ordinality as ord
             from jsonb_array_elements(p_rows) with ordinality as e
            order by e.ordinality
  loop
    v_line := coalesce(r.row ->> 'line', r.ord::text);
    begin
      if jsonb_typeof(r.row) <> 'object' then
        raise exception 'a row is an object';
      end if;
      v_code := erp.normalise_item_code(r.row ->> 'code');
      if v_code is not null and v_seen ? v_code then
        raise exception 'code % appears twice in the file (lines % and %)', v_code, v_seen ->> v_code, v_line;
      end if;
      if v_code is not null then
        v_seen := v_seen || jsonb_build_object(v_code, v_line);
      end if;
      -- Every decision id once in the file. The same id on two rows, or on two decisions
      -- of one row, would otherwise reach item_decision's retry check from this very call and be
      -- answered as a retry, though nothing was saved (found in review).
      foreach v_id in array array[r.row ->> 'decision_id', r.row ->> 'base_unit_decision_id'] loop
        -- Compared as ids, not as spellings: capitals, braces and missing hyphens all
        -- cast to the same uuid (found by Codex on PR #35). One that does not cast is
        -- a line error here, as it would be when the route casts it.
        v_id := nullif(btrim(v_id), '')::uuid::text;
        if v_id is not null and v_ids ? v_id then
          raise exception 'decision id % is used twice in the file (lines % and %)', v_id, v_ids ->> v_id, v_line;
        end if;
        if v_id is not null then
          v_ids := v_ids || jsonb_build_object(v_id, v_line);
        end if;
      end loop;

      select * into v_item from erp.item i where i.code = v_code;
      if found then
        if v_item.item_kind is distinct from (r.row ->> 'item_kind')
           or v_item.base_unit_key is distinct from (r.row ->> 'base_unit_key')
           or v_item.brand_id is distinct from (r.row ->> 'brand_id')::uuid then
          raise exception 'item % is a % in brand % with base unit %: kind, base unit and brand are fixed (INV-002, INV-005)',
            v_item.code, v_item.item_kind,
            (select b.code from erp.brand b where b.brand_id = v_item.brand_id), v_item.base_unit_key;
        end if;
        if (erp.normalise_label(r.row ->> 'name_en'), erp.normalise_label(r.row ->> 'name_ar'),
            nullif(btrim(r.row ->> 'description_en'), ''), nullif(btrim(r.row ->> 'description_ar'), ''))
           is distinct from (v_item.name_en, v_item.name_ar, v_item.description_en, v_item.description_ar) then
          -- A retired item fails here as a line error: an import never reinstates.
          perform erp.amend_item(
            (r.row ->> 'decision_id')::uuid, v_item.item_id, v_item.as_of_decision_id,
            r.row ->> 'name_en', r.row ->> 'name_ar', r.row ->> 'description_en', r.row ->> 'description_ar',
            v_item.picture_path, p_reason, p_actor_id, p_decided_at);
          v_amended := v_amended + 1;
        else
          v_unchanged := v_unchanged + 1;
        end if;
      else
        perform erp.create_item(
          (r.row ->> 'decision_id')::uuid, (r.row ->> 'item_id')::uuid,
          (r.row ->> 'base_unit_decision_id')::uuid, (r.row ->> 'base_item_unit_id')::uuid,
          (r.row ->> 'brand_id')::uuid, r.row ->> 'code', r.row ->> 'item_kind', r.row ->> 'base_unit_key',
          r.row ->> 'name_en', r.row ->> 'name_ar', r.row ->> 'description_en', r.row ->> 'description_ar',
          null, p_reason, p_actor_id, p_decided_at);
        v_created := v_created + 1;
      end if;
    exception
      -- A decision id already recorded by ANOTHER call is the file sent again: re-raised
      -- whole, so the edge reads it as a retry rather than as "nothing was saved" when the
      -- first sending saved everything. Only assert_item_decision_is_new's own answer is one: the
      -- same constraint raised by PostgreSQL itself is a collision, kept as a line error.
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name, v_context = pg_exception_context;
        if v_constraint = 'item_decision_pkey'
           and v_context like '%function erp.assert_item_decision_is_new(uuid) line % at RAISE%' then
          raise;
        end if;
        v_errors := v_errors || ('line ' || v_line || ': ' || sqlerrm);
      when others then
        v_errors := v_errors || ('line ' || v_line || ': ' || sqlerrm);
    end;
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception 'item import refused: % line(s) failed and nothing was saved', cardinality(v_errors)
      using errcode = 'invalid_parameter_value', constraint = 'item_import_refused',
            detail = array_to_string(v_errors[1:20], E'\n');
  end if;

  return jsonb_build_object('created', v_created, 'amended', v_amended, 'unchanged', v_unchanged);
end;
$$;

create or replace function erp.import_suppliers(
  p_actor_id   uuid,
  p_reason     text,
  p_decided_at timestamptz,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r           record;
  v_line      text;
  v_code      text;
  v_supplier  erp.supplier;
  v_terms     integer;
  v_changed   boolean;
  v_seen      jsonb  := '{}'::jsonb;
  v_errors    text[] := '{}';
  v_created   integer := 0;
  v_amended   integer := 0;
  v_unchanged integer := 0;
  v_constraint text;
  v_context   text;
  v_ids       jsonb  := '{}'::jsonb;
  v_id        text;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'an import holds 1 to 5000 rows'
      using errcode = 'invalid_parameter_value', constraint = 'supplier_import_shape';
  end if;

  for r in select e.value as row, e.ordinality as ord
             from jsonb_array_elements(p_rows) with ordinality as e
            order by e.ordinality
  loop
    v_line := coalesce(r.row ->> 'line', r.ord::text);
    begin
      if jsonb_typeof(r.row) <> 'object' then
        raise exception 'a row is an object';
      end if;
      v_code := erp.normalise_item_code(r.row ->> 'code');
      if v_code is not null and v_seen ? v_code then
        raise exception 'code % appears twice in the file (lines % and %)', v_code, v_seen ->> v_code, v_line;
      end if;
      if v_code is not null then
        v_seen := v_seen || jsonb_build_object(v_code, v_line);
      end if;
      -- Every decision id once in the file. The same id on two rows, or on two decisions
      -- of one row, would otherwise reach supplier_decision's retry check from this very call and be
      -- answered as a retry, though nothing was saved (found in review).
      foreach v_id in array array[r.row ->> 'decision_id', r.row ->> 'contact_decision_id'] loop
        -- Compared as ids, not as spellings: capitals, braces and missing hyphens all
        -- cast to the same uuid (found by Codex on PR #35). One that does not cast is
        -- a line error here, as it would be when the route casts it.
        v_id := nullif(btrim(v_id), '')::uuid::text;
        if v_id is not null and v_ids ? v_id then
          raise exception 'decision id % is used twice in the file (lines % and %)', v_id, v_ids ->> v_id, v_line;
        end if;
        if v_id is not null then
          v_ids := v_ids || jsonb_build_object(v_id, v_line);
        end if;
      end loop;
      -- A blank or non-numeric cell is an error on its line, not a silent 30.
      v_terms := erp.normalise_digits(r.row ->> 'payment_terms_days')::integer;

      select * into v_supplier from erp.supplier s where s.code = v_code;
      if found then
        v_changed := false;
        if (erp.normalise_label(r.row ->> 'name_en'), erp.normalise_label(r.row ->> 'name_ar'),
            erp.normalise_digits(r.row ->> 'vat_number'), erp.normalise_digits(r.row ->> 'cr_number'), v_terms)
           is distinct from
           (v_supplier.name_en, v_supplier.name_ar, v_supplier.vat_number, v_supplier.cr_number, v_supplier.payment_terms_days) then
          -- A retired supplier fails here as a line error: an import never reinstates.
          perform erp.amend_supplier(
            (r.row ->> 'decision_id')::uuid, v_supplier.supplier_id, v_supplier.as_of_decision_id,
            r.row ->> 'name_en', r.row ->> 'name_ar', r.row ->> 'vat_number', r.row ->> 'cr_number', v_terms,
            p_reason, p_actor_id, p_decided_at);
          v_changed := true;
          select * into v_supplier from erp.supplier s where s.supplier_id = v_supplier.supplier_id;
        end if;
        if (erp.normalise_label(r.row ->> 'contact_person'), erp.normalise_digits(r.row ->> 'phone'),
            nullif(lower(btrim(r.row ->> 'email')), ''), nullif(btrim(r.row ->> 'address'), ''))
           is distinct from
           (v_supplier.contact_person, v_supplier.phone, v_supplier.email, v_supplier.address) then
          perform erp.set_supplier_contact(
            (r.row ->> 'contact_decision_id')::uuid, v_supplier.supplier_id, v_supplier.as_of_decision_id,
            r.row ->> 'contact_person', r.row ->> 'phone', r.row ->> 'email', r.row ->> 'address',
            p_actor_id, p_decided_at);
          v_changed := true;
        end if;
        if v_changed then v_amended := v_amended + 1; else v_unchanged := v_unchanged + 1; end if;
      else
        perform erp.create_supplier(
          (r.row ->> 'decision_id')::uuid, (r.row ->> 'supplier_id')::uuid, r.row ->> 'code',
          r.row ->> 'name_en', r.row ->> 'name_ar', r.row ->> 'vat_number', r.row ->> 'cr_number', v_terms,
          p_reason, p_actor_id, p_decided_at);
        if num_nonnulls(nullif(btrim(r.row ->> 'contact_person'), ''), nullif(btrim(r.row ->> 'phone'), ''),
                        nullif(btrim(r.row ->> 'email'), ''), nullif(btrim(r.row ->> 'address'), '')) > 0 then
          perform erp.set_supplier_contact(
            (r.row ->> 'contact_decision_id')::uuid, (r.row ->> 'supplier_id')::uuid, (r.row ->> 'decision_id')::uuid,
            r.row ->> 'contact_person', r.row ->> 'phone', r.row ->> 'email', r.row ->> 'address',
            p_actor_id, p_decided_at);
        end if;
        v_created := v_created + 1;
      end if;
    exception
      -- A decision id already recorded by ANOTHER call is the file sent again: re-raised
      -- whole, so the edge reads it as a retry rather than as "nothing was saved" when the
      -- first sending saved everything. Only assert_supplier_decision_is_new's own answer is one: the
      -- same constraint raised by PostgreSQL itself is a collision, kept as a line error.
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name, v_context = pg_exception_context;
        if v_constraint = 'supplier_decision_pkey'
           and v_context like '%function erp.assert_supplier_decision_is_new(uuid) line % at RAISE%' then
          raise;
        end if;
        v_errors := v_errors || ('line ' || v_line || ': ' || sqlerrm);
      when others then
        v_errors := v_errors || ('line ' || v_line || ': ' || sqlerrm);
    end;
  end loop;

  if cardinality(v_errors) > 0 then
    raise exception 'supplier import refused: % line(s) failed and nothing was saved', cardinality(v_errors)
      using errcode = 'invalid_parameter_value', constraint = 'supplier_import_refused',
            detail = array_to_string(v_errors[1:20], E'\n');
  end if;

  return jsonb_build_object('created', v_created, 'amended', v_amended, 'unchanged', v_unchanged);
end;
$$;

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE. CREATE
-- OR REPLACE keeps each function's ACL, so this changes nothing today; it is here so the
-- rule has no exceptions to remember.
revoke execute on all functions in schema erp from public;
