-- 0012 · Items and units — one master for every kind, and conversions that cannot be read two ways
--
-- Requirements: INV-002 · INV-005 · PRG-014 · MFG-012 · CAP-P02 · CAP-P04 · CAP-P06
--               IAM-003 · IAM-006 · IAM-008
-- ADR-0012 · ADR-0021 · ADR-0023 · ADR-0024 (proposed) · invariants I-6, I-7, I-8
--
-- Phase 4, module 1. The warehouse system kept three masters — items, raw_materials and
-- warehouse_units — and let each drift: an item's category and serial could be edited
-- after lots and orders named them, units were free text, a pack ratio was a
-- numeric(10,2) anyone could change at any time, and a missing ratio was silently 1.
-- The owner decided on 2026-10-02 that the ERP has ONE item master with a kind
-- (INV-002). This migration is that master, written fresh from the warehouse's design
-- through the process mapping MFG-012 requires, not copied.
--
-- FOUR TABLES. A closed register of units (erp.unit); an append-only decision log
-- (erp.item_decision) whose rows carry the WHOLE state they put in force; and two
-- projections stamped with it (erp.item, erp.item_unit).
--
-- WHAT IS FIXED. An item's code, kind, base unit and brand are fixed from creation, by a
-- trigger that binds the owner too. A conversion's item, unit and factor are fixed once
-- recorded; a pack-size change retires one row and adds another, so a document line that
-- used x12 goes on meaning x12 (I-7). Nothing here is ever deleted.
--
-- THE STAR. Every conversion goes straight to the item's base (storage) unit, and every
-- active conversion of the same physical dimension on one item must agree with the
-- others. So a quantity stated in any unit has exactly one meaning in the base unit —
-- INV-005's "prevent ambiguous conversions" by structure.
--
-- THE SEAM. Every later quantity-bearing row copies (item_unit_id, item_id, unit_key,
-- factor) and references erp.item_unit through that four-column unique key, so its unit
-- and factor are provably the conversion's, and the conversion provably its own item's.
--
-- READS ARE GATED TOO. erp_app holds no privilege at all on the three item tables. It
-- writes through six admitted routes and reads through three gated functions, each of
-- which asks erp.assert_permitted() first. That is a step past 0011, where the runtime
-- may read erp.person, and it is needed so that a HIDDEN capability hides the data and
-- not only the menu (CAP-P02), and so that facility and brand scope are enforced in the
-- database (IAM-006, ADR-0012).
--
-- The module ships HIDDEN: the capability is registered here, and no decision is
-- recorded for it, so CAP-P02's default-deny holds in every real database until a later
-- migration promotes it after its data layer, screens and staff acceptance testing exist.

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

-- ---------------------------------------------------------------------------
-- The unit register (INV-005) — a controlled vocabulary, changed by migration only
-- ---------------------------------------------------------------------------

create table erp.unit (
  unit_key      text        primary key
    constraint unit_key_is_canonical check (unit_key ~ '^[a-z][a-z0-9_]{0,23}$'),
  dimension     text        not null
    constraint unit_dimension_is_known check (dimension in ('mass', 'volume', 'count', 'pack')),
  -- How many of the dimension's reference unit (g, ml, piece) one of this unit is.
  -- Powers of ten in practice, so every same-dimension conversion terminates. NULL for a
  -- pack: what a carton holds is a fact about an item, never about cartons.
  per_reference numeric
    constraint unit_per_reference_is_exact check (per_reference > 0 and per_reference = round(per_reference, 6)),
  name_en       text        not null
    constraint unit_name_en_is_present check (name_en = btrim(name_en) and length(name_en) between 1 and 40),
  name_ar       text        not null constraint unit_name_ar_key unique
    constraint unit_name_ar_is_present check (name_ar = btrim(name_ar) and length(name_ar) between 1 and 40),
  symbol_en     text        not null
    constraint unit_symbol_en_is_present check (symbol_en = btrim(symbol_en) and length(symbol_en) between 1 and 12),
  symbol_ar     text        not null
    constraint unit_symbol_ar_is_present check (symbol_ar = btrim(symbol_ar) and length(symbol_ar) between 1 and 12),
  created_at    timestamptz not null default now(),
  constraint unit_pack_has_no_size check ((dimension = 'pack') = (per_reference is null))
);

comment on table erp.unit is
  'The register of units of measure (INV-005). Changed by migration only, like erp.role and erp.capability: a synonym is an ambiguity. A unit''s key, dimension and size never change.';

create unique index ux_unit_name_en on erp.unit (lower(name_en));
create unique index ux_unit_one_reference_per_dimension on erp.unit (dimension) where per_reference = 1;

create or replace function erp.unit_meaning_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'unit % means what it meant: its key, dimension and size never change (INV-005)', old.unit_key
    using errcode = 'restrict_violation', constraint = 'unit_meaning_fixed',
          hint = 'Register a new unit. Every quantity recorded in this one keeps its meaning.';
end;
$$;

-- The WHEN clause lets 0090's created_at freeze through; names and symbols stay
-- correctable by migration.
create trigger unit_meaning_fixed
  before update on erp.unit
  for each row
  when (old.unit_key is distinct from new.unit_key
        or old.dimension is distinct from new.dimension
        or old.per_reference is distinct from new.per_reference)
  execute function erp.unit_meaning_is_fixed();

