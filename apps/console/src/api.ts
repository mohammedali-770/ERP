/**
 * The console's client for the edge functions: sign-in, the session, sign-out, and
 * module 1's items routes (supabase/functions/_shared/items.ts).
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
 * Requirements: IAM-003 · IAM-006 · INV-002 · INV-005 · CAP-P04
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
    importItems: (reason, rows) =>
      call('POST', '/items/import', { reason, rows }, (b) => ({
        created: Number(b['created']), amended: Number(b['amended']), unchanged: Number(b['unchanged']),
      })),
  };
}
