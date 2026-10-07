/**
 * The console's client for the edge functions: sign-in, the session, sign-out, module 1's
 * items routes (supabase/functions/_shared/items.ts), module 2's suppliers routes
 * (supabase/functions/_shared/suppliers.ts), module 3's transfer-prices routes
 * (supabase/functions/_shared/transfer-prices.ts), module 4's facilities routes
 * (supabase/functions/_shared/facilities.ts), module 5's stock routes
 * (supabase/functions/_shared/stock.ts), module 6's notifications routes
 * (supabase/functions/_shared/notifications.ts) and module 7's stock-alerts routes
 * (supabase/functions/_shared/stock-alerts.ts).
 *
 * Plain TypeScript, and `fetch` is a parameter, so test/api.test.ts drives every call
 * against a fake without a browser or a server.
 *
 * WHAT THIS NEVER SENDS: an actor. The edge takes the actor from the session the token
 * names (ADR-0025), so no request below carries a person id, and a body that tried would
 * be ignored. The token travels only in `Authorization`, never in a URL.
 *
 * EVERY ANSWER IS ONE OF TWO SHAPES. `{ ok: true, value }`, or a `Failure` carrying the
 * HTTP status and the edge's own `status` word. A refusal is an answer the screen shows
 * (refusal.ts on the edge); a network failure is `http: 0, status: 'network'`, so no
 * screen has to catch.
 *
 * DECISION IDS ARE THE CALLER'S. Each write carries the ids of the decisions it records,
 * chosen by the form when it opens (ids.ts). A form that retries after a lost answer
 * sends the same ids, and the database answers `already_recorded` instead of recording
 * the decision twice.
 *
 * Requirements: IAM-003 · IAM-006 · IAM-P11 · INV-002 · INV-005 · INV-009 · INV-P01 · PRC-005 · SEC-008 · CAP-P04
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Failure {
  readonly ok: false;
  /** The HTTP status, or 0 when no answer arrived. */
  readonly http: number;
  /** The edge's word: `forbidden`, `conflict`, `stale`, `malformed`, `idle`, `network`… */
  readonly status: string;
  readonly message: string | null;
  readonly constraint: string | null;
  readonly detail: string | null;
  /** For `malformed`: the field the edge refused. */
  readonly field: string | null;
}

export type Answer<T> = { readonly ok: true; readonly value: T } | Failure;

/** The session statuses that mean the token names nobody any more. */
export const SESSION_ENDED: ReadonlySet<string> = new Set(['unauthenticated', 'invalid', 'ended', 'expired', 'idle', 'disabled']);

/** True when the answer says the person must sign in again. */
export function sessionEnded(answer: Answer<unknown>): boolean {
  return !answer.ok && answer.http === 401 && SESSION_ENDED.has(answer.status);
}

export type SignInResult =
  | { readonly status: 'ok'; readonly person_id: string; readonly token: string; readonly expires_at: string }
  | { readonly status: 'wrong'; readonly attempts_left?: number }
  | { readonly status: 'locked'; readonly locked_until: string }
  | { readonly status: 'disabled' }
  | { readonly status: 'malformed' };

export interface ViewerFacility {
  readonly facility_id: string;
  readonly code: string;
  readonly facility_type: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly brand_id: string;
}

export interface ViewerBrand {
  readonly brand_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
}

export interface ViewerUnit {
  readonly unit_key: string;
  readonly dimension: 'mass' | 'volume' | 'count' | 'pack';
  readonly name_en: string;
  readonly name_ar: string;
  readonly symbol_en: string;
  readonly symbol_ar: string;
}

export interface ViewerPerson {
  readonly person_id: string;
  readonly employee_number: string;
  readonly full_name_en: string | null;
  readonly full_name_ar: string | null;
  readonly primary_facility_id: string | null;
  readonly status: string;
}

/** `erp.viewer()` (0015), as GET /session returns it. */
export interface ViewerData {
  readonly person: ViewerPerson;
  readonly facility_id: string | null;
  readonly org_wide: boolean;
  readonly facilities: readonly ViewerFacility[];
  readonly permissions: readonly string[];
  readonly states: Readonly<Record<string, string>>;
  readonly brands: readonly ViewerBrand[];
  readonly units: readonly ViewerUnit[];
}

export interface SessionData {
  readonly person_id: string;
  readonly expires_at: string;
  readonly viewer: ViewerData;
}

export interface ItemUnit {
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  readonly status: 'active' | 'retired';
  readonly as_of_decision_id: string;
}

export interface Item {
  readonly item_id: string;
  readonly brand_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly description_en: string | null;
  readonly description_ar: string | null;
  readonly picture_path: string | null;
  readonly status: 'active' | 'retired';
  readonly as_of_decision_id: string;
  readonly units: readonly ItemUnit[];
}

