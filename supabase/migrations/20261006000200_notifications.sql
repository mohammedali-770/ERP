-- 0021 · Notifications — the in-app bell, and the first thing that rings it
--
-- Requirements: SUP-005 · SUP-006 · SUP-007 · INV-008 · INV-P02 · CAP-P02 · CAP-P04 · PRG-014
-- ADR-0029 (D1) · ADR-0030 (proposed)
--
-- Phase 4, module 6. The warehouse wrote one public.notifications row per recipient from
-- triggers on its orders, purchase orders and stock counters, and pushed each to the
-- recipient's phone through pg_net and a send-push function holding VAPID keys. Its
-- recipients were everyone holding a role, organisation-wide; its rows carried branch and
-- item names; and it kept every row for good. Written fresh here.
--
-- The owner's decisions of 2026-10-06 (ADR-0030):
--   N1  the in-app bell only. No push subscription, no push function, no keys: sending a
--       push, or choosing who receives one, is owner-approved (CLAUDE.md §4), and SUP-006's
--       other channels arrive as their own approved steps.
--   N2  a notification goes to whoever can open what it is about, at the facility it
--       happened at, decided when it happens; and it is shown only while they still can.
--       Nobody is told of something they could not open (SUP-007).
--   N3  kept 90 days, then deleted. A notification is a message about a record, not the
--       record: the stock decision keeps its own history for good.
--   N4  the mechanism, and one producer: stock taken below zero by an override (D1) tells
--       that facility's readers of stock. Later modules add their own kinds.
--
-- WHAT A ROW HOLDS: ids and quantities, never names or free text. Codes and names are read
-- at the moment of reading, through the reader's own access; the override's reason, which
-- may name a person (ADR-0029 question 9), is left on the decision. So a notification
-- discloses nothing its link would not (SUP-007).
--
-- READ STATE IS PERSONAL, and the one thing that changes: read_at goes from empty to a
-- moment, once. Nothing else about a row changes, and none is deleted before 90 days;
-- triggers hold both, the owner included, as they hold every other record here.
--
-- The capability ships HIDDEN, as every module's does: registered here with no decision, so
-- no real database shows a bell until a later migration promotes it.

-- No `set local search_path` here: migrations are applied outside a transaction block.
-- Every name below is schema-qualified instead.

-- ---------------------------------------------------------------------------
-- The notification (SUP-005, SUP-007)
-- ---------------------------------------------------------------------------

create table erp.notification (
  notification_id   uuid        primary key default gen_random_uuid(),
  kind              text        not null
    constraint notification_kind_is_known check (kind in ('stock_below_zero')),
  recipient_id      uuid        not null references erp.person (person_id),
  facility_id       uuid        not null references erp.facility (facility_id),
  -- What it is about: one column per source log, so each is a real foreign key, and a kind
  -- names exactly one. A later module adds its column and its kind together.
  stock_decision_id uuid                 references erp.stock_decision (decision_id),
  -- Ids and quantities only (see the header). For stock_below_zero:
  --   {"items": [{"item_id": uuid, "on_hand": "-10"}, …]}, the balances left below zero.
  data              jsonb       not null default '{}'::jsonb
    constraint notification_data_is_an_object check (jsonb_typeof(data) = 'object'),
  created_at        timestamptz not null default now(),
  read_at           timestamptz,
  constraint notification_names_its_source
    check ((kind = 'stock_below_zero') = (stock_decision_id is not null)),
  constraint notification_read_after_it_was_made
    check (read_at is null or read_at >= created_at),
  -- One per person per thing it is about: a producer that runs twice tells nobody twice.
  constraint notification_once_per_person unique (recipient_id, kind, stock_decision_id)
);

create index notification_recipient_newest on erp.notification (recipient_id, created_at desc, notification_id desc);
create index notification_by_age on erp.notification (created_at);

comment on table erp.notification is
  'SUP-005/SUP-007. One row per recipient. Ids and quantities only; read once; deleted at 90 days (ADR-0030).';

