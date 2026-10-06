import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Failure, StockDecision } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { formatQuantity, reversalBody, reversible, WOULD_GO_NEGATIVE, writableHere } from '../stock.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { stockPlace, useFacilityStatus } from './StockList.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/**
 * One stock decision whole (erp.get_stock_decision(), 0020), at the facility worked at:
 * what it posted line by line, what a count found, who decided it and why, and the
 * reversal that undid it or the decision it undid. A decision at another facility is
 * answered as a missing one. A movement not yet reversed may be reversed here, once; a
 * count is corrected by counting again.
 */
export function StockDecisionPage({ ctx, decisionId }: { ctx: Ctx; decisionId: string }) {
  const { api, lang, data, onFailure } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const [decision, setDecision] = useState<StockDecision | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (facilityId === null) return;
    const mine = ++seq.current;
    const d = await api.getStockDecision(facilityId, decisionId);
    if (mine !== seq.current) return;
    if (!d.ok) {
      if (!onFailure(d)) setFailure(d);
      return;
    }
    setDecision(d.value);
    setFailure(null);
  }, [api, onFailure, facilityId, decisionId]);

  useEffect(() => {
    setDecision(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : { tone: 'info', text: t(lang, 'stock_already_recorded') });
    void load();
  };

  if (place.facility === null) {
    return <section><a href="#current_stock">{t(lang, 'back')}</a>{place.notice}</section>;
  }
  if (decision === null) {
    return (
      <section>
        <a href="#current_stock">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const pack = (unitKey: string, factor: string) => `${unitName(lang, data.units, unitKey)} (${formatFactor(factor)})`;
  const person = (id: string) => (id === data.person.person_id
    ? (localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar }) || shortId(id))
    : shortId(id));

  return (
    <section>
      <a href="#current_stock">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1>{label(lang, `stock_kind_${decision.kind}`)} · {formatRiyadh(lang, decision.occurred_at)}</h1>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      <dl className="facts">
        <dt>{t(lang, 'business_date')}</dt><dd><bdi dir="ltr">{decision.business_date}</bdi></dd>
        <dt>{t(lang, 'reason')}</dt><dd><bdi>{decision.reason}</bdi></dd>
        {decision.override_reason !== null
          ? <><dt>{t(lang, 'override_reason')}</dt><dd><bdi>{decision.override_reason}</bdi></dd></> : null}
        <dt>{t(lang, 'decided_by')}</dt><dd dir="ltr" title={decision.actor_id}>{person(decision.actor_id)}</dd>
        <dt>{t(lang, 'decided_at')}</dt><dd>{formatRiyadh(lang, decision.decided_at)}</dd>
        {decision.reverses_decision_id !== null ? (
          <><dt>{t(lang, 'reverses')}</dt><dd><a href={`#current_stock/decisions/${decision.reverses_decision_id}`}>{t(lang, 'open_decision')}</a></dd></>
        ) : null}
        {decision.reversed_by_decision_id !== null ? (
          <><dt>{t(lang, 'reversed_by')}</dt><dd><a href={`#current_stock/decisions/${decision.reversed_by_decision_id}`}>{t(lang, 'open_decision')}</a></dd></>
        ) : null}
      </dl>

      {decision.counted.length > 0 ? (
        <>
          <h2>{t(lang, 'counted_lines')}</h2>
          <table className="table">
            <thead><tr><th>{t(lang, 'item_code')}</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'quantity')}</th><th>{t(lang, 'base_quantity')}</th></tr></thead>
            <tbody>
              {decision.counted.map((c) => (
                <tr key={c.line_no}>
                  <td className="code"><a href={`#current_stock/items/${c.item_id}`} dir="ltr">{c.code}</a></td>
                  <td>{pack(c.unit_key, c.factor)}</td>
                  <td><bdi dir="ltr">{formatQuantity(c.quantity)}</bdi></td>
                  <td><bdi dir="ltr">{formatQuantity(c.base_quantity)}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>{decision.kind === 'count' ? t(lang, 'count_variances') : t(lang, 'posted_lines')}</h2>
      {decision.entries.length === 0 ? <p className="muted">{t(lang, 'count_found_the_book')}</p> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'item_code')}</th><th>{t(lang, 'pack')}</th><th>{t(lang, 'direction')}</th><th>{t(lang, 'quantity')}</th><th>{t(lang, 'base_quantity')}</th></tr>
          </thead>
          <tbody>
            {decision.entries.map((e) => (
              <tr key={e.line_no}>
                <td className="code"><a href={`#current_stock/items/${e.item_id}`} dir="ltr">{e.code}</a></td>
                <td>{pack(e.unit_key, e.factor)}</td>
                <td>{t(lang, e.direction === 'in' ? 'direction_in' : 'direction_out')}</td>
                <td><bdi dir="ltr">{formatQuantity(e.quantity)}</bdi></td>
                <td><bdi dir="ltr">{formatQuantity(e.base_quantity)}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {writableHere(ctx.stockWritable, status) && reversible(decision)
        ? <Reverse ctx={ctx} facilityId={place.facility.facility_id} target={decision.decision_id} onDone={afterWrite} /> : null}
      {decision.kind === 'count' ? <p className="muted">{t(lang, 'count_not_reversed')}</p> : null}
    </section>
  );
}

/**
 * Undoes a movement, dated at the moment it undoes (ADR-0029 §5). Refused once a count has
 * covered it: the count corrected it already. A reversal that would take stock below zero
 * needs the override, as any movement does (D1).
 */
function Reverse({ ctx, facilityId, target, onDone }: { ctx: Ctx; facilityId: string; target: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const w = useWrite(ctx, () => ctx.api.getStockDecision(facilityId, target), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
    setOverride('');
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = target;
    const body = reversalBody(ids, { facilityId, reason, overrideReason: ctx.stockOverride ? override : '' });
    void w.run(() => api.reverseStockDecision(id, body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOverride(''); setOpen(true); }}>{t(lang, 'reverse_decision')}</button>;
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'reverse_decision')}</h3>
      <p className="muted">{t(lang, 'reverse_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.failure?.constraint === WOULD_GO_NEGATIVE && !ctx.stockOverride ? <Notice tone="info" text={t(lang, 'override_not_held')} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        {ctx.stockOverride ? (
          <Field label={t(lang, 'override_reason')} hint={t(lang, 'override_reason_hint')}>
            <input type="text" maxLength={500} value={override} onChange={(e) => setOverride(e.target.value)} />
          </Field>
        ) : null}
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'reverse_decision')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
