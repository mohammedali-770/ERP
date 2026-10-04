/**
 * The items screens' logic, kept out of .tsx so test/logic.test.ts can read it.
 *
 * Requirements: INV-002 · INV-005
 */
import type { Answer, Item, ViewerUnit } from './api.ts';
import type { Lang } from './i18n.ts';

/**
 * The item kinds, in 0012's order (item_kind_is_known). test/logic.test.ts reads the
 * migration and fails if this list drifts from it.
 */
export const ITEM_KINDS = [
  'raw_ingredient', 'semi_finished', 'finished_product', 'packaging',
  'cleaning_supply', 'operating_supply', 'equipment', 'spare_part',
] as const;

/** A unit's name in the reader's language, or its key when the register lacks it. */
export function unitName(lang: Lang, units: readonly ViewerUnit[], key: string): string {
  const u = units.find((x) => x.unit_key === key);
  if (u === undefined) return key;
  return lang === 'ar' ? u.name_ar : u.name_en;
}

export function unitSymbol(lang: Lang, units: readonly ViewerUnit[], key: string): string {
  const u = units.find((x) => x.unit_key === key);
  if (u === undefined) return key;
  return lang === 'ar' ? u.symbol_ar : u.symbol_en;
}

/**
 * The units an "add unit" form offers: every registered unit the item has no active
 * conversion to. The base unit has one from creation (0012 records it with the item), so
 * it is never offered. Whether a factor fits is the database's to say (the star).
 */
export function addableUnits(item: Item, units: readonly ViewerUnit[]): ViewerUnit[] {
  const active = new Set(item.units.filter((u) => u.status === 'active').map((u) => u.unit_key));
  return units.filter((u) => !active.has(u.unit_key) && u.unit_key !== item.base_unit_key);
}

/**
 * Whether a conversion's factor can be left out, as erp.item_unit_derived_factor() (0012)
 * decides: the unit is not a pack, and the item already has an active conversion of the
 * same dimension — its base unit counts — so the register's sizes give the factor. A
 * pack's size is a fact about an item, so it is always asked.
 */
export function factorIsDerived(item: Item, units: readonly ViewerUnit[], unitKey: string): boolean {
  const dimension = (key: string) => units.find((u) => u.unit_key === key)?.dimension;
  const wanted = dimension(unitKey);
  if (wanted === undefined || wanted === 'pack') return false;
  return item.units.some((u) => u.status === 'active' && dimension(u.unit_key) === wanted);
}

/** True for the conversion that is the item's base unit, which can never be retired. */
export function isBaseUnit(item: Item, unitKey: string): boolean {
  return unitKey === item.base_unit_key;
}

/**
 * What a write's answer means for the form that sent it:
 *
 *   saved    recorded now. The form mints new ids for its next decision.
 *   already  `already_recorded`: an earlier attempt with these ids was recorded and its
 *            answer lost. The same success, arriving twice; treated as saved.
 *   stale    someone changed the item since it was loaded. Reload, then decide again.
 *   failed   refused or not answered. The ids are kept: a refusal recorded nothing, and
 *            an unanswered attempt is safe to repeat only with the same ids.
 */
export type WriteOutcome = 'saved' | 'already' | 'stale' | 'failed';

export function writeOutcome(answer: Answer<unknown>): WriteOutcome {
  if (answer.ok) return 'saved';
  if (answer.status === 'already_recorded') return 'already';
  if (answer.status === 'stale') return 'stale';
  return 'failed';
}

/** Optional text as the routes take it: blank is null. */
export function optional(v: string): string | null {
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * Both descriptions or neither — 0012's item_description_is_bilingual, asked before the
 * form is sent so the person is told which field, not only that a rule was broken. The
 * database still decides: this only saves a round trip.
 */
export function descriptionsPaired(en: string, ar: string): boolean {
  return (optional(en) === null) === (optional(ar) === null);
}

/**
 * True when a write got no answer it can trust: the connection failed, or the server
 * failed (5xx). It may have been recorded. The form then keeps its ids AND its fields:
 * the only safe next steps are the same change again, or a fresh look at what is saved.
 * Letting the person edit and resend under the same ids would turn a lost answer into
 * "already recorded" for a change they never made (found in review).
 */
export function isUnanswered(answer: Answer<unknown>): boolean {
  return !answer.ok && (answer.http === 0 || answer.http >= 500);
}
