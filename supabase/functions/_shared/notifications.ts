/**
 * The notifications function: 0021's three runtime routes over HTTP (module 6, step 2).
 *
 *   GET   /notifications              erp.list_notifications()
 *   GET   /notifications/unread       erp.count_unread_notifications()
 *   POST  /notifications/read         erp.mark_notifications_read()
 *
 * As ./stock.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor, so
 *   nobody reads, counts or marks another person's notifications by naming them.
 *
 *   SHAPE ONLY is checked here (./fields.ts). Who is told, what they may still open, the
 *   90 days and the page sizes are 0021's rules, and its refusals come back through
 *   ./refusal.ts.
 *
 *   THE FACILITY the bell is asked at comes from `facility_id`, in the query of a read and
 *   in the body of the mark, as every read asks it. It is where the gate is asked; the
 *   bell lists the person's notifications from every facility they may still open
 *   (ADR-0030 §6, question 3).
 *
 * TWO THINGS OF ITS OWN:
 *
 *   A PAGE ENDS BEFORE A SEQ, decimal text of an int8, never a moment: a microsecond
 *   moment read into a JavaScript Date loses three digits, and a cursor rounded down skips
 *   the rows that shared it (ADR-0030 §6, found in review).
 *
 *   MARKING ALL IS SAID, NOT IMPLIED. The body names 1 to 100 ids, or says `all: true`;
 *   both, or neither, is malformed. An empty list, or a list that lost its ids on the way,
 *   is never read as "every one" (0021 refuses an empty list for the same reason).
 *   Marking is idempotent: a second tab, or a retry, marks nothing and is no error, so a
 *   lost answer needs no decision id to be retried.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import { facilityOf, form, Malformed, noSuchRoute, ok, optionalUuid, routeOf, shaped, type Source } from './fields.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bell's page: 30 unless asked, at most 100, as 0021 allows. */
function pageLimit(query: Source): number {
  const limit = query['limit'] === undefined ? 30 : Number(query['limit']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Malformed('limit');
  return limit;
}

/** A page ends before a seq: decimal text of a positive int8. */
function beforeSeq(query: Source): string | null {
  const v = query['before'];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) {
    throw new Malformed('before');
  }
  return v;
}

/** 1 to 100 ids, or `all: true`: exactly one of the two. */
function marked(body: Source): readonly string[] | null {
  const ids = body['notification_ids'];
  const all = body['all'];
  if (all !== undefined && all !== true) throw new Malformed('all');
  if (all === true) {
    if (ids !== undefined) throw new Malformed('notification_ids');
    return null;
  }
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new Malformed('notification_ids');
  ids.forEach((id: unknown, i: number) => {
    if (typeof id !== 'string' || !UUID.test(id)) throw new Malformed(`notification_ids[${i}]`);
  });
  return ids as string[];
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = pageLimit(q);
  const notifications = await deps.db.listNotifications(s.personId, {
    facilityId: facilityOf(request), beforeSeq: beforeSeq(q), limit,
  });
  // Newest first: a full page may have an older one, which ends before its last seq.
  const last = notifications[notifications.length - 1];
  return ok({ notifications, next_before: notifications.length === limit && last !== undefined ? String(last.seq) : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'notifications');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if (path.length === 1 && path[0] === 'unread') {
      return ok({ unread: await deps.db.countUnreadNotifications(actor, facilityOf(request)) });
    }
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 1 && path[0] === 'read') {
    const b = await form(request);
    const count = await deps.db.markNotificationsRead(actor, {
      facilityId: optionalUuid(b, 'facility_id'),
      notificationIds: marked(b),
    });
    return ok({ marked: count });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const notifications = endpoint(['GET', 'POST'], shaped(dispatch));
