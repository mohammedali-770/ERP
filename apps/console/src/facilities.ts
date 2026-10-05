/**
 * The facility screens' logic, kept out of .tsx so test/facilities.test.ts can read it.
 *
 * WHAT IS CHECKED HERE IS A COURTESY, as in suppliers.ts. 0019 decides every rule: a code's
 * shape, both names, a point on the earth, a radius of 25 to 2000 m. The forms ask a
 * coordinate's shape before sending only so a person is told which field. The database
 * still decides.
 *
 * A COORDINATE STAYS TEXT. What the person types or pastes is sent as the decimal text it
 * is, never parsed into a number (ADR-0028's step 2 addendum): the edge refuses a JSON
 * number, and 0019 rounds to six places itself.
 *
 * Requirements: IAM-006 · IAM-P11 · PRG-002 · PRG-014
 */
import type { AmendFacilityInput, Answer, AreaInput, Facility, FacilityList, Failure, ViewerBrand } from './api.ts';
import { latinDigits } from './format.ts';
import { optional } from './items.ts';

/** The kinds of facility, in 0019's order (facility_type_is_known). The test reads the migration. */
export const FACILITY_TYPES = ['branch', 'warehouse', 'factory', 'office'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

/** 0019's limits, read by the test from the migration. */
export const RADIUS_MIN = 25;
export const RADIUS_MAX = 2000;
export const RADIUS_DEFAULT = 150;

/** The edge's own pattern for a coordinate (supabase/functions/_shared/facilities.ts); the test holds them equal. */
export const COORDINATE = /^-?\d{1,3}(\.\d{1,15})?$/;

/**
 * A latitude or longitude as typed: Arabic-Indic digits and the Arabic decimal separator
 * read as ASCII, a leading plus or a typographic minus accepted, and nothing else changed.
 * Blank is no value.
 */
export function coordinateInput(raw: string): { ok: true; value: string | null } | { ok: false } {
  const v = latinDigits(raw).trim().replace(/^\+/, '').replace(/^[−–]/, '-');
  if (v === '') return { ok: true, value: null };
  return COORDINATE.test(v) ? { ok: true, value: v } : { ok: false };
}

/**
 * A point pasted whole — "24.713600, 46.675300", as a map's "copy coordinates" gives it —
 * split into its latitude and longitude, or null when the text is not one. An Arabic
 * comma, a semicolon or a space between them is read too. The parts stay text.
 *
 * Each part must have a decimal point: "46,67" is a decimal comma typed in one field, not
 * a point at 46° and 67°, and splitting it would move the area across the world.
 */
export function splitPoint(raw: string): { latitude: string; longitude: string } | null {
  const parts = latinDigits(raw).trim().split(/\s*[,،;]\s*|\s+/).filter((p) => p !== '');
  if (parts.length !== 2 || !parts.every((p) => p.includes('.'))) return null;
  const [lat, lng] = parts.map((p) => coordinateInput(p));
  if (!lat!.ok || !lng!.ok || lat!.value === null || lng!.value === null) return null;
  return { latitude: lat!.value, longitude: lng!.value };
}

/**
 * A radius as typed, in whole metres; blank is null, which 0019 reads as its default of
 * 150 m when a point is given. Whether 10 m is allowed is 0019's to say
 * (facility_radius_is_metres), not this function's.
 */
export function radiusInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const v = latinDigits(raw).trim();
  if (v === '') return { ok: true, value: null };
  return /^[0-9]{1,9}$/.test(v) ? { ok: true, value: Number(v) } : { ok: false };
}

/** The first area field that would be refused for its shape, or null. A point is both or neither. */
export function areaProblem(f: { latitude: string; longitude: string; radius: string }): 'latitude' | 'longitude' | 'radius_m' | null {
  const lat = coordinateInput(f.latitude);
  const lng = coordinateInput(f.longitude);
  if (!lat.ok || lat.value === null) return 'latitude';
  if (!lng.ok || lng.value === null) return 'longitude';
  if (!radiusInput(f.radius).ok) return 'radius_m';
  return null;
}

/**
 * An area's body, every field stated: the edge refuses one left out rather than read it as
 * "remove" (ADR-0028's step 2 addendum). Only called once areaProblem() is null.
 */
export function areaBody(facility: Facility, decisionId: string, f: {
  latitude: string; longitude: string; radius: string; reason: string;
}): AreaInput {
  const lat = coordinateInput(f.latitude);
  const lng = coordinateInput(f.longitude);
  const radius = radiusInput(f.radius);
  if (!lat.ok || !lng.ok || !radius.ok || lat.value === null || lng.value === null) {
    throw new Error('areaBody called with a field areaProblem() refuses');
  }
  return {
    decision_id: decisionId,
    expected_decision_id: facility.as_of_decision_id,
    latitude: lat.value,
    longitude: lng.value,
    radius_m: radius.value,
    reason: f.reason.trim(),
  };
}

