-- 0016 · Suppliers — who the company buys from, and exactly what it buys from them
--
-- Requirements: PRC-005 · INV-005 · PRG-014 · MFG-012 · SEC-008 · CAP-P02 · CAP-P04
--               IAM-003 · IAM-006 · IAM-008
-- ADR-0005 · ADR-0012 · ADR-0023 · ADR-0024 · ADR-0026 (proposed) · invariants I-6, I-7, I-8
--
-- Phase 4, module 2. The warehouse system kept one table of suppliers — a name, a type
-- (warehouse | raw_material | both), contact fields and payment terms — edited in place
-- and deleted at will, and pointed at it from raw_materials.supplier_id, one primary
-- supplier per raw material. Written fresh here through the process mapping MFG-012
-- requires (docs/estate/process-mapping-suppliers.md), not copied.
--
-- FOUR TABLES' WORTH, IN THREE. An append-only decision log (erp.supplier_decision)
-- whose rows carry the whole state they put in force, and two projections stamped with
-- it: the supplier master (erp.supplier) and what each supplier sells (erp.supplier_item).
--
-- WHAT A SUPPLIER SELLS NAMES A CONVERSION, NOT AN ITEM. The warehouse's
-- raw_materials.supplier_id said "this supplier sells chicken"; it could not say "in
-- 10 kg cartons". A supply here references erp.item_unit through 0012's four-column seam
-- (item_unit_id, item_id, unit_key, factor), so a purchase order line that copies it
-- (module 8) provably buys the pack the supplier sells, at the factor it had. The item
-- master knows nothing of suppliers: the dependency runs one way, which removes the
-- consolidation plan's second ordering error.
--
-- THE TYPE GOES. warehouse | raw_material | both was a coarse stand-in for "what does
-- this supplier sell", checked against a PO's kind. The supplies ARE that answer, item
-- by item. Purchasing (module 8) asks "does this supplier sell this conversion", which
-- the type could never answer.
--
-- PERSONAL DATA STAYS OUT OF THE LOG, as 0011 decided for people (SEC-008). A supplier's
-- business record — code, names, VAT and commercial-registration numbers, payment terms,
-- status — is decided and logged in full. Its contact person, phone, email and address
-- can name a private individual (a sole trader's address is their home), so they live
-- only on erp.supplier, mutable and erasable. Changing them records a decision of kind
-- supplier_contact_changed that says who, when and why, and carries no contact value.
--
-- NOT BUILT, deliberately, and recorded in ADR-0026 as the owner's to decide:
--   * banking details (PRC-005). An IBAN is the field a payment fraud changes, so it
--     needs its own permission, a second approver and a payment process to serve — none
--     of which exists, and the payment freeze (CLAUDE.md §6) covers what would use it;
--   * contracts and documents, which need storage under ADR-0023 (ADR-0024's open
--     question 6 is the same problem);
--   * performance (PRC-008, F4), which is computed from receipts that do not exist yet;
--   * a category other than what the supplier sells.
--
-- The module ships HIDDEN, like 0012: registered here, no decision recorded, so
-- CAP-P02's default-deny holds in every real database until a later migration promotes it.

-- No `set local search_path` here: migrations are applied outside a transaction block,
-- where SET LOCAL warns and does nothing. Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The decision log (IAM-008, I-8) — append-only, centrally originated
-- ---------------------------------------------------------------------------

create table erp.supplier_decision (
  decision_id        uuid        primary key,
  -- A total order, as 0012's: decided_at ties in the seed, and "the latest decision about
  -- X" needs one order.
  seq                bigint      generated always as identity constraint supplier_decision_seq_key unique,
  kind               text        not null
    constraint supplier_decision_kind_is_known
      check (kind in ('supplier_created', 'supplier_amended', 'supplier_status_changed', 'supplier_contact_changed',
                      'supply_added', 'supply_amended', 'supply_retired')),
  -- No foreign keys to the subjects, as 0012's log has none: the decision is written
  -- before the row it creates. db-check's supplier-projections-match-their-decisions
  -- proves every decision names a real supplier and supply.
  supplier_id        uuid        not null,
  -- supply_* kinds: the supply decided about.
  supplier_item_id   uuid,
  -- supplier_* kinds: the supplier's BUSINESS record as this decision left it. Whole
  -- state, never a delta. No contact field is here, ever (SEC-008).
  code               text,
  name_en            text,
  name_ar            text,
  vat_number         text,
  cr_number          text,
  payment_terms_days integer,
  -- supply_* kinds: the conversion supplied, copied whole, and the supply's own fields.
  item_unit_id       uuid,
  item_id            uuid,
  unit_key           text,
  factor             numeric,
  supplier_code      text,
  preferred          boolean,
  -- The supplier's status for supplier_* kinds, the supply's for supply_* kinds.
  status             text        not null constraint supplier_decision_status_is_known check (status in ('active', 'retired')),
  reason             text        not null constraint supplier_decision_reason_is_stated check (length(btrim(reason)) > 0),
  -- B-11: never nulled, never cascaded.
  actor_id           uuid        not null constraint supplier_decision_actor_is_a_person
                                   references erp.person (person_id) on delete no action,
  decided_at         timestamptz not null,
  recorded_at        timestamptz not null default now(),
  -- Targets for the projections' composite stamps: a stamp names a decision about ITS
  -- subject, never another supplier's or supply's.
  constraint supplier_decision_about_supplier unique (decision_id, supplier_id),
  constraint supplier_decision_about_supply unique (decision_id, supplier_item_id),
  constraint supplier_decision_shape check (
    case
      when kind in ('supplier_created', 'supplier_amended', 'supplier_status_changed', 'supplier_contact_changed') then
            supplier_item_id is null and item_unit_id is null and item_id is null and unit_key is null
        and factor is null and supplier_code is null and preferred is null
        and code is not null and name_en is not null and name_ar is not null and payment_terms_days is not null
        and (kind <> 'supplier_created' or status = 'active')
      when kind in ('supply_added', 'supply_amended', 'supply_retired') then
            supplier_item_id is not null and item_unit_id is not null and item_id is not null
        and unit_key is not null and factor is not null and preferred is not null
        and code is null and name_en is null and name_ar is null and vat_number is null and cr_number is null
        and payment_terms_days is null
        and ((kind = 'supply_retired') = (status = 'retired'))
      else false
    end
  )
);

comment on table erp.supplier_decision is
  'Append-only record of every supplier and supply decision (PRC-005, IAM-008, I-8). Each row carries the whole business state it put in force. Never a contact value: contact person, phone, email and address stay on erp.supplier, which can be erased (SEC-008).';
comment on column erp.supplier_decision.supplier_id is
  'No foreign key: the log is written before the row it creates, as erp.item_decision.item_id. Checked by db-check.';

create index ix_supplier_decision_supplier on erp.supplier_decision (supplier_id, seq);
create index ix_supplier_decision_supply on erp.supplier_decision (supplier_item_id, seq) where supplier_item_id is not null;

-- Append-only, enforced twice as 0004, 0010, 0011 and 0012 do. erp_app holds no
-- privilege on it. TRUNCATE is covered too: a TRUNCATE … CASCADE of erp.person would
-- otherwise reach it through the log's own foreign key.
create or replace function erp.supplier_decision_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception
    'supplier_decision is append-only (IAM-008): % denied on %',
    tg_op, tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Append a further decision. Who the company bought from, and who changed it, is not unmade by deleting the record of it.';
end;
$$;

create trigger supplier_decision_append_only
  before update or delete or truncate on erp.supplier_decision
  for each statement
  execute function erp.supplier_decision_is_append_only();

-- ---------------------------------------------------------------------------
-- The supplier master (PRC-005)
-- ---------------------------------------------------------------------------

create table erp.supplier (
  -- UUIDv7, minted by the console (I-1, ADR-0005).
  supplier_id        uuid        primary key,
  -- One code, one supplier, for good: unique across retired suppliers too, because every
  -- PO, receipt and invoice goes on naming it. Same alphabet as an item code, canonical,
  -- in C collation so paging by code is byte order everywhere. The warehouse had no code
  -- and matched by lower(trim(name)), so a renamed supplier became a new one on import.
  code               text        collate "C" not null
    constraint supplier_code_key unique
    constraint supplier_code_is_canonical check (code ~ '^[A-Z0-9][A-Z0-9._-]{0,23}$'),
  name_en            text        not null,
  name_ar            text        not null,
  -- ZATCA's VAT registration number: fifteen digits, first and last 3. Optional — a small
  -- local vendor may not be registered — but never malformed, because a purchase invoice's
  -- input VAT is reclaimable only against a valid number (module 8 decides what to do
  -- with a supplier who has none). Not unique: one company's branches share a number.
  vat_number         text
    constraint supplier_vat_number_is_valid check (vat_number ~ '^3[0-9]{13}3$'),
  -- The commercial registration number: ten digits.
  cr_number          text
    constraint supplier_cr_number_is_valid check (cr_number ~ '^[0-9]{10}$'),
  -- Days from invoice to due date, as the warehouse kept them (0–365). No default here:
  -- the console proposes 30, and the database records what was decided.
  payment_terms_days integer     not null
    constraint supplier_payment_terms_are_days check (payment_terms_days between 0 and 365),
  status             text        not null constraint supplier_status_is_known check (status in ('active', 'retired')),
  -- CONTACTS: reference data, not decided state (SEC-008). Changed through
  -- erp.set_supplier_contact(), which logs that they changed but never what to.
  contact_person     text,
  phone              text,
  email              text,
  address            text,
  -- I-8. The single-column key is what db-check's
  -- projection-stamp-is-a-foreign-key-where-it-can-be finds; the composite one makes it
  -- impossible to stamp this supplier with ANOTHER supplier's decision.
  as_of_decision_id  uuid        not null constraint supplier_as_of_decision_id_fkey references erp.supplier_decision (decision_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint supplier_stamp_is_this_suppliers_decision foreign key (as_of_decision_id, supplier_id)
    references erp.supplier_decision (decision_id, supplier_id),
  constraint supplier_names_are_canonical check (
        name_en = btrim(regexp_replace(name_en, '[[:space:]]+', ' ', 'g')) and length(name_en) between 1 and 160
    and name_ar = btrim(regexp_replace(name_ar, '[[:space:]]+', ' ', 'g')) and length(name_ar) between 1 and 160),
  constraint supplier_contacts_are_canonical check (
        (contact_person is null or (contact_person = btrim(contact_person) and length(contact_person) between 1 and 120))
    and (phone is null or phone ~ '^\+?[0-9]{6,15}$')
    and (email is null or (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    and (address is null or (address = btrim(address) and length(address) between 1 and 500)))
);

comment on table erp.supplier is
  'The supplier master (PRC-005). Business fields are a projection of erp.supplier_decision that equals its stamp; contact fields are erasable reference data (SEC-008). Retired, never deleted. Holds no banking, contract, category or performance data (ADR-0026).';
comment on column erp.supplier.contact_person is
  'Personal data (SEC-008): never copied into the decision log. Erased by setting it null through erp.set_supplier_contact().';

-- Active names are unique in both languages, as the warehouse's lower(trim(name)) index
-- made them; a retired supplier frees its names.
create unique index supplier_active_name_en_key on erp.supplier (lower(name_en)) where status = 'active';
create unique index supplier_active_name_ar_key on erp.supplier (name_ar)        where status = 'active';

-- ---------------------------------------------------------------------------
-- What a supplier sells (PRC-005, INV-005, I-7) — a supplier and a conversion
-- ---------------------------------------------------------------------------

create table erp.supplier_item (
  -- Minted by the console (I-1).
  supplier_item_id   uuid        primary key,
  supplier_id        uuid        not null constraint supplier_item_supplier_exists references erp.supplier (supplier_id),
  -- THE I-7 SEAM, the first table to use it: the conversion supplied, copied whole and
  -- referenced through 0012's item_unit_seam. "This supplier sells chicken breast in
  -- 10 kg cartons" — and a carton changed to 12 kg is a new conversion, so this supply
  -- goes on meaning 10.
  item_unit_id       uuid        not null,
  item_id            uuid        not null,
  unit_key           text        not null,
  factor             numeric     not null,
  -- The supplier's own code for it, as printed on their invoices. Optional.
  supplier_code      text,
  -- The warehouse's raw_materials.supplier_id was ONE primary supplier per raw material,
  -- which its daily sheet grouped by. Kept as at most one preferred active supply per
  -- item, for any kind of item.
  preferred          boolean     not null,
  status             text        not null constraint supplier_item_status_is_known check (status in ('active', 'retired')),
  as_of_decision_id  uuid        not null constraint supplier_item_as_of_decision_id_fkey references erp.supplier_decision (decision_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint supplier_item_names_a_conversion foreign key (item_unit_id, item_id, unit_key, factor)
    references erp.item_unit (item_unit_id, item_id, unit_key, factor),
  constraint supplier_item_stamp_is_this_supplys_decision foreign key (as_of_decision_id, supplier_item_id)
    references erp.supplier_decision (decision_id, supplier_item_id),
  constraint supplier_item_code_is_canonical check (
    supplier_code is null or (supplier_code = btrim(supplier_code) and length(supplier_code) between 1 and 64))
);

comment on table erp.supplier_item is
  'What a supplier sells: a supplier and one of an item''s conversions, through 0012''s four-column seam (INV-005, I-7). Supplier and conversion are fixed; a change of pack is a retirement and a new supply. Retired, never deleted.';

-- A supplier sells a conversion once at a time, and an item has at most one preferred
-- supplier at a time. Named as the constraints the routes raise, so a race that slips
-- past a route's check is refused under the same name.
create unique index supplier_item_one_active on erp.supplier_item (supplier_id, item_unit_id) where status = 'active';
create unique index supplier_item_one_preferred on erp.supplier_item (item_id) where status = 'active' and preferred;
create index ix_supplier_item_supplier on erp.supplier_item (supplier_id);
create index ix_supplier_item_item on erp.supplier_item (item_id);

-- ---------------------------------------------------------------------------
-- Guard triggers — they bind every writer, the owner and the seed included
-- ---------------------------------------------------------------------------

create or replace function erp.supplier_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'supplier % is retired, never deleted (B-11)', old.code
      using errcode = 'restrict_violation', constraint = 'supplier_never_deleted',
            hint = 'Retire it through erp.change_supplier_status(). Every order and invoice that names it must go on naming it.';
  end if;
  if (new.supplier_id, new.code) is distinct from (old.supplier_id, old.code) then
    raise exception 'supplier %: the code is fixed once the supplier exists', old.code
      using errcode = 'restrict_violation', constraint = 'supplier_identity_fixed',
            hint = 'Retire the mistaken supplier and create a correct one under a new code.';
  end if;
  return new;
end;
$$;

create trigger supplier_is_fixed
  before update or delete on erp.supplier
  for each row
  execute function erp.supplier_is_fixed();

create or replace function erp.supplier_item_is_fixed()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'supply % is retired, never deleted (B-11)', old.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_never_deleted';
  end if;
  if (new.supplier_item_id, new.supplier_id, new.item_unit_id, new.item_id, new.unit_key, new.factor)
     is distinct from (old.supplier_item_id, old.supplier_id, old.item_unit_id, old.item_id, old.unit_key, old.factor) then
    raise exception 'supply %: supplier and conversion are fixed once recorded (I-7)', old.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_fixed',
            hint = 'Retire it and add a new supply.';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'supply % is retired for good; add a new one (I-6)', old.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_retirement_final';
  end if;
  -- A retired supply restamped is a decision that changed nothing (0012's reasoning for
  -- conversions). Timestamp-only updates (0090) leave the stamp alone and pass.
  if old.status = 'retired' and new.as_of_decision_id is distinct from old.as_of_decision_id then
    raise exception 'supply % is already retired', old.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_already_retired';
  end if;
  return new;
end;
$$;

create trigger supplier_item_is_fixed
  before update or delete on erp.supplier_item
  for each row
  execute function erp.supplier_item_is_fixed();

-- Row triggers do not fire for TRUNCATE.
create or replace function erp.supplier_tables_are_never_truncated()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is retired, never deleted (B-11): TRUNCATE denied', tg_table_name
    using errcode = 'restrict_violation',
          hint = 'Retire suppliers and supplies through their routes.';
end;
$$;

create trigger supplier_never_truncated
  before truncate on erp.supplier
  for each statement
  execute function erp.supplier_tables_are_never_truncated();

create trigger supplier_item_never_truncated
  before truncate on erp.supplier_item
  for each statement
  execute function erp.supplier_tables_are_never_truncated();

-- ---------------------------------------------------------------------------
-- Helpers — granted to nobody
-- ---------------------------------------------------------------------------

-- Digits as typed on any keyboard: Arabic-Indic and Persian digits folded, spaces and
-- dashes dropped, blank as NULL. It does not validate; the CHECKs above do.
create or replace function erp.normalise_digits(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(regexp_replace(translate(p_text, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[[:space:]-]', '', 'g'), '');
$$;

-- A retried call carries the decision id it was first sent with: 0012's
-- assert_item_decision_is_new(), for this log. Locked and checked first, so a retry that
-- overlaps its original waits for it and then answers 23505 on supplier_decision_pkey.
create or replace function erp.assert_supplier_decision_is_new(p_decision_id uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('erp.supplier_decision:' || p_decision_id::text, 0));
  if exists (select 1 from erp.supplier_decision d where d.decision_id = p_decision_id) then
    raise exception 'decision % is already recorded', p_decision_id
      using errcode = 'unique_violation', constraint = 'supplier_decision_pkey',
            hint = 'A retry of a call that already succeeded. Read erp.supplier_history() to confirm.';
  end if;
end;
$$;

-- The business fields a create or an amendment takes, checked once for both.
create or replace function erp.assert_supplier_fields(
  p_name_en text, p_name_ar text, p_vat_number text, p_cr_number text, p_payment_terms_days integer
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_name_en is null or p_name_ar is null then
    raise exception 'a supplier is named in both English and Arabic (PRG-014)'
      using errcode = 'check_violation', constraint = 'supplier_names_are_bilingual';
  end if;
  if length(p_name_en) > 160 or length(p_name_ar) > 160 then
    raise exception 'a supplier''s name is at most 160 characters'
      using errcode = 'check_violation', constraint = 'supplier_names_are_canonical';
  end if;
  if p_vat_number is not null and p_vat_number !~ '^3[0-9]{13}3$' then
    raise exception 'VAT number % is not valid: fifteen digits, beginning and ending with 3', p_vat_number
      using errcode = 'check_violation', constraint = 'supplier_vat_number_is_valid';
  end if;
  if p_cr_number is not null and p_cr_number !~ '^[0-9]{10}$' then
    raise exception 'commercial registration % is not valid: ten digits', p_cr_number
      using errcode = 'check_violation', constraint = 'supplier_cr_number_is_valid';
  end if;
  if p_payment_terms_days is null or p_payment_terms_days not between 0 and 365 then
    raise exception 'payment terms are 0 to 365 days'
      using errcode = 'check_violation', constraint = 'supplier_payment_terms_are_days';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seams for later modules — owner-only, called from their own definer routes
-- ---------------------------------------------------------------------------

-- New work that BUYS from a supplier — a PO, a daily-sheet supply — calls this. FOR
-- SHARE, so a concurrent retirement waits rather than races, as erp.assert_item_active().
create or replace function erp.assert_supplier_active(p_supplier_id uuid)
returns erp.supplier
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v erp.supplier;
begin
  select * into v from erp.supplier s where s.supplier_id = p_supplier_id for share;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  if v.status <> 'active' then
    raise exception 'supplier % is retired and admits no new work', v.code
      using errcode = 'restrict_violation', constraint = 'supplier_admits_no_new_work',
            hint = 'Orders already placed with it can still be received, invoiced and paid.';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- The admitted write routes — each records its decision and advances the projection
-- ---------------------------------------------------------------------------

-- A new supplier. Its contacts are set separately (erp.set_supplier_contact), so that
-- what is logged and what is erasable never share a route.
create or replace function erp.create_supplier(
  p_decision_id        uuid,
  p_supplier_id        uuid,
  p_code               text,
  p_name_en            text,
  p_name_ar            text,
  p_vat_number         text,
  p_cr_number          text,
  p_payment_terms_days integer,
  p_reason             text,
  p_actor_id           uuid,
  p_decided_at         timestamptz
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
  v_vat     text := erp.normalise_digits(p_vat_number);
  v_cr      text := erp.normalise_digits(p_cr_number);
begin
  -- The supplier master is organisation data: only an organisation-wide role writes it.
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9._-]{0,23}$' then
    raise exception 'supplier code % is not valid: 1 to 24 characters of A-Z, 0-9, ".", "_" or "-", beginning with a letter or digit',
      coalesce(v_code, '(blank)')
      using errcode = 'check_violation', constraint = 'supplier_code_is_canonical';
  end if;
  if exists (select 1 from erp.supplier s where s.code = v_code) then
    raise exception 'supplier code % is already used: a code names one supplier, for good', v_code
      using errcode = 'unique_violation', constraint = 'supplier_code_key',
            hint = 'Retired suppliers keep their codes. Choose another.';
  end if;
  perform erp.assert_supplier_fields(v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days);

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supplier_created', p_supplier_id, v_code, v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days,
    'active', p_reason, p_actor_id, p_decided_at
  );

  insert into erp.supplier (
    supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days, status, as_of_decision_id
  ) values (
    p_supplier_id, v_code, v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days, 'active', p_decision_id
  );
end;
$$;

comment on function erp.create_supplier(uuid, uuid, text, text, text, text, text, integer, text, uuid, timestamptz) is
  'PRC-005. The single admitted route to a new supplier: records the decision and writes the supplier in one transaction. The code is fixed from here on.';

-- The business record, whole, as the edit form shows it, against the stamp the form
-- loaded. The code is not a parameter.
create or replace function erp.amend_supplier(
  p_decision_id          uuid,
  p_supplier_id          uuid,
  p_expected_decision_id uuid,
  p_name_en              text,
  p_name_ar              text,
  p_vat_number           text,
  p_cr_number            text,
  p_payment_terms_days   integer,
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
  v         erp.supplier;
  v_name_en text := erp.normalise_label(p_name_en);
  v_name_ar text := erp.normalise_label(p_name_ar);
  v_vat     text := erp.normalise_digits(p_vat_number);
  v_cr      text := erp.normalise_digits(p_cr_number);
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  select * into v from erp.supplier s where s.supplier_id = p_supplier_id for update;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  if v.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'supplier % has changed since it was read', v.code
      using errcode = 'restrict_violation', constraint = 'supplier_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if v.status = 'retired' then
    raise exception 'supplier % is retired: reinstate it before changing it', v.code
      using errcode = 'restrict_violation', constraint = 'supplier_is_retired';
  end if;
  perform erp.assert_supplier_fields(v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days);

  -- A form saved without a change records nothing.
  if (v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days)
     is not distinct from (v.name_en, v.name_ar, v.vat_number, v.cr_number, v.payment_terms_days) then
    return;
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supplier_amended', v.supplier_id, v.code, v_name_en, v_name_ar, v_vat, v_cr, p_payment_terms_days,
    v.status, p_reason, p_actor_id, p_decided_at
  );

  -- Fails 23505 on supplier_active_name_*_key if another active supplier has the name.
  update erp.supplier
     set name_en = v_name_en, name_ar = v_name_ar, vat_number = v_vat, cr_number = v_cr,
         payment_terms_days = p_payment_terms_days,
         as_of_decision_id = p_decision_id, updated_at = now()
   where supplier_id = v.supplier_id;
end;
$$;

-- Retire and reinstate. No delete route exists, and none can (erp.supplier_is_fixed()).
-- A supplier's supplies are left as they are: retiring the supplier stops new work
-- through erp.assert_supplier_active(), and reinstating it brings them back unchanged.
create or replace function erp.change_supplier_status(
  p_decision_id          uuid,
  p_supplier_id          uuid,
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
  v erp.supplier;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  if p_status is null or p_status not in ('active', 'retired') then
    raise exception 'a supplier is active or retired'
      using errcode = 'invalid_parameter_value', constraint = 'supplier_status_is_known';
  end if;
  -- FOR UPDATE conflicts with erp.assert_supplier_active()'s FOR SHARE.
  select * into v from erp.supplier s where s.supplier_id = p_supplier_id for update;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  if v.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'supplier % has changed since it was read', v.code
      using errcode = 'restrict_violation', constraint = 'supplier_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if v.status = p_status then
    raise exception 'supplier % is already %', v.code, p_status
      using errcode = 'restrict_violation', constraint = 'supplier_status_unchanged';
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supplier_status_changed', v.supplier_id, v.code, v.name_en, v.name_ar, v.vat_number, v.cr_number,
    v.payment_terms_days, p_status, p_reason, p_actor_id, p_decided_at
  );

  -- Reinstating fails 23505 on supplier_active_name_*_key if another active supplier has
  -- taken the name meanwhile.
  update erp.supplier
     set status = p_status, as_of_decision_id = p_decision_id, updated_at = now()
   where supplier_id = v.supplier_id;
end;
$$;

-- Contacts: the four erasable fields, whole, against the loaded stamp. Logged as a
-- decision that carries the business record and NO contact value (SEC-008). Allowed on a
-- retired supplier, because an erasure request does not wait for a reinstatement.
create or replace function erp.set_supplier_contact(
  p_decision_id          uuid,
  p_supplier_id          uuid,
  p_expected_decision_id uuid,
  p_contact_person       text,
  p_phone                text,
  p_email                text,
  p_address              text,
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
  v         erp.supplier;
  v_person  text := erp.normalise_label(p_contact_person);
  v_phone   text := erp.normalise_digits(p_phone);
  v_email   text := nullif(lower(btrim(p_email)), '');
  v_address text := nullif(btrim(p_address), '');
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  select * into v from erp.supplier s where s.supplier_id = p_supplier_id for update;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  if v.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'supplier % has changed since it was read', v.code
      using errcode = 'restrict_violation', constraint = 'supplier_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,15}$' then
    raise exception 'phone number is not valid: 6 to 15 digits, optionally after +'
      using errcode = 'check_violation', constraint = 'supplier_contacts_are_canonical';
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'email address is not valid'
      using errcode = 'check_violation', constraint = 'supplier_contacts_are_canonical';
  end if;
  if (v_person is not null and length(v_person) > 120) or (v_address is not null and length(v_address) > 500) then
    raise exception 'a contact name is at most 120 characters and an address 500'
      using errcode = 'check_violation', constraint = 'supplier_contacts_are_canonical';
  end if;

  if (v_person, v_phone, v_email, v_address) is not distinct from (v.contact_person, v.phone, v.email, v.address) then
    return;
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
    status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supplier_contact_changed', v.supplier_id, v.code, v.name_en, v.name_ar, v.vat_number, v.cr_number,
    v.payment_terms_days, v.status, p_reason, p_actor_id, p_decided_at
  );

  update erp.supplier
     set contact_person = v_person, phone = v_phone, email = v_email, address = v_address,
         as_of_decision_id = p_decision_id, updated_at = now()
   where supplier_id = v.supplier_id;
end;
$$;

-- What a supplier sells: one of an item's ACTIVE conversions. The supplier is locked
-- first, then the item (FOR SHARE, through erp.assert_item_active()), so a retirement of
-- either waits. The supply copies the conversion whole; the seam's foreign key proves
-- the copy.
create or replace function erp.add_supplier_item(
  p_decision_id      uuid,
  p_supplier_item_id uuid,
  p_supplier_id      uuid,
  p_item_unit_id     uuid,
  p_supplier_code    text,
  p_preferred        boolean,
  p_reason           text,
  p_actor_id         uuid,
  p_decided_at       timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  s      erp.supplier;
  u      erp.item_unit;
  v_code text := nullif(btrim(p_supplier_code), '');
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  select * into s from erp.supplier x where x.supplier_id = p_supplier_id for update;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  if s.status = 'retired' then
    raise exception 'supplier % is retired: reinstate it before changing it', s.code
      using errcode = 'restrict_violation', constraint = 'supplier_is_retired';
  end if;
  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if not found then
    raise exception 'no conversion %', p_item_unit_id using errcode = 'no_data_found', constraint = 'item_unit_exists';
  end if;
  perform erp.assert_item_active(u.item_id);
  -- Read again under the item's share lock: a conversion retired meanwhile is seen.
  select * into u from erp.item_unit x where x.item_unit_id = p_item_unit_id;
  if u.status <> 'active' then
    raise exception 'conversion % is retired: a supplier sells an active pack (I-7)', u.item_unit_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_conversion_is_active';
  end if;
  if p_preferred is null then
    raise exception 'say whether this is the item''s preferred supplier'
      using errcode = 'not_null_violation', constraint = 'supplier_item_preferred_is_stated';
  end if;
  if v_code is not null and length(v_code) > 64 then
    raise exception 'a supplier''s own code is at most 64 characters'
      using errcode = 'check_violation', constraint = 'supplier_item_code_is_canonical';
  end if;
  if exists (select 1 from erp.supplier_item x
              where x.supplier_id = s.supplier_id and x.item_unit_id = u.item_unit_id and x.status = 'active') then
    raise exception 'supplier % already sells this conversion; retire that supply first', s.code
      using errcode = 'unique_violation', constraint = 'supplier_item_one_active';
  end if;
  if p_preferred and exists (select 1 from erp.supplier_item x
                              where x.item_id = u.item_id and x.status = 'active' and x.preferred) then
    raise exception 'this item already has a preferred supplier; make that supply not preferred first'
      using errcode = 'unique_violation', constraint = 'supplier_item_one_preferred';
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, supplier_item_id, item_unit_id, item_id, unit_key, factor,
    supplier_code, preferred, status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supply_added', s.supplier_id, p_supplier_item_id, u.item_unit_id, u.item_id, u.unit_key, u.factor,
    v_code, p_preferred, 'active', p_reason, p_actor_id, p_decided_at
  );

  insert into erp.supplier_item (
    supplier_item_id, supplier_id, item_unit_id, item_id, unit_key, factor, supplier_code, preferred, status,
    as_of_decision_id
  ) values (
    p_supplier_item_id, s.supplier_id, u.item_unit_id, u.item_id, u.unit_key, u.factor, v_code, p_preferred, 'active',
    p_decision_id
  );
end;
$$;

-- The supplier's code and the preferred flag, whole, against the loaded stamp. Supplier
-- and conversion are not parameters.
create or replace function erp.amend_supplier_item(
  p_decision_id          uuid,
  p_supplier_item_id     uuid,
  p_expected_decision_id uuid,
  p_supplier_code        text,
  p_preferred            boolean,
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
  v_supplier_id uuid;
  s             erp.supplier;
  x             erp.supplier_item;
  v_code        text := nullif(btrim(p_supplier_code), '');
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  -- The supplier first, then the supply read after the lock: the order every supply
  -- route takes. supplier_id never changes (erp.supplier_item_is_fixed()).
  select y.supplier_id into v_supplier_id from erp.supplier_item y where y.supplier_item_id = p_supplier_item_id;
  if not found then
    raise exception 'no supply %', p_supplier_item_id using errcode = 'no_data_found', constraint = 'supplier_item_exists';
  end if;
  select * into s from erp.supplier y where y.supplier_id = v_supplier_id for update;
  select * into x from erp.supplier_item y where y.supplier_item_id = p_supplier_item_id for update;
  if x.as_of_decision_id is distinct from p_expected_decision_id then
    raise exception 'supply % has changed since it was read', x.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_stale',
            hint = 'Reload it and apply the change again.';
  end if;
  if s.status = 'retired' then
    raise exception 'supplier % is retired: reinstate it before changing it', s.code
      using errcode = 'restrict_violation', constraint = 'supplier_is_retired';
  end if;
  if x.status = 'retired' then
    raise exception 'supply % is retired for good; add a new one (I-6)', x.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_retirement_final';
  end if;
  if p_preferred is null then
    raise exception 'say whether this is the item''s preferred supplier'
      using errcode = 'not_null_violation', constraint = 'supplier_item_preferred_is_stated';
  end if;
  if v_code is not null and length(v_code) > 64 then
    raise exception 'a supplier''s own code is at most 64 characters'
      using errcode = 'check_violation', constraint = 'supplier_item_code_is_canonical';
  end if;

  if (v_code, p_preferred) is not distinct from (x.supplier_code, x.preferred) then
    return;
  end if;
  if p_preferred and not x.preferred and exists (
       select 1 from erp.supplier_item y
        where y.item_id = x.item_id and y.status = 'active' and y.preferred) then
    raise exception 'this item already has a preferred supplier; make that supply not preferred first'
      using errcode = 'unique_violation', constraint = 'supplier_item_one_preferred';
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, supplier_item_id, item_unit_id, item_id, unit_key, factor,
    supplier_code, preferred, status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supply_amended', x.supplier_id, x.supplier_item_id, x.item_unit_id, x.item_id, x.unit_key, x.factor,
    v_code, p_preferred, 'active', p_reason, p_actor_id, p_decided_at
  );

  update erp.supplier_item
     set supplier_code = v_code, preferred = p_preferred, as_of_decision_id = p_decision_id, updated_at = now()
   where supplier_item_id = x.supplier_item_id;
end;
$$;

-- Ends a supply for new work, for good. Allowed whatever the supplier's or the item's
-- status: tidying the supplies of a retired supplier is housekeeping, not new work.
create or replace function erp.retire_supplier_item(
  p_decision_id      uuid,
  p_supplier_item_id uuid,
  p_reason           text,
  p_actor_id         uuid,
  p_decided_at       timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_supplier_id uuid;
  x             erp.supplier_item;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'write', null);
  perform erp.assert_supplier_decision_is_new(p_decision_id);

  select y.supplier_id into v_supplier_id from erp.supplier_item y where y.supplier_item_id = p_supplier_item_id;
  if not found then
    raise exception 'no supply %', p_supplier_item_id using errcode = 'no_data_found', constraint = 'supplier_item_exists';
  end if;
  perform 1 from erp.supplier y where y.supplier_id = v_supplier_id for update;
  select * into x from erp.supplier_item y where y.supplier_item_id = p_supplier_item_id for update;
  if x.status = 'retired' then
    raise exception 'supply % is already retired', x.supplier_item_id
      using errcode = 'restrict_violation', constraint = 'supplier_item_already_retired';
  end if;

  insert into erp.supplier_decision (
    decision_id, kind, supplier_id, supplier_item_id, item_unit_id, item_id, unit_key, factor,
    supplier_code, preferred, status, reason, actor_id, decided_at
  ) values (
    p_decision_id, 'supply_retired', x.supplier_id, x.supplier_item_id, x.item_unit_id, x.item_id, x.unit_key, x.factor,
    x.supplier_code, x.preferred, 'retired', p_reason, p_actor_id, p_decided_at
  );

  update erp.supplier_item
     set status = 'retired', as_of_decision_id = p_decision_id, updated_at = now()
   where supplier_item_id = x.supplier_item_id;
end;
$$;

-- The warehouse's supplier upload (its import_master_data('suppliers', …)), made
-- all-or-nothing and matched by CODE rather than by lower(trim(name)). Each row runs in
-- its own subtransaction through the SAME routes the forms use. Any error refuses the
-- whole file, with up to 20 lines in DETAIL, as erp.import_items() does.
--
-- A row: line, code, name_en, name_ar, vat_number, cr_number, payment_terms_days,
-- contact_person, phone, email, address, and the ids its decisions would take:
-- decision_id, contact_decision_id, and supplier_id for a new supplier.
--
-- THE FILE WINS, as it did in the warehouse and as erp.import_items() does: a row that
-- differs from an existing supplier overwrites its business record, then its contacts,
-- and a blank cell clears a field. Whether that should instead be refused for a supplier
-- changed since export is the same question as ADR-0024's open question 8.
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
      -- A blank or non-numeric cell is an error on its line, not a silent 30.
      v_terms := (r.row ->> 'payment_terms_days')::integer;

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
            p_reason, p_actor_id, p_decided_at);
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
            p_reason, p_actor_id, p_decided_at);
        end if;
        v_created := v_created + 1;
      end if;
    exception when others then
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

-- ---------------------------------------------------------------------------
-- The gated reads — the runtime's only view of suppliers (CAP-P02, IAM-006)
-- ---------------------------------------------------------------------------

-- The supplier master is organisation data and is not filtered by facility: both brands
-- buy from the same suppliers until PRG-004 says otherwise. The facility is still the
-- caller's argument, checked by erp.assert_permitted(), so a branch role reads only where
-- it holds the permission. What a supplier SELLS is filtered by the facility's brand, as
-- items are (ADR-0012), so another brand's catalogue is not revealed through its
-- suppliers.

-- The supplies of one supplier, as jsonb, with the item's code and names, restricted to
-- a brand when one is given. Granted to nobody.
create or replace function erp.supplier_items_json(p_supplier_id uuid, p_brand_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'supplier_item_id', x.supplier_item_id, 'item_unit_id', x.item_unit_id, 'item_id', x.item_id,
           'item_code', i.code, 'item_name_en', i.name_en, 'item_name_ar', i.name_ar,
           'unit_key', x.unit_key, 'factor', x.factor, 'supplier_code', x.supplier_code,
           'preferred', x.preferred, 'status', x.status, 'as_of_decision_id', x.as_of_decision_id)
         order by x.status, i.code collate "C", x.unit_key, x.supplier_item_id), '[]'::jsonb)
  from erp.supplier_item x
  join erp.item i on i.item_id = x.item_id
  where x.supplier_id = p_supplier_id
    and (p_brand_id is null or i.brand_id = p_brand_id);
$$;

-- Keyset paging in C collation; at most 500 a page. Contacts are included: a person who
-- may read suppliers may ring one.
create or replace function erp.list_suppliers(
  p_actor_id    uuid,
  p_facility_id uuid    default null,
  p_status      text    default 'active',
  p_search      text    default null,
  p_after_code  text    default null,
  p_limit       integer default 100
)
returns table (
  supplier_id uuid, code text, name_en text, name_ar text, vat_number text, cr_number text,
  payment_terms_days integer, status text, contact_person text, phone text, email text, address text,
  as_of_decision_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_search text := erp.normalise_label(p_search);
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);

  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'a page holds 1 to 500 suppliers'
      using errcode = 'invalid_parameter_value', constraint = 'supplier_page_size';
  end if;
  if p_status is not null and p_status not in ('active', 'retired') then
    raise exception 'a supplier is active or retired'
      using errcode = 'invalid_parameter_value', constraint = 'supplier_status_is_known';
  end if;
  if p_facility_id is not null and not exists (select 1 from erp.facility f where f.facility_id = p_facility_id) then
    raise exception 'no facility %', p_facility_id using errcode = 'no_data_found', constraint = 'facility_exists';
  end if;

  return query
  select s.supplier_id, s.code, s.name_en, s.name_ar, s.vat_number, s.cr_number,
         s.payment_terms_days, s.status, s.contact_person, s.phone, s.email, s.address,
         s.as_of_decision_id
  from erp.supplier s
  where (p_status is null or s.status = p_status)
    and (p_after_code is null or s.code collate "C" > p_after_code collate "C")
    and (v_search is null
         or starts_with(s.code, erp.normalise_item_code(v_search))
         or strpos(lower(s.name_en), lower(v_search)) > 0
         or strpos(s.name_ar, v_search) > 0
         or s.vat_number = erp.normalise_digits(v_search))
  order by s.code collate "C"
  limit p_limit;
end;
$$;

-- One supplier, whatever its status, with its supplies at the facility's brand and the
-- stamp the edit forms send back.
create or replace function erp.get_supplier(p_actor_id uuid, p_facility_id uuid, p_supplier_id uuid)
returns table (
  supplier_id uuid, code text, name_en text, name_ar text, vat_number text, cr_number text,
  payment_terms_days integer, status text, contact_person text, phone text, email text, address text,
  as_of_decision_id uuid, supplies jsonb
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
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);

  return query
  select s.supplier_id, s.code, s.name_en, s.name_ar, s.vat_number, s.cr_number,
         s.payment_terms_days, s.status, s.contact_person, s.phone, s.email, s.address,
         s.as_of_decision_id, erp.supplier_items_json(s.supplier_id, v_brand)
  from erp.supplier s
  where s.supplier_id = p_supplier_id;
  if not found then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
end;
$$;

-- Every decision about the supplier and its supplies, in order (IAM-008). No contact
-- value is in any of them. Supplies of another brand's items are left out at a facility.
create or replace function erp.supplier_history(p_actor_id uuid, p_facility_id uuid, p_supplier_id uuid)
returns setof erp.supplier_decision
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_brand uuid;
begin
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.supplier s where s.supplier_id = p_supplier_id) then
    raise exception 'no supplier %', p_supplier_id using errcode = 'no_data_found', constraint = 'supplier_exists';
  end if;
  return query
  select d.* from erp.supplier_decision d
  where d.supplier_id = p_supplier_id
    and (d.item_id is null or v_brand is null
         or exists (select 1 from erp.item i where i.item_id = d.item_id and i.brand_id = v_brand))
  order by d.seq;
end;
$$;

-- Who sells an item, preferred first: what a purchase order form asks. Needs read on
-- BOTH capabilities, since it reveals an item and its suppliers; an item of another brand
-- answers exactly as a missing one.
create or replace function erp.item_suppliers(p_actor_id uuid, p_facility_id uuid, p_item_id uuid)
returns table (
  supplier_item_id uuid, supplier_id uuid, supplier_code text, supplier_name_en text, supplier_name_ar text,
  supplier_status text, item_unit_id uuid, unit_key text, factor numeric, their_code text, preferred boolean,
  status text, as_of_decision_id uuid
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
  perform erp.assert_permitted(p_actor_id, 'procurement.suppliers', 'read', p_facility_id);
  perform erp.assert_permitted(p_actor_id, 'inventory.items', 'read', p_facility_id);
  v_brand := erp.item_facility_brand(p_facility_id);
  if not exists (select 1 from erp.item i where i.item_id = p_item_id and (v_brand is null or i.brand_id = v_brand)) then
    raise exception 'no item %', p_item_id using errcode = 'no_data_found', constraint = 'item_exists';
  end if;

  return query
  select x.supplier_item_id, s.supplier_id, s.code, s.name_en, s.name_ar, s.status,
         x.item_unit_id, x.unit_key, x.factor, x.supplier_code, x.preferred, x.status, x.as_of_decision_id
  from erp.supplier_item x
  join erp.supplier s on s.supplier_id = x.supplier_id
  where x.item_id = p_item_id
  order by x.status, x.preferred desc, s.code collate "C", x.unit_key, x.supplier_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

-- As 0012: in the migration, because a real database needs it; no decision, so HIDDEN
-- everywhere until a later migration promotes it. MFG-012 is listed for CAP-P09.
insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('procurement.suppliers', 'Suppliers', 'الموردون',
   array['PRC-005', 'INV-005', 'MFG-012', 'PRG-014', 'SEC-008'], false, timestamptz '2026-10-04 00:00:00+00');

-- In the warehouse, suppliers were administrator-managed and read by the managers and the
-- accountant (its RLS "Admins can manage suppliers"). A real database's only role is the
-- administrator (0011), so these two rows are what lets anyone write a supplier once the
-- capability opens. The readers are the seed's business (0035).
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'procurement.suppliers', 'read'),
  ('administrator', 'procurement.suppliers', 'write');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the three tables: writes only through the routes, each
-- recording its decision; reads only through the gated functions. No EXECUTE on the
-- seams or helpers — later modules call them from their own definer routes.
grant execute on function
  erp.create_supplier(uuid, uuid, text, text, text, text, text, integer, text, uuid, timestamptz),
  erp.amend_supplier(uuid, uuid, uuid, text, text, text, text, integer, text, uuid, timestamptz),
  erp.change_supplier_status(uuid, uuid, uuid, text, text, uuid, timestamptz),
  erp.set_supplier_contact(uuid, uuid, uuid, text, text, text, text, text, uuid, timestamptz),
  erp.add_supplier_item(uuid, uuid, uuid, uuid, text, boolean, text, uuid, timestamptz),
  erp.amend_supplier_item(uuid, uuid, uuid, text, boolean, text, uuid, timestamptz),
  erp.retire_supplier_item(uuid, uuid, text, uuid, timestamptz),
  erp.import_suppliers(uuid, text, timestamptz, jsonb),
  erp.list_suppliers(uuid, uuid, text, text, text, integer),
  erp.get_supplier(uuid, uuid, uuid),
  erp.supplier_history(uuid, uuid, uuid),
  erp.item_suppliers(uuid, uuid, uuid)
to erp_app;

-- erp_read keeps 0002's default SELECT on all three tables, for reporting — contacts
-- included, as it reads erp.person's names. Erasure clears them at the source.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
do $$
declare
  t text;
begin
  foreach t in array array['supplier_decision', 'supplier', 'supplier_item'] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('alter table erp.%I force row level security', t);
    execute format('create policy erp_read_all on erp.%I for select to erp_read using (true)', t);
  end loop;
end
$$;
