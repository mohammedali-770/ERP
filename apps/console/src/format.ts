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

/** A factor as typed, checked as the edge checks it: decimal text, at most six places. */
export function factorInput(raw: string): { ok: true; value: string | null } | { ok: false } {
  const v = raw.trim();
  if (v === '') return { ok: true, value: null };
  return /^\d{1,12}(\.\d{1,6})?$/.test(v) ? { ok: true, value: v } : { ok: false };
}
