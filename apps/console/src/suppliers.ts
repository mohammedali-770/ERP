/**
 * The supplier screens' logic, kept out of .tsx so test/logic.test.ts can read it.
 *
 * WHAT IS CHECKED HERE IS A COURTESY. 0016 decides every rule: a VAT number's shape, a
 * phone's, payment terms of 0–365 days, one preferred supplier an item. The forms ask a
 * few of them before sending only so a person is told which field, not that "a value is
 * not valid" — as items.ts does for paired descriptions. The database still decides.
 *
 * Requirements: PRC-005 · INV-005 · SEC-008 · PRG-014
 */
import type {
  AmendSupplierInput, AmendSupplyInput, ContactInput, Supplier, Supply,
} from './api.ts';
import { latinDigits } from './format.ts';
import { optional } from './items.ts';

/** The warehouse's default terms, offered by the create form. The database has no default (ADR-0026 §1). */
export const DEFAULT_PAYMENT_TERMS = 30;

/**
 * Digits as erp.normalise_digits() (0016) reads them: Arabic-Indic and Persian digits as
 * ASCII, and spaces, no-break spaces, direction marks, the Arabic thousands separator and
 * hyphens dropped. Used only to pre-check a field; what is sent is what the person typed,
 * and the database folds it the same way.
 */
export function foldDigits(raw: string): string {
  return latinDigits(raw).replace(/[\s  ‎‏؜٬-]/g, '');
}

/** 0016's assert_supplier_fields(): fifteen digits, beginning and ending with 3. Blank is none. */
export function vatLooksValid(raw: string): boolean {
  const v = foldDigits(raw);
  return v === '' || /^3[0-9]{13}3$/.test(v);
}

/** 0016's assert_supplier_fields(): ten digits. Blank is none. */
export function crLooksValid(raw: string): boolean {
  const v = foldDigits(raw);
  return v === '' || /^[0-9]{10}$/.test(v);
}

/** 0016's supplier_contacts_are_canonical: 6 to 15 digits, optionally after +. Blank is none. */
export function phoneLooksValid(raw: string): boolean {
  const v = foldDigits(raw);
  return v === '' || /^\+?[0-9]{6,15}$/.test(v);
}

/** 0016's supplier_contacts_are_canonical, for an email. Blank is none. */
export function emailLooksValid(raw: string): boolean {
  const v = raw.trim();
  return v === '' || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
}

/**
 * Payment terms as typed: a whole number of days, in either script. The edge refuses
 * anything but a JSON integer, so text never reaches it; whether 400 days is allowed is
 * 0016's to say (supplier_payment_terms_are_days), not this function's.
 */
export function termsInput(raw: string): { ok: true; value: number } | { ok: false } {
  const v = latinDigits(raw).trim();
  return /^[0-9]{1,9}$/.test(v) ? { ok: true, value: Number(v) } : { ok: false };
}

/** The first field a supplier form would be refused on, before it is sent, or null. */
export function businessProblem(f: { vat: string; cr: string; terms: string }): 'vat_number' | 'cr_number' | 'payment_terms_days' | null {
  if (!vatLooksValid(f.vat)) return 'vat_number';
  if (!crLooksValid(f.cr)) return 'cr_number';
  if (!termsInput(f.terms).ok) return 'payment_terms_days';
  return null;
}

/** The first contact field that would be refused, or null. */
export function contactProblem(f: { phone: string; email: string }): 'phone' | 'email' | null {
  if (!phoneLooksValid(f.phone)) return 'phone';
  if (!emailLooksValid(f.email)) return 'email';
  return null;
}

/**
 * An amendment's body. Every field the route overwrites is stated — a blank number is
 * null, sent as null, never left out — because the edge refuses an absent one rather than
 * read it as "clear" (ADR-0026's step 2 addendum).
 */
export function amendBody(supplier: Supplier, decisionId: string, f: {
  nameEn: string; nameAr: string; vat: string; cr: string; terms: number; reason: string;
}): AmendSupplierInput {
  return {
    decision_id: decisionId,
    // The stamp the form was loaded from: a change made since is refused as stale.
    expected_decision_id: supplier.as_of_decision_id,
    name_en: f.nameEn,
    name_ar: f.nameAr,
    vat_number: optional(f.vat),
    cr_number: optional(f.cr),
    payment_terms_days: f.terms,
    reason: f.reason.trim(),
  };
}

/** The whole contact, every field stated. There is no reason field, and never will be (§2). */
export function contactBody(supplier: Supplier, decisionId: string, f: {
  person: string; phone: string; email: string; address: string;
}): ContactInput {
  return {
    decision_id: decisionId,
    expected_decision_id: supplier.as_of_decision_id,
    contact_person: optional(f.person),
    phone: optional(f.phone),
    email: optional(f.email),
    address: optional(f.address),
  };
}

/** Erasure: every contact field null, which the database records as "Contact details erased." */
export function eraseBody(supplier: Supplier, decisionId: string): ContactInput {
  return contactBody(supplier, decisionId, { person: '', phone: '', email: '', address: '' });
}

export function hasContact(s: Supplier): boolean {
  return [s.contact_person, s.phone, s.email, s.address].some((v) => v !== null);
}

/** A supply amendment's body: the supplier's own code stated, as text or null. */
export function amendSupplyBody(supply: Supply, decisionId: string, f: {
  supplierCode: string; preferred: boolean; reason: string;
}): AmendSupplyInput {
  return {
    decision_id: decisionId,
    expected_decision_id: supply.as_of_decision_id,
    supplier_code: optional(f.supplierCode),
    preferred: f.preferred,
    reason: f.reason.trim(),
  };
}

/**
 * What may be changed about a supply, as 0016's amend_supplier_item() allows:
 *
 *   none        the supply is retired, for good (I-6)
 *   unprefer    the supplier is retired: it may only give up the item's preferred slot,
 *               so a slot is never held for good — and only if it holds one
 *   no_prefer   its pack or item is retired since: amendable, but not made preferred if
 *               it is not already (a preferred one may keep or give up its slot)
 *   any         everything
 */
export type SupplyChange = 'none' | 'unprefer' | 'no_prefer' | 'any';

export function supplyChange(supply: Supply, supplierActive: boolean): SupplyChange {
  if (supply.status === 'retired') return 'none';
  if (!supplierActive) return supply.preferred ? 'unprefer' : 'none';
  if (supply.conversion_status === 'retired' || supply.item_status === 'retired') return 'no_prefer';
  return 'any';
}

/** Why a live supply cannot be bought now, if it cannot: its pack or its item is retired. */
export function supplyWarning(s: { conversion_status: string; item_status: string }): 'item_retired' | 'pack_retired' | null {
  if (s.item_status === 'retired') return 'item_retired';
  if (s.conversion_status === 'retired') return 'pack_retired';
  return null;
}

/**
 * The conversions an "add supply" form offers for an item: its active ones the supplier
 * does not already sell actively (0016: a supplier sells one conversion once at a time).
 */
export function suppliablePacks<U extends { item_unit_id: string; status: string }>(
  units: readonly U[], supplies: readonly Supply[] | null,
): U[] {
  const sold = new Set((supplies ?? []).filter((s) => s.status === 'active').map((s) => s.item_unit_id));
  return units.filter((u) => u.status === 'active' && !sold.has(u.item_unit_id));
}
