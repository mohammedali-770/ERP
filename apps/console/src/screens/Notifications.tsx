import { useEffect, useRef, useState } from 'react';
import type { Failure, Notification } from '../api.ts';
import type { Ctx } from '../context.ts';
import { localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { kindKey, markOf, openTarget, unreadIds } from '../notifications.ts';
import { formatQuantity, isNegative } from '../stock.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

/**
 * The bell's page (module 6, step 3): the person's own notifications, newest first, from
 * every facility they may still open (erp.list_notifications(), 0021). Each names what it
 * is about by ids the console reads now: the items' codes and names are today's, and the
 * balance is the one the decision left.
 *
 * Marking read is the person's own and changes nothing anyone else sees. "Mark all read"
 * marks the unread ones listed, by id: one that arrived after the page was loaded stays
 * unread until the person has seen it (notifications.ts, markOf). Opening one goes to its
 * decision, here or after switching to the facility it happened at (openTarget), since a
 * stock screen reads only where one works, and marks it read once it has opened.
 */
export function Notifications({ ctx }: { ctx: Ctx }) {
  const { api, lang, data, facilityId } = ctx;
  const [rows, setRows] = useState<readonly Notification[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setRows(null);
    setNext(null);
    setFailure(null);
    void api.listNotifications(facilityId).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.notifications);
        setNext(answer.value.next_before);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, ctx.bellPage]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setBusy(true);
    const answer = await api.listNotifications(facilityId, next);
    if (mine !== seq.current) return;
    setBusy(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.notifications]);
      setNext(answer.value.next_before);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  /** Marks read, then shows them read here and asks the bell again. Nothing is sent for none. */
  async function mark(ids: readonly string[] | 'all') {
    const what = markOf(ids);
    if (what === null) return;
    setBusy(true);
    const answer = await api.markNotificationsRead(facilityId, what);
    setBusy(false);
    if (!answer.ok) {
      if (!ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    setFailure(null);
    const now = new Date().toISOString();
    const marked = 'all' in what ? null : new Set(what.notificationIds);
    setRows((current) => (current ?? []).map((n) =>
      n.read_at === null && (marked === null || marked.has(n.notification_id)) ? { ...n, read_at: now } : n));
    ctx.refreshBell();
  }

  function open(n: Notification) {
    const target = openTarget(n, facilityId, data.facilities);
    if (target.kind === 'none') return;
    let went = true;
    if (target.kind === 'here') ctx.navigate(target.route);
    else went = ctx.workAt(target.facility.facility_id, target.route);
    // Marked read once it has opened, as the person has now seen it; the page it opens does not wait.
    if (went && n.read_at === null) void mark([n.notification_id]);
  }

  const unread = rows === null ? [] : unreadIds(rows);

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'notifications')}</h1>
        {unread.length > 0 ? (
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void mark(unread)}>{t(lang, 'mark_all_read')}</button>
          </div>
        ) : null}
      </header>
      <p className="muted">{t(lang, 'notifications_hint')}</p>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <Notice tone="info" text={t(lang, 'notifications_none')} /> : null}
      {rows !== null && rows.length > 0 ? (
        <ul className="notifications">
          {rows.map((n) => {
            const target = openTarget(n, facilityId, data.facilities);
            const kind = kindKey(n.kind);
            return (
              <li key={n.notification_id} className={n.read_at === null ? 'unread' : undefined}>
                <div className="notification-head">
                  <strong>{kind === null ? n.kind : t(lang, kind, { code: n.facility_code })}</strong>
                  {n.read_at === null ? <span className="pill">{t(lang, 'notif_unread')}</span> : null}
                  <span className="muted">{formatRiyadh(lang, n.created_at)}</span>
                </div>
                {n.items.length > 0 ? (
                  <ul className="notification-items">
                    {n.items.map((i) => (
                      <li key={i.item_id}>
                        <span className="code" dir="ltr">{i.code}</span> {localName(lang, i)}:{' '}
                        <span className={isNegative(i.on_hand) ? 'negative' : undefined}>
                          <bdi dir="ltr">{formatQuantity(i.on_hand)}</bdi> {unitName(lang, data.units, i.base_unit_key)}
                        </span>
                        {/* A low-stock item names the minimum it crossed (0022); a below-zero one has none. */}
                        {i.minimum !== undefined ? (
                          <span className="muted">
                            {' '}· {t(lang, 'notif_minimum', { q: '' })}<bdi dir="ltr">{formatQuantity(i.minimum)}</bdi>{' '}
                            {unitName(lang, data.units, i.base_unit_key)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="actions">
                  {target.kind === 'here' ? (
                    <button type="button" className="primary" onClick={() => open(n)}>{t(lang, 'notif_open')}</button>
                  ) : target.kind === 'switch' ? (
                    <button type="button" className="primary" onClick={() => open(n)}>
                      {t(lang, 'notif_open_at', { code: target.facility.code })}
                    </button>
                  ) : target.reason === 'elsewhere' ? (
                    <span className="muted">{t(lang, 'notif_cannot_open', { code: n.facility_code })}</span>
                  ) : null}
                  {n.read_at === null ? (
                    <button type="button" disabled={busy} onClick={() => void mark([n.notification_id])}>{t(lang, 'mark_read')}</button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {next !== null ? (
        <button type="button" onClick={() => void more()} disabled={busy}>{busy ? t(lang, 'loading') : t(lang, 'more')}</button>
      ) : null}
    </section>
  );
}