/** One row of erp.item_decision, as GET /items/:id/history returns it. */
export interface ItemDecision {
  readonly decision_id: string;
  readonly kind: string;
  readonly item_unit_id: string | null;
  readonly name_en: string | null;
  readonly name_ar: string | null;
  readonly unit_key: string | null;
  readonly factor: number | string | null;
  readonly status: string;
  readonly reason: string;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly [field: string]: unknown;
}

export interface ItemList {
  readonly items: readonly Item[];
  /** The code the next page starts after, or null when this page is the last. */
  readonly next_after: string | null;
}

export interface ListQuery {
  readonly facilityId: string | null;
  readonly brandId?: string | null;
  readonly status?: 'active' | 'retired' | 'all';
  readonly itemKind?: string | null;
  readonly search?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
}

export interface CreateItemInput {
  readonly decision_id: string;
  readonly item_id: string;
  readonly base_unit_decision_id: string;
  readonly base_item_unit_id: string;
  readonly brand_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly description_en: string | null;
  readonly description_ar: string | null;
  readonly reason: string;
}

export interface AmendItemInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly description_en: string | null;
  readonly description_ar: string | null;
  readonly picture_path: string | null;
  readonly reason: string;
}

export interface StatusInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly status: 'active' | 'retired';
  readonly reason: string;
}

export interface AddUnitInput {
  readonly decision_id: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  /** Decimal text, never a number: the edge refuses a JSON number (no float reaches a factor). */
  readonly factor: string | null;
  readonly reason: string;
}

export interface RetireUnitInput {
  readonly decision_id: string;
  readonly reason: string;
}

export interface ImportSummary {
  readonly created: number;
  readonly amended: number;
  readonly unchanged: number;
}

/** One supplier, as erp.list_suppliers() returns it. Contacts live here, never in its log (SEC-008). */
export interface Supplier {
  readonly supplier_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly vat_number: string | null;
  readonly cr_number: string | null;
  readonly payment_terms_days: number;
  readonly status: 'active' | 'retired';
  readonly contact_person: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  /** The stamp an edit form sends back as `expected_decision_id`. */
  readonly as_of_decision_id: string;
}

/**
 * One thing a supplier sells: a conversion of an item, copied whole (0016). Its own
 * status is the supply's; the pack's and the item's are shown beside it, because a supply
 * on a pack or item retired since stays active itself.
 */
export interface Supply {
  readonly supplier_item_id: string;
  readonly item_unit_id: string;
  readonly item_id: string;
  readonly item_code: string;
  readonly item_name_en: string;
  readonly item_name_ar: string;
  readonly unit_key: string;
  readonly factor: number | string;
  /** The supplier's own code for the pack. */
  readonly supplier_code: string | null;
  readonly preferred: boolean;
  readonly status: 'active' | 'retired';
  readonly as_of_decision_id: string;
  readonly conversion_status: 'active' | 'retired';
  readonly item_status: 'active' | 'retired';
}

/**
 * erp.get_supplier(): the supplier with what it sells at the facility's brand. `supplies`
 * is null — not shown — for someone who may not read items there (ADR-0026 §4).
 */
export interface SupplierDetail extends Supplier {
  readonly supplies: readonly Supply[] | null;
}

/** One row of erp.supplier_decision. No contact value is ever in one. */
export interface SupplierDecision {
  readonly decision_id: string;
  readonly kind: string;
  readonly supplier_item_id: string | null;
  readonly name_en: string | null;
  readonly name_ar: string | null;
  readonly payment_terms_days: number | null;
  readonly item_id: string | null;
  readonly unit_key: string | null;
  readonly factor: number | string | null;
  readonly supplier_code: string | null;
  readonly preferred: boolean | null;
  readonly status: string;
  readonly reason: string;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly [field: string]: unknown;
}

/** erp.item_suppliers(): who sells an item, live supplies of live suppliers on live packs first. */
export interface ItemSupply {
  readonly supplier_item_id: string;
  readonly supplier_id: string;
  readonly supplier_code: string;
  readonly supplier_name_en: string;
  readonly supplier_name_ar: string;
  readonly supplier_status: 'active' | 'retired';
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  readonly their_code: string | null;
  readonly preferred: boolean;
  readonly status: 'active' | 'retired';
  readonly as_of_decision_id: string;
  readonly conversion_status: 'active' | 'retired';
  readonly item_status: 'active' | 'retired';
}

export interface SupplierList {
  readonly suppliers: readonly Supplier[];
  readonly next_after: string | null;
}

export interface SupplierQuery {
  readonly facilityId: string | null;
  readonly status?: 'active' | 'retired' | 'all';
  readonly search?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
}

