import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CutoffRow, Failure, Item, SourceDecision, SourceHistory, SourceRow } from '../api.ts';
import type { Ctx } from '../context.ts';
import { shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import {
  clearSourceBody, inForce, readAll, setSourceBody, sourceActions, sourceOptions, stampOf,
} from '../ordering-setup.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** Who recorded something: the person's own name, or a short id for anyone else (as on every history). */
export function personLabel(ctx: Ctx, id: string): string {
  const { lang, data } = ctx;
  return id === data.person.person_id
    ? (localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar }) || shortId(id))
    : shortId(id);
}

/**
 * The warehouses and factories ordering is set up for, as the cut-off list reads them where
 * the person works (erp.order_cutoffs(), 0024): each one's code, names, state and time zone.
 * Organisation-wide, every brand's. Null until read.
 */
export function useSupplyingFacilities(ctx: Ctx): { rows: readonly CutoffRow[] | null; failure: Failure | null; reload: () => void } {
  const { api, facilityId, onFailure } = ctx;
  const seesCutoffs = ctx.ordering.seesCutoffs;
  const [rows, setRows] = useState<readonly CutoffRow[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Asked again on the person's doing, after a read that failed.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    setRows(null);
    setFailure(null);
    if (!seesCutoffs) return;
    let live = true;
    void readAll<CutoffRow>((after) => api.orderCutoffs({ facilityId, after, limit: 500 })
      .then((a) => (a.ok ? { ok: true as const, value: { rows: a.value.cutoffs, next: a.value.next_after } } : a)))
      .then((answer) => {
        if (!live) return;
        if (answer.ok) setRows(answer.value);
        else if (!onFailure(answer)) setFailure(answer);
      });
    return () => {
      live = false;
    };
  }, [api, facilityId, seesCutoffs, onFailure, asked]);
  return { rows, failure, reload: () => setAsked((n) => n + 1) };
}

/**
 * Every item, by code, with the warehouse or factory that supplies branches with it
 * (erp.replenishment_sources(), 0024): read where the person works, the facility's brand's;
 * organisation-wide, every brand's. One facility's items alone on asking. A source is set
 * from the item's own page.
 */
export function SourcesList({ ctx }: { ctx: Ctx }) {
  const { api, lang, facilityId } = ctx;
  const supplying = useSupplyingFacilities(ctx);
  const [suppliedBy, setSuppliedBy] = useState('');
  const [rows, setRows] = useState<readonly SourceRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest load may draw, as on the other lists.
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setRows(null);
    setNext(null);
    setFailure(null);
    setLoadingMore(false);
    void api.replenishmentSources({ facilityId, suppliedBy: suppliedBy === '' ? null : suppliedBy }).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.sources);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, suppliedBy]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.replenishmentSources({ facilityId, suppliedBy: suppliedBy === '' ? null : suppliedBy, after: next });
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.sources]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <section>
      <header className="page-header"><h1>{t(lang, 'replenishment_sources')}</h1></header>
      <p className="muted">{t(lang, 'sources_hint')}</p>
      {!ctx.ordering.setsSources ? <Notice tone="info" text={t(lang, 'read_only_sources')} /> : null}

      <div className="filters">
        <label>
          {t(lang, 'supplied_by')}{' '}
          <select value={suppliedBy} onChange={(e) => setSuppliedBy(e.target.value)} disabled={supplying.rows === null}>
            <option value="">{t(lang, 'supplied_by_any')}</option>
            {(supplying.rows ?? []).map((f) => (
              <option key={f.facility_id} value={f.facility_id}>{f.code} — {localName(lang, f)}</option>
            ))}
          </select>
        </label>
      </div>

      {supplying.failure ? <FailureNotice lang={lang} failure={supplying.failure} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, 'no_sources')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'supplied_by')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_id} className={r.item_status === 'retired' ? 'retired' : undefined}>
                <td className="code"><a href={`#replenishment_sources/${r.item_id}`} dir="ltr">{r.code}</a></td>
                <td>{localName(lang, r)}{r.item_status === 'retired' ? <> · <em>{t(lang, 'status_retired')}</em></> : null}</td>
                <td>
                  {r.facility_id === null || r.facility_code === null ? <em>{t(lang, 'no_source')}</em> : (
                    <><bdi dir="ltr">{r.facility_code}</bdi> — {localName(lang, { name_en: r.facility_name_en, name_ar: r.facility_name_ar })}</>
                  )}
                </td>
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

