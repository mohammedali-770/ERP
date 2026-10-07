import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Failure, Item, MinimumDecision, MinimumRow, StockBalance } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { unitName } from '../items.ts';
import { findBalance, formatQuantity, isNegative, writableHere } from '../stock.ts';
import {
  clearMinimumBody, currentMinimum, minimumInput, minimumPacks, setMinimumBody, stampOf,
} from '../stock-alerts.ts';
import { formatRiyadh } from '../transfer-prices.ts';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { stockPlace, useFacilityStatus } from './StockList.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/**
 * The minimums at the facility worked at (erp.stock_minimums(), 0022), by item code: each
 * as entered and in the base unit, beside what is on hand, low ones marked. It lists the
 * low ones alone by default (A2: always listed); unticked, every minimum, by code. A
 * minimum is set from an item's own page, found here by code or name.
 */
export function StockAlertsList({ ctx }: { ctx: Ctx }) {
  const { api, lang, data } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const writable = writableHere(ctx.stockAlertsWritable, status);
  const [lowOnly, setLowOnly] = useState(true);
  const [rows, setRows] = useState<readonly MinimumRow[] | null>(null);
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
    if (facilityId === null) return;
    void api.stockMinimums({ facilityId, lowOnly }).then((answer) => {
      if (mine !== seq.current) return;
      if (answer.ok) {
        setRows(answer.value.minimums);
        setNext(answer.value.next_after);
      } else if (!ctx.onFailure(answer)) {
        setFailure(answer);
      }
    });
    return () => {
      seq.current++;
    };
  }, [api, facilityId, lowOnly]);

  async function more() {
    if (next === null || facilityId === null) return;
    const mine = ++seq.current;
    setLoadingMore(true);
    const answer = await api.stockMinimums({ facilityId, lowOnly, after: next });
    if (mine !== seq.current) return;
    setLoadingMore(false);
    if (answer.ok) {
      setRows((current) => [...(current ?? []), ...answer.value.minimums]);
      setNext(answer.value.next_after);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  if (place.facility === null) {
    return (
      <section>
        <header className="page-header"><h1>{t(lang, 'stock_alerts')}</h1></header>
        {place.notice}
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t(lang, 'stock_alerts_at', { code: place.facility.code })} — {localName(lang, place.facility)}</h1>
      </header>
      <p className="muted">{t(lang, 'stock_alerts_hint')}</p>
      {status === 'closed' ? <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />
        : !writable ? <Notice tone="info" text={t(lang, 'read_only_minimums')} /> : null}

      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          {t(lang, 'low_only')}
        </label>
      </div>

      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {rows === null && failure === null ? <Loading lang={lang} /> : null}
      {rows !== null && rows.length === 0 ? <p className="muted">{t(lang, lowOnly ? 'none_low' : 'no_minimums')}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t(lang, 'item_code')}</th>
              <th>{lang === 'ar' ? t(lang, 'name_ar') : t(lang, 'name_en')}</th>
              <th>{t(lang, 'on_hand')}</th>
              <th>{t(lang, 'minimum')}</th>
              <th>{t(lang, 'status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const base = unitName(lang, data.units, r.base_unit_key);
              return (
                <tr key={r.item_id} className={r.item_status === 'retired' ? 'retired' : undefined}>
                  <td className="code"><a href={`#stock_alerts/items/${r.item_id}`} dir="ltr">{r.code}</a></td>
                  <td>{localName(lang, r)}{r.item_status === 'retired' ? <> · <em>{t(lang, 'status_retired')}</em></> : null}</td>
                  <td className={isNegative(r.on_hand) ? 'negative' : undefined}>
                    <bdi dir="ltr">{formatQuantity(r.on_hand)}</bdi> {base}
                  </td>
                  <td>
                    <bdi dir="ltr">{formatQuantity(r.minimum)}</bdi> {base}
                    {r.unit_key !== r.base_unit_key ? (
                      <div className="muted">
                        <bdi dir="ltr">{formatQuantity(r.quantity)}</bdi> {unitName(lang, data.units, r.unit_key)}
                      </div>
                    ) : null}
                  </td>
                  <td>{r.is_low ? <strong className="negative">{t(lang, 'minimum_status_low')}</strong> : t(lang, 'minimum_status_ok')}</td>
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

      {writable ? <ItemChooser ctx={ctx} facilityId={place.facility.facility_id} /> : null}
    </section>
  );
}

/** Finds an item of the facility's brand by code or name, and opens its minimum. */
function ItemChooser({ ctx, facilityId }: { ctx: Ctx; facilityId: string }) {
  const { api, lang } = ctx;
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<readonly Item[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const seq = useRef(0);

  async function find(e?: FormEvent) {
    e?.preventDefault();
    const q = search.trim();
    if (q === '') return;
    const mine = ++seq.current;
    // A minimum is new work on an item: only active ones take one (0022).
    const answer = await api.listItems({ facilityId, status: 'active', search: q, limit: 20 });
    if (mine !== seq.current) return;
    if (answer.ok) {
      setFound(answer.value.items);
      setFailure(null);
    } else if (!ctx.onFailure(answer)) {
      setFailure(answer);
    }
  }

  return (
    <form className="inline-form" onSubmit={(e) => void find(e)}>
      <h2>{t(lang, 'set_minimum_for')}</h2>
      <Field label={t(lang, 'find_item')} hint={t(lang, 'find_item_minimum_hint')}>
        <input type="search" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <button type="submit" className="small">{t(lang, 'search')}</button>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {found !== null && found.length === 0 ? <p className="muted">{t(lang, 'no_items_match')}</p> : null}
      {found !== null && found.length > 0 ? (
        <ul className="plain-list">
          {found.map((i) => (
            <li key={i.item_id}>
              <a className="button small" href={`#stock_alerts/items/${i.item_id}`}>{t(lang, 'open_minimum')}</a>{' '}
              <bdi dir="ltr">{i.code}</bdi> — {localName(lang, i)}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/**
 * One item's minimum at the facility worked at: what is on hand, the minimum in force as
 * entered, every decision about it (erp.stock_minimum_history(), 0022), and, where the
 * person may, a form to set it and one to clear it. Both are checked against the decision
 * in force, which the history marks (stock-alerts.ts, stampOf).
 */
export function StockAlertItem({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, data, onFailure } = ctx;
  const place = stockPlace(ctx);
  const facilityId = place.facility?.facility_id ?? null;
  const status = useFacilityStatus(ctx, facilityId);
  const writable = writableHere(ctx.stockAlertsWritable, status);
  const [item, setItem] = useState<Item | null>(null);
  const [balance, setBalance] = useState<StockBalance | null | undefined>(undefined);
  const [history, setHistory] = useState<readonly MinimumDecision[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True from a write's answer until the page has read what it left: the forms are not
  // offered meanwhile, as their stamp would be the one before the write (found in review).
  const [reloading, setReloading] = useState(false);
  // Only the newest load may draw; an older page is kept only if no load began after it
  // was asked, as its cursor is that load's (found in review).
  const seq = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (facilityId === null) return;
    const mine = ++seq.current;
    generation.current++;
    setLoadingMore(false);
    const i = await api.getItem(facilityId, itemId);
    if (mine !== seq.current) return;
    if (!i.ok) {
      if (!onFailure(i)) setFailure(i);
      return;
    }
    const code = i.value.code;
    const [b, h] = await Promise.all([
      findBalance((after) => api.stockOnHand({ facilityId, search: code, after, limit: 100 }), itemId, code),
      api.stockMinimumHistory(facilityId, itemId),
    ]);
    if (mine !== seq.current) return;
    for (const a of [b, h]) {
      if (!a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (b.ok && h.ok) {
      setItem(i.value);
      setBalance(b.value);
      setHistory(h.value.decisions);
      setNext(h.value.next_before);
      setFailure(null);
      setReloading(false);
    }
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => {
    setItem(null);
    setBalance(undefined);
    setHistory(null);
    setNext(null);
    setLoadingMore(false);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  async function older() {
    if (next === null || facilityId === null || reloading) return;
    const mine = generation.current;
    setLoadingMore(true);
    const answer = await api.stockMinimumHistory(facilityId, itemId, next);
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
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'minimum_already_recorded') }
        : { tone: 'info', text: t(lang, 'minimum_changed') });
    setReloading(true);
    void load();
  };

  if (place.facility === null) {
    return <section><a href="#stock_alerts">{t(lang, 'back')}</a>{place.notice}</section>;
  }
  if (item === null || history === null || balance === undefined) {
    return (
      <section>
        <a href="#stock_alerts">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const base = unitName(lang, data.units, item.base_unit_key);
  const current = currentMinimum(history);
  const stamp = stampOf(history);
  const onHand = balance === null ? '0' : balance.on_hand;
  const person = (id: string) => (id === data.person.person_id
    ? (localName(lang, { name_en: data.person.full_name_en, name_ar: data.person.full_name_ar }) || shortId(id))
    : shortId(id));
  const asEntered = (d: MinimumDecision) => (d.unit_key === null || d.quantity === null || d.factor === null ? null : (
    <>
      <bdi dir="ltr">{formatQuantity(d.quantity)}</bdi> {unitName(lang, data.units, d.unit_key)}{' '}
      ({unitName(lang, data.units, d.unit_key)} = <bdi dir="ltr">{formatFactor(d.factor)}</bdi> {base})
    </>
  ));

  return (
    <section>
      <a href="#stock_alerts">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><bdi dir="ltr">{item.code}</bdi> — {localName(lang, item)}</h1>
        <div className="actions">
          {ctx.seesStock ? <a className="button" href={`#current_stock/items/${item.item_id}`}>{t(lang, 'stock_card')}</a> : null}
        </div>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {status === 'closed' ? <Notice tone="info" text={t(lang, 'rule_facility_no_new_work')} />
        : !writable ? <Notice tone="info" text={t(lang, 'read_only_minimums')} /> : null}

      <p>
        {t(lang, 'stock_at', { code: place.facility.code })}:{' '}
        <strong className={isNegative(onHand) ? 'negative' : undefined}><bdi dir="ltr">{formatQuantity(onHand)}</bdi> {base}</strong>
        {balance === null ? <span className="muted"> · {t(lang, 'no_stock_record')}</span> : null}
      </p>
      <p>
        {t(lang, 'minimum')}:{' '}
        {current === null || current.minimum === null ? <em>{t(lang, 'no_minimum')}</em> : (
          <>
            <strong><bdi dir="ltr">{formatQuantity(current.minimum)}</bdi> {base}</strong>
            {current.unit_key !== item.base_unit_key ? <span className="muted"> · {asEntered(current)}</span> : null}
          </>
        )}
      </p>

      {reloading ? <Loading lang={lang} /> : null}
      {writable && !reloading && item.status === 'active'
        ? <SetMinimum ctx={ctx} item={item} facilityId={place.facility.facility_id} stamp={stamp} onDone={afterWrite} /> : null}
      {writable && !reloading && current !== null && stamp !== null
        ? <ClearMinimum ctx={ctx} item={item} facilityId={place.facility.facility_id} stamp={stamp} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'minimum_history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'no_minimum_history')}</p> : (
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
                  {d.minimum !== null ? <> · <bdi dir="ltr">{formatQuantity(d.minimum)}</bdi> {base}</> : null}
                  {d.unit_key !== null && d.unit_key !== item.base_unit_key ? <div className="muted">{asEntered(d)}</div> : null}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id}>{person(d.actor_id)}</td>
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
 * A minimum, in a current pack of the item, typed as decimal text and sent as typed,
 * checked against the stamp the page read when the button was pressed (write.ts: built
 * once, retried as sent).
 */
function SetMinimum({ ctx, item, facilityId, stamp, onDone }: {
  ctx: Ctx; item: Item; facilityId: string; stamp: string | null; onDone: Done;
}) {
  const { api, lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const packs = minimumPacks(item.units);
  const basePack = packs.find((u) => u.unit_key === item.base_unit_key)?.item_unit_id ?? '';
  const [unitId, setUnitId] = useState(basePack);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(false);
  // A pack retired since the form opened is no longer offered: never left chosen.
  useEffect(() => {
    if (unitId !== '' && !packs.some((u) => u.item_unit_id === unitId)) setUnitId('');
  }, [packs, unitId]);
  const w = useWrite(ctx, () => ctx.api.stockMinimumHistory(facilityId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setQuantity('');
    setReason('');
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = minimumInput(quantity);
    if (!q.ok) return setProblem(true);
    setProblem(false);
    const body = setMinimumBody(ids, { facilityId, itemUnitId: unitId, quantity: q.value, expectedDecisionId: stamp, reason });
    void w.run(() => api.setStockMinimum(body));
  }

  if (packs.length === 0) return null;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_minimum')}</h3>
      <p className="muted">{t(lang, 'set_minimum_hint')}</p>
      {problem ? <Notice tone="error" text={t(lang, 'minimum_bad_quantity')} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <Field label={t(lang, 'pack')}>
          <select required value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="" disabled>—</option>
            {packs.map((u) => (
              <option key={u.item_unit_id} value={u.item_unit_id}>
                {unitName(lang, data.units, u.unit_key)} = {formatFactor(u.factor)} {unitName(lang, data.units, item.base_unit_key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t(lang, 'minimum')} hint={t(lang, 'minimum_quantity_hint')}>
          <input dir="ltr" inputMode="decimal" required maxLength={19} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy || unitId === ''}>
          {w.busy ? t(lang, 'saving') : t(lang, 'set_minimum')}
        </button>
      </fieldset>
    </form>
  );
}

/** The item will have no minimum here. Against the stamp read, as a set is. */
function ClearMinimum({ ctx, item, facilityId, stamp, onDone }: {
  ctx: Ctx; item: Item; facilityId: string; stamp: string; onDone: Done;
}) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, () => ctx.api.stockMinimumHistory(facilityId, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = item.item_id;
    const body = clearMinimumBody(ids, { facilityId, expectedDecisionId: stamp, reason });
    void w.run(() => api.clearStockMinimum(id, body));
  }

  if (!open) {
    return <button type="button" className="danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'clear_minimum')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'clear_minimum_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'clear_minimum')}</button>
        <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