export interface CreateSupplierInput {
  readonly decision_id: string;
  readonly supplier_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly vat_number: string | null;
  readonly cr_number: string | null;
  /** A JSON integer: the edge refuses text and fractions. */
  readonly payment_terms_days: number;
  readonly reason: string;
}

/**
 * An amendment puts the whole business record in force, so the edge requires the VAT and
 * CR numbers stated, as text or null: one left out would clear it.
 */
export interface AmendSupplierInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly vat_number: string | null;
  readonly cr_number: string | null;
  readonly payment_terms_days: number;
  readonly reason: string;
}

/**
 * The whole contact, every field stated; all four null erases it. NO REASON: the database
 * records a fixed one, because the reason a person would type names the person, and the
 * log keeps reasons for good (ADR-0026 §2). The edge refuses a body that carries one.
 */
export interface ContactInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly contact_person: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
}

export interface AddSupplyInput {
  readonly decision_id: string;
  readonly supplier_item_id: string;
  readonly item_unit_id: string;
  readonly supplier_code: string | null;
  readonly preferred: boolean;
  readonly reason: string;
}

/** The supplier's own code is stated, as text or null: the amendment overwrites it. */
export interface AmendSupplyInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly supplier_code: string | null;
  readonly preferred: boolean;
  readonly reason: string;
}

/**
 * One pack of one item on the price list, as erp.list_transfer_prices() returns it. An
 * amount is a whole number of halalas, never riyals (ADR-0027's step 2 addendum).
 */
export interface PriceListRow {
  readonly item_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly base_unit_key: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  /** The price in force now, or null: an unpriced pack, which no order can be charged. */
  readonly price_id: string | null;
  readonly price_minor: number | null;
  readonly currency: string | null;
  readonly effective_from: string | null;
  /** The next price set ahead, if any. */
  readonly next_price_id: string | null;
  readonly next_price_minor: number | null;
  readonly next_effective_from: string | null;
}

export interface PriceList {
  readonly prices: readonly PriceListRow[];
  readonly next_after: string | null;
}

export interface PriceQuery {
  readonly facilityId: string | null;
  readonly search?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
}

/** One price ever set for an item's packs, as erp.item_transfer_prices() returns it. */
export interface ItemPrice {
  readonly price_id: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  readonly price_minor: number;
  readonly currency: string;
  readonly effective_from: string;
  readonly status: 'active' | 'withdrawn';
  readonly in_force: boolean;
  readonly conversion_status: 'active' | 'retired';
  readonly as_of_decision_id: string;
}

/** One row of erp.transfer_price_decision. */
export interface PriceDecision {
  readonly decision_id: string;
  readonly kind: 'price_set' | 'price_withdrawn' | string;
  readonly price_id: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  readonly price_minor: number;
  readonly currency: string;
  readonly effective_from: string;
  readonly reason: string;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly [field: string]: unknown;
}

/**
 * A price for one pack. The amount is whole halalas as a JSON integer; the moment is
 * ISO 8601 with its offset written out, or null for now. The edge refuses text for the
 * one and a moment without an offset for the other.
 */
export interface SetPriceInput {
  readonly decision_id: string;
  readonly price_id: string;
  readonly item_unit_id: string;
  readonly price_minor: number;
  readonly currency: string;
  readonly effective_from: string | null;
  readonly reason: string;
}

/**
 * One facility, as erp.list_facilities() and erp.get_facility() return it (0019). A
 * coordinate is decimal TEXT, six places as stored, never a number: the edge answers it as
 * postgres.js reads a numeric.
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

/** One row of erp.facility_decision: the whole facility the decision left. */
export interface FacilityDecision {
  readonly decision_id: string;
  readonly kind: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly address_en: string | null;
  readonly address_ar: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly geofence_radius_m: number | null;
  readonly status: 'open' | 'closed';
  readonly reason: string;
  /** Null only for `facility_recorded`: a facility older than the log, recorded by nobody. */
  readonly actor_id: string | null;
  readonly decided_at: string;
  readonly [field: string]: unknown;
}

export interface FacilityList {
  readonly facilities: readonly Facility[];
  readonly next_after: string | null;
}

export interface FacilityQuery {
  readonly facilityId: string | null;
  readonly status?: 'open' | 'closed' | 'all';
  readonly search?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
}

export interface CreateFacilityInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly operating_unit_id: string;
  readonly facility_type: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly address_en: string | null;
  readonly address_ar: string | null;
  readonly reason: string;
}

/** Both addresses are stated, as text or null: the edge refuses one left out, which would clear it. */
export interface AmendFacilityInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly address_en: string | null;
  readonly address_ar: string | null;
  readonly reason: string;
}

/**
 * An area, stated whole: a point as decimal text and a radius in whole metres, or all
 * three null to remove it. A null radius with a point is 0019's default of 150 m.
 */
