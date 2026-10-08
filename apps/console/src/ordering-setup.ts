/**
 * The ordering-setup screens' logic (module 9, step 3), kept out of .tsx so
 * test/ordering-setup.test.ts can read it.
 *
 * THREE SETTINGS, each a decision with its history (0024, ADR-0033):
 *
 *   A SOURCE is the warehouse or factory that supplies branches with an item (O1). A master,
 *   set organisation-wide as items are: 0024's source routes ask permission at no facility,
 *   so changes are offered only while working organisation-wide.
 *
 *   A CUT-OFF is a supplying facility's time of day, read in its own time zone (O2, O3): an
 *   order at or after it is for the next day, never refused. 0024 asks permission AT the
 *   facility, as 0023 asks a purchase limit's, so a cut-off is changed only while working
 *   there, from a viewer computed there.
 *
 *   A PAR is a branch's order-up-to level for an item (O4), entered in a pack and sent as the
 *   decimal text typed. It is set from the facility that supplies the item, or
 *   organisation-wide (O5), and every par write states which: `facility_id`, null for the
 *   organisation. A branch's staff read their own branch's pars, and set none.
 *
 * THE STAMP IS THE DECISION IN FORCE, as a minimum's (ADR-0033's step 2 addendum). A set sends
 * `expected_decision_id`: the decision its history marks, a clearing included, or null when
 * the setting has never been made. A clear sends it always. The par list leaves cleared pars
 * out, so a stamp is read from the history, never from a list.
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0024 decides every rule; its refusals are worded
 * (messages.ts).
 *
 * Requirements: INV-014 · INV-P05 · INV-P06 · INV-P07 · IAM-006 · PRG-014
 */
import type {
  Answer, ClearCutoffInput, ClearParInput, ClearSourceInput, CutoffRow, Failure, ItemUnit, SetCutoffInput, SetParInput,
  SetSourceInput, ViewerFacility,
} from './api.ts';
import { latinDigits } from './format.ts';
import type { CapabilityState, NavItem, Viewer } from './navigation.ts';
import { quantityInput } from './stock.ts';
import type { Outcome } from './write.ts';

/** The facility types that supply branches (0024: ordering_facility_supplies_nothing). */
export const SUPPLYING_TYPES: ReadonlySet<string> = new Set(['warehouse', 'factory']);

/** The decisions 0024 records, for labels (each log's `_decision_kind_is_known`). */
export const SOURCE_KINDS = ['source_set', 'source_cleared'] as const;
export const CUTOFF_KINDS = ['cutoff_set', 'cutoff_cleared'] as const;
export const PAR_KINDS = ['par_set', 'par_cleared'] as const;

/** The kinds that leave a setting in force; the others clear it. */
const SET_KINDS: ReadonlySet<string> = new Set([SOURCE_KINDS[0], CUTOFF_KINDS[0], PAR_KINDS[0]]);

/** A decision as each of 0024's three histories returns it, newest first. */
interface Decided {
  readonly decision_id: string;
  readonly kind: string;
  readonly is_current: boolean;
}

/**
 * The stamp a set or a clear is checked against: the decision in force, which the history
 * marks, a clearing included; or null when the setting has never been made. A history is
 * newest first, so its first row is the one in force should the mark be missing.
 */
export function stampOf(history: readonly Decided[]): string | null {
  return (history.find((d) => d.is_current) ?? history[0])?.decision_id ?? null;
}

/** The decision in force when it sets something; null when never set, or cleared. */
export function inForce<D extends Decided>(history: readonly D[]): D | null {
  const d = history.find((x) => x.is_current) ?? history[0];
  return d !== undefined && SET_KINDS.has(d.kind) ? d : null;
}

