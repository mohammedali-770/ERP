/**
 * What the notifications function asks the database: 0021's three runtime routes, one
 * method each.
 *
 * As ./stock-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./notifications.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). A person reads, counts and marks
 * only their own notifications: 0021 asks for no other.
 *
 * The producer, the rule of who may open what, and the purge are not here: the runtime
 * cannot call them (ADR-0030 §6).
 */

/** One item a stock notification names, read now through the reader's own access. */
export interface NotificationItem {
  readonly item_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly base_unit_key: string;
  /** Decimal text: the balance the decision left, in the item's base unit. */
  readonly on_hand: string;
}

/** One notification, as erp.list_notifications() returns it. */
export interface Notification {
  readonly notification_id: string;
  /** The page cursor, as decimal text of an int8: a whole number no client can round. */
  readonly seq: string;
  /** 'stock_below_zero' today; each later module adds its own. */
  readonly kind: string;
  readonly facility_id: string;
  readonly facility_code: string;
  /** What it is about, for a stock notification. */
  readonly stock_decision_id: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly items: readonly NotificationItem[];
}

export interface NotificationQuery {
  /** Where the bell is asked; null asks organisation-wide, as every read may. */
  readonly facilityId: string | null;
  /** Decimal text of a seq: the page ends before it. */
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface MarkNotificationsRead {
  readonly facilityId: string | null;
  /** 1 to 100 ids, or null for every unread one. Never empty: 0021 refuses that. */
  readonly notificationIds: readonly string[] | null;
}

export interface NotificationsDb {
  listNotifications(actor: string, query: NotificationQuery): Promise<readonly Notification[]>;
  countUnreadNotifications(actor: string, facilityId: string | null): Promise<number>;
  /** How many it marked: none, for ones already read, which is no error. */
  markNotificationsRead(actor: string, input: MarkNotificationsRead): Promise<number>;
}
