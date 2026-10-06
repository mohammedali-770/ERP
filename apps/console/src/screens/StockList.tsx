import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Failure, StockBalance, ViewerFacility } from '../api.ts';
import type { Ctx } from '../context.ts';
import { localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { formatQuantity, isNegative, STOCK_FACILITY_TYPES, workingFacility } from '../stock.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

/**
 * Where stock is read: the facility being worked at, when it is a warehouse or a factory.
 * Organisation-wide there is no one facility to show, and 0020 would refuse rather than
 * mix them (stock_facility_required); a branch holds no stock until its business day is
 * decided (Q-06), an office none. Each says so, and names where to go.
 */
export function stockPlace(ctx: Ctx): { facility: ViewerFacility; notice: null } | { facility: null; notice: ReactNode } {
  const { lang, data, facilityId } = ctx;
  const facility = workingFacility(data.facilities, facilityId);
  if (facility === undefined) return { facility: null, notice: <Notice tone="info" text={t(lang, 'stock_choose_facility')} /> };
  if (!STOCK_FACILITY_TYPES.has(facility.facility_type)) {
    const key = facility.facility_type === 'branch' ? 'stock_branch_none' : 'stock_office_none';
    return { facility: null, notice: <Notice tone="info" text={t(lang, key)} /> };
  }
  return { facility, notice: null };
}

/**
 * The stock at the facility worked at (erp.stock_on_hand(), 0020): every item it holds a
 * balance of, in the item's base unit, with when it was last counted. A balance below zero
 * after an override (D1) is marked, and can be listed alone. Paged by item code.
 */
export function StockList({ ctx }: { ctx: Ctx }) {
  const { api, lang, data } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [negative, setNegative] = useState(false);
  const [rows, setRows] = useState<readonly StockBalance[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  const query = (id: string, after: string | null) =>
    ({ facilityId: id, search: applied === '' ? null : applied, after, negativeOnly: negative });

  useEffect(() => {
    const mine = ++seq.current;
    setRows(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    if (facilityId === null) return;
    void api.stockOnHand(query(facilityId, null)).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.balances);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, applied, negative]);

  async function more() {
    if (next === null || facilityId === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.stockOnHand(query(facilityId, next));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.balances]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  if (place.facility === null) {
    return (
      <section>
        <header className="page-header"><h1>{t(lang, 'current_stock')}</h1></header>
        {place.notice}
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'stock_at', { code: place.facility.code })} — {localName(lang, place.facility)}</h1>
        {ctx.stockWritable ? (
          <div className="actions">
            <a className="button primary" href="#current_stock/adjust">{t(lang, 'record_movement')}</a>
            <a className="button" href="#current_stock/count">{t(lang, 'record_count')}</a>
          </div>
        ) : null}
      </header>
      <p className="muted">{t(lang, 'stock_hint')}</p>
      {!ctx.stockWritable ? <Notice tone="info" text={t(lang, 'read_only_stock')} /> : null}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
        <input
          type="search"
          aria-label={t(lang, 'search')}
          placeholder={t(lang, 'search')}
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => setApplied(search.trim())}
        />
        <label className="check">
          <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} />
          {t(lang, 'below_zero_only')}
        </label>
      </form>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, negative ? 'none_below_zero' : 'no_stock')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'on_hand')}</th>
              <th>{t(lang, 'last_counted')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id} className={r.item_status === 'retired' ? 'retired' : undefined}>
                <td className="code"><a href={`#current_stock/items/${r.item_id}`} dir="ltr">{r.code}</a></td>
                <td>{localName(lang, r)}{r.item_status === 'retired' ? <> · <em>{t(lang, 'status_retired')}</em></> : null}</td>
                <td className={isNegative(r.on_hand) ? 'negative' : undefined}>
                  <bdi dir="ltr">{formatQuantity(r.on_hand)}</bdi> {unitName(lang, data.units, r.base_unit_key)}
                  {isNegative(r.on_hand) ? <> · <strong>{t(lang, 'below_zero')}</strong></> : null}
                </td>
                <td>{r.last_counted_at === null ? <em>{t(lang, 'never_counted')}</em> : formatRiyadh(lang, r.last_counted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {next !== null ? (
        <button type="button" onClick={() => void more()} disabled={loadingMore}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'more')}
        </button>
      ) : null}
    </section>
  );
}