export interface AreaInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly radius_m: number | null;
  readonly reason: string;
}

export interface FacilityStatusInput {
  readonly decision_id: string;
  readonly expected_decision_id: string;
  readonly status: 'open' | 'closed';
  readonly reason: string;
}

/**
 * One item's balance at a facility, as erp.stock_on_hand() returns it (0020). A quantity
 * is decimal TEXT in the item's base unit, never a number, and may stand below zero after
 * an override (D1); a pack's factor is text too.
 */
export interface StockBalance {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  readonly on_hand: string;
  readonly last_counted_at: string | null;
  readonly as_of_decision_id: string;
  readonly units: readonly { readonly item_unit_id: string; readonly unit_key: string; readonly factor: string; readonly status: 'active' | 'retired' }[];
}

export interface StockList {
  readonly balances: readonly StockBalance[];
  readonly next_after: string | null;
}

/** Stock is held at one facility: every read names it (ADR-0029 D4). */
export interface StockQuery {
  readonly facilityId: string;
  readonly search?: string | null;
  readonly after?: string | null;
  readonly limit?: number;
  readonly negativeOnly?: boolean;
}

export type StockKind = 'count' | 'adjustment' | 'waste' | 'damage' | 'expiry' | 'reversal';

/**
 * One decision on an item's stock card, as erp.stock_history() returns it: what it moved
 * in the item's base unit, or what a count found. A business date is the facility's
 * calendar day as text ("2026-09-25"); a seq is decimal text, the page's bookmark.
 */
export interface StockCardRow {
  readonly decision_id: string;
  readonly seq: string;
  readonly kind: StockKind;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly quantity_in: string;
  readonly quantity_out: string;
  readonly counted: string | null;
  readonly reason: string;
  readonly override_reason: string | null;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly recorded_at: string;
  readonly reverses_decision_id: string | null;
  readonly reversed_by_decision_id: string | null;
}

export interface StockCard {
  readonly decisions: readonly StockCardRow[];
  readonly next_before: string | null;
}

export interface StockEntry {
  readonly entry_id: string | number;
  readonly line_no: number;
  readonly item_id: string;
  readonly code: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly direction: 'in' | 'out';
  readonly quantity: string;
  readonly base_quantity: string;
  readonly reverses_entry_id: string | number | null;
}

export interface StockCounted {
  readonly line_no: number;
  readonly item_id: string;
  readonly code: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly quantity: string;
  readonly base_quantity: string;
}

/** One stock decision whole, as erp.get_stock_decision() returns it, at its own facility. */
export interface StockDecision {
  readonly decision_id: string;
  readonly seq: string;
  readonly kind: StockKind;
  readonly facility_id: string;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly reverses_decision_id: string | null;
  readonly reversed_by_decision_id: string | null;
  readonly override_reason: string | null;
  readonly reason: string;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly recorded_at: string;
  readonly entries: readonly StockEntry[];
  readonly counted: readonly StockCounted[];
}

/** A line as the edge takes it: a conversion, a quantity as decimal text, and a direction on an adjustment. */
export interface StockLineInput {
  readonly item_unit_id: string;
  readonly quantity: string;
  readonly direction?: 'in' | 'out';
}

/**
 * An adjustment or a write-off at one facility. The moment is ISO 8601 with its offset,
 * or null for now; the override reason is D1's, or null.
 */
export interface StockAdjustmentInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly kind: 'adjustment' | 'waste' | 'damage' | 'expiry';
  readonly occurred_at: string | null;
  readonly lines: readonly StockLineInput[];
  readonly reason: string;
  readonly override_reason: string | null;
}

export interface StockCountInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly counted_at: string | null;
  readonly lines: readonly StockLineInput[];
  readonly reason: string;
}

/** A reversal names the decision it reverses in the path only. */
export interface StockReversalInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly reason: string;
  readonly override_reason: string | null;
}

/** One item a stock notification names, read when the bell is read (0021). */
export interface NotificationItem {
  readonly item_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly base_unit_key: string;
  /** Decimal text: the balance the decision left, in the item's base unit. */
  readonly on_hand: string;
  /** Decimal text: on a low-stock notification only, the minimum it crossed (0022). */
  readonly minimum?: string;
}

/**
 * One item's minimum at a facility, as erp.stock_minimums() returns it (0022): its minimum
 * in the base unit and as entered, what is on hand ("0" for an item never moved there),
 * and whether it is at or below its minimum. Quantities are decimal TEXT.
 */
export interface MinimumRow {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  readonly minimum: string;
  readonly on_hand: string;
  readonly is_low: boolean;
  readonly as_of_decision_id: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly quantity: string;
  readonly decided_at: string;
}

export interface MinimumList {
  readonly minimums: readonly MinimumRow[];
  readonly next_after: string | null;
}

