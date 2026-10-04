/**
 * From the session's answer to what the console shows: the menu's Viewer, and where the
 * person is working.
 *
 * THIS IS NOT A CONTROL, any more than navigation.ts is. Every route asks
 * erp.assert_permitted() itself, so a viewer built wrongly here shows a door the database
 * still keeps shut (CAP-P04).
 *
 * Requirements: CAP-P02 · CAP-P04 · CAP-P06 · IAM-006
 */
import type { SessionData, ViewerData } from './api.ts';
import { CAPABILITY_STATES, type CapabilityState, type Viewer } from './navigation.ts';

const KNOWN: ReadonlySet<string> = new Set(CAPABILITY_STATES);

/**
 * The menu's Viewer. A state the console does not know is HIDDEN, not passed on: a newer
 * migration's state must not open a menu entry in an older console (CAP-P02's
 * default-deny, applied to drift).
 */
export function toViewer(data: ViewerData): Viewer {
  const states = new Map<string, CapabilityState>();
  for (const [capability, state] of Object.entries(data.states)) {
    states.set(capability, KNOWN.has(state) ? (state as CapabilityState) : 'hidden');
  }
  return { states, permissions: new Set(data.permissions), preview: false };
}

/**
 * Where a person works when they sign in. Someone organisation-wide starts with the
 * organisation as a whole (null), where the item master's changes are made; anyone else
 * starts at their primary facility if they can work there, else their first. They can
 * switch to any facility in `facilities`.
 */
export function defaultFacility(data: ViewerData): string | null {
  if (data.org_wide) return null;
  const primary = data.person.primary_facility_id;
  if (primary !== null && data.facilities.some((f) => f.facility_id === primary)) return primary;
  return data.facilities.length >= 1 ? data.facilities[0]!.facility_id : null;
}

/**
 * The brand a facility belongs to, or null organisation-wide. Reads at a facility are
 * that brand's only (ADR-0012), so a facility-scoped create form offers just this one.
 */
export function facilityBrand(data: ViewerData, facilityId: string | null): string | null {
  if (facilityId === null) return null;
  return data.facilities.find((f) => f.facility_id === facilityId)?.brand_id ?? null;
}

/** The brands a create form may offer: the facility's own, or every brand organisation-wide. */
export function brandsFor(data: ViewerData, facilityId: string | null): ViewerData['brands'] {
  const brand = facilityBrand(data, facilityId);
  return brand === null ? data.brands : data.brands.filter((b) => b.brand_id === brand);
}

/** True when the session answer is for this person: a stale answer is never shown. */
export function isCurrent(session: SessionData, personId: string): boolean {
  return session.person_id === personId && session.viewer.person.person_id === personId;
}

/**
 * Whether the items screens offer changes. Item master writes are central: every one of
 * 0012's write routes asks erp.assert_permitted(…, 'write', NULL), so it takes an
 * organisation-wide role and the capability's organisation-wide state. The console
 * mirrors that — changes are offered only while working organisation-wide, from a viewer
 * computed for the organisation (facility null) — so a branch role holding write is not
 * shown a button the database refuses.
 */
export function itemsWritable(viewer: Viewer, facilityId: string | null, writable: (v: Viewer) => boolean): boolean {
  return facilityId === null && writable(viewer);
}
