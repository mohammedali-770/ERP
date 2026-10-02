import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAPABILITY_STATES,
  NAVIGATION,
  NO_VIEWER,
  itemIsVisible,
  itemIsWritable,
  visibleNavigation,
  type CapabilityState,
  type NavGroup,
  type NavItem,
  type Viewer,
} from '../src/navigation.ts';

const stock: NavItem = { id: 'current_stock', labelKey: 'current_stock', capability: 'inventory.stock', action: 'read' };
const payroll: NavItem = { id: 'payroll', labelKey: 'payroll', capability: 'hr.payroll', action: 'read' };

function viewer(
  states: Record<string, CapabilityState>,
  permissions: readonly string[],
  preview = false,
): Viewer {
  return { states: new Map(Object.entries(states)), permissions: new Set(permissions), preview };
}

// ---------------------------------------------------------------------------
// The two halves — neither implies the other
// ---------------------------------------------------------------------------

test('a hidden capability has no entry, whatever the viewer holds', () => {
  const v = viewer({ 'hr.payroll': 'hidden' }, ['hr.payroll:read', 'hr.payroll:write']);
  assert.equal(itemIsVisible(payroll, v), false);
});

test('a capability with no recorded state is hidden — default-deny, as CAP-P02 says', () => {
  const v = viewer({}, ['hr.payroll:read']);
  assert.equal(itemIsVisible(payroll, v), false);
});

test('an open capability grants nobody anything', () => {
  const v = viewer({ 'inventory.stock': 'enabled' }, []);
  assert.equal(itemIsVisible(stock, v), false);
});

test('open and granted is shown', () => {
  const v = viewer({ 'inventory.stock': 'enabled' }, ['inventory.stock:read']);
  assert.equal(itemIsVisible(stock, v), true);
});

// ---------------------------------------------------------------------------
// CAP-P06 — closing to new work does not hide history
// ---------------------------------------------------------------------------

for (const state of ['read_only', 'withdrawn'] as const) {
  test(`a ${state} capability stays visible and is not writable`, () => {
    const v = viewer({ 'inventory.stock': state }, ['inventory.stock:read', 'inventory.stock:write']);
    assert.equal(itemIsVisible(stock, v), true, 'its history must stay readable');
    assert.equal(itemIsWritable(stock, v), false, 'it must not admit new work');
  });
}

test('pilot admits new work, as erp.capability_admits_new_work() says', () => {
  const v = viewer({ 'inventory.stock': 'pilot' }, ['inventory.stock:read', 'inventory.stock:write']);
  assert.equal(itemIsWritable(stock, v), true);
});

test('writing needs the write permission, not only the read one', () => {
  const v = viewer({ 'inventory.stock': 'enabled' }, ['inventory.stock:read']);
  assert.equal(itemIsWritable(stock, v), false);
});

// ---------------------------------------------------------------------------
// CAP-P11 — a preview is read-only
// ---------------------------------------------------------------------------

test('a preview shows what the role would see and makes none of it writable', () => {
  // The warehouse system's "View as" ran actions with the administrator's rights.
  const v = viewer({ 'inventory.stock': 'enabled' }, ['inventory.stock:read', 'inventory.stock:write'], true);
  assert.equal(itemIsVisible(stock, v), true);
  assert.equal(itemIsWritable(stock, v), false);
});

// ---------------------------------------------------------------------------
// The menu as a whole
// ---------------------------------------------------------------------------

test('a group left empty is dropped, and order is kept', () => {
  const groups: NavGroup[] = [
    { labelKey: 'a', items: [payroll] },
    { labelKey: 'b', items: [stock] },
  ];
  const v = viewer({ 'inventory.stock': 'enabled', 'hr.payroll': 'hidden' }, ['inventory.stock:read', 'hr.payroll:read']);
  assert.deepEqual(visibleNavigation(groups, v).map((g) => g.labelKey), ['b']);
});

test('nobody signed in sees nothing at all', () => {
  assert.deepEqual(visibleNavigation(NAVIGATION, NO_VIEWER), []);
});

test('every item id is unique — it is also the URL hash', () => {
  const ids = NAVIGATION.flatMap((g) => g.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
});

// THE CONTROL. The same item, the same viewer, with the capability check bypassed:
// it IS returned. So the hidden-capability tests above fail if the check in
// itemIsVisible is deleted, rather than passing because the item was never going to
// appear for some other reason.
test('control: without the capability check, the hidden item would be shown', () => {
  const v = viewer({ 'hr.payroll': 'hidden' }, ['hr.payroll:read']);
  const permissionOnly = (item: NavItem): boolean => v.permissions.has(`${item.capability}:${item.action}`);
  assert.equal(permissionOnly(payroll), true, 'the viewer does hold the permission');
  assert.equal(itemIsVisible(payroll, v), false, 'and the capability check is what removes it');
});

// ---------------------------------------------------------------------------
// The vocabulary is written twice — here and in the database — so check it
// ---------------------------------------------------------------------------

test('CAPABILITY_STATES matches every check constraint in the registry migration', () => {
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20261001000100_capability_registry.sql', import.meta.url),
    'utf8',
  );
  const lists = [...migration.matchAll(/check \(state in \(([^)]*)\)\)/g)].map((m) =>
    m[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
  );
  // Two: the decision log and the projection. Fewer means the pattern stopped
  // matching, and an empty comparison would pass while checking nothing.
  assert.equal(lists.length, 2, 'expected the decision log and the projection to each declare the states');
  for (const list of lists) assert.deepEqual(list, [...CAPABILITY_STATES]);
});
