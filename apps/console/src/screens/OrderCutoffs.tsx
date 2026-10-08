import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CutoffDecision, CutoffHistory, CutoffRow, Failure } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import {
  clearCutoffBody, cutoffActions, cutoffInput, cutoffPageNotice, cutoffReadable, cutoffsListNotice, inForce, readAll, setCutoffBody,
  stampOf,
} from '../ordering-setup.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { personLabel } from './ReplenishmentSources.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/**
 * Every warehouse and factory, by code, with its cut-off at its own time (erp.order_cutoffs(),
 * 0024): read where the person works, the facility's brand's; at a branch, the cut-offs of
 * the facilities that supply it (O5); organisation-wide, every brand's. A cut-off's own page,
 * with its history, opens organisation-wide or at the facility itself, where 0024 reads it.
 */
export function CutoffsList({ ctx }: { ctx: Ctx }) {
  const { api, lang, facilityId } = ctx;
  const [rows, setRows] = useState<readonly CutoffRow[] | null>(null);
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
    void api.orderCutoffs({ facilityId }).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.cutoffs);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId]);

  async function more() {
    if (next === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.orderCutoffs({ facilityId, after: next });
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.cutoffs]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <section>
      <header className="page-header"><h1>{t(lang, 'order_cutoffs')}</h1></header>
      <p className="muted">{t(lang, 'cutoffs_hint')}</p>
      <Notice tone="info" text={t(lang, cutoffsListNotice(ctx.ordering))} />

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, 'no_supplying_facilities')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'facility_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'order_cutoff')}</th>
              <th>{t(lang, 'time_zone')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.facility_id} className={r.status === 'closed' ? 'retired' : undefined}>
                <td className="code">
                  {cutoffReadable(facilityId, r.facility_id)
                    ? <a href={`#order_cutoffs/${r.facility_id}`} dir="ltr">{r.code}</a> : <bdi dir="ltr">{r.code}</bdi>}
                </td>
                <td>
                  {localName(lang, r)} · {label(lang, `type_${r.facility_type}`)}
                  {r.status === 'closed' ? <> · <em>{t(lang, 'status_closed')}</em></> : null}
                </td>
                <td>{r.cutoff === null ? <em>{t(lang, 'no_cutoff')}</em> : <strong><bdi dir="ltr">{r.cutoff}</bdi></strong>}</td>
                <td dir="ltr">{r.tz_name}</td>
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
 * One warehouse or factory's cut-off: the one in force at its own time, every decision about
 * it (erp.order_cutoff_history(), 0024, asked at the facility), and, while working there to
 * one who may, a form to set it and one to clear it. Both are checked against the decision in
 * force, which the history marks (ordering-setup.ts, stampOf).
 */