/** A minimum is held at one facility: every read names it, as stock's do. */
export interface MinimumQuery {
  readonly facilityId: string;
  readonly lowOnly?: boolean;
  readonly after?: string | null;
  readonly limit?: number;
}

/**
 * One decision about an item's minimum, as erp.stock_minimum_history() returns it, newest
 * first: set, with the pack and quantity entered and the base quantity, or cleared, with
 * none. `is_current` marks the one in force, whose id is the stamp the next decision is
 * checked against.
 */
export interface MinimumDecision {
  readonly decision_id: string;
  readonly seq: string;
  readonly kind: 'minimum_set' | 'minimum_cleared';
  readonly item_unit_id: string | null;
  readonly unit_key: string | null;
  readonly factor: string | null;
  readonly quantity: string | null;
  readonly minimum: string | null;
  readonly reason: string;
  readonly actor_id: string;
  readonly decided_at: string;
  readonly recorded_at: string;
  readonly is_current: boolean;
}

export interface MinimumHistory {
  readonly decisions: readonly MinimumDecision[];
  readonly next_before: string | null;
}

/** A minimum, in a pack, against the stamp read: null only when the item never had one here. */
export interface SetMinimumInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly item_unit_id: string;
  readonly quantity: string;
  readonly expected_decision_id: string | null;
  readonly reason: string;
}

/** A clear names its item in the path only, and always a stamp. */
export interface ClearMinimumInput {
  readonly decision_id: string;
  readonly facility_id: string;
  readonly expected_decision_id: string;
  readonly reason: string;
}

/** One notification, as erp.list_notifications() returns it: the reader's own. */
export interface Notification {
  readonly notification_id: string;
  /** The page cursor: decimal text of an int8, never a number. */
  readonly seq: string;
  readonly kind: string;
  /** Where it happened, which may not be where the person is working. */
  readonly facility_id: string;
  readonly facility_code: string;
  readonly stock_decision_id: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly items: readonly NotificationItem[];
}

export interface NotificationPage {
  readonly notifications: readonly Notification[];
  /** The page after this one ends before this seq; null when this is the last. */
  readonly next_before: string | null;
}

/** The ids marked read, 1 to 100, or every unread one, said: never an empty list. */
export type MarkRead = { readonly notificationIds: readonly string[] } | { readonly all: true };

export interface ApiConfig {
  /** The functions' base, e.g. `http://127.0.0.1:54321/functions/v1`. No trailing slash needed. */
  readonly base: string;
  readonly fetch: Fetch;
  /** The current session's token, or null when nobody is signed in. */
  readonly token: () => string | null;
}

