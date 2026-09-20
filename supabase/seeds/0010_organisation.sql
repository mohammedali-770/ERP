-- Synthetic organisation. SEC-012: no production data, masked or otherwise.
--
-- Identifiers are fixed UUIDv7-shaped constants, not generated, so `db reset`
-- produces an identical database every time (LAB-005) and a test can assert a
-- specific row rather than "some row".

insert into erp.company (company_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000001', 'FT', 'First Taste (synthetic)', 'الطعم الأول (بيانات تجريبية)');

insert into erp.legal_entity (legal_entity_id, company_id, code, name_en, name_ar, tax_number) values
  ('01936f00-0000-7000-8000-000000000101', '01936f00-0000-7000-8000-000000000001',
   'FT-LE1', 'First Taste Trading (synthetic)', 'شركة الطعم الأول التجارية (بيانات تجريبية)', '300000000000003');

insert into erp.brand (brand_id, legal_entity_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000201', '01936f00-0000-7000-8000-000000000101',
   'SPICY', 'Spicy Meal (synthetic)', 'سبايسي ميل (بيانات تجريبية)');

insert into erp.operating_unit (operating_unit_id, brand_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000301', '01936f00-0000-7000-8000-000000000201',
   'OU-CENTRAL', 'Central Region (synthetic)', 'المنطقة الوسطى (بيانات تجريبية)');

-- Two branches, because a single-branch seed hides every cross-branch bug.
insert into erp.facility (facility_id, operating_unit_id, facility_type, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000401', '01936f00-0000-7000-8000-000000000301',
   'branch', 'BR-001', 'Test Branch One', 'الفرع التجريبي الأول'),
  ('01936f00-0000-7000-8000-000000000402', '01936f00-0000-7000-8000-000000000301',
   'branch', 'BR-002', 'Test Branch Two', 'الفرع التجريبي الثاني');

insert into erp.department (department_id, facility_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000501', '01936f00-0000-7000-8000-000000000401',
   'FOH', 'Front of House', 'الصالة'),
  ('01936f00-0000-7000-8000-000000000502', '01936f00-0000-7000-8000-000000000401',
   'BOH', 'Kitchen', 'المطبخ');

insert into erp.cost_centre (cost_centre_id, department_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000601', '01936f00-0000-7000-8000-000000000501',
   'CC-FOH-01', 'Front of House Costs', 'تكاليف الصالة');

-- Every channel PRG-002 names, so channel-specific logic has something to fail on.
insert into erp.sales_channel (sales_channel_id, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000701', 'POS',        'Point of sale',   'نقطة البيع'),
  ('01936f00-0000-7000-8000-000000000702', 'APP',        'Customer app',    'تطبيق العميل'),
  ('01936f00-0000-7000-8000-000000000703', 'CALL',       'Call centre',     'مركز الاتصال'),
  ('01936f00-0000-7000-8000-000000000704', 'DELIVERY',   'Company delivery','التوصيل الخاص'),
  ('01936f00-0000-7000-8000-000000000705', 'AGGREGATOR', 'Delivery platform','منصة توصيل');

-- Three devices in one branch: the shape that makes device_seq gaps and
-- concurrent-shift conflicts reachable at all.
insert into erp.device (device_id, facility_id, device_type, code, name_en, name_ar) values
  ('01936f00-0000-7000-8000-000000000801', '01936f00-0000-7000-8000-000000000401', 'pos', 'POS-001', 'Till 1', 'الكاشير ١'),
  ('01936f00-0000-7000-8000-000000000802', '01936f00-0000-7000-8000-000000000401', 'pos', 'POS-002', 'Till 2', 'الكاشير ٢'),
  ('01936f00-0000-7000-8000-000000000803', '01936f00-0000-7000-8000-000000000401', 'printer', 'PRN-001', 'Kitchen printer', 'طابعة المطبخ');
