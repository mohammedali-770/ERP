import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Answer, Failure, Item, ItemPrice, PriceDecision } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { isUnanswered, unitName, writeOutcome } from '../items.ts';
import {
  byPack, formatMinor, formatRiyadh, momentInput, priceablePacks, priceInput, priceState, setPriceBody, withdrawable,
} from '../transfer-prices.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/** What a form reports: a write's outcome, or 'checked' after a fresh look at what is saved. */
type Done = (outcome: 'saved' | 'already' | 'stale' | 'checked') => void;

/**
 * One item's transfer prices, pack by pack: every price ever set, newest moment first,
 * the one in force marked, and every decision about them (0018). A price is never edited
 * or deleted: a new one is set from a later moment, and one not yet in effect may be
 * withdrawn. Changes are offered only where the database would accept them
 * (Ctx.transferPricesWritable), each carrying ids minted when its form opened (ids.ts).
 */
export function ItemPrices({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, data, facilityId, onFailure } = ctx;
  const [item, setItem] = useState<Item | null>(null);
  const [prices, setPrices] = useState<readonly ItemPrice[] | null>(null);
  const [history, setHistory] = useState<readonly PriceDecision[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  // Only the newest load may draw, as on the item and supplier pages.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [i, p, h] = await Promise.all([
      api.getItem(facilityId, itemId), api.itemTransferPrices(facilityId, itemId), api.transferPriceHistory(facilityId, itemId),
    ]);
    if (mine !== seq.current) return;
    for (const a of [i, p, h]) {
      if (!a.ok) {
        if (!onFailure(a)) setFailure(a);
        return;
      }
    }
    if (i.ok && p.ok && h.ok) {
      setItem(i.value);
      setPrices(p.value);
      setHistory(h.value);
      setFailure(null);
    }
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => {
    setItem(null);
    setPrices(null);
    setHistory(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : { tone: 'info', text: t(lang, 'price_already_recorded') });
    void load();
  };

  if (item === null || prices === null || history === null) {
    return (
      <section>
        <a href="#transfer_prices">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const writable = ctx.transferPricesWritable;
  const now = Date.now();
  const packs = byPack(prices);
  // Every pack with a price on record, active or not, then the active ones without one.
  const shown = [
    ...item.units.filter((u) => packs.has(u.item_unit_id)),
    ...item.units.filter((u) => !packs.has(u.item_unit_id) && u.status === 'active'),
  ];
  const packLabel = (unitKey: string, factor: number | string) =>
    `${unitName(lang, data.units, unitKey)} (${formatFactor(factor)} ${unitName(lang, data.units, item.base_unit_key)})`;

  return (
    <section>
      <a href="#transfer_prices">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1>{t(lang, 'item_prices', { code: item.code })} — {localName(lang, item)}</h1>
        <div className="actions"><a className="button" href={`#items/${item.item_id}`}>{t(lang, 'items')}</a></div>
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {!writable ? <Notice tone="info" text={t(lang, 'read_only_prices')} /> : null}
      {item.status === 'retired' ? <p className="muted">{t(lang, 'rule_item_retired')}</p> : null}

      {prices.length === 0 ? <p className="muted">{t(lang, 'no_prices')}</p> : null}
      {shown.map((u) => (
        <div key={u.item_unit_id} className={u.status === 'retired' ? 'retired' : undefined}>
          <h2>
            {packLabel(u.unit_key, u.factor)}
            {u.status === 'retired' ? <> · <em>{t(lang, 'price_hidden_for_retired_pack')}</em></> : null}
          </h2>
          {(packs.get(u.item_unit_id) ?? []).length === 0 ? <p><em>{t(lang, 'unpriced')}</em></p> : (
            <table className="table">
              <thead>
                <tr><th>{t(lang, 'price')}</th><th>{t(lang, 'effective_from')}</th><th>{t(lang, 'status')}</th><th /></tr>
              </thead>
              <tbody>
                {(packs.get(u.item_unit_id) ?? []).map((p) => {
                  const state = priceState(p, now);
                  return (
                    <tr key={p.price_id} className={state === 'withdrawn' || state === 'past' ? 'retired' : undefined}>
                      <td><bdi dir="ltr">{formatMinor(lang, p.price_minor, p.currency)}</bdi></td>
                      <td>{formatRiyadh(lang, p.effective_from)}</td>
                      <td>{t(lang, `price_${state}`)}</td>
                      <td>{writable && withdrawable(p, now) ? <Withdraw ctx={ctx} price={p} itemId={item.item_id} onDone={afterWrite} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {writable && item.status === 'active' ? <SetPrice ctx={ctx} item={item} onDone={afterWrite} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history.length === 0 ? <p className="muted">{t(lang, 'no_prices')}</p> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
          </thead>
          <tbody>
            {[...history].reverse().map((d) => (
              <tr key={d.decision_id}>
                {/* Riyadh's clock, as every moment on this page: a browser elsewhere must not mix two zones. */}
                <td>{formatRiyadh(lang, d.decided_at)}</td>
                <td>
                  {label(lang, `kind_${d.kind}`)} · {packLabel(d.unit_key, d.factor)} ·{' '}
                  <bdi dir="ltr">{formatMinor(lang, d.price_minor, d.currency)}</bdi> · {formatRiyadh(lang, d.effective_from)}
                </td>
                <td><bdi>{d.reason}</bdi></td>
                <td dir="ltr" title={d.actor_id}>{d.actor_id === data.person.person_id ? (localName(lang, {
                  name_en: data.person.full_name_en, name_ar: data.person.full_name_ar,
                }) || shortId(d.actor_id)) : shortId(d.actor_id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * After an unanswered write: can the prices be read now? Then whatever the lost attempt
 * did is visible, and a new decision under new ids is safe — the database refuses a
 * second price for one moment, a price that changes nothing and a second withdrawal.
 */
async function seeWhatIsSaved(ctx: Ctx, itemId: string): Promise<boolean> {
  const now = await ctx.api.itemTransferPrices(ctx.facilityId, itemId);
  if (now.ok) return true;
  ctx.onFailure(now);
  return false;
}

type Send = () => Promise<Answer<unknown>>;

/**
 * One form's write lifecycle, as on the supplier page. The request is built ONCE, when the
 * person presses the button, and Retry resends exactly that request: same ids, same body.
 * Start over looks at what is saved first.
 */
function useWrite(ctx: Ctx, itemId: string, onDone: Done, after: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [inDoubt, setInDoubt] = useState(false);
  const pending = useRef<Send | null>(null);
  async function run(send: Send) {
    pending.current = send;
    setBusy(true);
    setFailure(null);
    const answer = await send();
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (isUnanswered(answer)) setInDoubt(true);
      else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    pending.current = null;
    setInDoubt(false);
    after();
    onDone(outcome);
  }
  /** The same request again: never rebuilt from what the page shows now. */
  function retry() {
    if (pending.current !== null) void run(pending.current);
  }
  async function startOver() {
    setBusy(true);
    const seen = await seeWhatIsSaved(ctx, itemId);
    setBusy(false);
    if (!seen) return;
    pending.current = null;
    setInDoubt(false);
    after();
    onDone('checked');
  }
  return { busy, failure, inDoubt, run, retry, startOver };
}

const PRICE_IDS = ['decision_id', 'price_id'] as const;

/**
 * A price for one pack, from now or from a moment ahead. The amount is typed in riyals
 * and sent as whole halalas; the moment is typed as a Riyadh date and time and sent with
 * its offset (transfer-prices.ts).
 */
function SetPrice({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: Done }) {
  const { api, lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(PRICE_IDS));
  const packs = priceablePacks(item.units);
  const [unitId, setUnitId] = useState(packs.length === 1 ? packs[0]!.item_unit_id : '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('00:00');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<'amount' | 'moment' | null>(null);
  const w = useWrite(ctx, item.item_id, onDone, () => {
    setIds(formIds(PRICE_IDS));
    setAmount('');
    setDate('');
    setTime('00:00');
    setReason('');
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const price = priceInput(amount);
    const moment = momentInput(date, time);
    if (!price.ok) return setProblem('amount');
    if (!moment.ok) return setProblem('moment');
    setProblem(null);
    const body = setPriceBody(ids, { itemUnitId: unitId, priceMinor: price.value, effectiveFrom: moment.value, reason });
    void w.run(() => api.setTransferPrice(body));
  }

  if (packs.length === 0) return null;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'set_price')}</h3>
      <p className="muted">{t(lang, 'set_price_hint')}</p>
      {problem === 'amount' ? <Notice tone="error" text={t(lang, 'price_bad_amount')} /> : null}
      {problem === 'moment' ? <Notice tone="error" text={t(lang, 'price_bad_moment')} /> : null}
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
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
        <Field label={t(lang, 'price')} hint={t(lang, 'price_hint')}>
          <input dir="ltr" inputMode="decimal" required maxLength={13} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t(lang, 'effective_date')} hint={t(lang, 'effective_date_hint')}>
          <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {date !== '' ? (
          <Field label={t(lang, 'effective_time')}>
            <input type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        ) : null}
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="primary" disabled={w.busy || unitId === ''}>
          {w.busy ? t(lang, 'saving') : t(lang, 'set_price')}
        </button>
      </fieldset>
    </form>
  );
}

/** Takes back a price set ahead, before its moment comes. A withdrawal is final. */
function Withdraw({ ctx, price, itemId, onDone }: { ctx: Ctx; price: ItemPrice; itemId: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, itemId, onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = price.price_id;
    const body = { decision_id: ids.decision_id, reason: reason.trim() };
    void w.run(() => api.withdrawTransferPrice(id, body));
  }

  if (!open) {
    return <button type="button" className="small danger" onClick={() => { setReason(''); setOpen(true); }}>{t(lang, 'withdraw_price')}</button>;
  }
  return (
    <form className="inline-form compact" onSubmit={submit}>
      <p className="muted">{t(lang, 'withdraw_price_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.inDoubt}>
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <button type="submit" className="danger small" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'withdraw_price')}</button>
        <button type="button" className="small" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
