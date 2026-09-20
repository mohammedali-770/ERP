-- pgTAP · the seed is synthetic and complete
--
-- SEC-012 forbids production data in development or testing without approved
-- masking. This seed masks nothing because nothing in it is real, and that
-- claim is checked rather than asserted.

begin;
select plan(8);

select isnt_empty($$ select 1 from erp.company $$,  'the seed loaded an organisation');
select isnt_empty($$ select 1 from erp.orders $$,   'the seed loaded orders');
select isnt_empty($$ select 1 from erp.event_log $$,'the seed loaded events');

select is_empty(
  $$ select 1 from erp.event_log
     where payload::text ~ '\+?9665[0-9]{8}'
       and substring(payload::text from '(\+?9665[0-9]{8})') !~ '^\+?9665[0-9]{2}00000' $$,
  'no Saudi mobile number outside the synthetic block'
);

select is_empty(
  $$ select 1 from erp.event_log where payload::text ~ '(SA[0-9]{22}|\m[0-9]{13,19}\M)' $$,
  'no IBAN or card-shaped number in any payload'
);

-- LAB-005 names the awkward cases. These assert the seed actually contains them,
-- because a seed that quietly loses its hard cases stops being a regression base.
select isnt_empty(
  $$ select 1 from erp.orders o
     where o.business_date = date '2026-09-19'
       and o.opened_at >= timestamptz '2026-09-20 00:00:00+03' $$,
  'an order that crosses midnight relative to its business_date'
);

select is(
  (select count(*)::int from erp.payment_intents where order_id = '01936f00-0000-7000-8000-000000002003'),
  2, 'a split tender — two intents on one order'
);

select isnt_empty(
  $$ select 1 from erp.event_log
     where payload ? 'modifiers' and payload::text like '%"min"%' and payload::text like '%"max"%' $$,
  'a modifier group carrying a minimum and a maximum'
);

select * from finish();
rollback;
