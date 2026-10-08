/**
 * The ordering-setup function: 0024's six write routes and six reads over HTTP (module 9,
 * step 2).
 *
 *   GET   /ordering-setup/sources                                 erp.replenishment_sources()
 *   GET   /ordering-setup/sources/{item_id}                       erp.replenishment_source_history()
 *   POST  /ordering-setup/sources/{item_id}                       erp.set_replenishment_source()
 *   POST  /ordering-setup/sources/{item_id}/clear                 erp.clear_replenishment_source()
 *   GET   /ordering-setup/cutoffs                                 erp.order_cutoffs()
 *   GET   /ordering-setup/cutoffs/{facility_id}                   erp.order_cutoff_history()
 *   POST  /ordering-setup/cutoffs/{facility_id}                   erp.set_order_cutoff()
 *   POST  /ordering-setup/cutoffs/{facility_id}/clear             erp.clear_order_cutoff()
 *   GET   /ordering-setup/pars/{branch_id}                        erp.par_levels()
 *   GET   /ordering-setup/pars/{branch_id}/items/{item_id}        erp.par_level_history()
 *   POST  /ordering-setup/pars/{branch_id}                        erp.set_par_level()
 *   POST  /ordering-setup/pars/{branch_id}/items/{item_id}/clear  erp.clear_par_level()
 *
 * As ./stock-alerts.ts, line for line where the routes allow:
 *
 *   THE ACTOR is the person the caller's token resolves to, through withSession, passed
 *   as its own argument (ADR-0025). No field of any body or query is read as an actor.
 *
 *   SHAPE ONLY is checked here (./fields.ts). A par is decimal text, as a minimum is. Who
 *   may set what, and where; that a source is an open warehouse or factory of the item's
 *   brand; that a cut-off is a time of day; that a par is above nothing, exact and in a
 *   current pack; that a par is set from the facility that supplies its item — every rule
 *   is 0024's, and its refusal comes back through ./refusal.ts.
 *
 *   WHAT A SETTING IS ABOUT IS NAMED IN THE PATH: the item a source is of, the facility a
 *   cut-off is of, the branch a par is for and, for a clear, its item. So no body can name
 *   another (as a minimum's clear and a reversal's target).
 *
 *   THE DECISION IDS are minted by the console (I-1). A retried write is answered 409
 *   already_recorded, and the console confirms it through the setting's history, asked as
 *   the write was, paging back until it finds the decision. 0024 checks an id against its
 *   whole log, so one the history does not hold was used for another: a collision, never a
 *   retry.
 *
 *   THE STAMP IS STATED, as a minimum's (ADR-0031's step 2 addendum). A set names
 *   `expected_decision_id`: the decision in force, a clearing included, or null when the
 *   setting has NEVER been made. Left out, or empty, it is a 400, never read as "none". A
 *   clear names a stamp, always. The par list leaves cleared pars out, so a cleared par's
 *   stamp is read from its history.
 *
 * THREE THINGS OF ITS OWN:
 *
 *   A CUT-OFF IS 'HH:MM' TEXT: two digits, a colon, two digits, never a number or a moment.
 *   That it is a time of day, 00:00 to 23:59, is 0024's rule, so '24:00' reaches it and is
 *   refused there by name. To have none, the cut-off is cleared: an empty one is a 400.
 *
 *   A PAR WRITE STATES WHERE IT IS SET FROM: `facility_id`, the facility that supplies the
 *   item, or null for the organisation (O5).
 *   Left out, it is a 400: a form that never chose must not pass for one that chose the
 *   organisation, which only an organisation-wide writer passes anyway.
 *
 *   A SOURCE NAMES ITS FACILITY AS `supplied_by`, as the list's filter does, so it is never
 *   read as the facility the person works at.
 *
 * Reads ask at the query's `facility_id`, or organisation-wide without one, as the masters'
 * do; a cut-off's history is asked at the facility it is of, which its path names.
 */
import { endpoint, type Deps, type Reply } from './http.ts';
import type { Session } from './handlers.ts';
import {
  facilityOf, form, listLimit, Malformed, noSuchRoute, ok, optionalText, optionalUuid, routeOf, shaped, text, uuid,
  type Source,
} from './fields.ts';

/** Decimal text, as ./stock-alerts.ts's: digits, and a point with digits after it. How many is 0024's rule. */
const QUANTITY = /^\d{1,40}(\.\d{1,40})?$/;

/** 'HH:MM' in shape: which hours and minutes are a time of day is 0024's rule. */
const CUTOFF = /^\d{2}:\d{2}$/;

function quantity(source: Source): string {
  const v = source['quantity'];
  if (typeof v !== 'string' || !QUANTITY.test(v)) throw new Malformed('quantity');
  return v;
}

function cutoff(source: Source): string {
  const v = source['cutoff'];
  if (typeof v !== 'string' || !CUTOFF.test(v)) throw new Malformed('cutoff');
  return v;
}

/** A stamp the form read: present, and a UUID or null. Absent or empty is malformed, never "none". */
function statedStamp(source: Source): string | null {
  // Only null is none: absent and empty fail uuid(), and are malformed.
  return source['expected_decision_id'] === null ? null : uuid(source, 'expected_decision_id');
}

/** Where a par is set from: present, and a UUID or null for the organisation. Absent or empty is malformed. */
function statedFrom(source: Source): string | null {
  return source['facility_id'] === null ? null : uuid(source, 'facility_id');
}

/** A history page ends before a seq: decimal text of a positive int8. */
function beforeSeq(query: Source): string | null {
  const v = query['before'];
  if (v === undefined) return null;
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v) || BigInt(v) > 9223372036854775807n) {
    throw new Malformed('before');
  }
  return v;
}

