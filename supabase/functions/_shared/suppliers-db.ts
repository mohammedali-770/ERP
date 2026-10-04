/**
 * What the suppliers function asks the database: 0016's twelve routes, one method each.
 *
 * As ./items-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./suppliers.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now().
 */

/** One supplier, as erp.list_suppliers() returns it. Contacts are on it, never in its log. */
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
 * One supplier with what it sells at the facility's brand, as erp.get_supplier()
 * returns it. `supplies` is null — not shown — for someone who may not read items there;
 * an empty list means the supplier sells nothing they can see (ADR-0026 §4).
 */
export interface SupplierDetail extends Supplier {
  readonly supplies: readonly Readonly<Record<string, unknown>>[] | null;
}

export interface SupplierQuery {
  readonly facilityId: string | null;
  /** null lists both. */
  readonly status: 'active' | 'retired' | null;
  readonly search: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

/** The business record a create or an amend puts in force. Never a contact (SEC-008). */
export interface SupplierFields {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly vatNumber: string | null;
  readonly crNumber: string | null;
  readonly paymentTermsDays: number;
  readonly reason: string;
}

export interface CreateSupplier extends SupplierFields {
  readonly decisionId: string;
  readonly supplierId: string;
  readonly code: string;
}

export interface AmendSupplier extends SupplierFields {
  readonly decisionId: string;
  readonly supplierId: string;
  readonly expectedDecisionId: string;
}

export interface ChangeSupplierStatus {
  readonly decisionId: string;
  readonly supplierId: string;
  readonly expectedDecisionId: string;
  readonly status: 'active' | 'retired';
  readonly reason: string;
}

/**
 * No reason: the route records a fixed one, because the reason a person would type for a
 * contact change names the person, and the log keeps every reason for good (ADR-0026 §2).
 * null clears a field; all four null erases the contact.
 */
export interface SetSupplierContact {
  readonly decisionId: string;
  readonly supplierId: string;
  readonly expectedDecisionId: string;
  readonly contactPerson: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
}

export interface AddSupplierItem {
  readonly decisionId: string;
  readonly supplierItemId: string;
  readonly supplierId: string;
  readonly itemUnitId: string;
  /** The supplier's own code for the pack, when they have one. */
  readonly supplierCode: string | null;
  readonly preferred: boolean;
  readonly reason: string;
}

export interface AmendSupplierItem {
  readonly decisionId: string;
  readonly supplierItemId: string;
  readonly expectedDecisionId: string;
  readonly supplierCode: string | null;
  readonly preferred: boolean;
  readonly reason: string;
}

export interface RetireSupplierItem {
  readonly decisionId: string;
  readonly supplierItemId: string;
  readonly reason: string;
}

export interface SupplierImportSummary {
  readonly created: number;
  readonly amended: number;
  readonly unchanged: number;
}

export interface SuppliersDb {
  listSuppliers(actor: string, query: SupplierQuery): Promise<readonly Supplier[]>;
  getSupplier(actor: string, facilityId: string | null, supplierId: string): Promise<SupplierDetail>;
  supplierHistory(actor: string, facilityId: string | null, supplierId: string): Promise<readonly Record<string, unknown>[]>;
  /** Who sells an item, live supplies of live suppliers on live packs first, then preferred first. */
  itemSuppliers(actor: string, facilityId: string | null, itemId: string): Promise<readonly Record<string, unknown>[]>;
  createSupplier(actor: string, input: CreateSupplier): Promise<void>;
  amendSupplier(actor: string, input: AmendSupplier): Promise<void>;
  changeSupplierStatus(actor: string, input: ChangeSupplierStatus): Promise<void>;
  setSupplierContact(actor: string, input: SetSupplierContact): Promise<void>;
  addSupplierItem(actor: string, input: AddSupplierItem): Promise<void>;
  amendSupplierItem(actor: string, input: AmendSupplierItem): Promise<void>;
  retireSupplierItem(actor: string, input: RetireSupplierItem): Promise<void>;
  importSuppliers(actor: string, reason: string, rows: readonly Record<string, unknown>[]): Promise<SupplierImportSummary>;
}
