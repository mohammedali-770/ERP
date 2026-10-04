-- 0017 · An items import sent again while the first is still running is a retry
--
-- Requirements: INV-002 · INV-005 · IAM-008
-- ADR-0024 · ADR-0026 §6 · supabase/migrations/20261002000200_items_and_units.sql
--
-- erp.import_items() (0012) caught every error inside a row and reported it as a failed
-- line. A file sent again while its first sending was still running waits on each row's
-- decision lock, then finds the decision recorded: erp.assert_item_decision_is_new()
-- raises 23505 on item_decision_pkey, the import caught it, and the whole file was
-- refused "nothing was saved", though the first sending had just saved all of it. The
-- console then told the administrator to try again.
--
-- 0016's erp.import_suppliers() re-raises that one answer instead (found in its review),
-- and ADR-0026 §6 recorded the same gap here for module 1's next change. This is that
-- change: the same function, the same body, with 0016's handler. 0012 is applied and is
-- never edited; this replaces the function in place, which keeps its owner and grants.
--
-- db:check's retry probe now runs two real sessions through this import too.

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
  v_constraint text;
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
      -- A decision id already recorded is the file sent again: re-raised as the routes
      -- raise it, so the edge reads it as a retry rather than as "nothing was saved"
      -- when the first sending saved everything. RAISE without arguments rethrows the
      -- error whole, so one PostgreSQL raised itself stays its own, and the edge still
      -- answers it as a conflict.
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'item_decision_pkey' then
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

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE. CREATE
-- OR REPLACE keeps the function's ACL, so this changes nothing today; it is here so the
-- rule has no exceptions to remember.
revoke execute on all functions in schema erp from public;