-- Structural rows: a real database needs units before its first item, as it needs the
-- administrator role (0011). Literal time, so two builds are identical (LAB-005).
-- Every Arabic name is a draft awaiting a native speaker's review (PRG-014).
insert into erp.unit (unit_key, dimension, per_reference, name_en, name_ar, symbol_en, symbol_ar, created_at) values
  ('g',        'mass',   1,    'Gram',       'غرام',        'g',    'غ',          timestamptz '2026-10-02 00:00:00+00'),
  ('kg',       'mass',   1000, 'Kilogram',   'كيلوغرام',    'kg',   'كغ',         timestamptz '2026-10-02 00:00:00+00'),
  ('ml',       'volume', 1,    'Millilitre', 'مليلتر',      'ml',   'مل',         timestamptz '2026-10-02 00:00:00+00'),
  ('l',        'volume', 1000, 'Litre',      'لتر',         'L',    'ل',          timestamptz '2026-10-02 00:00:00+00'),
  ('piece',    'count',  1,    'Piece',      'حبة',         'pc',   'حبة',        timestamptz '2026-10-02 00:00:00+00'),
  ('carton',   'pack',   null, 'Carton',     'كرتون',       'ctn',  'كرتون',      timestamptz '2026-10-02 00:00:00+00'),
  ('box',      'pack',   null, 'Box',        'علبة',        'box',  'علبة',       timestamptz '2026-10-02 00:00:00+00'),
  ('case',     'pack',   null, 'Case',       'صندوق',       'case', 'صندوق',      timestamptz '2026-10-02 00:00:00+00'),
  ('pack',     'pack',   null, 'Pack',       'باكيت',       'pk',   'باكيت',      timestamptz '2026-10-02 00:00:00+00'),
  ('bag',      'pack',   null, 'Bag',        'كيس',         'bag',  'كيس',        timestamptz '2026-10-02 00:00:00+00'),
  ('sack',     'pack',   null, 'Sack',       'شوال',        'sack', 'شوال',       timestamptz '2026-10-02 00:00:00+00'),
  ('bottle',   'pack',   null, 'Bottle',     'قارورة',      'btl',  'قارورة',     timestamptz '2026-10-02 00:00:00+00'),
  ('can',      'pack',   null, 'Can',        'علبة معدنية', 'can',  'علبة معدنية', timestamptz '2026-10-02 00:00:00+00'),
  ('jar',      'pack',   null, 'Jar',        'مرطبان',      'jar',  'مرطبان',     timestamptz '2026-10-02 00:00:00+00'),
  ('tub',      'pack',   null, 'Tub',        'وعاء',        'tub',  'وعاء',       timestamptz '2026-10-02 00:00:00+00'),
  ('bucket',   'pack',   null, 'Bucket',     'سطل',         'bkt',  'سطل',        timestamptz '2026-10-02 00:00:00+00'),
  ('jerrycan', 'pack',   null, 'Jerrycan',   'جالون',       'jcn',  'جالون',      timestamptz '2026-10-02 00:00:00+00'),
  ('tray',     'pack',   null, 'Tray',       'صينية',       'tray', 'صينية',      timestamptz '2026-10-02 00:00:00+00'),
  ('roll',     'pack',   null, 'Roll',       'لفة',         'roll', 'لفة',        timestamptz '2026-10-02 00:00:00+00');

-- ---------------------------------------------------------------------------
-- The decision log (IAM-008, I-8) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.item_decision (
  decision_id    uuid        primary key,
  -- A total order. decided_at is the caller's clock and the seed's literal times tie;
  -- "the latest decision about X" needs one order, and so do db-check's equality checks.
  seq            bigint      generated always as identity constraint item_decision_seq_key unique,
  kind           text        not null
    constraint item_decision_kind_is_known
      check (kind in ('item_created', 'item_amended', 'item_status_changed', 'unit_added', 'unit_retired')),
  -- NO foreign key, deliberately, as erp.identity_decision.subject_person_id has none:
  -- the decision is written before the row it creates, and the projections' stamps point
  -- the other way. db-check's item-projections-match-their-decisions proves every
  -- decision names a real item and conversion.
  item_id        uuid        not null,
  -- Set for unit_* kinds: the conversion decided about.
  item_unit_id   uuid,
  -- item_* kinds: the item AS THIS DECISION LEFT IT. Whole state, not a delta, so a
  -- projection row is checkable by equality and "from what, to what" is two adjacent
  -- rows. Items hold no personal data, so unlike erp.identity_decision this log can.
  code           text,
  item_kind      text,
  base_unit_key  text        constraint item_decision_base_unit_is_registered references erp.unit (unit_key),
  brand_id       uuid        constraint item_decision_brand_exists references erp.brand (brand_id),
  name_en        text,
  name_ar        text,
  description_en text,
  description_ar text,
  picture_path   text,
  -- unit_* kinds: the conversion as this decision left it.
  unit_key       text        constraint item_decision_unit_is_registered references erp.unit (unit_key),
  factor         numeric     constraint item_decision_factor_is_positive check (factor > 0),
  -- The item's status for item_* kinds, the conversion's for unit_* kinds.
  status         text        not null constraint item_decision_status_is_known check (status in ('active', 'retired')),
  reason         text        not null constraint item_decision_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded. No actor_type: the actor is a person, and
  -- erp.person.person_type already says which kind.
  actor_id       uuid        not null constraint item_decision_actor_is_a_person
                               references erp.person (person_id) on delete no action,
  decided_at     timestamptz not null,
  recorded_at    timestamptz not null default now(),
  -- Targets for the projections' composite stamps: a stamp names a decision about ITS
  -- subject, never another item's.
  constraint item_decision_about_item unique (decision_id, item_id),
  constraint item_decision_about_unit unique (decision_id, item_unit_id),
  constraint item_decision_shape check (
    case
      when kind in ('item_created', 'item_amended', 'item_status_changed') then
            item_unit_id is null and unit_key is null and factor is null
        and code is not null and item_kind is not null and base_unit_key is not null and brand_id is not null
        and name_en is not null and name_ar is not null
        and (kind <> 'item_created' or status = 'active')
      when kind in ('unit_added', 'unit_retired') then
            item_unit_id is not null and unit_key is not null and factor is not null
        and code is null and item_kind is null and base_unit_key is null and brand_id is null
        and name_en is null and name_ar is null and description_en is null and description_ar is null
        and picture_path is null
        and ((kind = 'unit_added') = (status = 'active'))
      else false
    end
  )
);

comment on table erp.item_decision is
  'Append-only record of every item and conversion decision (INV-002, INV-005, IAM-008, I-8). Each row carries the whole state it put in force. Central decisions: erp.event_log is the branch runtime''s log and is not used (0010''s header).';
comment on column erp.item_decision.item_id is
  'No foreign key: the log is written before the row it creates, as erp.identity_decision.subject_person_id. Checked by db-check.';

create index ix_item_decision_item on erp.item_decision (item_id, seq);
create index ix_item_decision_unit on erp.item_decision (item_unit_id, seq) where item_unit_id is not null;

