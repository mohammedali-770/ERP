/**
 * What the stock-alerts function asks the database: 0022's four runtime routes, one
 * method each.
 *
 * As ./stock-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./stock-alerts.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now().
 *
 * The producer that rings the bell is not here: it is a trigger on the balance, and the
 * runtime cannot call it (ADR-0031 §5). What it rings is read through the notifications
 * function.
 *
 * A QUANTITY IS DECIMAL TEXT, both ways, as stock's are: "12.5", never the number 12.5.
 */

/** One item's minimum at a facility, as erp.stock_minimums() returns it. */
export interface StockMinimum {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  /** Decimal text, in the item's base unit. */
  readonly minimum: string;
  /** Decimal text, in the item's base unit: "0" for an item never moved here. */
  readonly on_hand: string;
  /** At or below its minimum (A2). */
  readonly is_low: boolean;
  /** The stamp an edit form sends back. */
  readonly as_of_decision_id: string;
  /** As entered: the pack, its factor and the quantity in it, as decimal text. */
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly quantity: string;
  readonly decided_at: string;
}

export interface StockMinimumQuery {
  /** Where the list is asked; left out, 0022 refuses it rather than mix every facility's. */
  readonly facilityId: string | null;
  readonly lowOnly: boolean;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface StockMinimumHistoryQuery {
  readonly facilityId: string | null;
  readonly itemId: string;
  /** Decimal text of a seq (int8): the page ends before it. */
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface SetStockMinimum {
  readonly decisionId: string;
  readonly facilityId: string;
  /** The pack the minimum is entered in. */
  readonly itemUnitId: string;
  /** Decimal text. That it is above nothing, exact and within range is 0022's rule. */
  readonly quantity: string;
  /**
   * The stamp of the decision in force, a clearing included, or null when the item has
   * never had a minimum here: a cleared minimum keeps its stamp, so null there is stale.
   */
  readonly expectedDecisionId: string | null;
  readonly reason: string;
}

export interface ClearStockMinimum {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly itemId: string;
  /** The stamp the person read: there is a minimum to clear, so there is always one. */
  readonly expectedDecisionId: string;
  readonly reason: string;
}

export interface StockAlertsDb {
  stockMinimums(actor: string, query: StockMinimumQuery): Promise<readonly StockMinimum[]>;
  stockMinimumHistory(actor: string, query: StockMinimumHistoryQuery): Promise<readonly Record<string, unknown>[]>;
  setStockMinimum(actor: string, input: SetStockMinimum): Promise<void>;
  clearStockMinimum(actor: string, input: ClearStockMinimum): Promise<void>;
}
