import { useEffect, useRef, useState } from 'react';
import type { Facility, Failure } from '../api.ts';
import type { Ctx } from '../context.ts';
import { areaWarning, hasArea } from '../facilities.ts';
import { label, localName, t } from '../i18n.ts';
import { FailureNotice, Loading, Notice } from './ui.tsx';

type StatusFilter = 'open' | 'closed' | 'all';

/**
 * Every branch, warehouse, factory and office. Read AT the facility being worked at, which
 * limits the list to that facility's brand (ADR-0012); organisation-wide, every brand's.
 * Paged by code, 100 at a time. An open branch with no area is flagged: its workers cannot
 * order until it has one (ADR-0028 §2).
 */
export function FacilitiesList({ ctx }: { ctx: Ctx }) {
  const { api, lang, data, facilityId } = ctx;
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [facilities, setFacilities] = useState<readonly Facility[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  const query = (after: string | null) => ({ facilityId, status, search: applied === '' ? null : applied, after });

  useEffect(() => {
    const mine = ++seq.current;
    setFacilities(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    void api.listFacilities(query(null)).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setFacilities(answer.value.facilities);
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
    const answer = await api.listFacilities(query(next));
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setFacilities((current) => [...(current ?? []), ...answer.value.facilities]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  const brandName = (brandId: string) => {
    const b = data.brands.find((x) => x.brand_id === brandId);
    return b === undefined ? '' : localName(lang, b);
  };

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'facilities')}</h1>
        {ctx.facilitiesWritable ? (
          <div className="actions">
            <a className="button primary" href="#facilities/new">{t(lang, 'create_facility')}</a>
          </div>
        ) : null}
      </header>
      {!ctx.facilitiesWritable ? <Notice tone="info" text={t(lang, 'read_only_facilities')} /> : null}

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
          <option value="open">{t(lang, 'status_open')}</option>
          <option value="closed">{t(lang, 'status_closed')}</option>
          <option value="all">{t(lang, 'status_all')}</option>
        </select>
      </form>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {facilities === null && failure === null ? <Loading lang={lang} /> : null}
      {facilities !== null && facilities.length === 0 ? <p className="muted">{t(lang, 'no_facilities')}</p> : null}
      {facilities !== null && facilities.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'facility_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'facility_type')}</th>
              <th>{t(lang, 'brand')}</th>
              <th>{t(lang, 'area')}</th>
              <th>{t(lang, 'status')}</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.facility_id} className={f.status === 'closed' ? 'retired' : undefined}>
                <td className="code"><a href={`#facilities/${f.facility_id}`} dir="ltr">{f.code}</a></td>
                <td>{localName(lang, f)}</td>
                <td>{label(lang, `type_${f.facility_type}`)}</td>
                <td>{brandName(f.brand_id)}</td>
                <td>
                  {hasArea(f) ? t(lang, 'area_radius', { n: f.geofence_radius_m ?? '' })
                    : areaWarning(f) === 'no_area' ? <em>{t(lang, 'area_missing')}</em> : t(lang, 'area_none')}
                </td>
                <td>{f.status === 'open' ? t(lang, 'status_open') : t(lang, 'status_closed')}</td>
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
