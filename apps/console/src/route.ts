/**
 * The console's routes, in the URL hash as the warehouse system kept them (#items), so a
 * page survives a reload and the back button works, with no server routing to configure.
 *
 * A route names a screen and, at most, the item, supplier or facility it shows. It never
 * carries a person or a token, and never where someone is working: who is asking comes
 * from the session, and where they are working from the facility picker. A facility in a
 * route is the one the page SHOWS, a different thing.
 */

export type Route =
  | { readonly screen: 'home' }
  | { readonly screen: 'items' }
  | { readonly screen: 'item_new' }
  | { readonly screen: 'item_import' }
  | { readonly screen: 'item'; readonly itemId: string }
  | { readonly screen: 'item_edit'; readonly itemId: string }
  | { readonly screen: 'suppliers' }
  | { readonly screen: 'supplier_new' }
  | { readonly screen: 'supplier_import' }
  | { readonly screen: 'supplier'; readonly supplierId: string }
  | { readonly screen: 'supplier_edit'; readonly supplierId: string }
  | { readonly screen: 'supplier_contact'; readonly supplierId: string }
  | { readonly screen: 'transfer_prices' }
  | { readonly screen: 'item_prices'; readonly itemId: string }
  | { readonly screen: 'facilities' }
  | { readonly screen: 'facility_new' }
  | { readonly screen: 'facility'; readonly targetId: string }
  | { readonly screen: 'facility_edit'; readonly targetId: string }
  | { readonly screen: 'current_stock' }
  | { readonly screen: 'stock_item'; readonly itemId: string }
  | { readonly screen: 'stock_decision'; readonly decisionId: string }
  | { readonly screen: 'stock_adjust' }
  | { readonly screen: 'stock_count' }
  | { readonly screen: 'unknown'; readonly id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(hash: string): Route {
  let path: string[];
  try {
    path = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    // A malformed escape (#%E0) threw out of the first render and blanked the console.
    return { screen: 'unknown', id: hash.replace(/^#/, '') };
  }
  if (path.length === 0) return { screen: 'home' };
  const unknown: Route = { screen: 'unknown', id: path.join('/') };
  if (path[0] === 'items') {
    if (path.length === 1) return { screen: 'items' };
    if (path.length === 2 && path[1] === 'new') return { screen: 'item_new' };
    if (path.length === 2 && path[1] === 'import') return { screen: 'item_import' };
    const id = path[1]!;
    if (!UUID.test(id)) return unknown;
    if (path.length === 2) return { screen: 'item', itemId: id.toLowerCase() };
    if (path.length === 3 && path[2] === 'edit') return { screen: 'item_edit', itemId: id.toLowerCase() };
    return unknown;
  }
  if (path[0] === 'suppliers') {
    if (path.length === 1) return { screen: 'suppliers' };
    if (path.length === 2 && path[1] === 'new') return { screen: 'supplier_new' };
    if (path.length === 2 && path[1] === 'import') return { screen: 'supplier_import' };
    const id = path[1]!;
    if (!UUID.test(id)) return unknown;
    if (path.length === 2) return { screen: 'supplier', supplierId: id.toLowerCase() };
    if (path.length === 3 && path[2] === 'edit') return { screen: 'supplier_edit', supplierId: id.toLowerCase() };
    if (path.length === 3 && path[2] === 'contact') return { screen: 'supplier_contact', supplierId: id.toLowerCase() };
    return unknown;
  }
  if (path[0] === 'facilities') {
    if (path.length === 1) return { screen: 'facilities' };
    if (path.length === 2 && path[1] === 'new') return { screen: 'facility_new' };
    const id = path[1]!;
    if (!UUID.test(id)) return unknown;
    if (path.length === 2) return { screen: 'facility', targetId: id.toLowerCase() };
    if (path.length === 3 && path[2] === 'edit') return { screen: 'facility_edit', targetId: id.toLowerCase() };
    return unknown;
  }
  // Stock is always the facility worked at's (ADR-0029 D4): no route names a facility.
  if (path[0] === 'current_stock') {
    if (path.length === 1) return { screen: 'current_stock' };
    if (path.length === 2 && path[1] === 'adjust') return { screen: 'stock_adjust' };
    if (path.length === 2 && path[1] === 'count') return { screen: 'stock_count' };
    const id = path[2];
    if (path.length !== 3 || id === undefined || !UUID.test(id)) return unknown;
    if (path[1] === 'items') return { screen: 'stock_item', itemId: id.toLowerCase() };
    if (path[1] === 'decisions') return { screen: 'stock_decision', decisionId: id.toLowerCase() };
    return unknown;
  }
  if (path[0] === 'transfer_prices') {
    if (path.length === 1) return { screen: 'transfer_prices' };
    const id = path[1]!;
    if (path.length === 2 && UUID.test(id)) return { screen: 'item_prices', itemId: id.toLowerCase() };
    return unknown;
  }
  return unknown;
}

export function formatRoute(route: Route): string {
  switch (route.screen) {
    case 'home': return '#';
    case 'items': return '#items';
    case 'item_new': return '#items/new';
    case 'item_import': return '#items/import';
    case 'item': return `#items/${route.itemId}`;
    case 'item_edit': return `#items/${route.itemId}/edit`;
    case 'suppliers': return '#suppliers';
    case 'supplier_new': return '#suppliers/new';
    case 'supplier_import': return '#suppliers/import';
    case 'supplier': return `#suppliers/${route.supplierId}`;
    case 'supplier_edit': return `#suppliers/${route.supplierId}/edit`;
    case 'supplier_contact': return `#suppliers/${route.supplierId}/contact`;
    case 'transfer_prices': return '#transfer_prices';
    case 'item_prices': return `#transfer_prices/${route.itemId}`;
    case 'facilities': return '#facilities';
    case 'facility_new': return '#facilities/new';
    case 'facility': return `#facilities/${route.targetId}`;
    case 'facility_edit': return `#facilities/${route.targetId}/edit`;
    case 'current_stock': return '#current_stock';
    case 'stock_item': return `#current_stock/items/${route.itemId}`;
    case 'stock_decision': return `#current_stock/decisions/${route.decisionId}`;
    case 'stock_adjust': return '#current_stock/adjust';
    case 'stock_count': return '#current_stock/count';
    case 'unknown': return `#${route.id}`;
  }
}

/** The menu entry a route belongs to, for marking it current. */
export function navIdOf(route: Route): string | null {
  if (route.screen === 'home' || route.screen === 'unknown') return null;
  if (route.screen === 'transfer_prices' || route.screen === 'item_prices') return 'transfer_prices';
  if (route.screen === 'facilities' || route.screen.startsWith('facility')) return 'facilities';
  if (route.screen === 'current_stock' || route.screen.startsWith('stock_')) return 'current_stock';
  return route.screen === 'suppliers' || route.screen === 'supplier' || route.screen.startsWith('supplier_')
    ? 'suppliers' : 'items';
}