/**
 * One item's source: the warehouse or factory in force, every decision about it
 * (erp.replenishment_source_history(), 0024), and, organisation-wide to one who may, a form
 * to set it and one to clear it. Both are checked against the decision in force, which the
 * history marks (ordering-setup.ts, stampOf).
 */
export function SourceItem({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, onFailure, facilityId } = ctx;
  const supplying = useSupplyingFacilities(ctx);
  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<readonly SourceDecision[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True from a write's answer until the page has read what it left: the forms are not
  // offered meanwhile, as their stamp would be the one before the write.
  const [reloading, setReloading] = useState(false);
  // Only the newest load may draw; an older page is kept only if no load began after it
  // was asked, as its cursor is that load's.
  const seq = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    generation.current++;
    setLoadingMore(false);
    const [i, h] = await Promise.all([api.getItem(facilityId, itemId), api.replenishmentSourceHistory(facilityId, itemId)]);
    if (mine !== seq.current) return;
    for (const a of [i, h]) {
      if (!a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (i.ok && h.ok) {
      setItem(i.value);
      setHistory(h.value.decisions);
      setNext(h.value.next_before);
      setFailure(null);
      setReloading(false);
    }
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => {
    setItem(null);
    setHistory(null);
    setNext(null);
    setLoadingMore(false);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  async function older() {
    if (next === null || reloading) return;
    const mine = generation.current;
    setLoadingMore(true);
    const answer = await api.replenishmentSourceHistory(facilityId, itemId, next);
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setHistory((current) => [...(current ?? []), ...answer.value.decisions]);
      setNext(answer.value.next_before);
    } else if (!onFailure(answer)) {
      setFailure(answer);
    }
  }

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'source_already_recorded') }
        : { tone: 'info', text: t(lang, 'source_changed') });
    setReloading(true);
    void load();
  };

  if (item === null || history === null) {
    return (
      <section>
        <a href="#replenishment_sources">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const current = inForce(history);
  const stamp = stampOf(history);
  const actions = sourceActions({ setsSources: ctx.ordering.setsSources, itemActive: item.status === 'active', inForce: current !== null });
  const named = (id: string | null, code: string | null) => {
    const f = (supplying.rows ?? []).find((x) => x.facility_id === id);
    return <><bdi dir="ltr">{code ?? (id === null ? '' : shortId(id))}</bdi>{f !== undefined ? <> — {localName(lang, f)}</> : null}</>;
  };

  return (
    <section>
      <a href="#replenishment_sources">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><bdi dir="ltr">{item.code}</bdi> — {localName(lang, item)}</h1>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {!ctx.ordering.setsSources ? <Notice tone="info" text={t(lang, 'read_only_sources')} /> : null}
      {/* "Can still be cleared" only where a clear is offered (found in review). */}
      {item.status === 'retired' ? <Notice tone="info" text={actions.clear
        ? `${t(lang, 'source_item_retired')} ${t(lang, 'source_item_retired_clear')}` : t(lang, 'source_item_retired')} /> : null}
      {/* The facilities a source may be set to are the cut-off list's: a failed read is shown and
          asked again, never left as a form that is always loading (found in review). */}
      {supplying.failure !== null ? (
        <>
          <FailureNotice lang={lang} failure={supplying.failure} />
          <button type="button" onClick={supplying.reload}>{t(lang, 'reload')}</button>
        </>
      ) : null}

      <p>
        {t(lang, 'supplied_by')}:{' '}
        {current === null ? <em>{t(lang, 'no_source')}</em> : <strong>{named(current.facility_id, current.facility_code)}</strong>}
      </p>

      {reloading && failure !== null
        ? <button type="button" onClick={() => { setFailure(null); void load(); }}>{t(lang, 'reload')}</button>
        : reloading ? <Loading lang={lang} /> : null}
      {actions.set && !reloading && supplying.failure === null
        ? <SetSource ctx={ctx} item={item} options={supplying.rows === null ? null
          : sourceOptions(supplying.rows, ctx.data.facilities, item.brand_id, current?.facility_id ?? null)} stamp={stamp} onDone={afterWrite} />
        : null}
      {actions.clear && !reloading && stamp !== null
        ? <ClearSource ctx={ctx} item={item} stamp={stamp} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'no_source_history')}</p> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
          </thead>
          <tbody>
            {history.map((d) => (
              <tr key={d.decision_id} className={d.is_current ? undefined : 'retired'}>
                <td>{formatRiyadh(lang, d.decided_at)}</td>
                <td>
                  {label(lang, `kind_${d.kind}`)}
                  {d.facility_id !== null ? <> · {named(d.facility_id, d.facility_code)}</> : null}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id}>{personLabel(ctx, d.actor_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null ? (
        <button type="button" onClick={() => void older()} disabled={loadingMore || reloading}>
          {loadingMore ? t(lang, 'loading') : t(lang, 'older')}
        </button>
      ) : null}
    </section>
  );
}

/**
 * The warehouse or factory to supply branches with the item: an open one of its brand,
 * against the stamp the page read when the button was pressed (write.ts: built once,
 * retried as sent).
 */
function SetSource({ ctx, item, options, stamp, onDone }: {
  ctx: Ctx; item: Item; options: readonly CutoffRow[] | null; stamp: string | null; onDone: Done;
}) {
  const { api, lang } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [suppliedBy, setSuppliedBy] = useState('');
  const [reason, setReason] = useState('');
  // A facility no longer offered (closed, or now the source) is never left chosen.
  useEffect(() => {
    if (suppliedBy !== '' && options !== null && !options.some((o) => o.facility_id === suppliedBy)) setSuppliedBy('');
  }, [options, suppliedBy]);
  const w = useWrite(ctx, () => ctx.api.replenishmentSourceHistory(ctx.facilityId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setSuppliedBy('');
    setReason('');
  }, (seen) => (seen as SourceHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = item.item_id;
    const body = setSourceBody(ids, { suppliedBy, expectedDecisionId: stamp, reason });
    void w.run(() => api.setReplenishmentSource(id, body));
  }

  if (options === null) return <Loading lang={lang} />;
  if (options.length === 0) return <p className="muted">{t(lang, 'source_no_options')}</p>;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_source')}</h3>
      <p className="muted">{t(lang, 'set_source_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <Field label={t(lang, 'supplied_by')}>
          <select required value={suppliedBy} onChange={(e) => setSuppliedBy(e.target.value)}>
            <option value="" disabled>—</option>
            {options.map((o) => (
              <option key={o.facility_id} value={o.facility_id}>{o.code} — {localName(lang, o)} · {label(lang, `type_${o.facility_type}`)}</option>
            ))}
          </select>
        </Field>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy || suppliedBy === ''}>
          {w.busy ? t(lang, 'saving') : t(lang, 'set_source')}
        </button>
      </fieldset>
    </form>
  );
}

/** No facility will supply the item: module 10 cannot order it. Against the stamp read, as a set is. */
function ClearSource({ ctx, item, stamp, onDone }: { ctx: Ctx; item: Item; stamp: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.replenishmentSourceHistory(ctx.facilityId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  }, (seen) => (seen as SourceHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = item.item_id;
    const body = clearSourceBody(ids, { expectedDecisionId: stamp, reason });
    void w.run(() => api.clearReplenishmentSource(id, body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'clear_source')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'clear_source_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'clear_source')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