-- Append-only, enforced twice as 0004, 0010 and 0011 do. erp_app holds NO privilege on
-- it (0011's reasoning: a decision appended without its projection is a decision never
-- in force). TRUNCATE is covered as well, because TRUNCATE … CASCADE would reach the log
-- through the projections' stamps, and a statement trigger on UPDATE and DELETE does not
-- fire for it.
create or replace function erp.item_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'item_decision is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. What an item was, and who changed it, is not unmade by deleting the record of it.';
end;
$$;

create trigger item_decision_append_only
  before update or delete or truncate on erp.item_decision
  for each statement
  execute function erp.item_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- The item master (INV-002) — one table for every kind
-- ---------------------------------------------------------------------------

create table erp.item (
  -- UUIDv7, minted by the console (I-1, ADR-0005).
  item_id           uuid        primary key,
  -- One code, one item, for good: unique across retired items too, because lot codes
  -- (<code>-YYMMDD, MFG-008) and every printed document go on naming it. Stored canonical.
  code              text        not null
    constraint item_code_key unique
    constraint item_code_is_canonical check (code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'),
  -- INV-002: what the item IS. Fixed once created.
  item_kind         text        not null
    constraint item_kind_is_known check (item_kind in ('raw_ingredient', 'semi_finished', 'finished_product',
      'packaging', 'cleaning_supply', 'operating_supply', 'equipment', 'spare_part')),
  -- INV-005: the storage unit. Every stock quantity of this item is in it. Fixed once created.
  base_unit_key     text        not null constraint item_base_unit_is_registered references erp.unit (unit_key),
  -- ADR-0012 / PRG-004: the owning brand. Legal entity and company are reached through it,
  -- as erp.facility reaches them through its operating unit, so no copy of either needs a
  -- consistency guard of its own. Fixed once created.
  brand_id          uuid        not null constraint item_brand_exists references erp.brand (brand_id),
  name_en           text        not null,
  name_ar           text        not null,
  description_en    text,
  description_ar    text,
  -- Object path in the PRIVATE erp-menu-media bucket (0007), served by signed URL from
  -- the edge (ADR-0023). Never a public bucket.
  picture_path      text,
  status            text        not null constraint item_status_is_known check (status in ('active', 'retired')),
  -- I-8. The single-column foreign key is what db-check's
  -- projection-stamp-is-a-foreign-key-where-it-can-be finds; the composite one makes it
  -- impossible to stamp this item with ANOTHER item's decision.
  as_of_decision_id uuid        not null constraint item_as_of_decision_id_fkey references erp.item_decision (decision_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint item_stamp_is_this_items_decision foreign key (as_of_decision_id, item_id)
    references erp.item_decision (decision_id, item_id),
  constraint item_names_are_canonical check (
        name_en = btrim(regexp_replace(name_en, '[[:space:]]+', ' ', 'g')) and length(name_en) between 1 and 120
    and name_ar = btrim(regexp_replace(name_ar, '[[:space:]]+', ' ', 'g')) and length(name_ar) between 1 and 120),
  constraint item_description_is_bilingual check ((description_en is null) = (description_ar is null)),
  constraint item_descriptions_are_canonical check (
        (description_en is null or (description_en = btrim(description_en) and length(description_en) between 1 and 1000))
    and (description_ar is null or (description_ar = btrim(description_ar) and length(description_ar) between 1 and 1000))),
  constraint item_picture_path_is_its_own check (picture_path is null or picture_path ~
    ('^items/' || item_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|webp)$'))
);

comment on table erp.item is
  'The one item master (INV-002, owner decision 2026-10-02): every kind, replacing the warehouse''s items, raw_materials and the definitional half of warehouse_units. A projection of erp.item_decision that equals its stamp. Retired, never deleted. Holds no stock, minimum, cost, price, supplier, display order or ordering flag: later modules reference this table, never the reverse.';

-- Active names are unique per brand in both languages. A retired item frees its name,
-- which is how a mistaken item is replaced — so these are partial, and the seed loads
-- only because they are.
create unique index ux_item_active_name_en on erp.item (brand_id, lower(name_en)) where status = 'active';
create unique index ux_item_active_name_ar on erp.item (brand_id, name_ar)        where status = 'active';
create index ix_item_brand_kind on erp.item (brand_id, item_kind, status);

-- ---------------------------------------------------------------------------
-- Conversions (INV-005, I-7) — immutable rows, a star around the base unit
-- ---------------------------------------------------------------------------

create table erp.item_unit (
  -- Minted by the console (I-1).
  item_unit_id      uuid        primary key,
  item_id           uuid        not null constraint item_unit_item_exists references erp.item (item_id),
  unit_key          text        not null constraint item_unit_is_registered references erp.unit (unit_key),
  -- 1 unit_key = factor x the item's base unit — the warehouse's own direction, "1
  -- purchase unit = N sale units". Exact: an unconstrained numeric plus an equality check,
  -- so a seventh decimal place is REFUSED where numeric(p,s) would round it silently.
  -- Stored trim_scale()d. Fixed once recorded (I-7).
  factor            numeric     not null
    constraint item_unit_factor_is_exact check (factor > 0 and factor <= 1000000000 and factor = round(factor, 6)),
  status            text        not null constraint item_unit_status_is_known check (status in ('active', 'retired')),
  as_of_decision_id uuid        not null constraint item_unit_as_of_decision_id_fkey references erp.item_decision (decision_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint item_unit_stamp_is_this_conversions_decision foreign key (as_of_decision_id, item_unit_id)
    references erp.item_decision (decision_id, item_unit_id),
  -- THE I-7 SEAM. Every quantity-bearing row in a later module copies these four values
  -- and references them together, so its unit and factor are provably the conversion's,
  -- and the conversion provably its own item's.
  constraint item_unit_seam unique (item_unit_id, item_id, unit_key, factor)
);

comment on table erp.item_unit is
  'Every unit an item is counted, bought, issued or used in, each converting DIRECTLY to the item''s base unit (INV-005). The base unit is a row at factor 1, written with the item. Rows are immutable; a pack-size change retires one and adds another, so a line that used x12 goes on meaning x12 (I-7). Retired, never deleted.';

-- A unit word means one thing per item at a time.
create unique index ux_item_unit_one_active on erp.item_unit (item_id, unit_key) where status = 'active';
create index ix_item_unit_item on erp.item_unit (item_id);

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- Trims, upper-cases, and folds Arabic-Indic and Persian digits typed on an Arabic
-- keyboard. 'W001', ' w001 ' and 'W٠٠١' are one code. It does not validate: callers check
-- the result, and item_code_is_canonical holds the same rule as a constraint. The
-- warehouse's case-sensitive, untrimmed serial let 'W001' and 'w001' coexist while its
-- import matched lower(trim()) and picked one.
create or replace function erp.normalise_item_code(p_code text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(upper(btrim(translate(p_code, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))), '');
$$;

-- Collapses runs of whitespace, trims, and returns NULL for blank. item_names_are_canonical
-- holds the same rule as a constraint, so no writer can bypass it.
create or replace function erp.normalise_label(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(btrim(regexp_replace(p_text, '[[:space:]]+', ' ', 'g')), '');
$$;

-- The factor a non-pack unit must have on this item, derived from any active conversion
-- of the same physical dimension (the base row, or a cross-dimension anchor). NULL for a
-- pack, or when no active row shares the dimension. Not rounded: a non-terminating
-- result reaches the caller to be refused. Any matching row gives the same answer,
-- because erp.item_unit_is_fixed() keeps them in agreement.
create or replace function erp.item_unit_derived_factor(p_item_id uuid, p_unit_key text)
returns numeric
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select a.factor * u.per_reference / au.per_reference
  from erp.unit u
  join erp.item_unit a on a.item_id = p_item_id and a.status = 'active'
  join erp.unit au on au.unit_key = a.unit_key and au.dimension = u.dimension
  where u.unit_key = p_unit_key and u.dimension <> 'pack'
  order by a.item_unit_id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Guard triggers — they bind every writer, the owner and the seed included
-- ---------------------------------------------------------------------------

-- The warehouse's guards fired only for "app calls" (private.is_api_call()), so its own
-- definer functions skipped them. These fire for everyone.
create or replace function erp.item_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'item % is retired, never deleted (B-11)', old.code
      using errcode = 'restrict_violation', constraint = 'item_never_deleted',
            hint = 'Retire it through erp.change_item_status(). Every line that names it must go on naming it.';
  end if;
  if (new.item_id, new.code, new.item_kind, new.base_unit_key, new.brand_id)
     is distinct from (old.item_id, old.code, old.item_kind, old.base_unit_key, old.brand_id) then
    raise exception 'item %: code, kind, base unit and brand are fixed once the item exists (INV-002, INV-005)', old.code
      using errcode = 'restrict_violation', constraint = 'item_identity_fixed',
            hint = 'Retire the mistaken item and create a correct one under a new code.';
  end if;
  return new;
end;
$$;

-- Fires BEFORE the foreign-key checks, so a delete is refused by this rule and not by a
-- 23503 that happens to exist.
create trigger item_is_fixed
  before update or delete on erp.item
  for each row
  execute function erp.item_is_fixed();

create or replace function erp.item_unit_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code   text;
  v_base   text;
  v_dim    text;
  v_per    numeric;
  v_afact  numeric;
  v_aper   numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'conversion % is retired, never deleted (INV-005)', old.item_unit_id
      using errcode = 'restrict_violation', constraint = 'item_unit_never_deleted';
  end if;

  select i.code, i.base_unit_key into v_code, v_base from erp.item i where i.item_id = new.item_id;

  if tg_op = 'UPDATE' then
    if (new.item_unit_id, new.item_id, new.unit_key, new.factor)
       is distinct from (old.item_unit_id, old.item_id, old.unit_key, old.factor) then
      raise exception 'conversion %: item, unit and factor are fixed once recorded (INV-005, I-7)', old.item_unit_id
        using errcode = 'restrict_violation', constraint = 'item_unit_conversion_fixed';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then
      raise exception 'conversion % is retired for good; add a new one (I-6)', old.item_unit_id
        using errcode = 'restrict_violation', constraint = 'item_unit_retirement_final';
    end if;
    if new.status = 'retired' and new.unit_key = v_base then
      raise exception 'the base unit of an item is never retired (INV-005)'
        using errcode = 'restrict_violation', constraint = 'item_base_unit_fixed';
    end if;
    return new;
  end if;

  -- INSERT. An unknown item is left to the foreign key.
  if v_base is null then
    return new;
  end if;
  if new.unit_key = v_base and (new.factor <> 1 or new.status <> 'active') then
    raise exception 'the base unit of % converts at 1 and is never retired (INV-005)', v_code
      using errcode = 'restrict_violation', constraint = 'item_base_unit_fixed';
  end if;

  -- Every ACTIVE conversion of one physical dimension on one item agrees with the others,
  -- compared exactly by cross-multiplication. Packs have no physical size and are free.
  select u.dimension, u.per_reference into v_dim, v_per from erp.unit u where u.unit_key = new.unit_key;
  if new.status = 'active' and v_dim is not null and v_dim <> 'pack' then
    select a.factor, au.per_reference into v_afact, v_aper
    from erp.item_unit a
    join erp.unit au on au.unit_key = a.unit_key
    where a.item_id = new.item_id
      and a.status = 'active'
      and au.dimension = v_dim
      and a.item_unit_id <> new.item_unit_id
    order by a.item_unit_id
    limit 1;
    if found and new.factor * v_aper <> v_afact * v_per then
      raise exception 'one % of % is % %, not % (INV-005)',
        new.unit_key, v_code, trim_scale(v_afact * v_per / v_aper), v_base, trim_scale(new.factor)
        using errcode = 'check_violation', constraint = 'item_unit_agrees_with_its_dimension';
    end if;
  end if;
  return new;
end;
$$;

create trigger item_unit_is_fixed
  before insert or update or delete on erp.item_unit
  for each row
  execute function erp.item_unit_is_fixed();

-- ---------------------------------------------------------------------------
-- Seams for later modules — owner-only, called from their own definer routes
-- ---------------------------------------------------------------------------

-- New work that ACQUIRES an item — a PO line, a branch order line, a recipe version, a
-- production output, a supplier link — calls this. Disposal of what already exists must
-- not: a retired item's stock can still be counted, issued, transferred or written off.
-- Raises rather than returning false, like erp.assert_capability_admits(). FOR SHARE, so
-- a concurrent retirement waits rather than races.
create or replace function erp.assert_item_active(p_item_id uuid, p_kinds text[] default null)
returns erp.item
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v erp.item;
begin
  select * into v from erp.item i where i.item_id = p_item_id for share;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  if v.status <> 'active' then
    raise exception 'item % is retired and admits no new work', v.code
      using errcode = 'restrict_violation', constraint = 'item_admits_no_new_work',
            hint = 'Stock already on hand can still be counted, issued, transferred or written off.';
  end if;
  if p_kinds is not null and not (v.item_kind = any (p_kinds)) then
    raise exception 'item % is a % and cannot be used here (INV-002). Allowed: %',
      v.code, v.item_kind, array_to_string(p_kinds, ', ')
      using errcode = 'restrict_violation', constraint = 'item_kind_not_allowed';
  end if;
  return v;
end;
$$;

-- The I-7 handle and the "no silent 1" rule in one place. The caller copies
-- (item_unit_id, unit_key, factor) into its own line under a composite foreign key to
-- item_unit_seam and never re-reads the conversion. This replaces the warehouse's LEFT
-- JOIN warehouse_units plus coalesce(nullif(ratio, 0), 1).
create or replace function erp.active_item_unit(p_item_id uuid, p_unit_key text)
returns erp.item_unit
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code text;
  v      erp.item_unit;
begin
  select i.code into v_code from erp.item i where i.item_id = p_item_id;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  select * into v from erp.item_unit u
   where u.item_id = p_item_id and u.unit_key = p_unit_key and u.status = 'active';
  if not found then
    raise exception 'item % has no active conversion for unit % (INV-005)', v_code, p_unit_key
      using errcode = 'no_data_found', constraint = 'item_unit_missing',
            hint = 'Declare one. A missing conversion is never taken to be one.';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- The admitted write routes — each records its decision and advances the projection
-- ---------------------------------------------------------------------------

-- The single admitted route to a new item, with its base conversion, in one transaction:
-- the warehouse made four uncoordinated client calls (item, picture, units, minimum).
-- All four ids are minted by the console (I-1). A repeated decision id fails 23505 on
-- item_decision_pkey; the edge reads erp.item_history() back before reporting success.
create or replace function erp.create_item(
  p_decision_id           uuid,
  p_item_id               uuid,
  p_base_unit_decision_id uuid,
  p_base_item_unit_id     uuid,
  p_brand_id              uuid,
  p_code                  text,
  p_item_kind             text,
  p_base_unit_key         text,
  p_name_en               text,
  p_name_ar               text,
  p_description_en        text,
  p_description_ar        text,
  p_picture_path          text,
  p_reason                text,
  p_actor_id              uuid,
  p_decided_at            timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_code    text := erp.normalise_item_code(p_code);
  v_name_en text := erp.normalise_label(p_name_en);
  v_name_ar text := erp.normalise_label(p_name_ar);
  v_desc_en text := nullif(btrim(p_description_en), '');
  v_desc_ar text := nullif(btrim(p_description_ar), '');
begin
  -- Organisation scope: the item master is organisation data, so only an
  -- organisation-wide role grants write.
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  if v_name_en is null or v_name_ar is null then
    raise exception 'an item is named in both English and Arabic (PRG-014)'
      using errcode = 'check_violation', constraint = 'item_names_are_bilingual';
  end if;
  if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9._-]{0,23}$' then
    raise exception 'item code % is not valid: 1 to 24 characters of A-Z, 0-9, ".", "_" or "-", beginning with a letter or digit',
      coalesce(v_code, '(blank)')
      using errcode = 'check_violation', constraint = 'item_code_is_canonical';
  end if;
  if exists (select 1 from erp.item i where i.code = v_code) then
    raise exception 'item code % is already used: a code names one item, for good (INV-002)', v_code
      using errcode = 'unique_violation', constraint = 'item_code_key',
            hint = 'Retired items keep their codes. Choose another.';
  end if;
  if p_item_kind is null or p_item_kind not in ('raw_ingredient', 'semi_finished', 'finished_product',
       'packaging', 'cleaning_supply', 'operating_supply', 'equipment', 'spare_part') then
    raise exception '% is not an item kind (INV-002)', coalesce(p_item_kind, '(blank)')
      using errcode = 'check_violation', constraint = 'item_kind_is_known';
  end if;
  if not exists (select 1 from erp.unit u where u.unit_key = p_base_unit_key) then
    raise exception 'unit % is not in the register (INV-005)', coalesce(p_base_unit_key, '(blank)')
      using errcode = 'foreign_key_violation', constraint = 'item_base_unit_is_registered';
  end if;
  if not exists (select 1 from erp.brand b where b.brand_id = p_brand_id) then
    raise exception 'brand % does not exist (ADR-0012)', p_brand_id
      using errcode = 'foreign_key_violation', constraint = 'item_brand_exists';
  end if;

  insert into erp.item_decision (
    decision_id, kind, item_id, code, item_kind, base_unit_key, brand_id,
    name_en, name_ar, description_en, description_ar, picture_path, status,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, 'item_created', p_item_id, v_code, p_item_kind, p_base_unit_key, p_brand_id,
    v_name_en, v_name_ar, v_desc_en, v_desc_ar, p_picture_path, 'active',
    p_reason, p_actor_id, p_decided_at
  );

  insert into erp.item (
    item_id, code, item_kind, base_unit_key, brand_id, name_en, name_ar,
    description_en, description_ar, picture_path, status, as_of_decision_id
  ) values (
    p_item_id, v_code, p_item_kind, p_base_unit_key, p_brand_id, v_name_en, v_name_ar,
    v_desc_en, v_desc_ar, p_picture_path, 'active', p_decision_id
  );

  insert into erp.item_decision (
    decision_id, kind, item_id, item_unit_id, unit_key, factor, status, reason, actor_id, decided_at
  ) values (
    p_base_unit_decision_id, 'unit_added', p_item_id, p_base_item_unit_id, p_base_unit_key, 1, 'active',
    p_reason, p_actor_id, p_decided_at
  );

  insert into erp.item_unit (item_unit_id, item_id, unit_key, factor, status, as_of_decision_id)
  values (p_base_item_unit_id, p_item_id, p_base_unit_key, 1, 'active', p_base_unit_decision_id);
end;
$$;

comment on function erp.create_item(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, uuid, timestamptz) is
  'INV-002, INV-005. The single admitted route to a new item: records the decision, writes the item and its base conversion at factor 1, in one transaction. Code, kind, base unit and brand are fixed from here on.';

-- Descriptive changes only: code, kind, base unit and brand are not parameters. Takes the
-- whole descriptive state, exactly what the edit form shows, and the stamp the form
-- loaded — the warehouse let the last writer win.
create or replace function erp.amend_item(
  p_decision_id          uuid,
  p_item_id              uuid,
  p_expected_decision_id uuid,
  p_name_en              text,
  p_name_ar              text,
  p_description_en       text,
  p_description_ar       text,
  p_picture_path         text,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v         erp.item;
  v_name_en text := erp.normalise_label(p_name_en);
  v_name_ar text := erp.normalise_label(p_name_ar);
  v_desc_en text := nullif(btrim(p_description_en), '');
  v_desc_ar text := nullif(btrim(p_description_ar), '');
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  select * into v from erp.item i where i.item_id = p_item_id for update;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  if v.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'item % has changed since it was read', v.code
      using errcode = 'restrict_violation', constraint = 'item_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if v.status = 'retired' then
    raise exception 'item % is retired: reinstate it before changing it', v.code
      using errcode = 'restrict_violation', constraint = 'item_is_retired';
  end if;
  if v_name_en is null or v_name_ar is null then
    raise exception 'an item is named in both English and Arabic (PRG-014)'
      using errcode = 'check_violation', constraint = 'item_names_are_bilingual';
  end if;

  -- A form saved without a change records nothing: no decision is invented.
  if (v_name_en, v_name_ar, v_desc_en, v_desc_ar, p_picture_path)
     is not distinct from (v.name_en, v.name_ar, v.description_en, v.description_ar, v.picture_path) then
    return;
  end if;

  insert into erp.item_decision (
    decision_id, kind, item_id, code, item_kind, base_unit_key, brand_id,
    name_en, name_ar, description_en, description_ar, picture_path, status,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, 'item_amended', v.item_id, v.code, v.item_kind, v.base_unit_key, v.brand_id,
    v_name_en, v_name_ar, v_desc_en, v_desc_ar, p_picture_path, v.status,
    p_reason, p_actor_id, p_decided_at
  );

  update erp.item
     set name_en = v_name_en, name_ar = v_name_ar,
         description_en = v_desc_en, description_ar = v_desc_ar,
         picture_path = p_picture_path,
         as_of_decision_id = p_decision_id, updated_at = now()
   where item_id = v.item_id;
end;
$$;

-- Retire and reinstate. No delete route exists, and none can (erp.item_is_fixed()).
-- Retirement is reversible — a seasonal item comes back — so I-6 is not engaged here.
create or replace function erp.change_item_status(
  p_decision_id          uuid,
  p_item_id              uuid,
  p_expected_decision_id uuid,
  p_status               text,
  p_reason               text,
  p_actor_id             uuid,
  p_decided_at           timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v erp.item;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  if p_status is null or p_status not in ('active', 'retired') then
    raise exception 'an item is active or retired'
      using errcode = 'invalid_parameter_value', constraint = 'item_status_is_known';
  end if;
  -- FOR UPDATE conflicts with erp.assert_item_active()'s FOR SHARE, so retirement and
  -- new work serialise.
  select * into v from erp.item i where i.item_id = p_item_id for update;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  if v.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'item % has changed since it was read', v.code
      using errcode = 'restrict_violation', constraint = 'item_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if v.status = p_status then
    raise exception 'item % is already %', v.code, p_status
      using errcode = 'restrict_violation', constraint = 'item_status_unchanged';
  end if;

  insert into erp.item_decision (
    decision_id, kind, item_id, code, item_kind, base_unit_key, brand_id,
    name_en, name_ar, description_en, description_ar, picture_path, status,
    reason, actor_id, decided_at
  ) values (
    p_decision_id, 'item_status_changed', v.item_id, v.code, v.item_kind, v.base_unit_key, v.brand_id,
    v.name_en, v.name_ar, v.description_en, v.description_ar, v.picture_path, p_status,
    p_reason, p_actor_id, p_decided_at
  );

  -- Reinstating fails 23505 on ux_item_active_name_* if another active item of the brand
  -- has taken the name meanwhile.
  update erp.item
     set status = p_status, as_of_decision_id = p_decision_id, updated_at = now()
   where item_id = v.item_id;
end;
$$;

-- Declares a conversion: 1 p_unit_key = factor x the base unit. A NULL factor means
-- "derive it" — allowed only where the dimension already fixes the answer. There is never
-- a default and never a silent 1.
create or replace function erp.add_item_unit(
  p_decision_id  uuid,
  p_item_unit_id uuid,
  p_item_id      uuid,
  p_unit_key     text,
  p_factor       numeric,
  p_reason       text,
  p_actor_id     uuid,
  p_decided_at   timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v         erp.item;
  v_derived numeric;
  v_factor  numeric;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  -- Serialises conversion changes per item, so the dimension rule is checked against a
  -- stable set.
  select * into v from erp.item i where i.item_id = p_item_id for update;
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  if v.status = 'retired' then
    raise exception 'item % is retired: reinstate it before changing it', v.code
      using errcode = 'restrict_violation', constraint = 'item_is_retired';
  end if;
  if not exists (select 1 from erp.unit u where u.unit_key = p_unit_key) then
    raise exception 'unit % is not in the register (INV-005)', coalesce(p_unit_key, '(blank)')
      using errcode = 'foreign_key_violation', constraint = 'item_unit_is_registered';
  end if;
  if p_unit_key = v.base_unit_key then
    raise exception '% is the base unit of % and converts at 1 (INV-005)', p_unit_key, v.code
      using errcode = 'restrict_violation', constraint = 'item_unit_is_base';
  end if;
  if exists (select 1 from erp.item_unit u
              where u.item_id = v.item_id and u.unit_key = p_unit_key and u.status = 'active') then
    raise exception 'item % already has an active conversion for %; retire it first, so % never means two things at once (INV-005)',
      v.code, p_unit_key, p_unit_key
      using errcode = 'restrict_violation', constraint = 'item_unit_one_active';
  end if;

  v_derived := erp.item_unit_derived_factor(v.item_id, p_unit_key);
  if v_derived is not null and v_derived <> round(v_derived, 6) then
    raise exception 'one % of % is not an exact number of %; declare the smaller unit first (INV-005)',
      p_unit_key, v.code, v.base_unit_key
      using errcode = 'check_violation', constraint = 'item_unit_factor_inexact';
  end if;

  if p_factor is null then
    if v_derived is null then
      raise exception 'the size of one % of % in % must be stated (INV-005)', p_unit_key, v.code, v.base_unit_key
        using errcode = 'check_violation', constraint = 'item_unit_factor_required';
    end if;
    v_factor := trim_scale(v_derived);
  else
    if p_factor <= 0 or p_factor > 1000000000 or p_factor <> round(p_factor, 6) then
      raise exception 'a conversion factor is above 0, at most 1000000000, with at most six decimal places (INV-005)'
        using errcode = 'check_violation', constraint = 'item_unit_factor_is_exact';
    end if;
    v_factor := trim_scale(p_factor);
  end if;

  insert into erp.item_decision (
    decision_id, kind, item_id, item_unit_id, unit_key, factor, status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'unit_added', v.item_id, p_item_unit_id, p_unit_key, v_factor, 'active',
    p_reason, p_actor_id, p_decided_at
  );

  -- erp.item_unit_is_fixed() then refuses a STATED factor that contradicts an active
  -- conversion of the same dimension.
  insert into erp.item_unit (item_unit_id, item_id, unit_key, factor, status, as_of_decision_id)
  values (p_item_unit_id, v.item_id, p_unit_key, v_factor, 'active', p_decision_id);
end;
$$;

-- Ends a conversion for NEW work. Lines that used it keep its factor forever (I-7).
-- There is no reinstate route: a pack-size change is retire plus add, and retirement is
-- final for every caller (I-6).
create or replace function erp.retire_item_unit(
  p_decision_id  uuid,
  p_item_unit_id uuid,
  p_reason       text,
  p_actor_id     uuid,
  p_decided_at   timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  u erp.item_unit;
  v erp.item;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'write', null);

  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  select * into v from erp.item i where i.item_id = u.item_id for update;
  if v.status = 'retired' then
    raise exception 'item % is retired: reinstate it before changing it', v.code
      using errcode = 'restrict_violation', constraint = 'item_is_retired';
  end if;
  if u.unit_key = v.base_unit_key then
    raise exception 'the base unit of an item is never retired (INV-005)'
      using errcode = 'restrict_violation', constraint = 'item_base_unit_fixed';
  end if;
  if u.status = 'retired' then
    raise exception 'conversion % is already retired', u.item_unit_id
      using errcode = 'restrict_violation', constraint = 'item_unit_already_retired';
  end if;

  insert into erp.item_decision (
    decision_id, kind, item_id, item_unit_id, unit_key, factor, status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'unit_retired', u.item_id, u.item_unit_id, u.unit_key, u.factor, 'retired',
    p_reason, p_actor_id, p_decided_at
  );

  update erp.item_unit
     set status = 'retired', as_of_decision_id = p_decision_id, updated_at = now()
   where item_unit_id = u.item_unit_id;
end;
$$;

-- The warehouse's Excel upload, made all-or-nothing in the database. The edge parses the
-- cells in TypeScript and mints the ids. Each row runs in its own subtransaction through
-- the SAME routes the form uses, so validation cannot diverge; any error refuses the
-- whole file, reporting up to 20 lines in the warehouse's IMPORT_ROWS format. A
-- resubmitted file matches by code and finds nothing to change, so it is idempotent
-- without a replay table. Like the warehouse upload it sets no further units, no stock
-- and no pictures.
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
    exception when others then
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

-- ---------------------------------------------------------------------------
-- The gated reads — the runtime's only view of items (CAP-P02, IAM-006, ADR-0012)
-- ---------------------------------------------------------------------------

-- Reads at a facility are brand-private (ADR-0012's default): a facility's brand is
-- reached through its operating unit. The facility is the session's (ADR-0023 §2).
create or replace function erp.item_facility_brand(p_facility_id uuid)
returns uuid
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_brand uuid;
begin
  if p_facility_id is null then
    return null;
  end if;
  select ou.brand_id into v_brand
  from erp.facility f
  join erp.operating_unit ou on ou.operating_unit_id = f.operating_unit_id
  where f.facility_id = p_facility_id;
  if not found then
    raise exception 'no facility %', p_facility_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;
  return v_brand;
end;
$$;

-- Keyset paging in C collation, deterministic under any locale; a page holds at most 500
-- rows (the warehouse loaded every list in one unpaged request). units carries every
-- conversion, retired ones included for history.
create or replace function erp.list_items(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_brand_id    uuid    default null,
  p_status      text    default 'active',
  p_item_kind   text    default null,
  p_search      text    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  item_id uuid, brand_id uuid, code text, item_kind text, base_unit_key text,
  name_en text, name_ar text, description_en text, description_ar text, picture_path text,
  status text, as_of_decision_id uuid, units jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_brand  uuid;
  v_search text := erp.normalise_label(p_search);
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);

  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 items' using errcode = 'invalid_parameter_value', constraint = 'item_page_size';
  end if;
  if p_status is not null and p_status not in ('active', 'retired') then
    raise exception 'an item is active or retired' using errcode = 'invalid_parameter_value', constraint = 'item_status_is_known';
  end if;
  if p_item_kind is not null and p_item_kind not in ('raw_ingredient', 'semi_finished', 'finished_product',
       'packaging', 'cleaning_supply', 'operating_supply', 'equipment', 'spare_part') then
    raise exception '% is not an item kind (INV-002)', p_item_kind
      using errcode = 'invalid_parameter_value', constraint = 'item_kind_is_known';
  end if;
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select i.item_id, i.brand_id, i.code, i.item_kind, i.base_unit_key,
         i.name_en, i.name_ar, i.description_en, i.description_ar, i.picture_path,
         i.status, i.as_of_decision_id,
         (select jsonb_agg(jsonb_build_object(
                   'item_unit_id', u.item_unit_id, 'unit_key', u.unit_key, 'factor', u.factor,
                   'status', u.status, 'as_of_decision_id', u.as_of_decision_id)
                 order by u.status, u.unit_key, u.item_unit_id)
            from erp.item_unit u where u.item_id = i.item_id)
  from erp.item i
  where (p_status is null or i.status = p_status)
    and (p_item_kind is null or i.item_kind = p_item_kind)
    and (v_brand is null or i.brand_id = v_brand)
    and (p_brand_id is null or i.brand_id = p_brand_id)
    and (p_after_code is null or i.code collate "C" > p_after_code collate "C")
    and (v_search is null
         or starts_with(i.code, erp.normalise_item_code(v_search))
         or strpos(lower(i.name_en), lower(v_search)) > 0
         or strpos(i.name_ar, v_search) > 0)
  order by i.code collate "C"
  limit p_limit;
end;
$$;

-- One item, whatever its status, with the stamp the edit form sends back as
-- p_expected_decision_id. An item of another brand answers exactly as a missing one, so
-- another brand's catalogue is not revealed even by an error.
create or replace function erp.get_item(p_actor_id uuid, p_facility_id uuid, p_item_id uuid)
returns table (
  item_id uuid, brand_id uuid, code text, item_kind text, base_unit_key text,
  name_en text, name_ar text, description_en text, description_ar text, picture_path text,
  status text, as_of_decision_id uuid, units jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select i.item_id, i.brand_id, i.code, i.item_kind, i.base_unit_key,
         i.name_en, i.name_ar, i.description_en, i.description_ar, i.picture_path,
         i.status, i.as_of_decision_id,
         (select jsonb_agg(jsonb_build_object(
                   'item_unit_id', u.item_unit_id, 'unit_key', u.unit_key, 'factor', u.factor,
                   'status', u.status, 'as_of_decision_id', u.as_of_decision_id)
                 order by u.status, u.unit_key, u.item_unit_id)
            from erp.item_unit u where u.item_id = i.item_id)
  from erp.item i
  where i.item_id = p_item_id
    and (v_brand is null or i.brand_id = v_brand);
  if not found then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
end;
$$;

-- Every decision about the item and its conversions, in order (IAM-008). Each row is a
-- state, so "before" is the previous row about the same subject. The runtime's only view
-- of the log, and the read the edge uses to confirm a retried write.
create or replace function erp.item_history(p_actor_id uuid, p_facility_id uuid, p_item_id uuid)
returns setof erp.item_decision
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i
                  where i.item_id = p_item_id and (v_brand is null or i.brand_id = v_brand)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;
  return query
  select d.* from erp.item_decision d where d.item_id = p_item_id order by d.seq;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

-- In the migration, because a real database needs it as much as a development one: the
-- capabilities Phase 4 found only in the synthetic seed (inventory.stock,
-- factory.production, finance.month_close) exist nowhere real. No decision is recorded,
-- so CAP-P02's default-deny makes it HIDDEN everywhere until a later migration promotes
-- it — never the seed. MFG-012 is listed so promotion waits on the approved process
-- mapping (CAP-P09). Not protected: CAP-P08 covers only the administration of
-- capabilities, identity and audit.
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('inventory.items', 'Items and units', 'الأصناف والوحدات',
   array['INV-002', 'INV-005', 'MFG-012', 'PRG-014'], false, timestamptz '2026-10-02 00:00:00+00');

-- The administrator is the only role a real database has (0011), and nothing writes
-- erp.role_permission at runtime, so without these rows nobody could ever write an item
-- once the capability opened. Warehouse fidelity: items were administrator-managed
-- (its SYSTEM.md §8.10). 'approve' is unused: no INV requirement asks for approval of
-- master data.
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'inventory.items', 'read'),
  ('administrator', 'inventory.items', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: a per-schema default cannot undo PostgreSQL's global PUBLIC EXECUTE,
-- so every migration that adds a function revokes it. db-check's
-- no-erp-function-is-executable-by-public fails the build otherwise.
revoke execute on all functions in schema erp from public;

-- What erp_app does NOT get is the design:
--   * no privilege of any kind on erp.item, erp.item_unit or erp.item_decision — writes
--     go only through the six admitted routes, each of which records its decision, and
--     reads only through the three gated functions;
--   * no write on erp.unit, which changes by migration only;
--   * no EXECUTE on the seams (assert_item_active, active_item_unit) or the helpers —
--     later modules call them from their own definer routes, which run as the owner.
grant select on erp.unit to erp_app;
grant execute on function
  erp.create_item(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, uuid, timestamptz),
  erp.amend_item(uuid, uuid, uuid, text, text, text, text, text, text, uuid, timestamptz),
  erp.change_item_status(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.add_item_unit(uuid, uuid, uuid, text, numeric, text, uuid, timestamptz),
  erp.retire_item_unit(uuid, uuid, text, uuid, timestamptz),
  erp.import_items(uuid, text, timestamptz, jsonb),
  erp.list_items(uuid, uuid, uuid, text, text, text, text, integer),
  erp.get_item(uuid, uuid, uuid),
  erp.item_history(uuid, uuid, uuid)
to erp_app;

-- erp_read keeps 0002's default SELECT on all four tables, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- 0008 does not re-run, so each table is stated here, as 0010 and 0011 do. Policies
-- mirror grants and never widen them (0008's rule): erp_app has a grant on erp.unit only.
do $$
declare
  t text;
begin
  foreach t in array array['unit', 'item_decision', 'item', 'item_unit'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;

create policy erp_app_read on erp.unit for select to erp_app using (true);