/** 0024's rule for a cut-off (set_order_cutoff: order_cutoff_is_valid): a time of day, 00:00 to 23:59. */
export const CUTOFF_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * A cut-off as typed, on the 24-hour clock: '14:00', or '9:30', with Arabic-Indic digits
 * read. Three or four digits alone read the same, '1400' or '930': a phone's number pad has
 * no colon (found in review). Sent as 'HH:MM', the hour padded, and checked by 0024's own
 * rule, so '24:00' is refused here as it is there. Never a number, and never a moment: it is
 * a time of day at the facility, read in its own time zone.
 */
export function cutoffInput(raw: string): { ok: true; value: string } | { ok: false } {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(latinDigits(raw).trim());
  if (m === null) return { ok: false };
  const value = `${m[1]!.padStart(2, '0')}:${m[2]!}`;
  return CUTOFF_PATTERN.test(value) ? { ok: true, value } : { ok: false };
}

/** A par as typed: 0024's rule (par_level_is_valid), which is stock's, and more than nothing (O4). */
export function parInput(raw: string): { ok: true; value: string } | { ok: false } {
  return quantityInput(raw, false);
}

/** The packs a par may be entered in: the item's current ones (0024: par_level_pack_is_retired). */
export function parPacks(units: readonly ItemUnit[]): ItemUnit[] {
  return units.filter((u) => u.status === 'active');
}

