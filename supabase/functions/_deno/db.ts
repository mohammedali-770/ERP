/**
 * The one file that talks to PostgreSQL (ADR-0023, ADR-0025).
 *
 * postgres.js, pinned exactly in ../deno.json and locked in ../deno.lock, connecting as
 * erp_edge: a login role that is erp_app and nothing more (0014). It calls the session
 * routes and each module's routes, and nothing else; each answer is checked by
 * ../_shared before anything else sees it.
 *
 * max: 1 and prepare: false, because a hosted project is reached through Supavisor in
 * transaction mode, where consecutive statements can land on different server
 * connections: a prepared statement made on one would not exist on the next. One
 * connection per function instance, because an instance serves one request at a time
 * often enough that more would only hold server connections idle.
 *
 * Every parameter is cast to the type the route declares. postgres.js sends untyped
 * parameters, and a function call resolves by argument type, so the casts are what make
 * a renamed or retyped route fail loudly here instead of resolving to something else.
 *
 * The decision time is the database's now(), never the caller's clock.
 *
 * JSON goes through sql.json(). postgres.js learns each parameter's type from the server
 * and serializes a jsonb one itself, so a string already JSON-encoded arrives as a JSON
 * string, not as the array it spells: an import was refused "1 to 5000 rows" for a file
 * of two until the integration test found it.
 */
import postgres from 'postgres';
import {
  asSessionAnswer, asSignInAnswer, asSignOutAnswer, asViewerAnswer,
  type Db,
} from '../_shared/db.ts';
import type { ImportSummary, Item } from '../_shared/items-db.ts';
import type { Supplier, SupplierDetail, SupplierImportSummary } from '../_shared/suppliers-db.ts';
import { withMinor, type ItemPrice, type PriceListRow } from '../_shared/transfer-prices-db.ts';
import type { Facility } from '../_shared/facilities-db.ts';
import type { StockBalance } from '../_shared/stock-db.ts';
import type { Notification } from '../_shared/notifications-db.ts';
import type { StockMinimum } from '../_shared/stock-alerts-db.ts';
import type { PurchaseOrderRow } from '../_shared/purchase-orders-db.ts';
import { asRefusal } from '../_shared/refusal.ts';

export interface Connection extends Db {
  end(): Promise<void>;
}

/** A postgres.js connection or transaction: anything that runs a tagged query. */
type Sql = postgres.Sql | postgres.TransactionSql;

/** A refusal the routes raise becomes a Refusal; anything else stays an error. */
async function run<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw asRefusal(error) ?? error;
  }
}

