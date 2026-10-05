/**
 * The facilities function: 0019's seven runtime routes over HTTP (module 4, step 2).
 *
 *   GET   /facilities                              erp.list_facilities()
 *   GET   /facilities/{facility_id}                erp.get_facility()
 *   GET   /facilities/{facility_id}/history        erp.facility_history()
 *   POST  /facilities                              erp.create_facility()
 *   POST  /facilities/{facility_id}/amend          erp.amend_facility()
 *   POST  /facilities/{facility_id}/area           erp.set_facility_area()
 *   POST  /facilities/{facility_id}/status         erp.change_facility_status()
 *
 * As ./suppliers.ts and ./transfer-prices.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). A code is text, a coordinate is decimal
 *   text, a radius is an integer; that a code is canonical and unused, that a point is on
 *   the earth, that a radius runs 25 to 2000 m, that a closed facility is reopened before
 *   it changes — every rule is 0019's, and its refusal comes back through ./refusal.ts.
 *
 *   THE FACILITY a read is asked at is the query's `facility_id`, checked by
 *   erp.assert_permitted() there, which also limits what is read to that facility's brand
 *   (ADR-0012). It is never the facility read: that is the path's. Writes take none:
 *   0019 gates them organisation-wide.
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through the facility's history.
 *
 * TWO THINGS OF ITS OWN:
 *
 *   A COORDINATE IS DECIMAL TEXT, as a factor is (./items.ts): "24.713600", never the
 *   number 24.7136. It goes to a numeric(9,6) column, and a float has no business on the
 *   way. The answer carries coordinates the same way.
 *
 *   AN AREA IS STATED WHOLE. latitude, longitude and radius_m must all be present, as a
 *   value or null: the route puts the whole area in force, and an absent field read as
 *   null would remove an area by omission. All three null removes it on purpose.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, noSuchRoute, ok, optionalText, routeOf, shaped, text, uuid, type Source,
} from './fields.ts';

/** A field a write overwrites: present, as text of at most `max` characters or null. */
function stated(source: Source, field: string, max: number): string | null {
  if (!Object.hasOwn(source, field)) throw new Malformed(field);
  return optionalText(source, field, max);
}

/** A latitude or longitude: decimal text with up to six places, or null; always present. */
const COORDINATE = /^-?\d{1,3}(\.\d{1,6})?$/;

function coordinate(source: Source, field: string): string | null {
  if (!Object.hasOwn(source, field)) throw new Malformed(field);
  const v = source[field];
  if (v === null) return null;
  if (typeof v !== 'string' || !COORDINATE.test(v)) throw new Malformed(field);
  return v;
}

/** A radius in whole metres, as a JSON integer, or null; absent is malformed. Its range is 0019's. */
function radius(source: Source): number | null {
  const v = source['radius_m'];
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new Malformed('radius_m');
  return v;
}

function facilityStatus(source: Source): 'open' | 'closed' {
  const v = source['status'];
  if (v !== 'open' && v !== 'closed') throw new Malformed('status');
  return v;
}

/** A list's `status` filter: open (the default), closed, or all, which is null. */
function listStatus(query: Source): 'open' | 'closed' | null {
  const wanted = query['status'] ?? 'open';
  if (wanted !== 'open' && wanted !== 'closed' && wanted !== 'all') throw new Malformed('status');
  return wanted === 'all' ? null : wanted;
}

async function list(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const limit = listLimit(q);
  const facilities = await deps.db.listFacilities(s.personId, {
    facilityId: facilityOf(request),
    status: listStatus(q),
    search: optionalText(q, 'search', 100),
    afterCode: optionalText(q, 'after', 64),
    limit,
  });
  // Keyset paging: a full page may have a next one, which starts after its last code.
  return ok({ facilities, next_after: facilities.length === limit ? facilities[facilities.length - 1]!.code : null });
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'facilities');
  const actor = s.personId;

  if (request.method === 'GET') {
    if (path.length === 0) return list(request, s, deps);
    if (path.length === 1 || (path.length === 2 && path[1] === 'history')) {
      const targetId = uuid({ facility_id: path[0] }, 'facility_id');
      if (path.length === 1) return ok({ facility: await deps.db.getFacility(actor, facilityOf(request), targetId) });
      return ok({ decisions: await deps.db.facilityHistory(actor, facilityOf(request), targetId) });
    }
    return noSuchRoute;
  }

  // POST. The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path.length === 0) {
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await deps.db.createFacility(actor, {
      decisionId,
      facilityId: uuid(b, 'facility_id'),
      operatingUnitId: uuid(b, 'operating_unit_id'),
      facilityType: text(b, 'facility_type', 32),
      code: text(b, 'code', 64),
      nameEn: text(b, 'name_en', 200),
      nameAr: text(b, 'name_ar', 200),
      addressEn: optionalText(b, 'address_en', 500),
      addressAr: optionalText(b, 'address_ar', 500),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path.length === 2 && ['amend', 'area', 'status'].includes(path[1]!)) {
    const facilityId = uuid({ facility_id: path[0] }, 'facility_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    const expectedDecisionId = uuid(b, 'expected_decision_id');
    const reason = text(b, 'reason', 500);
    switch (path[1]) {
      case 'amend':
        await deps.db.amendFacility(actor, {
          decisionId, facilityId, expectedDecisionId,
          nameEn: text(b, 'name_en', 200),
          nameAr: text(b, 'name_ar', 200),
          addressEn: stated(b, 'address_en', 500),
          addressAr: stated(b, 'address_ar', 500),
          reason,
        });
        break;
      case 'area':
        await deps.db.setFacilityArea(actor, {
          decisionId, facilityId, expectedDecisionId,
          latitude: coordinate(b, 'latitude'),
          longitude: coordinate(b, 'longitude'),
          radiusM: radius(b),
          reason,
        });
        break;
      case 'status':
        await deps.db.changeFacilityStatus(actor, { decisionId, facilityId, expectedDecisionId, status: facilityStatus(b), reason });
        break;
    }
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const facilities = endpoint(['GET', 'POST'], shaped(dispatch));