export interface Api {
  signIn(employeeNumber: string, pin: string): Promise<Answer<SignInResult>>;
  session(facilityId: string | null): Promise<Answer<SessionData>>;
  /** Ends the session `token` names: the caller clears it locally first, then sends this. */
  signOut(token: string): Promise<Answer<{ status: string }>>;
  listItems(query: ListQuery): Promise<Answer<ItemList>>;
  getItem(facilityId: string | null, itemId: string): Promise<Answer<Item>>;
  itemHistory(facilityId: string | null, itemId: string): Promise<Answer<readonly ItemDecision[]>>;
  createItem(input: CreateItemInput): Promise<Answer<{ decision_id: string }>>;
  amendItem(itemId: string, input: AmendItemInput): Promise<Answer<{ decision_id: string }>>;
  changeStatus(itemId: string, input: StatusInput): Promise<Answer<{ decision_id: string }>>;
  addUnit(itemId: string, input: AddUnitInput): Promise<Answer<{ decision_id: string }>>;
  retireUnit(itemUnitId: string, input: RetireUnitInput): Promise<Answer<{ decision_id: string }>>;
  importItems(reason: string, rows: readonly Record<string, unknown>[]): Promise<Answer<ImportSummary>>;
  listSuppliers(query: SupplierQuery): Promise<Answer<SupplierList>>;
  getSupplier(facilityId: string | null, supplierId: string): Promise<Answer<SupplierDetail>>;
  supplierHistory(facilityId: string | null, supplierId: string): Promise<Answer<readonly SupplierDecision[]>>;
  itemSuppliers(facilityId: string | null, itemId: string): Promise<Answer<readonly ItemSupply[]>>;
  createSupplier(input: CreateSupplierInput): Promise<Answer<{ decision_id: string }>>;
  amendSupplier(supplierId: string, input: AmendSupplierInput): Promise<Answer<{ decision_id: string }>>;
  changeSupplierStatus(supplierId: string, input: StatusInput): Promise<Answer<{ decision_id: string }>>;
  setSupplierContact(supplierId: string, input: ContactInput): Promise<Answer<{ decision_id: string }>>;
  addSupply(supplierId: string, input: AddSupplyInput): Promise<Answer<{ decision_id: string }>>;
  amendSupply(supplierItemId: string, input: AmendSupplyInput): Promise<Answer<{ decision_id: string }>>;
  retireSupply(supplierItemId: string, input: RetireUnitInput): Promise<Answer<{ decision_id: string }>>;
  importSuppliers(reason: string, rows: readonly Record<string, unknown>[]): Promise<Answer<ImportSummary>>;
  listTransferPrices(query: PriceQuery): Promise<Answer<PriceList>>;
  itemTransferPrices(facilityId: string | null, itemId: string): Promise<Answer<readonly ItemPrice[]>>;
  transferPriceHistory(facilityId: string | null, itemId: string): Promise<Answer<readonly PriceDecision[]>>;
  setTransferPrice(input: SetPriceInput): Promise<Answer<{ decision_id: string }>>;
  /** The price withdrawn is the one the path names; the body carries the decision and its reason only. */
  withdrawTransferPrice(priceId: string, input: RetireUnitInput): Promise<Answer<{ decision_id: string }>>;
  listFacilities(query: FacilityQuery): Promise<Answer<FacilityList>>;
  getFacility(facilityId: string | null, targetId: string): Promise<Answer<Facility>>;
  facilityHistory(facilityId: string | null, targetId: string): Promise<Answer<readonly FacilityDecision[]>>;
  createFacility(input: CreateFacilityInput): Promise<Answer<{ decision_id: string }>>;
  /** The facility changed is the one the path names; `facilityId` in these is the target, never where one works. */
  amendFacility(targetId: string, input: AmendFacilityInput): Promise<Answer<{ decision_id: string }>>;
  setFacilityArea(targetId: string, input: AreaInput): Promise<Answer<{ decision_id: string }>>;
  changeFacilityStatus(targetId: string, input: FacilityStatusInput): Promise<Answer<{ decision_id: string }>>;
  stockOnHand(query: StockQuery): Promise<Answer<StockList>>;
  stockCard(facilityId: string, itemId: string, before?: string | null): Promise<Answer<StockCard>>;
  getStockDecision(facilityId: string, decisionId: string): Promise<Answer<StockDecision>>;
  recordStockAdjustment(input: StockAdjustmentInput): Promise<Answer<{ decision_id: string }>>;
  recordStockCount(input: StockCountInput): Promise<Answer<{ decision_id: string }>>;
  /** The decision reversed is the one the path names; the body names the facility, as every stock write does. */
  reverseStockDecision(targetDecisionId: string, input: StockReversalInput): Promise<Answer<{ decision_id: string }>>;
  /** The bell is asked where the person works; it lists their notifications from every facility they may open. */
  listNotifications(facilityId: string | null, before?: string | null): Promise<Answer<NotificationPage>>;
  unreadNotifications(facilityId: string | null): Promise<Answer<number>>;
  /** Answers how many were marked: none, for ones already read, which is no error. */
  markNotificationsRead(facilityId: string | null, mark: MarkRead): Promise<Answer<number>>;
  stockMinimums(query: MinimumQuery): Promise<Answer<MinimumList>>;
  stockMinimumHistory(facilityId: string, itemId: string, before?: string | null): Promise<Answer<MinimumHistory>>;
  setStockMinimum(input: SetMinimumInput): Promise<Answer<{ decision_id: string }>>;
  /** The item cleared is the one the path names; the body names the facility and the stamp. */
  clearStockMinimum(itemId: string, input: ClearMinimumInput): Promise<Answer<{ decision_id: string }>>;
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function failure(http: number, body: unknown): Failure {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    ok: false,
    http,
    status: text(b['status']) ?? (http === 0 ? 'network' : 'error'),
    message: text(b['message']),
    constraint: text(b['constraint']),
    detail: text(b['detail']),
    field: text(b['field']),
  };
}

/** Query string from the defined, non-empty values only. */
function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}