/** The routes, over any connection or transaction. connect() is the only production caller. */
export function makeDb(sql: Sql): Db {
  return {
    async signIn(employeeNumber, pin) {
      const [row] = await sql`select erp.sign_in(${employeeNumber}::text, ${pin}::text) as answer`;
      return asSignInAnswer(row?.['answer']);
    },
    async resolveSession(token) {
      const [row] = await sql`select erp.resolve_session(${token}::text) as answer`;
      return asSessionAnswer(row?.['answer']);
    },
    async signOut(token) {
      const [row] = await sql`select erp.sign_out(${token}::text) as answer`;
      return asSignOutAnswer(row?.['answer']);
    },
    async viewer(personId, facilityId) {
      const [row] = await sql`select erp.viewer(${personId}::uuid, ${facilityId}::uuid) as viewer`;
      return asViewerAnswer(row?.['viewer']);
    },

    listItems: (actor, q) => run(async () => (await sql`
      select * from erp.list_items(${actor}::uuid, ${q.facilityId}::uuid, ${q.brandId}::uuid, ${q.status}::text,
                                   ${q.itemKind}::text, ${q.search}::text, ${q.afterCode}::text, ${q.limit}::integer)`
    ) as unknown as Item[]),
    getItem: (actor, facilityId, itemId) => run(async () => {
      const [row] = await sql`select * from erp.get_item(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`;
      return row as unknown as Item;
    }),
    itemHistory: (actor, facilityId, itemId) => run(async () =>
      [...await sql`select * from erp.item_history(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`]),
    createItem: (actor, i) => run(async () => {
      await sql`select erp.create_item(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.baseUnitDecisionId}::uuid, ${i.baseItemUnitId}::uuid,
        ${i.brandId}::uuid, ${i.code}::text, ${i.itemKind}::text, ${i.baseUnitKey}::text,
        ${i.nameEn}::text, ${i.nameAr}::text, ${i.descriptionEn}::text, ${i.descriptionAr}::text,
        ${i.picturePath}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    amendItem: (actor, i) => run(async () => {
      await sql`select erp.amend_item(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.nameEn}::text, ${i.nameAr}::text, ${i.descriptionEn}::text, ${i.descriptionAr}::text,
        ${i.picturePath}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    changeItemStatus: (actor, i) => run(async () => {
      await sql`select erp.change_item_status(
        ${i.decisionId}::uuid, ${i.itemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.status}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    addItemUnit: (actor, i) => run(async () => {
      await sql`select erp.add_item_unit(
        ${i.decisionId}::uuid, ${i.itemUnitId}::uuid, ${i.itemId}::uuid, ${i.unitKey}::text,
        ${i.factor}::numeric, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    retireItemUnit: (actor, i) => run(async () => {
      await sql`select erp.retire_item_unit(
        ${i.decisionId}::uuid, ${i.itemUnitId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    importItems: (actor, reason, rows) => run(async () => {
      const [row] = await sql`select erp.import_items(
        ${actor}::uuid, ${reason}::text, now(), ${sql.json(rows as postgres.JSONValue)}::jsonb) as summary`;
      return row?.['summary'] as ImportSummary;
    }),

    listSuppliers: (actor, q) => run(async () => (await sql`
      select * from erp.list_suppliers(${actor}::uuid, ${q.facilityId}::uuid, ${q.status}::text, ${q.search}::text,
                                       ${q.afterCode}::text, ${q.limit}::integer)`
    ) as unknown as Supplier[]),
    getSupplier: (actor, facilityId, supplierId) => run(async () => {
      const [row] = await sql`select * from erp.get_supplier(${actor}::uuid, ${facilityId}::uuid, ${supplierId}::uuid)`;
      return row as unknown as SupplierDetail;
    }),
    supplierHistory: (actor, facilityId, supplierId) => run(async () =>
      [...await sql`select * from erp.supplier_history(${actor}::uuid, ${facilityId}::uuid, ${supplierId}::uuid)`]),
    itemSuppliers: (actor, facilityId, itemId) => run(async () =>
      [...await sql`select * from erp.item_suppliers(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`]),
    createSupplier: (actor, i) => run(async () => {
      await sql`select erp.create_supplier(
        ${i.decisionId}::uuid, ${i.supplierId}::uuid, ${i.code}::text, ${i.nameEn}::text, ${i.nameAr}::text,
        ${i.vatNumber}::text, ${i.crNumber}::text, ${i.paymentTermsDays}::integer, ${i.reason}::text,
        ${actor}::uuid, now())`;
    }),
    amendSupplier: (actor, i) => run(async () => {
      await sql`select erp.amend_supplier(
        ${i.decisionId}::uuid, ${i.supplierId}::uuid, ${i.expectedDecisionId}::uuid, ${i.nameEn}::text, ${i.nameAr}::text,
        ${i.vatNumber}::text, ${i.crNumber}::text, ${i.paymentTermsDays}::integer, ${i.reason}::text,
        ${actor}::uuid, now())`;
    }),
    changeSupplierStatus: (actor, i) => run(async () => {
      await sql`select erp.change_supplier_status(
        ${i.decisionId}::uuid, ${i.supplierId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.status}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    setSupplierContact: (actor, i) => run(async () => {
      await sql`select erp.set_supplier_contact(
        ${i.decisionId}::uuid, ${i.supplierId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.contactPerson}::text, ${i.phone}::text, ${i.email}::text, ${i.address}::text, ${actor}::uuid, now())`;
    }),
    addSupplierItem: (actor, i) => run(async () => {
      await sql`select erp.add_supplier_item(
        ${i.decisionId}::uuid, ${i.supplierItemId}::uuid, ${i.supplierId}::uuid, ${i.itemUnitId}::uuid,
        ${i.supplierCode}::text, ${i.preferred}::boolean, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    amendSupplierItem: (actor, i) => run(async () => {
      await sql`select erp.amend_supplier_item(
        ${i.decisionId}::uuid, ${i.supplierItemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.supplierCode}::text, ${i.preferred}::boolean, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    retireSupplierItem: (actor, i) => run(async () => {
      await sql`select erp.retire_supplier_item(
        ${i.decisionId}::uuid, ${i.supplierItemId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    importSuppliers: (actor, reason, rows) => run(async () => {
      const [row] = await sql`select erp.import_suppliers(
        ${actor}::uuid, ${reason}::text, now(), ${sql.json(rows as postgres.JSONValue)}::jsonb) as summary`;
      return row?.['summary'] as SupplierImportSummary;
    }),

    // An amount comes back from postgres.js as a string (int8), and leaves as a number.
    listTransferPrices: (actor, q) => run(async () => (await sql`
      select * from erp.list_transfer_prices(${actor}::uuid, ${q.facilityId}::uuid, ${q.search}::text,
                                             ${q.afterCode}::text, ${q.limit}::integer)`
    ).map((r) => withMinor<PriceListRow>('erp.list_transfer_prices', r, ['price_minor', 'next_price_minor']))),
    itemTransferPrices: (actor, facilityId, itemId) => run(async () => (await sql`
      select * from erp.item_transfer_prices(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`
    ).map((r) => withMinor<ItemPrice>('erp.item_transfer_prices', r, ['price_minor']))),
    transferPriceHistory: (actor, facilityId, itemId) => run(async () => (await sql`
      select * from erp.transfer_price_history(${actor}::uuid, ${facilityId}::uuid, ${itemId}::uuid)`
    ).map((r) => withMinor<Record<string, unknown>>('erp.transfer_price_history', r, ['price_minor']))),
    setTransferPrice: (actor, i) => run(async () => {
      await sql`select erp.set_transfer_price(
        ${i.decisionId}::uuid, ${i.priceId}::uuid, ${i.itemUnitId}::uuid, ${i.priceMinor}::bigint, ${i.currency}::text,
        ${i.effectiveFrom}::timestamptz, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    withdrawTransferPrice: (actor, i) => run(async () => {
      await sql`select erp.withdraw_transfer_price(
        ${i.decisionId}::uuid, ${i.priceId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),

    // A coordinate comes back from postgres.js as a string (numeric), and stays one: it
    // leaves as decimal text, as it arrived, and goes in through a numeric cast.
    listFacilities: (actor, q) => run(async () => (await sql`
      select * from erp.list_facilities(${actor}::uuid, ${q.facilityId}::uuid, ${q.status}::text, ${q.search}::text,
                                        ${q.afterCode}::text, ${q.limit}::integer)`
    ) as unknown as Facility[]),
    getFacility: (actor, facilityId, targetId) => run(async () => {
      const [row] = await sql`select * from erp.get_facility(${actor}::uuid, ${facilityId}::uuid, ${targetId}::uuid)`;
      return row as unknown as Facility;
    }),
    facilityHistory: (actor, facilityId, targetId) => run(async () =>
      [...await sql`select * from erp.facility_history(${actor}::uuid, ${facilityId}::uuid, ${targetId}::uuid)`]),
    createFacility: (actor, i) => run(async () => {
      await sql`select erp.create_facility(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.operatingUnitId}::uuid, ${i.facilityType}::text,
        ${i.code}::text, ${i.nameEn}::text, ${i.nameAr}::text, ${i.addressEn}::text, ${i.addressAr}::text,
        ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    amendFacility: (actor, i) => run(async () => {
      await sql`select erp.amend_facility(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.expectedDecisionId}::uuid, ${i.nameEn}::text, ${i.nameAr}::text,
        ${i.addressEn}::text, ${i.addressAr}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    setFacilityArea: (actor, i) => run(async () => {
      await sql`select erp.set_facility_area(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.latitude}::numeric, ${i.longitude}::numeric, ${i.radiusM}::integer, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    changeFacilityStatus: (actor, i) => run(async () => {
      await sql`select erp.change_facility_status(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.status}::text, ${i.reason}::text, ${actor}::uuid, now())`;
    }),

    // A quantity comes back from postgres.js as a string (numeric), and stays one, as a
    // coordinate does; a seq (int8) comes back as a string too. Inside the routes' jsonb
    // answers 0020 writes quantities and factors as text itself. Lines go through
    // sql.json() for the reason above.
    //
    // A business date is a calendar date at the facility (D3), and postgres.js parses a
    // date as a Date at UTC midnight, which a browser west of Greenwich shows as the day
    // before (found in review). So the columns are named and the date is cast to text:
    // "2026-09-25", as the database holds it.
    stockOnHand: (actor, q) => run(async () => (await sql`
      select * from erp.stock_on_hand(${actor}::uuid, ${q.facilityId}::uuid, ${q.search}::text,
                                      ${q.afterCode}::text, ${q.limit}::integer, ${q.negativeOnly}::boolean)`
    ) as unknown as StockBalance[]),
    stockHistory: (actor, q) => run(async () =>
      [...await sql`
        select decision_id, seq, kind, occurred_at, business_date::text as business_date, quantity_in, quantity_out,
               counted, reason, override_reason, actor_id, decided_at, recorded_at, reverses_decision_id,
               reversed_by_decision_id
          from erp.stock_history(${actor}::uuid, ${q.facilityId}::uuid, ${q.itemId}::uuid,
                                 ${q.beforeSeq}::bigint, ${q.limit}::integer)`]),
    getStockDecision: (actor, facilityId, decisionId) => run(async () => {
      const [row] = await sql`
        select decision_id, seq, kind, facility_id, occurred_at, business_date::text as business_date,
               reverses_decision_id, reversed_by_decision_id, override_reason, reason, actor_id, decided_at,
               recorded_at, entries, counted
          from erp.get_stock_decision(${actor}::uuid, ${facilityId}::uuid, ${decisionId}::uuid)`;
      return row as Record<string, unknown>;
    }),
    recordStockAdjustment: (actor, i) => run(async () => {
      await sql`select erp.record_stock_adjustment(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.kind}::text, ${i.occurredAt}::timestamptz,
        ${sql.json(i.lines as unknown as postgres.JSONValue)}::jsonb, ${i.reason}::text, ${i.overrideReason}::text,
        ${actor}::uuid, now())`;
    }),
    recordStockCount: (actor, i) => run(async () => {
      await sql`select erp.record_stock_count(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.countedAt}::timestamptz,
        ${sql.json(i.lines as unknown as postgres.JSONValue)}::jsonb, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    reverseStockDecision: (actor, i) => run(async () => {
      await sql`select erp.reverse_stock_decision(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.targetDecisionId}::uuid, ${i.reason}::text,
        ${i.overrideReason}::text, ${actor}::uuid, now())`;
    }),

    // A seq (int8) comes back from postgres.js as a string, and stays one: it is the page
    // cursor, and a number would round it past 2^53. The items' balances are text inside
    // 0021's jsonb. A count is an integer and comes back a number. created_at and read_at
    // come back as Dates and reach the console as ISO moments to the millisecond: shown,
    // never sent back, since the cursor is the seq.
    listNotifications: (actor, q) => run(async () => (await sql`
      select notification_id, seq, kind, facility_id, facility_code, stock_decision_id, created_at, read_at, items
        from erp.list_notifications(${actor}::uuid, ${q.facilityId}::uuid, ${q.beforeSeq}::bigint, ${q.limit}::integer)`
    ) as unknown as Notification[]),
    countUnreadNotifications: (actor, facilityId) => run(async () => {
      const [row] = await sql`select erp.count_unread_notifications(${actor}::uuid, ${facilityId}::uuid) as unread`;
      return row?.['unread'] as number;
    }),
    markNotificationsRead: (actor, i) => run(async () => {
      const [row] = await sql`select erp.mark_notifications_read(
        ${actor}::uuid, ${i.facilityId}::uuid, ${i.notificationIds as string[] | null}::uuid[]) as marked`;
      return row?.['marked'] as number;
    }),

    // 0022: numerics come back as text from postgres.js, and stay text; the minimum's
    // moments as Dates, which reach the console as ISO moments.
    stockMinimums: (actor, q) => run(async () => (await sql`
      select * from erp.stock_minimums(${actor}::uuid, ${q.facilityId}::uuid, ${q.lowOnly}::boolean,
                                       ${q.afterCode}::text, ${q.limit}::integer)`
    ) as unknown as StockMinimum[]),
    stockMinimumHistory: (actor, q) => run(async () =>
      [...await sql`
        select * from erp.stock_minimum_history(${actor}::uuid, ${q.facilityId}::uuid, ${q.itemId}::uuid,
                                                ${q.beforeSeq}::bigint, ${q.limit}::integer)`]),
    setStockMinimum: (actor, i) => run(async () => {
      await sql`select erp.set_stock_minimum(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.itemUnitId}::uuid, ${i.quantity}::text,
        ${i.expectedDecisionId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    clearStockMinimum: (actor, i) => run(async () => {
      await sql`select erp.clear_stock_minimum(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.itemId}::uuid, ${i.expectedDecisionId}::uuid,
        ${i.reason}::text, ${actor}::uuid, now())`;
    }),

    // 0023. Amounts are bigints, which postgres.js answers as text: each becomes a number
    // through withMinor(), which refuses anything not a safe integer. Inside the order's
    // JSON they are numbers already, and quantities text (0023).
    purchaseOrders: (actor, q) => run(async () => (await sql`
      select purchase_order_id, seq::text as seq, number, business_date::text as business_date, state, progress,
             supplier_id, supplier_code, supplier_name_en, supplier_name_ar, currency, vat_rate_bp,
             subtotal_minor, vat_minor, total_minor, line_count, raised_by, raised_at, as_of_decision_id
        from erp.purchase_orders(${actor}::uuid, ${q.facilityId}::uuid, ${q.state}::text, ${q.beforeSeq}::bigint,
                                 ${q.limit}::integer)`
    ).map((row) => withMinor<PurchaseOrderRow>('erp.purchase_orders', row, ['subtotal_minor', 'vat_minor', 'total_minor']))),
    getPurchaseOrder: (actor, facilityId, purchaseOrderId) => run(async () => {
      const [row] = await sql`
        select purchase_order_id, number, business_date::text as business_date, state, progress, supplier_id,
               supplier_code, supplier_name_en, supplier_name_ar, supplier_status, currency, vat_rate_bp,
               subtotal_minor, vat_minor, total_minor, raised_by, raised_at, as_of_decision_id, lines, decisions, receipts
          from erp.get_purchase_order(${actor}::uuid, ${facilityId}::uuid, ${purchaseOrderId}::uuid)`;
      return withMinor<Record<string, unknown>>('erp.get_purchase_order', row as Record<string, unknown>,
        ['subtotal_minor', 'vat_minor', 'total_minor']);
    }),
    purchaseLimitHistory: (actor, q) => run(async () => (await sql`
      select decision_id, seq::text as seq, kind, limit_minor, currency, reason, actor_id, decided_at, recorded_at, is_current
        from erp.purchase_limit_history(${actor}::uuid, ${q.facilityId}::uuid, ${q.beforeSeq}::bigint, ${q.limit}::integer)`
    ).map((row) => withMinor<Record<string, unknown>>('erp.purchase_limit_history', row, ['limit_minor']))),
    raisePurchaseOrder: (actor, i) => run(async () => {
      await sql`select erp.raise_purchase_order(
        ${i.decisionId}::uuid, ${i.purchaseOrderId}::uuid, ${i.facilityId}::uuid, ${i.supplierId}::uuid,
        ${i.vatRateBp}::integer, ${sql.json(i.lines as unknown as postgres.JSONValue)}::jsonb, ${i.reason}::text,
        ${actor}::uuid, now())`;
    }),
    decidePurchaseOrder: (actor, i) => run(async () => {
      await sql`select erp.decide_purchase_order(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.purchaseOrderId}::uuid, ${i.kind}::text, ${i.reason}::text,
        ${actor}::uuid, now())`;
    }),
    receivePurchaseOrder: (actor, i) => run(async () => {
      await sql`select erp.receive_purchase_order(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.purchaseOrderId}::uuid, ${i.receivedAt}::timestamptz,
        ${sql.json(i.lines as unknown as postgres.JSONValue)}::jsonb, ${i.deliveryNote}::text, ${actor}::uuid, now())`;
    }),
    reversePurchaseReceipt: (actor, i) => run(async () => {
      await sql`select erp.reverse_purchase_receipt(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.receiptDecisionId}::uuid, ${i.reason}::text,
        ${i.overrideReason}::text, ${actor}::uuid, now())`;
    }),
    setPurchaseLimit: (actor, i) => run(async () => {
      await sql`select erp.set_purchase_limit(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.limitMinor}::bigint, ${i.currency}::text,
        ${i.expectedDecisionId}::uuid, ${i.reason}::text, ${actor}::uuid, now())`;
    }),
    clearPurchaseLimit: (actor, i) => run(async () => {
      await sql`select erp.clear_purchase_limit(
        ${i.decisionId}::uuid, ${i.facilityId}::uuid, ${i.expectedDecisionId}::uuid, ${i.reason}::text,
        ${actor}::uuid, now())`;
    }),
  };
}

export function connect(url: string): Connection {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: 'erp-edge' },
  });
  return { ...makeDb(sql), end: () => sql.end() };
}
