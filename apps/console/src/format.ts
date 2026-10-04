/**
 * Dates, factors and short ids as a person reads them, in either language.
 *
 * Arabic dates use the Gregorian calendar: `ar-SA` alone defaults to the Islamic one,
 * and the warehouse system's records and the ERP's documents are dated Gregorian. Which
 * calendar staff expect is for the UAT pack's reviewer to confirm.
 */
import type { Lang } from './i18n.ts';

const LOCALE: Readonly<Record<Lang, string>> = { en: 'en-GB', ar: 'ar-SA-u-ca-gregory' };

export function formatDateTime(lang: Lang, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/**
 * A factor as the database stored it, without trailing zeros: 12.000000 reads 12. Kept
 * as text throughout — a factor is never parsed into a float on its way to the screen.
 */
export function formatFactor(factor: number | string | null): string {
  if (factor === null) return '';
  const s = String(factor);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** The first block of a UUID, enough to tell two people apart in a history table. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits as ASCII, and the Arabic decimal separator
 * (٫) as a point. Arabic is the console's default, and a phone keyboard under
 * inputmode=numeric types these; erp.verify_pin() checks ^[0-9]{6}$, so a correct PIN
 * typed that way counted as a miss and could lock the account (found in review).
 */
export function latinDigits(raw: string): string {
  return raw.replace(/[\u0660-\u0669\u06f0-\u06f9\u066b]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 0x066b) return '.';
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** A factor as typed, checked as the edge checks it: decimal text, at most six places. */
export function factorInput(raw: string): { ok: true; value: string | null } | { ok: false } {
  const v = latinDigits(raw).trim();
  if (v === '') return { ok: true, value: null };
  return /^\d{1,12}(\.\d{1,6})?$/.test(v) ? { ok: true, value: v } : { ok: false };
}
