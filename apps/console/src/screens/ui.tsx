import type { ReactNode } from 'react';
import type { Failure } from '../api.ts';
import type { Lang } from '../i18n.ts';
import { t } from '../i18n.ts';
import { failureMessage } from '../messages.ts';

/** A message above a form or a list: a failure, a success, or a plain note. */
export function Notice({ tone, text, detail }: { tone: 'error' | 'ok' | 'info'; text: string; detail?: string | null }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p>{text}</p>
      {detail ? <pre className="notice-detail" dir="ltr">{detail}</pre> : null}
    </div>
  );
}

export function FailureNotice({ lang, failure }: { lang: Lang; failure: Failure }) {
  const m = failureMessage(lang, failure);
  return <Notice tone="error" text={m.text} detail={m.detail} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** The reason every decision records (0012: item_decision_reason_is_stated). */
export function ReasonField({ lang, value, onChange }: { lang: Lang; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t(lang, 'reason')} hint={t(lang, 'reason_hint')}>
      <input type="text" required maxLength={500} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function Loading({ lang }: { lang: Lang }) {
  return <p className="loading" role="status">{t(lang, 'loading')}</p>;
}
