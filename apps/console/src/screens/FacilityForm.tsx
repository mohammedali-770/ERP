import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Facility, Failure } from '../api.ts';
import type { Ctx } from '../context.ts';
import { amendFacilityBody, FACILITY_TYPES, operatingUnits, type OperatingUnitChoice } from '../facilities.ts';
import { formIds } from '../ids.ts';
import { label, localName, t } from '../i18n.ts';
import { isUnanswered, optional, writeOutcome } from '../items.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

const CREATE_IDS = ['decision_id', 'facility_id'] as const;

/** Every facility, page by page, to learn which operating units exist (facilities.ts, operatingUnits). */
async function allFacilities(ctx: Ctx): Promise<{ ok: true; value: Facility[] } | Failure> {
  const out: Facility[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const answer = await ctx.api.listFacilities({ facilityId: null, status: 'all', after, limit: 500 });
    if (!answer.ok) return answer;
    out.push(...answer.value.facilities);
    after = answer.value.next_after;
    if (after === null) break;
  }
  return { ok: true, value: out };
}

/**
 * A new facility. Its code, type, operating unit (and so its brand) and time zone are
 * chosen here once and never change (ADR-0028 §1); the time zone is Riyadh's, set by the
 * route. A new branch has no area until one is set on its page.
 */
