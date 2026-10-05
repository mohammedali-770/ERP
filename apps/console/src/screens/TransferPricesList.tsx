import { useEffect, useRef, useState } from 'react';
import type { Failure, PriceListRow } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor } from '../format.ts';
import { localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { formatMinor, formatRiyadh } from '../transfer-prices.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

/**
 * The price list (erp.list_transfer_prices(), 0018): every active pack of every active
 * item at the facility's brand, with the price in force now and the next one set ahead.
 * An unpriced pack is listed as one, because no order can be charged for it. Paged by
 * item code, 100 items at a time.
 */
export function TransferPricesList({ ctx }: { ctx: Ctx }) {
  const { api, lang, data, facilityId } = ctx;
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState<readonly PriceListRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  const query = (after: string | null) => ({ facilityId, search: applied === '' ? null : applied, after });

  useEffect(() => {
    const mine = ++seq.current;
    setRows(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    void api.listTransferPrices(query(null)).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.prices);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, applied]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.listTransferPrices(query(next));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.prices]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'transfer_prices')}</h1>
      </header>
      <p className="muted">{t(lang, 'transfer_prices_hint')}</p>
      {!ctx.transferPricesWritable ? <Notice tone="info" text={t(lang, 'read_only_prices')} /> : null}

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
      </form>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, 'no_priced_items')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'pack')}</th>
              <th>{t(lang, 'price_now')}</th>
              <th>{t(lang, 'price_next')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              // An item's packs come together; its code and name are shown once, on the first.
              const first = i === 0 || rows[i - 1]!.item_id !== r.item_id;
              return (
                <tr key={r.item_unit_id} className={r.price_minor === null ? 'unpriced' : undefined}>
                  <td className="code">{first ? <a href={`#transfer_prices/${r.item_id}`} dir="ltr">{r.code}</a> : null}</td>
                  <td>{first ? localName(lang, r) : null}</td>
                  <td>
                    {unitName(lang, data.units, r.unit_key)}{' '}
                    <span className="muted">(<bdi dir="ltr">{formatFactor(r.factor)}</bdi> {unitName(lang, data.units, r.base_unit_key)})</span>
                  </td>
                  <td>
                    {r.price_minor === null ? <em>{t(lang, 'unpriced')}</em> : (
                      <>
                        <bdi dir="ltr">{formatMinor(lang, r.price_minor, r.currency ?? undefined)}</bdi>
                        {r.effective_from ? <span className="muted"> · {formatRiyadh(lang, r.effective_from)}</span> : null}
                      </>
                    )}
                  </td>
                  <td>
                    {r.next_price_minor === null ? null : (
                      <>
                        <bdi dir="ltr">{formatMinor(lang, r.next_price_minor)}</bdi>
                        {r.next_effective_from ? <span className="muted"> · {formatRiyadh(lang, r.next_effective_from)}</span> : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
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