export function createApi(config: ApiConfig): Api {
  const base = config.base.replace(/\/+$/, '');

  /**
   * One call. `accept` says which answers are values; anything else is a Failure. By
   * default only a 200 is. Sign-in widens it to its own statuses, because a wrong PIN, a
   * lock and a disabled account are answers the screen shows, not failures; an origin the
   * edge refuses is still a failure, though it shares sign-in's 403.
   */
  async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, pick: (b: Record<string, unknown>) => T,
                         accept: (http: number, b: Record<string, unknown>) => boolean = (http) => http === 200,
                         tokenOverride: string | null = null,
  ): Promise<Answer<T>> {
    const headers: Record<string, string> = {};
    const token = tokenOverride ?? config.token();
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await config.fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // No cookie goes with a call: the token is the only credential (ADR-0025). Every
        // answer is no-store at the edge, so the browser keeps none of them.
        credentials: 'omit',
      });
    } catch {
      return failure(0, null);
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>) : null;
    if (record !== null && accept(response.status, record)) return { ok: true, value: pick(record) };
    return failure(response.status, parsed);
  }

  const SIGN_IN: Readonly<Record<string, number>> = { ok: 200, wrong: 401, disabled: 403, locked: 423, malformed: 400 };
  const asIs = <T>(b: Record<string, unknown>) => b as unknown as T;
  const decision = (b: Record<string, unknown>) => ({ decision_id: String(b['decision_id']) });
  const summary = (b: Record<string, unknown>): ImportSummary => ({
    created: Number(b['created']), amended: Number(b['amended']), unchanged: Number(b['unchanged']),
  });

  return {
    signIn: (employeeNumber, pin) =>
      call('POST', '/sign-in', { employee_number: employeeNumber, pin }, (b) => b as unknown as SignInResult,
        (http, b) => typeof b['status'] === 'string' && SIGN_IN[b['status']] === http),
    session: (facilityId) =>
      call('GET', `/session${query({ facility_id: facilityId })}`, undefined, asIs<SessionData>),
    signOut: (token) => call('POST', '/sign-out', undefined, (b) => ({ status: String(b['status']) }), undefined, token),
    listItems: (q) =>
      call('GET', `/items${query({
        facility_id: q.facilityId, brand_id: q.brandId, status: q.status, item_kind: q.itemKind,
        search: q.search, after: q.after, limit: q.limit,
      })}`, undefined, (b) => ({ items: b['items'] as Item[], next_after: text(b['next_after']) })),
    getItem: (facilityId, itemId) =>
      call('GET', `/items/${encodeURIComponent(itemId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['item'] as Item),
    itemHistory: (facilityId, itemId) =>
      call('GET', `/items/${encodeURIComponent(itemId)}/history${query({ facility_id: facilityId })}`, undefined,
        (b) => b['decisions'] as ItemDecision[]),
    createItem: (input) => call('POST', '/items', input, decision),
    amendItem: (itemId, input) => call('POST', `/items/${encodeURIComponent(itemId)}/amend`, input, decision),
    changeStatus: (itemId, input) => call('POST', `/items/${encodeURIComponent(itemId)}/status`, input, decision),
    addUnit: (itemId, input) => call('POST', `/items/${encodeURIComponent(itemId)}/units`, input, decision),
    retireUnit: (itemUnitId, input) =>
      call('POST', `/items/units/${encodeURIComponent(itemUnitId)}/retire`, input, decision),
    importItems: (reason, rows) => call('POST', '/items/import', { reason, rows }, summary),

    listSuppliers: (q) =>
      call('GET', `/suppliers${query({
        facility_id: q.facilityId, status: q.status, search: q.search, after: q.after, limit: q.limit,
      })}`, undefined, (b) => ({ suppliers: b['suppliers'] as Supplier[], next_after: text(b['next_after']) })),
    getSupplier: (facilityId, supplierId) =>
      call('GET', `/suppliers/${encodeURIComponent(supplierId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['supplier'] as SupplierDetail),
    supplierHistory: (facilityId, supplierId) =>
      call('GET', `/suppliers/${encodeURIComponent(supplierId)}/history${query({ facility_id: facilityId })}`, undefined,
        (b) => b['decisions'] as SupplierDecision[]),
    itemSuppliers: (facilityId, itemId) =>
      call('GET', `/suppliers/items/${encodeURIComponent(itemId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['supplies'] as ItemSupply[]),
    createSupplier: (input) => call('POST', '/suppliers', input, decision),
    amendSupplier: (supplierId, input) =>
      call('POST', `/suppliers/${encodeURIComponent(supplierId)}/amend`, input, decision),
    changeSupplierStatus: (supplierId, input) =>
      call('POST', `/suppliers/${encodeURIComponent(supplierId)}/status`, input, decision),
    setSupplierContact: (supplierId, input) =>
      call('POST', `/suppliers/${encodeURIComponent(supplierId)}/contact`, input, decision),
    addSupply: (supplierId, input) =>
      call('POST', `/suppliers/${encodeURIComponent(supplierId)}/supplies`, input, decision),
    amendSupply: (supplierItemId, input) =>
      call('POST', `/suppliers/supplies/${encodeURIComponent(supplierItemId)}/amend`, input, decision),
    retireSupply: (supplierItemId, input) =>
      call('POST', `/suppliers/supplies/${encodeURIComponent(supplierItemId)}/retire`, input, decision),
    importSuppliers: (reason, rows) => call('POST', '/suppliers/import', { reason, rows }, summary),

    listTransferPrices: (q) =>
      call('GET', `/transfer-prices${query({ facility_id: q.facilityId, search: q.search, after: q.after, limit: q.limit })}`,
        undefined, (b) => ({ prices: b['prices'] as PriceListRow[], next_after: text(b['next_after']) })),
    itemTransferPrices: (facilityId, itemId) =>
      call('GET', `/transfer-prices/items/${encodeURIComponent(itemId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['prices'] as ItemPrice[]),
    transferPriceHistory: (facilityId, itemId) =>
      call('GET', `/transfer-prices/items/${encodeURIComponent(itemId)}/history${query({ facility_id: facilityId })}`,
        undefined, (b) => b['decisions'] as PriceDecision[]),
    setTransferPrice: (input) => call('POST', '/transfer-prices', input, decision),
    withdrawTransferPrice: (priceId, input) =>
      call('POST', `/transfer-prices/${encodeURIComponent(priceId)}/withdraw`, input, decision),

    listFacilities: (q) =>
      call('GET', `/facilities${query({
        facility_id: q.facilityId, status: q.status, search: q.search, after: q.after, limit: q.limit,
      })}`, undefined, (b) => ({ facilities: b['facilities'] as Facility[], next_after: text(b['next_after']) })),
    getFacility: (facilityId, targetId) =>
      call('GET', `/facilities/${encodeURIComponent(targetId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['facility'] as Facility),
    facilityHistory: (facilityId, targetId) =>
      call('GET', `/facilities/${encodeURIComponent(targetId)}/history${query({ facility_id: facilityId })}`, undefined,
        (b) => b['decisions'] as FacilityDecision[]),
    createFacility: (input) => call('POST', '/facilities', input, decision),
    amendFacility: (targetId, input) =>
      call('POST', `/facilities/${encodeURIComponent(targetId)}/amend`, input, decision),
    setFacilityArea: (targetId, input) =>
      call('POST', `/facilities/${encodeURIComponent(targetId)}/area`, input, decision),
    changeFacilityStatus: (targetId, input) =>
      call('POST', `/facilities/${encodeURIComponent(targetId)}/status`, input, decision),

    stockOnHand: (q) =>
      call('GET', `/stock${query({
        facility_id: q.facilityId, search: q.search, after: q.after, limit: q.limit,
        negative: q.negativeOnly === true ? 'true' : null,
      })}`, undefined, (b) => ({ balances: b['balances'] as StockBalance[], next_after: text(b['next_after']) })),
    stockCard: (facilityId, itemId, before = null) =>
      call('GET', `/stock/items/${encodeURIComponent(itemId)}${query({ facility_id: facilityId, before })}`, undefined,
        (b) => ({ decisions: b['decisions'] as StockCardRow[], next_before: text(b['next_before']) })),
    getStockDecision: (facilityId, decisionId) =>
      call('GET', `/stock/decisions/${encodeURIComponent(decisionId)}${query({ facility_id: facilityId })}`, undefined,
        (b) => b['decision'] as StockDecision),
    recordStockAdjustment: (input) => call('POST', '/stock/adjustments', input, decision),
    recordStockCount: (input) => call('POST', '/stock/counts', input, decision),
    reverseStockDecision: (targetDecisionId, input) =>
      call('POST', `/stock/decisions/${encodeURIComponent(targetDecisionId)}/reverse`, input, decision),

    listNotifications: (facilityId, before = null) =>
      call('GET', `/notifications${query({ facility_id: facilityId, before })}`, undefined,
        (b) => ({ notifications: b['notifications'] as Notification[], next_before: text(b['next_before']) })),
    unreadNotifications: (facilityId) =>
      call('GET', `/notifications/unread${query({ facility_id: facilityId })}`, undefined, (b) => Number(b['unread'])),
    markNotificationsRead: (facilityId, mark) =>
      call('POST', '/notifications/read', {
        facility_id: facilityId,
        ...('all' in mark ? { all: true } : { notification_ids: mark.notificationIds }),
      }, (b) => Number(b['marked'])),

    stockMinimums: (q) =>
      call('GET', `/stock-alerts${query({
        facility_id: q.facilityId, low: q.lowOnly === true ? 'true' : null, after: q.after, limit: q.limit,
      })}`, undefined, (b) => ({ minimums: b['minimums'] as MinimumRow[], next_after: text(b['next_after']) })),
    stockMinimumHistory: (facilityId, itemId, before = null) =>
      call('GET', `/stock-alerts/items/${encodeURIComponent(itemId)}${query({ facility_id: facilityId, before })}`, undefined,
        (b) => ({ decisions: b['decisions'] as MinimumDecision[], next_before: text(b['next_before']) })),
    setStockMinimum: (input) => call('POST', '/stock-alerts/minimums', input, decision),
    clearStockMinimum: (itemId, input) =>
      call('POST', `/stock-alerts/items/${encodeURIComponent(itemId)}/clear`, input, decision),
  };
}
