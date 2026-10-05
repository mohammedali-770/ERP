-- Synthetic role permissions (IAM-003). SEC-012: no production data.
--
-- After 0030 because every row names a capability 0030 seeds. The administrator's
-- permissions on the two protected platform capabilities are not here: 0011 creates
-- those, because a real database needs them as much as this one does.
--
-- Chosen so the interesting combinations exist, not to be a realistic permission
-- model — that is configuration an administrator owns:
--
--   * the accountant holds payroll read AND write, on a payroll capability nobody has
--     opened (0030 records no decision for it). Granted but hidden, so the database
--     must refuse it — the left half of the rule, tested in 070.
--   * a branch worker may read stock and not write it. Enabled but not granted —
--     the right half.
--   * month close is read_only, so the accountant may read its history and may not
--     start new work in it (CAP-P06).

insert into erp.role_permission (role_key, capability_key, action) values
  ('branch_worker',     'inventory.stock',     'read'),

  ('warehouse_manager', 'inventory.stock',     'read'),
  ('warehouse_manager', 'inventory.stock',     'write'),
  ('warehouse_manager', 'factory.production',  'read'),

  ('factory_manager',   'factory.production',  'read'),
  ('factory_manager',   'factory.production',  'write'),
  ('factory_manager',   'inventory.stock',     'read'),
  ('factory_manager',   'inventory.stock',     'write'),

  ('general_manager',   'inventory.stock',     'read'),
  ('general_manager',   'factory.production',  'read'),
  ('general_manager',   'factory.production',  'approve'),
  ('general_manager',   'finance.month_close', 'read'),

  ('accountant',        'finance.month_close', 'read'),
  ('accountant',        'finance.month_close', 'write'),
  ('accountant',        'hr.payroll',          'read'),
  ('accountant',        'hr.payroll',          'write'),

  -- inventory.items (0012). Every role reads the item master; only the administrator
  -- writes it, which 0012 grants in the migration. So the warehouse manager — org-wide,
  -- read only — is the IAM-003 control in 080.
  ('branch_worker',     'inventory.items',     'read'),
  ('warehouse_manager', 'inventory.items',     'read'),
  ('factory_manager',   'inventory.items',     'read'),
  ('general_manager',   'inventory.items',     'read'),
  ('accountant',        'inventory.items',     'read'),

  -- procurement.suppliers (0016). The managers and the accountant read suppliers, as
  -- they did in the warehouse; only the administrator writes, which 0016 grants. A
  -- branch worker holds nothing here: the IAM-003 control in 110.
  ('warehouse_manager', 'procurement.suppliers', 'read'),
  ('factory_manager',   'procurement.suppliers', 'read'),
  ('general_manager',   'procurement.suppliers', 'read'),
  ('accountant',        'procurement.suppliers', 'read'),

  -- inventory.transfer_prices (0018). In the warehouse the accountant set prices beside
  -- the administrator (set_item_unit_price()), and a branch saw the price it was charged.
  -- So the accountant writes, the managers and branch workers read; 0018 grants the
  -- administrator. The warehouse manager — org-wide, read only — is the IAM-003 control.
  ('accountant',        'inventory.transfer_prices', 'read'),
  ('accountant',        'inventory.transfer_prices', 'write'),
  ('branch_worker',     'inventory.transfer_prices', 'read'),
  ('warehouse_manager', 'inventory.transfer_prices', 'read'),
  ('factory_manager',   'inventory.transfer_prices', 'read'),
  ('general_manager',   'inventory.transfer_prices', 'read'),
  -- org.facilities (0019). Branches were the administrator's to edit in the warehouse,
  -- and 0019 gives the administrator write. The managers read where branches are and
  -- what areas they have; a branch worker needs neither, so reads nothing here.
  ('warehouse_manager', 'org.facilities', 'read'),
  ('factory_manager',   'org.facilities', 'read'),
  ('general_manager',   'org.facilities', 'read');