-- Read once; deleted only past 90 days; never truncated. Binds the owner too.
create or replace function erp.notification_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'notifications are never truncated: past 90 days they are deleted, one by one'
      using errcode = 'restrict_violation';
  elsif tg_op = 'UPDATE' then
    if old.read_at is not null or new.read_at is null
       or (new.notification_id, new.kind, new.recipient_id, new.facility_id, new.stock_decision_id, new.data, new.created_at)
          is distinct from
          (old.notification_id, old.kind, old.recipient_id, old.facility_id, old.stock_decision_id, old.data, old.created_at) then
      raise exception 'a notification changes once, from unread to read, and in nothing else'
        using errcode = 'restrict_violation', constraint = 'notification_is_read_once';
    end if;
    return new;
  else
    if old.created_at > now() - interval '90 days' then
      raise exception 'a notification is kept 90 days (ADR-0030, N3)'
        using errcode = 'restrict_violation', constraint = 'notification_is_kept_90_days';
    end if;
    return old;
  end if;
end;
$$;

create trigger notification_is_read_once_and_kept
  before update or delete on erp.notification
  for each row execute function erp.notification_guard();
create trigger notifications_are_never_truncated
  before truncate on erp.notification
  for each statement execute function erp.notification_guard();

-- ---------------------------------------------------------------------------
-- Who may open it (N2)
-- ---------------------------------------------------------------------------

-- Whether a person may open what a notification of this kind is about, at this facility,
-- now: the same two reads 0020's stock routes ask, capability state and grant alike. Asked
-- when a notification is made, to choose its recipients, and again whenever it is read,
-- so one whose access has gone is no longer shown it.
create or replace function erp.notification_is_open_to(p_person_id uuid, p_kind text, p_facility_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case p_kind
    when 'stock_below_zero' then
          erp.capability_state_for('inventory.stock', p_facility_id) <> 'hidden'
      and erp.capability_state_for('inventory.items', p_facility_id) <> 'hidden'
      and erp.permission_granted(p_person_id, 'inventory.stock', 'read', p_facility_id)
      and erp.permission_granted(p_person_id, 'inventory.items', 'read', p_facility_id)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- The first producer (N4): stock taken below zero by an override (D1)
-- ---------------------------------------------------------------------------

-- 0020 stores an override's reason only when a movement does take an item below zero, so a
-- stock decision with one is exactly the event. The trigger is DEFERRED to commit: the
-- decision row is written first and its entries and balances after it (0020, step 7), and
-- what to tell is which balances the decision left below zero. The person who overrode is
-- not told of their own act.
create or replace function erp.notify_stock_below_zero()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_items jsonb;
begin
  select jsonb_agg(jsonb_build_object('item_id', b.item_id, 'on_hand', trim_scale(b.on_hand)::text)
                   order by i.code collate "C")
    into v_items
    from (select distinct e.item_id from erp.stock_ledger e where e.decision_id = new.decision_id) x
    join erp.stock_balance b on b.facility_id = new.facility_id and b.item_id = x.item_id
    join erp.item i on i.item_id = x.item_id
   where b.on_hand < 0;
  if v_items is null then
    return null;
  end if;

  insert into erp.notification (kind, recipient_id, facility_id, stock_decision_id, data)
  select 'stock_below_zero', p.person_id, new.facility_id, new.decision_id, jsonb_build_object('items', v_items)
    from erp.person p
   where p.status = 'active'
     and p.person_id <> new.actor_id
     and erp.notification_is_open_to(p.person_id, 'stock_below_zero', new.facility_id)
  on conflict on constraint notification_once_per_person do nothing;
  return null;
end;
$$;

create constraint trigger stock_below_zero_is_notified
  after insert on erp.stock_decision
  deferrable initially deferred
  for each row
  when (new.override_reason is not null)
  execute function erp.notify_stock_below_zero();

-- ---------------------------------------------------------------------------
-- The bell's routes (SUP-006) — the person reads, counts and marks their own
-- ---------------------------------------------------------------------------

-- The bell asks at the facility the person is working at, as every read does. Marking read
-- is asked as 'read' too: it changes nothing anyone else sees, and only the reader's own
-- rows. What is returned is the reader's own, younger than 90 days, and still open to them.

-- The latest first, paged by (created_at, notification_id). Codes and names are read now.
create or replace function erp.list_notifications(
  p_actor_id    uuid,
  p_facility_id uuid,
  p_before_at   timestamptz default null,
  p_before_id   uuid        default null,
  p_limit       integer     default 30
)
returns table (
  notification_id uuid, kind text, facility_id uuid, facility_code text, stock_decision_id uuid,
  created_at timestamptz, read_at timestamptz, items jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
begin
  perform erp.assert_permitted(p_actor_id, 'platform.notifications', 'read', p_facility_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'a page holds 1 to 100 notifications'
      using errcode = 'invalid_parameter_value', constraint = 'notification_page_size';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'a page ends before a moment and an id, both or neither'
      using errcode = 'invalid_parameter_value', constraint = 'notification_page_size';
  end if;

  return query
  select n.notification_id, n.kind, n.facility_id, f.code::text, n.stock_decision_id, n.created_at, n.read_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'item_id', i.item_id, 'code', i.code, 'name_en', i.name_en, 'name_ar', i.name_ar,
                    'base_unit_key', i.base_unit_key, 'on_hand', x.value ->> 'on_hand')
                  order by x.ordinality)
             from jsonb_array_elements(n.data -> 'items') with ordinality as x(value, ordinality)
             join erp.item i on i.item_id = (x.value ->> 'item_id')::uuid), '[]'::jsonb)
    from erp.notification n
    join erp.facility f on f.facility_id = n.facility_id
   where n.recipient_id = p_actor_id
     and n.created_at > now() - interval '90 days'
     and (p_before_at is null or (n.created_at, n.notification_id) < (p_before_at, p_before_id))
     and erp.notification_is_open_to(p_actor_id, n.kind, n.facility_id)
   order by n.created_at desc, n.notification_id desc
   limit p_limit;
