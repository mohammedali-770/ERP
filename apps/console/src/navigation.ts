/**
 * The console's navigation, driven by capability state and permission.
 *
 * Plain TypeScript on purpose, not .tsx — Node cannot load .tsx at all (see
 * shell.ts), so this is the only form in which `npm test` can exercise it. The
 * .tsx side attaches icons and screens through the `P` payload without this file
 * importing React.
 *
 * THIS IS NOT A CONTROL. It decides what the menu shows, and nothing else. Every
 * rule here mirrors `erp.assert_permitted()` in
 * supabase/migrations/20261002000100_identity.sql, and the database refuses
 * regardless of what any menu shows — CAP-P04: "the removal of a menu entry or a
 * screen shall never be the only control". supabase/tests/070_identity_test.sql is
 * where that refusal is proved. A bug here can show a user a door; it cannot open
 * one.
 *
 * Shape, carried from the warehouse system's src/navigation.tsx: groups of items,
 * each with an id and a translation key. What changes is the key. The warehouse
 * keyed its menu by role — `Record<role, NavGroup[]>`, 59 entries over 33 pages,
 * the same page written out under several roles. Here there is one list, and each
 * item names the capability and action it needs. A role is just a set of
 * permissions, so the per-role copies disappear.
 *
 * Requirements: CAP-P02 · CAP-P04 · CAP-P06 · CAP-P11 · IAM-003 · IAM-004
 */

/**
 * The capability states, in the order 0010 declares them. The database's
 * `check (state in (…))` is the authority; test/navigation.test.ts reads the
 * migration and fails if this list drifts from it.
 */
export const CAPABILITY_STATES = ['hidden', 'pilot', 'enabled', 'read_only', 'withdrawn'] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export type Action = 'read' | 'write' | 'approve';

export interface NavItem<P = unknown> {
  /** Unique across the console; also the URL hash, as in the warehouse system. */
  readonly id: string;
  /** Translation key for the label. */
  readonly labelKey: string;
  /** The capability this screen belongs to. */
  readonly capability: string;
  /** The action needed to see the screen at all. Usually 'read'. */
  readonly action: Action;
  /**
   * Other capabilities the screen reads, each needing read too. A route that asks for
   * read on two capabilities is a door only someone holding both can open, so the entry
   * is shown only to them: shown on one alone, it led to "forbidden" (found in review).
   */
  readonly alsoReads?: readonly string[];
  /** Whatever the rendering side needs — an icon, a screen. Never inspected here. */
  readonly payload?: P;
}

export interface NavGroup<P = unknown> {
  readonly labelKey: string;
  readonly items: readonly NavItem<P>[];
}

/** What the menu is computed from. */
export interface Viewer {
  /** Resolved state per capability key. An absent key is hidden (CAP-P02). */
  readonly states: ReadonlyMap<string, CapabilityState>;
  /** Granted permissions, as `capability:action`. */
  readonly permissions: ReadonlySet<string>;
  /**
   * True when an administrator is previewing the console as a role (CAP-P11).
   * The warehouse system's "View as" was screen-only and actions ran with admin
   * rights (src/contexts/AuthContext.tsx:42-43); a preview here is read-only.
   */
  readonly preview: boolean;
}

/** Default-deny, as erp.capability_state_for() is: no recorded state is hidden. */
export function stateOf(viewer: Viewer, capability: string): CapabilityState {
  return viewer.states.get(capability) ?? 'hidden';
}

export function holds(viewer: Viewer, capability: string, action: Action): boolean {
  return viewer.permissions.has(`${capability}:${action}`);
}

/**
 * Whether an item appears. A hidden capability never appears, whatever the viewer
 * holds. read_only and withdrawn DO appear: CAP-P06 says their history stays
 * readable, and hiding it would be the same control that stops new work doing a
 * second job it must not do.
 */