/** A source's body: the item is named in the path; the facility is `supplied_by`, never where the person works. */
export function setSourceBody(ids: { decision_id: string }, f: {
  suppliedBy: string; expectedDecisionId: string | null; reason: string;
}): SetSourceInput {
  return {
    decision_id: ids.decision_id,
    supplied_by: f.suppliedBy,
    // Stated, null included: the edge refuses a set that leaves it out.
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

export function clearSourceBody(ids: { decision_id: string }, f: { expectedDecisionId: string; reason: string }): ClearSourceInput {
  return { decision_id: ids.decision_id, expected_decision_id: f.expectedDecisionId, reason: f.reason.trim() };
}

/** A cut-off's body: the facility is named in the path; the cut-off is 'HH:MM' text. */
export function setCutoffBody(ids: { decision_id: string }, f: {
  cutoff: string; expectedDecisionId: string | null; reason: string;
}): SetCutoffInput {
  return {
    decision_id: ids.decision_id,
    cutoff: f.cutoff,
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

export function clearCutoffBody(ids: { decision_id: string }, f: { expectedDecisionId: string; reason: string }): ClearCutoffInput {
  return { decision_id: ids.decision_id, expected_decision_id: f.expectedDecisionId, reason: f.reason.trim() };
}

/**
 * A par's body: the branch is named in the path. `facility_id` is where it is set from,
 * stated always: the facility worked at, which supplies the item, or null for the
 * organisation. Left out, the edge refuses it rather than read it as the organisation.
 */
export function setParBody(ids: { decision_id: string }, f: {
  from: string | null; itemUnitId: string; quantity: string; expectedDecisionId: string | null; reason: string;
}): SetParInput {
  return {
    decision_id: ids.decision_id,
    facility_id: f.from,
    item_unit_id: f.itemUnitId,
    quantity: f.quantity,
    expected_decision_id: f.expectedDecisionId,
    reason: f.reason.trim(),
  };
}

/** A par's clear: the branch and the item are named in the path only. */
export function clearParBody(ids: { decision_id: string }, f: {
  from: string | null; expectedDecisionId: string; reason: string;
}): ClearParInput {
  return { decision_id: ids.decision_id, facility_id: f.from, expected_decision_id: f.expectedDecisionId, reason: f.reason.trim() };
}

/** What the person may do with ordering setup where they are working, by 0024's gates. */
export interface OrderingRights {
  /** Read on the setup and on items here: every source read asks both. */
  readonly seesSources: boolean;
  /** Set and clear sources: organisation-wide only, as 0024 asks at no facility. */
  readonly setsSources: boolean;
  /** Read on the setup here: the cut-off list asks it alone. */
  readonly seesCutoffs: boolean;
  /** Set and clear the cut-off of the facility worked at, a warehouse or a factory. */
  readonly setsCutoffs: boolean;
  /**
   * Holds write on the setup here, so changes a cut-off while working at its facility: told
   * so where they cannot change one. Anyone else is told only that they cannot (found in
   * review: a manager at their own facility was told to work there to change it).
   */
  readonly writesCutoffs: boolean;
  /** Read on pars and on items here: every par read asks both. */
  readonly seesPars: boolean;
  /** Set and clear pars, from the facility worked at (a warehouse or factory) or organisation-wide. */
  readonly setsPars: boolean;
  /** Where a par write is set from, which it states: the facility worked at, or null for the organisation. */
  readonly parFrom: string | null;
}

export const NO_ORDERING_RIGHTS: OrderingRights = {
  seesSources: false, setsSources: false, seesCutoffs: false, setsCutoffs: false, writesCutoffs: false, seesPars: false,
  setsPars: false, parFrom: null,
};

/** The menu entries the rights are read from: their visibility is the read every route asks. */
export interface OrderingEntries {
  readonly sources: NavItem;
  readonly cutoffs: NavItem;
  readonly pars: NavItem;
}

/**
 * The rights at the facility worked at (null, the organisation), from a viewer computed
 * there, as 0024 asks there. `facility` is that facility from the session's list; one the
 * list does not name is no place to change anything.
 *
 *   sources    write, with the reads, at NULL: organisation-wide only
 *   cut-offs   write, with the read, AT the facility: a warehouse or factory worked at
 *   pars       write, with the reads, where the par is set from: a warehouse or factory
 *              worked at, or the organisation. Never a branch or an office: neither
 *              supplies anything (par_level_not_its_source)
 */
export function orderingRights(facilityId: string | null, facility: ViewerFacility | undefined, viewer: Viewer,
                               entries: OrderingEntries,
                               itemIsVisible: (item: NavItem, viewer: Viewer) => boolean,
                               itemIsWritable: (item: NavItem, viewer: Viewer) => boolean): OrderingRights {
  const orgWide = facilityId === null;
  const supplying = !orgWide && facility !== undefined && facility.facility_id === facilityId
    && SUPPLYING_TYPES.has(facility.facility_type);
  const seesSources = itemIsVisible(entries.sources, viewer);
  const seesCutoffs = itemIsVisible(entries.cutoffs, viewer);
  const seesPars = itemIsVisible(entries.pars, viewer);
  const writesCutoffs = seesCutoffs && itemIsWritable(entries.cutoffs, viewer);
  return {
    seesSources,
    setsSources: orgWide && seesSources && itemIsWritable(entries.sources, viewer),
    seesCutoffs,
    setsCutoffs: supplying && writesCutoffs,
    writesCutoffs,
    seesPars,
    setsPars: (orgWide || supplying) && seesPars && itemIsWritable(entries.pars, viewer),
    parFrom: supplying ? facilityId : null,
  };
}

/**
 * Where pars are read from, by the facility worked at (0024: erp.assert_par_read()):
 *
 *   org       organisation-wide: any branch, every par
 *   source    a warehouse or factory: any branch of its brand, the pars of what it supplies
 *   branch    a branch: its own pars, and no other branch's (IAM-006)
 *   none      an office, or a facility the session does not name: pars are read elsewhere
 */
export type ParPlace =
  | { readonly kind: 'org' }
  | { readonly kind: 'source'; readonly facility: ViewerFacility }
  | { readonly kind: 'branch'; readonly facility: ViewerFacility }
  | { readonly kind: 'none' };

export function parPlace(facilityId: string | null, facility: ViewerFacility | undefined): ParPlace {
  if (facilityId === null) return { kind: 'org' };
  if (facility === undefined || facility.facility_id !== facilityId) return { kind: 'none' };
  if (SUPPLYING_TYPES.has(facility.facility_type)) return { kind: 'source', facility };
  if (facility.facility_type === 'branch') return { kind: 'branch', facility };
  return { kind: 'none' };
}

/**
 * What a par page says of a write's outcome, by whether the page then shows the par
 * (`shown`). The page a settled write lands on, an item no longer supplied from here, shows
 * none, so it is never told "shown as it is now" (found in the third review). Null says
 * nothing: Start over found the record as it was.
 */
export function parWriteBanner(outcome: Outcome | null, shown: boolean):
  'saved' | 'par_already_recorded' | 'par_already_recorded_elsewhere' | 'par_changed' | 'par_changed_elsewhere' | null {
  if (outcome === null || outcome === 'checked') return null;
  if (outcome === 'saved') return 'saved';
  if (outcome === 'already') return shown ? 'par_already_recorded' : 'par_already_recorded_elsewhere';
  return shown ? 'par_changed' : 'par_changed_elsewhere';
}

/** The capability 0024 asks pars by, where they are set from and again at their branch. */
export const PAR_CAPABILITY = 'ordering.par_levels';

/**
 * Whether a par page's branch is where the person works. Its state there is then the
 * session's own; anywhere else it is read at the branch (screens/ParLevels.tsx, useBranchState).
 */
export function branchIsHere(place: ParPlace, branchId: string): boolean {
  return place.kind === 'branch' && place.facility.facility_id === branchId;
}

/**
 * Whether a par read refused from a warehouse or factory (`from`) means the item is not
 * supplied from there: 0024 answers it item_exists, as missing, rather than say where it
 * is supplied from. Only that refusal: a branch 0024 does not know there answers
 * facility_exists, and is 0024's to say (found in the second review). The item's source,
 * where read, must not be `from`; unread, it is not known to be.
 */
export function suppliedElsewhere(from: string | null, refusal: { readonly status: string; readonly constraint: string | null } | null,
                                  source: string | null | undefined): boolean {
  return from !== null && refusal !== null && refusal.status === 'not_found' && refusal.constraint === 'item_exists' && source !== from;
}

/**
 * Whether a par read's refusal is par levels being hidden at the branch, which a page says
 * as such: 0024 refuses it without naming a constraint, as "not permitted". Only a forbidden
 * answer: a branch it does not know, or a facility that is no branch, is 0024's to say,
 * whatever state the branch's id reads (found in the second review).
 */
export function hiddenRefusal(branchState: CapabilityState | null, failure: { readonly status: string } | null): boolean {
  return branchState === 'hidden' && failure !== null && failure.status === 'forbidden';
}

/**
 * The branches a par page offers to choose from, by code: of `brandId`'s brand when one is
 * given, as 0024 reads a branch from a warehouse or factory only of its own brand. The
 * session's facilities, which a chooser falls back to, are every brand's to someone
 * organisation-wide (found in review).
 */
export function branchesOf<F extends { readonly facility_type: string; readonly code: string; readonly brand_id: string }>(
  facilities: readonly F[], brandId: string | null = null,
): F[] {
  return facilities.filter((f) => f.facility_type === 'branch' && (brandId === null || f.brand_id === brandId))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * The facilities a source may be set to: the open warehouses and factories of the item's
 * brand. The cut-off list carries each one's state; the session's facilities its brand
 * (organisation-wide, where sources are set, the session names every facility). Not the
 * one in force: setting it again is refused (replenishment_source_unchanged).
 */
export function sourceOptions(cutoffs: readonly CutoffRow[], facilities: readonly ViewerFacility[], brandId: string,
                              current: string | null): CutoffRow[] {
  const brand = new Map(facilities.map((f) => [f.facility_id, f.brand_id]));
  return cutoffs.filter((c) => c.status === 'open' && SUPPLYING_TYPES.has(c.facility_type)
    && brand.get(c.facility_id) === brandId && c.facility_id !== current);
}

/** What a source page offers: set an active item's, organisation-wide; clear one in force, whatever the item's state. */
export function sourceActions(f: { setsSources: boolean; itemActive: boolean; inForce: boolean }): { set: boolean; clear: boolean } {
  return { set: f.setsSources && f.itemActive, clear: f.setsSources && f.inForce };
}

/**
 * Whether the list links a cut-off's own page: 0024 asks its history AT the facility, so the
 * list links it only organisation-wide or while working there. A branch reads the cut-offs
 * in the list. An address typed by hand is answered by 0024, which reads the history to an
 * organisation-wide role wherever it works.
 */
export function cutoffReadable(facilityId: string | null, shown: string): boolean {
  return facilityId === null || facilityId === shown;
}

/** What the cut-off list says about changing one: here, where the person works; at its facility; or not at all. */
export function cutoffsListNotice(rights: Pick<OrderingRights, 'setsCutoffs' | 'writesCutoffs'>):
  'cutoff_change_here' | 'cutoffs_change_at_facility' | 'read_only_cutoffs' {
  return rights.setsCutoffs ? 'cutoff_change_here' : rights.writesCutoffs ? 'cutoffs_change_at_facility' : 'read_only_cutoffs';
}

/**
 * What a cut-off's page says when it offers no change, or null when it offers one: closed;
 * changed while working at it, to one who holds write; or read only.
 */
export function cutoffPageNotice(f: {
  rights: Pick<OrderingRights, 'setsCutoffs' | 'writesCutoffs'>; facilityId: string | null; shown: string; status: 'open' | 'closed';
}): 'rule_facility_no_new_work' | 'cutoff_elsewhere' | 'read_only_cutoffs' | null {
  if (f.status === 'closed') return 'rule_facility_no_new_work';
  if (f.facilityId !== f.shown && (f.rights.setsCutoffs || f.rights.writesCutoffs)) return 'cutoff_elsewhere';
  return f.rights.setsCutoffs ? null : 'read_only_cutoffs';
}

/**
 * What a cut-off's page offers: only at the facility worked at, while it is open (0024
 * asks it open for both: erp.assert_supplying_facility(…, true)); a clear only while one is
 * in force.
 */
export function cutoffActions(f: {
  setsCutoffs: boolean; facilityId: string | null; shown: string; status: 'open' | 'closed'; inForce: boolean;
}): { set: boolean; clear: boolean } {
  const may = f.setsCutoffs && f.facilityId === f.shown && f.status === 'open';
  return { set: may, clear: may && f.inForce };
}

/**
 * Whether par levels take new work at a branch, by their state there: 0024 asks it again at
 * the branch a par is for (erp.assert_par_branch(): assert_capability_admits), so a pilot
 * can name the branches it covers. Null, unread, is left to 0024.
 */
export function branchAdmits(state: CapabilityState | null): boolean | null {
  return state === null ? null : state === 'enabled' || state === 'pilot';
}

/**
 * What a par's page offers, as 0024 would take it:
 *
 *   both    to one who sets pars from here, at a branch not known to be closed, nor known to
 *           take no new par (0024 asks the branch open, and par levels open there, for
 *           both), and, set from a supplying facility, for an item it supplies
 *           (par_level_not_its_source): what is unread is left to 0024
 *   set     an active item with a source, at a source not known to be closed
 *   clear   a par in force: organisation-wide even with no source, as 0024 allows
 */
export function parActions(f: {
  rights: Pick<OrderingRights, 'setsPars' | 'parFrom'>;
  branchStatus: 'open' | 'closed' | null;
  /** Par levels' state at the branch (branchAdmits), or null when unread. */
  branchState: CapabilityState | null;
  itemActive: boolean;
  inForce: boolean;
  /** The item's source: a facility, null for none, undefined when it could not be read. */
  source: string | null | undefined;
  sourceStatus: 'open' | 'closed' | null;
}): { set: boolean; clear: boolean } {
  const may = f.rights.setsPars && f.branchStatus !== 'closed' && branchAdmits(f.branchState) !== false
    && (f.rights.parFrom === null || f.source === undefined || f.source === f.rights.parFrom);
  return {
    set: may && f.itemActive && f.source !== null && f.sourceStatus !== 'closed',
    clear: may && f.inForce,
  };
}

export type ParNotice =
  | 'par_branch_hidden' | 'par_branch_closed' | 'par_branch_not_open' | 'read_only_pars'
  | 'par_set_elsewhere' | 'par_no_source' | 'par_item_retired' | 'par_source_closed';

/**
 * Why a par page offers less than it might, first reason first, or null. Every form a page
 * withholds has a stated reason (found in review: a closed source and a retired item hid Set
 * without a word).
 *
 *   par_branch_hidden     par levels are not switched on at the branch: 0024 reads none
 *   par_branch_closed     the branch is closed: 0024 sets and clears nothing there
 *   par_branch_not_open   par levels are read only or withdrawn at the branch
 *   read_only_pars        the person sets no par from here
 *   par_set_elsewhere     another facility supplies the item: its par is set there
 *   par_no_source         nothing supplies the item: no new par
 *   par_item_retired      the item takes no new par
 *   par_source_closed     the facility that supplies the item is closed
 *
 * An item's own reasons are given only on its page (`item` present); a branch's page gives
 * the branch's.
 */
export function parNotice(f: {
  rights: Pick<OrderingRights, 'setsPars' | 'parFrom'>;
  branchStatus: 'open' | 'closed' | null;
  branchState: CapabilityState | null;
  item?: {
    readonly active: boolean;
    readonly source: string | null | undefined;
    readonly sourceStatus: 'open' | 'closed' | null;
  };
}): ParNotice | null {
  if (f.branchState === 'hidden') return 'par_branch_hidden';
  if (f.branchStatus === 'closed') return 'par_branch_closed';
  if (branchAdmits(f.branchState) === false) return 'par_branch_not_open';
  if (!f.rights.setsPars) return 'read_only_pars';
  const i = f.item;
  if (i === undefined) return null;
  if (f.rights.parFrom !== null && i.source !== undefined && i.source !== null && i.source !== f.rights.parFrom) return 'par_set_elsewhere';
  if (i.source === null) return 'par_no_source';
  if (!i.active) return 'par_item_retired';
  if (i.sourceStatus === 'closed') return 'par_source_closed';
  return null;
}

/**
 * The items a search names among those read already, as the item search reads one: a code
 * from its start, or any part of a name, in either language, case aside. Used where 0024's
 * list has no search of its own: the items a supplying facility supplies.
 */
export function matchItems<R extends { readonly code: string; readonly name_en: string; readonly name_ar: string }>(
  rows: readonly R[], search: string,
): R[] {
  const q = search.trim().toLowerCase();
  if (q === '') return [];
  return rows.filter((r) => r.code.toLowerCase().startsWith(q) || r.name_en.toLowerCase().includes(q) || r.name_ar.includes(q));
}

/** How many pages a screen reads before it says the list is too long, rather than show part of it as all. */
export const MAX_PAGES = 20;

/**
 * Every row of a list paged by code, read page by page. A list that runs past MAX_PAGES is
 * a failure, never shown as complete.
 */
export async function readAll<T>(page: (after: string | null) => Promise<Answer<{ rows: readonly T[]; next: string | null }>>):
  Promise<{ ok: true; value: T[] } | Failure> {
  const rows: T[] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_PAGES; n++) {
    const answer = await page(after);
    if (!answer.ok) return answer;
    rows.push(...answer.value.rows);
    if (answer.value.next === null) return { ok: true, value: rows };
    after = answer.value.next;
  }
  return { ok: false, http: 500, status: 'error', message: null, constraint: null, detail: null, field: null };
}
