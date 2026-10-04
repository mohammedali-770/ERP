import { useState, type FormEvent } from 'react';
import type { Api, Failure } from '../api.ts';
import { formatDateTime, latinDigits } from '../format.ts';
import { t, type Lang } from '../i18n.ts';
import { signInMessage } from '../messages.ts';
import { FailureNotice, Field, Notice } from './ui.tsx';

/**
 * Employee number and PIN, as the warehouse system signed people in. Every attempt is
 * the database's to judge and record (IAM-008); this screen checks nothing but that both
 * are filled, and shows the database's answer.
 */
export function SignIn({ api, lang, notice, onSignedIn, onToggleLang }: {
  api: Api;
  lang: Lang;
  notice: string | null;
  onSignedIn: (token: string) => void;
  onToggleLang: () => void;
}) {
  const [number, setNumber] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFailure(null);
    const answer = await api.signIn(latinDigits(number).trim(), latinDigits(pin));
    setBusy(false);
    if (!answer.ok) {
      setFailure(answer);
      return;
    }
    if (answer.value.status === 'ok') {
      setPin('');
      onSignedIn(answer.value.token);
      return;
    }
    // The PIN is cleared after every refusal, so it is never left in the field.
    setPin('');
    setMessage(signInMessage(lang, answer.value, (iso) => formatDateTime(lang, iso)));
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <button type="button" className="link lang-toggle" onClick={onToggleLang}>{t(lang, 'language')}</button>
        <h1>{t(lang, 'app_title')}</h1>
        <p className="muted">{t(lang, 'company_name')}</p>
        <h2>{t(lang, 'signin_welcome')}</h2>
        <p>{t(lang, 'signin_hint')}</p>
        {notice ? <Notice tone="info" text={notice} /> : null}
        {message ? <Notice tone="error" text={message} /> : null}
        {failure ? <FailureNotice lang={lang} failure={failure} /> : null}
        <form onSubmit={submit}>
          <Field label={t(lang, 'employee_number')}>
            <input
              name="employee_number"
              inputMode="numeric"
              autoComplete="username"
              required
              maxLength={32}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              dir="ltr"
            />
          </Field>
          <Field label={t(lang, 'pin')}>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              required
              maxLength={32}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              dir="ltr"
            />
          </Field>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t(lang, 'signing_in') : t(lang, 'sign_in')}
          </button>
        </form>
      </div>
    </main>
  );
}