end;
$$;

create or replace function erp.count_unread_notifications(p_actor_id uuid, p_facility_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  perform erp.assert_permitted(p_actor_id, 'platform.notifications', 'read', p_facility_id);
  return (
    select count(*)::integer
      from erp.notification n
     where n.recipient_id = p_actor_id
       and n.read_at is null
       and n.created_at > now() - interval '90 days'
       and erp.notification_is_open_to(p_actor_id, n.kind, n.facility_id));
end;
$$;

-- Marks the reader's own unread notifications read: those listed, or every one when the
-- list is null. Answers how many it marked. Marking one already read marks nothing, and is
-- no error: a second tab, or a retry, asks the same.
create or replace function erp.mark_notifications_read(p_actor_id uuid, p_facility_id uuid, p_notification_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_marked integer;
begin
  perform erp.assert_permitted(p_actor_id, 'platform.notifications', 'read', p_facility_id);
  if p_notification_ids is not null and cardinality(p_notification_ids) not between 1 and 100 then
    raise exception 'mark 1 to 100 notifications, or all of them'
      using errcode = 'invalid_parameter_value', constraint = 'notification_page_size';
  end if;
  update erp.notification n
     set read_at = greatest(now(), n.created_at)
   where n.recipient_id = p_actor_id
     and n.read_at is null
     and n.created_at > now() - interval '90 days'
     and (p_notification_ids is null or n.notification_id = any (p_notification_ids))
     and erp.notification_is_open_to(p_actor_id, n.kind, n.facility_id);
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;

-- N3: deletes what is past 90 days. Owner-only, never the runtime's: a scheduled job runs it
-- in a hosted project, which is owner-approved configuration (CLAUDE.md §4, ADR-0030's
-- open question). Until it runs, the routes above already show nothing older.
create or replace function erp.purge_notifications()
returns integer
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from erp.notification n where n.created_at <= now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- The capability (CAP-P01) — registered here, and hidden
-- ---------------------------------------------------------------------------

insert into erp.capability (capability_key, name_en, name_ar, requirement_refs, protected, created_at) values
  ('platform.notifications', 'Notifications', 'الإشعارات',
   array['SUP-005', 'SUP-006', 'SUP-007', 'PRG-014'], false,
   timestamptz '2026-10-06 00:00:00+00');

-- A real database's only role is the administrator (0011); who else holds the bell is the
-- seed's business (0035). Reading is all the bell asks.
insert into erp.role_permission (role_key, capability_key, action) values
  ('administrator', 'platform.notifications', 'read');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- 0011's finding: every migration that adds a function revokes PUBLIC's EXECUTE.
revoke execute on all functions in schema erp from public;

-- erp_app gets no privilege on the table: only the three routes. Not the producer, the
-- guard, the rule or the purge.
grant execute on function
  erp.list_notifications(uuid, uuid, timestamptz, uuid, integer),
  erp.count_unread_notifications(uuid, uuid),
  erp.mark_notifications_read(uuid, uuid, uuid[])
to erp_app;

-- erp_read keeps 0002's default SELECT, for reporting.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Policies mirror grants and never widen them (0008's rule): erp_app has no grant here.
alter table erp.notification enable row level security;
alter table erp.notification force row level security;
create policy erp_read_all on erp.notification for select to erp_read using (true);
