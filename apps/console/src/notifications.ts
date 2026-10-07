/**
 * The bell's logic (module 6, step 3), kept out of .tsx so test/notifications.test.ts can
 * read it.
 *
 * THE BELL IS NOT A MENU ENTRY. It sits in the top bar, beside the person's name, and is
 * shown where `platform.notifications` is not hidden and the person holds read on it, as
 * any entry would be (navigation.ts). What rings it is each kind's own rule in the
 * database (ADR-0030, N2), not this check: the accountant has a bell that stock never
 * rings.
 *
 * IT LISTS EVERY FACILITY'S. The routes return the person's notifications from every
 * facility they may still open, whichever one they are working at (ADR-0030 §6). The
 * stock screens read only the facility worked at (stock.ts), so a notification from
 * another facility is opened by switching to it first, and the shell asks before leaving
 * typed lines, as any switch does (leave.ts).
 *
 * IT ASKS, IT IS NOT TOLD, AND ONLY WHEN THE PERSON DOES SOMETHING. No push and no
 * Realtime (N1, ADR-0030 §8). The count is read when the shell opens, when the facility
 * changes, when the person moves to another screen, after they mark something read, and
 * when they come back to the tab. NEVER ON A TIMER: every request a session makes moves
 * its idle clock (0014, erp.resolve_session()), so a bell asking once a minute would keep
 * an unattended console signed in for good, past the 30 minutes idle that should end it
 * (found designing this step; ADR-0030 question 2).
 *
 * A LOW-STOCK NOTIFICATION (0022, module 7) opens as a below-zero one does: the stock
 * decision that took the item across, at the facility it happened at. Its items carry the
 * minimum they crossed, shown beside the balance left.
 *
 * Requirements: SUP-006 · SUP-007 · SUP-P01 · SUP-P02 · SUP-P03 · SUP-P04 · PRG-014
 */
import type { MarkRead, Notification, ViewerFacility } from './api.ts';
import { asKey, type Key } from './i18n.ts';
import { itemIsVisible, type NavItem, type Viewer } from './navigation.ts';
import type { Route } from './route.ts';

/** The bell's door: 0021's capability, asked as every route of the bell asks it. */
export const BELL: NavItem = {
  id: 'notifications', labelKey: 'notifications', capability: 'platform.notifications', action: 'read',
};

export function bellVisible(viewer: Viewer): boolean {
  return itemIsVisible(BELL, viewer);
}

/** 0021's page and mark limits (notification_page_size). */
export const MAX_MARK = 100;

/** The count on the bell: nothing at none, the number up to 99, then "99+". */
export function badge(unread: number): string {
  if (!Number.isInteger(unread) || unread <= 0) return '';
  return unread > 99 ? '99+' : String(unread);
}

/**
 * What to mark read: the ids named, or every unread one, said. An empty list is never
 * sent, since the edge and 0021 refuse it rather than read it as "all"; a list past 0021's
 * hundred is cut to its first hundred, the newest, which is what the person sees first.
 *
 * The page's "Mark all read" sends the ids it lists, never `all`: `all` would also mark
 * one that arrived after the page was loaded, which the person has not seen (found in
 * review). `all` stays in the client for a later caller that means it.
 */
export function markOf(ids: readonly string[] | 'all'): MarkRead | null {
  if (ids === 'all') return { all: true };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  return { notificationIds: unique.slice(0, MAX_MARK) };
}

/** The unread among a page, newest first, as markOf takes them. */
export function unreadIds(rows: readonly Notification[]): string[] {
  return rows.filter((n) => n.read_at === null).map((n) => n.notification_id);
}

/**
 * Where a notification opens:
 *   - `here`: the decision, at the facility worked at;
 *   - `switch`: the decision, after switching to the facility it happened at, which the
 *     person may work at;
 *   - `none`, `elsewhere`: it happened where the person may not work, and says so;
 *   - `none`, `unsupported`: a kind the console cannot open yet, which offers nothing.
 * The facility is the notification's, never one a URL names: a stock route reads only the
 * facility worked at (route.ts).
 */
export type Target =
  | { readonly kind: 'here'; readonly route: Route }
  | { readonly kind: 'switch'; readonly facility: ViewerFacility; readonly route: Route }
  | { readonly kind: 'none'; readonly reason: 'elsewhere' | 'unsupported' };

export function openTarget(n: Notification, workingAt: string | null, facilities: readonly ViewerFacility[]): Target {
  if (!STOCK_DECISION_KINDS.has(n.kind) || n.stock_decision_id === null) return { kind: 'none', reason: 'unsupported' };
  const route: Route = { screen: 'stock_decision', decisionId: n.stock_decision_id };
  if (n.facility_id === workingAt) return { kind: 'here', route };
  const facility = facilities.find((f) => f.facility_id === n.facility_id);
  return facility === undefined ? { kind: 'none', reason: 'elsewhere' } : { kind: 'switch', facility, route };
}

/** The kinds the console has words for; another kind is shown by its key, not hidden. */
export const NOTIFICATION_KINDS = ['stock_below_zero', 'stock_low'] as const;

/** The kinds about a stock decision, which open it (0021, 0022): both name one, by notification_names_its_source. */
const STOCK_DECISION_KINDS: ReadonlySet<string> = new Set(['stock_below_zero', 'stock_low']);

/**
 * The words for a kind, only for a kind the console knows: a kind named like another
 * string's tail (`unread`, `open_at`) must not borrow that string (found in review).
 */
export function kindKey(kind: string): Key | null {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind) ? asKey(`notif_${kind}`) : null;
}
