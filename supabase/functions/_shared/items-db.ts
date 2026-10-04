/**
 * What the items function asks the database: 0012's nine routes, one method each.
 *
 * Every method takes the actor FIRST and as its own argument, never inside an input
 * object. The only caller is ./items.ts, which passes `session.personId` there and
 * nothing else (ADR-0025), so a request body has no field an actor could come from.
 *
 * The decision time is not a parameter: the driver passes the database's now(). A
 * console's clock is not evidence of when an administrator decided.
 */

/** One conversion, as erp.list_items() and erp.get_item() return it. */
export interface ItemUnit {
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: number | string;
  readonly status: 'active' | 'retired';
  readonly as_of_decision_id: string;
}

/** One item, as erp.list_items() and erp.get_item() return it. */
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
  /** The stamp an edit form sends back as `expected_decision_id`. */
  readonly as_of_decision_id: string;
  readonly units: readonly ItemUnit[];
}

export interface ItemQuery {
  readonly facilityId: string | null;
  readonly brandId: string | null;
  /** null lists both. */
  readonly status: 'active' | 'retired' | null;
  readonly itemKind: string | null;
  readonly search: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface CreateItem {
  readonly decisionId: string;
  readonly itemId: string;
  readonly baseUnitDecisionId: string;
  readonly baseItemUnitId: string;
  readonly brandId: string;
  readonly code: string;
  readonly itemKind: string;
  readonly baseUnitKey: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly descriptionEn: string | null;
  readonly descriptionAr: string | null;
  readonly picturePath: string | null;
  readonly reason: string;
}

export interface AmendItem {
  readonly decisionId: string;
  readonly itemId: string;
  readonly expectedDecisionId: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly descriptionEn: string | null;
  readonly descriptionAr: string | null;
  readonly picturePath: string | null;
  readonly reason: string;
}

export interface ChangeItemStatus {
  readonly decisionId: string;
  readonly itemId: string;
  readonly expectedDecisionId: string;
  readonly status: 'active' | 'retired';
  readonly reason: string;
}

export interface AddItemUnit {
  readonly decisionId: string;
  readonly itemUnitId: string;
  readonly itemId: string;
  readonly unitKey: string;
  /** A decimal as text, so no binary float ever reaches a factor. null derives it. */
  readonly factor: string | null;
  readonly reason: string;
}

export interface RetireItemUnit {
  readonly decisionId: string;
  readonly itemUnitId: string;
  readonly reason: string;
}

export interface ImportSummary {
  readonly created: number;
  readonly amended: number;
  readonly unchanged: number;
}

export interface ItemsDb {
  listItems(actor: string, query: ItemQuery): Promise<readonly Item[]>;
  getItem(actor: string, facilityId: string | null, itemId: string): Promise<Item>;
  itemHistory(actor: string, facilityId: string | null, itemId: string): Promise<readonly Record<string, unknown>[]>;
  createItem(actor: string, input: CreateItem): Promise<void>;
  amendItem(actor: string, input: AmendItem): Promise<void>;
  changeItemStatus(actor: string, input: ChangeItemStatus): Promise<void>;
  addItemUnit(actor: string, input: AddItemUnit): Promise<void>;
  retireItemUnit(actor: string, input: RetireItemUnit): Promise<void>;
  importItems(actor: string, reason: string, rows: readonly Record<string, unknown>[]): Promise<ImportSummary>;
}
