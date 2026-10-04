import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Failure, Supplier } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formIds } from '../ids.ts';
import { t } from '../i18n.ts';
import { isUnanswered, optional, writeOutcome } from '../items.ts';
import { amendBody, businessProblem, DEFAULT_PAYMENT_TERMS, termsInput } from '../suppliers.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice, ReasonField } from './ui.tsx';

const CREATE_IDS = ['decision_id', 'supplier_id'] as const;

/** The field a pre-check names, as the failure the edge would send for it. */
function malformed(field: string): Failure {
  return { ok: false, http: 400, status: 'malformed', field, message: null, constraint: null, detail: null };
}

/** The rule sentence for a pre-checked field, so the person reads what the database wants. */
const RULE_OF = { vat_number: 'rule_vat', cr_number: 'rule_cr', payment_terms_days: 'rule_terms' } as const;

/** A new supplier. The code is chosen here once, and reserved forever (ADR-0026 §1). */
export function SupplierCreate({ ctx }: { ctx: Ctx }) {
  const { api, lang } = ctx;
  const [ids, setIds] = useState(() => formIds(CREATE_IDS));
  const [inDoubt, setInDoubt] = useState(false);
  const [code, setCode] = useState('');
  const [f, setF] = useState<BusinessFields>({ nameEn: '', nameAr: '', vat: '', cr: '', terms: String(DEFAULT_PAYMENT_TERMS) });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [problem, setProblem] = useState<keyof typeof RULE_OF | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = businessProblem(f);
    setProblem(p);
    if (p === null) void send();
  }

  async function send() {
    const terms = termsInput(f.terms);
    if (!terms.ok) return;
    setBusy(true);
    setFailure(null);
    const answer = await api.createSupplier({
      ...ids,
      code: code.trim(),
      name_en: f.nameEn,
      name_ar: f.nameAr,
      vat_number: optional(f.vat),
      cr_number: optional(f.cr),
      payment_terms_days: terms.value,
      reason: reason.trim(),
    });
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      // Created now, or by an earlier attempt whose answer was lost: its page shows what is saved.
      ctx.navigate({ screen: 'supplier', supplierId: ids.supplier_id },
        outcome === 'already' ? t(lang, 'supplier_already_recorded') : undefined);
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  /** Is the supplier there? Then the lost attempt made it. If not, nothing was recorded. */
  async function startOver() {
    setBusy(true);
    const found = await api.getSupplier(null, ids.supplier_id);
    setBusy(false);
    if (found.ok) {
      ctx.navigate({ screen: 'supplier', supplierId: ids.supplier_id }, t(lang, 'supplier_already_recorded'));
    } else if (found.status === 'not_found') {
      setIds(formIds(CREATE_IDS));
      setInDoubt(false);
      setFailure(null);
    } else if (!ctx.onFailure(found)) {
      setFailure(found);
    }
  }

  if (!ctx.suppliersWritable) return <Notice tone="info" text={t(lang, 'read_only_suppliers')} />;
  return (
    <section>
      <a href="#suppliers">{t(lang, 'back')}</a>
      <h1>{t(lang, 'create_supplier')}</h1>
      <p className="muted">{t(lang, 'supplier_fixed_code')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {problem ? <Notice tone="error" text={t(lang, RULE_OF[problem])} /> : null}
      {inDoubt ? <InDoubt lang={lang} busy={busy} onRetry={() => void send()} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt}>
        <div className="grid">
          <Field label={t(lang, 'supplier_code')}>
            <input required maxLength={24} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUP-001" />
          </Field>
        </div>
        <Business lang={lang} f={f} onChange={setF} />
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href="#suppliers">{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

/** The business record: names, numbers and terms. Contacts have their own form (§2). */
export function SupplierEdit({ ctx, supplierId }: { ctx: Ctx; supplierId: string }) {
  const { api, lang, facilityId, onFailure } = ctx;
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(() => {
    let live = true;
    void api.getSupplier(facilityId, supplierId).then((answer) => {
      if (!live) return;
      if (answer.ok) setSupplier(answer.value);
      else if (!onFailure(answer)) setFailure(answer);
    });
    return () => {
      live = false;
    };
  }, [api, onFailure, facilityId, supplierId]);

  useEffect(() => load(), [load]);

  if (!ctx.suppliersWritable) return <Notice tone="info" text={t(lang, 'read_only_suppliers')} />;
  if (supplier === null) return failure ? <FailureNotice lang={lang} failure={failure} /> : <Loading lang={lang} />;
  // Keyed by the stamp: a reload after a stale refusal starts the form from the new state.
  return <AmendForm key={supplier.as_of_decision_id} ctx={ctx} supplier={supplier} onReload={() => void load()} />;
}

function AmendForm({ ctx, supplier, onReload }: { ctx: Ctx; supplier: Supplier; onReload: () => void }) {
  const { api, lang } = ctx;
  const [ids] = useState(() => formIds(['decision_id'] as const));
  const [inDoubt, setInDoubt] = useState(false);
  const [f, setF] = useState<BusinessFields>({
    nameEn: supplier.name_en, nameAr: supplier.name_ar, vat: supplier.vat_number ?? '', cr: supplier.cr_number ?? '',
    terms: String(supplier.payment_terms_days),
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [problem, setProblem] = useState<keyof typeof RULE_OF | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = businessProblem(f);
    setProblem(p);
    if (p === null) void send();
  }

  async function send() {
    const terms = termsInput(f.terms);
    if (!terms.ok) {
      setFailure(malformed('payment_terms_days'));
      return;
    }
    setBusy(true);
    setFailure(null);
    const answer = await api.amendSupplier(supplier.supplier_id,
      amendBody(supplier, ids.decision_id, { ...f, terms: terms.value, reason }));
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'supplier', supplierId: supplier.supplier_id },
        outcome === 'already' ? t(lang, 'supplier_already_recorded') : undefined);
      return;
    }
    if (isUnanswered(answer)) setInDoubt(true);
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  /**
   * Has the supplier moved on from the state this form was loaded from? Then something was
   * recorded — this change or another — and the form restarts from what is saved, with
   * new ids. If not, nothing was, and the same ids are still unused.
   */
  async function startOver() {
    setBusy(true);
    const now = await api.getSupplier(ctx.facilityId, supplier.supplier_id);
    setBusy(false);
    if (!now.ok) {
      if (!ctx.onFailure(now)) setFailure(now);
      return;
    }
    setInDoubt(false);
    setFailure(null);
    if (now.value.as_of_decision_id !== supplier.as_of_decision_id) onReload();
  }

  return (
    <section>
      <a href={`#suppliers/${supplier.supplier_id}`}>{t(lang, 'back')}</a>
      <h1>{t(lang, 'edit_supplier')} — <span dir="ltr">{supplier.code}</span></h1>
      <p className="muted">{t(lang, 'supplier_fixed_code')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {failure?.status === 'stale' ? <button type="button" onClick={onReload}>{t(lang, 'reload')}</button> : null}
      {problem ? <Notice tone="error" text={t(lang, RULE_OF[problem])} /> : null}
      {inDoubt ? <InDoubt lang={lang} busy={busy} onRetry={() => void send()} onStartOver={() => void startOver()} /> : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt}>
        <Business lang={lang} f={f} onChange={setF} />
        <ReasonField lang={lang} value={reason} onChange={setReason} />
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href={`#suppliers/${supplier.supplier_id}`}>{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

interface BusinessFields {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly vat: string;
  readonly cr: string;
  readonly terms: string;
}

function Business({ lang, f, onChange }: { lang: Ctx['lang']; f: BusinessFields; onChange: (f: BusinessFields) => void }) {
  const set = (k: keyof BusinessFields) => (e: { target: { value: string } }) => onChange({ ...f, [k]: e.target.value });
  return (
    <div className="grid">
      <Field label={t(lang, 'name_en')}>
        <input required maxLength={160} dir="ltr" value={f.nameEn} onChange={set('nameEn')} />
      </Field>
      <Field label={t(lang, 'name_ar')}>
        <input required maxLength={160} dir="rtl" value={f.nameAr} onChange={set('nameAr')} />
      </Field>
      <Field label={t(lang, 'vat_number')} hint={t(lang, 'numbers_hint')}>
        <input inputMode="numeric" dir="ltr" maxLength={32} value={f.vat} onChange={set('vat')} placeholder="3XXXXXXXXXXXXX3" />
      </Field>
      <Field label={t(lang, 'cr_number')} hint={t(lang, 'numbers_hint')}>
        <input inputMode="numeric" dir="ltr" maxLength={32} value={f.cr} onChange={set('cr')} />
      </Field>
      <Field label={t(lang, 'payment_terms_days')} hint={t(lang, 'payment_terms_hint')}>
        <input required inputMode="numeric" dir="ltr" maxLength={9} value={f.terms} onChange={set('terms')} />
      </Field>
    </div>
  );
}
