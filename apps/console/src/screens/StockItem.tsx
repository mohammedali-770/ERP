import { useCallback, useEffect, useRef, useState } from 'react';
import type { Failure, Item, StockBalance, StockCardRow } from '../api.ts';
import type { Ctx } from '../context.ts';
import { shortId } from '../format.ts';
import { label, localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { findBalance, formatQuantity, isNegative, isZero } from '../stock.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';
import { stockPlace } from './StockList.tsx';

/**
 * One item's stock card at the facility worked at (erp.stock_history(), 0020): every
 * decision that touched it, newest first, with what it moved in the base unit or what a
 * count found, and the balance it stands at now. A movement's moment and business day are
 * shown as recorded; a reversal and what it reversed name each other. Paged by seq.
 */
export function StockItem({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, data, onFailure } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const [item, setItem] = useState<Item | null>(null);
  const [balance, setBalance] = useState<StockBalance | null | undefined>(undefined);
  const [rows, setRows] = useState<readonly StockCardRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw.
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (facilityId === null) return;
    const mine = ++seq.current;
    const i = await api.getItem(facilityId, itemId);
    if (mine !== seq.current) return;
    if (!i.ok) {
      if (!onFailure(i)) setFailure(i);
      return;
    }
    // The balance is found through the list searched by the item's code, page by page in
    // code order (stock.ts, findBalance); an item never moved here has none.
    const code = i.value.code;
    const [b, c] = await Promise.all([
      findBalance((after) => api.stockOnHand({ facilityId, search: code, after, limit: 100 }), itemId, code),
      api.stockCard(facilityId, itemId),
    ]);
    if (mine !== seq.current) return;
    for (const a of [b, c]) {
      if (!a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (b.ok && c.ok) {
      setItem(i.value);
      setBalance(b.value);
      setRows(c.value.decisions);
      setNext(c.value.next_before);
      setFailure(null);
    }
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => {
    setItem(null);
    setBalance(undefined);
    setRows(null);
    setNext(null);
    setLoadingMore(false);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  async function older() {
    if (next === null || facilityId === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.stockCard(facilityId, itemId, next);
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.decisions]);
      setNext(answer.value.next_before);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }

  if (place.facility === null) {
    return <section><a href="#current_stock">{t(lang, 'back')}</a>{place.notice}</section>;
  }
  if (item === null || rows === null || balance === undefined) {
    return (
      <section>
        <a href="#current_stock">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const base = unitName(lang, data.units, item.base_unit_key);
  const person = (id: string) => (id === data.person.person_id
    ? (localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar }) || shortId(id))
    : shortId(id));

  return (
    <section>
      <a href="#current_stock">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><bdi dir="ltr">{item.code}</bdi> — {localName(lang, item)}</h1>
        <div className="actions">
          {ctx.seesStockAlerts ? <a className="button" href={`#stock_alerts/items/${item.item_id}`}>{t(lang, 'stock_minimum_link')}</a> : null}
          <a className="button" href={`#items/${item.item_id}`}>{t(lang, 'items')}</a>
        </div>
      </header>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      <p>
        {t(lang, 'stock_at', { code: place.facility.code })}:{' '}
        {balance === null ? <em>{t(lang, 'no_stock_record')}</em> : (
          <strong className={isNegative(balance.on_hand) ? 'negative' : undefined}>
            <bdi dir="ltr">{formatQuantity(balance.on_hand)}</bdi> {base}
          </strong>
        )}
        {balance !== null && balance.last_counted_at !== null
          ? <span className="muted"> · {t(lang, 'last_counted')}: {formatRiyadh(lang, balance.last_counted_at)}</span> : null}
      </p>
      {balance !== null && isNegative(balance.on_hand) ? <Notice tone="info" text={t(lang, 'below_zero_hint')} /> : null}

      <h2>{t(lang, 'stock_card')}</h2>
      {rows.length === 0 ? <p className="muted">{t(lang, 'no_stock_decisions')}</p> : (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'occurred_at')}</th>
              <th>{t(lang, 'decision')}</th>
              <th>{t(lang, 'quantity_in')}</th>
              <th>{t(lang, 'quantity_out')}</th>
              <th>{t(lang, 'counted')}</th>
              <th>{t(lang, 'reason')}</th>
              <th>{t(lang, 'decided_by')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.decision_id} className={r.reversed_by_decision_id !== null ? 'retired' : undefined}>
                <td>
                  {formatRiyadh(lang, r.occurred_at)}
                  <div className="muted"><bdi dir="ltr">{r.business_date}</bdi></div>
                </td>
                <td>
                  <a href={`#current_stock/decisions/${r.decision_id}`}>{label(lang, `stock_kind_${r.kind}`)}</a>
                  {r.reversed_by_decision_id !== null ? <div className="muted">{t(lang, 'reversed')}</div> : null}
                </td>
                <td>{isZero(r.quantity_in) ? null : <bdi dir="ltr">{formatQuantity(r.quantity_in)}</bdi>}</td>
                <td>{isZero(r.quantity_out) ? null : <bdi dir="ltr">{formatQuantity(r.quantity_out)}</bdi>}</td>
                <td>{r.counted === null ? null : <bdi dir="ltr">{formatQuantity(r.counted)}</bdi>}</td>
                <td>
                  <bdi>{r.reason}</bdi>
                  {r.override_reason !== null ? <div className="muted">{t(lang, 'override_reason')}: <bdi>{r.override_reason}</bdi></div> : null}
                </td>
                <td dir="ltr" title={r.actor_id}>{person(r.actor_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">{t(lang, 'stock_card_hint', { unit: base })}</p>
      {next !== null ? (
        <button type="button" onClick={() => void older()} disabled={loadingMore}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'older')}
        </button>
      ) : null}
    </section>
  );
}
