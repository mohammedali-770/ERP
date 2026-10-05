/**
 * The transfer-price screens' logic, kept out of .tsx so test/transfer-prices.test.ts can
 * read it.
 *
 * MONEY IS NEVER A FLOAT. A price is typed in riyals ("185.50", or "١٨٥٫٥٠"), turned
 * here into whole halalas by string arithmetic, and sent as a JSON integer, as the edge
 * requires (ADR-0027's step 2 addendum). It comes back the same way and is shown from the
 * integer, never from riyals parsed back.
 *
 * TIME NAMES RIYADH. A price set ahead is typed as a date and a time of day, read in
 * Riyadh's time (UTC+03:00 all year: Saudi Arabia keeps no daylight saving), and sent
 * with that offset written out, so the moment is exact whatever the browser's own zone.
 * Midnight is the default time (ADR-0027, question 5).
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0018 decides every rule: an amount's range, the
 * currency, a moment in the past, one price per moment, a price that changes nothing. The
 * form asks a few before sending only so a person is told which field.
 *
 * Requirements: PRC-005 · INV-005 · PRG-014
 */
import type { ItemPrice, SetPriceInput } from './api.ts';
import { latinDigits } from './format.ts';
import type { Lang } from './i18n.ts';

/** The one currency 0018 accepts (transfer_price_currency_is_known). */
export const CURRENCY = 'SAR';

/** 0018's cap, transfer_price_is_minor_units: 0 to 100,000,000,000 halalas. */
export const MAX_MINOR = 100_000_000_000;

/** Riyadh's offset, written into every moment the console sends. */
export const RIYADH_OFFSET = '+03:00';

/**
 * A price as typed, in riyals, as whole halalas: "185" → 18500, "185.5" → 18550,
 * "0.05" → 5. Arabic-Indic digits and the Arabic decimal separator are read; grouping
 * commas are not, since "1,850" could be read two ways. At most two decimals: a halala
 * is the smallest coin. The range is the database's to refuse; this only refuses
 * what could not be an amount at all.
 */
export function priceInput(raw: string): { ok: true; value: number } | { ok: false } {
  const v = latinDigits(raw).trim();
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(v);
  if (m === null) return { ok: false };
  const halalas = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return { ok: true, value: halalas };
}

/**
 * Whole halalas as riyals, from the integer: 18500 → "185.00". Western digits in both
 * languages, as factors and codes are shown, with the currency in the reader's own.
 */
export function formatMinor(lang: Lang, minor: number, currency: string = CURRENCY): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const riyals = Math.floor(abs / 100);
  const halalas = String(abs % 100).padStart(2, '0');
  const grouped = new Intl.NumberFormat('en-GB', { useGrouping: true, maximumFractionDigits: 0 }).format(riyals);
  const amount = `${negative ? '-' : ''}${grouped}.${halalas}`;
  const unit = lang === 'ar' ? (currency === 'SAR' ? 'ر.س' : currency) : currency;
  return lang === 'ar' ? `${amount} ${unit}` : `${unit} ${amount}`;
}

/**
 * The moment a price takes effect, from a date (YYYY-MM-DD, as <input type=date> gives
 * it) and a time of day (HH:MM, default midnight), read in Riyadh. A blank date is now:
 * null, which the edge reads as "from now".
 */
export function momentInput(date: string, time: string): { ok: true; value: string | null } | { ok: false } {
  const d = latinDigits(date).trim();
  const tm = latinDigits(time).trim() || '00:00';
  if (d === '') return { ok: true, value: null };
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const tmm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(tm);
  if (dm === null || tmm === null) return { ok: false };
  const [y, mo, day] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const check = new Date(Date.UTC(y, mo - 1, day));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) return { ok: false };
  return { ok: true, value: `${d}T${tm}:00${RIYADH_OFFSET}` };
}

/** A moment as Riyadh reads it, in either language: the clock on the wall where prices apply. */
export function formatRiyadh(lang: Lang, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh',
  }).format(d);
}

/** A "set price" body: the ids the form minted when it opened, the amount as an integer. */
export function setPriceBody(ids: { decision_id: string; price_id: string }, f: {
  itemUnitId: string; priceMinor: number; effectiveFrom: string | null; reason: string;
}): SetPriceInput {
  return {
    decision_id: ids.decision_id,
    price_id: ids.price_id,
    item_unit_id: f.itemUnitId,
    price_minor: f.priceMinor,
    currency: CURRENCY,
    effective_from: f.effectiveFrom,
    reason: f.reason.trim(),
  };
}

/**
 * Whether a price may still be withdrawn, as 0018 allows: active, and its moment not yet
 * come. A price in effect is history; an order may already have been charged it. `now`
 * is the browser's clock, which may be wrong: the database judges by its own, and
 * refuses a late withdrawal whatever this said (transfer_price_in_effect).
 */
export function withdrawable(p: Pick<ItemPrice, 'status' | 'effective_from'>, now: number): boolean {
  return p.status === 'active' && Date.parse(p.effective_from) > now;
}

export type PriceState = 'in_force' | 'ahead' | 'past' | 'withdrawn';

/** What a price is now: in force, set ahead, superseded, or withdrawn. */
export function priceState(p: Pick<ItemPrice, 'status' | 'in_force' | 'effective_from'>, now: number): PriceState {
  if (p.status === 'withdrawn') return 'withdrawn';
  if (p.in_force) return 'in_force';
  return Date.parse(p.effective_from) > now ? 'ahead' : 'past';
}

/** An item's prices, pack by pack, in the order the route gives them (newest moment first). */
export function byPack(prices: readonly ItemPrice[]): Map<string, ItemPrice[]> {
  const packs = new Map<string, ItemPrice[]>();
  for (const p of prices) {
    const list = packs.get(p.item_unit_id) ?? [];
    list.push(p);
    packs.set(p.item_unit_id, list);
  }
  return packs;
}

/**
 * The packs a "set price" form offers: the item's active conversions (0018 prices an
 * active pack of an active item only, transfer_price_conversion_is_active).
 */
export function priceablePacks<U extends { item_unit_id: string; status: string }>(units: readonly U[]): U[] {
  return units.filter((u) => u.status === 'active');
}
