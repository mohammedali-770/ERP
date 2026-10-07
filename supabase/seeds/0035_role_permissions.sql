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
--   * a branch worker may read stock and not write it. Open (pilot) but not granted —
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
  -- inventory.stock 'approve' (0020) is the override of negative stock (D1, ADR-0029).
  -- Who holds it is the owner's open question 2; until it is answered the seed gives it to
  -- the factory manager alone, which holds it only where assigned. So 0070's factory
  -- manager, scoped to FA-001, overrides there and nowhere else, and the warehouse
  -- manager — organisation-wide, writing stock but not approving — is the control in 150.
  ('factory_manager',   'inventory.stock',     'approve'),

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
  ('general_manager',   'org.facilities', 'read'),
  -- platform.notifications (0021). Everyone has a bell; 0021 gives the administrator one.
  -- What rings it is each notification's own rule (N2), not this grant: the accountant
  -- holds a bell that stock never rings, for they cannot read stock.
  ('branch_worker',     'platform.notifications', 'read'),
  ('warehouse_manager', 'platform.notifications', 'read'),
  ('factory_manager',   'platform.notifications', 'read'),
  ('general_manager',   'platform.notifications', 'read'),
  ('accountant',        'platform.notifications', 'read'),
  -- inventory.stock_alerts (0022). In the warehouse the administrator set minimums and the
  -- managers watched the low-stock lists. Here the two managers set them where they hold
  -- stock — the factory manager at FA-001 alone, by their scope — and the general manager
  -- reads them; 0022 grants the administrator. A branch worker, who reads stock, holds
  -- nothing here, so is never told stock is low: the control in 170.
  ('warehouse_manager', 'inventory.stock_alerts', 'read'),
  ('warehouse_manager', 'inventory.stock_alerts', 'write'),
  ('factory_manager',   'inventory.stock_alerts', 'read'),
  ('factory_manager',   'inventory.stock_alerts', 'write'),
  ('general_manager',   'inventory.stock_alerts', 'read'),
  -- procurement.purchase_orders and procurement.purchase_limits (0023). As in the warehouse,
  -- the warehouse manager raises and receives orders everywhere, the factory manager at
  -- FA-001 alone, by their scope. The general manager approved there, and holds approve
  -- here; but the test data has no general manager, and adding one would change who every
  -- stock bell rings for, so the accountant approves too (0080). Both read the limits, which
  -- only the administrator sets (0023 grants them). Nobody here both raises and approves, so
  -- self-approval (PRC-004) is the administrator's case in 180. A branch worker holds
  -- nothing here: the IAM-003 control.
  ('warehouse_manager', 'procurement.purchase_orders', 'read'),
  ('warehouse_manager', 'procurement.purchase_orders', 'write'),
  ('factory_manager',   'procurement.purchase_orders', 'read'),
  ('factory_manager',   'procurement.purchase_orders', 'write'),
  ('general_manager',   'procurement.purchase_orders', 'read'),
  ('general_manager',   'procurement.purchase_orders', 'approve'),
  ('general_manager',   'procurement.purchase_limits', 'read'),
  ('accountant',        'procurement.purchase_orders', 'read'),
  ('accountant',        'procurement.purchase_orders', 'approve'),
  ('accountant',        'procurement.purchase_limits', 'read');