const queryOf = (request: Request): Source => Object.fromEntries(new URL(request.url).searchParams);

/** A path segment as a UUID, malformed as `field`. */
const idOf = (segment: string | undefined, field: string): string => uuid({ [field]: segment }, field);

/** Keyset paging: a full page may have a next one, which starts after its last code. */
const nextAfter = (rows: readonly { readonly code: string }[], limit: number) =>
  rows.length === limit ? rows[rows.length - 1]!.code : null;

/** Newest first: a full page may have an older one, which ends before its last seq. */
function decisions(rows: readonly Record<string, unknown>[], limit: number): Reply {
  const last = rows[rows.length - 1];
  return ok({ decisions: rows, next_before: rows.length === limit && last !== undefined ? String(last['seq']) : null });
}

async function reads(request: Request, s: Session, deps: Deps, path: string[]): Promise<Reply> {
  const q = queryOf(request);
  const db = deps.db;
  const actor = s.personId;

  if (path[0] === 'sources' && path.length === 1) {
    const limit = listLimit(q);
    const rows = await db.replenishmentSources(actor, {
      facilityId: facilityOf(request), suppliedBy: optionalUuid(q, 'supplied_by'),
      afterCode: optionalText(q, 'after', 64), limit,
    });
    return ok({ sources: rows, next_after: nextAfter(rows, limit) });
  }
  if (path[0] === 'sources' && path.length === 2) {
    const itemId = idOf(path[1], 'item_id');
    const limit = listLimit(q);
    return decisions(await db.replenishmentSourceHistory(actor, {
      facilityId: facilityOf(request), itemId, beforeSeq: beforeSeq(q), limit,
    }), limit);
  }
  if (path[0] === 'cutoffs' && path.length === 1) {
    const limit = listLimit(q);
    const rows = await db.orderCutoffs(actor, { facilityId: facilityOf(request), afterCode: optionalText(q, 'after', 64), limit });
    return ok({ cutoffs: rows, next_after: nextAfter(rows, limit) });
  }
  if (path[0] === 'cutoffs' && path.length === 2) {
    const facilityId = idOf(path[1], 'facility_id');
    const limit = listLimit(q);
    return decisions(await db.orderCutoffHistory(actor, { facilityId, beforeSeq: beforeSeq(q), limit }), limit);
  }
  if (path[0] === 'pars' && path.length === 2) {
    const branchId = idOf(path[1], 'branch_id');
    const limit = listLimit(q);
    const rows = await db.parLevels(actor, {
      facilityId: facilityOf(request), branchId, afterCode: optionalText(q, 'after', 64), limit,
    });
    return ok({ pars: rows, next_after: nextAfter(rows, limit) });
  }
  if (path[0] === 'pars' && path.length === 4 && path[2] === 'items') {
    const branchId = idOf(path[1], 'branch_id');
    const itemId = idOf(path[3], 'item_id');
    const limit = listLimit(q);
    return decisions(await db.parLevelHistory(actor, {
      facilityId: facilityOf(request), branchId, itemId, beforeSeq: beforeSeq(q), limit,
    }), limit);
  }
  return noSuchRoute;
}

async function writes(request: Request, s: Session, deps: Deps, path: string[]): Promise<Reply> {
  const db = deps.db;
  const actor = s.personId;

  // The route is resolved before any field is read, so an unknown path is 404, not 400.
  if (path[0] === 'sources' && path.length === 2) {
    const itemId = idOf(path[1], 'item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.setReplenishmentSource(actor, {
      decisionId, itemId, suppliedBy: uuid(b, 'supplied_by'), expectedDecisionId: statedStamp(b),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path[0] === 'sources' && path.length === 3 && path[2] === 'clear') {
    const itemId = idOf(path[1], 'item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.clearReplenishmentSource(actor, {
      decisionId, itemId, expectedDecisionId: uuid(b, 'expected_decision_id'), reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path[0] === 'cutoffs' && path.length === 2) {
    const facilityId = idOf(path[1], 'facility_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.setOrderCutoff(actor, {
      decisionId, facilityId, cutoff: cutoff(b), expectedDecisionId: statedStamp(b), reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path[0] === 'cutoffs' && path.length === 3 && path[2] === 'clear') {
    const facilityId = idOf(path[1], 'facility_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.clearOrderCutoff(actor, {
      decisionId, facilityId, expectedDecisionId: uuid(b, 'expected_decision_id'), reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path[0] === 'pars' && path.length === 2) {
    const branchId = idOf(path[1], 'branch_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.setParLevel(actor, {
      decisionId, facilityId: statedFrom(b), branchId, itemUnitId: uuid(b, 'item_unit_id'), quantity: quantity(b),
      expectedDecisionId: statedStamp(b), reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  if (path[0] === 'pars' && path.length === 5 && path[2] === 'items' && path[4] === 'clear') {
    const branchId = idOf(path[1], 'branch_id');
    const itemId = idOf(path[3], 'item_id');
    const b = await form(request);
    const decisionId = uuid(b, 'decision_id');
    await db.clearParLevel(actor, {
      decisionId, facilityId: statedFrom(b), branchId, itemId, expectedDecisionId: uuid(b, 'expected_decision_id'),
      reason: text(b, 'reason', 500),
    });
    return ok({ decision_id: decisionId });
  }
  return noSuchRoute;
}

async function dispatch(request: Request, s: Session, deps: Deps): Promise<Reply> {
  const path = routeOf(request, 'ordering-setup');
  return request.method === 'GET' ? reads(request, s, deps, path) : writes(request, s, deps, path);
}

/** Every route, signed in. A malformed field is a 400 naming the field, and nothing reaches the database. */
export const orderingSetup = endpoint(['GET', 'POST'], shaped(dispatch));
