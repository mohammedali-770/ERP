/**
 * The console's routes, in the URL hash as the warehouse system kept them (#items), so a
 * page survives a reload and the back button works, with no server routing to configure.
 *
 * A route names a screen and, at most, the item it shows. It never carries a person, a
 * facility or a token: who is asking comes from the session, and where they are working
 * from the facility picker.
 */

export type Route =
  | { readonly screen: 'home' }
  | { readonly screen: 'items' }
  | { readonly screen: 'item_new' }
  | { readonly screen: 'item_import' }
  | { readonly screen: 'item'; readonly itemId: string }
  | { readonly screen: 'item_edit'; readonly itemId: string }
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
  if (path[0] !== 'items') return { screen: 'unknown', id: path.join('/') };
  if (path.length === 1) return { screen: 'items' };
  if (path.length === 2 && path[1] === 'new') return { screen: 'item_new' };
  if (path.length === 2 && path[1] === 'import') return { screen: 'item_import' };
  const id = path[1]!;
  if (!UUID.test(id)) return { screen: 'unknown', id: path.join('/') };
  if (path.length === 2) return { screen: 'item', itemId: id.toLowerCase() };
  if (path.length === 3 && path[2] === 'edit') return { screen: 'item_edit', itemId: id.toLowerCase() };
  return { screen: 'unknown', id: path.join('/') };
}

export function formatRoute(route: Route): string {
  switch (route.screen) {
    case 'home': return '#';
    case 'items': return '#items';
    case 'item_new': return '#items/new';
    case 'item_import': return '#items/import';
    case 'item': return `#items/${route.itemId}`;
    case 'item_edit': return `#items/${route.itemId}/edit`;
    case 'unknown': return `#${route.id}`;
  }
}

/** The menu entry a route belongs to, for marking it current. */
export function navIdOf(route: Route): string | null {
  return route.screen === 'home' || route.screen === 'unknown' ? null : 'items';
}
