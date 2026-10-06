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
 * Requirements: SUP-006 · SUP-007 · SUP-P01 · SUP-P02 · SUP-P03 · PRG-014
 */
import type { MarkRead, Notification, ViewerFacility } from './api.ts';
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
 *   - `none`: nowhere the person may work, or a kind the console cannot open yet.
 * The facility is the notification's, never one a URL names: a stock route reads only the
 * facility worked at (route.ts).
 */
export type Target =
  | { readonly kind: 'here'; readonly route: Route }
  | { readonly kind: 'switch'; readonly facility: ViewerFacility; readonly route: Route }
  | { readonly kind: 'none' };

export function openTarget(n: Notification, workingAt: string | null, facilities: readonly ViewerFacility[]): Target {
  if (n.kind !== 'stock_below_zero' || n.stock_decision_id === null) return { kind: 'none' };
  const route: Route = { screen: 'stock_decision', decisionId: n.stock_decision_id };
  if (n.facility_id === workingAt) return { kind: 'here', route };
  const facility = facilities.find((f) => f.facility_id === n.facility_id);
  return facility === undefined ? { kind: 'none' } : { kind: 'switch', facility, route };
}

/** The kinds the console has words for; another kind is shown by its key, not hidden. */
export const NOTIFICATION_KINDS = ['stock_below_zero'] as const;
