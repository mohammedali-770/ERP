import { useEffect, useRef, useState } from 'react';
import type { Failure, Supplier } from '../api.ts';
import type { Ctx } from '../context.ts';
import { localName, t } from '../i18n.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

type StatusFilter = 'active' | 'retired' | 'all';

/**
 * The supplier master. Organisation data, not filtered by facility (ADR-0026 §4), but
 * still read AT the facility being worked at, so a role there is what decides. Paged by
 * code, 100 at a time.
 */
export function SuppliersList({ ctx }: { ctx: Ctx }) {
  const { api, lang, facilityId } = ctx;
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [suppliers, setSuppliers] = useState<readonly Supplier[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the items list.
  const seq = useRef(0);

  const query = (after: string | null) => ({ facilityId, status, search: applied === '' ? null : applied, after });

  useEffect(() => {
    const mine = ++seq.current;
    setSuppliers(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    void api.listSuppliers(query(null)).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setSuppliers(answer.value.suppliers);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, applied, status]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.listSuppliers(query(next));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setSuppliers((current) => [...(current ?? []), ...answer.value.suppliers]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'suppliers')}</h1>
        {ctx.suppliersWritable ? (
          <div className="actions">
            <a className="button" href="#suppliers/import">{t(lang, 'bulk_upload')}</a>
            <a className="button primary" href="#suppliers/new">{t(lang, 'create_supplier')}</a>
          </div>
        ) : null}
      </header>
      {!ctx.suppliersWritable ? <Notice tone="info" text={t(lang, 'read_only_suppliers')} /> : null}

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
        <select aria-label={t(lang, 'status')} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="active">{t(lang, 'status_active')}</option>
          <option value="retired">{t(lang, 'status_retired')}</option>
          <option value="all">{t(lang, 'status_all')}</option>
        </select>
      </form>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {suppliers === null && failure === null ? <Loading lang={lang} /> : null}
      {suppliers !== null && suppliers.length === 0 ? <p className="muted">{t(lang, 'no_suppliers')}</p> : null}
      {suppliers !== null && suppliers.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'supplier_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'payment_terms_days')}</th>
              <th>{t(lang, 'phone')}</th>
              <th>{t(lang, 'status')}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.supplier_id} className={s.status === 'retired' ? 'retired' : undefined}>
                <td className="code"><a href={`#suppliers/${s.supplier_id}`} dir="ltr">{s.code}</a></td>
                <td>{localName(lang, s)}</td>
                <td>{t(lang, 'days', { n: s.payment_terms_days })}</td>
                <td><bdi dir="ltr">{s.phone ?? ''}</bdi></td>
                <td>{s.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_retired')}</td>
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
