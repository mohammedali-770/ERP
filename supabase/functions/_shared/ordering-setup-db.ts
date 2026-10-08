/**
 * What the ordering-setup function asks the database: 0024's six write routes and six reads,
 * one method each.
 *
 * As ./stock-alerts-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./ordering-setup.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now().
 *
 * erp.order_day(), module 10's seam, is not here: the runtime cannot call it (ADR-0033 §6).
 *
 * A PAR IS DECIMAL TEXT, both ways, as stock's quantities are: "1.5", never the number 1.5.
 * A CUT-OFF IS 'HH:MM' TEXT, both ways.
 */

/** An item and the facility that supplies branches with it, as erp.replenishment_sources() returns it. */
export interface ReplenishmentSource {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  /** The supplying facility, or null when none does. */
  readonly facility_id: string | null;
  readonly facility_code: string | null;
  readonly facility_type: 'warehouse' | 'factory' | null;
  readonly facility_name_en: string | null;
  readonly facility_name_ar: string | null;
  /** The stamp an edit form sends back: null only when the item has NEVER had a source. */
  readonly as_of_decision_id: string | null;
  readonly decided_at: string | null;
}

/** A warehouse or factory and its cut-off, as erp.order_cutoffs() returns it. */
export interface OrderCutoff {
  readonly facility_id: string;
  readonly code: string;
  readonly facility_type: 'warehouse' | 'factory';
  readonly name_en: string;
  readonly name_ar: string;
  readonly status: 'open' | 'closed';
  readonly tz_name: string;
  /** 'HH:MM' at the facility, or null when it has none. */
  readonly cutoff: string | null;
  /** Null only when the facility has NEVER had a cut-off. */
  readonly as_of_decision_id: string | null;
  readonly decided_at: string | null;
}

/** A branch's par for an item, as erp.par_levels() returns it. */
export interface ParLevel {
  readonly item_id: string;
  readonly code: string;
  readonly item_kind: string;
  readonly base_unit_key: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly item_status: 'active' | 'retired';
  /** Decimal text, in the item's base unit. */
  readonly par: string;
  /** The facility that supplies the item now, or null. */
  readonly source_facility_id: string | null;
  readonly as_of_decision_id: string;
  /** As entered: the pack, its factor and the quantity in it, as decimal text. */
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly quantity: string;
  readonly decided_at: string;
}

export interface SourceQuery {
  /** Where the list is asked; null asks organisation-wide, which only an organisation-wide reader passes. */
  readonly facilityId: string | null;
  /** Only the items this facility supplies. */
  readonly suppliedBy: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface SourceHistoryQuery {
  readonly facilityId: string | null;
  readonly itemId: string;
  /** Decimal text of a seq (int8): the page ends before it. */
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface CutoffQuery {
  readonly facilityId: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface CutoffHistoryQuery {
  /** The supplying facility the cut-off is of, which the read is asked at. */
  readonly facilityId: string;
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface ParQuery {
  /** Where the list is asked: the branch, a facility that supplies it, or null for the organisation. */
  readonly facilityId: string | null;
  readonly branchId: string;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface ParHistoryQuery {
  readonly facilityId: string | null;
  readonly branchId: string;
  readonly itemId: string;
  readonly beforeSeq: string | null;
  readonly limit: number;
}

export interface SetSource {
  readonly decisionId: string;
  readonly itemId: string;
  /** The warehouse or factory that is to supply branches with the item. */
  readonly suppliedBy: string;
  /** The stamp of the decision in force, a clearing included, or null when the item has never had a source. */
  readonly expectedDecisionId: string | null;
  readonly reason: string;
}

export interface ClearSource {
  readonly decisionId: string;
  readonly itemId: string;
  /** There is a source to clear, so there is always a stamp. */
  readonly expectedDecisionId: string;
  readonly reason: string;
}

export interface SetCutoff {
  readonly decisionId: string;
  readonly facilityId: string;
  /** 'HH:MM'. That it is a time of day, 00:00 to 23:59, is 0024's rule. */
  readonly cutoff: string;
  readonly expectedDecisionId: string | null;
  readonly reason: string;
}

export interface ClearCutoff {
  readonly decisionId: string;
  readonly facilityId: string;
  readonly expectedDecisionId: string;
  readonly reason: string;
}

export interface SetPar {
  readonly decisionId: string;
  /** Where the par is set from: the facility that supplies the item, or null for the organisation. */
  readonly facilityId: string | null;
  readonly branchId: string;
  /** The pack the par is entered in. */
  readonly itemUnitId: string;
  /** Decimal text. That it is above nothing, exact and within range is 0024's rule. */
  readonly quantity: string;
  readonly expectedDecisionId: string | null;
  readonly reason: string;
}

export interface ClearPar {
  readonly decisionId: string;
  readonly facilityId: string | null;
  readonly branchId: string;
  readonly itemId: string;
  readonly expectedDecisionId: string;
  readonly reason: string;
}

export interface OrderingSetupDb {
  replenishmentSources(actor: string, query: SourceQuery): Promise<readonly ReplenishmentSource[]>;
  replenishmentSourceHistory(actor: string, query: SourceHistoryQuery): Promise<readonly Record<string, unknown>[]>;
  orderCutoffs(actor: string, query: CutoffQuery): Promise<readonly OrderCutoff[]>;
  orderCutoffHistory(actor: string, query: CutoffHistoryQuery): Promise<readonly Record<string, unknown>[]>;
  parLevels(actor: string, query: ParQuery): Promise<readonly ParLevel[]>;
  parLevelHistory(actor: string, query: ParHistoryQuery): Promise<readonly Record<string, unknown>[]>;
  setReplenishmentSource(actor: string, input: SetSource): Promise<void>;
  clearReplenishmentSource(actor: string, input: ClearSource): Promise<void>;
  setOrderCutoff(actor: string, input: SetCutoff): Promise<void>;
  clearOrderCutoff(actor: string, input: ClearCutoff): Promise<void>;
  setParLevel(actor: string, input: SetPar): Promise<void>;
  clearParLevel(actor: string, input: ClearPar): Promise<void>;
}
