import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Failure, Item } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { descriptionsPaired, isUnanswered, ITEM_KINDS, optional, unitName, writeOutcome } from '../items.ts';
import { brandsFor } from '../viewer.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

const CREATE_IDS = ['decision_id', 'item_id', 'base_unit_decision_id', 'base_item_unit_id'] as const;

/** A new item. Code, kind, storage unit and brand are chosen here once and never change. */
export function ItemCreate({ ctx }: { ctx: Ctx }) {
  const { api, lang, data, facilityId } = ctx;
  const brands = brandsFor(data, facilityId);
  const [ids, setIds] = useState(() => formIds(CREATE_IDS));
  const [inDoubt, setInDoubt] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('');
  const [baseUnit, setBaseUnit] = useState('');
  const [brand, setBrand] = useState(brands.length === 1 ? brands[0]!.brand_id : '');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descAr, setDescAr] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const [unpaired, setUnpaired] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setUnpaired(!descriptionsPaired(descEn, descAr));
    if (descriptionsPaired(descEn, descAr)) void send();
  }

  async function send() {
    setBusy(true);
    setFailure(null);
    const answer = await api.createItem({
      ...ids,
      brand_id: brand,
      code: code.trim(),
      item_kind: kind,
      base_unit_key: baseUnit,
      name_en: nameEn,
      name_ar: nameAr,
      description_en: optional(descEn),
      description_ar: optional(descAr),
      reason: reason.trim(),
    });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved') {
      ctx.navigate({ screen: 'item', itemId: ids.item_id });
      return;
    }
    // Created by an earlier attempt whose answer was lost: the item page shows what is saved.
    if (outcome === 'already') {
      ctx.navigate({ screen: 'item', itemId: ids.item_id }, t(lang, 'already_recorded'));
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  /** Is the item there? Then the lost attempt made it. If not, nothing was recorded. */
  async function startOver() {
    setBusy(true);
    const found = await api.getItem(null, ids.item_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'item', itemId: ids.item_id }, t(lang, 'already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(CREATE_IDS));
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  if (!ctx.writable) return <Notice tone="info" text={t(lang, 'read_only_here')} />;
  return (
    <section>
      <a href="#items">{t(lang, 'back')}</a>
      <h1>{t(lang, 'create_item')}</h1>
      <p className="muted">{t(lang, 'fixed_fields')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {unpaired ? <Notice tone="error" text={t(lang, 'rule_descriptions_paired')} /> : null}
      {inDoubt ? <InDoubt lang={lang} busy={busy} onRetry={() => void send()} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt}>
        <div className="grid">
          <Field label={t(lang, 'item_code')}>
            <input required maxLength={24} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="ITM-001" />
          </Field>
          <Field label={t(lang, 'brand')}>
            <select required value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="" disabled>—</option>
              {brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{localName(lang, b)}</option>)}
            </select>
          </Field>
          <Field label={t(lang, 'item_kind')}>
            <select required value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="" disabled>—</option>
              {ITEM_KINDS.map((k) => <option key={k} value={k}>{label(lang, `kind_${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t(lang, 'base_unit')}>
            <select required value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}>
              <option value="" disabled>—</option>
              {data.units.map((u) => <option key={u.unit_key} value={u.unit_key}>{unitName(lang, data.units, u.unit_key)}</option>)}
            </select>
          </Field>
        </div>
        <Names lang={lang} nameEn={nameEn} nameAr={nameAr} descEn={descEn} descAr={descAr}
          set={{ setNameEn, setNameAr, setDescEn, setDescAr }} />
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href="#items">{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

/** Names and descriptions, the only things an amendment changes. */
export function ItemEdit({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const { api, lang, facilityId, onFailure } = ctx;
  const [item, setItem] = useState<Item | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(() => {
    let live = true;
    void api.getItem(facilityId, itemId).then((answer) => {
      if (!live) return;
      if (answer.ok) setItem(answer.value);
      else if (!onFailure(answer)) setFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, onFailure, facilityId, itemId]);

  useEffect(() => load(), [load]);

  if (!ctx.writable) return <Notice tone="info" text={t(lang, 'read_only_here')} />;
  if (item === null) return failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />;
  // Keyed by the stamp: a reload after a stale refusal starts the form from the new state.
  return <AmendForm key={item.as_of_decision_id} ctx={ctx} item={item} onReload={() => void load()} />;
}

function AmendForm({ ctx, item, onReload }: { ctx: Ctx; item: Item; onReload: () => void }) {
  const { api, lang, data } = ctx;
  const [ids] = useState(() => formIds(['decision_id'] as const));
  const [inDoubt, setInDoubt] = useState(false);
  const [nameEn, setNameEn] = useState(item.name_en);
  const [nameAr, setNameAr] = useState(item.name_ar);
  const [descEn, setDescEn] = useState(item.description_en ?? '');
  const [descAr, setDescAr] = useState(item.description_ar ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const [unpaired, setUnpaired] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setUnpaired(!descriptionsPaired(descEn, descAr));
    if (descriptionsPaired(descEn, descAr)) void send();
  }

  async function send() {
    setBusy(true);
    setFailure(null);
    const answer = await api.amendItem(item.item_id, {
      ...ids,
      // The stamp the form was loaded from: a change made since is refused as stale,
      // never silently overwritten.
      expected_decision_id: item.as_of_decision_id,
      name_en: nameEn,
      name_ar: nameAr,
      description_en: optional(descEn),
      description_ar: optional(descAr),
      picture_path: item.picture_path,
      reason: reason.trim(),
    });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'item', itemId: item.item_id }, outcome === 'already' ? t(lang, 'already_recorded') : undefined);
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  /**
   * Has the item moved on from the state this form was loaded from? Then something was
   * recorded — this change or another — and the form restarts from what is saved, with
   * new ids. If not, nothing was, and the same ids are still unused.
   */
  async function startOver() {
    setBusy(true);
    const now = await api.getItem(ctx.facilityId, item.item_id);
    setBusy(false);
    if (!now.ok) {
      if (!ctx.onFailure(now)) setFailure(now);
      return;
    }
    setInDoubt(false);
    setFailure(null);
    if (now.value.as_of_decision_id !== item.as_of_decision_id) onReload();
  }

  return (
    <section>
      <a href={`#items/${item.item_id}`}>{t(lang, 'back')}</a>
      <h1>{t(lang, 'edit_item')} — <span dir="ltr">{item.code}</span></h1>
      <p className="muted">
        {label(lang, `kind_${item.item_kind}`)} · {unitName(lang, data.units, item.base_unit_key)} · {t(lang, 'fixed_fields')}
      </p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {failure?.status === 'stale' ? <button type="button" onClick={onReload}>{t(lang, 'reload')}</button> : null}
      {unpaired ? <Notice tone="error" text={t(lang, 'rule_descriptions_paired')} /> : null}
      {inDoubt ? <InDoubt lang={lang} busy={busy} onRetry={() => void send()} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt}>
        <Names lang={lang} nameEn={nameEn} nameAr={nameAr} descEn={descEn} descAr={descAr}
          set={{ setNameEn, setNameAr, setDescEn, setDescAr }} />
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href={`#items/${item.item_id}`}>{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

function Names({ lang, nameEn, nameAr, descEn, descAr, set }: {
  lang: Ctx['lang'];
  nameEn: string; nameAr: string; descEn: string; descAr: string;
  set: {
    setNameEn: (v: string) => void; setNameAr: (v: string) => void;
    setDescEn: (v: string) => void; setDescAr: (v: string) => void;
  };
}) {
  return (
    <div className="grid">
      <Field label={t(lang, 'name_en')}>
        <input required maxLength={200} dir="ltr" value={nameEn} onChange={(e) => set.setNameEn(e.target.value)} />
      </Field>
      <Field label={t(lang, 'name_ar')}>
        <input required maxLength={200} dir="rtl" value={nameAr} onChange={(e) => set.setNameAr(e.target.value)} />
      </Field>
      <Field label={t(lang, 'description_en')} hint={t(lang, 'descriptions_hint')}>
        <textarea maxLength={2000} dir="ltr" rows={3} value={descEn} onChange={(e) => set.setDescEn(e.target.value)} />
      </Field>
      <Field label={t(lang, 'description_ar')} hint={t(lang, 'descriptions_hint')}>
        <textarea maxLength={2000} dir="rtl" rows={3} value={descAr} onChange={(e) => set.setDescAr(e.target.value)} />
      </Field>
    </div>
  );
}