/** Removing the area on purpose: all three null (0019 records it as a decision too). */
export function removeAreaBody(facility: Facility, decisionId: string, reason: string): AreaInput {
  return {
    decision_id: decisionId,
    expected_decision_id: facility.as_of_decision_id,
    latitude: null,
    longitude: null,
    radius_m: null,
    reason: reason.trim(),
  };
}

/** An amendment's body: both names, and both addresses stated as text or null, never left out. */
export function amendFacilityBody(facility: Facility, decisionId: string, f: {
  nameEn: string; nameAr: string; addressEn: string; addressAr: string; reason: string;
}): AmendFacilityInput {
  return {
    decision_id: decisionId,
    expected_decision_id: facility.as_of_decision_id,
    name_en: f.nameEn,
    name_ar: f.nameAr,
    address_en: optional(f.addressEn),
    address_ar: optional(f.addressAr),
    reason: f.reason.trim(),
  };
}

export function hasArea(f: Pick<Facility, 'latitude' | 'longitude'>): boolean {
  return f.latitude !== null && f.longitude !== null;
}

/**
 * Why a facility needs attention, if it does: an open branch with no area admits no
 * worker's order until it is given one (ADR-0028 §2). Other kinds take no orders by area.
 */
export function areaWarning(f: Pick<Facility, 'facility_type' | 'status' | 'latitude' | 'longitude'>): 'no_area' | null {
  return f.facility_type === 'branch' && f.status === 'open' && !hasArea(f) ? 'no_area' : null;
}

/**
 * A coordinate as stored, without trailing zeros: 24.713600 reads 24.7136. Text throughout,
 * as a factor is (format.ts).
 */
export function formatCoordinate(v: string | null): string {
  if (v === null) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

/**
 * A link to look at the point on a map, to check it before saving and after. Built from
 * the stored text, and opened only when the person follows it.
 */
export function mapLink(latitude: string, longitude: string): string {
  const lat = encodeURIComponent(formatCoordinate(latitude));
  const lng = encodeURIComponent(formatCoordinate(longitude));
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

export interface OperatingUnitChoice {
  readonly operating_unit_id: string;
  readonly brand_id: string;
  /** The codes of the facilities already in it, which is how people know it. */
  readonly codes: readonly string[];
}

/**
 * The operating units a create form may offer: those the facilities already read belong
 * to, each with its brand and its facilities' codes, ordered by brand and first code.
 * No route lists operating units or creates one (they are 0003's reference data), so a
 * unit with no facility yet cannot be offered here (ADR-0028's step 3 addendum).
 */
export function operatingUnits(facilities: readonly Facility[], brands: readonly ViewerBrand[]): OperatingUnitChoice[] {
  const byUnit = new Map<string, { brand_id: string; codes: string[] }>();
  for (const f of facilities) {
    const u = byUnit.get(f.operating_unit_id) ?? { brand_id: f.brand_id, codes: [] };
    u.codes.push(f.code);
    byUnit.set(f.operating_unit_id, u);
  }
  const brandOrder = (id: string) => {
    const i = brands.findIndex((b) => b.brand_id === id);
    return i === -1 ? brands.length : i;
  };
  return [...byUnit.entries()]
    .map(([operating_unit_id, u]) => ({ operating_unit_id, brand_id: u.brand_id, codes: [...u.codes].sort() }))
    .sort((a, b) => brandOrder(a.brand_id) - brandOrder(b.brand_id) || a.codes[0]!.localeCompare(b.codes[0]!));
}

/** The most pages read before the list is called unreadable: 25,000 facilities at 500 a page. */
export const MAX_FACILITY_PAGES = 50;

/**
 * Every page of a facility list, following `next_after`. A failure on any page is the
 * answer. So is a list longer than MAX_FACILITY_PAGES, never a partial one: an operating
 * unit on a page not read would silently go unoffered (found in review).
 */
export async function readAllFacilities(
  page: (after: string | null) => Promise<Answer<FacilityList>>,
): Promise<{ ok: true; value: Facility[] } | Failure> {
  const out: Facility[] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_FACILITY_PAGES; n++) {
    const answer = await page(after);
    if (!answer.ok) return answer;
    out.push(...answer.value.facilities);
    after = answer.value.next_after;
    if (after === null) return { ok: true, value: out };
  }
  return { ok: false, http: 500, status: 'error', message: null, constraint: null, detail: null, field: null };
}