export function CutoffFacility({ ctx, targetId }: { ctx: Ctx; targetId: string }) {
  const { api, lang, onFailure, facilityId } = ctx;
  const [facility, setFacility] = useState<CutoffRow | null | undefined>(undefined);
  const [history, setHistory] = useState<readonly CutoffDecision[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True from a write's answer until the page has read what it left: the forms are not
  // offered meanwhile, as their stamp would be the one before the write.
  const [reloading, setReloading] = useState(false);
  const seq = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    generation.current++;
    setLoadingMore(false);
    const [list, h] = await Promise.all([
      readAll<CutoffRow>((after) => api.orderCutoffs({ facilityId, after, limit: 500 })
        .then((a) => (a.ok ? { ok: true as const, value: { rows: a.value.cutoffs, next: a.value.next_after } } : a))),
      api.orderCutoffHistory(targetId),
    ]);
    if (mine !== seq.current) return;
    for (const a of [list, h]) {
      if (!a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (list.ok && h.ok) {
      setFacility(list.value.find((f) => f.facility_id === targetId) ?? null);
      setHistory(h.value.decisions);
      setNext(h.value.next_before);
      setFailure(null);
      setReloading(false);
    }
  }, [api, onFailure, facilityId, targetId]);

  useEffect(() => {
    setFacility(undefined);
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
    const answer = await api.orderCutoffHistory(targetId, next);
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
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'cutoff_already_recorded') }
        : { tone: 'info', text: t(lang, 'cutoff_changed') });
    setReloading(true);
    void load();
  };

  if (facility === undefined || history === null) {
    return (
      <section>
        <a href="#order_cutoffs">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }
  if (facility === null) {
    return <section><a href="#order_cutoffs">{t(lang, 'back')}</a><Notice tone="info" text={t(lang, 'rule_no_facility')} /></section>;
  }

  const current = inForce(history);
  const stamp = stampOf(history);
  const actions = cutoffActions({
    setsCutoffs: ctx.ordering.setsCutoffs, facilityId, shown: facility.facility_id, status: facility.status, inForce: current !== null,
  });
  const notice = cutoffPageNotice({ rights: ctx.ordering, facilityId, shown: facility.facility_id, status: facility.status });

  return (
    <section>
      <a href="#order_cutoffs">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1>{t(lang, 'cutoff_at', { code: facility.code })} — {localName(lang, facility)}</h1>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {notice !== null ? <Notice tone="info" text={t(lang, notice, { code: facility.code })} /> : null}
      <p className="muted">{t(lang, 'cutoff_rule')}</p>

      <p>
        {t(lang, 'order_cutoff')}:{' '}
        {current === null || current.cutoff === null ? <em>{t(lang, 'no_cutoff')}</em>
          : <strong><bdi dir="ltr">{current.cutoff}</bdi></strong>}
        {' '}<span className="muted">· {t(lang, 'time_zone')}: <bdi dir="ltr">{facility.tz_name}</bdi></span>
      </p>

      {reloading && failure !== null
        ? <button type="button" onClick={() => { setFailure(null); void load(); }}>{t(lang, 'reload')}</button>
        : reloading ? <Loading lang={lang} /> : null}
      {actions.set && !reloading ? <SetCutoff ctx={ctx} facility={facility} stamp={stamp} onDone={afterWrite} /> : null}
      {actions.clear && !reloading && stamp !== null ? <ClearCutoff ctx={ctx} facility={facility} stamp={stamp} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'no_cutoff_history')}</p> : (
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
                  {d.cutoff !== null ? <> · <bdi dir="ltr">{d.cutoff}</bdi></> : null}
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
 * A cut-off, typed on the 24-hour clock and sent as 'HH:MM', against the stamp the page read
 * when the button was pressed (write.ts: built once, retried as sent).
 */
function SetCutoff({ ctx, facility, stamp, onDone }: { ctx: Ctx; facility: CutoffRow; stamp: string | null; onDone: Done }) {
  const { api, lang } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [cutoff, setCutoff] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(false);
  const w = useWrite(ctx, () => ctx.api.orderCutoffHistory(facility.facility_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setCutoff('');
    setReason('');
  }, (seen) => (seen as CutoffHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = cutoffInput(cutoff);
    if (!c.ok) return setProblem(true);
    setProblem(false);
    const id = facility.facility_id;
    const body = setCutoffBody(ids, { cutoff: c.value, expectedDecisionId: stamp, reason });
    void w.run(() => api.setOrderCutoff(id, body));
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_cutoff')}</h3>
      <p className="muted">{t(lang, 'set_cutoff_hint', { tz: facility.tz_name })}</p>
      {problem ? <Notice tone="error" text={t(lang, 'cutoff_bad_time')} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <Field label={t(lang, 'order_cutoff')} hint={t(lang, 'cutoff_input_hint')}>
          <input dir="ltr" inputMode="numeric" required maxLength={5} placeholder="14:00" value={cutoff}
                 onChange={(e) => setCutoff(e.target.value)} />
        </Field>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'set_cutoff')}</button>
      </fieldset>
    </form>
  );
}

/** No cut-off: every order to the facility is for the day it is placed. Against the stamp read, as a set is. */
function ClearCutoff({ ctx, facility, stamp, onDone }: { ctx: Ctx; facility: CutoffRow; stamp: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.orderCutoffHistory(facility.facility_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  }, (seen) => (seen as CutoffHistory).decisions.some((d) => d.decision_id === ids.decision_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = facility.facility_id;
    const body = clearCutoffBody(ids, { expectedDecisionId: stamp, reason });
    void w.run(() => api.clearOrderCutoff(id, body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'clear_cutoff')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'clear_cutoff_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'clear_cutoff')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
