import { useEffect, useRef, useState } from 'react';
import type { Failure, Item } from '../api.ts';
import type { Ctx } from '../context.ts';
import { ITEM_KINDS, unitName } from '../items.ts';
import { label, localName, t } from '../i18n.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

type StatusFilter = 'active' | 'retired' | 'all';

/**
 * The item master at the facility the person is working at — that facility's brand only
 * (ADR-0012) — or every brand organisation-wide. Paged by code, 100 at a time; the
 * warehouse loaded every item in one request.
 */
export function ItemsList({ ctx }: { ctx: Ctx }) {
  const { api, lang, data, facilityId } = ctx;
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [brand, setBrand] = useState('');
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Each load takes a number, and only the newest may draw. A "Load more" answer that
  // arrived after a filter change was appended to the new filter's list (found in review).
  const seq = useRef(0);

  const query = (after: string | null) => ({
    facilityId,
    brandId: facilityId === null && brand !== '' ? brand : null,
    status,
    itemKind: kind === '' ? null : kind,
    search: applied === '' ? null : applied,
    after,
  });

  useEffect(() => {
    const mine = ++seq.current;
    setItems(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    void api.listItems(query(null)).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setItems(answer.value.items);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, applied, kind, status, brand]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.listItems(query(next));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setItems((current) => [...(current ?? []), ...answer.value.items]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  const brandName = (id: string) => {
    const b = data.brands.find((x) => x.brand_id === id);
    return b === undefined ? '' : localName(lang, b);
  };

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'items')}</h1>
        {ctx.writable ? (
          <div className="actions">
            <a className="button" href="#items/import">{t(lang, 'bulk_upload')}</a>
            <a className="button primary" href="#items/new">{t(lang, 'create_item')}</a>
          </div>
        ) : null}
      </header>
      {!ctx.writable ? <Notice tone="info" text={t(lang, 'read_only_here')} /> : null}

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
        <select aria-label={t(lang, 'item_kind')} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t(lang, 'all_kinds')}</option>
          {ITEM_KINDS.map((k) => <option key={k} value={k}>{label(lang, `kind_${k}`)}</option>)}
        </select>
        <select aria-label={t(lang, 'status')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="active">{t(lang, 'status_active')}</option>
          <option value="retired">{t(lang, 'status_retired')}</option>
          <option value="all">{t(lang, 'status_all')}</option>
        </select>
        {facilityId === null ? (
          <select aria-label={t(lang, 'brand')} value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">{t(lang, 'all_brands')}</option>
            {data.brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{localName(lang, b)}</option>)}
          </select>
        ) : null}
      </form>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {items === null && failure === null ? <Loading lang={lang} /> : null}
      {items !== null && items.length === 0 ? <p className="muted">{t(lang, 'no_items')}</p> : null}
      {items !== null && items.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'item_kind')}</th>
              <th>{t(lang, 'base_unit')}</th>
              {facilityId === null ? <th>{t(lang, 'brand')}</th> : null}
              <th>{t(lang, 'status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.item_id} className={item.status === 'retired' ? 'retired' : undefined}>
                <td className="code"><a href={`#items/${item.item_id}`} dir="ltr">{item.code}</a></td>
                <td>{localName(lang, item)}</td>
                <td>{label(lang, `kind_${item.item_kind}`)}</td>
                <td>{unitName(lang, data.units, item.base_unit_key)}</td>
                {facilityId === null ? <td>{brandName(item.brand_id)}</td> : null}
                <td>{item.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_retired')}</td>
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