export function FacilityCreate({ ctx }: { ctx: Ctx }) {
  const { lang, data } = ctx;
  const [ids, setIds] = useState(() => formIds(CREATE_IDS));
  const [inDoubt, setInDoubt] = useState(false);
  const [units, setUnits] = useState<readonly OperatingUnitChoice[] | null>(null);
  const [code, setCode] = useState('');
  const [type, setType] = useState<string>('branch');
  const [unit, setUnit] = useState('');
  const [f, setF] = useState<NameFields>({ nameEn: '', nameAr: '', addressEn: '', addressAr: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    let live = true;
    void allFacilities(ctx).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        if (!ctx.onFailure(answer)) setFailure(answer);
        return;
      }
      const choices = operatingUnits(answer.value, data.brands);
      setUnits(choices);
      // One unit is the usual case: chosen for the person, and still shown.
      if (choices.length === 1) setUnit(choices[0]!.operating_unit_id);
    });
    return () => {
      live = false;
    };
  }, [ctx.api]);

  async function send() {
    setBusy(true);
    setFailure(null);
    const answer = await ctx.api.createFacility({
      ...ids,
      operating_unit_id: unit,
      facility_type: type,
      code: code.trim(),
      name_en: f.nameEn,
      name_ar: f.nameAr,
      address_en: optional(f.addressEn),
      address_ar: optional(f.addressAr),
      reason: reason.trim(),
    });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'facility', targetId: ids.facility_id },
        outcome === 'already' ? t(lang, 'facility_already_recorded') : undefined);
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  /** Is the facility there? Then the lost attempt made it. If not, nothing was recorded. */
  async function startOver() {
    setBusy(true);
    const found = await ctx.api.getFacility(null, ids.facility_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'facility', targetId: ids.facility_id }, t(lang, 'facility_already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(CREATE_IDS));
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  if (!ctx.facilitiesWritable) return <Notice tone="info" text={t(lang, 'read_only_facilities')} />;
  const brandName = (brandId: string) => {
    const b = data.brands.find((x) => x.brand_id === brandId);
    return b === undefined ? brandId : localName(lang, b);
  };
  return (
    <section>
      <a href="#facilities">{t(lang, 'back')}</a>
      <h1>{t(lang, 'create_facility')}</h1>
      <p className="muted">{t(lang, 'facility_fixed_fields')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {inDoubt ? <InDoubt lang={lang} busy={busy} onRetry={() => void send()} onStartOver={() => void startOver()} /> : null}
      {units === null && failure === null ? <Loading lang={lang} /> : null}
      {units !== null && units.length === 0 ? <Notice tone="info" text={t(lang, 'no_operating_units')} /> : null}
      {units !== null && units.length > 0 ? (
        <form className="form" onSubmit={submit}>
          <fieldset className="plain" disabled={inDoubt}>
          <div className="grid">
            <Field label={t(lang, 'facility_code')} hint={t(lang, 'facility_code_hint')}>
              <input required maxLength={32} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BR-003" />
            </Field>
            <Field label={t(lang, 'facility_type')}>
              <select required value={type} onChange={(e) => setType(e.target.value)}>
                {FACILITY_TYPES.map((k) => <option key={k} value={k}>{label(lang, `type_${k}`)}</option>)}
              </select>
            </Field>
            <Field label={t(lang, 'operating_unit')} hint={t(lang, 'operating_unit_hint')}>
              <select required value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="" disabled>—</option>
                {units.map((u) => (
                  <option key={u.operating_unit_id} value={u.operating_unit_id}>
                    {t(lang, 'operating_unit_of', { brand: brandName(u.brand_id), codes: u.codes.join(lang === 'ar' ? '، ' : ', ') })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Names lang={lang} f={f} onChange={setF} />
          <ReasonField lang={lang} value={reason} onChange={setReason} />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || unit === ''}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
            <a className="button" href="#facilities">{t(lang, 'cancel')}</a>
          </div>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}

/** Its names and addresses. The area and the status are changed on the facility's page. */
export function FacilityEdit({ ctx, targetId }: { ctx: Ctx; targetId: string }) {
  const { api, lang, facilityId, onFailure } = ctx;
  const [facility, setFacility] = useState<Facility | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(() => {
    let live = true;
    void api.getFacility(facilityId, targetId).then((answer) => {
      if (!live) return;
      if (answer.ok) setFacility(answer.value);
      else if (!onFailure(answer)) setFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, onFailure, facilityId, targetId]);

  useEffect(() => load(), [load]);

  if (!ctx.facilitiesWritable) return <Notice tone="info" text={t(lang, 'read_only_facilities')} />;
  if (facility === null) return failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />;
  if (facility.status === 'closed') {
    return (
      <section>
        <a href={`#facilities/${facility.facility_id}`}>{t(lang, 'back')}</a>
        <Notice tone="info" text={t(lang, 'facility_closed_note')} />
      </section>
    );
  }
  // Keyed by the stamp: a reload after a stale refusal starts the form from the new state.
  return <AmendForm key={facility.as_of_decision_id} ctx={ctx} facility={facility} onReload={() => void load()} />;
}

function AmendForm({ ctx, facility, onReload }: { ctx: Ctx; facility: Facility; onReload: () => void }) {
  const { api, lang } = ctx;
  const [ids] = useState(() => formIds(['decision_id'] as const));
  const [inDoubt, setInDoubt] = useState(false);
  const [f, setF] = useState<NameFields>({
    nameEn: facility.name_en, nameAr: facility.name_ar, addressEn: facility.address_en ?? '', addressAr: facility.address_ar ?? '',
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Built once, when Save is pressed: Retry resends exactly this.
  const [sent, setSent] = useState<ReturnType<typeof amendFacilityBody> | null>(null);

  async function send(body: ReturnType<typeof amendFacilityBody>) {
    setSent(body);
    setBusy(true);
    setFailure(null);
    const answer = await api.amendFacility(facility.facility_id, body);
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'facility', targetId: facility.facility_id },
        outcome === 'already' ? t(lang, 'facility_already_recorded') : undefined);
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(amendFacilityBody(facility, ids.decision_id, { ...f, reason }));
  }

  /**
   * Has the facility moved on from the state this form was loaded from? Then something was
   * recorded, this change or another, and the form restarts from what is saved, with new
   * ids. If not, nothing was, and the same ids are still unused.
   */
  async function startOver() {
    setBusy(true);
    const now = await api.getFacility(ctx.facilityId, facility.facility_id);
    setBusy(false);
    if (!now.ok) {
      if (!ctx.onFailure(now)) setFailure(now);
      return;
    }
    setInDoubt(false);
    setFailure(null);
    setSent(null);
    if (now.value.as_of_decision_id !== facility.as_of_decision_id) onReload();
  }

  return (
    <section>
      <a href={`#facilities/${facility.facility_id}`}>{t(lang, 'back')}</a>
      <h1>{t(lang, 'edit_facility')} — <span dir="ltr">{facility.code}</span></h1>
      <p className="muted">{t(lang, 'facility_fixed_fields')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {failure?.status === 'stale' ? <button type="button" onClick={onReload}>{t(lang, 'reload')}</button> : null}
      {inDoubt && sent !== null
        ? <InDoubt lang={lang} busy={busy} onRetry={() => void send(sent)} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt}>
        <Names lang={lang} f={f} onChange={setF} />
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href={`#facilities/${facility.facility_id}`}>{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

interface NameFields {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly addressEn: string;
  readonly addressAr: string;
}

function Names({ lang, f, onChange }: { lang: Ctx['lang']; f: NameFields; onChange: (f: NameFields) => void }) {
  const set = (k: keyof NameFields) => (e: { target: { value: string } }) => onChange({ ...f, [k]: e.target.value });
  return (
    <div className="grid">
      <Field label={t(lang, 'name_en')}>
        <input required maxLength={120} dir="ltr" value={f.nameEn} onChange={set('nameEn')} />
      </Field>
      <Field label={t(lang, 'name_ar')}>
        <input required maxLength={120} dir="rtl" value={f.nameAr} onChange={set('nameAr')} />
      </Field>
      <Field label={t(lang, 'address_en')} hint={t(lang, 'address_hint')}>
        <input maxLength={500} dir="ltr" value={f.addressEn} onChange={set('addressEn')} />
      </Field>
      <Field label={t(lang, 'address_ar')} hint={t(lang, 'address_hint')}>
        <input maxLength={500} dir="rtl" value={f.addressAr} onChange={set('addressAr')} />
      </Field>
    </div>
  );
}
