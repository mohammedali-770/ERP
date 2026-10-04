import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Failure, Item, ItemDecision } from '../api.ts';
import type { Ctx } from '../context.ts';
import { factorInput, formatDateTime, formatFactor, shortId } from '../format.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { addableUnits, factorIsDerived, isBaseUnit, unitName, unitSymbol, writeOutcome } from '../items.ts';
import { FailureNotice, Field, Loading, Notice, ReasonField } from './ui.tsx';

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

  const load = useCallback(async () => {
    const [i, h] = await Promise.all([api.getItem(facilityId, itemId), api.itemHistory(facilityId, itemId)]);
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
  }, [load]);

  /** After a write: say what happened, then show the item as the database now holds it. */
  const afterWrite = (outcome: 'saved' | 'already' | 'stale') => {
    setBanner(outcome === 'saved' ? { tone: 'ok', text: t(lang, 'saved') }
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
                  ? <RetireUnit ctx={ctx} itemUnitId={u.item_unit_id} onDone={afterWrite} />
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canChange ? <AddUnit ctx={ctx} item={item} onDone={afterWrite} /> : null}

      {ctx.writable ? <StatusChange ctx={ctx} item={item} onDone={afterWrite} /> : null}

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
                <td>{d.reason}</td>
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

type Done = (outcome: 'saved' | 'already' | 'stale') => void;

function AddUnit({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: Done }) {
  const { api, lang, data } = ctx;
  const choices = addableUnits(item, data.units);
  const [ids, setIds] = useState(() => formIds(['decision_id', 'item_unit_id'] as const));
  const [unitKey, setUnitKey] = useState('');
  const [factor, setFactor] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const derived = unitKey !== '' && factorIsDerived(item, data.units, unitKey);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const f = factorInput(factor);
    if (!f.ok) {
      setFailure({ ok: false, http: 400, status: 'malformed', field: 'factor', message: null, constraint: null, detail: null });
      return;
    }
    setBusy(true);
    setFailure(null);
    const answer = await api.addUnit(item.item_id, { ...ids, unit_key: unitKey, factor: f.value, reason: reason.trim() });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    setIds(formIds(['decision_id', 'item_unit_id'] as const));
    setUnitKey('');
    setFactor('');
    setReason('');
    onDone(outcome);
  }

  if (choices.length === 0) return null;
  return (
    <form className="inline-form" onSubmit={submit}>
      <h3>{t(lang, 'add_unit')}</h3>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
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
      <button type="submit" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'add_unit')}</button>
    </form>
  );
}

function RetireUnit({ ctx, itemUnitId, onDone }: { ctx: Ctx; itemUnitId: string; onDone: Done }) {
  const { api, lang } = ctx;
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    const answer = await api.retireUnit(itemUnitId, { ...ids, reason: reason.trim() });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    onDone(outcome);
  }

  if (!open) return <button type="button" className="small" onClick={() => setOpen(true)}>{t(lang, 'retire_unit')}</button>;
  return (
    <form className="inline-form compact" onSubmit={submit}>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className="danger small" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'retire_unit')}</button>
      <button type="button" className="small" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
    </form>
  );
}

function StatusChange({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: Done }) {
  const { api, lang } = ctx;
  const target = item.status === 'active' ? 'retired' : 'active';
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => formIds(['decision_id'] as const));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    const answer = await api.changeStatus(item.item_id, {
      ...ids, expected_decision_id: item.as_of_decision_id, status: target, reason: reason.trim(),
    });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'failed') {
      if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
      return;
    }
    setIds(formIds(['decision_id'] as const));
    setOpen(false);
    setReason('');
    onDone(outcome);
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
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      <ReasonField lang={lang} value={reason} onChange={setReason} />
      <button type="submit" className={target === 'retired' ? 'danger' : 'primary'} disabled={busy}>
        {busy ? t(lang, 'saving') : verb}
      </button>
      <button type="button" onClick={() => setOpen(false)}>{t(lang, 'cancel')}</button>
    </form>
  );
}
