/**
 * What a person reads when the edge says no: sign-in's answers, a refusal, an import's
 * problems. Plain TypeScript so test/logic.test.ts reads every branch.
 *
 * A refusal is shown in two parts: a sentence in the reader's language for its kind
 * (`refusal_conflict`…), and, under it, the database's own words when a route wrote them
 * (refusal.ts passes a RAISE's message through and withholds PostgreSQL's). Those words
 * are English and name the code or line at fault, which is what a person needs to fix
 * an import; translating each RAISE is for a later step, and is recorded in the UAT pack.
 *
 * Requirements: PRG-014 · IAM-P02
 */
import type { Failure, SignInResult } from './api.ts';
import type { ImportProblem } from './csv.ts';
import { label, t, type Key, type Lang } from './i18n.ts';

export interface Message {
  readonly text: string;
  /** The database's own words, when there are any worth showing. */
  readonly detail: string | null;
}

const REFUSAL_KEY: Readonly<Record<string, Key>> = {
  forbidden: 'refusal_forbidden',
  conflict: 'refusal_conflict',
  stale: 'refusal_stale',
  refused: 'refusal_refused',
  invalid: 'refusal_invalid',
  not_found: 'refusal_not_found',
  no_such_route: 'refusal_not_found',
  too_large: 'refusal_too_large',
  already_recorded: 'already_recorded',
  idle: 'session_idle',
  unauthenticated: 'session_ended',
  ended: 'session_ended',
  expired: 'session_ended',
  disabled: 'signin_account_disabled',
};

/**
 * The rules a person is likeliest to meet, by the constraint 0012 or 0016 names for each. Some are
 * PostgreSQL's own checks, whose words the edge withholds (refusal.ts), so without this a
 * missing Arabic description read only "a value is not valid" (found running the screens).
 */
const RULE_KEY: Readonly<Record<string, Key>> = {
  item_code_key: 'rule_code_taken',
  item_code_is_canonical: 'rule_code_canonical',
  item_description_is_bilingual: 'rule_descriptions_paired',
  item_decision_reason_is_stated: 'rule_reason_required',
  item_unit_factor_required: 'rule_factor_required',
  item_unit_factor_inexact: 'rule_factor_inexact',
  item_unit_agrees_with_its_dimension: 'rule_unit_disagrees',
  // 0016's, for suppliers and what they sell. Stale and missing are named per record, so
  // a supplier's refusal does not speak of "this item".
  // Not supplier_decision_pkey: a route's retry answer is already_recorded, which every
  // screen treats as saved; the same constraint reaching here is PostgreSQL's own
  // collision, where nothing was recorded, and "already saved" would be false (review).
  supplier_code_key: 'rule_supplier_code_taken',
  supplier_code_is_canonical: 'rule_supplier_code_canonical',
  supplier_active_name_en_key: 'rule_supplier_name_taken',
  supplier_active_name_ar_key: 'rule_supplier_name_taken',
  supplier_names_are_bilingual: 'rule_supplier_names',
  supplier_names_are_canonical: 'rule_supplier_names',
  supplier_vat_number_is_valid: 'rule_vat',
  supplier_cr_number_is_valid: 'rule_cr',
  supplier_payment_terms_are_days: 'rule_terms',
  supplier_contacts_are_canonical: 'rule_contact',
  supplier_decision_reason_is_stated: 'rule_reason_required',
  supplier_stale: 'rule_supplier_stale',
  supplier_exists: 'rule_no_supplier',
  supplier_is_retired: 'rule_supplier_retired',
  supplier_status_unchanged: 'rule_supplier_status_unchanged',
  supplier_item_one_active: 'rule_supply_one_active',
  supplier_item_one_preferred: 'rule_one_preferred',
  supplier_item_conversion_is_active: 'rule_pack_retired',
  item_admits_no_new_work: 'rule_item_retired',
  supplier_item_retirement_final: 'rule_supply_final',
  supplier_item_already_retired: 'rule_supply_already_retired',
  supplier_item_code_is_canonical: 'rule_supply_code',
  supplier_item_stale: 'rule_supply_stale',
  supplier_item_exists: 'rule_no_supply',
};

export function failureMessage(lang: Lang, f: Failure): Message {
  if (f.http === 0) return { text: t(lang, 'network_error'), detail: null };
  // The field's label in the reader's language where the console has one, its name otherwise.
  if (f.status === 'malformed') return { text: t(lang, 'refusal_malformed', { field: label(lang, f.field ?? '?') }), detail: null };
  // A 401 'invalid' is a session the token no longer names, not a form value.
  const key = f.http === 401 && f.status === 'invalid' ? 'session_ended' : REFUSAL_KEY[f.status];
  if (key === undefined || f.http >= 500) return { text: t(lang, 'unexpected_error'), detail: null };
  const rule = f.constraint === null ? undefined : RULE_KEY[f.constraint];
  // The database's words, then the rule's name: what a person quotes when they ask for help.
  const words = [f.message, f.detail, f.constraint === null ? null : `[${f.constraint}]`]
    .filter((s): s is string => s !== null && s !== '').join('\n');
  return { text: t(lang, rule ?? key), detail: words === '' ? null : words };
}

/**
 * Sign-in's answer as a sentence. An unknown number and a wrong PIN read the same, as
 * the database answers them the same (IAM-P02).
 */
export function signInMessage(lang: Lang, r: SignInResult, formatTime: (iso: string) => string): string | null {
  switch (r.status) {
    case 'ok': return null;
    case 'wrong':
      return r.attempts_left === undefined
        ? t(lang, 'signin_wrong_pin')
        : `${t(lang, 'signin_wrong_pin')} ${t(lang, 'signin_attempts_left', { n: r.attempts_left })}`;
    case 'locked': return t(lang, 'signin_locked', { time: formatTime(r.locked_until) });
    case 'disabled': return t(lang, 'signin_account_disabled');
    case 'malformed': return t(lang, 'signin_malformed');
  }
}

export function importProblem(lang: Lang, p: ImportProblem): string {
  switch (p.kind) {
    case 'empty': return t(lang, 'import_empty');
    case 'too_many': return t(lang, 'import_too_many', { rows: p.rows });
    case 'missing_column': return t(lang, 'import_missing_column', { column: p.column });
    case 'unknown_column': return t(lang, 'import_unknown_column', { column: p.column });
    case 'duplicate_column': return t(lang, 'import_duplicate_column', { column: p.column });
    case 'width': return t(lang, 'import_width', { line: p.line, found: p.found, expected: p.expected });
    case 'unknown_brand': return t(lang, 'import_unknown_brand', { line: p.line, brand: p.brand });
    case 'quote': return t(lang, 'import_quote', { line: p.line });
  }
}