export function itemIsVisible(item: NavItem, viewer: Viewer): boolean {
  return stateOf(viewer, item.capability) !== 'hidden' && holds(viewer, item.capability, item.action)
    && (item.alsoReads ?? []).every((c) => stateOf(viewer, c) !== 'hidden' && holds(viewer, c, 'read'));
}

/**
 * Whether an item may start new work: the capability admits it (enabled or pilot,
 * as erp.capability_admits_new_work() says), the viewer holds write, and this is
 * not a preview.
 */
export function itemIsWritable(item: NavItem, viewer: Viewer): boolean {
  if (viewer.preview) return false;
  const state = stateOf(viewer, item.capability);
  return (state === 'enabled' || state === 'pilot') && holds(viewer, item.capability, 'write');
}

/** The menu: invisible items removed, then groups left empty removed. */
export function visibleNavigation<P>(groups: readonly NavGroup<P>[], viewer: Viewer): NavGroup<P>[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => itemIsVisible(item, viewer)) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The capabilities the console knows about, as registered by 0010, 0011, 0012, 0016, 0018,
 * 0019, 0020, 0022 and 0023. The screens arrive in Phase 4, module by module, each behind its
 * capability: items (module 1), suppliers (module 2), transfer prices (module 3), facilities
 * (module 4), stock (module 5), stock alerts (module 7) and purchase orders (module 8) have screens; the rest are entries with nothing
 * behind them yet, and stay hidden until their capability is recorded open.
 */
export const NAVIGATION: readonly NavGroup[] = [
  {
    labelKey: 'nav_setup',
    items: [
      { id: 'capabilities', labelKey: 'capabilities', capability: 'platform.capability_admin', action: 'read' },
      { id: 'users', labelKey: 'users', capability: 'platform.identity_admin', action: 'read' },
      { id: 'facilities', labelKey: 'facilities', capability: 'org.facilities', action: 'read' },
    ],
  },
  {
    labelKey: 'nav_inventory',
    items: [
      { id: 'items', labelKey: 'items', capability: 'inventory.items', action: 'read' },
      // Every 0018 read asks for read on items too: a price names an item.
      { id: 'transfer_prices', labelKey: 'transfer_prices', capability: 'inventory.transfer_prices', action: 'read', alsoReads: ['inventory.items'] },
      // Every 0020 read asks for read on items too: a balance names an item.
      { id: 'current_stock', labelKey: 'current_stock', capability: 'inventory.stock', action: 'read', alsoReads: ['inventory.items'] },
      // Every 0022 read asks for read on stock and items too: a minimum stands beside stock on hand.
      { id: 'stock_alerts', labelKey: 'stock_alerts', capability: 'inventory.stock_alerts', action: 'read', alsoReads: ['inventory.stock', 'inventory.items'] },
    ],
  },
  {
    labelKey: 'nav_purchasing',
    items: [
      { id: 'suppliers', labelKey: 'suppliers', capability: 'procurement.suppliers', action: 'read' },
      // Every 0023 order read asks for read on suppliers and items too: an order names both.
      { id: 'purchase_orders', labelKey: 'purchase_orders', capability: 'procurement.purchase_orders', action: 'read', alsoReads: ['procurement.suppliers', 'inventory.items'] },
      // Its own entry: 0023's limit read asks for limits alone, and a limit-setter need not read orders.
      { id: 'purchase_limits', labelKey: 'purchase_limits', capability: 'procurement.purchase_limits', action: 'read' },
    ],
  },
  {
    labelKey: 'nav_factory',
    items: [{ id: 'production', labelKey: 'production', capability: 'factory.production', action: 'read' }],
  },
  {
    labelKey: 'nav_finance',
    items: [
      { id: 'month_end', labelKey: 'month_end', capability: 'finance.month_close', action: 'read' },
      { id: 'payroll', labelKey: 'payroll', capability: 'hr.payroll', action: 'read' },
    ],
  },
];

/** Nobody signed in: nothing recorded, nothing granted. Everything resolves hidden. */
export const NO_VIEWER: Viewer = { states: new Map(), permissions: new Set(), preview: false };
