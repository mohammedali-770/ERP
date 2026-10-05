import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Failure, Item, ItemDecision, StatusInput } from '../api.ts';
import type { Ctx } from '../context.ts';
import { factorInput, formatDateTime, formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { addableUnits, factorIsDerived, isBaseUnit, unitName, unitSymbol } from '../items.ts';
import { ItemSuppliers } from './ItemSuppliers.tsx';
import type { Done } from '../write.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';
import { useWrite } from './useWrite.tsx';

type Banner = { tone: 'ok' | 'info'; text: string } | null;

/**
 * One item: what it is, its units, its status, and every decision ever recorded about it.
 * Changes are offered only where the database would accept them (Ctx.writable), and
 * every one carries ids minted when its form opened (ids.ts).
 */
export function ItemDetail({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, data, facilityId, onFailure } = ctx;
  const [item, setItem] = useState<Item | null>(null);
  const [history, setHistory] = useState<readonly ItemDecision[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  // Only the newest load may draw: two quick writes start two reloads, and the older one
  // landing last showed the earlier state (found in review).
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [i, h] = await Promise.all([api.getItem(facilityId, itemId), api.itemHistory(facilityId, itemId)]);
    if (mine !== seq.current) return;
    if (!i.ok) {
      if (!onFailure(i)) setFailure(i);
      return;
    }
    setItem(i.value);
    setFailure(null);
    if (h.ok) setHistory(h.value);
    else if (!onFailure(h)) setFailure(h);
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => {
    setItem(null);
    setHistory(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  /** After a write: say what happened, then show the item as the database now holds it. */
  const afterWrite: Done = (outcome) => {
    setBanner(outcome === 'checked' ? null : outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
      : outcome === 'already' ? { tone: 'info', text: t(lang, 'already_recorded') }
      : { tone: 'info', text: t(lang, 'refusal_stale') });
    void load();
  };

  if (item === null) {
    return (
      <section>
        <a href="#items">{t(lang, 'back')}</a>
        {failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />}
      </section>
    );
  }

  const brand = data.brands.find((b) => b.brand_id === item.brand_id);
  const canChange = ctx.writable && item.status === 'active';

  return (
    <section>
      <a href="#items">{t(lang, 'back')}</a>
      <header className="page-header">
        <h1><span dir="ltr">{item.code}</span> — {localName(lang, item)}</h1>
        {canChange ? (
          <div className="actions">
            <a className="button primary" href={`#items/${item.item_id}/edit`}>{t(lang, 'edit_item')}</a>
          </div>
        ) : null}
      </header>
      {banner ? <Notice tone={banner.tone} text={banner.text} /> : null}
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}

      <dl className="facts">
        <dt>{t(lang, 'item_kind')}</dt><dd>{label(lang, `kind_${item.item_kind}`)}</dd>
        <dt>{t(lang, 'base_unit')}</dt><dd>{unitName(lang, data.units, item.base_unit_key)}</dd>
        <dt>{t(lang, 'brand')}</dt><dd>{brand === undefined ? '' : localName(lang, brand)}</dd>
        <dt>{t(lang, 'status')}</dt>
        <dd>{item.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_retired')}</dd>
        {/* bdi: each value keeps its own direction and sits where the page's text starts. */}
        <dt>{t(lang, 'name_en')}</dt><dd><bdi>{item.name_en}</bdi></dd>
        <dt>{t(lang, 'name_ar')}</dt><dd><bdi>{item.name_ar}</bdi></dd>
        {item.description_en ? <><dt>{t(lang, 'description_en')}</dt><dd><bdi>{item.description_en}</bdi></dd></> : null}
        {item.description_ar ? <><dt>{t(lang, 'description_ar')}</dt><dd><bdi>{item.description_ar}</bdi></dd></> : null}
      </dl>

      <h2>{t(lang, 'units')}</h2>
      <table className="table">
        <thead>
          <tr><th>{t(lang, 'unit')}</th><th>{t(lang, 'factor')}</th><th>{t(lang, 'status')}</th><th /></tr>
        </thead>
        <tbody>
          {item.units.map((u) => (
            <tr key={u.item_unit_id} className={u.status === 'retired' ? 'retired' : undefined}>
              <td>{unitName(lang, data.units, u.unit_key)}</td>
              <td dir="ltr">1 {unitSymbol(lang, data.units, u.unit_key)} = {formatFactor(u.factor)} {unitSymbol(lang, data.units, item.base_unit_key)}</td>
              <td>{u.status === 'active' ? t(lang, 'status_active') : t(lang, 'unit_retired')}</td>
              <td>
                {canChange && u.status === 'active' && !isBaseUnit(item, u.unit_key)
                  ? <RetireUnit ctx={ctx} itemId={item.item_id} itemUnitId={u.item_unit_id} onDone={afterWrite} />
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canChange ? <AddUnit ctx={ctx} item={item} onDone={afterWrite} /> : null}
      {ctx.seesTransferPrices ? <p><a className="button" href={`#transfer_prices/${item.item_id}`}>{t(lang, 'prices_link')}</a></p> : null}

      {ctx.writable ? <StatusChange ctx={ctx} item={item} onDone={afterWrite} /> : null}

      {ctx.seesSuppliers ? <ItemSuppliers ctx={ctx} itemId={item.item_id} /> : null}

      <h2>{t(lang, 'history')}</h2>
      {history === null ? <Loading lang={lang} /> : (
        <table className="table">
          <thead>
            <tr><th>{t(lang, 'decided_at')}</th><th>{t(lang, 'decision')}</th><th>{t(lang, 'reason')}</th><th>{t(lang, 'decided_by')}</th></tr>
          </thead>
          <tbody>
            {[...history].reverse().map((d) => (
              <tr key={d.decision_id}>
                <td>{formatDateTime(lang, d.decided_at)}</td>
                <td>
                  {label(lang, `kind_${d.kind}`)}
                  {d.unit_key ? <> · {unitName(lang, data.units, d.unit_key)} ({formatFactor(d.factor)})</> : null}
                  {d.kind === 'item_status_changed' ? <> · {d.status === 'active' ? t(lang, 'status_active') : t(lang, 'status_retired')}</> : null}
                </td>
                {/* bdi: an English reason in an Arabic page keeps its full stop at its end. */}
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
 * The item a sub-form's Start over reads. Once it can be read, whatever a lost attempt
 * did is visible, and a new decision is safe under new ids: the database refuses a second
 * active unit, a second retirement and a stale status change.
 */
const seeItem = (ctx: Ctx, itemId: string) => () => ctx.api.getItem(ctx.facilityId, itemId);

const UNIT_IDS = ['decision_id', 'item_unit_id'] as const;

function AddUnit({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: Done }) {
  const { api, lang, data } = ctx;
  const choices = addableUnits(item, data.units);
  const [ids, setIds] = useState(() => formIds(UNIT_IDS));
  const [unitKey, setUnitKey] = useState('');
  const [factor, setFactor] = useState('');
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, seeItem(ctx, item.item_id), onDone, () => {
    setIds(formIds(UNIT_IDS));
    setUnitKey('');
    setFactor('');
    setReason('');
  });
  const derived = unitKey !== '' && factorIsDerived(item, data.units, unitKey);

  /** Built once, here: Retry resends this request, never one rebuilt from the fields (found in review). */
  function submit(e?: FormEvent) {
    e?.preventDefault();
    const f = factorInput(factor);
    if (!f.ok) {
      w.show({ ok: false, http: 400, status: 'malformed', field: 'factor', message: null, constraint: null, detail: null });
      return;
    }
    const id = item.item_id;
    const body = { ...ids, unit_key: unitKey, factor: f.value, reason: reason.trim() };
    void w.run(() => api.addUnit(id, body));
  }

  if (choices.length === 0) return null;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'add_unit')}</h3>
      <p className="muted">{t(lang, 'add_unit_hint')}</p>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
      <Field label={t(lang, 'unit')}>
        <select required value={unitKey} onChange={(e) => setUnitKey(e.target.value)}>
          <option value="" disabled>—</option>
          {choices.map((u) => <option key={u.unit_key} value={u.unit_key}>{lang === 'ar' ? u.name_ar : u.name_en}</option>)}
        </select>
      </Field>
      <Field label={`${t(lang, 'factor')} (${unitSymbol(lang, data.units, item.base_unit_key)})`} hint={t(lang, 'factor_hint')}>
        <input
          inputMode="decimal"
          dir="ltr"
          required={unitKey !== '' && !derived}
          maxLength={19}
          value={factor}
          onChange={(e) => setFactor(e.target.value)}
        />
      </Field>
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'add_unit')}</button>
      </fieldset>
    </form>
  );
}

function RetireUnit({ ctx, itemId, itemUnitId, onDone }: { ctx: Ctx; itemId: string; itemUnitId: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, seeItem(ctx, itemId), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = { ...ids, reason: reason.trim() };
    void w.run(() => api.retireUnit(itemUnitId, body));
  }

  if (!open) return <button type="button" className="small" onClick={() => setOpen(true)}>{t(lang, 'retire_unit')}</button>;
  return (
    <form className="inline-form compact" onSubmit={submit}>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className="danger small" disabled={w.busy}>{w.busy ? t(lang, 'saving') : t(lang, 'retire_unit')}</button>
      <button type="button" className="small" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}

function StatusChange({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: Done }) {
  const { api, lang } = ctx;
  // Fixed when the form opens: a reload while it is open (another form on the page saving
  // or starting over) must not turn a "retire" into a "reinstate" under the person's hand,
  // with the newer stamp to carry it past the stale check (found in review).
  const [opened, setOpened] = useState<'retired' | 'active' | null>(null);
  const target = opened ?? (item.status === 'active' ? 'retired' : 'active');
  const open = opened !== null;
  const setOpen = (v: boolean) => setOpened(v ? (item.status === 'active' ? 'retired' : 'active') : null);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const w = useWrite(ctx, seeItem(ctx, item.item_id), onDone, () => {
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const id = item.item_id;
    const body: StatusInput = { ...ids, expected_decision_id: item.as_of_decision_id, status: target, reason: reason.trim() };
    void w.run(() => api.changeStatus(id, body));
  }

  const verb = target === 'retired' ? t(lang, 'retire_item') : t(lang, 'reinstate_item');
  if (!open) {
    return (
      <p>
        <button type="button" className={target === 'retired' ? 'danger' : undefined} onClick={() => setOpen(true)}>{verb}</button>
      </p>
    );
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{verb}</h3>
      {w.failure ? <FailureNotice lang={lang} failure={w.failure} /> : null}
      {w.inDoubt ? <InDoubt lang={lang} busy={w.busy} onRetry={w.retry} onStartOver={() => void w.startOver()} /> : null}
      <fieldset className="plain" disabled={w.locked}>
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={target === 'retired' ? 'danger' : 'primary'} disabled={w.busy}>
        {w.busy ? t(lang, 'saving') : verb}
      </button>
      <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
      </fieldset>
    </form>
  );
}
