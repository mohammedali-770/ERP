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
 * When a price takes effect: "now", or a date (YYYY-MM-DD, as <input type=date> gives it)
 * and a time of day (HH:MM), read in Riyadh. The choice is explicit, never inferred from
 * a blank date: a date input reports '' for a date half typed, and reading that as "now"
 * put a price meant for November into effect at once, where it can never be withdrawn
 * (found in review). A blank or half-typed time is refused for the same reason, never
 * taken as midnight; the form offers 00:00 as a value the person can see.
 *
 * `badInput` is the inputs' own word that what is typed is not a date or time
 * (ValidityState.badInput): '' then means "unfinished", not "empty".
 */
export function momentInput(when: 'now' | 'later', date: string, time: string, badInput = false):
  { ok: true; value: string | null } | { ok: false } {
  if (when === 'now') return { ok: true, value: null };
  if (badInput) return { ok: false };
  const d = latinDigits(date).trim();
  const tm = latinDigits(time).trim();
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

export type PriceState = 'in_force' | 'ahead' | 'past' | 'withdrawn';

/**
 * What each of one pack's prices is, judged by the database's clock alone: `in_force` is
 * the route's, read at its now(). An active price that is not in force is superseded if
 * it starts before the one in force, and set ahead otherwise — or set ahead when none is
 * in force, since a price whose moment had come would be. The browser's clock is never
 * asked: a page left open, or a clock a few minutes out, showed a price just in effect as
 * "superseded" and offered or hid Withdraw against the database's own answer (found in
 * review). What the page shows is as of its last load, which every write refreshes.
 */
export function priceStates(pack: readonly Pick<ItemPrice, 'price_id' | 'status' | 'in_force' | 'effective_from'>[]):
  Map<string, PriceState> {
  const current = pack.find((p) => p.status === 'active' && p.in_force);
  const from = current === undefined ? null : Date.parse(current.effective_from);
  const states = new Map<string, PriceState>();
  for (const p of pack) {
    states.set(p.price_id, p.status === 'withdrawn' ? 'withdrawn'
      : p.in_force ? 'in_force'
      : from !== null && Date.parse(p.effective_from) < from ? 'past' : 'ahead');
  }
  return states;
}

/**
 * Whether a price is offered for withdrawal: set ahead, as of the last load. 0018 refuses
 * one in effect by its own clock (transfer_price_in_effect) whatever this said.
 */
export function withdrawable(state: PriceState | undefined): boolean {
  return state === 'ahead';
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
