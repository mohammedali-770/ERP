-- 0003 · Organisation hierarchy
--
-- Requirements: PRG-002 · PRG-003 · PRG-014 · ADR-0012
--
-- PRG-002 names the full hierarchy; PRG-003 says operate one legal company
-- while preserving a model that admits more "without redesign". ADR-0012 is
-- blunter: every record that could ever be brand-scoped carries these
-- dimensions FROM THE FIRST MIGRATION, because retrofitting a dimension onto
-- populated tables is painful and carrying an unused one is nearly free.
--
-- Names are bilingual throughout (PRG-014).

-- No `set local search_path` here: migrations are applied outside a transaction
-- block, where SET LOCAL warns and does nothing. Every name below is
-- schema-qualified instead, which is what actually makes it unambiguous.

create table erp.company (
  company_id    uuid primary key,
  code          text not null unique,
  name_en       text not null,
  name_ar       text not null,
  created_at    timestamptz not null default now()
);

create table erp.legal_entity (
  legal_entity_id uuid primary key,
  company_id      uuid not null references erp.company (company_id),
  code            text not null unique,
  name_en         text not null,
  name_ar         text not null,
  tax_number      text,
  created_at      timestamptz not null default now()
);

create table erp.brand (
  brand_id        uuid primary key,
  legal_entity_id uuid not null references erp.legal_entity (legal_entity_id),
  code            text not null unique,
  name_en         text not null,
  name_ar         text not null,
  created_at      timestamptz not null default now()
);

create table erp.operating_unit (
  operating_unit_id uuid primary key,
  brand_id          uuid not null references erp.brand (brand_id),
  code              text not null unique,
  name_en           text not null,
  name_ar           text not null,
  created_at        timestamptz not null default now()
);

create table erp.facility (
  facility_id       uuid primary key,
  operating_unit_id uuid not null references erp.operating_unit (operating_unit_id),
  facility_type     text not null check (facility_type in ('branch','warehouse','factory','office')),
  code              text not null unique,
  name_en           text not null,
  name_ar           text not null,
  -- Set at shift open, never derived from calendar midnight (Q-06).
  tz_name           text not null default 'Asia/Riyadh',
  created_at        timestamptz not null default now()
);

create table erp.department (
  department_id uuid primary key,
  facility_id   uuid not null references erp.facility (facility_id),
  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  created_at    timestamptz not null default now(),
  unique (facility_id, code)
);

create table erp.cost_centre (
  cost_centre_id uuid primary key,
  department_id  uuid not null references erp.department (department_id),
  code           text not null,
  name_en        text not null,
  name_ar        text not null,
  created_at     timestamptz not null default now(),
  unique (department_id, code)
);

-- Orthogonal dimensions: they attach to records rather than nesting.
create table erp.sales_channel (
  sales_channel_id uuid primary key,
  code             text not null unique,
  name_en          text not null,
  name_ar          text not null,
  created_at       timestamptz not null default now()
);

create table erp.device (
  device_id     uuid primary key,
  facility_id   uuid not null references erp.facility (facility_id),
  device_type   text not null check (device_type in ('pos','printer','terminal','biometric')),
  code          text not null unique,
  name_en       text not null,
  name_ar       text not null,
  enrolled_at   timestamptz not null default now()
);

comment on table erp.device is
  'Enrolled devices. device_id is the identity that mints event_id and device_seq (ADR-0005, I-1).';

-- Reference data: the runtime reads it and does not write it.
grant select on
  erp.company, erp.legal_entity, erp.brand, erp.operating_unit,
  erp.facility, erp.department, erp.cost_centre, erp.sales_channel, erp.device
to erp_app;
