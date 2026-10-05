/**
 * What the transfer-prices function asks the database: 0018's five runtime routes, one
 * method each.
 *
 * As ./suppliers-db.ts: every method takes the actor FIRST and as its own argument, never
 * inside an input object. The only caller is ./transfer-prices.ts, which passes
 * `session.personId` there and nothing else (ADR-0025). The decision time is not a
 * parameter: the driver passes the database's now(), and the route judges "now" by the
 * clock once it holds the pack's lock regardless (ADR-0027 §8).
 *
 * erp.transfer_price_at(), the seam a branch order will call, is not here: it is
 * owner-only, called from module 10's own routes, never from the edge.
 */
import { UnexpectedAnswer } from './db.ts';

/** One pack of one item on the price list, as erp.list_transfer_prices() returns it. */
export interface PriceListRow {
  readonly item_id: string;
  readonly code: string;
  readonly name_en: string;
  readonly name_ar: string;
  readonly base_unit_key: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
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

/** One price ever set for an item's packs, as erp.item_transfer_prices() returns it. */
export interface ItemPrice {
  readonly price_id: string;
  readonly item_unit_id: string;
  readonly unit_key: string;
  readonly factor: string;
  readonly price_minor: number;
  readonly currency: string;
  readonly effective_from: string;
  readonly status: 'active' | 'withdrawn';
  readonly in_force: boolean;
  readonly conversion_status: 'active' | 'retired';
  readonly as_of_decision_id: string;
}

export interface PriceListQuery {
  readonly facilityId: string | null;
  readonly search: string | null;
  readonly afterCode: string | null;
  readonly limit: number;
}

export interface SetTransferPrice {
  readonly decisionId: string;
  readonly priceId: string;
  readonly itemUnitId: string;
  /** Whole minor units (halalas). That it is 0 to 100,000,000,000 is the route's rule. */
  readonly priceMinor: number;
  readonly currency: string;
  /** An ISO 8601 moment with its offset, or null for now. Never earlier than now: the route's rule. */
  readonly effectiveFrom: string | null;
  readonly reason: string;
}

export interface WithdrawTransferPrice {
  readonly decisionId: string;
  readonly priceId: string;
  readonly reason: string;
}

export interface TransferPricesDb {
  listTransferPrices(actor: string, query: PriceListQuery): Promise<readonly PriceListRow[]>;
  itemTransferPrices(actor: string, facilityId: string | null, itemId: string): Promise<readonly ItemPrice[]>;
  transferPriceHistory(actor: string, facilityId: string | null, itemId: string): Promise<readonly Record<string, unknown>[]>;
  setTransferPrice(actor: string, input: SetTransferPrice): Promise<void>;
  withdrawTransferPrice(actor: string, input: WithdrawTransferPrice): Promise<void>;
}

/**
 * A bigint amount as a JSON number. postgres.js answers an int8 as a string, because a
 * JavaScript number cannot hold every int8. An amount can: the route caps it at 10^11,
 * far below 2^53. Anything that is not a whole number in that range is a migration and
 * an edge out of step, and an error rather than an answer — an amount is never guessed.
 */
export function asMinor(route: string, value: unknown): number | null {
  if (value === null) return null;
  const n = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value)
    : typeof value === 'bigint' ? Number(value)
    : typeof value === 'number' ? value
    : NaN;
  if (!Number.isSafeInteger(n)) throw new UnexpectedAnswer(route, { status: `amount ${String(value)}` });
  return n;
}

/**
 * The same row, with each named amount field a number (or null). A field the row does
 * not have is an error, not null: a renamed column would otherwise list a priced pack as
 * unpriced (found in review).
 */
export function withMinor<T>(route: string, row: Readonly<Record<string, unknown>>, fields: readonly string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const field of fields) {
    if (!Object.hasOwn(row, field)) throw new UnexpectedAnswer(route, { status: `missing ${field}` });
    out[field] = asMinor(route, row[field]);
  }
  return out as T;
}
