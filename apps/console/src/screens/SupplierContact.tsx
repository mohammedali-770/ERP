import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ContactInput, Failure, Supplier } from '../api.ts';
import type { Ctx } from '../context.ts';
import { formIds } from '../ids.ts';
import { localName, t } from '../i18n.ts';
import { isUnanswered, writeOutcome } from '../items.ts';
import { contactBody, contactProblem, eraseBody, hasContact } from '../suppliers.ts';
import { FailureNotice, Field, InDoubt, Loading, Notice } from './ui.tsx';

/**
 * A supplier's contact person, phone, email and address (SEC-008).
 *
 * They can name a private individual — a sole trader's address is their home — so they
 * live only on the supplier, never in its log, and this form ASKS NO REASON: the reason a
 * person would type here names the person, and the log keeps every reason for good
 * (ADR-0026 §2). The database records who and when, and a fixed reason. Erasing is its
 * own action, and works on a retired supplier too.
 */
export function SupplierContact({ ctx, supplierId }: { ctx: Ctx; supplierId: string }) {
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
  return <ContactForm key={supplier.as_of_decision_id} ctx={ctx} supplier={supplier} onReload={() => void load()} />;
}

function ContactForm({ ctx, supplier, onReload }: { ctx: Ctx; supplier: Supplier; onReload: () => void }) {
  const { api, lang } = ctx;
  const [ids] = useState(() => formIds(['decision_id'] as const));
  const [person, setPerson] = useState(supplier.contact_person ?? '');
  const [phone, setPhone] = useState(supplier.phone ?? '');
  const [email, setEmail] = useState(supplier.email ?? '');
  const [address, setAddress] = useState(supplier.address ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [problem, setProblem] = useState<'phone' | 'email' | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  /** The body of the last attempt, sent again as it was on Retry: same ids, same change. */
  const [inDoubt, setInDoubt] = useState<{ body: ContactInput; erase: boolean } | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = contactProblem({ phone, email });
    setProblem(p);
    if (p === null) void send(contactBody(supplier, ids.decision_id, { person, phone, email, address }), false);
  }

  async function send(body: ContactInput, erase: boolean) {
    setBusy(true);
    setFailure(null);
    const answer = await api.setSupplierContact(supplier.supplier_id, body);
    setBusy(false);
    const outcome = writeOutcome(answer);
    if (outcome === 'saved' || outcome === 'already') {
      ctx.navigate({ screen: 'supplier', supplierId: supplier.supplier_id },
        outcome === 'already' ? t(lang, 'supplier_already_recorded') : t(lang, erase ? 'contact_erased' : 'contact_saved'));
      return;
    }
    if (isUnanswered(answer)) setInDoubt({ body, erase });
    else if (!answer.ok && !ctx.onFailure(answer)) setFailure(answer);
  }

  /** As the supplier form: has the stamp moved on? Then reload; if not, nothing was recorded. */
  async function startOver() {
    setBusy(true);
    const now = await api.getSupplier(ctx.facilityId, supplier.supplier_id);
    setBusy(false);
    if (!now.ok) {
      if (!ctx.onFailure(now)) setFailure(now);
      return;
    }
    setInDoubt(null);
    setFailure(null);
    if (now.value.as_of_decision_id !== supplier.as_of_decision_id) onReload();
  }

  return (
    <section>
      <a href={`#suppliers/${supplier.supplier_id}`}>{t(lang, 'back')}</a>
      <h1>{t(lang, 'edit_contact')} — <span dir="ltr">{supplier.code}</span> {localName(lang, supplier)}</h1>
      <p className="muted">{t(lang, 'contact_no_reason')}</p>
      {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
      {failure?.status === 'stale' ? <button type="button" onClick={onReload}>{t(lang, 'reload')}</button> : null}
      {problem ? <Notice tone="error" text={t(lang, problem === 'phone' ? 'rule_phone' : 'rule_email')} /> : null}
      {inDoubt ? (
        <InDoubt lang={lang} busy={busy} onRetry={() => void send(inDoubt.body, inDoubt.erase)} onStartOver={() => void startOver()} />
      ) : null}
      <form className="form" onSubmit={submit}>
        <fieldset className="plain" disabled={inDoubt !== null}>
        <div className="grid">
          <Field label={t(lang, 'contact_person')}>
            <input maxLength={120} value={person} onChange={(e) => setPerson(e.target.value)} />
          </Field>
          <Field label={t(lang, 'phone')}>
            <input type="tel" inputMode="tel" dir="ltr" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t(lang, 'email')}>
            <input type="email" dir="ltr" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t(lang, 'address')}>
            <textarea maxLength={500} rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? t(lang, 'saving') : t(lang, 'save')}</button>
          <a className="button" href={`#suppliers/${supplier.supplier_id}`}>{t(lang, 'cancel')}</a>
        </div>
        </fieldset>
      </form>

      {hasContact(supplier) ? (
        <div className="inline-form">
          {!confirmErase ? (
            <button type="button" className="danger" disabled={busy || inDoubt !== null} onClick={() => setConfirmErase(true)}>
              {t(lang, 'erase_contact')}
            </button>
          ) : (
            <>
              <p>{t(lang, 'erase_contact_confirm')}</p>
              <div className="actions">
                <button type="button" className="danger" disabled={busy || inDoubt !== null}
                  onClick={() => void send(eraseBody(supplier, ids.decision_id), true)}>
                  {busy ? t(lang, 'saving') : t(lang, 'erase_contact')}
                </button>
                <button type="button" onClick={() => setConfirmErase(false)}>{t(lang, 'cancel')}</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
