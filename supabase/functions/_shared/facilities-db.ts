/**
 * What the facilities function asks the database: 0019's seven runtime routes, one method
 * each.
 *
 * As ./transfer-prices-db.ts: every method takes the actor FIRST and as its own argument,
 * never inside an input object. The only caller is ./facilities.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now().
 *
 * erp.assert_at_facility() and erp.assert_facility_open(), the seams a branch order and
 * other new work call, are not here: they are owner-only, called from later modules' own
 * routes, never from the edge.
 */

/**
 * One facility, as erp.list_facilities() and erp.get_facility() return it. A latitude and
 * a longitude are decimal TEXT, as postgres.js answers a numeric and as a factor travels:
 * never parsed into a float on the way.
 */
export interface Facility {
  readonly facility_id: string;
  readonly operating_unit_id: string;
  readonly brand_id: string;
  readonly facility_type: 'branch' | 'warehouse' | 'factory' | 'office';
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly address_en: string | null;
  readonly address_ar: string | null;
  readonly tz_name: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly geofence_radius_m: number | null;
  readonly status: 'open' | 'closed';
  /** The stamp an edit form sends back as `expected_decision_id`. */
  readonly as_of_decision_id: string;
}

export interface FacilityQuery {
  readonly facilityId: string | null;
  /** null lists both. */
  readonly status: 'open' | 'closed' | null;
  readonly search: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface CreateFacility {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly operatingUnitId: string;
  readonly facilityType: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly addressEn: string | null;
  readonly addressAr: string | null;
  readonly reason: string;
}

export interface AmendFacility {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly expectedDecisionId: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly addressEn: string | null;
  readonly addressAr: string | null;
  readonly reason: string;
}

/** A point and a radius, or all three null for no area. A radius left null with a point is 150 m. */
export interface SetFacilityArea {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly expectedDecisionId: string;
  /** Decimal text, at most six places. */
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly radiusM: number | null;
  readonly reason: string;
}

export interface ChangeFacilityStatus {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly expectedDecisionId: string;
  readonly status: 'open' | 'closed';
  readonly reason: string;
}

export interface FacilitiesDb {
  listFacilities(actor: string, query: FacilityQuery): Promise<readonly Facility[]>;
  getFacility(actor: string, facilityId: string | null, targetId: string): Promise<Facility>;
  facilityHistory(actor: string, facilityId: string | null, targetId: string): Promise<readonly Record<string, unknown>[]>;
  createFacility(actor: string, input: CreateFacility): Promise<void>;
  amendFacility(actor: string, input: AmendFacility): Promise<void>;
  setFacilityArea(actor: string, input: SetFacilityArea): Promise<void>;
  changeFacilityStatus(actor: string, input: ChangeFacilityStatus): Promise<void>;
}
