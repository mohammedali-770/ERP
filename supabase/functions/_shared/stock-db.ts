/**
 * What the stock function asks the database: 0020's six runtime routes, one method each.
 *
 * As ./facilities-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./stock.ts, which passes `session.personId`
 * there and nothing else (ADR-0025). The decision time is not a parameter: the driver
 * passes the database's now().
 *
 * erp.post_stock() and erp.lock_stock(), the seam every later module posts through, are
 * not here: they are owner-only, called from later modules' own routes, never from the
 * edge.
 *
 * A QUANTITY IS DECIMAL TEXT, both ways: "123.5", never the number 123.5. It goes to a
 * numeric column, and postgres.js answers a numeric as text; the routes answer quantities
 * inside JSON as text too (0020), so no float touches one on the way.
 */

/** One line of an adjustment, a write-off or a count, as the routes read it (0020). */
export interface StockLine {
  readonly item_unit_id: string;
  /** Decimal text. That it is above 0 (or 0 for a count), exact and within range is 0020's rule. */
  readonly quantity: string;
  /** 'in' or 'out' on an adjustment; absent on a write-off or a count. */
  readonly direction?: string;
}

/** One item's balance at a facility, as erp.stock_on_hand() returns it. */
export interface StockBalance {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  /** Decimal text, in the item's base unit; below zero after an override, until a count. */
  readonly on_hand: string;
  readonly last_counted_at: string | null;
  readonly as_of_decision_id: string;
  /** Every pack of the item, retired ones included, each factor as decimal text. */
  readonly units: readonly Readonly<Record<string, unknown>>[];
}

export interface StockQuery {
  readonly facilityId: string | null;
  readonly search: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
  readonly negativeOnly: boolean;
}

export interface StockHistoryQuery {
  readonly facilityId: string | null;
  readonly itemId: string;
  /** Decimal text of a seq (int8): the page ends before it. */
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface RecordStockAdjustment {
  readonly decisionId: string;
  readonly facilityId: string;
  /** adjustment, waste, damage or expiry: 0020's to check. */
  readonly kind: string;
  /** With its offset, or null for now. */
  readonly occurredAt: string | null;
  readonly lines: readonly StockLine[];
  readonly reason: string;
  /** D1: the person's reason for letting stock go below zero, or null. */
  readonly overrideReason: string | null;
}

export interface RecordStockCount {
  readonly decisionId: string;
  readonly facilityId: string;
  /** With its offset, or null for now. */
  readonly countedAt: string | null;
  readonly lines: readonly StockLine[];
  readonly reason: string;
}

export interface ReverseStockDecision {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly targetDecisionId: string;
  readonly reason: string;
  readonly overrideReason: string | null;
}

export interface StockDb {
  stockOnHand(actor: string, query: StockQuery): Promise<readonly StockBalance[]>;
  stockHistory(actor: string, query: StockHistoryQuery): Promise<readonly Record<string, unknown>[]>;
  getStockDecision(actor: string, facilityId: string | null, decisionId: string): Promise<Record<string, unknown>>;
  recordStockAdjustment(actor: string, input: RecordStockAdjustment): Promise<void>;
  recordStockCount(actor: string, input: RecordStockCount): Promise<void>;
  reverseStockDecision(actor: string, input: ReverseStockDecision): Promise<void>;
}
