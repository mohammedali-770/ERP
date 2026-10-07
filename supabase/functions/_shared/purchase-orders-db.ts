/**
 * What the purchase-orders function asks the database: 0023's nine runtime routes, one
 * method each.
 *
 * As ./stock-alerts-db.ts: every method takes the actor FIRST and as its own argument,
 * never inside an input object. The only caller is ./purchase-orders.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now().
 *
 * TWO KINDS OF NUMBER, kept apart:
 *
 *   A QUANTITY IS DECIMAL TEXT, both ways, as stock's are: "12.5", never the number 12.5.
 *
 *   AN AMOUNT IS A WHOLE NUMBER OF HALALAS, both ways, as transfer prices' are: 12500,
 *   never "125.00". The driver turns the routes' bigint amounts into numbers through
 *   ./transfer-prices-db.ts's withMinor(), which refuses anything not a safe integer; 0023
 *   caps every amount far below 2^53. A VAT rate is whole basis points: 1500 is 15%.
 */

/** One line of a new order, as erp.raise_purchase_order() reads it (0023). */
export interface PurchaseOrderLine {
  readonly item_unit_id: string;
  /** Decimal text, in packs. That it is above nothing and exact is 0023's rule. */
  readonly quantity: string;
  /** Whole halalas per pack, before VAT. Its range is 0023's rule. */
  readonly price_minor: number;
}

/** One line of a receipt: the order's line, by number, and how much of it arrived. */
export interface ReceiptLine {
  readonly line_no: number;
  /** Decimal text, in the order line's own pack. */
  readonly quantity: string;
}

/** One order at a facility, as erp.purchase_orders() lists it. */
export interface PurchaseOrderRow {
  readonly purchase_order_id: string;
  /** Decimal text of the raise's seq (int8): what the list pages by. */
  readonly seq: string;
  readonly number: string;
  readonly business_date: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'closed';
  /** How much has arrived: none, part, or every line in full. */
  readonly progress: 'none' | 'partial' | 'full';
  readonly supplier_id: string;
  readonly supplier_code: string;
  readonly supplier_name_en: string;
  readonly supplier_name_ar: string;
  readonly currency: string;
  readonly vat_rate_bp: number;
  readonly subtotal_minor: number;
  readonly vat_minor: number;
  readonly total_minor: number;
  readonly line_count: number;
  readonly raised_by: string;
  readonly raised_at: string;
  /** The stamp of the decision in force. */
  readonly as_of_decision_id: string;
}

export interface PurchaseOrderQuery {
  /** Where the list is asked; left out, 0023 refuses it rather than mix every facility's. */
  readonly facilityId: string | null;
  /** One state, or null for every one. Which words are states is 0023's rule. */
  readonly state: string | null;
  /** Decimal text of a seq: the page ends before it. */
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface PurchaseLimitQuery {
  readonly facilityId: string | null;
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface RaisePurchaseOrder {
  readonly decisionId: string;
  /** The order's own id, minted by the console with the decision's (I-1). */
  readonly purchaseOrderId: string;
  readonly facilityId: string;
  readonly supplierId: string;
  readonly vatRateBp: number;
  readonly lines: readonly PurchaseOrderLine[];
  readonly reason: string;
}

/** What a decision about an order puts in force; the path names it. */
export type OrderDecisionKind = 'order_approved' | 'order_rejected' | 'order_cancelled' | 'order_closed';

export interface DecidePurchaseOrder {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly purchaseOrderId: string;
  readonly kind: OrderDecisionKind;
  readonly reason: string;
}

export interface ReceivePurchaseOrder {
  /** A stock decision's id: a receipt is a stock movement (ADR-0032 §5). */
  readonly decisionId: string;
  readonly facilityId: string;
  readonly purchaseOrderId: string;
  /** When the goods arrived, with its offset, or null for now. */
  readonly receivedAt: string | null;
  readonly lines: readonly ReceiptLine[];
  readonly deliveryNote: string | null;
}

export interface ReversePurchaseReceipt {
  readonly decisionId: string;
  readonly facilityId: string;
  /** The receipt's own decision id. */
  readonly receiptDecisionId: string;
  readonly reason: string;
  /** D1: why stock may go below zero, where the goods have since been used; or null. */
  readonly overrideReason: string | null;
}

export interface SetPurchaseLimit {
  readonly decisionId: string;
  readonly facilityId: string;
  /** Whole halalas, before VAT. More than nothing is 0023's rule. */
  readonly limitMinor: number;
  readonly currency: string;
  /** The stamp of the decision in force, a clearing included, or null when the facility never had a limit. */
  readonly expectedDecisionId: string | null;
  readonly reason: string;
}

export interface ClearPurchaseLimit {
  readonly decisionId: string;
  readonly facilityId: string;
  /** There is a limit to clear, so there is always a stamp. */
  readonly expectedDecisionId: string;
  readonly reason: string;
}

export interface PurchaseOrdersDb {
  purchaseOrders(actor: string, query: PurchaseOrderQuery): Promise<readonly PurchaseOrderRow[]>;
  getPurchaseOrder(actor: string, facilityId: string | null, purchaseOrderId: string): Promise<Record<string, unknown>>;
  purchaseLimitHistory(actor: string, query: PurchaseLimitQuery): Promise<readonly Record<string, unknown>[]>;
  raisePurchaseOrder(actor: string, input: RaisePurchaseOrder): Promise<void>;
  decidePurchaseOrder(actor: string, input: DecidePurchaseOrder): Promise<void>;
  receivePurchaseOrder(actor: string, input: ReceivePurchaseOrder): Promise<void>;
  reversePurchaseReceipt(actor: string, input: ReversePurchaseReceipt): Promise<void>;
  setPurchaseLimit(actor: string, input: SetPurchaseLimit): Promise<void>;
  clearPurchaseLimit(actor: string, input: ClearPurchaseLimit): Promise<void>;
}
